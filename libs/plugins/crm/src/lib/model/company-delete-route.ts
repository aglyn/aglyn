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
 * `crm/company-delete`'s contract (AGL-2804), in one module both halves
 * import.
 *
 * Deleting a company unlinks every contact that names it before the company
 * goes: the id leaves each contact's `companyIds` mirror, and every holder's
 * facet that named it is cleared. A facet is the server's to write, so the
 * pass runs in the route rather than in the browser — bounded, and honest
 * past the bound.
 */

/**
 * How many contacts one delete pass detaches: a batch's worth, one update per
 * contact. A company past this many links is detached in passes and stands
 * until the last one, so no contact is ever left naming a record that is gone.
 */
export const COMPANY_DETACH_LIMIT = 500

export interface CompanyDeleteOutcome {
  /** The document is gone. False when a pass detached and more remain. */
  deleted: boolean
  /** How many contacts this pass unlinked. */
  detached: number
  /** The pass hit its bound; the company stands until the next delete. */
  moreRemain: boolean
}

export interface CompanyDeleteResponse extends CompanyDeleteOutcome {
  ok: true
}
