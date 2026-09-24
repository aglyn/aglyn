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

import type {
  PluginPersonEraser,
  PluginPersonErasureReport,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { OUTREACH_ENROLLMENT_HISTORY } from '../model/outreach.types'
import { outreachDoNotContactCollection } from '../storage/do-not-contact-store'
import { outreachOrgCollection } from '../storage/outreach-records'

/**
 * OUTREACH'S SHARE OF A PERSON ERASURE (AGL-2981).
 *
 * The person's ENROLLMENTS go: each names them — their address, their
 * contact, the personal line a rep wrote about them, the attestations — and
 * is about them. They are found by the address and by the contacts the
 * erasure is deleting, and deleted whatever their status. Each one's
 * HISTORY (AGL-3332) — every link they followed, and when — goes first: a
 * subcollection outlives the document above it, and would otherwise be a
 * record of an erased person's clicks that nothing lists.
 *
 * Their DO-NOT-CONTACT entry STAYS, on the rule every suppression list
 * follows through an erasure: it is keyed by `personKey`, carries no
 * address, and is the one promise the workspace made the person that has to
 * outlive their data. What in it could point back at them is cleared: the
 * detail — a member's note, a bounce's diagnostic — and the enrollment it
 * came from, which no longer exists.
 *
 * The DOMAIN list (`outreachDoNotContactDomains`, AGL-3244) is not touched:
 * a domain names a company, not a person, and an entry there carries the
 * bounce's diagnostic already scrubbed of the address it named.
 *
 * A dry run counts both and writes nothing.
 */

type Firestore = FirebaseFirestore.Firestore

/** Firestore refuses a batch of more than 500 writes. */
const BATCH_LIMIT = 450

/** `in` takes this many values at most. */
const IN_LIMIT = 30

export function createOutreachPersonEraser(deps: { firestore(): Firestore }): PluginPersonEraser {
  return async ({ orgId, email, key, contactIds, dryRun }): Promise<PluginPersonErasureReport> => {
    const firestore = deps.firestore()
    const enrollments = outreachOrgCollection(firestore, orgId, 'enrollments')
    const found = new Map<string, FirebaseFirestore.DocumentReference>()
    for (const doc of (await enrollments.where('email', '==', email).get()).docs) found.set(doc.id, doc.ref)
    for (let start = 0; start < contactIds.length; start += IN_LIMIT) {
      const chunk = contactIds.slice(start, start + IN_LIMIT)
      for (const doc of (await enrollments.where('contactId', 'in', chunk).get()).docs) found.set(doc.id, doc.ref)
    }
    const entry = outreachDoNotContactCollection(firestore, orgId).doc(key)
    const listed = (await entry.get()).exists
    if (dryRun) return { enrollments: found.size, doNotContactKept: listed, doNotContactScrubbed: null }

    const enrollmentRefs = [...found.values()]
    const historyRefs: FirebaseFirestore.DocumentReference[] = []
    for (const ref of enrollmentRefs) {
      for (const row of (await ref.collection(OUTREACH_ENROLLMENT_HISTORY).get()).docs) historyRefs.push(row.ref)
    }
    // The rows before the enrollments, so a run cut short leaves a history
    // under a live enrollment rather than one under nothing.
    const refs = [...historyRefs, ...enrollmentRefs]
    for (let start = 0; start < refs.length; start += BATCH_LIMIT) {
      const batch = firestore.batch()
      for (const ref of refs.slice(start, start + BATCH_LIMIT)) batch.delete(ref)
      await batch.commit()
    }
    if (listed) await entry.update({ detail: null, enrollmentId: null })
    return { enrollments: enrollmentRefs.length, doNotContactKept: listed, doNotContactScrubbed: listed }
  }
}
