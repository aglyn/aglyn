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

// Self-test for the CI test digest (AGL-1617).
//
// The subject is a reporter for runs nobody can reproduce, so the bar is the
// one this repo keeps relearning: the case that matters most is not the one
// where it finds failures, it is the one where it finds NONE and something
// still failed. That case must come back INCONCLUSIVE and must never render
// as clean — a "0 failures" line under a red job is an answer to a question
// the tool never looked at.
//
// The ANSI fixtures use REAL escape bytes (`\x1b`), plus the caret-escaped
// form some log downloads carry. Both are here because the near-miss that
// produced this tool was a macOS BSD `sed` that does not interpret `\x1b` at
// all: the strip silently did nothing, every grep came back empty, and empty
// reads exactly like "no failures".

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CAPS,
  VERDICTS,
  digestLog,
  formatDigest,
  looksTruncated,
  stripAnsi,
  stripLogPrefix,
} from './ci-test-digest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cliPath = join(here, 'ci-test-digest.mjs')

const ESC = '\x1b'

describe('a log with real jest failures', () => {
  const log = [
    '> nx run console:test',
    '',
    ' FAIL  apps/console/specs/billing-meter.spec.ts (12.4 s)',
    '  billing meter',
    '    ✓ counts a receipt (5 ms)',
    '    ✕ counts the legal-intake receipt (7 ms)',
    '',
    '  ● billing meter › counts the legal-intake receipt',
    '',
    '    expect(received).toBe(expected)',
    '',
    ' FAIL  apps/console/specs/passkey-revoke.spec.ts',
    '  ● Test suite failed to run',
    '',
    'Test Suites: 2 failed, 584 passed, 586 total',
    'Tests:       1 failed, 6820 passed, 6821 total',
    '',
    'NX  Running target test for 38 projects failed',
    '',
    'Failed tasks:',
    '',
    '- console:test',
    '',
  ].join('\n')

  it('names every failed suite path', () => {
    const result = digestLog(log)
    assert.deepEqual(result.failedSuites, [
      'apps/console/specs/billing-meter.spec.ts',
      'apps/console/specs/passkey-revoke.spec.ts',
    ])
  })

  it('names the failed tests from both the ● block and the ✕ line', () => {
    const result = digestLog(log)
    assert.ok(
      result.failedTests.includes(
        'billing meter › counts the legal-intake receipt',
      ),
      `● block not captured: ${JSON.stringify(result.failedTests)}`,
    )
    assert.ok(
      result.failedTests.includes('counts the legal-intake receipt (7 ms)'),
      `✕ line not captured: ${JSON.stringify(result.failedTests)}`,
    )
    assert.ok(
      result.failedTests.includes('Test suite failed to run'),
      'a suite that could not even start is a failure and must be named',
    )
  })

  it('keeps only the summary lines that mention a failure', () => {
    const result = digestLog(log)
    assert.deepEqual(result.summaries, [
      'Test Suites: 2 failed, 584 passed, 586 total',
      'Tests:       1 failed, 6820 passed, 6821 total',
    ])
  })

  it('collects the nx Failed tasks list', () => {
    assert.deepEqual(digestLog(log).failedTasks, ['console:test'])
  })

  it('grades failures-found, and never inconclusive', () => {
    const result = digestLog(log)
    assert.equal(result.verdict, VERDICTS.FAILURES)
    assert.equal(result.inconclusive, false)
    assert.match(formatDigest(result), /failures-found/)
    assert.doesNotMatch(formatDigest(result), /INCONCLUSIVE/)
  })

  it('does not mistake a PASSING suite for a failed one', () => {
    // ` PASS ` lines and jest's `● Console` groups are printed 1,201 and 362
    // times respectively in the log this tool was written for. Counting
    // either would have turned an inconclusive run into a confident wrong
    // answer.
    const passing = [
      ' PASS  apps/console/specs/quota.spec.ts',
      '  ● Console',
      '    console.warn',
      '      quota near cap',
      'Tests:       6821 passed, 6821 total',
    ].join('\n')
    const result = digestLog(passing)
    assert.deepEqual(result.failedSuites, [])
    assert.deepEqual(result.failedTests, [])
    assert.deepEqual(result.summaries, [])
  })

  it('does not read the word FAIL in prose as a suite path', () => {
    const prose = [
      'console.log',
      '  FAIL: swept only 12 files — the sweep is not reaching the corpus',
      "  it('should FAIL when the quota is exceeded')",
    ].join('\n')
    assert.deepEqual(digestLog(prose).failedSuites, [])
  })
})

