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
 * A plugin's field validator runs on every console path that writes a record
 * (AGL-2773).
 *
 * `validateCustomFieldValue` answers "no error" for a custom type nobody
 * registered, and a type is registered only when its plugin's server entry
 * loads. The console-served record write paths — `/api/orgs/datasets`, the
 * `/v1` dataset handlers and site import — are the data plugin's, and its
 * helper (`loadCustomFieldTypes`, held by the plugin's own spec) asks the
 * caller to load every plugin's console surface before validating.
 *
 * Two halves are held here: each write path calls a loader between deriving
 * the model and validating against it, and each CALLER the plugin asks — the
 * `/v1` router's context and the site restore — really does load the plugins.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The console-served paths that validate a record before writing it, from
 * the repo root: the data plugin's console API, its `/v1` datasets and its
 * section of a site restore.
 */
const RECORD_WRITERS = [
  'libs/plugins/data/src/lib/server/datasets-route.ts',
  'libs/plugins/data/src/lib/server/api-v1/datasets.ts',
  'libs/plugins/data/src/lib/site-bundle/datasets-site-bundle.server.ts',
]

describe('every console record write loads custom field types first', () => {
  it.each(RECORD_WRITERS)('%s', (file) => {
    const source = readFileSync(join(__dirname, '../../..', file), 'utf8')
    const validations = [...source.matchAll(/validateDocument\(/g)].map(
      (match) => match.index ?? 0,
    )
    // A path that stopped validating would pass the loop below vacuously.
    expect(validations.length).toBeGreaterThan(0)
    for (const at of validations) {
      const modelAt = source.lastIndexOf('effectiveDatasetModel(', at)
      expect(modelAt).toBeGreaterThan(-1)
      // The plugin's loader, or the platform's own repair step a route the
      // dispatcher serves runs: either registers the types before the check.
      expect(source.slice(modelAt, at)).toMatch(
        /(?:loadCustomFieldTypes|ensureDeclaredCustomFieldTypes)\(/,
      )
    }
  })
})

describe('a site restore', () => {
  it('loads every plugin’s console API surface when a section asks it to', () => {
    const route = readFileSync(
      join(__dirname, '..', 'app/api/hosts/import/route.ts'),
      'utf8',
    )
    const at = route.indexOf('loadPluginSurfaces:')
    expect(at).toBeGreaterThan(-1)
    expect(route.slice(at, route.indexOf('},', at))).toContain(
      "serverPluginLoader.ensureAll(['consoleApi'])",
    )
  })
})

describe('the /v1 router', () => {
  it('hands its handlers a loader for every plugin’s console API surface', () => {
    const router = readFileSync(join(__dirname, '..', 'utils/api-v1.ts'), 'utf8')
    const at = router.indexOf('loadPluginSurfaces:')
    expect(at).toBeGreaterThan(-1)
    expect(router.slice(at, router.indexOf('},', at))).toContain(
      "serverPluginLoader.ensureAll(['consoleApi'])",
    )
  })
})
