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
  gradePromotion,
  OK,
  REFUSE,
  UNVERIFIED,
} from './main-gate-verdicts.mjs'

const commit = (sha, contexts, subject = 'a commit') => ({
  sha,
  subject,
  contexts,
})
const fast = (state) => ({ context: 'main-gate/fast', state })
const full = (state) => ({ context: 'main-gate/full', state })

test('a green tip passes on fast alone — `full` is hourly and usually absent', () => {
  // Demanding `full` would refuse almost every promotion, for a reason that
  // says nothing about the code. See the header.
  const r = gradePromotion([commit('aaaaaaaaa', [fast('success')])])
  assert.equal(r.code, OK)
})

test('a RED tip is refused', () => {
  const r = gradePromotion([commit('bbbbbbbbb', [fast('success'), full('failure')])])
  assert.equal(r.code, REFUSE)
  assert.match(r.reason, /main-gate\/full/)
})

test("`error` is red too, not just `failure`", () => {
  const r = gradePromotion([commit('ccccccccc', [fast('error')])])
  assert.equal(r.code, REFUSE)
})

test('THE OBSERVED INCIDENT: a green tip over an ancestor red passes, and REPORTS', () => {
  // 2026-09-03: `be2165a60` went red on `full`, was an ancestor by promotion
  // time, and four promotions went out because nobody was told. This is the
  // case the check exists for — and it is a report, not a refusal, because an
  // intermediate red may have been repaired or may have been a flake.
  const r = gradePromotion([
    commit('be2165a60', [fast('success'), full('failure')], 'the unread red'),
    commit('7aea3d373', [fast('failure')], 'the ceiling red'),
    commit('08ef077ee', [fast('success'), full('success')], 'the tip'),
  ])
  assert.equal(r.code, OK)
  assert.equal(r.reds.length, 2)
  assert.deepEqual(
    r.reds.map((x) => x.commit.sha),
    ['be2165a60', '7aea3d373'],
  )
})

test('a tip with NO gate status is unverified, never clean', () => {
  const r = gradePromotion([commit('ddddddddd', [])])
  assert.equal(r.code, UNVERIFIED)
  assert.match(r.reason, /no Main Gate status/)
})

test('a tip whose only verdict is pending is unverified', () => {
  const r = gradePromotion([commit('eeeeeeeee', [fast('pending')])])
  assert.equal(r.code, UNVERIFIED)
  assert.match(r.reason, /pending/)
})

test('a pending context alongside a green one still passes', () => {
  const r = gradePromotion([commit('fffffffff', [fast('success'), full('pending')])])
  assert.equal(r.code, OK)
})

test('a pending context alongside a RED one is still refused', () => {
  const r = gradePromotion([commit('ggggggggg', [fast('failure'), full('pending')])])
  assert.equal(r.code, REFUSE)
})

test('non-gate statuses on the sha are ignored entirely', () => {
  // Vercel and friends write their own contexts; a red deploy preview is not
  // this check's business and must not refuse a promotion.
  const r = gradePromotion([
    commit('hhhhhhhhh', [
      { context: 'vercel/aglyn-tenant', state: 'failure' },
      fast('success'),
    ]),
  ])
  assert.equal(r.code, OK)
  assert.equal(r.reds.length, 0)
})

test('an empty range is unverified rather than vacuously clean', () => {
  const r = gradePromotion([])
  assert.equal(r.code, UNVERIFIED)
})

test('the tip is the LAST entry, so ordering is load-bearing', () => {
  // Reversed input must reach the opposite verdict; if it did not, the
  // function would not be reading the tip at all.
  const range = [
    commit('111111111', [fast('failure')]),
    commit('222222222', [fast('success')]),
  ]
  assert.equal(gradePromotion(range).code, OK)
  assert.equal(gradePromotion([...range].reverse()).code, REFUSE)
})
