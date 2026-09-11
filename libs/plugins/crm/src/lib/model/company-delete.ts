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
 * DELETING A COMPANY IS ONE REQUEST (AGL-2597; a route since AGL-2804, shared
 * by the record page and the bulk bar since AGL-2621).
 *
 * Firestore does not cascade, so a delete unlinks every contact at the
 * company before the company goes — and the unlink clears each holder's
 * facet that named it, which is the server's to write. `crm/company-delete`
 * runs the pass, bounded and honest past the bound; this module is the
 * console's side of it.
 */

import type { CrmApiResult, CrmApiRoute } from '../components/use-crm-api'
import type { CompanyDeleteOutcome } from './company-delete-route'

export { COMPANY_DETACH_LIMIT, type CompanyDeleteOutcome } from './company-delete-route'

/** The CRM API caller a surface already holds — `useCrmApi`'s. */
export type CrmApiCall = (
  route: CrmApiRoute,
  payload: Record<string, unknown>,
) => Promise<CrmApiResult>

/**
 * Delete one company through the route: the contacts unlinked, then the
 * company — or, past the bound, a pass's worth unlinked and the company left
 * standing. A refusal throws with the route's own sentence.
 */
export async function deleteCompanyThroughRoute(
  call: CrmApiCall,
  companyId: string,
): Promise<CompanyDeleteOutcome> {
  const { response, payload } = await call('company-delete', { companyId })
  if (!response.ok) {
    const error = payload['error']
    throw new Error(
      typeof error === 'string' && error
        ? error
        : `The company could not be deleted (${response.status}).`,
    )
  }
  return {
    deleted: payload['deleted'] === true,
    detached: Number(payload['detached'] ?? 0),
    moreRemain: payload['moreRemain'] === true,
  }
}

/**
 * What a failed delete says: the route's own sentence, which names the
 * reason — a member scoped to particular sites is told why they cannot.
 */
export function companyDeleteFailureMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'An error has occurred'
}
