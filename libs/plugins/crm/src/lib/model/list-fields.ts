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

import type { CrmListCollection } from '@aglyn/aglyn'
import type { CrmTaskRouteScope } from './task-routes'

/**
 * The contract between the console and the plugin's list-fields route
 * (AGL-3321), the door a CLIENT-DIRECT write uses to keep the fields a CRM
 * list queries honest.
 *
 * Those fields — the search tokens, a contact's facet keys — are derived
 * from the record (`crmListFields` in `@aglyn/aglyn`). A client that
 * creates a record, or edits one from the listener's copy, stamps them
 * itself. A write the browser may not follow up — a holder letting go of a
 * contact, which the rules narrow to removing its own half — asks this
 * route to read the record back and restamp it. Best effort, like the
 * next-activity route beside it: the write already happened.
 */
export const CRM_LIST_FIELDS_ROUTE = 'crm/list-fields' as const

export const crmListFieldsRouteUrl = (): string => `/api/${CRM_LIST_FIELDS_ROUTE}`

/** The most records one request restamps — the bulk bar's own window. */
export const CRM_LIST_FIELDS_IDS_MAX = 200

/** The collections the route restamps. */
export const CRM_LIST_FIELDS_COLLECTIONS: readonly CrmListCollection[] = [
  'leads',
  'contacts',
  'companies',
  'deals',
  'crmTasks',
]

export type CrmListFieldsRequest = CrmTaskRouteScope & {
  collection: CrmListCollection
  ids: string[]
}

export interface CrmListFieldsResponse {
  ok: true
  restamped: number
  current: number
  missing: number
}
