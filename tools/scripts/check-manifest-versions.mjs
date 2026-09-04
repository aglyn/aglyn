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

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  evaluateManifestVersions,
  formatManifestVersionFailure,
  readManifestPairs,
} from './lib/manifest-versions.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const pairs = readManifestPairs(repoRoot)

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
