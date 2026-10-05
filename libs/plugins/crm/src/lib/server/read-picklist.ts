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

import {
  CRM_COLLECTIONS,
  CRM_TASK_PICKLIST_IDS,
  type CrmPicklist,
  type CrmPicklistId,
  type CrmTaskPicklists,
  crmPicklistDefaultLabel,
  effectiveCrmPicklist,
  effectiveCrmTaskPicklists,
  judgeCrmPicklistValue,
} from '@aglyn/aglyn/server'

/** An org's list for one picklist as every server door judges against it (AGL-3510). */
export async function readCrmPicklist(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  id: CrmPicklistId,
): Promise<CrmPicklist> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(CRM_COLLECTIONS.picklists)
    .doc(id)
    .get()
  return effectiveCrmPicklist(id, snapshot.data())
}

/** An org's Status, Priority and Type lists for tasks (AGL-3517), the three read together. */
export async function readCrmTaskPicklists(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<CrmTaskPicklists> {
  const lists = firestore.collection('orgs').doc(orgId).collection(CRM_COLLECTIONS.picklists)
  const [status, priority, type] = await Promise.all([
    lists.doc(CRM_TASK_PICKLIST_IDS.status).get(),
    lists.doc(CRM_TASK_PICKLIST_IDS.priority).get(),
    lists.doc(CRM_TASK_PICKLIST_IDS.type).get(),
  ])
  return effectiveCrmTaskPicklists({
    status: status?.data(),
    priority: priority?.data(),
    type: type?.data(),
  })
}

/**
 * What a record write stores under picklist `id`, from what the request
 * said about the field:
 *
 *  - `undefined` (not named): nothing — except on a CREATE, which starts
 *    from the list's default when it has one, as Salesforce's does.
 *  - `null` (cleared): the clear.
 *  - a label: {@link judgeCrmPicklistValue} — an active value's label, the
 *    record's own current value kept, and on a restricted picklist anything
 *    else refused naming the values the list allows.
 *
 * `write` undefined means leave the field alone.
 */
export function resolveCrmPicklistWrite(
  id: CrmPicklistId,
  picklist: CrmPicklist,
  requested: string | null | undefined,
  options: { current?: unknown; created: boolean },
): { ok: true; write: string | null | undefined } | { ok: false; error: string } {
  if (requested === undefined) {
    const fallback = options.created ? crmPicklistDefaultLabel(picklist) : null
    return { ok: true, write: fallback ?? undefined }
  }
  if (requested === null) return { ok: true, write: null }
  const judged = judgeCrmPicklistValue(id, picklist, requested, options.current)
  return judged.ok === false ? judged : { ok: true, write: judged.value }
}
