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

import { consoleThemeLight } from './console.theme'
import {
  PLATFORM_BRAND_FONT,
  PLATFORM_TYPE_RAMP_WEIGHTS,
  siteBaseFonts,
  siteBaseTypography,
} from './site-base-fonts'
import { TENANT_SYSTEM_FONT_STACK } from './platform-brand'

describe('the platform brand as data (AGL-3656)', () => {
  it('holds the weights the built console theme draws each text style with', () => {
    const typography = consoleThemeLight.typography as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(PLATFORM_TYPE_RAMP_WEIGHTS)) {
      const built = typography[key]
      if (typeof value === 'number') expect([key, built]).toEqual([key, value])
      else {
        expect([key, (built as { fontWeight?: unknown })?.fontWeight]).toEqual([
          key,
          (value as { fontWeight: number }).fontWeight,
        ])
      }
    }
  })

  it('names every text style the built theme has a weight for', () => {
    const typography = consoleThemeLight.typography as unknown as Record<string, unknown>
    const styles = Object.entries(typography)
      .filter(([key, value]) => key !== 'inherit' && value && typeof value === 'object' && 'fontWeight' in (value as object))
      .map(([key]) => key)
    expect(styles.filter((key) => !(key in PLATFORM_TYPE_RAMP_WEIGHTS))).toEqual([])
  })

  it('bases an operator host on the brand stack and a customer on the system stack', () => {
    expect(String(siteBaseTypography('aglyn.com')['fontFamily'])).toMatch(/^"Roboto Flex"/)
    expect(siteBaseTypography('acme')['fontFamily']).toBe(TENANT_SYSTEM_FONT_STACK)
    expect(siteBaseTypography('acme')['h1']).toEqual({ fontWeight: 900 })
  })

  it('loads the brand face on an operator host whose theme names no face', () => {
    expect(siteBaseFonts('aglyn.com', { fonts: [] })).toEqual([PLATFORM_BRAND_FONT])
    expect(siteBaseFonts('cname--aglyn.com', undefined)).toEqual([PLATFORM_BRAND_FONT])
    expect(
      siteBaseFonts('aglyn.com', { typography: { fontFamily: 'Inter, sans-serif' } }),
    ).toEqual([])
    expect(
      siteBaseFonts('aglyn.com', { fonts: [{ family: 'Roboto Flex', source: 'google' }] }),
    ).toEqual([])
    // A customer site adds nothing: no theme font, no bytes.
    expect(siteBaseFonts('acme', undefined)).toEqual([])
  })
})
