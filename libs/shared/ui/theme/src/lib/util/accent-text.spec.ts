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

import {
  consoleOptions,
  consoleOptionsDark,
  consoleThemeCssVar,
  consoleThemeDark,
  consoleThemeLight,
} from '../console.theme'
import { createTheme, type Theme } from '../../vendor/mui'
import {
  AA_NON_TEXT_CONTRAST,
  accentTextColor,
  auditPaletteContrast,
  formatPaletteContrastViolation,
} from './accent-text'
import { AA_TEXT_CONTRAST, contrastRatio } from './accessible-shade'
import createResponsiveTheme from './create-responsive-theme'

const LIGHT_BACKGROUNDS = ['#F5F5F5', '#FFFFFF']
const DARK_BACKGROUNDS = ['#161c21', '#2a3440']
const BRAND_BLUE = '#00b0ff'

/** Run a component styleOverride the way MUI's `styled` would. */
function runRootOverride(
  theme: Theme,
  component: 'MuiButton' | 'MuiLink' | 'MuiTab',
  ownerState: Record<string, unknown>,
): Record<string, any> {
  const root = (theme.components as any)?.[component]?.styleOverrides?.root
  expect(typeof root).toBe('function')
  return root({ theme, ownerState }) as Record<string, any>
}

describe('accentTextColor (AGL-1293)', () => {
  it('resolves a palette key to the accent-text shade, not to main', () => {
    const accent = accentTextColor(consoleThemeLight, 'primary')
    expect(accent).toBe(consoleThemeLight.palette.primary.dark)
    expect(accent).not.toBe(consoleThemeLight.palette.primary.main)
  })

  it('emits a CSS VARIABLE on a css-vars theme, so it follows the scheme', () => {
    // The AGL-1292 bug shape: `components` are evaluated ONCE against the
    // root theme, so a literal light-scheme hex would freeze into dark mode.
    const accent = accentTextColor(consoleThemeCssVar as unknown as Theme, 'primary')
    // MUI emits the light value as the var's FALLBACK, which is why this is
    // a prefix match: the fallback only applies if the variable is missing,
    // and the variable is what carries the scheme flip.
    expect(accent).toMatch(/^var\(--mui-palette-primary-dark[,)]/)
  })

  it('leaves non-PaletteColor colors to MUI', () => {
    for (const color of ['inherit', 'textPrimary', 'textSecondary', undefined]) {
      expect(accentTextColor(consoleThemeLight, color)).toBeUndefined()
    }
    expect(accentTextColor(undefined, 'primary')).toBeUndefined()
  })
})

describe('the console palette keeps the AGL-1293 contract', () => {
  it('primary.main is STILL the brand blue — it is a fill, not text', () => {
    expect(consoleThemeLight.palette.primary.main).toBe(BRAND_BLUE)
    expect(consoleThemeDark.palette.primary.main).toBe(BRAND_BLUE)
  })

  it('and the brand blue is exactly why it may not be text', () => {
    expect(contrastRatio(BRAND_BLUE, '#FFFFFF')).toBeLessThan(AA_TEXT_CONTRAST)
    // Stated rather than assumed: on WHITE the brand blue misses even the
    // non-text bar (2.43:1). It clears 3:1 only as a fill carrying its own
    // contrastText, which is the use AGL-1293 leaves it in.
    expect(contrastRatio(BRAND_BLUE, '#FFFFFF')).toBeLessThan(
      AA_NON_TEXT_CONTRAST,
    )
  })

  it('light scheme: the computed accent text clears AA on both real surfaces', () => {
    const accent = consoleThemeLight.palette.primary.dark
    for (const background of LIGHT_BACKGROUNDS) {
      expect(contrastRatio(accent, background)).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST,
      )
    }
  })

  it('dark scheme: the computed accent text clears AA and is LIGHTER than main', () => {
    const accent = consoleThemeDark.palette.primary.dark
    for (const background of DARK_BACKGROUNDS) {
      expect(contrastRatio(accent, background)).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST,
      )
    }
  })

  it('pins the computed OUTPUT, so a palette change that drops below AA reds', () => {
    // The anti-rot spec AGL-1297 established, extended to the values THIS
    // pass computes. A ratio-only assertion would stay green while the whole
    // accent shifted hue; these pin the bytes.
    expect(consoleThemeLight.palette.primary.dark).toBe('#0077ad')
    expect(consoleThemeDark.palette.primary.dark).toBe('rgb(76, 199, 255)')
    expect(consoleThemeLight.palette.primary.contrastText).toBe(
      'rgba(0, 0, 0, 0.87)',
    )
    expect(consoleThemeDark.palette.primary.contrastText).toBe(
      'rgba(0, 0, 0, 0.87)',
    )
  })

  it('on-primary foreground is computed, and clears AA in both schemes', () => {
    // The literal `#FFFFFF` (2.43:1) is gone from console.theme.ts.
    expect((consoleOptions.palette as any).primary.contrastText).toBeUndefined()
    expect(
      (consoleOptionsDark.palette as any).primary.contrastText,
    ).toBeUndefined()
    for (const theme of [consoleThemeLight, consoleThemeDark]) {
      expect(
        contrastRatio(theme.palette.primary.contrastText, BRAND_BLUE),
      ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST)
    }
  })
})

