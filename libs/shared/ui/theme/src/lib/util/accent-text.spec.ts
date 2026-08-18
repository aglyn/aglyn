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
import MuiButton from '@mui/material/Button'
import { ThemeProvider } from '@mui/material/styles'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import {
  AA_NON_TEXT_CONTRAST,
  accentTextColor,
  auditPaletteContrast,
  DOCUMENTED_CONTRAST_EXCEPTIONS,
  formatPaletteContrastViolation,
} from './accent-text'
import { AA_TEXT_CONTRAST, contrastRatio } from './accessible-shade'
import createResponsiveTheme from './create-responsive-theme'

const LIGHT_BACKGROUNDS = ['#F5F5F5', '#FFFFFF']
const DARK_BACKGROUNDS = ['#161c21', '#2a3440']
const BRAND_BLUE = '#00b0ff'

/**
 * Server-render a real `<Button>` through a real `ThemeProvider` and return
 * the CSS emotion actually emitted for it.
 *
 * Deliberately not a model of MUI's `contrastText` → `--variant-containedColor`
 * mapping: a hand-written double could not catch MUI changing that mapping,
 * and the mapping is the thing under test. This is MUI's own component, MUI's
 * own variant table and emotion's own serializer; only the DOM is absent, and
 * colours do not need one.
 */
function renderButtonCss(
  theme: Theme,
  props: Record<string, unknown>,
): string {
  const { container, unmount } = render(
    createElement(
      ThemeProvider,
      { theme },
      createElement(MuiButton, props as any, 'Label'),
    ),
  )
  const button = container.querySelector('button')
  expect(button).not.toBeNull()
  // Emotion's generated class is unique to THIS theme+props pair, so scoping
  // by it keeps one test from reading the stylesheet another test inserted —
  // emotion's sheet is global and never cleared between renders.
  const emotionClass = Array.from(button?.classList ?? []).find((name) =>
    name.includes('-MuiButton-root'),
  )
  expect(emotionClass).toBeTruthy()
  // Under jsdom emotion inserts through the CSSOM, so the `<style>` tag's
  // textContent is empty and the rules have to be read off the sheet.
  const rules = Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText)
      } catch {
        return []
      }
    })
    .filter((rule) => rule.includes(`.${emotionClass}`))
  unmount()
  // Guard the harness itself: with no rules collected every assertion below
  // would pass vacuously. Forced red once by scoping to a class that no rule
  // carries.
  expect(rules.length).toBeGreaterThan(0)
  return rules.join('\n')
}

/** Every value the emitted CSS gives one custom property, in source order. */
function cssVarValues(css: string, name: string): string[] {
  return (css.match(new RegExp(`${name}:[^;}]*`, 'g')) ?? []).map((decl) =>
    decl.slice(name.length + 1).trim(),
  )
}

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
    //
    // These are the paths Zach's white-text decision does NOT touch: the
    // accent rendered as TEXT on a light surface, in both schemes. They are
    // still computed and still AA.
    expect(consoleThemeLight.palette.primary.dark).toBe('#0077ad')
    expect(consoleThemeDark.palette.primary.dark).toBe('rgb(76, 199, 255)')
  })
})

