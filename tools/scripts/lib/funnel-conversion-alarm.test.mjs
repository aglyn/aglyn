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
 * AGL-2587 / AGL-2609 — the views-to-conversions alarm goes red on the
 * incident it was built for, inside the hour-scale window it now grades, and
 * green on the quiet days around it.
 *
 * Both halves are the test. An alarm that cannot go red is decoration; an
 * alarm that cannot go green gets muted within a week and is then also
 * decoration. Every number below is a real figure from GA4 property
 * 302497406 or from Firebase Auth, so the thresholds are calibrated against
 * the traffic this product actually has rather than against a round number
 * someone liked.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BEACON_WINDOW_DAYS,
  DOOR_WINDOW_HOURS,
  FUNNEL_DOORS,
  MIN_BEACON_TRUTH,
  MIN_USERS,
  MIN_VIEWS,
  PROCESSING_LAG_DAYS,
  announceDecision,
  beaconWindow,
  countWithin,
  doorWindow,
  doorWindowLabel,
  gradeBeacon,
  gradeDoor,
  gradeFunnel,
  hourBuckets,
  recoveryPayload,
  slackPayload,
  zonedHourInstant,
} from './funnel-conversion-alarm.mjs'

const CHICAGO = 'America/Chicago'
const signupDoor = FUNNEL_DOORS.find((d) => d.id === 'signup')
const signinDoor = FUNNEL_DOORS.find((d) => d.id === 'signin')

/* ========================================================================= *
 * RED — the incident that ran for days with nothing looking at it.
 * ========================================================================= */

test('THE OBSERVED INCIDENT, inside one window: 2026-09-01 13:00–18:59 CT, /signup 9 views from 4 people, no account', () => {
  // The Data API's own figures for those hours, the span a run at 23:00 CT
  // would have held once GA4's lag had passed. Auth created nobody that day.
  const graded = gradeDoor({
    ...signupDoor,
    views: 9,
    users: 4,
    conversions: 0,
  })
  assert.equal(graded.verdict, 'red')
  assert.match(graded.reason, /9 views from 4 people/)
  assert.match(graded.reason, /not one account created/)
})

test('the whole launch day is red too: 14 views by 5 people, no account', () => {
  const graded = gradeDoor({
    ...signupDoor,
    views: 14,
    users: 5,
    conversions: 0,
  })
  assert.equal(graded.verdict, 'red')
})

test('the sign-in door goes red on the same hours: 22 views, 4 people, nobody signed in', () => {
  const graded = gradeDoor({
    ...signinDoor,
    views: 22,
    users: 4,
    conversions: 0,
  })
  assert.equal(graded.verdict, 'red')
  assert.match(graded.reason, /not one person signed in/)
})

test('one red door reddens the funnel, and the other door is still reported', () => {
  const verdict = gradeFunnel([
    { ...signupDoor, views: 9, users: 4, conversions: 0 },
    { ...signinDoor, views: 2, users: 1, conversions: 0 },
  ])
  assert.equal(verdict.red, true)
  assert.equal(verdict.doors.length, 2)
  assert.equal(verdict.doors[1].verdict, 'green')
})

/* ========================================================================= *
 * GREEN — the windows that must NOT alarm, or the channel gets muted.
 * ========================================================================= */

test('a genuinely quiet window is green: 2026-09-03 saw one /signup view', () => {
  const graded = gradeDoor({
    ...signupDoor,
    views: 1,
    users: 1,
    conversions: 0,
  })
  assert.equal(graded.verdict, 'green')
  assert.match(graded.reason, /quiet window/)
})

test('a window with no traffic at all is green, not red', () => {
  // The commonest state of this property. If zero views read as an outage the
  // alarm fires every hour the marketing site is quiet.
  assert.equal(
    gradeDoor({ ...signupDoor, views: 0, users: 0, conversions: 0 }).verdict,
    'green',
  )
})

test('one person reloading is not a cohort', () => {
  // Enough views to grade, but all from one visitor. That is somebody stuck,
  // or somebody testing — a support question, not a platform incident.
  const graded = gradeDoor({
    ...signupDoor,
    views: 14,
    users: 1,
    conversions: 0,
  })
  assert.equal(graded.verdict, 'green')
  assert.match(graded.reason, /not a cohort/)
})

