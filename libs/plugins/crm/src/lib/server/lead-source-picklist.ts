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
  CRM_LEAD_SOURCE_PICKLIST,
  type CrmPicklist,
  crmPicklistDefaultLabel,
  effectiveCrmLeadSourcePicklist,
  judgeCrmLeadSource,
} from '@aglyn/aglyn/server'

/** The org's lead source list as every server door judges against it (AGL-3298). */
export async function readLeadSourcePicklist(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<CrmPicklist> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(CRM_COLLECTIONS.picklists)
    .doc(CRM_LEAD_SOURCE_PICKLIST)
    .get()
  return effectiveCrmLeadSourcePicklist(snapshot.data())
}

/**
 * What a lead write stores as its lead source (AGL-3298), from what the
 * request said about it:
 *
 *  - `undefined` (not named): nothing — except on a CREATE, which starts
 *    from the list's default when it has one, as Salesforce's does.
 *  - `null` (cleared): the clear.
 *  - a label: {@link judgeCrmLeadSource} — an active value's label, the
 *    record's own current value kept, anything else refused naming the
 *    values the list allows.
 *
 * `write` undefined means leave the field alone.
 */
export function resolveLeadSourceWrite(
  picklist: CrmPicklist,
  requested: string | null | undefined,
  options: { current?: unknown; created: boolean },
): { ok: true; write: string | null | undefined } | { ok: false; error: string } {
  if (requested === undefined) {
    const fallback = options.created ? crmPicklistDefaultLabel(picklist) : null
    return { ok: true, write: fallback ?? undefined }
  }
  if (requested === null) return { ok: true, write: null }
  const judged = judgeCrmLeadSource(picklist, requested, options.current)
  return judged.ok === false ? judged : { ok: true, write: judged.value }
}
