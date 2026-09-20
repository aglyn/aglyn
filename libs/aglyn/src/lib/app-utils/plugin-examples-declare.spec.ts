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
 * The example plugins publish as they stand (AGL-3116).
 *
 * `examples/plugins/*` is what a publisher copies, so each one must pass the
 * checks the publish pipeline runs on a NEW version: its manifest validates,
 * and its bundle registers nothing its `contributes` does not declare. An
 * example that only passed under the legacy default would teach every
 * publisher to ship a plugin the loaders cannot place.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkPluginBundle } from './plugin-bundle-checks'
import { validatePluginManifest } from './plugin-manifest'

const EXAMPLES = resolve(__dirname, '../../../../../examples/plugins')

const examples = readdirSync(EXAMPLES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

describe('example plugins (AGL-3116)', () => {
  it('finds the examples', () => {
    expect(examples.length).toBeGreaterThan(0)
  })

  it.each(examples)('%s validates and verifies as a new version would', (name) => {
    const manifestInput = JSON.parse(
      readFileSync(join(EXAMPLES, name, 'manifest.json'), 'utf8'),
    )
    const validation = validatePluginManifest(manifestInput)
    expect([name, validation.ok]).toEqual([name, true])
    if (validation.ok === false) return
    const manifest = validation.manifest
    expect([name, manifest.contributes === undefined]).toEqual([name, false])
    const bundle = readFileSync(join(EXAMPLES, name, 'dist', manifest.entry), 'utf8')
    const result = checkPluginBundle(bundle, {
      declaredNetwork: manifest.capabilities?.network ?? [],
      declaredContributions: manifest.contributes ?? null,
      requireContributions: true,
    })
    expect([name, result.problems]).toEqual([name, []])
  })
})
