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
  CRM_TASK_ROUTES,
  type CrmTaskCompleteRequest,
  type CrmTaskCompleteResponse,
  type CrmTaskSaveRequest,
  type CrmTaskSaveResponse,
  type CrmTasksCompleteRequest,
  type CrmTasksCompleteResponse,
  type CrmTasksSaveRequest,
  type CrmTasksSaveResponse,
  crmTaskRouteUrl,
} from './task-routes'

/**
 * The browser's side of the two task routes (AGL-2599).
 *
 * Both go through `authorizedFetch`, so a signed-out caller is answered with
 * the reason rather than a request that leaves without credentials. A
 * refused response becomes a thrown `Error` carrying the route's own
 * sentence, which is what the drawer and the checkbox put in the snackbar.
 */
async function post<T>(
  user: MaybeTokenSource,
  route: (typeof CRM_TASK_ROUTES)[keyof typeof CRM_TASK_ROUTES],
  body: unknown,
): Promise<T> {
  const response = await authorizedFetch(user, crmTaskRouteUrl(route), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
  }
  if (!response.ok) {
    throw new Error(
      payload?.error || `The request was refused (${response.status}).`,
    )
  }
  return payload as T
}

export function saveCrmTask(
  user: MaybeTokenSource,
  request: CrmTaskSaveRequest,
): Promise<CrmTaskSaveResponse> {
  return post<CrmTaskSaveResponse>(user, CRM_TASK_ROUTES.save, request)
}

export function completeCrmTask(
  user: MaybeTokenSource,
  request: CrmTaskCompleteRequest,
): Promise<CrmTaskCompleteResponse> {
  return post<CrmTaskCompleteResponse>(user, CRM_TASK_ROUTES.complete, request)
}

/**
 * The organization hub's batch forms (AGL-2637): one request per bulk
 * action, answered per task. A refused TASK is a row in `results`, not a
 * thrown error — only a refused REQUEST (no session, no reach, a body the
 * route would not read) throws.
 */
export function completeCrmTasks(
  user: MaybeTokenSource,
  request: CrmTasksCompleteRequest,
): Promise<CrmTasksCompleteResponse> {
  return post<CrmTasksCompleteResponse>(user, CRM_TASK_ROUTES.complete, request)
}

export function saveCrmTasks(
  user: MaybeTokenSource,
  request: CrmTasksSaveRequest,
): Promise<CrmTasksSaveResponse> {
  return post<CrmTasksSaveResponse>(user, CRM_TASK_ROUTES.save, request)
}
