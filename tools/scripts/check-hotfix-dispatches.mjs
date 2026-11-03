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

// Fails when a workflow a push to `production` starts is in neither of
// `auto-merge-green.yml`'s two lists, so a hotfix promotion the sweep merges
// would ship without it (AGL-4051). See `lib/hotfix-dispatches.mjs`.
//
//   node tools/scripts/check-hotfix-dispatches.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DISPATCH_LIST,
  evaluateHotfixDispatches,
  SKIP_LIST,
  SWEEP_WORKFLOW,
} from './lib/hotfix-dispatches.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Tracked files only: an untracked workflow cannot run in CI.
const files = execFileSync('git', ['ls-files', '.github/workflows'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => /\.ya?ml$/.test(file))

const workflows = Object.fromEntries(
  files.map((file) => [
    basename(file),
    readFileSync(join(repoRoot, file), 'utf8'),
  ]),
)

const result = evaluateHotfixDispatches(workflows)

if (result.ok) {
  console.log(
    `${result.reaching.length} workflows run on a push to production. ` +
      `${SWEEP_WORKFLOW} dispatches ${result.dispatched.length} of them after a ` +
      `hotfix merge (${DISPATCH_LIST}) and leaves out ${result.skipped.length} ` +
      `on purpose (${SKIP_LIST}).`,
  )
  process.exit(0)
}

console.error(`${SWEEP_WORKFLOW} and the production workflows disagree:`)
for (const problem of result.problems) console.error(`  - ${problem}`)
process.exit(1)
