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
import {
  authorizedFetch,
  type MaybeTokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import {
  CRM_LIST_FIELDS_IDS_MAX,
  type CrmListFieldsRequest,
  crmListFieldsRouteUrl,
} from './list-fields'
import type { CrmTaskRouteScope } from './task-routes'

/**
 * After a client-direct write the browser cannot follow up itself: ask the
 * list-fields route to restamp the records (AGL-3321). Never throws — the
 * write already happened, and a record left stale is what the backfill and
 * the next write bring level.
 */
export async function restampCrmListFields(
  user: MaybeTokenSource,
  scope: CrmTaskRouteScope | null,
  collection: CrmListCollection,
  ids: readonly string[],
): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, CRM_LIST_FIELDS_IDS_MAX)
  if (!scope || !unique.length) return
  const body: CrmListFieldsRequest = { ...scope, collection, ids: unique }
  try {
    const response = await authorizedFetch(user, crmListFieldsRouteUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) console.warn('[crm] list fields were not restamped', response.status)
  } catch (error) {
    console.warn('[crm] list fields were not restamped', error)
  }
}