describe('components render the accent AS TEXT through the computation', () => {
  it('MuiButton: text and outlined labels take the accent shade, the fill keeps main', () => {
    const style = runRootOverride(consoleThemeLight, 'MuiButton', {
      color: 'primary',
      variant: 'text',
    })
    const accent = consoleThemeLight.palette.primary.dark
    expect(style['--variant-textColor']).toBe(accent)
    expect(style['--variant-outlinedColor']).toBe(accent)
    // MUI's own variant set these to `palette.primary.main`; the point is
    // that they no longer do.
    expect(style['--variant-textColor']).not.toBe(BRAND_BLUE)
    // Non-text vars are deliberately untouched, so the brand colour survives
    // as the border and the fill.
    expect(style['--variant-outlinedBorder']).toBeUndefined()
    expect(style['--variant-containedBg']).toBeUndefined()
  })

  it('MuiButton: a color with no PaletteColor shape is left alone', () => {
    const style = runRootOverride(consoleThemeLight, 'MuiButton', {
      color: 'inherit',
      variant: 'text',
    })
    expect(style['--variant-textColor']).toBeUndefined()
  })

  it('MuiLink: color="primary" resolves to the accent shade', () => {
    const style = runRootOverride(consoleThemeLight, 'MuiLink', {
      color: 'primary',
    })
    expect(style.color).toBe(consoleThemeLight.palette.primary.dark)
  })

  it('MuiLink: textPrimary / inherit keep MUI resolution', () => {
    for (const color of ['inherit', 'textPrimary']) {
      const style = runRootOverride(consoleThemeLight, 'MuiLink', { color })
      expect(style.color).toBeUndefined()
    }
  })

  it('MuiTab: the SELECTED label takes the accent shade', () => {
    const style = runRootOverride(consoleThemeLight, 'MuiTab', {
      textColor: 'primary',
    })
    expect(style['&.Mui-selected'].color).toBe(
      consoleThemeLight.palette.primary.dark,
    )
  })

  it('MuiTab: textColor="inherit" is untouched', () => {
    expect(
      runRootOverride(consoleThemeLight, 'MuiTab', { textColor: 'inherit' }),
    ).toEqual({})
  })

  it('every override emits a css VAR on the css-vars theme', () => {
    const theme = consoleThemeCssVar as unknown as Theme
    expect(
      runRootOverride(theme, 'MuiButton', { color: 'primary' })[
        '--variant-textColor'
      ],
    ).toMatch(/^var\(--mui-palette-primary-dark[,)]/)
    expect(
      runRootOverride(theme, 'MuiLink', { color: 'primary' }).color,
    ).toMatch(/^var\(--mui-palette-primary-dark[,)]/)
  })
})

describe('the computation reaches TENANT-generated palettes, not just ours', () => {
  // The reason Zach asked for computation over a hardcoded swap: a literal
  // would never have reached a customer's own palette.
  const tenantAccents = ['#00b0ff', '#e91e63', '#ffc107', '#8bc34a', '#3f51b5']

  it.each(tenantAccents)(
    'light scheme, primary %s: accent text and on-primary text both clear AA',
    (main) => {
      const theme = createResponsiveTheme({
        themeOptions: {
          palette: {
            mode: 'light',
            primary: { main },
            background: { default: '#fafafa', paper: '#ffffff' },
          },
        },
      })
      expect(auditPaletteContrast(theme.palette, { colors: ['primary'] })).toEqual(
        [],
      )
      expect(accentTextColor(theme, 'primary')).toBe(theme.palette.primary.dark)
    },
  )

  it.each(tenantAccents)(
    'dark scheme, primary %s: same guarantee, opposite direction',
    (main) => {
      const theme = createResponsiveTheme({
        themeOptions: {
          palette: {
            mode: 'dark',
            primary: { main },
            background: { default: '#161c21', paper: '#2a3440' },
          },
        },
      })
      expect(auditPaletteContrast(theme.palette, { colors: ['primary'] })).toEqual(
        [],
      )
    },
  )
})

