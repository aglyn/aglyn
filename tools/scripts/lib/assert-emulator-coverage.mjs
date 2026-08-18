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
 * Assert that an emulator-guard run actually ran the guards (AGL-2002).
 *
 * `tools/scripts/test-emulator-guards.sh` calls this with the directory of
 * jest `--json` reports it just produced. A green jest exit is not enough on
 * its own, because the defect this whole issue is about produces a green jest
 * exit: every `*.emulator.spec.ts` is gated on `FIRESTORE_EMULATOR_HOST` and
 * degrades to `describe.skip`, so with the variable unset jest reports
 * "18 skipped, 0 failed" and exits 0.
 *
 * Three assertions, each for a different way the run can be hollow:
 *
 *  1. Some tests ran at all. Catches the emulator gate skipping everything,
 *     and catches a `--testPathPatterns` that matched nothing — the shape
 *     where the assertion and its control both return zero and the pass reads
 *     as clean.
 *  2. Nothing was skipped. A partial skip is the same disease as a total one,
 *     and it hides better.
 *  3. Every `*.emulator.spec.ts` tracked by git was executed. This is the
 *     one that survives refactors: a nineteenth spec landing in a project the
 *     runner does not list would otherwise be born dark, which is exactly how
 *     the first eighteen got here.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const reportDir = process.argv[2]
if (!reportDir) {
  console.error('usage: assert-emulator-coverage.mjs <report-dir>')
  process.exit(2)
}

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')

/** Every emulator spec in the tree, from git rather than a hand-kept list. */
const expected = execFileSync(
  'git',
  ['ls-files', '*.emulator.spec.ts'],
  { cwd: repoRoot, encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .sort()

const reports = readdirSync(reportDir).filter((name) => name.endsWith('.json'))
if (reports.length === 0) {
  console.error(`!! no jest reports in ${reportDir} — the run produced nothing`)
  process.exit(1)
}

let totalTests = 0
let pendingTests = 0
const executed = new Set()
const skippedFiles = new Set()

for (const name of reports) {
  const report = JSON.parse(readFileSync(join(reportDir, name), 'utf8'))
  totalTests += report.numTotalTests ?? 0
  pendingTests += report.numPendingTests ?? 0
  for (const suite of report.testResults ?? []) {
    const path = relative(repoRoot, suite.name)
    executed.add(path)
    // A suite whose every test is pending is a skipped FILE. Named
    // individually because "3 skipped" is far less actionable than the names.
    const assertions = suite.assertionResults ?? []
    if (
      assertions.length > 0 &&
      assertions.every((entry) => entry.status === 'pending')
    ) {
      skippedFiles.add(path)
    }
  }
}

const problems = []

if (totalTests === 0) {
  problems.push(
    'the run executed 0 tests. Either the emulator gate skipped every ' +
      'suite, or --testPathPatterns matched nothing. A zero-test pass is ' +
      'not a pass.',
  )
}

if (pendingTests > 0) {
  problems.push(
    `${pendingTests} test(s) were SKIPPED, not run. The emulator specs ` +
      `degrade to describe.skip when FIRESTORE_EMULATOR_HOST is unset, and ` +
      `a skip renders green — that is the AGL-2002 defect returning.` +
      (skippedFiles.size > 0
        ? `\n   Wholly skipped: ${[...skippedFiles].sort().join(', ')}`
        : ''),
  )
}

const missing = expected.filter((path) => !executed.has(path))
if (missing.length > 0) {
  problems.push(
    `${missing.length} emulator spec(s) exist in the tree but were not run ` +
      `by this sweep. Add the owning project to PROJECTS in ` +
      `tools/scripts/test-emulator-guards.sh:\n   ${missing.join('\n   ')}`,
  )
}

if (problems.length > 0) {
  console.error('\n!! emulator-guard coverage check FAILED\n')
  for (const problem of problems) console.error(` - ${problem}\n`)
  process.exit(1)
}

console.log(
  `==> emulator-guard coverage OK: ${expected.length} spec files, ` +
    `${totalTests} tests, 0 skipped`,
)
