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
 * Predeploy guard: refuse `firebase deploy --only functions` from a checkout
 * whose dotenv does not set the origins the scheduled functions POST.
 *
 * firebase-functions v2 writes the variables in `cloud/functions/.env` onto
 * every function it deploys, and that file is gitignored. A deploy from a
 * fresh worktree has no `.env`, so it deploys each function WITHOUT
 * `AGLYN_CONSOLE_URL` — and every beat then logs "skipped — set
 * AGLYN_CONSOLE_URL" and does nothing, with the only symptom a red row on
 * `/api/health/crons` an hour and a half later.
 *
 * That is what happened on 2026-10-09: `consoleRetentionEmails` was first
 * deployed at 14:18Z from such a checkout, its 14:20Z run was skipped, and it
 * ran only after a redeploy with the dotenv at 14:37Z.
 *
 * Set AGLYN_ALLOW_UNCONFIGURED_FUNCTIONS=1 to deploy without them anyway
 * (a self-hoster who runs none of the beats).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED = ['AGLYN_CONSOLE_URL', 'AGLYN_JOB_RUNNER_URL']

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Every dotenv firebase-tools would read here, merged; `.env.example` is not one. */
function readDotenv() {
  const values = {}
  const files = readdirSync(root).filter(
    (name) => (name === '.env' || name.startsWith('.env.')) && name !== '.env.example',
  )
  for (const name of files) {
    const path = join(root, name)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!match) continue
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2').trim()
      if (value) values[match[1]] = value
    }
  }
  return { values, files }
}

if (process.env.AGLYN_ALLOW_UNCONFIGURED_FUNCTIONS === '1') process.exit(0)

const { values, files } = readDotenv()
const missing = REQUIRED.filter((name) => !values[name])
if (missing.length) {
  console.error(
    `\nRefusing to deploy functions: ${missing.join(', ')} not set in ` +
      `${files.length ? files.join(', ') : 'any dotenv'} under cloud/functions.\n` +
      'The dotenv is gitignored, so a worktree has none: copy cloud/functions/.env ' +
      'from the main checkout (see .env.example). Deploying without it leaves every ' +
      'scheduled function skipping its run.\n' +
      'Set AGLYN_ALLOW_UNCONFIGURED_FUNCTIONS=1 to deploy anyway.\n',
  )
  process.exit(1)
}
