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
import { consoleOptions, consoleThemeLight } from './console.theme'
import {
  PLATFORM_BRAND_HOSTS,
  tenantOptions,
  tenantOptionsDark,
  tenantThemeDark,
  tenantThemeLight,
  wearsPlatformBrand,
} from './tenant.theme'
import { auditPaletteContrast } from './util/accent-text'
import { AA_TEXT_CONTRAST, contrastRatio } from './util/accessible-shade'

const ACCENTS = [
  'primary',
  'secondary',
  'tertiary',
  'error',
  'warning',
  'info',
  'success',
] as const

const schemes = [
  { name: 'light', theme: tenantThemeLight, options: tenantOptions },
  { name: 'dark', theme: tenantThemeDark, options: tenantOptionsDark },
] as const

describe('the tenant default palette is accessible by construction', () => {
  describe.each(schemes)('$name scheme', ({ theme }) => {
    const palette = theme.palette as unknown as Record<
      string,
      { main: string; dark: string; contrastText: string }
    >
    const backgrounds = [
      theme.palette.background.default,
      theme.palette.background.paper,
    ]

    it.each([...ACCENTS])(
      '%s: the accent-text shade clears AA on the page AND on paper',
      (key) => {
        for (const background of backgrounds) {
          expect(
            contrastRatio(palette[key].dark, background),
          ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST)
        }
      },
    )

    it.each([...ACCENTS])(
      '%s: contrastText clears AA on its own fill',
      (key) => {
        expect(
          contrastRatio(palette[key].contrastText, palette[key].main),
        ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST)
      },
    )

    it('reports NO contrast findings at all — unlike the brand palette', () => {
      expect(auditPaletteContrast(theme.palette)).toEqual([])
    })
  })

  it('the brand palette DOES report one, so the check above is not vacuous', () => {
    // The signed-off white-on-`#00b0ff` pairing is exempt; what remains is
    // `secondary.contrastText`. A tenant who never opened the theme editor
    // inherits neither.
    expect(
      auditPaletteContrast(consoleThemeLight.palette).map((v) => v.color),
    ).toEqual(['secondary'])
  })

  it('every extra slot this platform adds is present in both schemes', () => {
    // A missing slot is not a visual bug, it is an undefined read at the call
    // site — so the tenant default must carry everything the brand palette
    // does, not just MUI's own keys.
    const brandKeys = Object.keys(consoleOptions.palette ?? {}).sort()
    for (const options of [tenantOptions, tenantOptionsDark]) {
      expect(Object.keys(options.palette ?? {}).sort()).toEqual(brandKeys)
    }
  })

  it('carries MUI stock accents, not the Aglyn brand', () => {
    expect((tenantOptions.palette as any).primary.main).toBe('#1976d2')
    expect((tenantOptions.palette as any).secondary.main).toBe('#9c27b0')
    expect((tenantOptionsDark.palette as any).primary.main).toBe('#1976d2')
  })

  it('shares every NON-palette option with the console theme', () => {
    // The tenant default changes the palette and nothing else: component
    // behaviour, type ramp, spacing and shadows stay platform-wide.
    for (const key of Object.keys(consoleOptions)) {
      if (key === 'palette') continue
      expect((tenantOptions as any)[key]).toBe((consoleOptions as any)[key])
    }
  })

  it('the dark accent-text shades point LIGHTER than their own main', () => {
    for (const key of ACCENTS) {
      const color = (tenantThemeDark.palette as any)[key]
      expect(contrastRatio(color.dark, '#121212')).toBeGreaterThan(
        contrastRatio(color.main, '#121212'),
      )
    }
  })
})

describe('wearsPlatformBrand', () => {
  it('matches the marketing hosts, case- and space-insensitively', () => {
    expect(wearsPlatformBrand('aglyn.com')).toBe(true)
    expect(wearsPlatformBrand('  AGLYN.IO ')).toBe(true)
  })

  it('treats a customer site — including an aglyn.app subdomain — as a tenant', () => {
    expect(wearsPlatformBrand('acme.com')).toBe(false)
    expect(wearsPlatformBrand('acme.aglyn.app')).toBe(false)
    expect(wearsPlatformBrand(undefined)).toBe(false)
    expect(wearsPlatformBrand('')).toBe(false)
  })

  it('is exactly the two marketing hosts, so it cannot creep', () => {
    expect([...PLATFORM_BRAND_HOSTS].sort()).toEqual(['aglyn.com', 'aglyn.io'])
  })
})