test('a conversion Auth knows about is green however heavy the traffic — 2026-09-04: 10 views, 2 accounts', () => {
  const graded = gradeDoor({
    ...signupDoor,
    views: 10,
    users: 5,
    conversions: 2,
  })
  assert.equal(graded.verdict, 'green')
  assert.match(graded.reason, /2 accounts created from 10 views/)
  assert.match(
    gradeDoor({ ...signinDoor, views: 16, users: 7, conversions: 1 }).reason,
    /1 person signed in from 16 views/,
  )
})

test('a green always says why — an unexplained green is indistinguishable from a broken query', () => {
  for (const door of [
    { ...signupDoor, views: 0, users: 0, conversions: 0 },
    { ...signupDoor, views: 14, users: 1, conversions: 0 },
    { ...signupDoor, views: 14, users: 5, conversions: 2 },
  ]) {
    assert.ok(gradeDoor(door).reason.length > 0)
  }
})

/* ========================================================================= *
 * THE THRESHOLDS THEMSELVES — the boundary is where a rule is wrong.
 * ========================================================================= */

test('the floors admit the incident within one window and exclude the quiet days', () => {
  // Calibration, asserted rather than assumed: raise MIN_VIEWS past 9 or
  // MIN_USERS past 4 and the 2026-09-01 outage stops being detectable on the
  // day it happened, which is the whole point of the re-timing.
  assert.ok(MIN_VIEWS <= 9, 'the incident window had 9 views')
  assert.ok(MIN_USERS <= 4, 'the incident window had 4 distinct users')
  assert.ok(MIN_VIEWS > 1, 'a single view must not alarm')
  assert.ok(MIN_USERS > 1, 'a single visitor must not alarm')
})

test('exactly at the floors it grades; one short of either it does not', () => {
  assert.equal(
    gradeDoor({
      ...signupDoor,
      views: MIN_VIEWS,
      users: MIN_USERS,
      conversions: 0,
    }).verdict,
    'red',
  )
  assert.equal(
    gradeDoor({
      ...signupDoor,
      views: MIN_VIEWS - 1,
      users: MIN_USERS,
      conversions: 0,
    }).verdict,
    'green',
  )
  assert.equal(
    gradeDoor({
      ...signupDoor,
      views: MIN_VIEWS,
      users: MIN_USERS - 1,
      conversions: 0,
    }).verdict,
    'green',
  )
})

/* ========================================================================= *
 * THE DOOR WINDOW — ends now, cut on the property's clock.
 * ========================================================================= */

test('the door window ends at the run and starts DOOR_WINDOW_HOURS back on a wall-clock hour', () => {
  // 05:00Z on the 2nd is 00:00 Chicago; twelve hours back is 12:00 Chicago
  // on the 1st, which is 17:00Z.
  const w = doorWindow('2026-09-02T05:00:00Z', CHICAGO)
  assert.equal(w.endMs, Date.parse('2026-09-02T05:00:00Z'))
  assert.equal(w.startMs, Date.parse('2026-09-01T17:00:00Z'))
  assert.equal(w.hours, DOOR_WINDOW_HOURS)
  // A run mid-hour still starts on the hour, so GA4's buckets and the Auth
  // span open at the same instant.
  const mid = doorWindow('2026-09-02T05:20:00Z', CHICAGO)
  assert.equal(mid.startMs, Date.parse('2026-09-01T17:00:00Z'))
})

test('the incident hours fall inside the window a 23:00 CT run on 2026-09-01 would grade', () => {
  const buckets = hourBuckets(
    ...(({ startMs, endMs }) => [startMs, endMs])(
      doorWindow('2026-09-02T04:20:00Z', CHICAGO),
    ),
    CHICAGO,
  )
  assert.ok(buckets.includes('2026090113'), 'the 13:00 CT views')
  assert.ok(buckets.includes('2026090118'), 'the 18:00 CT views')
  assert.equal(buckets[0], '2026090111')
  assert.equal(buckets.at(-1), '2026090123')
})

test("hour buckets are the zone's wall clock, not UTC", () => {
  // 2026-09-01T23:00Z is 18:00 in Chicago.
  assert.deepEqual(
    hourBuckets(
      Date.parse('2026-09-01T23:00:00Z'),
      Date.parse('2026-09-01T23:59:00Z'),
      CHICAGO,
    ),
    ['2026090118'],
  )
  assert.equal(
    zonedHourInstant({ year: 2026, month: 9, day: 1, hour: 18 }, CHICAGO),
    Date.parse('2026-09-01T23:00:00Z'),
  )
})

