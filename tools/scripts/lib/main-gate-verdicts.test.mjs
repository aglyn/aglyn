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
  isReleaseSubject,
  OK,
  REFUSE,
  releaseBumpProof,
  UNVERIFIED,
  UNEXAMINED,
} from './main-gate-verdicts.mjs'

const commit = (sha, contexts, subject = 'a commit') => ({
  sha,
  subject,
  contexts,
})
const fast = (state) => ({ context: 'main-gate/fast', state })
const full = (state) => ({ context: 'main-gate/full', state })

test('a tip green on fast alone is UNEXAMINED, never refused', () => {
  // Demanding `full` would refuse almost every promotion, for a reason that
  // says nothing about the code, so this must not be a refusal. It is not a
  // pass either: nobody ran the tests on this sha. See the header.
  const r = gradePromotion([commit('aaaaaaaaa', [fast('success')])])
  assert.equal(r.code, UNEXAMINED)
  assert.notEqual(r.code, REFUSE)
  assert.equal(r.sweep, 'absent')
})

test('a tip that passed a full sweep is the only thing that grades green', () => {
  const r = gradePromotion([
    commit('aaaaaaaaa', [fast('success'), full('success')]),
  ])
  assert.equal(r.code, OK)
  assert.equal(r.sweep, 'passed')
  assert.match(r.reason, /passed a full sweep/)
})

test('THE d1cbc338f SHAPE: fast green, full never ran, three broken specs', () => {
  // 2026-09-03. `d1cbc338f` broke three console specs. Its live API status was
  // `main-gate/fast=success` and no `main-gate/full` context at all — the
  // `full` JOB was skipped, and a skipped job writes no status. It graded
  // green and would have promoted clean; a peer bisecting by hand caught it.
  const r = gradePromotion([
    commit('4b8f0a1c2', [fast('success'), full('success')], 'swept'),
    commit('d1cbc338f', [fast('success')], 'the tests regression'),
  ])
  assert.equal(r.code, UNEXAMINED)
  assert.notEqual(r.code, OK)
  assert.match(r.reason, /UNEXAMINED/)
  assert.match(r.reason, /main-gate\/full has never run on it/)
  // The person deciding is told how far back the last real sweep was.
  assert.equal(r.lastSwept.commit.sha, '4b8f0a1c2')
  assert.equal(r.lastSwept.behind, 1)
})

test('an ancestor full sweep never makes the tip green — it graded other code', () => {
  const r = gradePromotion([
    commit('aaaaaaaaa', [fast('success'), full('success')]),
    commit('bbbbbbbbb', [fast('success')]),
  ])
  assert.equal(r.code, UNEXAMINED)
})

test('no full sweep anywhere in the range reports no last-swept commit', () => {
  const r = gradePromotion([
    commit('aaaaaaaaa', [fast('success')]),
    commit('bbbbbbbbb', [fast('success')]),
  ])
  assert.equal(r.code, UNEXAMINED)
  assert.equal(r.lastSwept, null)
})

