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

import { hostEventLabel } from '@aglyn/aglyn/app-utils/host-events'

/**
 * What a person reads for a run line the engine files in a site's activity
 * (AGL-3892). The engine writes prose, not a code, such as
 * `Action ran on formSubmission`, `Workflow failed on booking: …` or
 * `Action is waiting, on lead`, and the event inside it is a key. The feed shows the act and
 * the event in words: `Automation ran: Form submitted`.
 *
 * `undefined` for any other action, so the activity seam leaves it alone.
 */
export function describeAutomationRunAction(action: string): string | undefined {
  const match =
    /^(Action|Org automation|Workflow) (ran|skipped|failed|is waiting,) on ([A-Za-z][\w.:-]*?)(?:(?: with errors)?:\s.*| with errors:.*)?$/.exec(
      action.trim(),
    )
  if (!match) return undefined
  const [, actor, verb, event] = match
  const failed = verb === 'failed' || / with errors:/.test(action)
  const who = actor === 'Action' ? 'Automation' : actor
  const what = failed
    ? 'failed'
    : verb === 'skipped'
      ? 'skipped'
      : verb === 'is waiting,'
        ? 'is waiting'
        : 'ran'
  return `${who} ${what}: ${hostEventLabel(event)}`
}
