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
 * THE ADDRESS INDEX (AGL-2625): `orgs/{orgId}/emailIndex/{personKey}`.
 *
 * `upsertHostContact` finds a person by `where('email', '==', …)` on the
 * contacts collection, and that query answers one document per address by
 * construction — which is exactly what stops a merged record's address from
 * ever finding the survivor. The survivor's `email` is the identity that
 * stayed; the merged address is in its `alternateEmails`, and Firestore
 * cannot answer "the document whose primary OR alternate address is X" as
 * one indexed query. So the address is indexed on its own: one document per
 * address, naming the contact it belongs to.
 *
 * ## Consulted first, never trusted alone
 *
 * The lookup reads the index entry and then the contact it names, and
 * takes the contact only if it still exists. A stale entry — a contact
 * detached and deleted after its entry was written — falls through to the
 * query, which is the truth the index only summarizes.
 *
 * ## Written lazily, never backfilled
 *
 * An entry is written when a capture CREATES a contact, and when a lookup
 * finds one through the query rather than the index — so every existing
 * contact gains an entry on its next write, and no job has to walk the
 * collection. A merge writes one entry per address the survivor answers to.
 *
 * ## Never in the way of a capture
 *
 * Every read and write here is wrapped: a form submission or an order must
 * succeed whatever the index did, exactly as the capture itself swallows
 * its own failures. An index that cannot be reached is a miss, and a miss
 * is the query.
 *
 * Imported by module path rather than through the `@aglyn/aglyn/server`
 * barrel, for the reason `upsert-contact.ts` gives: the door's specs
 * substitute a fixture barrel, and a helper that reached the normalizer only
 * through it would find `undefined` there.
 */

import {
  CONTACT_EMAIL_INDEX_COLLECTION,
  normalizeContactEmail,
} from '@aglyn/aglyn/app-utils/contacts'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { FieldValue } from 'firebase-admin/firestore'

/** One entry: the address as stored, and the contact it resolves to. */
export interface ContactEmailIndexEntry {
  email: string
  contactId: string
}

/**
 * The org's index collection, beside its contacts one — or `null` when the
 * handle has no parent, which is a fixture's contacts reference and never
 * a real org subcollection. `null` means "no index": the caller falls back
 * to the query and writes nothing.
 */
export function emailIndexBeside(
  contactsRef: FirebaseFirestore.CollectionReference,
): FirebaseFirestore.CollectionReference | null {
  try {
    const parent = contactsRef.parent
    return parent ? parent.collection(CONTACT_EMAIL_INDEX_COLLECTION) : null
  } catch {
    return null
  }
}

/**
 * Point every address in `emails` at `contactId`. Never rejects: an entry
 * that could not be written is one the next lookup writes again.
 */
export async function writeContactEmailIndex(
  index: FirebaseFirestore.CollectionReference | null,
  contactId: string,
  emails: readonly string[],
): Promise<void> {
  if (!index || !contactId) return
  await Promise.all(
    emails.map(async (raw) => {
      const email = normalizeContactEmail(raw)
      const key = email ? personKey(email) : null
      if (!email || !key) return
      const entry: ContactEmailIndexEntry & { updatedAt: unknown } = {
        email,
        contactId,
        updatedAt: FieldValue.serverTimestamp(),
      }
      await index.doc(key).set(entry, { merge: true })
    }),
  ).catch((error: unknown) => {
    console.error('[contact-email-index] write failed', contactId, error)
  })
}

/**
 * The contact an address belongs to, as a document snapshot — or `null`.
 *
 * The index first, then the per-document query it summarizes. A query hit
 * writes the entry the index lacked, so the read that paid for the miss is
 * the last one that has to.
 */
export async function findContactByEmail(
  contactsRef: FirebaseFirestore.CollectionReference,
  email: unknown,
): Promise<FirebaseFirestore.DocumentSnapshot | null> {
  const normalized = normalizeContactEmail(email)
  if (!normalized) return null
  const index = emailIndexBeside(contactsRef)
  const key = index ? personKey(normalized) : null
  if (index && key) {
    try {
      const entry = await index.doc(key).get()
      const contactId = entry.exists ? String(entry.get('contactId') ?? '') : ''
      if (contactId) {
        const contact = await contactsRef.doc(contactId).get()
        if (contact.exists) return contact
      }
    } catch (error) {
      console.error('[contact-email-index] lookup failed', error)
    }
  }
  const found = await contactsRef.where('email', '==', normalized).limit(1).get()
  if (found.empty) return null
  const hit = found.docs[0]
  await writeContactEmailIndex(index, hit.id, [normalized])
  return hit
}
