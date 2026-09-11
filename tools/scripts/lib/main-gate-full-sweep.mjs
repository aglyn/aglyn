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
// WHEN THE FULL SWEEP IS DUE (AGL-2552, AGL-2836).
//
// Every push to `main` is swept. The sweep takes about eleven minutes on
// parallel runners (AGL-2721), and a burst of pushes is collapsed by
// `main-gate.yml`'s `full` job rather than here: its concurrency group runs one
// sweep per ref, lets only the newest waiting push replace an older waiting
// one, and never cuts a running sweep off.
//
// ## Why not a debounce
//
// AGL-2552 swept a push only when the last sweep had started an hour earlier and
// none was running. From 2026-09-03 to 2026-09-11 that left 24 test, lint and
// build breaks on `main` a median 43 minutes before their first red. Replaying
// the 270 push timestamps since 2026-09-04, a push waited a median 53 minutes
// and a p90 189 minutes for a sweep that covered it, and 5 pushes were never
// covered; the queue above gives p50 12, p90 21 and max 22 on the same pushes.
// People compensated with 20 manual dispatches over those days.
//
// ## Why not cancel the running sweep instead
//
// Cancelling grades nothing until a burst ends. On the same pushes it gave p90
// 25 and max 45 minutes, and with a 15-minute sweep a max of 69 against the
// queue's 30.
//
// This module is the decision alone, so it can be tested without the network.

/** The cron that re-sweeps the tip hourly, whatever has pushed. */
export const FULL_SWEEP_CRON = '11 * * * *'

/**
 * Whether the `full` sweep should run for this event.
 *
 * @returns {{ due: boolean, reason: string }} `reason` is printed into the run
 *   log and the job summary, so every branch explains itself.
 */
export function decideFullSweep({ eventName, schedule = '', inputsFull = false } = {}) {
  if (eventName === 'push') {
    return {
      due: true,
      reason:
        'every push to main is swept; a push that lands while a sweep runs waits, ' +
        'and only the newest waiting push is kept',
    }
  }

  if (eventName === 'workflow_dispatch') {
    return inputsFull
      ? { due: true, reason: 'a manual dispatch asked for the full sweep' }
      : { due: false, reason: 'a manual dispatch asked for the fast path only' }
  }

  if (eventName === 'schedule') {
    return schedule === FULL_SWEEP_CRON
      ? { due: true, reason: `the ${FULL_SWEEP_CRON} cron re-sweeps the tip` }
      : { due: false, reason: 'the quarter-hourly cron gates the fast path only' }
  }

  return { due: false, reason: `${eventName || 'this event'} does not gate the full sweep` }
}
