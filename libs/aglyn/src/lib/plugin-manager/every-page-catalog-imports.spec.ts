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

import { readFileSync } from 'fs'
import { resolve } from 'path'

import { FIRST_PARTY_PLUGIN_SWITCHES } from './first-party-plugin-switchboard.generated'
import {
  ANALYTICS_PROVIDERS_DECLARED,
  FIRST_PARTY_FUNCTION_BINDINGS,
  FIRST_PARTY_PLUGINS,
  PLUGIN_EDIT_BAR_LINKS,
  PLUGIN_INTERACTION_RECIPES_DECLARED,
  PLUGIN_INTERACTION_STEPS_DECLARED,
  PUBLISHED_SITE_IMPACT,
} from './first-party-plugins.generated'
import * as switchboard from './first-party-plugin-switchboard.generated'
import * as interactions from './first-party-plugin-interactions.generated'

/**
 * What the every-page modules may import (AGL-4220).
 *
 * A bundler keeps a module whole for every export any importer reads, so a
 * module on every published page that reads ONE name from the catalog file
 * puts the whole catalog on every page: each row's Admin › Plugins copy, the
 * plan figures, usage meters, notification categories and interaction steps.
 * That, with the canvas store's lodash `isEqual` and `cloneDeep`, was about
 * 10 KB of the tenant's "every published page" wire weight. These modules run
 * on every published page, and read the small generated modules instead.
 */

const LIB = resolve(__dirname, '..')
const source = (path: string) => readFileSync(resolve(LIB, path), 'utf8')

/** Every `import … from '<specifier>'` statement, comments ignored. */
const importsOf = (text: string) =>
  [
    ...text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .matchAll(/^import\s+(type\s+)?[\s\S]*?\sfrom\s+'([^']+)'/gm),
  ].map((match) => ({ typeOnly: Boolean(match[1]), specifier: match[2] }))

const EVERY_PAGE_CATALOG_READERS = [
  'plugin-manager/enabled-plugins.ts',
  'app-utils/visitor-consent.ts',
  'app-utils/site-interactions.ts',
  'plugin-manager/interaction-recipes.ts',
]

describe('the every-page modules read the small generated modules (AGL-4220)', () => {
  it.each(EVERY_PAGE_CATALOG_READERS)(
    '%s imports no value from the catalog file',
    (path) => {
      const fromCatalog = importsOf(source(path)).filter(
        (entry) =>
          !entry.typeOnly &&
          /first-party-plugins\.generated$/.test(entry.specifier),
      )
      expect(fromCatalog).toEqual([])
    },
  )

  it('the canvas store imports nothing from lodash', () => {
    const lodash = importsOf(source('canvas-manager/canvas-manager.ts')).filter(
      (entry) => /^lodash/.test(entry.specifier),
    )
    expect(lodash).toEqual([])
  })
})

describe('the small generated modules agree with the catalog (AGL-4220)', () => {
  it('holds every catalog row, in order, without its console copy', () => {
    expect(FIRST_PARTY_PLUGIN_SWITCHES).toEqual(
      FIRST_PARTY_PLUGINS.map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(
            ([key]) => key !== 'description' && key !== 'siteOff',
          ),
        ),
      ),
    )
    for (const row of FIRST_PARTY_PLUGIN_SWITCHES) {
      expect(Object.keys(row)).not.toContain('description')
      expect(Object.keys(row)).not.toContain('siteOff')
    }
  })

  it('the catalog file re-exports the same objects, so its importers are unchanged', () => {
    expect(PUBLISHED_SITE_IMPACT).toBe(switchboard.PUBLISHED_SITE_IMPACT)
    expect(PLUGIN_EDIT_BAR_LINKS).toBe(switchboard.PLUGIN_EDIT_BAR_LINKS)
    expect(ANALYTICS_PROVIDERS_DECLARED).toBe(
      switchboard.ANALYTICS_PROVIDERS_DECLARED,
    )
    expect(FIRST_PARTY_FUNCTION_BINDINGS).toBe(
      switchboard.FIRST_PARTY_FUNCTION_BINDINGS,
    )
    expect(PLUGIN_INTERACTION_STEPS_DECLARED).toBe(
      interactions.PLUGIN_INTERACTION_STEPS_DECLARED,
    )
    expect(PLUGIN_INTERACTION_RECIPES_DECLARED).toBe(
      interactions.PLUGIN_INTERACTION_RECIPES_DECLARED,
    )
  })
})
