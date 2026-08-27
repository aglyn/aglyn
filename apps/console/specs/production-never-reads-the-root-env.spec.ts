/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')

/**
 * The shared Next config reads the repo-root `.env` in DEVELOPMENT only.
 *
 * ## Why it reads it at all
 *
 * Next loads env files from the APP directory, so a key written to the
 * monorepo root is invisible to `apps/console` while the tooling in
 * `tools/scripts` reads root explicitly and sees it fine. That split is a trap
 * rather than a convention: `RESEND_API_KEY` sat in the root `.env` while the
 * console's own email probe reported the key MISSING and pointed the reader at
 * Vercel — the wrong place, in the wrong environment.
 *
 * ## Why production must not
 *
 * Vercel injects the real environment. Reading a file there would let a stray
 * checked-out `.env` shadow it, which is how a staging secret reaches
 * production traffic — a much worse failure than the one being fixed.
 *
 * Asserted by RUNNING the config in a child process under each `NODE_ENV`,
 * rather than by reading the source for an `if`. A guard that greps for the
 * condition passes while the condition is inverted.
 */
const loadUnder = (nodeEnv: string): boolean => {
  const script = `
    process.env.NODE_ENV = ${JSON.stringify(nodeEnv)}
    delete process.env.AGLYN_ROOT_ENV_PROBE
    require(${JSON.stringify(join(REPO_ROOT, 'with-aglyn.nextjs.config.js'))})
    process.stdout.write(process.env.AGLYN_ROOT_ENV_PROBE ? 'yes' : 'no')
  `
  return (
    execFileSync(process.execPath, ['-e', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: nodeEnv } as NodeJS.ProcessEnv,
    }).trim() === 'yes'
  )
}

describe('the repo-root .env reaches development and never production', () => {
  /*
   * The probe key is written into the root `.env` for the duration of this
   * spec rather than asserting on a real one: a real key's presence is a fact
   * about somebody's machine, and this has to hold on a clean checkout and in
   * CI where the file may not exist at all.
   */
  const envPath = join(REPO_ROOT, '.env')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs')
  let restore: string | null = null
  let created = false

  beforeAll(() => {
    if (fs.existsSync(envPath)) restore = fs.readFileSync(envPath, 'utf8')
    else created = true
    fs.writeFileSync(
      envPath,
      `${restore ?? ''}\nAGLYN_ROOT_ENV_PROBE=1\n`,
    )
  })

  afterAll(() => {
    // Restored byte-for-byte. This file holds real credentials on a
    // developer's machine and is not this spec's to edit.
    if (created) fs.unlinkSync(envPath)
    else if (restore !== null) fs.writeFileSync(envPath, restore)
  })

  it('development picks the root file up', () => {
    expect(loadUnder('development')).toBe(true)
  })

  it('production does NOT', () => {
    expect(loadUnder('production')).toBe(false)
  })
})
