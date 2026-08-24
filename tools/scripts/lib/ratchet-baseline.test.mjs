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
 * Pins the shared ratchet comparison and the remedy it prints (AGL-2486).
 *
 *   node --test tools/scripts/lib/ratchet-baseline.test.mjs
 *
 * `remedy()` exists because three count-keyed guards went red on `main` in one
 * day and each author had to work out the fix from scratch. A remedy that is
 * merely PRESENT in the output buys nothing — it has to be RIGHT. So the
 * central test here does not assert on wording: it parses the rows back out of
 * the printed text, applies them to the baseline, and re-runs the comparison.
 * If the guidance is wrong in any way that matters, the second verdict is
 * still red and this fails.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { compareToBaseline, remedy } from './ratchet-baseline.mjs'

/** Parse the `"path": n,` lines back out of the printed remedy. */
function rowsFrom(text) {
  const rows = {}
  for (const line of text.split('\n')) {
    const match = /^\s*"(.+)":\s*(\d+),$/.exec(line)
    if (match) rows[match[1]] = Number(match[2])
  }
  return rows
}

test('the printed remedy, applied verbatim, actually clears the red', () => {
  // Two files gained occurrences; a third is untouched and must stay untouched.
  const baseline = { 'a.ts': 4, 'b.ts': 0, 'untouched.ts': 7 }
  const counts = { 'a.ts': 10, 'b.ts': 3, 'untouched.ts': 7 }

  const before = compareToBaseline(counts, baseline)
  // Positive control on the premise: this must really be red, or the round
  // trip below proves nothing.
  assert.equal(before.clean, false)
  assert.equal(before.regressions.length, 2)

  const rows = rowsFrom(remedy(before.regressions, '/repo/baseline.json'))
  assert.deepEqual(rows, { 'a.ts': 10, 'b.ts': 3 })

  const after = compareToBaseline(counts, { ...baseline, ...rows })
  assert.equal(after.clean, true)
  assert.equal(after.regressions.length, 0)
  // The rows the author pastes must not silently lower an unrelated ceiling —
  // that is the `--write` failure mode this whole helper steers away from.
  assert.equal(rows['untouched.ts'], undefined)
})

test('the row carries the MEASURED count, not the ceiling it broke', () => {
  // Emitting `allowed` would print a row that looks plausible and leaves the
  // guard red on the very next run.
  const verdict = compareToBaseline({ 'a.ts': 10 }, { 'a.ts': 4 })
  const rows = rowsFrom(remedy(verdict.regressions, '/repo/baseline.json'))
  assert.equal(rows['a.ts'], 10)
  assert.notEqual(rows['a.ts'], 4)
})

test('the remedy names the baseline file and refuses `--write`', () => {
  const verdict = compareToBaseline({ 'a.ts': 1 }, {})
  const text = remedy(verdict.regressions, '/repo/tools/scripts/base.json')
  assert.match(text, /\/repo\/tools\/scripts\/base\.json/)
  assert.match(text, /HAND-EDITING/)
  // The advice this replaced was "re-baseline with `--write`". If that ever
  // comes back as the recommended answer to a red, this fails.
  assert.match(text, /Do NOT clear this with `--write`/)
})

test('the rationale is optional, and is rendered when given', () => {
  const verdict = compareToBaseline({ 'a.ts': 1 }, {})
  const withOut = remedy(verdict.regressions, '/repo/base.json')
  assert.doesNotMatch(withOut, /\(/)

  const withIn = remedy(verdict.regressions, '/repo/base.json', 'email HTML')
  assert.match(withIn, /\(email HTML\)/)
})

test('stale rows are red, and improvements are not', () => {
  // Pins the decision the shared lib was extracted to keep in ONE place.
  const stale = compareToBaseline({}, { 'gone.ts': 3 })
  assert.equal(stale.clean, false)
  assert.deepEqual(stale.stale, [{ file: 'gone.ts', allowed: 3 }])

  const better = compareToBaseline({ 'a.ts': 1 }, { 'a.ts': 4 })
  assert.equal(better.clean, true)
  assert.deepEqual(better.improvements, [
    { file: 'a.ts', count: 1, allowed: 4 },
  ])
})
