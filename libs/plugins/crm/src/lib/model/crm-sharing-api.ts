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
  authorizedFetch,
  type MaybeTokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import {
  CRM_SHARING_IDS_MAX,
  type CrmSharingAction,
  type CrmSharingObject,
  type CrmSharingResponse,
  crmSharingRouteUrl,
} from './crm-sharing'
import type { CrmTaskRouteScope } from './task-routes'

/**
 * One call to `crm/sharing` (AGL-3336). Answers the route's body, or throws
 * with the route's own sentence so a snackbar can say it.
 */
export async function callCrmSharing(
  user: MaybeTokenSource,
  scope: CrmTaskRouteScope,
  action: CrmSharingAction,
  body: Record<string, unknown> = {},
): Promise<CrmSharingResponse> {
  const response = await authorizedFetch(user, crmSharingRouteUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...scope, ...body, action }),
  })
  const answer = (await response.json().catch(() => ({}))) as Partial<CrmSharingResponse> & {
    error?: string
  }
  if (!response.ok || answer.ok !== true) {
    throw new Error(answer.error || 'The sharing could not be saved.')
  }
  return answer as CrmSharingResponse
}

/**
 * What a CLIENT-DIRECT write to a lead, a company or a deal owes the org's
 * sharing rules: the server writers are followed by the core's
 * record-written seam, and a browser that wrote the record itself asks for
 * the same re-evaluation here. Never throws, and never holds the save — the
 * record is written whether or not a rule then shares it.
 */
export async function followUpCrmSharing(
  user: MaybeTokenSource,
  scope: CrmTaskRouteScope | null,
  object: CrmSharingObject,
  ids: readonly string[],
): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, CRM_SHARING_IDS_MAX)
  if (!scope || !unique.length) return
  try {
    await callCrmSharing(user, scope, 'evaluate', { object, ids: unique })
  } catch (error) {
    console.warn('[crm] sharing rules were not re-evaluated', error)
  }
}
