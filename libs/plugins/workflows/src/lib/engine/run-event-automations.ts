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

import type { HostActionAlert, HostEventType } from '@aglyn/aglyn/server'
import type { HostEventPayload } from '@aglyn/tenant-runtime/host-event-listeners'
import { runEventActions } from './run-event-actions'
import { runEventWorkflows } from './run-event-workflows'

/**
 * Everything the automation engine runs for one host event: the workflows
 * triggered by it and the actions, side by side, with the site alerts they
 * produced for the visitor — the actions' first, then those a workflow's
 * `siteAlert` step raised. What the runtime's host-event listener calls.
 *
 * Never rejects, because neither runner does: each catches and logs its own
 * failure so the event that has already happened is not refused for it.
 */
export async function runEventAutomations(
  hostId: string,
  event: string,
  payload: HostEventPayload = {},
): Promise<HostActionAlert[]> {
  const [fromWorkflows, fromActions] = await Promise.all([
    runEventWorkflows(hostId, event as HostEventType, payload),
    runEventActions(hostId, event, payload),
  ])
  return [...fromActions, ...fromWorkflows]
}
