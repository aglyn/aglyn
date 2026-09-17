/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aiActiveProvider } from './ai-runtime'

/**
 * A LIVE EVAL RUN KEEPS THE PROVIDER KEY IT WAS STARTED WITH (AGL-3038).
 *
 * `npm run eval:ai-live` from a checkout whose repo-root `.env` holds the
 * provider key stopped before its first request, saying the key was not set,
 * with the key set: the shared jest setup deletes every value the `.env` also
 * defines (AGL-690), and the key the operator passed is one of them.
 *
 * This runs the REAL launcher with `npx` swapped for a stand-in that loads a
 * copy of the REAL `jest.setup.js` beside a `.env` holding a made-up key, and
 * reports what the setup left. Reverting either half of the fix — the mark the
 * launcher sets, or the setup honoring it — turns it red, and no provider is
 * ever asked anything.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const LAUNCHER = join(REPO_ROOT, 'tools', 'ai-eval', 'record-live.mjs')
const LIVE_SPEC = 'libs/plugins/ai/src/lib/runtime/ai-eval.live.spec.ts'
const MADE_UP_KEY = 'agl-3038-made-up-key-for-this-spec'

/** The key the recorders' provider reads, named by the provider itself. */
const KEY_ENV = aiActiveProvider()?.apiKeyEnv ?? ''

interface SetupReport {
  /** Whether the setup left the key as the run was handed it. */
  keyKept: boolean
  /** What the stand-in `npx` was asked to run. */
  args: string[]
}

/**
 * A sandbox holding the setup as jest loads it — every root `jest.setup*.js`,
 * beside a `.env` holding the key — and a stand-in `npx` that loads it and
 * writes a report instead of starting jest.
 */
function sandbox(): { dir: string; bin: string; report: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agl-3038-'))
  for (const name of readdirSync(REPO_ROOT)) {
    if (/^jest\.setup.*\.js$/.test(name)) copyFileSync(join(REPO_ROOT, name), join(dir, name))
  }
  writeFileSync(join(dir, '.env'), `${KEY_ENV}=${MADE_UP_KEY}\n`)
  const bin = join(dir, 'bin')
  const report = join(dir, 'report.json')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'npx'),
    [
      '#!/usr/bin/env node',
      `require(${JSON.stringify(join(dir, 'jest.setup.js'))})`,
      `require('node:fs').writeFileSync(${JSON.stringify(report)}, JSON.stringify({`,
      `  keyKept: process.env[${JSON.stringify(KEY_ENV)}] === ${JSON.stringify(MADE_UP_KEY)},`,
      '  args: process.argv.slice(2),',
      '}))',
      '',
    ].join('\n'),
  )
  chmodSync(join(bin, 'npx'), 0o755)
  return { dir, bin, report }
}

/** Runs `command` in a fresh sandbox with `env`, and reads what the stand-in saw. */
function run(
  command: (bin: string) => string[],
  env: Record<string, string>,
): { status: number | null; report: SetupReport | null } {
  const box = sandbox()
  try {
    const [file, ...args] = command(box.bin)
    const result = spawnSync(file, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      // The stand-in loads the setup from outside the repo, so dotenv is found
      // through NODE_PATH; the control below proves it was.
      env: {
        NODE_ENV: 'test',
        PATH: `${box.bin}:${process.env['PATH'] ?? ''}`,
        NODE_PATH: join(REPO_ROOT, 'node_modules'),
        ...env,
      },
    })
    let report: SetupReport | null = null
    try {
      report = JSON.parse(readFileSync(box.report, 'utf8')) as SetupReport
    } catch {
      report = null
    }
    return { status: result.status, report }
  } finally {
    rmSync(box.dir, { recursive: true, force: true })
  }
}

const viaLauncher = () => [process.execPath, LAUNCHER]
const viaJestDirectly = (bin: string) => [join(bin, 'npx'), 'jest']

describe('a live eval run keeps the provider key it was started with (AGL-3038)', () => {
  it('names a provider key to test with', () => {
    expect(KEY_ENV).toMatch(/^[A-Z][A-Z0-9_]+$/)
  })

  it('the launcher starts jest with the key still set, where the repo-root .env holds the same key', () => {
    const { status, report } = run(viaLauncher, { AI_EVAL_LIVE: '1', [KEY_ENV]: MADE_UP_KEY })
    expect(status).toBe(0)
    expect(report?.keyKept).toBe(true)
  })

  it('the launcher names the live spec by path, so the unit spec its name also matches does not run', () => {
    const { report } = run(viaLauncher, { AI_EVAL_LIVE: '1', [KEY_ENV]: MADE_UP_KEY })
    const args = report?.args ?? []
    expect(args.indexOf('--runTestsByPath')).toBeGreaterThanOrEqual(0)
    expect(args[args.indexOf('--runTestsByPath') + 1]).toBe(LIVE_SPEC)
  })

  it('CONTROL: a live run jest was started for any other way loses the key, as nx test does', () => {
    // Proves the sandbox's setup really scrubs — dotenv found, `.env` read — so
    // the kept key above is the mark working and not a scrub that never ran.
    const { report } = run(viaJestDirectly, { AI_EVAL_LIVE: '1', [KEY_ENV]: MADE_UP_KEY })
    expect(report?.keyKept).toBe(false)
  })

  it('CONTROL: the mark alone keeps nothing without AI_EVAL_LIVE=1', () => {
    const { report } = run(viaJestDirectly, {
      AI_EVAL_LIVE_LAUNCHER: 'tools/ai-eval/record-live.mjs',
      [KEY_ENV]: MADE_UP_KEY,
    })
    expect(report?.keyKept).toBe(false)
  })

  it('CONTROL: without AI_EVAL_LIVE=1 the launcher refuses and starts nothing', () => {
    const { status, report } = run(viaLauncher, { [KEY_ENV]: MADE_UP_KEY })
    expect(status).toBe(1)
    expect(report).toBeNull()
  })
})