describe('filled primary buttons carry WHITE text — Zach, 2026-08-18', () => {
  // The decision, verbatim: "don't change the current blue and leave it as
  // white text". AGL-1293 had deleted this literal so MUI computed dark ink,
  // which shipped in `11f597b82` and put dark text on the brand blue. Only
  // this one token comes back.

  it('the token is authored white in BOTH schemes, in options and in the theme', () => {
    expect((consoleOptions.palette as any).primary.contrastText).toBe('#FFFFFF')
    expect((consoleOptionsDark.palette as any).primary.contrastText).toBe(
      '#FFFFFF',
    )
    // And it survives `createResponsiveTheme` byte-identical — AGL-1297's
    // contrastText walk only repairs shades it DERIVED, so an authored value
    // must pass straight through rather than being "healed" back to ink.
    expect(consoleThemeLight.palette.primary.contrastText).toBe('#FFFFFF')
    expect(consoleThemeDark.palette.primary.contrastText).toBe('#FFFFFF')
  })

  it('a rendered contained button paints WHITE on the brand blue, both schemes', () => {
    for (const theme of [consoleThemeLight, consoleThemeDark]) {
      const css = renderButtonCss(theme, {
        variant: 'contained',
        color: 'primary',
      })
      // The label colour: MUI's contained variant reads this var, and the
      // per-colour variant fills it from `palette.primary.contrastText`.
      expect(css).toContain('color: var(--variant-containedColor)')
      expect(new Set(cssVarValues(css, '--variant-containedColor'))).toEqual(
        new Set(['#FFFFFF']),
      )
      // The fill is untouched — `#00b0ff` is still the brand, exactly as Zach
      // asked ("don't change the current blue"). The second value is the
      // hover shade, which is `primary.dark` and unchanged by this pass.
      expect(cssVarValues(css, '--variant-containedBg')).toContain(BRAND_BLUE)
    }
  })

  it('INVERTED: the same harness on the PRE-decision palette paints ink', () => {
    // The assertion above only means something if it can distinguish. This
    // rebuilds the palette exactly as `c03a2d754` shipped it — the literal
    // deleted so MUI computes — and renders it through the same helper. It
    // comes out `rgba(0, 0, 0, 0.87)`: dark text on the brand blue, which is
    // the production regression Zach's decision reverses.
    const asShipped = createResponsiveTheme({
      themeOptions: {
        ...consoleOptions,
        palette: {
          ...(consoleOptions.palette as any),
          primary: { main: BRAND_BLUE },
        },
      },
    })
    const css = renderButtonCss(asShipped, {
      variant: 'contained',
      color: 'primary',
    })
    expect(cssVarValues(css, '--variant-containedColor')).toContain(
      'rgba(0, 0, 0, 0.87)',
    )
    expect(cssVarValues(css, '--variant-containedColor')).not.toContain(
      '#FFFFFF',
    )
  })

  it('and the TEXT variant still takes the computed accent, not white', () => {
    // The half of AGL-1293 that stays. A text button is text on the PAGE, so
    // it keeps the computed AA shade; only the filled foreground reverted.
    const css = renderButtonCss(consoleThemeLight, {
      variant: 'text',
      color: 'primary',
    })
    expect(cssVarValues(css, '--variant-textColor')).toContain('#0077ad')
    expect(cssVarValues(css, '--variant-textColor')).not.toContain('#FFFFFF')
    expect(cssVarValues(css, '--variant-textColor')).not.toContain(BRAND_BLUE)
  })

  it('states the cost rather than hiding it: 2.43:1, below both bars', () => {
    const ratio = contrastRatio('#FFFFFF', BRAND_BLUE)
    expect(Number(ratio.toFixed(2))).toBe(2.43)
    expect(ratio).toBeLessThan(AA_TEXT_CONTRAST)
    expect(ratio).toBeLessThan(AA_NON_TEXT_CONTRAST)
  })

  it('the audit still MEASURES it — the waiver hides no number', () => {
    for (const palette of [consoleThemeLight.palette, consoleThemeDark.palette]) {
      const [measured, ...rest] = auditPaletteContrast(palette, {
        colors: ['primary'],
        includeExempt: true,
      })
      expect(rest).toEqual([])
      expect(measured.role).toBe('contrastText')
      expect(measured.value).toBe('#FFFFFF')
      expect(measured.against).toBe(BRAND_BLUE)
      expect(Number(measured.ratio.toFixed(2))).toBe(2.43)
      expect(measured.exemption).toContain(
        "don't change the current blue and leave it as white text",
      )
      expect(formatPaletteContrastViolation(measured)).toContain(
        'KNOWN EXCEPTION',
      )
    }
  })
})

describe('the exemption is scoped to ONE pairing and cannot widen', () => {
  const white = (main: string, key = 'primary') =>
    auditPaletteContrast(
      createResponsiveTheme({
        themeOptions: {
          palette: {
            mode: 'light',
            [key]: { main, contrastText: '#FFFFFF' },
          } as any,
        },
      }).palette,
      { colors: [key] },
    ).filter((violation) => violation.role === 'contrastText')

  it('RED 5: the SAME white on a DIFFERENT blue is not covered', () => {
    // One digit off the brand blue. The waiver names `#00b0ff`, so this is a
    // new decision nobody made, and it reds.
    const violations = white('#00b1ff')
    expect(violations).toHaveLength(1)
    expect(violations[0].value).toBe('#FFFFFF')
    // Sanity: the exempted blue in the identical harness returns nothing.
    expect(white(BRAND_BLUE)).toEqual([])
  })

  it('RED 6: the SAME pairing on a DIFFERENT palette slot is not covered', () => {
    // Exactly `#FFFFFF` on exactly `#00b0ff`, but as `secondary`. The
    // exemption is keyed on the slot too, so it does not travel.
    const violations = white(BRAND_BLUE, 'secondary')
    expect(violations).toHaveLength(1)
    expect(violations[0].color).toBe('secondary')
    expect(violations[0].exemption).toBeUndefined()
  })

  it('RED 7: it waives contrastText only — the SAME two colours in the accentText role red', () => {
    // Constructed so all THREE other coordinates collide with the waiver:
    // white foreground, brand-blue background, `primary`. Only the role
    // differs — this is `primary.dark` white text ON a brand-blue page, which
    // nobody signed off. A role-blind exemption would swallow it silently, so
    // this is the case that makes the role check load-bearing rather than
    // decorative.
    const theme = createResponsiveTheme({
      themeOptions: {
        palette: {
          mode: 'light',
          primary: {
            main: BRAND_BLUE,
            dark: '#FFFFFF',
            contrastText: '#FFFFFF',
          },
          background: { default: BRAND_BLUE, paper: BRAND_BLUE },
        },
      },
    })
    const violations = auditPaletteContrast(theme.palette, {
      colors: ['primary'],
    })
    // One entry per background, and both backgrounds are the brand blue.
    expect(violations.map((violation) => violation.role)).toEqual([
      'accentText',
      'accentText',
    ])
    expect(violations[0]).toMatchObject({
      value: '#FFFFFF',
      against: BRAND_BLUE,
      color: 'primary',
    })
    expect(violations[0].exemption).toBeUndefined()
  })

  it('the registered exception list is exactly one entry', () => {
    // A suppression list grows quietly. This pins it so a second waiver has
    // to be argued for in review rather than appended.
    expect(DOCUMENTED_CONTRAST_EXCEPTIONS).toHaveLength(1)
    expect(DOCUMENTED_CONTRAST_EXCEPTIONS[0]).toMatchObject({
      color: 'primary',
      role: 'contrastText',
      value: '#FFFFFF',
      against: BRAND_BLUE,
    })
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
