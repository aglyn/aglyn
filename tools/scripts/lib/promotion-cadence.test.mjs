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
 * Pins the AGL-3413 promotion cap.
 *
 *   node --test tools/scripts/lib/promotion-cadence.test.mjs
 *
 * Two ways for this to fail, pointing opposite ways: a day boundary in the
 * wrong place (UTC midnight is 7 PM Central, so an evening promotion would
 * count against the wrong day), and a cap that refuses a hotfix.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  describeCadence,
  evaluateCadence,
  PROMOTIONS_PER_DAY,
  readProductionMerges,
  startOfZonedDay,
} from './promotion-cadence.mjs'

const merge = (iso, n = 1) => ({
  sha: `${n}`.padStart(40, 'a'),
  mergedAt: new Date(iso),
  subject: `Merge pull request #${n} from aglyn/release/v1.0.0-beta.${n}`,
})

test('the cap is three a day', () => {
  assert.equal(PROMOTIONS_PER_DAY, 3)
})

test('the day starts at Central midnight, not UTC midnight', () => {
  // 2026-09-29 is CDT, UTC-5.
  assert.equal(
    startOfZonedDay(new Date('2026-09-29T22:00:00Z')).toISOString(),
    '2026-09-29T05:00:00.000Z',
  )
  // 01:00Z on the 30th is still the evening of the 29th in Central.
  assert.equal(
    startOfZonedDay(new Date('2026-09-30T01:00:00Z')).toISOString(),
    '2026-09-29T05:00:00.000Z',
  )
  // CST, UTC-6.
  assert.equal(
    startOfZonedDay(new Date('2026-12-15T12:00:00Z')).toISOString(),
    '2026-12-15T06:00:00.000Z',
  )
})

test('DST changeover days start at the offset in force at midnight', () => {
  // 2026-03-08: clocks spring forward at 02:00, midnight is still CST.
  assert.equal(
    startOfZonedDay(new Date('2026-03-08T20:00:00Z')).toISOString(),
    '2026-03-08T06:00:00.000Z',
  )
  // 2026-11-01: clocks fall back at 02:00, midnight is still CDT.
  assert.equal(
    startOfZonedDay(new Date('2026-11-01T20:00:00Z')).toISOString(),
    '2026-11-01T05:00:00.000Z',
  )
})

test('allows promotions until three have merged today', () => {
  const now = new Date('2026-09-29T22:00:00Z')
  const merges = [
    merge('2026-09-28T23:00:00Z', 1), // yesterday, Central
    merge('2026-09-29T04:59:00Z', 2), // 23:59 yesterday, Central
    merge('2026-09-29T14:00:00Z', 3),
    merge('2026-09-29T18:00:00Z', 4),
  ]
  const verdict = evaluateCadence({ merges, now })
  assert.equal(verdict.used, 2)
  assert.equal(verdict.remaining, 1)
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.day, '2026-09-29')
})

test('refuses the fourth promotion of the day', () => {
  const now = new Date('2026-09-29T22:00:00Z')
  const merges = [
    merge('2026-09-29T14:00:00Z', 1),
    merge('2026-09-29T18:00:00Z', 2),
    merge('2026-09-29T21:00:00Z', 3),
  ]
  const verdict = evaluateCadence({ merges, now })
  assert.equal(verdict.allowed, false)
  assert.equal(verdict.remaining, 0)
  assert.match(describeCadence(verdict).join('\n'), /hotfix/)
})

test('an evening UTC-next-day merge counts toward the Central day it happened in', () => {
  const now = new Date('2026-09-30T03:00:00Z') // 22:00 on the 29th, Central
  const merges = [
    merge('2026-09-29T14:00:00Z', 1),
    merge('2026-09-29T18:00:00Z', 2),
    merge('2026-09-30T01:30:00Z', 3), // 20:30 on the 29th, Central
  ]
  assert.equal(evaluateCadence({ merges, now }).allowed, false)
})

test('the allowance resets at Central midnight', () => {
  const merges = [
    merge('2026-09-29T14:00:00Z', 1),
    merge('2026-09-29T18:00:00Z', 2),
    merge('2026-09-30T01:30:00Z', 3),
  ]
  const now = new Date('2026-09-30T05:01:00Z') // 00:01 on the 30th, Central
  const verdict = evaluateCadence({ merges, now })
  assert.equal(verdict.used, 0)
  assert.equal(verdict.allowed, true)
})

test('a hotfix goes past the cap and says so', () => {
  const now = new Date('2026-09-29T22:00:00Z')
  const merges = [1, 2, 3].map((n) => merge(`2026-09-29T1${n}:00:00Z`, n))
  const verdict = evaluateCadence({ merges, now, hotfix: true })
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.hotfixOverride, true)
  assert.match(describeCadence(verdict).join('\n'), /HOTFIX/)
})

test('a hotfix under the cap is not reported as an override', () => {
  const now = new Date('2026-09-29T22:00:00Z')
  const verdict = evaluateCadence({ merges: [], now, hotfix: true })
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.hotfixOverride, false)
})

test('reads first-parent merges from git log output', () => {
  const calls = []
  const git = (...args) => {
    calls.push(args)
    return [
      `${'b'.repeat(40)}\x002026-09-29T17:33:07-05:00\x00Merge pull request #1167 from aglyn/release/v1.0.0-beta.217`,
      `${'c'.repeat(40)}\x002026-09-29T09:02:00-05:00\x00Merge pull request #1164 from aglyn/release/v1.0.0-beta.216`,
    ].join('\n')
  }
  const merges = readProductionMerges(git)
  assert.deepEqual(calls[0].slice(0, 4), [
    'log',
    'origin/production',
    '--first-parent',
    '--merges',
  ])
  assert.equal(merges.length, 2)
  assert.equal(merges[0].mergedAt.toISOString(), '2026-09-29T22:33:07.000Z')
  assert.match(merges[1].subject, /beta\.216/)
  assert.deepEqual(
    readProductionMerges(() => ''),
    [],
  )
})
