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

/**
 * MERGING TWO CONTACTS — the write (AGL-2625).
 *
 * `planContactMerge` says what the survivor becomes; this performs it, and
 * moves everything that pointed at the merged record. One function behind
 * two doors — the console's `crm/contacts-merge` route and
 * `POST /v1/contacts/{id}/merge` — so the REST caller and the record page
 * cannot merge two different ways.
 *
 * ## The order is the crash-safety argument
 *
 *  1. Every deal, task and activity naming the merged contact is repointed
 *     at the survivor, and every lead converted into it. Batched, bounded,
 *     idempotent: a re-run finds nothing left to move.
 *  2. Then, in ONE transaction: the survivor takes the plan, every address
 *     it now answers to is indexed at it, and the merged document is
 *     deleted — with both records re-read inside the transaction, so two
 *     merges racing on one pair cannot both succeed and a plan is never
 *     computed on a document that changed under it.
 *
 * Children first because a process that dies between the two steps leaves
 * children pointing at a record that EXISTS — the survivor — while the merged
 * document is still there for a retry to fold in. The other order would
 * leave deals pointing at a deleted contact, which is a record nobody can
 * open from anywhere.
 *
 * ## What it does not move
 *
 * List memberships, suppression entries and the delivery log are keyed by
 * ADDRESS, not by contact id, and stay under the merged address; a capture
 * on that address resolves to the survivor through the index, which is the
 * fact those keys need. A company's contacts count drops only for a company
 * both records named — the survivor still names the rest.
 */

import {
  CONTACT_EMAIL_INDEX_COLLECTION,
  contactEmails,
} from '@aglyn/aglyn/app-utils/contacts'
import { planContactMerge } from '@aglyn/aglyn/app-utils/contact-merge'
import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { FieldValue } from 'firebase-admin/firestore'
import { settleCompanyContactsCounts } from './contact-company-link'
import { logHostActivity } from './organizations'

/** How many pointing rows one repoint pass reads — and one batch writes. */
const REPOINT_PAGE = 400
/** A ceiling on passes, so a query that keeps answering cannot loop forever. */
const REPOINT_PASSES = 25

export interface MergeContactsOptions {
  firestore: FirebaseFirestore.Firestore
  /** `orgs/{orgId}` — the org whose contacts both records are. */
  orgRef: FirebaseFirestore.DocumentReference
  /** The record that stays, and keeps its address as the identity. */
  survivorId: string
  /** The record folded in and deleted. */
  mergedId: string
  actor: { uid: string; email?: string | null }
  /**
   * The site whose console did the work: where the activity feed entry
   * lands, and the site a timeline note is filed under. `null` for a door
   * with no site — the REST API — which logs no host entry.
   */
  hostId: string | null
  /** The actor's display name for the timeline note, when the door knows it. */
  actorName?: string | null
}

export interface MergeContactsRepointed {
  deals: number
  tasks: number
  activities: number
  leads: number
}

export type MergeContactsResult =
  | {
      ok: true
      survivorId: string
      survivorEmail: string
      mergedId: string
      mergedEmail: string
      /** Every address the survivor answers to now, primary first. */
      emails: string[]
      repointed: MergeContactsRepointed
    }
  | { ok: false; reason: 'same-record' | 'survivor-missing' | 'merged-missing' }

/**
 * Point every row of `collection` whose `contactId` is `from` at `to`.
 *
 * Page, batch, repeat: each pass reads the rows still pointing at the
 * merged record — the ones a previous pass moved no longer match — so the
 * loop ends when a pass finds nothing. `updatedAt` moves with the pointer
 * because an integration syncing by `updatedAfter` has to see the change.
 */
