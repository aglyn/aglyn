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
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_INTERVAL_MINUTES,
  FULL_SWEEP_CRON,
  decideFullSweep,
  isInFlight,
  newestSweep,
} from './main-gate-full-sweep.mjs'

const NOW = new Date('2026-09-03T20:00:00.000Z').getTime()
const HEAD = '262f7aee2abc0000'
/** Minutes before NOW, as the ISO string the Actions API returns. */
const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString()
const swept = (minutes, over = 'aaaaaaaaa0000000', status = 'completed') => ({
  startedAt: ago(minutes),
  status,
  headSha: over,
})

// --- the three paths that existed before, which must not change -------------

test('a manual dispatch that asked for the sweep still gets it', () => {
  const { due } = decideFullSweep({ eventName: 'workflow_dispatch', inputsFull: true })
  assert.equal(due, true)
})

test('a manual dispatch that asked for the fast path only does not', () => {
  const { due } = decideFullSweep({ eventName: 'workflow_dispatch', inputsFull: false })
  assert.equal(due, false)
})

test('the hourly backstop cron still fires the sweep', () => {
  const { due } = decideFullSweep({ eventName: 'schedule', schedule: FULL_SWEEP_CRON })
  assert.equal(due, true)
})

test('the quarter-hourly cron still does not', () => {
  const { due } = decideFullSweep({ eventName: 'schedule', schedule: '7,22,37,52 * * * *' })
  assert.equal(due, false)
})

test('an unrelated event does not fire the sweep', () => {
  const { due } = decideFullSweep({ eventName: 'pull_request' })
  assert.equal(due, false)
})

// --- the new push path ------------------------------------------------------

test('a push past the interval fires the sweep', () => {
  const { due, reason } = decideFullSweep({
    eventName: 'push',
    headSha: HEAD,
    observations: [swept(90)],
    now: NOW,
  })
  assert.equal(due, true)
  assert.match(reason, /90m ago, past the 60m interval/)
})

test('a push inside the interval does NOT — the interval sets the cadence, not the push rate', () => {
  const { due, reason } = decideFullSweep({
    eventName: 'push',
    headSha: HEAD,
    observations: [swept(20)],
    now: NOW,
  })
  assert.equal(due, false)
  assert.match(reason, /inside the 60m interval/)
})

test('a burst of pushes inside one interval produces exactly one sweep', () => {
  // The failure this debounce exists to prevent: six commits landing in ten
  // minutes must not buy six 33-minute sweeps over nearly the same tree.
  const observations = [swept(70)]
  let fired = 0
  for (let i = 0; i < 6; i += 1) {
    const { due } = decideFullSweep({
      eventName: 'push',
      headSha: `${HEAD}${i}`,
      observations,
      now: NOW + i * 2 * 60000,
    })
    if (due) {
      fired += 1
      // A fired sweep becomes the newest observation for the pushes behind it.
      observations.unshift(swept(0, `${HEAD}${i}`, 'in_progress'))
    }
  }
  assert.equal(fired, 1)
})

test('a sweep already running makes the next push not due, however old its start', () => {
  // Measuring the debounce from a start time alone would queue a second sweep
  // behind a running one and produce two back-to-back runs.
  const { due, reason } = decideFullSweep({
    eventName: 'push',
    headSha: HEAD,
    observations: [swept(75, 'bbbbbbbbb0000000', 'in_progress')],
    now: NOW,
  })
  assert.equal(due, false)
  assert.match(reason, /already running/)
})

test('a queued sweep counts as in flight too', () => {
  const { due } = decideFullSweep({
    eventName: 'push',
    headSha: HEAD,
    observations: [swept(75, 'bbbbbbbbb0000000', 'queued')],
    now: NOW,
  })
  assert.equal(due, false)
})

test('a sweep that already gated THIS sha does not run again', () => {
  const { due, reason } = decideFullSweep({
    eventName: 'push',
    headSha: HEAD,
    observations: [swept(300, HEAD)],
    now: NOW,
  })
  assert.equal(due, false)
  assert.match(reason, /already gated 262f7aee2/)
})

test('no previous sweep at all fires one', () => {
  const { due } = decideFullSweep({ eventName: 'push', headSha: HEAD, observations: [], now: NOW })
  assert.equal(due, true)
})

test('an unparseable start time fires the sweep rather than silently skipping it', () => {
  const { due } = decideFullSweep({
    eventName: 'push',
    headSha: HEAD,
    observations: [{ startedAt: 'not a date', status: 'completed', headSha: 'x' }],
    now: NOW,
  })
  assert.equal(due, true)
})

test('a failed previous sweep still counts for the interval', () => {
  // A red sweep gated the tree just as much as a green one; re-running it every
  // push until someone fixes the break is how a notifier becomes noise.
  const { due } = decideFullSweep({
    eventName: 'push',
    headSha: HEAD,
    observations: [{ ...swept(20), conclusion: 'failure' }],
    now: NOW,
  })
  assert.equal(due, false)
})

test('the interval is tunable', () => {
  const args = { eventName: 'push', headSha: HEAD, observations: [swept(45)], now: NOW }
  assert.equal(decideFullSweep({ ...args }).due, false)
  assert.equal(decideFullSweep({ ...args, intervalMinutes: 30 }).due, true)
})

test('the default interval matches the cron it replaces', () => {
  assert.equal(DEFAULT_INTERVAL_MINUTES, 60)
})

// --- helpers ----------------------------------------------------------------

test('the newest sweep is chosen by start time, not by caller ordering', () => {
  // A re-run can put a newer `full` job inside an older workflow run, so the
  // API's newest-first run ordering is not the job ordering.
  const newest = newestSweep([swept(200, 'old'), swept(5, 'new'), swept(90, 'mid')])
  assert.equal(newest.headSha, 'new')
})

test('the newest sweep ignores entries with no usable start time', () => {
  const newest = newestSweep([{ startedAt: null, headSha: 'bad' }, swept(50, 'good')])
  assert.equal(newest.headSha, 'good')
})

test('newestSweep on nothing is null, not a throw', () => {
  assert.equal(newestSweep([]), null)
  assert.equal(newestSweep(undefined), null)
})

test('in-flight detection is case-insensitive and survives a missing status', () => {
  assert.equal(isInFlight({ status: 'IN_PROGRESS' }), true)
  assert.equal(isInFlight({ status: 'completed' }), false)
  assert.equal(isInFlight({}), false)
  assert.equal(isInFlight(undefined), false)
})
