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
 * The only writer of `orgs/{orgId}/lists/{listId}/members` (AGL-2499).
 *
 * Two enrollment routes reach this collection — the commerce newsletter
 * handler and the workflow `enrollList` step — and they used to derive the
 * document id two incompatible ways: a full `sha256(email)` on one side, a
 * `hmac('aglyn-list-member', email)` truncated to 20 hex on the other. The
 * same person subscribing by both routes became two members of one list.
 *
 * The id is now `personKey` on both, which is the derivation both
 * `docs/specs/email-overhaul.md` §3d and `docs/specs/reusable-forms.md` §4
 * specify, and it normalizes before hashing so casing cannot fork it either.
 *
 * ## Why a helper and not two corrected call sites
 *
 * Two call sites that merely agree today are what produced the split: nothing
 * about either one said the other existed. A third route — the reusable-forms
 * capture path is already specified — would have been written the same way.
 * Enrolling goes through this function so that the id has one definition and
 * no caller is offered the chance to derive its own.
 */

import type { DocumentReference } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { normalizeContactEmail, personKey } from '@aglyn/aglyn/server'
import { createHash, createHmac } from 'node:crypto'

/**
 * The two ids this collection was written under before `personKey`.
 *
 * Read-only, and never written for a new row: they exist so an address
 * already enrolled under a legacy id is *found* rather than duplicated. See
 * `enrollListMember` for why that lookup is the migration.
 *
 * Both take the normalized address, which is what the two original call sites
 * happened to pass — each lowercased at its own entry point before hashing, so
 * every row already on the collection was keyed from a lowercased address even
 * though neither derivation enforced it.
 */
function legacyListMemberIds(normalizedEmail: string): string[] {
  return [
    createHash('sha256').update(normalizedEmail).digest('hex'),
    createHmac('sha256', 'aglyn-list-member')
      .update(normalizedEmail)
      .digest('hex')
      .slice(0, 20),
  ]
}

export interface EnrollListMemberInput {
  /** `orgs/{orgId}/lists/{listId}` — the caller has already proved it exists. */
  listRef: DocumentReference
  email: string
  name?: string
  /** Free-form provenance: `'newsletter'`, `'action:{actionId}'`. */
  source: string
}

export interface EnrolledListMember {
  /** The document actually written — a legacy id when one was adopted. */
  memberId: string
  /** True when an existing legacy-keyed row was written instead of a new one. */
  adopted: boolean
  /** False when the row already existed under some id. */
  created: boolean
}

/**
 * Enrolls one address into a list, at one document per person.
 *
 * ## The legacy lookup is the migration
 *
 * Changing the derivation without one would strand every row written under the
 * old ids: the next enrollment of an address already on the list would key a
 * *new* document beside the old one, so a defect that produced duplicates only
 * when two routes met would start producing them on a single route. Rather
 * than rewrite those ids — a bulk operation that has to delete the row it
 * replaces, and deleting an enrollment destroys the consent record that says
 * the person asked to be there — the write resolves the person's existing
 * document and keeps using it.
 *
 * The cost is one `getAll` of three refs, on a human-triggered signup, in
 * place of the blind `set` this replaced. It is one round trip, not three.
 *
 * `addedAt` is stamped only when the document is created, so re-enrolling
 * keeps the date the person actually joined — the same "earliest wins" collapse
 * `docs/specs/email-overhaul.md` §3d asks a backfill to preserve.
 *
 * @returns `null` when the address is unusable — the caller has nothing to
 *          write and nothing to fix.
 */
export async function enrollListMember(
  input: EnrollListMemberInput,
): Promise<EnrolledListMember | null> {
  const email = normalizeContactEmail(input.email)
  if (!email) return null
  const key = personKey(email)
  if (!key) return null

  const members = input.listRef.collection('members')
  const canonicalRef = members.doc(key)
  const legacyRefs = legacyListMemberIds(email)
    // A legacy derivation that happens to agree with `personKey` — `sha256` of
    // the same normalized address does — must not be fetched twice: `getAll`
    // rejects duplicate references.
    .filter((id) => id !== key)
    .map((id) => members.doc(id))

  const snapshots = await input.listRef.firestore.getAll(
    canonicalRef,
    ...legacyRefs,
  )
  const existing = snapshots.find((snapshot) => snapshot.exists)
  const target = existing?.ref ?? canonicalRef

  await target.set(
    {
      email,
      ...(input.name ? { name: input.name } : {}),
      source: input.source,
      ...(existing ? {} : { addedAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  )

  return {
    memberId: target.id,
    adopted: target.id !== key,
    created: !existing,
  }
}
