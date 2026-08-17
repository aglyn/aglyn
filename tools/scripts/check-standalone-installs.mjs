#!/usr/bin/env node
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

// Fails when a package inside this repo carries its own lockfile — and so is
// installed separately from the root — but the CI workflow never installs it
// (AGL-1781).
//
//   node tools/scripts/check-standalone-installs.mjs
//
// Two such packages exist today, apps/docs and cloud/functions, and each has
// already produced one red that read as a source defect. See
// tools/scripts/lib/standalone-installs.mjs for why they stay standalone
// rather than becoming npm workspaces.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LOCKFILE,
  evaluateStandaloneInstalls,
  formatFailure,
} from './lib/standalone-installs.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WORKFLOW = join('.github', 'workflows', 'nx-ci.yml')

/**
 * Ask git, not the filesystem: an UNTRACKED lockfile is somebody's local
 * experiment, and a nested node_modules is full of them. `git ls-files` sees
 * neither.
 */
function standalonePackageDirs() {
  const out = execFileSync('git', ['ls-files', `*/${LOCKFILE}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .filter(Boolean)
    .map((file) => file.slice(0, -(LOCKFILE.length + 1)))
    .filter((dir) => dir && !dir.split('/').includes('node_modules'))
}

const packageDirs = standalonePackageDirs()
const workflow = readFileSync(join(repoRoot, WORKFLOW), 'utf8')
const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

const result = evaluateStandaloneInstalls({
  packageDirs,
  workflow,
  rootWorkspaces: rootPkg.workspaces,
})

if (result.ok) {
  const listed = packageDirs.length === 0 ? 'none' : packageDirs.join(', ')
  console.log(
    `Standalone packages installed by ${WORKFLOW.split(sep).join('/')}: ${listed}`,
  )
  process.exit(0)
}

console.error(formatFailure(result, WORKFLOW.split(sep).join('/')))
process.exit(1)
