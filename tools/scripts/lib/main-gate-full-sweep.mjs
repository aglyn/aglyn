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
// WHEN THE FULL SWEEP IS DUE (AGL-2552).
//
// AGL-2534 measured GitHub's scheduler delivering 13 of 120 requested runs and
// answered it for the `fast` job by gating on the event that can actually break
// `main` — a push — rather than on a clock. It deliberately left `full` on the
// hourly cron, because a 33-minute sweep cannot run on every push.
//
// That left the sweep on the unreliable half. Measured over the same 24 hours:
//
//   asked for       24 runs (`11 * * * *`)
//   delivered        6      — 25%
//   gap median     246 min  — the sweep that "runs hourly" ran every four hours
//   gap max        323 min
//
// So the sweep that decides whether a release is safe was the one running least
// often, and nobody could have known from the file, which says "hourly".
//
// The answer is the same instrument AGL-2534 used, plus a debounce: a push is a
// reliable event, so ASK ON EVERY PUSH whether the sweep is stale, and run it
// when it is. A push burst therefore cannot trigger repeated sweeps — the
// interval, not the push rate, sets the cadence — while an hour in which
// anything landed on `main` reliably gets one.
//
// This module is the decision alone, so it can be tested without the network.
// `check-main-gate-full-sweep.mjs` is the API half.

/**
 * The cadence the workflow has always CLAIMED for the sweep. Keeping the
 * default equal to the cron it replaces means this change alters delivery, not
 * intent — the file asked for hourly and now actually gets it.
 */
export const DEFAULT_INTERVAL_MINUTES = 60

/** The cron that is still a backstop path to the sweep. */
export const FULL_SWEEP_CRON = '11 * * * *'

/** Run states that mean a sweep is already underway. */
const IN_FLIGHT = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending'])

/**
 * A sweep already running or queued makes the next one NOT due, even when the
 * interval has elapsed. Without this the debounce measures from the wrong
 * moment: a push arriving during a 33-minute sweep would see a start time older
 * than the interval, queue a second sweep behind the first, and produce two
 * back-to-back runs over nearly the same commits — the exact waste the interval
 * exists to prevent.
 */
export function isInFlight(observation) {
  return IN_FLIGHT.has(String(observation?.status ?? '').toLowerCase())
}

/** Milliseconds, or NaN for anything unparseable. */
function startedMs(observation) {
  const raw = observation?.startedAt
  if (!raw) return Number.NaN
  return new Date(raw).getTime()
}

/**
 * The most recent sweep by start time. The caller's ordering is not trusted:
 * the Actions API returns runs newest-first, but the `full` JOB inside them is
 * what matters here and a re-run can put a newer job inside an older run.
 */
export function newestSweep(observations) {
  const dated = (observations ?? []).filter((o) => Number.isFinite(startedMs(o)))
  if (!dated.length) return null
  return dated.reduce((newest, o) => (startedMs(o) > startedMs(newest) ? o : newest))
}

/**
 * Whether the `full` sweep should run for this event.
 *
 * The three explicit paths are preserved exactly as they were, so this only
 * ever ADDS runs: a manual dispatch that asked for the sweep still gets it, and
 * the hourly cron still fires it on the ~25% of occasions GitHub delivers.
 *
 * @returns {{ due: boolean, reason: string }} `reason` is printed into the run
 *   log and the job summary. A decision nobody can read is how the last cadence
 *   claim went unexamined for weeks, so every branch explains itself.
 */
export function decideFullSweep({
  eventName,
  schedule = '',
  inputsFull = false,
  headSha = '',
  observations = [],
  now = Date.now(),
  intervalMinutes = DEFAULT_INTERVAL_MINUTES,
} = {}) {
  if (eventName === 'workflow_dispatch') {
    return inputsFull
      ? { due: true, reason: 'a manual dispatch asked for the full sweep' }
      : { due: false, reason: 'a manual dispatch asked for the fast path only' }
  }

  if (eventName === 'schedule') {
    return schedule === FULL_SWEEP_CRON
      ? { due: true, reason: `the ${FULL_SWEEP_CRON} backstop fired` }
      : { due: false, reason: 'the quarter-hourly cron gates the fast path only' }
  }

  if (eventName !== 'push') {
    return { due: false, reason: `${eventName || 'this event'} does not gate the full sweep` }
  }

  const inFlight = (observations ?? []).find(isInFlight)
  if (inFlight) {
    return { due: false, reason: 'a full sweep is already running — it covers this commit too' }
  }

  const newest = newestSweep(observations)
  if (!newest) {
    return { due: true, reason: 'no previous full sweep to measure against' }
  }

  // A sweep that already gated THIS sha proves nothing new is unswept, whatever
  // the clock says. This is the `moved` guard's rule, applied to the sweep.
  if (headSha && newest.headSha === headSha) {
    return { due: false, reason: `the last full sweep already gated ${headSha.slice(0, 9)}` }
  }

  const ageMinutes = (Number(now) - startedMs(newest)) / 60000
  if (!Number.isFinite(ageMinutes)) {
    return { due: true, reason: 'the last full sweep carries no usable start time' }
  }
  if (ageMinutes < intervalMinutes) {
    return {
      due: false,
      reason: `the last full sweep started ${Math.round(ageMinutes)}m ago, inside the ${intervalMinutes}m interval`,
    }
  }

  return {
    due: true,
    reason: `the last full sweep started ${Math.round(ageMinutes)}m ago, past the ${intervalMinutes}m interval`,
  }
}
