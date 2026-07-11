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
import { runEventActions } from './run-event-actions'
import {
  type HostEventPayload,
  runEventWorkflows,
} from './run-event-workflows'

/**
 * One emit point for host events (AGL-148): fans out to the workflow
 * runner (AGL-128) and the actions runner, returning any site alerts the
 * actions produced so request/response emitters (form submit, booking)
 * can surface them; fire-and-forget emitters ignore the result. Neither
 * runner throws into the emitting request.
 */
export async function emitHostEvent(
  hostId: string,
  event: HostEventType,
  payload: HostEventPayload = {},
): Promise<{ alerts: HostActionAlert[] }> {
  const [, alerts] = await Promise.all([
    runEventWorkflows(hostId, event, payload),
    runEventActions(hostId, event, payload),
  ])
  return { alerts }
}

export default emitHostEvent
