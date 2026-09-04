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
 * AGL-2587 — the views-to-conversions alarm goes red on the incident it was
 * built for, and green on the quiet days around it.
 *
 * Both halves are the test. An alarm that cannot go red is decoration; an
 * alarm that cannot go green gets muted within a week and is then also
 * decoration. Every number below is a real GA4 figure from property
 * 302497406, so the thresholds are calibrated against the traffic this
 * product actually has rather than against a round number someone liked.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ALARM_WINDOW_DAYS,
  FUNNEL_DOORS,
  MIN_USERS,
  MIN_VIEWS,
  PROCESSING_LAG_DAYS,
  gradeDoor,
  gradeFunnel,
  slackPayload,
  windowBounds,
} from './funnel-conversion-alarm.mjs'

const signupDoor = FUNNEL_DOORS.find((d) => d.id === 'signup')
const signinDoor = FUNNEL_DOORS.find((d) => d.id === 'signin')

/* ========================================================================= *
 * RED — the incident that ran for days with nothing looking at it.
 * ========================================================================= */

test('THE OBSERVED INCIDENT: 2026-09-01, /signup viewed 14 times by 5 people, zero sign_up', () => {
  // The measured numbers. The signup path was broken (AGL-2581) and this
  // ratio was the only thing in the property that said so.
  const graded = gradeDoor({ ...signupDoor, views: 14, users: 5, conversions: 0 })
  assert.equal(graded.verdict, 'red')
  assert.match(graded.reason, /14 views from 5 people/)
  assert.match(graded.reason, /sign_up/)
})

test('the sign-in door goes red on the same day: 27 views, 6 people, zero login', () => {
  const graded = gradeDoor({ ...signinDoor, views: 27, users: 6, conversions: 0 })
  assert.equal(graded.verdict, 'red')
  assert.match(graded.reason, /login/)
})

test('one red door reddens the funnel, and the other door is still reported', () => {
  const verdict = gradeFunnel([
    { ...signupDoor, views: 14, users: 5, conversions: 0 },
    { ...signinDoor, views: 2, users: 1, conversions: 0 },
  ])
  assert.equal(verdict.red, true)
  assert.equal(verdict.doors.length, 2)
  assert.equal(verdict.doors[1].verdict, 'green')
})

/* ========================================================================= *
 * GREEN — the days that must NOT alarm, or the channel gets muted.
 * ========================================================================= */

test('a genuinely quiet window is green: 2026-09-03 saw one /signup view', () => {
  const graded = gradeDoor({ ...signupDoor, views: 1, users: 1, conversions: 0 })
  assert.equal(graded.verdict, 'green')
  assert.match(graded.reason, /quiet window/)
})

test('a window with no traffic at all is green, not red', () => {
  // The commonest state of this property. If zero views read as an outage the
  // alarm fires every week the marketing site is quiet.
  assert.equal(
    gradeDoor({ ...signupDoor, views: 0, users: 0, conversions: 0 }).verdict,
    'green',
  )
})

test('one person reloading is not a cohort', () => {
  // Enough views to grade, but all from one visitor. That is somebody stuck,
  // or somebody testing — a support question, not a platform incident.
  const graded = gradeDoor({ ...signupDoor, views: 14, users: 1, conversions: 0 })
  assert.equal(graded.verdict, 'green')
  assert.match(graded.reason, /not a cohort/)
})

test('conversions arriving is green however heavy the traffic', () => {
  const graded = gradeDoor({ ...signupDoor, views: 400, users: 90, conversions: 1 })
  assert.equal(graded.verdict, 'green')
  assert.match(graded.reason, /1 sign_up from 400 views/)
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

test('the floors admit the incident and exclude the quiet days', () => {
  // Calibration, asserted rather than assumed: raise MIN_VIEWS past 14 or
  // MIN_USERS past 5 and the 2026-09-01 outage stops being detectable, which
  // is the whole point of the check.
  assert.ok(MIN_VIEWS <= 14, 'the observed incident had 14 views')
  assert.ok(MIN_USERS <= 5, 'the observed incident had 5 distinct users')
  assert.ok(MIN_VIEWS > 1, 'a single view must not alarm')
  assert.ok(MIN_USERS > 1, 'a single visitor must not alarm')
})

test('exactly at the floors it grades; one short of either it does not', () => {
  assert.equal(
    gradeDoor({ ...signupDoor, views: MIN_VIEWS, users: MIN_USERS, conversions: 0 })
      .verdict,
    'red',
  )
  assert.equal(
    gradeDoor({ ...signupDoor, views: MIN_VIEWS - 1, users: MIN_USERS, conversions: 0 })
      .verdict,
    'green',
  )
  assert.equal(
    gradeDoor({ ...signupDoor, views: MIN_VIEWS, users: MIN_USERS - 1, conversions: 0 })
      .verdict,
    'green',
  )
})

/* ========================================================================= *
 * THE LAG GUARD — the reason this issue nearly "fixed" a working event.
 * ========================================================================= */

test('the window ends days back, so a half-processed day is never graded', () => {
  const { startDate, endDate } = windowBounds('2026-09-04')
  assert.equal(endDate, '2026-09-02')
  assert.equal(startDate, '2026-08-31')
})

test('the window is ALARM_WINDOW_DAYS long and clears the processing lag', () => {
  assert.ok(PROCESSING_LAG_DAYS >= 1, 'today is always partial')
  const { startDate, endDate } = windowBounds(new Date('2026-09-04T00:00:00Z'))
  const days =
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
      86_400_000 +
    1
  assert.equal(days, ALARM_WINDOW_DAYS)
})

test('the incident window is inside the range a run on 2026-09-04 would grade', () => {
  // The run that should have caught it: 2026-09-01 falls between the bounds.
  const { startDate, endDate } = windowBounds('2026-09-03')
  assert.ok(startDate <= '2026-09-01' && '2026-09-01' <= endDate)
})

/* ========================================================================= *
 * WHAT THE CHANNEL IS TOLD.
 * ========================================================================= */

test('the Slack message names the door, the numbers and the window', () => {
  const verdict = gradeFunnel([
    { ...signupDoor, views: 14, users: 5, conversions: 0 },
    { ...signinDoor, views: 2, users: 1, conversions: 0 },
  ])
  const payload = slackPayload({
    verdict,
    window: { startDate: '2026-08-31', endDate: '2026-09-02' },
    runUrl: 'https://github.com/aglyn/aglyn/actions/runs/1',
  })
  assert.match(payload.text, /Sign-up/)
  assert.match(payload.text, /2026-08-31 → 2026-09-02/)
  const body = payload.blocks[0].text.text
  assert.match(body, /\/signup/)
  assert.match(body, /14 views from 5 people/)
  // The green door is NOT named as broken.
  assert.doesNotMatch(body, /`\/signin`/)
})

test('the message says the lag guard held, so nobody re-litigates processing lag', () => {
  const payload = slackPayload({
    verdict: gradeFunnel([{ ...signupDoor, views: 14, users: 5, conversions: 0 }]),
    window: { startDate: '2026-08-31', endDate: '2026-09-02' },
    runUrl: '',
  })
  assert.match(payload.blocks[0].text.text, /processing lag/)
})

/* ========================================================================= *
 * THE DOORS THEMSELVES.
 * ========================================================================= */

test('both funnel doors are watched, each with the event that says it opened', () => {
  assert.deepEqual(
    FUNNEL_DOORS.map((d) => [d.pagePath, d.conversionEvent]),
    [
      ['/signup', 'sign_up'],
      ['/signin', 'login'],
    ],
  )
})
