/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { FieldValue } from 'firebase-admin/firestore'
// The leaves, not the barrel — see `email-suppression.ts` for why: a spec
// of this sweep substitutes a store, not the pure helpers it leans on.
import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { companyContactsCountFields } from './contact-company-link'
import { eraseEmailDeliveriesForAddresses } from './email-delivery-log'
import { suppressEmailForHostErasure } from './email-suppression'
import firebaseAdmin from './firebase-admin'
import { listMemberDocIds } from './list-members'

const defaultFirestore = () => firebaseAdmin.app().firestore()

/** Firestore caps a batch at 500 writes; a page under it keeps a margin. */
const PAGE = 400

/**
 * A pathological collection must not hold the erasure open indefinitely:
 * twenty pages of four hundred is eight thousand rows of one kind for one
 * person, past anything a real relationship produces.
 */
const MAX_PAGES = 20

export interface ErasePersonOptions {
  orgId: string
  /** Any spelling; normalized before anything is looked up. */
  email: unknown
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
  /** Injectable for tests; defaults to `Date.now()`. */
  now?: number
}

/**
 * Counts, never identities: this is what the request document and the
 * audit row record, and both are read by people who must not learn the
 * address from them.
 */
export interface ErasePersonCounts {
  /** Sites in the workspace the sweep walked. */
  hosts: number
  /** Suppression rows written, one per site. */
  hostsSuppressed: number
  /** Contact documents deleted — the row every site shared. */
  contacts: number
  /** Companies whose contact count moved down. */
  companyLinks: number
  /** Deals whose `contactId` was removed. */
  deals: number
  tasks: number
  activities: number
  /** `hosts/{hostId}/leads/{personKey}` rows deleted. */
  leads: number
  /** Audience-list member rows deleted, across every list. */
  listMemberships: number
  /** Orders with the buyer's identity removed; the record stays. */
  orders: number
  /** Bookings with the person's identity removed; the record stays. */
  bookings: number
  /** Delivery-log messages deleted under the address. */
  emailDeliveries: number
}

export type ErasePersonResult =
  | ({ ok: true } & ErasePersonCounts)
  | { ok: false; skippedReason: 'invalid-email' }

/**
 * Remove one person from one workspace (AGL-2623).
 *
 * `planContactDetach` is deliberately not consulted: the CRM's delete is a
 * detach that leaves the row for the other holders, and this is the act
 * that must not. The contact document goes whole — every site's facet,
 * every consent entry, every attribution — and with it everything the
 * workspace keeps beside the person.
 *
 * ## Order
 *
 *   1. **Suppress first.** One row per site on the per-site suppression
 *      list, before any delete: a form filled in while the sweep runs must
 *      already find the door closed, or the sweep deletes a row that the
 *      capture re-creates a moment later.
 *   2. The contact and its satellites — company counts, deals unlinked,
 *      tasks and activities deleted — by the contact's id, then the
 *      document itself.
 *   3. Leads, list memberships, orders and bookings by the address, on
 *      every site of the workspace.
 *   4. The delivery log, last: it is filed under the address alone, and the
 *      tombstone it leaves is what keeps a later import from refilling it.
 *
 * ## What is anonymized rather than deleted
 *
 * An order is the merchant's record of a sale and a booking of an
 * appointment; the amounts, the line items and the tax are theirs to keep
 * and the law expects them kept. The person is taken OFF those records —
 * name, email, phone, addresses — and a stamp says when. A deal is the
 * team's own pipeline record and is unlinked. Everything else that names
 * the person is about the person and is deleted.
 *
 * ## What is not reached, and why
 *
 * A form submission keeps the address inside `fields`, under whatever the
 * form called it — there is no key to query by and a scan of every
 * submission on every site is unbounded. A site member's login is their
 * own account. A subscription carries the address it bills, and a live one
 * cannot be anonymized without breaking its receipts. Each is named to the
 * admin by the dialog so they can finish by hand.
 *
 * Every sweep is best-effort against the others: a failure in one is
 * logged and counted as zero, and the request's counts say what happened.
 * The caller decides whether zero contacts on a person it could see is a
 * failure to retry.
 */