describe('the guard can go RED — proved by forcing it', () => {
  it('RED 1: an accent whose AA bar is UNREACHABLE is reported, not silently kept', () => {
    // A mid-grey page is the trap: the foreground direction in a dark scheme
    // is LIGHTER, and pure white — the far pole — is only 3.95:1 on #808080.
    // There is no lighter colour, so `accessibleShade` returns its best
    // effort and the palette is genuinely un-fixable by derivation.
    expect(contrastRatio('#FFFFFF', '#808080')).toBeLessThan(AA_TEXT_CONTRAST)
    const theme = createResponsiveTheme({
      themeOptions: {
        palette: {
          mode: 'dark',
          primary: { main: '#6d6d6d' },
          background: { default: '#808080', paper: '#808080' },
        },
      },
    })
    const violations = auditPaletteContrast(theme.palette, {
      colors: ['primary'],
    })
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]).toMatchObject({
      color: 'primary',
      role: 'accentText',
      against: '#808080',
      required: AA_TEXT_CONTRAST,
    })
    expect(violations[0].ratio).toBeLessThan(AA_TEXT_CONTRAST)
    expect(formatPaletteContrastViolation(violations[0])).toContain(
      'primary.accentText',
    )
  })

  it('RED 2: an EXPLICIT sub-AA accent is reported — derivation never touches it', () => {
    // The invariant that explicit values pass through byte-identical is what
    // keeps the marketing host's hand-pinned #0073ae / #4fc3f7 stable. Its
    // cost is that an author can pin a failing value, so the audit is the
    // only thing standing between that palette and unreadable text.
    const theme = createResponsiveTheme({
      themeOptions: {
        palette: {
          mode: 'light',
          primary: { main: BRAND_BLUE, dark: '#00a0e8' },
          background: { default: '#F5F5F5', paper: '#FFFFFF' },
        },
      },
    })
    expect(theme.palette.primary.dark).toBe('#00a0e8')
    const violations = auditPaletteContrast(theme.palette, {
      colors: ['primary'],
    })
    expect(violations.map((v) => v.role)).toContain('accentText')
  })

  it('RED 3: the AA contrastThreshold is LOAD-BEARING — MUI’s stock 3 audits RED', () => {
    // Measured against RAW MUI, because that is where the threshold is the
    // only thing acting. `#E53935` keeps white at 4.23:1 and `#1e88e5` at
    // 3.68:1 under the stock threshold of 3 — both sub-AA, both reported.
    const palette = (contrastThreshold: number) => ({
      mode: 'light' as const,
      contrastThreshold,
      error: { main: '#E53935' },
      info: { main: '#1e88e5' },
    })
    const stockViolations = auditPaletteContrast(
      createTheme({ palette: palette(3) }).palette,
      { colors: ['error', 'info'] },
    ).filter((v) => v.role === 'contrastText')
    expect(stockViolations.map((v) => v.color).sort()).toEqual(['error', 'info'])

    // Raising the threshold alone — no walking, no repair pass — clears it.
    expect(
      auditPaletteContrast(
        createTheme({ palette: palette(AA_TEXT_CONTRAST) }).palette,
        { colors: ['error', 'info'] },
      ).filter((v) => v.role === 'contrastText'),
    ).toEqual([])
  })

  it('RED 3b: our factory defaults to the AA threshold, so the ink is CHOSEN not walked', () => {
    // Defence in depth means a red can hide: AGL-1297's contrastText walk
    // repairs a sub-AA pairing whatever the threshold, so the audit passes
    // either way through this factory. What the threshold still decides is
    // the VALUE — MUI's own ink at 4.5, an approximated walk-product at 3.
    const stock = createResponsiveTheme({
      themeOptions: {
        palette: { mode: 'light', contrastThreshold: 3, error: { main: '#E53935' } },
      },
    })
    const defaulted = createResponsiveTheme({
      themeOptions: { palette: { mode: 'light', error: { main: '#E53935' } } },
    })
    expect(defaulted.palette.error.contrastText).toBe('rgba(0, 0, 0, 0.87)')
    expect(stock.palette.error.contrastText).not.toBe('rgba(0, 0, 0, 0.87)')
    expect(stock.palette.error.contrastText).not.toBe('#fff')
  })

  it('RED 4: the audit is not blind — it measures a palette it should PASS', () => {
    // A check that only ever fires on rigged input proves nothing about the
    // real one. The console primary is the case this issue exists for.
    expect(
      auditPaletteContrast(consoleThemeLight.palette, { colors: ['primary'] }),
    ).toEqual([])
    expect(
      auditPaletteContrast(consoleThemeDark.palette, { colors: ['primary'] }),
    ).toEqual([])
  })
})

describe('what the console palette still owes, pinned so it cannot drift', () => {
  // Deliberately NOT fixed in this pass: these are authored `contrastText`
  // literals on secondary/info/error, outside AGL-1293's primary-coloured
  // scope, and flipping them repaints alert and destructive semantics
  // product-wide. Pinned as an exact set so the residue can only shrink
  // knowingly — a new sub-AA literal reds this test.
  const residue = (palette: any) =>
    auditPaletteContrast(palette)
      .map((v) => `${v.color}.${v.role}`)
      .sort()

  it('light scheme residue is exactly the three authored literals', () => {
    expect(residue(consoleThemeLight.palette)).toEqual([
      'error.contrastText',
      'info.contrastText',
      'secondary.contrastText',
    ])
  })

  it('dark scheme residue is exactly the same three', () => {
    expect(residue(consoleThemeDark.palette)).toEqual([
      'error.contrastText',
      'info.contrastText',
      'secondary.contrastText',
    ])
  })
})
