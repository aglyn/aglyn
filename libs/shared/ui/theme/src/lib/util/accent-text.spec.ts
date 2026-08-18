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
 * AGL-1293 — the MEASUREMENT, and the guarantee that measuring changes
 * nothing.
 *
 * `c03a2d754` did not stop at measuring. It routed `MuiButton`'s
 * `--variant-textColor` / `--variant-outlinedColor`, `MuiLink`'s `color` and
 * `MuiTab`'s selected label through `accentTextColor`, and raised
 * `contrastThreshold` to 4.5, so the brand blue stopped rendering as itself:
 * links and text/outlined button labels went `#00b0ff` → `#0077ad` in light
 * and → `rgb(76, 199, 255)` in dark. Zach, 2026-08-18:
 *
 *   "You changed my theme colors, I told you deliberately not to do that."
 *
 * All of it is reverted. This suite now has two jobs and only two:
 *
 * 1. **Pin that nothing is wired.** The console's component overrides must be
 *    the plain static objects they were before `c03a2d754` — no function that
 *    could resolve a colour, no `MuiTab` entry at all. `#00b0ff` renders
 *    everywhere it rendered before, asserted against real emitted CSS.
 * 2. **Record the findings**, so the numbers survive for a decision Zach
 *    owns. `auditPaletteContrast` measures; it does not repair, and nothing
 *    reads it at runtime.
 */
import MuiButton from '@mui/material/Button'
import MuiLink from '@mui/material/Link'
import { ThemeProvider } from '@mui/material/styles'
import { render } from '@testing-library/react'
import { createElement } from 'react'
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
  DOCUMENTED_CONTRAST_EXCEPTIONS,
  formatPaletteContrastViolation,
} from './accent-text'
import { AA_TEXT_CONTRAST, contrastRatio } from './accessible-shade'
import createResponsiveTheme from './create-responsive-theme'

const BRAND_BLUE = '#00b0ff'

/**
 * Render a real component through a real `ThemeProvider` and return the CSS
 * emotion actually emitted for it.
 *
 * The claim under test is about what a USER SEES, so it is measured from the
 * rendered output rather than from the theme object. Under jsdom emotion
 * inserts through the CSSOM, so the rules are read off the sheet — the
 * `<style>` tag's textContent is empty.
 */
function renderCss(
  theme: Theme,
  Component: unknown,
  props: Record<string, unknown>,
): string {
  const { container, unmount } = render(
    createElement(
      ThemeProvider,
      { theme },
      createElement(Component as any, props as any),
    ),
  )
  const element = container.querySelector('a, button')
  expect(element).not.toBeNull()
  // Emotion's generated class is unique to this theme+props pair, so scoping
  // by it stops one case reading the stylesheet another inserted — the sheet
  // is global and never cleared between renders.
  const emotionClass = Array.from(element?.classList ?? []).find((name) =>
    /^css-/.test(name),
  )
  expect(emotionClass).toBeTruthy()
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
  // Guard the harness: with no rules collected every assertion below would
  // pass vacuously. Forced red once by scoping to a class no rule carries.
  expect(rules.length).toBeGreaterThan(0)
  return rules.join('\n')
}

/** Every value the emitted CSS gives one custom property, in source order. */
function cssVarValues(css: string, name: string): string[] {
  return (css.match(new RegExp(`${name}:[^;}]*`, 'g')) ?? []).map((decl) =>
    decl.slice(name.length + 1).trim(),
  )
}

