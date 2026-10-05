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

import { CRM_LEAD_SOURCE_PICKLIST, type CrmPicklist } from '@aglyn/aglyn/server'
import { readCrmPicklist, resolveCrmPicklistWrite } from './read-picklist'

/** The org's lead source list as every server door judges against it (AGL-3298). */
export function readLeadSourcePicklist(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<CrmPicklist> {
  return readCrmPicklist(firestore, orgId, CRM_LEAD_SOURCE_PICKLIST)
}

/** What a lead write stores as its lead source — {@link resolveCrmPicklistWrite} for it. */
export function resolveLeadSourceWrite(
  picklist: CrmPicklist,
  requested: string | null | undefined,
  options: { current?: unknown; created: boolean },
): { ok: true; write: string | null | undefined } | { ok: false; error: string } {
  return resolveCrmPicklistWrite(CRM_LEAD_SOURCE_PICKLIST, picklist, requested, options)
}
