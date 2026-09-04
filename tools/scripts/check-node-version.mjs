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

// Fails when anything under `.github` names its own node version, or when
// `.nvmrc` and `engines.node` disagree (AGL-2531).
//
//   node tools/scripts/check-node-version.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  evaluateNodeVersions,
  formatNodeVersionFailure,
  NODE_VERSION_FILE,
  RUNTIME_PINNED_PACKAGES,
} from './lib/node-version.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Ask git rather than walking the filesystem, the way
 * `check-manifest-versions.mjs` does: an untracked workflow is somebody's
 * local experiment and cannot affect CI.
 *
 * The whole `.github` tree, filtered by extension HERE rather than by a
 * double-star pathspec. Git's double-star does not match zero directories, so
 * a `.github` + double-star + `.yml` pathspec silently skips the THREE tracked
 * yaml files that sit directly in `.github` — FUNDING, dependabot and labeler.
 * None carries a node pin today, which is exactly what lets that kind of blind
 * spot survive: it reads as coverage and supplies none.
 */
function trackedWorkflowFiles() {
  const out = execFileSync('git', ['ls-files', '.github'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return out.split('\n').filter((file) => /\.ya?ml$/.test(file))
}

/** Every `node-version:` literal, with enough context to name it in a failure. */
function hardcodedPins() {
  const pins = []
  for (const file of trackedWorkflowFiles()) {
    const text = readFileSync(join(repoRoot, file), 'utf8')
    text.split('\n').forEach((line, index) => {
      // `node-version-file:` is the form this guard is asking for, so it must
      // not match — hence the boundary before the colon.
      const match = /^\s*node-version:\s*(\S+)/.exec(line)
      if (match) pins.push({ file, line: index + 1, value: match[1] })
    })
  }
  return pins
}

const nvmrc = (() => {
  try {
    return readFileSync(join(repoRoot, NODE_VERSION_FILE), 'utf8')
  } catch {
    return ''
  }
})()

const engines = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
).engines?.node

const result = evaluateNodeVersions({
  nvmrc,
  engines,
  workflows: hardcodedPins(),
})

if (result.ok) {
  console.log(
    `node ${result.major} everywhere: ${NODE_VERSION_FILE} agrees with ` +
      `engines.node "${engines}", and no workflow names its own. ` +
      `Runtime-pinned deploy targets exempt: ${RUNTIME_PINNED_PACKAGES.join(', ')}.`,
  )
  process.exit(0)
}

console.error(formatNodeVersionFailure(result))
process.exit(1)
