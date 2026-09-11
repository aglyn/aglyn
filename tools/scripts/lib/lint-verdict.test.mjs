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
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { VERDICTS, describeLintVerdict, lintVerdict } from './lint-verdict.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

// The shape Main Gate run 34540545704 printed: a warning listing cut off
// mid-file, no summary, and nx's failed-task list.
const CUT_OFF_WARNINGS = `
 NX   Running target lint for 54 projects:

> nx run console:lint

Linting "console"...
/home/runner/work/aglyn/aglyn/apps/console/app/api/admin/org-refund/route.ts
   2:4   warning  tsdoc-undefined-tag: The TSDoc tag "@license" is not defined in this configuration  tsdoc/syntax

/home/runner/work/aglyn/aglyn/apps/console/app/api/admin/reverify-plugin-versions/route.ts

 NX   Running target lint for 54 projects failed

Failed tasks:

- console:lint
`

// The same red under --quiet, as reproduced locally on the same tree.
const QUIET_ERROR = `
> nx run console:lint --quiet

Linting "console"...
Quiet mode enabled - filtering out warnings
/home/runner/work/aglyn/aglyn/apps/console/specs/dataset-custom-field-validators.spec.ts
  39:1  error  A project tagged with "scope:app" can not depend on libs tagged with "aglyn:addons"

Violation detected in:
- plugins-marketplace
- plugins-marketplace -> plugins-mui  @nx/enforce-module-boundaries

✖ 1 problem (1 error, 0 warnings)

 NX   Running target lint for 53 projects failed

Failed tasks:

- console:lint
`

describe('lintVerdict', () => {
  it('grades the cut-off report as INCONCLUSIVE, never as a clean or an error verdict', () => {
    const result = lintVerdict({ log: CUT_OFF_WARNINGS, exits: [1, 0] })
    assert.equal(result.verdict, VERDICTS.INCONCLUSIVE)
    assert.deepEqual(result.failedTasks, ['console:lint'])
    assert.equal(result.errorRows, 0)
  })

  it('grades a quiet report with an error row as ERRORS and names the task', () => {
    const result = lintVerdict({ log: QUIET_ERROR, exits: [1, 0] })
    assert.equal(result.verdict, VERDICTS.ERRORS)
    assert.deepEqual(result.failedTasks, ['console:lint'])
    assert.equal(result.errorRows, 1)
    assert.equal(result.summarizedErrors, 1)
  })

  it('does not read the boundary rule\'s project list as failed tasks', () => {
    const result = lintVerdict({ log: QUIET_ERROR, exits: [1, 0] })
    assert.ok(!result.failedTasks.some((task) => task.includes('plugins-marketplace')))
  })

  it('reads an error row through the caret-escaped color a downloaded job log carries', () => {
    const log =
      '2026-09-10T23:10:06.6823993Z   ^[[2m39:1^[[22m  ^[[31merror^[[39m  Unnecessary escape character  ^[[2mno-useless-escape^[[22m\n' +
      '2026-09-10T23:10:06.6862044Z ^[[2m-^[[22m aglyn:lint\n'
    const result = lintVerdict({ log, exits: [1, 0] })
    assert.equal(result.verdict, VERDICTS.ERRORS)
    assert.equal(result.errorRows, 1)
  })

  it('counts an error summary even when the rows above it were lost', () => {
    const log = '✖ 3 problems (2 errors, 1 warning)\n\nFailed tasks:\n\n- tenant:lint\n'
    assert.equal(lintVerdict({ log, exits: [1, 0] }).verdict, VERDICTS.ERRORS)
  })

  it('grades an exit code of 128 or more as KILLED, with the signal', () => {
    const result = lintVerdict({ log: CUT_OFF_WARNINGS, exits: [137, 0] })
    assert.equal(result.verdict, VERDICTS.KILLED)
    assert.deepEqual(result.signals, [9])
  })

  it('grades a heap exhaustion in the log as KILLED even when nx exited 1', () => {
    const log =
      '> nx run console:lint --quiet\n\n' +
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n\n' +
      'Failed tasks:\n\n- console:lint\n'
    const result = lintVerdict({ log, exits: [1, 0] })
    assert.equal(result.verdict, VERDICTS.KILLED)
    assert.match(result.deaths[0], /heap out of memory/)
  })

  it('does not read a lint MESSAGE that names a signal as a death', () => {
    const log = '/x/a.ts\n  12:3  warning  Unexpected console statement: "Killed by SIGTERM"  no-console\n\nFailed tasks:\n\n- console:lint\n'
    assert.equal(lintVerdict({ log, exits: [1, 0] }).verdict, VERDICTS.INCONCLUSIVE)
  })

  it('grades a red that only the second command produced', () => {
    const log = '/home/runner/work/aglyn/aglyn/cloud/functions/src/index.ts\n  4:7  error  \'unused\' is assigned a value but never used  no-unused-vars\n\n✖ 1 problem (1 error, 0 warnings)\n'
    assert.equal(lintVerdict({ log, exits: [0, 1] }).verdict, VERDICTS.ERRORS)
  })

  it('is CLEAN when every command exited 0, warnings and all', () => {
    const log = '/x/a.ts\n  2:4  warning  tsdoc-undefined-tag  tsdoc/syntax\n\n✖ 1 problem (0 errors, 1 warning)\n'
    assert.equal(lintVerdict({ log, exits: [0, 0] }).verdict, VERDICTS.CLEAN)
  })

  it('refuses to grade without exit codes rather than guessing', () => {
    assert.throws(() => lintVerdict({ log: QUIET_ERROR, exits: [] }), /exit code/)
    assert.throws(() => lintVerdict({ log: QUIET_ERROR, exits: ['x'] }), /exit code/)
  })
})