test('a DST fall-back repeats a wall-clock hour and the bucket list keeps it once', () => {
  // 2026-11-01: 01:00 CDT and 01:00 CST are both dateHour ...01. Five
  // instants, four buckets, none repeated.
  const buckets = hourBuckets(
    Date.parse('2026-11-01T05:00:00Z'),
    Date.parse('2026-11-01T09:00:00Z'),
    CHICAGO,
  )
  assert.deepEqual(buckets, [
    '2026110100',
    '2026110101',
    '2026110102',
    '2026110103',
  ])
})

test('the window label says how long and to when, in UTC', () => {
  assert.equal(
    doorWindowLabel(doorWindow('2026-09-02T05:00:00Z', CHICAGO)),
    `the ${DOOR_WINDOW_HOURS} hours to 2026-09-02T05:00Z`,
  )
})

/* ========================================================================= *
 * THE BEACON WINDOW — the one place the lag guard still belongs.
 * ========================================================================= */

test('the beacon window ends days back and spans whole property days, midnight to midnight', () => {
  assert.ok(PROCESSING_LAG_DAYS >= 1, 'today is always partial')
  const w = beaconWindow('2026-09-05T17:00:00Z', CHICAGO)
  assert.equal(w.endDate, '2026-09-03')
  assert.equal(w.startDate, '2026-08-28')
  assert.equal(
    w.startMs,
    Date.parse('2026-08-28T05:00:00Z'),
    'midnight Chicago on the first day',
  )
  assert.equal(
    w.endMs,
    Date.parse('2026-09-04T05:00:00Z'),
    'midnight Chicago after the last day',
  )
  const days =
    (Date.parse(`${w.endDate}T00:00:00Z`) -
      Date.parse(`${w.startDate}T00:00:00Z`)) /
      86_400_000 +
    1
  assert.equal(days, BEACON_WINDOW_DAYS)
})

test('a beacon is red when Auth saw enough conversions and GA4 saw none of them', () => {
  const graded = gradeBeacon({ ...signupDoor, truth: 4, events: 0 })
  assert.equal(graded.verdict, 'red')
  assert.match(
    graded.reason,
    /4 accounts created and not one sign_up reached GA4/,
  )
})

test('a beacon is green while the event arrives, and quiet under the floor — consent declines are not an outage', () => {
  assert.equal(
    gradeBeacon({ ...signupDoor, truth: 4, events: 4 }).verdict,
    'green',
  )
  assert.equal(
    gradeBeacon({ ...signupDoor, truth: 2, events: 0 }).verdict,
    'green',
  )
  assert.match(
    gradeBeacon({ ...signupDoor, truth: 2, events: 0 }).reason,
    /under the/,
  )
  assert.ok(MIN_BEACON_TRUTH > 1, 'one consent-declined account must not alarm')
})

test('a red beacon reddens the funnel even when every door is fine', () => {
  const verdict = gradeFunnel(
    [{ ...signupDoor, views: 10, users: 5, conversions: 2 }],
    [{ ...signupDoor, truth: 5, events: 0 }],
  )
  assert.equal(verdict.red, true)
  assert.equal(verdict.doors[0].verdict, 'green')
  assert.equal(verdict.beacons[0].verdict, 'red')
})

/* ========================================================================= *
 * THE TRUTH — Auth records counted inside a span.
 * ========================================================================= */

test("countWithin reads the Identity Toolkit's millisecond strings and honours both bounds", () => {
  const records = [
    { createdAt: '1000' },
    { createdAt: '2000' },
    { createdAt: '3000' },
    { createdAt: 'not a number' },
    {},
  ]
  assert.equal(
    countWithin(records, 'createdAt', { startMs: 2000, endMs: 3000 }),
    2,
  )
  assert.equal(
    countWithin(records, 'createdAt', { startMs: 4000, endMs: 5000 }),
    0,
  )
  assert.equal(countWithin(undefined, 'createdAt', { startMs: 0, endMs: 1 }), 0)
})

/* ========================================================================= *
 * SAYING IT ONCE.
 * ========================================================================= */

test('a red is announced when the previous run was not red, and only then', () => {
  assert.equal(
    announceDecision({ red: true, previousConclusion: 'success' }),
    'red',
  )
  assert.equal(announceDecision({ red: true, previousConclusion: '' }), 'red')
  assert.equal(
    announceDecision({ red: true, previousConclusion: 'failure' }),
    'silent',
  )
})

test('the first green after a red says so; green after green says nothing', () => {
  assert.equal(
    announceDecision({ red: false, previousConclusion: 'failure' }),
    'recovered',
  )
  assert.equal(
    announceDecision({ red: false, previousConclusion: 'success' }),
    'quiet',
  )
  assert.equal(
    announceDecision({ red: false, previousConclusion: '' }),
    'quiet',
  )
})