describe('an nx task failure with no jest failure — the AGL-1617 log', () => {
  // Verbatim shape of Main Gate run 32685698590: a red task, and not one
  // line anywhere saying which test produced it.
  const log = [
    'PASS apps/console/specs/quota.spec.ts',
    'Tests:       6821 passed, 6821 total',
    '',
    'NX  Running target test for 38 projects failed',
    '',
    'Failed tasks:',
    '',
    '- console:test',
    '',
  ].join('\n')

  it('grades INCONCLUSIVE', () => {
    assert.equal(digestLog(log).verdict, VERDICTS.INCONCLUSIVE)
    assert.equal(digestLog(log).inconclusive, true)
  })

  it('MUST NOT grade clean — this is the whole point of the third state', () => {
    const result = digestLog(log)
    assert.notEqual(
      result.verdict,
      VERDICTS.CLEAN,
      'a task failed; reporting clean would answer a question never looked at',
    )
    const text = formatDigest(result)
    assert.match(text, /INCONCLUSIVE/)
    assert.doesNotMatch(text, /^clean —/m)
  })

  it('says what to suspect and where the untruncated bytes are', () => {
    const text = formatDigest(digestLog(log))
    assert.match(text, /crash/i)
    assert.match(text, /OOM|out of memory/i)
    assert.match(text, /truncated/i)
    assert.match(text, /artifact/i)
  })

  it('still lists the failed task, which is all the log knows', () => {
    assert.deepEqual(digestLog(log).failedTasks, ['console:test'])
  })

  it('surfaces a crash signal when the log does carry one', () => {
    const crashy = log.replace(
      'NX  Running target',
      'FATAL ERROR: Reached heap limit Allocation failed - ' +
        'JavaScript heap out of memory\nNX  Running target',
    )
    const result = digestLog(crashy)
    assert.equal(result.verdict, VERDICTS.INCONCLUSIVE)
    assert.ok(
      result.crashes.some((c) => /heap out of memory/.test(c)),
      `crash signal not surfaced: ${JSON.stringify(result.crashes)}`,
    )
  })

  it('takes the premise from the CI step when the log carries no marker', () => {
    // The `if: failure()` step knows a fact the log may not contain. A log
    // with nothing in it at all, handed over by a red job, is inconclusive —
    // not clean.
    const result = digestLog('', { taskFailed: true })
    assert.equal(result.verdict, VERDICTS.INCONCLUSIVE)
  })

  it('reads a bare ##[error] exit line as a task failure', () => {
    const bare = '##[error]Process completed with exit code 1.\n'
    assert.equal(digestLog(bare).verdict, VERDICTS.INCONCLUSIVE)
  })
})

describe('a fully clean log', () => {
  const log = [
    'PASS apps/console/specs/quota.spec.ts',
    'PASS apps/tenant/specs/render.spec.ts',
    'Test Suites: 586 passed, 586 total',
    'Tests:       6821 passed, 6821 total',
    '',
    'NX  Successfully ran target test for 38 projects',
    '',
  ].join('\n')

  it('grades clean', () => {
    const result = digestLog(log)
    assert.equal(result.verdict, VERDICTS.CLEAN)
    assert.equal(result.taskFailed, false)
    assert.deepEqual(result.failedSuites, [])
    assert.deepEqual(result.failedTests, [])
  })

  it('says clean in words, and says nothing about being inconclusive', () => {
    const text = formatDigest(digestLog(log))
    assert.match(text, /clean/)
    assert.doesNotMatch(text, /INCONCLUSIVE/)
  })
})

