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

import type { HostActionStepType } from '@aglyn/aglyn/app-utils/actions'

/**
 * Past-tense phrases for a run summary (AGL-2171).
 *
 * `HOST_ACTION_STEP_LABELS` (core `actions.ts`) names what a step WILL do, in the
 * imperative, for a `Do` select — "Send an email". A run history is the
 * opposite tense and a different audience: it says what already happened,
 * on one line, several steps at a time. `/product/workflows` advertises
 * exactly that shape — `Sent email · saved to Leads · webhook 200`.
 *
 * Two maps rather than one derived from the other, because "Send a webhook
 * (Business)" cannot be mechanically turned into "webhook" — the plan
 * suffix is part of the picker's label and has no business in a log line.
 * Only the steps a SERVER run can perform appear here; the client-side
 * steps run in the visitor's browser and never reach the activity write.
 */
export const HOST_ACTION_STEP_OUTCOMES: Partial<
  Record<HostActionStepType, string>
> = {
  runWorkflow: 'ran workflow',
  siteAlert: 'showed an alert',
  customEvent: 'fired an event',
  datasetAppend: 'saved to dataset',
  updateDataset: 'updated dataset',
  webhookPost: 'webhook',
  sendEmail: 'sent email',
  notifyAdmins: 'notified admins',
  enrollList: 'enrolled in list',
  assignCampaign: 'assigned to campaign',
  wait: 'waiting',
  waitForEvent: 'waiting for',
  exitFlow: 'ended the flow',
  setContactStage: 'set stage',
  addContactTag: 'tagged',
  assignContactOwner: 'assigned owner',
  createCrmTask: 'created task',
  logCrmActivity: 'logged activity',
}

/**
 * One step's line in a run summary, with the detail that makes it useful.
 *
 * `saved to Leads` beats `saved to dataset`, and `webhook 200` beats
 * `webhook` — the status code is the entire reason anyone opens a run
 * history after a webhook, and it was being discarded on the line it
 * arrived.
 */
export function describeStepOutcome(
  type: HostActionStepType,
  detail?: string,
): string {
  const base = HOST_ACTION_STEP_OUTCOMES[type] ?? String(type)
  const trimmed = detail?.trim()
  if (!trimmed) return base
  if (type === 'datasetAppend' || type === 'updateDataset') {
    // `saved to dataset` + `Leads` reads as `saved to Leads`, not
    // `saved to dataset Leads`.
    return `${base.replace(/ dataset$/, '')} ${trimmed}`
  }
  return `${base} ${trimmed}`
}