export async function erasePerson(
  options: ErasePersonOptions,
): Promise<ErasePersonResult> {
  const email = normalizeContactEmail(options.email)
  const key = email ? personKey(email) : null
  if (!email || !key) return { ok: false, skippedReason: 'invalid-email' }
  const db = options.firestore ?? defaultFirestore()
  const now = options.now ?? Date.now()
  const orgRef = db.collection('orgs').doc(options.orgId)

  const counts: ErasePersonCounts = {
    hosts: 0,
    hostsSuppressed: 0,
    contacts: 0,
    companyLinks: 0,
    deals: 0,
    tasks: 0,
    activities: 0,
    leads: 0,
    listMemberships: 0,
    orders: 0,
    bookings: 0,
    emailDeliveries: 0,
  }

  const hosts = await db
    .collection('hosts')
    .where('orgId', '==', options.orgId)
    .get()
  const hostIds: string[] = hosts.docs.map((doc: any) => String(doc.id))
  counts.hosts = hostIds.length

  for (const hostId of hostIds) {
    try {
      const written = await suppressEmailForHostErasure({ hostId, email, firestore: db })
      if (written) counts.hostsSuppressed += 1
    } catch (error) {
      console.error(`erasePerson: suppression write failed for ${hostId}`, error)
    }
  }

  const contacts = await orgRef.collection('contacts').where('email', '==', email).get()
  for (const contact of contacts.docs) {
    const contactId = String(contact.id)
    const companyIds: unknown = contact.get('companyIds')
    const linked = Array.isArray(companyIds)
      ? companyIds.filter((id): id is string => typeof id === 'string' && !!id)
      : []
    for (const companyId of new Set(linked)) {
      try {
        await orgRef
          .collection(CRM_COLLECTIONS.companies)
          .doc(companyId)
          .update(companyContactsCountFields(-1))
        counts.companyLinks += 1
      } catch (error) {
        console.error(`erasePerson: company count could not move for ${companyId}`, error)
      }
    }
    counts.deals += await updateWhere(
      db,
      orgRef.collection(CRM_COLLECTIONS.deals),
      'contactId',
      contactId,
      { contactId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
    )
    counts.tasks += await deleteWhere(db, orgRef.collection(CRM_COLLECTIONS.tasks), 'contactId', contactId)
    counts.activities += await deleteWhere(
      db,
      orgRef.collection(CRM_COLLECTIONS.activities),
      'contactId',
      contactId,
    )
    try {
      await contact.ref.delete()
      counts.contacts += 1
    } catch (error) {
      console.error(`erasePerson: contact delete failed for ${contactId}`, error)
    }
  }

  const erasedOrder = {
    customerEmail: null,
    customerName: null,
    shippingAddress: FieldValue.delete(),
    billingAddress: FieldValue.delete(),
    customerErasedAtMs: now,
  }
  const erasedBooking = {
    email: null,
    name: FieldValue.delete(),
    phone: FieldValue.delete(),
    customerErasedAtMs: now,
  }
  for (const hostId of hostIds) {
    const hostRef = db.collection('hosts').doc(hostId)
    try {
      const lead = hostRef.collection('leads').doc(key)
      if ((await lead.get()).exists) {
        await lead.delete()
        counts.leads += 1
      }
    } catch (error) {
      console.error(`erasePerson: lead delete failed for ${hostId}`, error)
    }
    counts.orders += await updateWhere(db, hostRef.collection('orders'), 'customerEmail', email, erasedOrder)
    counts.bookings += await updateWhere(db, hostRef.collection('bookings'), 'email', email, erasedBooking)
  }

  try {
    const memberIds = listMemberDocIds(email)
    const lists = await orgRef.collection('lists').get()
    for (const list of lists.docs) {
      const refs = memberIds.map((id) => list.ref.collection('members').doc(id))
      const found = await db.getAll(...refs)
      for (const member of found) {
        if (!member.exists) continue
        await member.ref.delete()
        counts.listMemberships += 1
      }
    }
  } catch (error) {
    console.error('erasePerson: list membership sweep failed', error)
  }

  try {
    const sweep = await eraseEmailDeliveriesForAddresses([{ address: email }], db)
    counts.emailDeliveries = sweep.removed
  } catch (error) {
    console.error('erasePerson: delivery log sweep failed', error)
  }

  await db
    .collection('adminAudit')
    .add({
      actorUid: 'system:erase-person',
      action: 'person.erased',
      target: `orgs/${options.orgId}/people/${key}`,
      before: null,
      after: counts,
      at: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)

  return { ok: true, ...counts }
}

/**
 * Delete every document in `collection` whose `field` equals `value`, a
 * page at a time. Returns how many went; a failure logs and stops, and the
 * count says how far it got.
 */
async function deleteWhere(
  db: any,
  collection: any,
  field: string,
  value: string,
): Promise<number> {
  let removed = 0
  try {
    for (let pass = 0; pass < MAX_PAGES; pass += 1) {
      const page = await collection.where(field, '==', value).limit(PAGE).get()
      if (page.empty) break
      const batch = db.batch()
      page.docs.forEach((doc: any) => batch.delete(doc.ref))
      await batch.commit()
      removed += page.size
      if (page.size < PAGE) break
    }
  } catch (error) {
    console.error(`erasePerson: delete sweep failed on ${field}`, error)
  }
  return removed
}

/**
 * Apply `patch` to every document in `collection` whose `field` equals
 * `value`. Because the patch clears the very field that was matched on, a
 * second page never sees the first page's rows again, so the loop needs no
 * cursor; the page cap is the only bound.
 */
async function updateWhere(
  db: any,
  collection: any,
  field: string,
  value: string,
  patch: Record<string, unknown>,
): Promise<number> {
  let changed = 0
  try {
    for (let pass = 0; pass < MAX_PAGES; pass += 1) {
      const page = await collection.where(field, '==', value).limit(PAGE).get()
      if (page.empty) break
      const batch = db.batch()
      page.docs.forEach((doc: any) => batch.update(doc.ref, patch))
      await batch.commit()
      changed += page.size
      if (page.size < PAGE) break
    }
  } catch (error) {
    console.error(`erasePerson: update sweep failed on ${field}`, error)
  }
  return changed
}
