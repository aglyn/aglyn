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

// Fails when a package-lock.json disagrees with the package.json beside it
// about the version (AGL-2108).
//
//   node tools/scripts/check-manifest-versions.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  evaluateManifestVersions,
  formatManifestVersionFailure,
} from './lib/manifest-versions.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Ask git, not the filesystem: an UNTRACKED lockfile is somebody's local
 * experiment and a nested node_modules is full of them — the same reasoning
 * `check-standalone-installs.mjs` records. Derived rather than hard-coded so
 * a fourth manifest is covered the day it lands.
 */
function lockfileDirs() {
  const out = execFileSync('git', ['ls-files', 'package-lock.json', '*/package-lock.json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .filter(Boolean)
    .map((file) => file.slice(0, -'package-lock.json'.length).replace(/\/$/, ''))
    .filter((dir) => !dir.split('/').includes('node_modules'))
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const pairs = lockfileDirs().map((dir) => ({
  dir,
  packageJson: readJson(join(repoRoot, dir, 'package.json')),
  lockJson: readJson(join(repoRoot, dir, 'package-lock.json')),
}))

const result = evaluateManifestVersions(pairs)

if (result.ok) {
  console.log(
    `package.json / package-lock.json versions agree in ${result.checked} manifest(s): ` +
      pairs.map((pair) => pair.dir || '<root>').join(', '),
  )
  process.exit(0)
}

console.error(formatManifestVersionFailure(result))
process.exit(1)