test('a full sweep still RUNNING on the tip is unexamined, not green', () => {
  // The answer exists in a few minutes; it does not exist now, and printing a
  // pending sweep as a passing one is the whole defect.
  const r = gradePromotion([commit('aaaaaaaaa', [fast('success'), full('pending')])])
  assert.equal(r.code, UNEXAMINED)
  assert.equal(r.sweep, 'pending')
  assert.match(r.reason, /still running/)
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

test('a pending fast alongside a passed sweep still passes', () => {
  const r = gradePromotion([commit('fffffffff', [fast('pending'), full('success')])])
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
      full('success'),
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
    commit('222222222', [fast('success'), full('success')]),
  ]
  assert.equal(gradePromotion(range).code, OK)
  assert.equal(gradePromotion([...range].reverse()).code, REFUSE)
})

// ── A release bump on a pinned branch (AGL-2890) ─────────────────────────────

const PARENT = 'ed297ab2dbd27c6b92cd947451e8ce7444f9e5c4'
const BUMP = 'cf69301862e1ba4ac38345cdd7bdf4c58881363f'
const bump = (contexts = [], releaseBumpOf = PARENT) => ({
  sha: BUMP,
  subject: 'chore(release): v1.0.0-beta.120 (AGL-2089)',
  contexts,
  releaseBumpOf,
})

test('THE PR #1042 SHAPE: a proven release bump with no status is graded by its parent', () => {
  // 2026-09-13. The pinned branch's tip was the bump, which Main Gate never
  // sees, and every such promotion graded "no verdict" while its parent had
  // passed a full sweep (run 34782331379).
  const r = gradePromotion([
    commit('1cf03cbeb', [fast('failure'), full('failure')], 'an ancestor red'),
    commit(PARENT, [fast('success'), full('success')], 'the pinned tip'),
    bump(),
  ])
  assert.equal(r.code, OK)
  assert.equal(r.tip.sha, BUMP)
  assert.equal(r.graded.sha, PARENT)
  assert.match(r.reason, /the tip cf6930186 is a release bump/)
  assert.match(r.reason, /its parent grades it: ed297ab2d passed a full sweep/)
  // The ancestor red is still reported, exactly as without a bump.
  assert.deepEqual(
    r.reds.map((x) => x.commit.sha),
    ['1cf03cbeb'],
  )
})

test('a release bump over a RED parent is refused', () => {
  const r = gradePromotion([
    commit(PARENT, [fast('success'), full('failure')]),
    bump(),
  ])
  assert.equal(r.code, REFUSE)
  assert.match(r.reason, /ed297ab2d is RED: main-gate\/full/)
})

test('a release bump over a parent the full sweep never reached is UNEXAMINED', () => {
  const r = gradePromotion([commit(PARENT, [fast('success')]), bump()])
  assert.equal(r.code, UNEXAMINED)
  assert.equal(r.sweep, 'absent')
})

test('a release bump that Main Gate DID grade is graded on its own statuses', () => {
  // The short path pushes the bump to `main` first, so the bump carries its
  // own verdict, and that verdict describes the exact tree being shipped.
  const r = gradePromotion([
    commit(PARENT, [fast('success'), full('success')]),
    bump([fast('success')]),
  ])
  assert.equal(r.code, UNEXAMINED)
  assert.equal(r.graded.sha, BUMP)
  assert.match(r.reason, /^the tip cf6930186 is green/)
})

test('an UNPROVEN bump still carries no verdict, whatever its subject says', () => {
  // `releaseBumpOf` is set only when git proved the diff. A subject alone is
  // not evidence, so without it nothing stands in.
  const r = gradePromotion([
    commit(PARENT, [fast('success'), full('success')]),
    bump([], null),
  ])
  assert.equal(r.code, UNVERIFIED)
  assert.equal(r.graded.sha, BUMP)
  assert.match(r.reason, /no Main Gate status/)
})

test('a bump whose parent is outside the range is not graded by anything else', () => {
  const r = gradePromotion([
    commit('aaaaaaaaa', [fast('success'), full('success')]),
    bump([], 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  ])
  assert.equal(r.code, UNVERIFIED)
})

const manifest = (version, scripts = { test: 'nx test' }) =>
  `${JSON.stringify({ name: 'aglyn', version, license: 'Apache-2.0', scripts }, null, 2)}\n`
const lockfile = (version, dependency = '1.2.3') =>
  `${JSON.stringify(
    {
      name: 'aglyn',
      version,
      lockfileVersion: 3,
      packages: {
        '': { name: 'aglyn', version, license: 'Apache-2.0' },
        'node_modules/left-pad': { version: dependency },
      },
    },
    null,
    2,
  )}\n`
const proven = (overrides = {}) =>
  releaseBumpProof({
    subject: 'chore(release): v1.0.0-beta.120 (AGL-2089)',
    parents: [PARENT],
    files: ['CHANGELOG.md', 'package-lock.json', 'package.json'],
    packageBefore: manifest('1.0.0-beta.119'),
    packageAfter: manifest('1.0.0-beta.120'),
    lockBefore: lockfile('1.0.0-beta.119'),
    lockAfter: lockfile('1.0.0-beta.120'),
    ...overrides,
  })

test('the bump release-prepare writes is proven', () => {
  assert.deepEqual(proven(), {
    ok: true,
    why: 'only the version fields and CHANGELOG.md change',
  })
})

test('a bump that leaves the lockfile alone is still only a version change', () => {
  const r = proven({ files: ['CHANGELOG.md', 'package.json'] })
  assert.equal(r.ok, true)
})

test('the proof refuses anything it cannot show is a version change', () => {
  const cases = [
    [{ subject: 'fix(ui): v1.0.0 of the table (AGL-2884)' }, /subject/],
    [
      {
        subject:
          'chore(release): carry a fix into the v1.0.0-beta.38 notes (AGL-2089)',
      },
      /subject/,
    ],
    [{ parents: [PARENT, BUMP] }, /exactly one parent/],
    [{ parents: [] }, /exactly one parent/],
    [
      { files: ['CHANGELOG.md', 'package.json', 'apps/console/app/page.tsx'] },
      /apps\/console\/app\/page\.tsx/,
    ],
    [{ files: ['CHANGELOG.md'] }, /does not change package\.json/],
    [{ packageAfter: manifest('1.0.0-beta.119') }, /keeps its version/],
    [
      {
        packageAfter: manifest('1.0.0-beta.120', {
          test: 'nx test',
          postinstall: 'curl evil',
        }),
      },
      /changes more than its version/,
    ],
    [
      { lockAfter: lockfile('1.0.0-beta.120', '9.9.9') },
      /package-lock\.json changes more/,
    ],
    [{ packageBefore: null }, /could not be read/],
    [{ lockAfter: '{ not json' }, /package-lock\.json could not be read/],
  ]
  for (const [overrides, why] of cases) {
    const r = proven(overrides)
    assert.equal(r.ok, false, JSON.stringify(overrides))
    assert.match(r.why, why)
  }
})

test('only the subject release-prepare writes reads as a release bump', () => {
  assert.equal(
    isReleaseSubject('chore(release): v1.0.0-beta.120 (AGL-2089)'),
    true,
  )
  assert.equal(isReleaseSubject('chore(release): v1.0.0'), true)
  assert.equal(isReleaseSubject('chore(release): v1.0.0-beta.120'), true)
  assert.equal(isReleaseSubject('chore(release): v1.0'), false)
  assert.equal(isReleaseSubject('chore(release)!: v2.0.0'), false)
  assert.equal(isReleaseSubject('chore(release): v1.0.0beta'), false)
  assert.equal(isReleaseSubject(undefined), false)
})
