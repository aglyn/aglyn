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
import test from 'node:test'

import {
  enginesAdmit,
  evaluateNodeVersions,
  formatNodeVersionFailure,
  majorOf,
} from './node-version.mjs'

test('majorOf reads every form these files actually contain', () => {
  assert.equal(majorOf(20), 20)
  // YAML quotes its scalars; sixteen of the nineteen pins looked like this,
  // and a matcher that only read bare numbers would have called them all
  // unparseable rather than reporting them as pins.
  assert.equal(majorOf("'22'"), 22)
  assert.equal(majorOf('"24.16.0"'), 24)
  assert.equal(majorOf('v24'), 24)
  assert.equal(majorOf('lts/*'), null)
  assert.equal(majorOf(''), null)
  assert.equal(majorOf(undefined), null)
})

test('enginesAdmit accepts a floor that includes the pinned major', () => {
  assert.equal(enginesAdmit('>=24', 24).ok, true)
  assert.equal(enginesAdmit('>=20', 24).ok, true)
  assert.equal(enginesAdmit('24.x', 24).ok, true)
  assert.equal(enginesAdmit('^24', 24).ok, true)
})

test('enginesAdmit refuses the skew this guard was written for', () => {
  // The live state on 2026-09-03: engines said >=24, CI ran 20.
  const verdict = enginesAdmit('>=24', 20)
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /excludes node 20/)
})

test('enginesAdmit REPORTS a range it cannot read, rather than passing it', () => {
  // A guard that silently approves syntax it does not understand is worse
  // than one that asks — it reads as coverage and supplies none.
  const verdict = enginesAdmit('>=20 <25', 24)
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /not a form this guard reads/)
  assert.equal(enginesAdmit('', 24).ok, false)
})

test('a repo with one answer everywhere passes', () => {
  const result = evaluateNodeVersions({
    nvmrc: '24\n',
    engines: '>=24',
    workflows: [],
  })
  assert.equal(result.ok, true)
  assert.equal(result.major, 24)
  assert.deepEqual(result.problems, [])
})

test('every hardcoded pin is reported, and named where it lives', () => {
  const result = evaluateNodeVersions({
    nvmrc: '24\n',
    engines: '>=24',
    workflows: [
      { file: '.github/actions/nx-ci-setup/action.yml', line: 63, value: '20' },
      { file: '.github/workflows/uptime-probe.yml', line: 67, value: "'22'" },
    ],
  })
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 2)
  // A pin that agrees with .nvmrc is STILL reported: the rule is one source
  // of truth, not one value. A second place holding the right number today is
  // the place that holds the wrong one after the next bump.
  const agreeing = evaluateNodeVersions({
    nvmrc: '24\n',
    engines: '>=24',
    workflows: [{ file: 'w.yml', line: 1, value: '24' }],
  })
  assert.equal(agreeing.ok, false)
})

test('the failure text names the file, the line and the remedy', () => {
  const text = formatNodeVersionFailure(
    evaluateNodeVersions({
      nvmrc: '24\n',
      engines: '>=24',
      workflows: [{ file: 'w.yml', line: 9, value: '20' }],
    }),
  )
  assert.match(text, /w\.yml:9/)
  assert.match(text, /node-version-file: \.nvmrc/)
  // And says what is deliberately exempt, so nobody "fixes" the Cloud
  // Functions runtime into the repo's toolchain version.
  assert.match(text, /cloud\/functions/)
})

test('an unreadable .nvmrc fails before anything else is judged', () => {
  const result = evaluateNodeVersions({
    nvmrc: 'lts/*\n',
    engines: '>=24',
    workflows: [{ file: 'w.yml', line: 1, value: '20' }],
  })
  assert.equal(result.ok, false)
  assert.equal(result.major, null)
  // One problem, not two: with no known major there is nothing to compare a
  // pin against, and reporting both would send the reader at the wrong one.
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].kind, 'nvmrc')
})