describe('the brand blue renders as itself — nothing repaints it', () => {
  it('primary.main is `#00b0ff` in both schemes, untouched', () => {
    expect(consoleThemeLight.palette.primary.main).toBe(BRAND_BLUE)
    expect(consoleThemeDark.palette.primary.main).toBe(BRAND_BLUE)
  })

  it('a LINK takes the brand blue, not a darkened accent shade', () => {
    // This is the call site `c03a2d754` changed most visibly: `#0077ad` in
    // light, `rgb(76, 199, 255)` in dark. Both must be absent.
    for (const theme of [consoleThemeLight, consoleThemeDark]) {
      const css = renderCss(theme, MuiLink, { color: 'primary', href: '#' })
      expect(css).toContain(`color: ${BRAND_BLUE}`)
      expect(css).not.toContain('#0077ad')
      expect(css).not.toContain('rgb(76, 199, 255)')
    }
  })

  it('a TEXT button label takes the brand blue', () => {
    const css = renderCss(consoleThemeLight, MuiButton, {
      variant: 'text',
      color: 'primary',
    })
    expect(cssVarValues(css, '--variant-textColor')).toEqual([BRAND_BLUE])
  })

  it('an OUTLINED button takes the brand blue for label AND border', () => {
    const css = renderCss(consoleThemeLight, MuiButton, {
      variant: 'outlined',
      color: 'primary',
    })
    expect(cssVarValues(css, '--variant-outlinedColor')).toEqual([BRAND_BLUE])
    expect(cssVarValues(css, '--variant-outlinedBorder')).toContain(
      'rgba(0, 176, 255, 0.5)',
    )
  })

  it('a FILLED button is the brand blue with WHITE text — Zach, 2026-08-18', () => {
    // "don't change the current blue and leave it as white text". The one
    // token `c03a2d754` computed to dark ink; restored, and the fill is
    // untouched.
    for (const theme of [consoleThemeLight, consoleThemeDark]) {
      const css = renderCss(theme, MuiButton, {
        variant: 'contained',
        color: 'primary',
      })
      expect(css).toContain('color: var(--variant-containedColor)')
      expect(cssVarValues(css, '--variant-containedColor')).toEqual(['#FFFFFF'])
      expect(cssVarValues(css, '--variant-containedBg')).toContain(BRAND_BLUE)
    }
  })

  it('the authored token itself is white in both schemes and both option sets', () => {
    expect((consoleOptions.palette as any).primary.contrastText).toBe('#FFFFFF')
    expect((consoleOptionsDark.palette as any).primary.contrastText).toBe(
      '#FFFFFF',
    )
    // Survives `createResponsiveTheme` byte-identical: AGL-1297's contrastText
    // walk repairs only DERIVED values, so an authored one must pass through
    // rather than being "healed" to ink.
    expect(consoleThemeLight.palette.primary.contrastText).toBe('#FFFFFF')
    expect(consoleThemeDark.palette.primary.contrastText).toBe('#FFFFFF')
  })
})

