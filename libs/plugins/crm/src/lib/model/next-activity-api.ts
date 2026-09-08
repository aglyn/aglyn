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
  CRM_NEXT_ACTIVITY_LINKS_MAX,
  type CrmNextActivityRequest,
  type CrmNextActivityResponse,
  crmNextActivityRouteUrl,
  nextActivityRequestLinks,
} from './next-activity'
import type { CrmTaskRouteScope } from './task-routes'

/**
 * The browser's side of the next-activity route (AGL-2661), through
 * `authorizedFetch` the way `task-api.ts` reaches the task routes.
 */
async function post(user: MaybeTokenSource, body: CrmNextActivityRequest): Promise<CrmNextActivityResponse> {
  const response = await authorizedFetch(user, crmNextActivityRouteUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) {
    throw new Error(payload?.error || `The request was refused (${response.status}).`)
  }
  return payload as CrmNextActivityResponse
}

/**
 * After a client-direct task write: recompute for the records the tasks
 * named. Never throws — see the header — and does nothing for a task that
 * names no record or a surface with no scope to call with.
 */
export async function refreshCrmNextActivity(
  user: MaybeTokenSource,
  scope: CrmTaskRouteScope | null,
  tasks: readonly { contactId?: string | null; companyId?: string | null; dealId?: string | null }[],
): Promise<void> {
  const links = nextActivityRequestLinks(tasks).filter((link) => Object.keys(link).length > 0)
  if (!scope || !links.length) return
  try {
    await post(user, { ...scope, links: links.slice(0, CRM_NEXT_ACTIVITY_LINKS_MAX) })
  } catch (error) {
    console.warn('[crm] next activity was not refreshed', error)
  }
}

/** The Fields section's maintenance action: the whole organization. Throws on refusal. */
export function recomputeAllCrmNextActivity(
  user: MaybeTokenSource,
  scope: CrmTaskRouteScope,
): Promise<CrmNextActivityResponse> {
  return post(user, { ...scope, all: true })
}
