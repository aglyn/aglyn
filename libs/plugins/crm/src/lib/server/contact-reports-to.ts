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

import { contactFacetPath, readContactFacet } from '@aglyn/aglyn/app-utils/contacts'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * A CONTACT'S REPORTS-TO (AGL-3515): Salesforce's Reports To, the person's
 * manager, as another contact's id in the holder's facet.
 *
 * The pointer is per holder like the rest of the profile, so a chain is
 * walked through ONE holder's facets: who reports to whom is one business's
 * knowledge of an org chart, and another holder's guess at it is not part
 * of this one's chain.
 */

/** The longest chain a loop check walks — far past any real org chart. */
export const CONTACT_REPORTS_TO_DEPTH = 25

export const CONTACT_REPORTS_TO_SELF_REFUSAL = 'A contact cannot report to themselves.'

export const CONTACT_REPORTS_TO_LOOP_REFUSAL =
  'That would make a loop: the person picked already reports, through others, to this contact.'

/** A contact document by id, or `null` when there is none. */
export type ContactReader = (contactId: string) => Promise<Record<string, unknown> | null>

/**
 * Whether making `contactId` report to `managerId` closes a loop: the
 * manager's own chain, through `groupId`'s facets, reaches `contactId`.
 * A chain longer than {@link CONTACT_REPORTS_TO_DEPTH} is treated as a loop,
 * because a walk that cannot finish cannot prove there is none.
 */
export async function contactReportsToLoops(
  read: ContactReader,
  contactId: string,
  managerId: string,
  groupId: string,
): Promise<boolean> {
  let current: string | undefined = managerId
  const seen = new Set<string>()
  for (let step = 0; current && step < CONTACT_REPORTS_TO_DEPTH; step += 1) {
    if (current === contactId) return true
    // A loop above the contact that does not pass through it is someone
    // else's to untangle, and does not stop this write.
    if (seen.has(current)) return false
    seen.add(current)
    const doc = await read(current)
    if (!doc) return false
    current = readContactFacet(doc, groupId).reportsToContactId || undefined
  }
  return Boolean(current)
}

/** A reader over one org's contacts that reads each document once. */
export function cachedContactReader(
  contacts: FirebaseFirestore.CollectionReference,
): ContactReader {
  const cache = new Map<string, Promise<Record<string, unknown> | null>>()
  return (contactId) => {
    let pending = cache.get(contactId)
    if (!pending) {
      pending = contacts
        .doc(contactId)
        .get()
        .then((snapshot) =>
          snapshot.exists ? ((snapshot.data() ?? {}) as Record<string, unknown>) : null,
        )
      cache.set(contactId, pending)
    }
    return pending
  }
}

/** How many pointing rows one pass reads and one batch writes. */
const PAGE = 400
/** A ceiling on passes per holder. */
const PASSES = 25

/**
 * Every contact that reports to `from`, in any of `groupIds`' facets,
 * pointed at `to` — or, with `to` null, cleared. A contact that would
 * then report to itself is cleared instead. Answers how many pointers moved.
 *
 * Queried per holder, because the pointer lives at
 * `facets.{groupId}.reportsToContactId` and a query names one path. Each
 * failure is logged and the sweep goes on: a stale pointer is read as
 * "nobody" by every surface, which is the safe way for one to be left.
 */
export async function repointContactReportsTo(
  firestore: FirebaseFirestore.Firestore,
  contacts: FirebaseFirestore.CollectionReference,
  groupIds: Iterable<string>,
  from: string,
  to: string | null,
  label: string,
): Promise<number> {
  let moved = 0
  for (const groupId of new Set(groupIds)) {
    if (!groupId) continue
    const path = contactFacetPath(groupId, 'reportsToContactId')
    try {
      for (let pass = 0; pass < PASSES; pass += 1) {
        const page = await contacts.where(path, '==', from).limit(PAGE).get()
        if (page.empty) break
        const batch = firestore.batch()
        for (const row of page.docs) {
          batch.update(row.ref, {
            [path]: to && row.id !== to ? to : FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
        await batch.commit()
        moved += page.size
        if (page.size < PAGE) break
      }
    } catch (error) {
      console.error(`${label}: reports-to sweep failed for a holder`, error)
    }
  }
  return moved
}