describe('describeLintVerdict', () => {
  it('tells the reader of an inconclusive red how to read the lost report', () => {
    const { level, text } = describeLintVerdict(lintVerdict({ log: CUT_OFF_WARNINGS, exits: [1, 0] }))
    assert.equal(level, 'error')
    assert.match(text, /console:lint/)
    assert.match(text, /--quiet/)
  })

  it('says a killed lint is not a finding', () => {
    const { text } = describeLintVerdict(lintVerdict({ log: '', exits: [143, 0] }))
    assert.match(text, /signal 15/)
    assert.match(text, /not a lint finding/)
  })
})

describe('report-lint-verdict.mjs', () => {
  const cli = join(repoRoot, 'tools', 'scripts', 'report-lint-verdict.mjs')

  const run = (log, exits) => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-verdict-'))
    const path = join(dir, 'nx-lint.log')
    writeFileSync(path, log)
    try {
      const stdout = execFileSync('node', [cli, path, ...exits.map(String)], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
      })
      return { code: 0, stdout }
    } catch (error) {
      return { code: error.status, stdout: String(error.stdout) }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('exits 1 with an error annotation for an inconclusive red', () => {
    const { code, stdout } = run(CUT_OFF_WARNINGS, [1, 0])
    assert.equal(code, 1)
    assert.match(stdout, /^::error::lint: console:lint failed and the log holds no error/m)
  })

  it('exits 0 for a clean step', () => {
    assert.equal(run('', [0, 0]).code, 0)
  })
})

describe('the workflows grade their lint step (AGL-2829)', () => {
  // Asserted from outside both workflows, so deleting the step cannot delete
  // the check on the deletion.
  for (const name of ['main-gate.yml', 'nx-ci.yml']) {
    it(`${name} lints with --quiet and grades the log`, () => {
      const yaml = readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8')
      assert.match(yaml, /nx (?:run-many|affected) -t lint [^\n]*--exclude=cloud-functions[^\n]*--quiet/)
      assert.match(yaml, /node tools\/scripts\/report-lint-verdict\.mjs "\$log"/)
    })
  }
})
