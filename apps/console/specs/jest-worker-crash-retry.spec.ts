/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `tools/jest/worker-crash-retry.js`, driven by a worker that really does
 * segfault (AGL-2528).
 *
 * A jest worker dying on SIGSEGV takes down whichever test file it was
 * carrying, and jest reports that file as `Test suite failed to run` with no
 * assertion behind it. The workspace runner re-dispatches such a file once.
 * That claim is only worth anything if a worker crash still turns a run red
 * WITHOUT it, so both halves run here: the same fixture under the workspace
 * runner and under jest's stock one.
 *
 * The fixture crashes exactly once, keyed on a marker file, so the retry has
 * something to succeed at.
 *
 * Two conditions have to hold for the crash to land on a WORKER rather than on
 * jest itself, and `shouldRunInBand` in `@jest/core` is where both come from.
 * A batch of one file always runs in band, so a second, uneventful file rides
 * along; and a batch runs in band once cached timings say it is fast, so each
 * run gets a throwaway `cacheDirectory`. An in-band crash kills the jest
 * process outright and exercises nothing this file is about.
 */

const repoRoot = join(__dirname, '..', '..', '..')
const jestBin = join(repoRoot, 'node_modules', 'jest', 'bin', 'jest.js')
const workspaceRunner = join(repoRoot, 'tools', 'jest', 'worker-crash-retry.js')

const FIXTURE = `
const fs = require('node:fs')

const marker = process.env.CRASH_MARKER

if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, 'crashed once')
  process.kill(process.pid, 'SIGSEGV')
  // Reached only if the signal was not delivered, in which case the premise of
  // the whole file is gone and saying so beats a green that proves nothing.
  throw new Error('SIGSEGV was not delivered to the worker')
}

test('runs on the worker that replaced the one which crashed', () => {
  expect(fs.existsSync(marker)).toBe(true)
})
`

const COMPANION = `
test('keeps the batch above the one-file threshold for in-band running', () => {
  expect(true).toBe(true)
})
`

function runFixture(runner: string) {
  const dir = mkdtempSync(join(tmpdir(), 'agl-2528-'))
  try {
    writeFileSync(join(dir, 'crash-once.fixture.js'), FIXTURE)
    writeFileSync(join(dir, 'companion.fixture.js'), COMPANION)
    writeFileSync(
      join(dir, 'jest.config.json'),
      JSON.stringify({
        rootDir: dir,
        testEnvironment: 'node',
        testMatch: ['**/*.fixture.js'],
        transform: {},
        cacheDirectory: join(dir, 'cache'),
        runner,
      }),
    )
    // Two workers, not one: `--maxWorkers=1` also sends the batch in band.
    const result = spawnSync(
      process.execPath,
      [jestBin, '--config', join(dir, 'jest.config.json'), '--maxWorkers=2'],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, CRASH_MARKER: join(dir, 'marker') },
      },
    )
    return {
      status: result.status,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    }
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}

describe('a jest worker killed by SIGSEGV', () => {
  it('fails the run under the stock jest runner', () => {
    const { status, output } = runFixture(require.resolve('jest-runner'))

    // The half that proves the fixture crashes for real. If this ever goes
    // green, the test below is measuring nothing.
    expect(status).not.toBe(0)
    expect(output).toContain('signal=SIGSEGV')
  }, 120_000)

  it('is re-dispatched to a fresh worker under the workspace runner', () => {
    const { status, output } = runFixture(workspaceRunner)

    expect(output).toContain('Re-running that file on a fresh worker')
    expect(status).toBe(0)
    expect(output).toContain('2 passed')
  }, 120_000)
})
