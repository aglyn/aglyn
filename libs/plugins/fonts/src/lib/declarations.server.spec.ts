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

import { themeFontFacts } from '@aglyn/aglyn/plugin-manager/plugin-theme-font-catalog'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { findGoogleFontFamily, loadGoogleFontsCatalog } from './catalog/google-fonts-catalog'
import { registerFontsServerDeclarations } from './declarations.server'

describe('the Google Fonts catalog (AGL-3656)', () => {
  it('holds every family once, most popular first, each with what a page needs', async () => {
    const families = await loadGoogleFontsCatalog()
    expect(families.length).toBeGreaterThan(1500)
    expect(new Set(families.map((family) => family.family.toLowerCase())).size).toBe(families.length)
    expect(families.map((family) => family.popularity)).toEqual(
      families.map((_, index) => index + 1),
    )
    for (const family of families) {
      // Molle is italic alone.
      expect(family.weights.length + family.italics.length).toBeGreaterThan(0)
      expect(['sans-serif', 'serif', 'monospace', 'display', 'handwriting']).toContain(family.category)
    }
    // Nearly every family's regular face was read for its metrics.
    expect(families.filter((family) => family.metrics).length / families.length).toBeGreaterThan(0.98)
  })

  it('finds a family by name, whatever its case', async () => {
    const inter = await findGoogleFontFamily('  inter ')
    expect(inter).toMatchObject({
      family: 'Inter',
      category: 'sans-serif',
      metrics: { unitsPerEm: 2048, ascent: 1984, descent: -494, lineGap: 0 },
    })
    expect(inter?.axes.find((axis) => axis.tag === 'wght')).toEqual({ tag: 'wght', min: 100, max: 900 })
    expect(await findGoogleFontFamily('Not A Real Family')).toBeUndefined()
  })
})

describe('registerFontsServerDeclarations', () => {
  beforeEach(() => resetPluginServicesForTests())

  it("answers core's theme font catalog from the Google catalog", async () => {
    registerFontsServerDeclarations()
    expect(await themeFontFacts('Roboto Flex')).toMatchObject({
      family: 'Roboto Flex',
      category: 'sans-serif',
      variableWeights: [100, 1000],
      italics: [],
    })
    expect(await themeFontFacts('Poppins')).not.toHaveProperty('variableWeights')
    expect(await themeFontFacts('Nope')).toBeUndefined()
  })
})
