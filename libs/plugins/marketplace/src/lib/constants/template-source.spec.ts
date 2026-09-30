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
 * The stamp this plugin writes on an installed template IS the template
 * source it declares (AGL-3080).
 *
 * A site's library, a template's own page and the gallery's "Your templates"
 * shelf name an installed template by the declaration behind its
 * `source.type` — and the shelf asks Firestore for it BY that value. So a
 * stamp the declaration does not name is a template that reads as
 * "Installed" by nobody and, worse, one the gallery never offers again.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  INSTALLED_TEMPLATE_SOURCE_TYPES,
  installedTemplateSource,
} from '@aglyn/aglyn/plugin-manager/plugin-template-sources'
import { BUNDLE_ID } from './bundle-common'
import { TEMPLATE_SOURCE_TYPE } from './template-source'

describe('the marketplace’s template source', () => {
  it('is declared, by this plugin, under the value it stamps', () => {
    const declared = installedTemplateSource(TEMPLATE_SOURCE_TYPE)
    expect(declared?.pluginId).toBe(BUNDLE_ID)
    expect(declared?.label).toBeTruthy()
    expect(INSTALLED_TEMPLATE_SOURCE_TYPES).toContain(TEMPLATE_SOURCE_TYPE)
  })

  it('is what the template install route stamps', () => {
    const route = readFileSync(resolve(__dirname, '../server/install-template.ts'), 'utf8')
    expect(route).toMatch(/const source = \{\s*type: TEMPLATE_SOURCE_TYPE,/)
  })
})
