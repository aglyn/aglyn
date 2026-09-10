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
 * WHAT A DROPPED CRM ACTIVITY LINE DOES INSTEAD OF NOTHING (AGL-2738).
 *
 * Every CRM feed append is fire-and-forget on both sides of the hub — an
 * audit miss must never turn a finished save into a failed one, and a
 * snackbar about the LOG is a worse answer to "your record saved" than
 * silence. But a line that can only fail silently is a feature that stays
 * broken for months without a single signal, so a drop leaves by the two
 * doors `useHostActivityLogger` already opens for a refused client-direct
 * append, and for the same reasons: the beacon reaches Cloud Error
 * Reporting and dedupes a failure that repeats on every edit into one
 * report, and the console line fires once for whoever has devtools open.
 *
 * A module of its own, and not a hook: the bulk bars' hook and the record
 * surfaces' both report through it, and only one of them has any business
 * pulling in the tenant runtime.
 */

import { reportHandledError } from '@aglyn/aglyn/app-utils/error-beacon'

/** One console line per session, however many lines are dropped. */
let announced = false

export function reportDroppedActivityLine(error: unknown): void {
  reportHandledError(error, { kind: 'crm-activity-write' })
  if (announced) return
  announced = true
  console.error(
    'CRM activity logging failed; lines from this session are being dropped.',
    error,
  )
}

/**
 * A refusal the route ANSWERED rather than threw.
 *
 * `authorizedFetch` resolves for a 403 as readily as for a 200, so a line
 * the route declined to write comes back through the success path. Turning
 * it into an error is what puts it on the same reporting road as a network
 * failure — without this, the one outcome the reporting exists to catch is
 * the one that leaves no trace.
 */
export function orgActivityRefusal(
  status: number,
  payload: Record<string, unknown>,
): Error {
  const said = String(payload['error'] ?? '').slice(0, 200)
  return new Error(
    `crm/org-activity refused the line (${status})${said ? `: ${said}` : ''}`,
  )
}