async function repointContactId(
  firestore: FirebaseFirestore.Firestore,
  collection: FirebaseFirestore.CollectionReference,
  from: string,
  to: string,
): Promise<number> {
  let moved = 0
  for (let pass = 0; pass < REPOINT_PASSES; pass += 1) {
    const page = await collection
      .where('contactId', '==', from)
      .limit(REPOINT_PAGE)
      .get()
    if (page.empty) break
    const batch = firestore.batch()
    for (const row of page.docs) {
      batch.update(row.ref, {
        contactId: to,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
    moved += page.size
    if (page.size < REPOINT_PAGE) break
  }
  return moved
}

/**
 * The leads converted into the merged contact, restamped at the survivor.
 *
 * A lead lives at `hosts/{hostId}/leads/{personKey(email)}`, so there is no
 * query: each site that met either record is asked for a lead under each of
 * the merged record's addresses, and one that names the merged contact is
 * moved. Bounded by sites times addresses, both small.
 */
async function repointLeads(
  firestore: FirebaseFirestore.Firestore,
  hostIds: readonly string[],
  emails: readonly string[],
  from: string,
  to: string,
): Promise<number> {
  let moved = 0
  for (const hostId of hostIds) {
    for (const email of emails) {
      const key = personKey(email)
      if (!key) continue
      const leadRef = firestore
        .collection('hosts')
        .doc(hostId)
        .collection('leads')
        .doc(key)
      const lead = await leadRef.get()
      if (!lead.exists || lead.get('convertedContactId') !== from) continue
      await leadRef.update({
        convertedContactId: to,
        updatedAt: FieldValue.serverTimestamp(),
      })
      moved += 1
    }
  }
  return moved
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : []
}

export async function mergeContacts(
  options: MergeContactsOptions,
): Promise<MergeContactsResult> {
  const { firestore, orgRef, survivorId, mergedId, actor, hostId } = options
  if (!survivorId || !mergedId || survivorId === mergedId) {
    return { ok: false, reason: 'same-record' }
  }
  const contactsRef = orgRef.collection('contacts')
  const survivorRef = contactsRef.doc(survivorId)
  const mergedRef = contactsRef.doc(mergedId)
  const [survivorBefore, mergedBefore] = await Promise.all([
    survivorRef.get(),
    mergedRef.get(),
  ])
  if (!survivorBefore.exists) return { ok: false, reason: 'survivor-missing' }
  if (!mergedBefore.exists) return { ok: false, reason: 'merged-missing' }
  const mergedData = (mergedBefore.data() ?? {}) as Record<string, unknown>
  const survivorData = (survivorBefore.data() ?? {}) as Record<string, unknown>

  /*==========================================
   * 1. THE CHILDREN — before the parent, for the reason the header gives.
   *=========================================*/
  const [deals, tasks, activities] = await Promise.all([
    repointContactId(firestore, orgRef.collection(CRM_COLLECTIONS.deals), mergedId, survivorId),
    repointContactId(firestore, orgRef.collection(CRM_COLLECTIONS.tasks), mergedId, survivorId),
    repointContactId(
      firestore,
      orgRef.collection(CRM_COLLECTIONS.activities),
      mergedId,
      survivorId,
    ),
  ])
  const leadHosts = [
    ...new Set([
      ...strings(mergedData['capturedByHostIds']),
      ...strings(survivorData['capturedByHostIds']),
      ...strings([mergedData['hostId'], survivorData['hostId'], hostId]),
    ]),
  ]
  const leads = await repointLeads(
    firestore,
    leadHosts,
    contactEmails(mergedData),
    mergedId,
    survivorId,
  )

  /*==========================================
   * 2. THE SWAP — one transaction over both documents and the index.
   *=========================================*/
  const index = orgRef.collection(CONTACT_EMAIL_INDEX_COLLECTION)
  const swapped = await firestore.runTransaction(async (transaction) => {
    const [survivor, merged] = await Promise.all([
      transaction.get(survivorRef),
      transaction.get(mergedRef),
    ])
    if (!survivor.exists) return { reason: 'survivor-missing' as const }
    if (!merged.exists) return { reason: 'merged-missing' as const }
    const plan = planContactMerge(
      (survivor.data() ?? {}) as Record<string, unknown>,
      (merged.data() ?? {}) as Record<string, unknown>,
    )
    transaction.set(
      survivorRef,
      { ...plan.survivor, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    for (const email of plan.emails) {
      const key = personKey(email)
      if (!key) continue
      transaction.set(
        index.doc(key),
        { email, contactId: survivorId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    }
    transaction.delete(mergedRef)
    return { plan, survivor: (survivor.data() ?? {}) as Record<string, unknown> }
  })
  if ('reason' in swapped) return { ok: false, reason: swapped.reason }
  const { plan } = swapped

  /*
   * The companies both records named counted two people and now count one
   * (AGL-2613). Settled after the swap the way the capture settles its
   * counts: a figure that could not move is logged, and the company page's
   * live aggregate corrects it.
   */
  await settleCompanyContactsCounts(orgRef.collection(CRM_COLLECTIONS.companies), {
    companyId: null,
    mirror: null,
    counts: plan.companyCounts,
  })

  const mergedEmail = contactEmails(mergedData)[0] ?? ''
  const survivorEmail = plan.emails[0] ?? ''
  // The canonical name — the one identity every holder shares — for the
  // feed; the address stands in for a person nobody has named.
  const survivorName =
    typeof swapped.survivor['name'] === 'string' ? swapped.survivor['name'] : ''

  /*
   * THE TIMELINE NOTE, on the survivor: the merge is an event in this
   * person's history, and the record page is where a reader looks for one.
   * Filed under the calling site, or the survivor's first site for a door
   * with none; its own catch, because a note that could not be written must
   * not read as a merge that did not happen.
   */
  try {
    await orgRef.collection(CRM_COLLECTIONS.activities).add({
      kind: 'note',
      body: `Merged with ${mergedEmail}`,
      atMs: Date.now(),
      byUid: actor.uid,
      ...(options.actorName || actor.email
        ? { byName: options.actorName || actor.email }
        : {}),
      contactId: survivorId,
      visibleTo: plan.visibleTo,
      hostId: hostId ?? String(survivorData['hostId'] ?? ''),
      createdByUid: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    console.error('[contact-merge] timeline note failed', survivorId, error)
  }

  // The audit line (AGL-2622), in the feed of the site whose console did
  // the work. A door with no site — the API — has no host feed to write.
  if (hostId) {
    await logHostActivity(hostId, actor, `Merged with ${mergedEmail}`, {
      type: 'contact',
      id: survivorId,
      name: survivorName || survivorEmail,
    })
  }

  return {
    ok: true,
    survivorId,
    survivorEmail,
    mergedId,
    mergedEmail,
    emails: plan.emails,
    repointed: { deals, tasks, activities, leads },
  }
}