describe('an ANSI-laden log — real escape bytes, not a shell strip', () => {
  const colour = (code, s) => `${ESC}[${code}m${s}${ESC}[39m`

  const log = [
    `${ESC}[7m${ESC}[1m${ESC}[31m FAIL ${ESC}[39m${ESC}[22m${ESC}[27m ${ESC}[2mapps/console/specs/${ESC}[22m${ESC}[1mbilling-meter.spec.ts${ESC}[22m`,
    `  ${ESC}[1m● ${ESC}[22mbilling meter › counts the legal-intake receipt`,
    `${ESC}[1mTests:       ${ESC}[22m${colour(31, '1 failed')}, 6820 passed, 6821 total`,
    `${ESC}[7m${ESC}[1m${ESC}[31m NX ${ESC}[39m${ESC}[22m${ESC}[27m  ${colour(31, 'Running target test for 38 projects failed')}`,
    `${ESC}[2mFailed tasks:${ESC}[22m`,
    '',
    `${ESC}[2m-${ESC}[22m console:test`,
    '',
  ].join('\n')

  it('the fixture really does contain escape bytes', () => {
    // Guard the premise: if this fixture were written with a literal
    // backslash-x-1-b it would test nothing, which is the exact way the
    // original investigation nearly went wrong.
    assert.ok(log.includes(ESC), 'fixture must carry real ESC bytes')
    assert.equal(ESC.charCodeAt(0), 27)
    assert.ok(
      !log.includes(String.raw`\x1b`),
      'a fixture with a literal backslash-x1b tests nothing',
    )
  })

  it('strips them without any shell involved', () => {
    assert.equal(stripAnsi(`${ESC}[31mred${ESC}[39m`), 'red')
    assert.equal(stripAnsi(`${ESC}]8;;http://x${ESC}\\link`), 'link')
  })

  it('finds the suite, the test and the summary through the colour', () => {
    const result = digestLog(log)
    assert.deepEqual(result.failedSuites, [
      'apps/console/specs/billing-meter.spec.ts',
    ])
    assert.deepEqual(result.failedTests, [
      'billing meter › counts the legal-intake receipt',
    ])
    assert.deepEqual(result.summaries, [
      'Tests:       1 failed, 6820 passed, 6821 total',
    ])
    assert.deepEqual(result.failedTasks, ['console:test'])
    assert.equal(result.verdict, VERDICTS.FAILURES)
  })

  it('also handles the CARET-ESCAPED form a downloaded log carries', () => {
    // Two literal printable characters, `^` and `[`. A stripper written only
    // for escape bytes sees nothing to remove here and every matcher
    // downstream comes back empty.
    const caret =
      '^[[2mFailed tasks:^[[22m\n\n^[[2m-^[[22m console:test\n\n' +
      '^[[7m^[[1m^[[31m NX ^[[39m^[[22m^[[27m  ^[[31mRunning target test for 38 projects failed^[[39m\n'
    const result = digestLog(caret)
    assert.deepEqual(result.failedTasks, ['console:test'])
    assert.equal(result.verdict, VERDICTS.INCONCLUSIVE)
  })

  it('strips the GitHub job-log line prefix and group markers', () => {
    assert.equal(
      stripLogPrefix(
        'full (tests + production builds)\tRun npx nx run-many\t2026-08-24T03:42:54.2213203Z Failed tasks:',
      ),
      'Failed tasks:',
    )
    assert.equal(
      stripLogPrefix('##[group]Run npx nx run-many'),
      'Run npx nx run-many',
    )
    // ##[error] survives on purpose: it is a task-failure signal.
    assert.equal(
      stripLogPrefix(
        '2026-08-24T03:42:54.2229640Z ##[error]Process completed with exit code 1.',
      ),
      '##[error]Process completed with exit code 1.',
    )
  })
})

describe('a truncated log that cuts mid-line', () => {
  const cut =
    ' FAIL  apps/console/specs/billing-meter.spec.ts\n' +
    '  ● billing meter › counts the legal-intake rec'

  it('parses the surviving lines instead of throwing', () => {
    const result = digestLog(cut)
    assert.deepEqual(result.failedSuites, [
      'apps/console/specs/billing-meter.spec.ts',
    ])
    assert.equal(result.verdict, VERDICTS.FAILURES)
  })

  it('flags the cut', () => {
    assert.equal(looksTruncated(cut), true)
    assert.equal(looksTruncated('complete\n'), false)
    assert.equal(looksTruncated(''), false)
  })

  it('an INCONCLUSIVE cut log says the log ends mid-line', () => {
    const text = formatDigest(
      digestLog('NX  Running target test for 38 projects failed\n- console'),
    )
    assert.match(text, /INCONCLUSIVE/)
    assert.match(text, /ends mid-line/)
  })

  it('a mid-escape cut does not leave a fragment glued to the path', () => {
    const result = digestLog(
      `${ESC}[31m FAIL ${ESC}[39m apps/console/specs/a.spec.ts\n${ESC}[3`,
    )
    assert.deepEqual(result.failedSuites, ['apps/console/specs/a.spec.ts'])
  })
})

