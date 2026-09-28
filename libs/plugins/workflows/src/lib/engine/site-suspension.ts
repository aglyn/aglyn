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
  type LockdownState,
  lockdownMode,
  siteLockdownFromDocs,
} from '@aglyn/aglyn/server'

/**
 * The FULL lock that stops an event-triggered run on this site, or null
 * (AGL-3356).
 *
 * An event run has no caller the dispatcher could refuse: a form submission,
 * a page view, a paid order or an inbound webhook fires it, and the run
 * mails, writes and calls out on the site's behalf. The incident behind this
 * was a workspace locked for phishing whose `contactCreated` workflow could
 * still send, so the engine asks before it runs anything.
 *
 * FULL locks only, for the reason the sending identity gives: an event run is
 * not resumable — the event has happened — so skipping one during a
 * read-only maintenance window would lose, say, the receipt workflow for an
 * order paid a minute before the window began. A staff suspension for abuse,
 * fraud or billing is a full lock.
 *
 * `org` is the document the runner already holds for its plan gates; the
 * host document is read here, once per event that has something to run.
 * A read that fails answers "not locked", matching every other lockdown
 * reader's fail-open posture — and the sending identity, which refuses a
 * suspended site on its own, still stands behind every `sendEmail` step.
 */
export async function eventRunSuspension(
  hostRef: { get?: () => Promise<{ exists?: boolean; data?: () => unknown }> },
  org: unknown,
  nowMs: number = Date.now(),
): Promise<LockdownState | null> {
  let host: Record<string, unknown> | null
  try {
    const snapshot = await hostRef.get?.()
    host = snapshot?.exists
      ? ((snapshot.data?.() as Record<string, unknown>) ?? null)
      : null
  } catch {
    host = null
  }
  const lock = siteLockdownFromDocs(
    { org: (org as never) ?? null, host: host as never },
    nowMs,
  )
  return lock && lockdownMode(lock) === 'full' ? lock : null
}
