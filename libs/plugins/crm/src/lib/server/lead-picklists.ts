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
  CRM_LEAD_PICKLIST_FIELDS,
  type CrmLeadPicklistField,
  type CrmLeadProfilePatch,
  type CrmPicklist,
  type CrmPicklistId,
  judgeCrmLeadPicklists,
} from '@aglyn/aglyn/server'
import { readCrmPicklist } from './read-picklist'

/**
 * The org's lists behind a lead's Salutation, Industry and Rating
 * (AGL-3513), read together — one document each.
 */
export async function readLeadPicklists(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<Partial<Record<CrmPicklistId, CrmPicklist>>> {
  const ids = CRM_LEAD_PICKLIST_FIELDS.map((entry) => entry.picklistId)
  const lists = await Promise.all(ids.map((id) => readCrmPicklist(firestore, orgId, id)))
  return Object.fromEntries(ids.map((id, at) => [id, lists[at]]))
}

/** Whether a profile names a lead picklist field, so a write that names none reads no list. */
export function namesLeadPicklist(patch: Readonly<CrmLeadProfilePatch>): boolean {
  return CRM_LEAD_PICKLIST_FIELDS.some((entry) => patch[entry.field] !== undefined)
}

/**
 * A profile's Salutation, Industry and Rating judged against the org's
 * lists, IN PLACE: each value the list allows is stored as the list spells
 * it, the lead's `current` value is kept, and on a create a field not named
 * starts from its list's default. Answers the refusal of each value the
 * list does not hold, by field — every write door of a lead runs it.
 */
export function judgeLeadPicklistPatch(
  lists: Readonly<Partial<Record<CrmPicklistId, CrmPicklist>>>,
  patch: CrmLeadProfilePatch,
  options: { current?: Readonly<Record<string, unknown>> | null; created?: boolean } = {},
): Partial<Record<CrmLeadPicklistField, string>> {
  const requested: Partial<Record<string, unknown>> = {}
  for (const { field } of CRM_LEAD_PICKLIST_FIELDS) {
    if (patch[field] !== undefined) requested[field] = patch[field]
  }
  const judged = judgeCrmLeadPicklists(lists, requested, options)
  for (const { field } of CRM_LEAD_PICKLIST_FIELDS) {
    if (judged.errors[field]) continue
    if (field in judged.values) patch[field] = judged.values[field] ?? null
  }
  return judged.errors
}
