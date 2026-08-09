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

import type { HostTheme } from '@aglyn/shared-data-types'
import { darken, lighten, type PaletteColor } from '../../vendor/mui'
import {
  consoleOptions,
  consoleOptionsDark,
  consoleThemeDark,
  consoleThemeLight,
} from '../console.theme'
import createResponsiveTheme from './create-responsive-theme'
import { hostThemeToThemeOptions, mergeThemeOptions } from './host-theme'

/** Same float the production derivation uses: tonalOffset 0.2 -> dark 0.3…4. */
const TONAL_OFFSET_DARK = 0.2 * 1.5
const TONAL_OFFSET_LIGHT = 0.2

/**
 * Independent WCAG 2.x implementation (hex and rgb() inputs) so assertions
 * do not trust the code under test.
 */
function wcagLuminance(color: string): number {
  const raw = color.startsWith('#') ? color.slice(1) : ''
  const hex = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw
  const channels = hex
    ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    : color
        .slice(color.indexOf('(') + 1, -1)
        .split(',')
        .slice(0, 3)
        .map((n) => parseInt(n, 10))
  const [r, g, b] = channels.map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function wcagRatio(foreground: string, background: string): number {
  const a = wcagLuminance(foreground)
  const b = wcagLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
function meetsAa(color: string, backgrounds: string[]): boolean {
  return backgrounds.every((bg) => wcagRatio(color, bg) >= 4.5)
}

describe('explicit shades pass through byte-identical (AGL-1297)', () => {
  // The marketing host's hand-written per-scheme accent text (AGL-1293).
  // A generator that re-derived `dark` by darkening `main` would replace the
  // dark scheme's DELIBERATELY LIGHTER #4fc3f7 with a 3.66:1 blue across
  // 800+ nodes. These two hex values coming through untouched is the whole
  // regression.
  const marketingHostTheme: HostTheme = {
    colorSchemes: {
      light: { primary: { main: '#00b0ff', dark: '#0073ae' } },
      dark: { primary: { main: '#00b0ff', dark: '#4fc3f7' } },
    },
  }

  it('keeps the marketing light-scheme primary.dark #0073ae', () => {
    const theme = createResponsiveTheme({
      themeOptions: mergeThemeOptions(
        consoleOptions,
        hostThemeToThemeOptions(marketingHostTheme, 'light'),
      ),
    })
    expect(theme.palette.primary.dark).toBe('#0073ae')
  })

  it('keeps the marketing dark-scheme primary.dark #4fc3f7 (LIGHTER than main, deliberately)', () => {
    const theme = createResponsiveTheme({
      themeOptions: mergeThemeOptions(
        consoleOptionsDark,
        hostThemeToThemeOptions(marketingHostTheme, 'dark'),
      ),
    })
    expect(theme.palette.primary.dark).toBe('#4fc3f7')
  })

  it('keeps an explicitly provided dark shade even when directly sub-AA', () => {
    // Explicit means explicit: the derivation layer must never "improve" an
    // authored value, even one that fails the bar it enforces on derived
    // ones.
    const theme = createResponsiveTheme({
      themeOptions: {
        palette: { mode: 'light', primary: { main: '#00b0ff', dark: '#00a0e8' } },
      },
    })
    expect(theme.palette.primary.dark).toBe('#00a0e8')
  })

  it('keeps an explicitly provided sub-AA contrastText', () => {
    // Console authors white-on-brand-blue (2.4:1) on purpose.
    expect(consoleThemeLight.palette.primary.contrastText).toBe('#FFFFFF')
    expect(wcagRatio('#FFFFFF', '#00b0ff')).toBeLessThan(4.5)
  })
})

describe('scheme-aware derivation of missing shades (AGL-1297)', () => {
  it('light scheme: derived dark clears 4.5:1 on BOTH real backgrounds, walking darker', () => {
    const theme = createResponsiveTheme({
      themeOptions: {
        palette: {
          mode: 'light',
          primary: { main: '#00b0ff' },
          background: { default: '#fafafa', paper: '#ffffff' },
        },
      },
    })
    const shade = theme.palette.primary.dark
    // The fixed tonal offset produced 4.49 on #fafafa — sub-AA — so the
    // derived value must have moved past it.
    expect(shade).not.toBe(darken('#00b0ff', TONAL_OFFSET_DARK))
    expect(meetsAa(shade, ['#fafafa', '#ffffff'])).toBe(true)
    expect(wcagLuminance(shade)).toBeLessThan(wcagLuminance('#00b0ff'))
  })

  it('dark scheme: the accessible direction is LIGHTER', () => {
    const theme = createResponsiveTheme({
      themeOptions: {
        palette: {
          mode: 'dark',
          primary: { main: '#00b0ff' },
          background: { default: '#161c21', paper: '#2a3440' },
        },
      },
    })
    const shade = theme.palette.primary.dark
    expect(meetsAa(shade, ['#161c21', '#2a3440'])).toBe(true)
    expect(wcagLuminance(shade)).toBeGreaterThan(wcagLuminance('#00b0ff'))
  })

  it('keeps an already-AA derived dark byte-identical to the tonal derivation', () => {
    const theme = createResponsiveTheme({
      themeOptions: {
        palette: {
          mode: 'light',
          primary: { main: '#e040fb' },
          background: { default: '#F5F5F5', paper: '#FFFFFF' },
        },
      },
    })
    // darken(#e040fb, 0.3) is 5.68:1 on the page — nothing to fix, so the
    // exact tonal-offset output (rgb() string and all) must survive.
    expect(theme.palette.primary.dark).toBe(darken('#e040fb', TONAL_OFFSET_DARK))
  })

  it('derived contrastText keeps the threshold choice while it clears AA against main', () => {
    const theme = createResponsiveTheme({
      themeOptions: { palette: { mode: 'light', primary: { main: '#1976d2' } } },
    })
    // MUI's contrastThreshold picks white here, and white is 4.6:1 — kept.
    expect(theme.palette.primary.contrastText).toBe('#fff')
    expect(wcagRatio('#fff', '#1976d2')).toBeGreaterThanOrEqual(4.5)
  })

  it('derived contrastText is walked when the threshold choice is sub-AA against main', () => {
    const theme = createResponsiveTheme({
      themeOptions: { palette: { mode: 'light', error: { main: '#f44336' } } },
    })
    // Threshold 3 keeps white on #f44336 at 3.68:1 — below the text bar.
    expect(wcagRatio('#ffffff', '#f44336')).toBeLessThan(4.5)
    expect(
      wcagRatio(theme.palette.error.contrastText, '#f44336'),
    ).toBeGreaterThanOrEqual(4.5)
  })
})

describe('console blast radius (AGL-1297)', () => {
  type SchemeCase = {
    name: string
    theme: typeof consoleThemeLight
    options: typeof consoleOptions
    mode: 'light' | 'dark'
  }
  const cases: SchemeCase[] = [
    {
      name: 'light',
      theme: consoleThemeLight,
      options: consoleOptions,
      mode: 'light',
    },
    {
      name: 'dark',
      theme: consoleThemeDark,
      options: consoleOptionsDark,
      mode: 'dark',
    },
  ]
  const accents = [
    'primary',
    'secondary',
    'tertiary',
    'error',
    'warning',
    'info',
    'success',
  ] as const

  describe.each(cases)('$name scheme', ({ theme, options, mode }) => {
    const backgrounds = [
      theme.palette.background.default,
      theme.palette.background.paper,
    ]
    const inputPalette = options.palette as unknown as Record<
      string,
      { main: string; contrastText?: string }
    >
    const palette = theme.palette as unknown as Record<string, PaletteColor>

    it.each([...accents])(
      '%s: every shade is either byte-stable or was sub-AA and now clears',
      (key) => {
        const main = inputPalette[key].main
        const oldDark = darken(main, TONAL_OFFSET_DARK)
        const oldLight = lighten(main, TONAL_OFFSET_LIGHT)
        const color = palette[key]

        // dark slot: kept only if the old derivation already cleared AA.
        if (color.dark === oldDark) {
          expect(meetsAa(oldDark, backgrounds)).toBe(true)
        } else {
          expect(meetsAa(oldDark, backgrounds)).toBe(false)
          expect(meetsAa(color.dark, backgrounds)).toBe(true)
          if (mode === 'dark') {
            expect(wcagLuminance(color.dark)).toBeGreaterThan(
              wcagLuminance(main),
            )
          } else {
            expect(wcagLuminance(color.dark)).toBeLessThan(wcagLuminance(main))
          }
        }

        // light slot: a light-scheme tint NEVER moves; a dark-scheme light
        // is foreground-capable and follows the same kept-or-fixed rule.
        if (mode === 'light') {
          expect(color.light).toBe(oldLight)
        } else if (color.light === oldLight) {
          expect(meetsAa(oldLight, backgrounds)).toBe(true)
        } else {
          expect(meetsAa(oldLight, backgrounds)).toBe(false)
          expect(meetsAa(color.light, backgrounds)).toBe(true)
        }

        // contrastText is authored on every console colour: untouched.
        expect(color.contrastText).toBe(inputPalette[key].contrastText)
      },
    )

    it('surface is exempt: its shades are surface steps, not text', () => {
      const main = inputPalette.surface.main
      expect(palette.surface.dark).toBe(darken(main, TONAL_OFFSET_DARK))
      expect(palette.surface.light).toBe(lighten(main, TONAL_OFFSET_LIGHT))
      expect(palette.surface.contrastText).toBe(
        inputPalette.surface.contrastText,
      )
    })
  })

  it('documents exactly which console-visible shades moved, and why', () => {
    const lightBackgrounds = ['#F5F5F5', '#FFFFFF']
    const darkBackgrounds = ['#161c21', '#2a3440']

    // LIGHT scheme: two derived darks were sub-AA on the real page tint.
    //   primary.dark  rgb(0, 123, 178)  4.30 vs #F5F5F5 -> walked
    //   warning.dark  rgb(178, 119, 44) 3.46 vs #F5F5F5 -> walked
    const lightChanged = ['primary', 'warning']
    for (const key of accents) {
      const main = (consoleOptions.palette as any)[key].main as string
      const kept =
        (consoleThemeLight.palette as any)[key].dark ===
        darken(main, TONAL_OFFSET_DARK)
      expect(kept).toBe(!lightChanged.includes(key))
    }
    expect(
      meetsAa(consoleThemeLight.palette.primary.dark, lightBackgrounds),
    ).toBe(true)

    // DARK scheme: every tonally-darkened dark pointed the WRONG WAY
    // (2.0–4.6:1 on the dark page) — all seven walk lighter now, plus the
    // two light tints that were sub-AA (error 3.80, info 4.48 vs paper).
    for (const key of accents) {
      const main = (consoleOptionsDark.palette as any)[key].main as string
      const shade = (consoleThemeDark.palette as any)[key].dark as string
      expect(shade).not.toBe(darken(main, TONAL_OFFSET_DARK))
      expect(meetsAa(shade, darkBackgrounds)).toBe(true)
    }
    const darkLightChanged = ['error', 'info']
    for (const key of accents) {
      const main = (consoleOptionsDark.palette as any)[key].main as string
      const kept =
        (consoleThemeDark.palette as any)[key].light ===
        lighten(main, TONAL_OFFSET_LIGHT)
      expect(kept).toBe(!darkLightChanged.includes(key))
    }
  })
})
