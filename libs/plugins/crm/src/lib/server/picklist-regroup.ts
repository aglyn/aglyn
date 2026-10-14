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

// Modules by their own paths, never the `@aglyn/aglyn` barrel: the CRM's
// setup writers (AGL-3756) reach this file as well as the picklist route.
import {
  type CrmPicklist,
  type CrmPicklistTarget,
  crmPicklistKey,
  crmPicklistValueByLabel,
} from '@aglyn/aglyn/app-utils/crm'
import { FieldPath } from 'firebase-admin/firestore'

/** Writes per batch — under Firestore's 500, with room to spare. */
const BATCH_SIZE = 400

/** The group a label is filed under in `picklist` — `null` for none, or a label it does not hold. */
export function picklistGroupOf(picklist: CrmPicklist, label: string | null): string | null {
  return (label === null ? null : crmPicklistValueByLabel(picklist, label)?.group) ?? null
}

/**
 * Rewrite a target's GROUP field (AGL-3577) — a lead's
 * `leadSourceDirection` — on every record holding `label` in any spelling
 * (by its `keyField`) whose group is not `group` already. Answers how many
 * were written. The field is derived, like the list keys a restamp writes,
 * so `updatedAt` is left alone.
 *
 * Paged by document id rather than re-run: a record already holding the
 * group stays in the query's answer.
 */
export async function regroupEverywhere(
  firestore: FirebaseFirestore.Firestore,
  records: FirebaseFirestore.CollectionReference,
  target: CrmPicklistTarget,
  label: string,
  group: string | null,
): Promise<number> {
  const key = crmPicklistKey(label)
  if (!key || !target.keyField || !target.groupField) return 0
  const query = records
    .where(target.keyField, '==', key)
    .orderBy(FieldPath.documentId())
    .limit(BATCH_SIZE)
  let written = 0
  let after: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    const page: FirebaseFirestore.QuerySnapshot = await (after ? query.startAfter(after) : query).get()
    if (page.empty) return written
    const batch = firestore.batch()
    let changed = 0
    for (const snapshot of page.docs) {
      if (snapshot.get(target.groupField) === group) continue
      batch.update(snapshot.ref, { [target.groupField]: group })
      changed += 1
    }
    if (changed) await batch.commit()
    written += changed
    if (page.size < BATCH_SIZE) return written
    after = page.docs[page.docs.length - 1] ?? null
  }
}