describe('nothing is wired to accentTextColor — the overrides are static again', () => {
  const overrideRoot = (theme: Theme, component: string) =>
    (theme.components as any)?.[component]?.styleOverrides?.root

  it('MuiButton and MuiLink roots are plain objects, not resolver functions', () => {
    // A function root is how a colour gets computed per-render. Their being
    // objects is the structural guarantee that no override can repaint an
    // accent, independent of what any single rendered case shows.
    for (const theme of [consoleThemeLight, consoleThemeDark]) {
      for (const component of ['MuiButton', 'MuiLink']) {
        expect(typeof overrideRoot(theme, component)).toBe('object')
      }
    }
  })

  it('MuiTab has no override at all — the entry `c03a2d754` added is gone', () => {
    for (const theme of [consoleThemeLight, consoleThemeDark]) {
      expect((theme.components as any)?.MuiTab).toBeUndefined()
    }
  })

  it('NO override anywhere emits a colour — swept, not spot-checked', () => {
    // The sweep rather than three named components: any override that set a
    // foreground would be a repaint, whichever component grew it. Function
    // roots are allowed and pre-date all of this — `MuiIconButton` returns
    // padding, `MuiToolbar` returns gutters — so what is checked is the
    // RESULT, walked deeply, for any key or value that carries a colour.
    const offenders: string[] = []
    const walk = (label: string, value: unknown, path: string) => {
      if (value === null || value === undefined) return
      if (typeof value === 'string') {
        if (/^(#|rgb|hsl|var\(--mui)/i.test(value.trim())) {
          offenders.push(`${label}.${path} = ${value}`)
        }
        return
      }
      if (typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        if (/color/i.test(key)) offenders.push(`${label}.${path}.${key}`)
        walk(label, child, `${path}.${key}`)
      }
    }
    for (const [label, theme] of [
      ['light', consoleThemeLight],
      ['dark', consoleThemeDark],
    ] as const) {
      const components = (theme.components ?? {}) as Record<string, any>
      for (const name of Object.keys(components)) {
        const root = components[name]?.styleOverrides?.root
        const resolved =
          typeof root === 'function'
            ? root({
                theme,
                ownerState: {
                  color: 'primary',
                  textColor: 'primary',
                  variant: 'text',
                },
              })
            : root
        walk(label, resolved, name)
      }
    }
    expect(offenders).toEqual([])
  })

  it('and `contrastThreshold` is back to MUI stock 3, in every scheme', () => {
    // The other mechanism `c03a2d754` used. At 4.5 the computed pairing for
    // several accents flips, which is a repaint even where no override exists.
    expect(consoleThemeLight.palette.contrastThreshold).toBe(3)
    expect(consoleThemeDark.palette.contrastThreshold).toBe(3)
    for (const scheme of ['light', 'dark'] as const) {
      expect(
        (consoleThemeCssVar as any).colorSchemes?.[scheme]?.palette
          ?.contrastThreshold,
      ).toBe(3)
    }
  })
})

describe('accentTextColor still ANSWERS the question, wired to nothing', () => {
  it('resolves a palette key to the accent-text shade', () => {
    const accent = accentTextColor(consoleThemeLight, 'primary')
    expect(accent).toBe(consoleThemeLight.palette.primary.dark)
  })

  it('emits a CSS VARIABLE on a css-vars theme, so it would follow the scheme', () => {
    const accent = accentTextColor(
      consoleThemeCssVar as unknown as Theme,
      'primary',
    )
    expect(accent).toMatch(/^var\(--mui-palette-primary-dark[,)]/)
  })

  it('leaves non-PaletteColor colors alone', () => {
    for (const color of ['inherit', 'textPrimary', 'textSecondary', undefined]) {
      expect(accentTextColor(consoleThemeLight, color)).toBeUndefined()
    }
    expect(accentTextColor(undefined, 'primary')).toBeUndefined()
  })
})

describe('FINDINGS for a decision Zach owns — measured, never applied', () => {
  it('FINDING: `#00b0ff` as normal text misses both WCAG bars', () => {
    const ratio = contrastRatio(BRAND_BLUE, '#FFFFFF')
    expect(Number(ratio.toFixed(2))).toBe(2.43)
    expect(ratio).toBeLessThan(AA_TEXT_CONTRAST)
    expect(ratio).toBeLessThan(AA_NON_TEXT_CONTRAST)
    // Recorded and NOT acted on: this is why links, tabs and text buttons
    // rendering `#00b0ff` is a known state, not an accident.
  })

  it('DECIDED: white on the brand blue is the one signed-off exception', () => {
    for (const palette of [
      consoleThemeLight.palette,
      consoleThemeDark.palette,
    ]) {
      // Default result omits it — a decision is not an open defect.
      expect(auditPaletteContrast(palette, { colors: ['primary'] })).toEqual([])
      // With `includeExempt` the number is still there. The waiver documents
      // a ratio rather than hiding one.
      const [measured, ...rest] = auditPaletteContrast(palette, {
        colors: ['primary'],
        includeExempt: true,
      })
      expect(rest).toEqual([])
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

  it('the signed-off list is exactly one entry, so it cannot creep', () => {
    expect(DOCUMENTED_CONTRAST_EXCEPTIONS).toHaveLength(1)
    expect(DOCUMENTED_CONTRAST_EXCEPTIONS[0]).toMatchObject({
      color: 'primary',
      role: 'contrastText',
      value: '#FFFFFF',
      against: BRAND_BLUE,
    })
  })

  it('FINDING: the authored sub-AA contrastText literals, pinned as a set', () => {
    // AGL-1936. Reported, not repaired: flipping any of them repaints alert
    // and destructive semantics product-wide, which is Zach's call. Pinned so
    // the set can only change knowingly.
    const residue = (palette: any) =>
      auditPaletteContrast(palette)
        .map((v) => `${v.color}.${v.role}`)
        .sort()
    for (const palette of [
      consoleThemeLight.palette,
      consoleThemeDark.palette,
    ]) {
      expect(residue(palette)).toEqual([
        'error.contrastText',
        'info.contrastText',
        'secondary.contrastText',
      ])
    }
    // Three per scheme, six authored literals in total. The measured ratios,
    // recorded so the decision has numbers: white on `#e040fb` is 3.34:1, on
    // `#E53935` 4.23:1, on `#1e88e5` 3.68:1 — all under the 4.5 text bar,
    // all above the 3:1 non-text one.
    const measured = auditPaletteContrast(consoleThemeLight.palette).map(
      (v) => `${v.color}@${v.ratio.toFixed(2)}`,
    )
    expect(measured).toEqual([
      'secondary@3.34',
      'error@4.23',
      'info@3.68',
    ])
  })

  it('FINDING: getContrastTextColor is handed the TONAL OFFSET, not a threshold', () => {
    // A real bug, recorded rather than fixed: fixing it changes rendered
    // colours, and Zach has not asked for that. `addShade` passes
    // `tonalOffsetDark` (0.3) where a contrast threshold belongs, and every
    // colour on earth clears 0.3:1 — so the branch cannot fail and always
    // picks WHITE, for `tertiary` and `surface`, the two keys it serves.
    //
    // Its blast radius is smaller than that sounds, and the difference is
    // worth stating precisely rather than alarmingly: AGL-1297's
    // `ensureAccessibleShades` then walks that white until it clears AA, so
    // the SHIPPED value is not a contrast failure. What the bug costs is the
    // starting pole — the walk drags white down to a washed grey instead of
    // the choice simply being ink.
    //
    // Shown on a near-white custom colour, where the two answers differ
    // visibly. `surface`/`tertiary` are the only keys `addShade` touches; the
    // console authors both, so a synthetic palette is the honest witness.
    for (const key of ['surface', 'tertiary']) {
      const derived = createResponsiveTheme({
        themeOptions: {
          palette: { mode: 'light', [key]: { main: '#F8F9FA' } } as any,
        },
      })
      const shipped = (derived.palette as any)[key].contrastText
      // What it is: a mid grey, walked down from white.
      expect(shipped).toBe('#707070')
      // What a correct threshold would have chosen outright.
      expect(shipped).not.toBe('rgba(0, 0, 0, 0.87)')
      // And it does clear AA — so this is a wrong-pole finding, not a
      // legibility failure.
      expect(contrastRatio(shipped, '#F8F9FA')).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST,
      )
    }
  })

  it('the audit is not blind — it reports a rigged palette it should FAIL', () => {
    // A check that never fires on real input proves nothing; neither does one
    // that never passes. Both directions, on a synthetic palette so no
    // shipped colour is involved.
    const rigged = createTheme({
      palette: {
        mode: 'light',
        primary: { main: '#00b0ff', dark: '#7fd7ff', contrastText: '#FFFFFF' },
        background: { default: '#FFFFFF', paper: '#FFFFFF' },
      },
    })
    const violations = auditPaletteContrast(rigged.palette, {
      colors: ['primary'],
    })
    expect(violations.map((v) => v.role)).toEqual(['accentText', 'accentText'])
    // …and the exemption did NOT swallow the contrastText here, because it
    // matches on all four coordinates and this palette's are the same — so
    // the contrastText row is correctly absent as DECIDED, while the
    // accentText rows are correctly present as findings.
    expect(violations.every((v) => v.exemption === undefined)).toBe(true)
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

  it('RED: the SAME white on a DIFFERENT blue is not covered', () => {
    // One digit off the brand blue: a new decision nobody made.
    const violations = white('#00b1ff')
    expect(violations).toHaveLength(1)
    expect(violations[0].value).toBe('#FFFFFF')
    // Sanity: the exempted blue in the identical harness returns nothing.
    expect(white(BRAND_BLUE)).toEqual([])
  })

  it('RED: the SAME pairing on a DIFFERENT palette slot is not covered', () => {
    const violations = white(BRAND_BLUE, 'secondary')
    expect(violations).toHaveLength(1)
    expect(violations[0].color).toBe('secondary')
    expect(violations[0].exemption).toBeUndefined()
  })

  it('RED: it waives contrastText only — the SAME two colours in the accentText role report', () => {
    // Constructed so all three other coordinates collide with the waiver:
    // white foreground, brand-blue background, `primary`. Only the role
    // differs, which is what makes the role check load-bearing.
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
})