/* ========================================================================= *
 * WHAT THE CHANNEL IS TOLD.
 * ========================================================================= */

const WINDOWS = {
  doorWindow: doorWindow('2026-09-02T05:00:00Z', CHICAGO),
  beaconWindow: beaconWindow('2026-09-02T05:00:00Z', CHICAGO),
  runUrl: 'https://github.com/aglyn/aglyn/actions/runs/1',
}

test("a door red names the door, the numbers, the window, and that the count is Auth's", () => {
  const verdict = gradeFunnel([
    { ...signupDoor, views: 9, users: 4, conversions: 0 },
    { ...signinDoor, views: 2, users: 1, conversions: 0 },
  ])
  const payload = slackPayload({ verdict, ...WINDOWS })
  assert.match(payload.text, /Sign-up/)
  assert.match(payload.text, /12 hours to 2026-09-02T05:00Z/)
  const body = payload.blocks[0].text.text
  assert.match(body, /`\/signup`/)
  assert.match(body, /9 views from 4 people/)
  assert.match(body, /Firebase Auth/)
  assert.match(body, /browser/)
  // The green door is NOT named as broken.
  assert.doesNotMatch(body, /`\/signin`/)
})

test('a beacon red names the event, the settled window, and what it costs', () => {
  const verdict = gradeFunnel(
    [{ ...signupDoor, views: 1, users: 1, conversions: 0 }],
    [{ ...signupDoor, truth: 5, events: 0 }],
  )
  const payload = slackPayload({ verdict, ...WINDOWS })
  assert.match(payload.text, /sign_up.*stopped reaching GA4/)
  const body = payload.blocks[0].text.text
  assert.match(body, /5 accounts created and not one sign_up/)
  assert.match(body, /2026-08-25 → 2026-08-31/)
  assert.match(body, /Google Ads/)
  assert.doesNotMatch(body, /Open it in a browser/)
})

test("the recovery message lists every door's reason, so quiet is never read as converting", () => {
  const verdict = gradeFunnel([
    { ...signupDoor, views: 1, users: 1, conversions: 0 },
    { ...signinDoor, views: 16, users: 7, conversions: 1 },
  ])
  const payload = recoveryPayload({ verdict, ...WINDOWS })
  assert.match(payload.text, /green again/)
  const body = payload.blocks[0].text.text
  assert.match(body, /quiet window/)
  assert.match(body, /1 person signed in from 16 views/)
})

/* ========================================================================= *
 * THE DOORS THEMSELVES.
 * ========================================================================= */

test('both funnel doors are watched, each with the Auth field that says it opened and the GA4 event that should', () => {
  assert.deepEqual(
    FUNNEL_DOORS.map((d) => [d.pagePath, d.truthField, d.conversionEvent]),
    [
      ['/signup', 'createdAt', 'sign_up'],
      ['/signin', 'lastLoginAt', 'login'],
    ],
  )
})

/* ========================================================================= *
 * THE NETWORK HALF'S WIRING — asserted from its source, since it cannot run
 * without production credentials.
 * ========================================================================= */

const NETWORK_HALF = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'check-funnel-conversions.mjs',
  ),
  'utf8',
)

test('a backtest can never announce', () => {
  assert.match(
    NETWORK_HALF,
    /DRY_RUN = args\.includes\('--dry-run'\) \|\| AS_OF !== null/,
  )
})

test('the say-it-once state is the previous scheduled conclusion, and the workflow supplies it', () => {
  assert.match(NETWORK_HALF, /process\.env\.PREVIOUS_CONCLUSION/)
  const workflow = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '.github',
      'workflows',
      'funnel-conversion-alarm.yml',
    ),
    'utf8',
  )
  assert.match(
    workflow,
    /PREVIOUS_CONCLUSION: \$\{\{ steps\.previous\.outputs\.conclusion \}\}/,
  )
  assert.match(workflow, /--event=schedule/)
  assert.match(workflow, /actions: read/)
  assert.match(workflow, /cron: '20 \* \* \* \*'/)
})

test('the conversions are read from Auth, not from the GA4 event, and only counts leave', () => {
  assert.match(NETWORK_HALF, /accounts:query/)
  assert.match(NETWORK_HALF, /conversions: truth\.door\[door\.truthField\]/)
  assert.doesNotMatch(NETWORK_HALF, /console\.log\(.*userInfo/)
})