describe('the digest can never itself be truncated', () => {
  it('caps the output at a few hundred lines', () => {
    const many = Array.from(
      { length: 5000 },
      (_, i) => ` FAIL  apps/console/specs/s${i}.spec.ts`,
    ).join('\n')
    const result = digestLog(many)
    assert.equal(result.failedSuites.length, 5000)
    const text = formatDigest(result)
    const lines = text.split('\n')
    // A HARD ceiling, not `CAPS.totalLines + 1`. Bounding the output by the
    // very constant that sets it is the vacuous-green shape: raising the cap
    // to 100,000 raises the assertion with it and the check stays green while
    // the property it names is gone. (Caught by mutation M5.) 400 is a fact
    // about what a reader will actually scroll, independent of the code.
    assert.ok(
      lines.length <= 400,
      `digest was ${lines.length} lines — it must stay small enough that ` +
        'GitHub cannot truncate it, which is its entire reason to exist',
    )
    assert.ok(CAPS.totalLines <= 400, 'the cap itself must stay under 400')
    assert.match(text, /more — see the uploaded log artifact/)
  })
})

describe('the CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agl1617-'))

  it('prints the digest and exits 0 on a readable log', () => {
    const file = join(dir, 'nx-test.log')
    writeFileSync(file, 'NX  Running target test for 38 projects failed\n')
    const out = execFileSync('node', [cliPath, file], { encoding: 'utf8' })
    assert.match(out, /INCONCLUSIVE/)
  })

  it('exits 2 when the log cannot be read — cannot-check is never clean', () => {
    let code = 0
    let stderr = ''
    try {
      execFileSync('node', [cliPath, join(dir, 'nope.log')], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      code = error.status
      stderr = String(error.stderr)
    }
    assert.equal(code, 2)
    assert.match(stderr, /NOT the same as no failures/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('the workflows actually USE the digest (AGL-1617)', () => {
  // A reporter nobody calls is the control we pretend to have. Asserted here
  // rather than from inside either workflow, so deleting the step cannot
  // delete the check on the deletion.
  const repoRoot = join(here, '..', '..', '..')
  const workflows = [
    ['main-gate.yml', 'nx-test-log-main-gate-full'],
    ['nx-ci.yml', 'nx-test-log-nx-ci-main'],
  ]

  for (const [name, artifact] of workflows) {
    it(`${name} tees the test run, digests it, and uploads the raw log`, async () => {
      const { readFileSync } = await import('node:fs')
      const yaml = readFileSync(
        join(repoRoot, '.github', 'workflows', name),
        'utf8',
      )

      // THE line most likely to silently disable the gate. GitHub's default
      // shell is `bash -e {0}` and `-e` does NOT imply pipefail, so
      // `nx ... | tee f` exits with TEE's status — zero, always — and a red
      // test run reports green. Without this assertion the tee is a
      // regression, not an improvement.
      assert.match(
        yaml,
        /set -o pipefail\n\s*npx nx [^\n]*\| tee "\$RUNNER_TEMP\/nx-test\.log"/,
        `${name} must pipe nx into tee UNDER set -o pipefail`,
      )
      assert.match(
        yaml,
        /if: failure\(\)\n\s*run: node tools\/scripts\/lib\/ci-test-digest\.mjs "\$RUNNER_TEMP\/nx-test\.log" --task-failed/,
        `${name} must print the digest on failure`,
      )
      assert.match(
        yaml,
        /uses: actions\/upload-artifact@v4/,
        `${name} must upload the raw log`,
      )
      // Unique per job, or two uploads in one run collide and the second is
      // rejected.
      assert.match(
        yaml,
        new RegExp(`name: ${artifact}\\b`),
        `${name} artifact name`,
      )
    })
  }

  it('the two artifact names are distinct', () => {
    const names = workflows.map(([, artifact]) => artifact)
    assert.equal(new Set(names).size, names.length)
  })
})
