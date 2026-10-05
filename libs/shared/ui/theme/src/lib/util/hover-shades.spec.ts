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
 * Every button color has a defined HOVER, in both schemes, and its label
 * clears AA on it (AGL-3465).
 *
 * MUI fills a hovered contained Button with `palette[color].dark`, and this
 * theme's `dark` is the accent rendered as TEXT — lighter than `main` in a
 * dark scheme. So a hovered fill rose toward its white label instead of away
 * from it. The hover pair is measured here the way a visitor meets it: from
 * the CSS emotion emits for a real rendered component, with the winning
 * declaration taken in source order.
 */
import MuiButton from '@mui/material/Button'
import MuiFab from '@mui/material/Fab'
import { ThemeProvider } from '@mui/material/styles'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import type { Theme } from '../../vendor/mui'
import {
  consoleThemeCssVar,
  consoleThemeDark,
  consoleThemeLight,
} from '../console.theme'
import {
  siteBaseOptions,
  tenantThemeDark,
  tenantThemeLight,
} from '../tenant.theme'
import {
  ACCENT_HOVER_FILL,
  ACCENT_HOVER_TEXT,
  hoverFillShade,
  inkContrast,
  inkOnFill,
} from './accent-text'
import {
  AA_TEXT_CONTRAST,
  contrastRatio,
  relativeLuminance,
} from './accessible-shade'
import createResponsiveTheme from './create-responsive-theme'
import { hostThemeToThemeOptions, mergeThemeOptions } from './host-theme'

/**
 * The rules emotion emitted for one rendered component, scoped by its
 * generated class so one case never reads another's — the sheet is global.
 * Under jsdom emotion inserts through the CSSOM, so they are read off the
 * sheet rather than a `<style>` tag's text.
 */
function renderRules(
  theme: Theme,
  Component: unknown,
  props: Record<string, unknown>,
): string[] {
  const { container, unmount } = render(
    createElement(
      ThemeProvider,
      { theme },
      createElement(Component as any, props as any, 'Label'),
    ),
  )
  const element = container.querySelector('a, button')
  expect(element).not.toBeNull()
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
  // With no rules every assertion below would pass vacuously.
  expect(rules.length).toBeGreaterThan(0)
  return rules
}

/** The value that WINS for `property` across `rules`: the last one declared. */
function winning(rules: string[], property: string): string | undefined {
  const values = rules.flatMap((rule) =>
    (
      rule.match(new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;}]*)`, 'g')) ?? []
    ).map((decl) => decl.slice(decl.indexOf(':') + 1).trim()),
  )
  return values[values.length - 1]
}

/** Rules that apply while a pointer is over the element. */
const hoverRules = (rules: string[]) =>
  rules.filter(
    (rule) =>
      rule.startsWith('@media (hover: hover)') && rule.includes(':hover'),
  )

/** Rules that apply at rest — no state, no media query. */
const restRules = (rules: string[]) =>
  rules.filter((rule) => !rule.startsWith('@') && !/:hover|\.Mui-/.test(rule))

type Variant = 'contained' | 'outlined' | 'text'

/**
 * The hovered label and the fill(s) it sits on. A contained button paints
 * its own fill; text and outlined lay a translucent wash over whatever they
 * sit on, so they are measured over the theme's page AND paper.
 */
function hoveredButton(theme: Theme, color: string, variant: Variant) {
  const rules = renderRules(theme, MuiButton, { variant, color })
  const hover = hoverRules(rules)
  const rest = restRules(rules)
  const { palette } = theme
  // `inherit` takes the surrounding text colour, which on a page is this.
  const inherited = palette.text.primary
  if (variant === 'contained') {
    const fill = winning(hover, '--variant-containedBg')
    const label =
      color === 'inherit'
        ? inherited
        : winning(rest, '--variant-containedColor')
    return { label: label as string, fills: [fill as string] }
  }
  const labelVar = `--variant-${variant}Color`
  const label =
    color === 'inherit'
      ? inherited
      : (winning(hover, labelVar) ?? winning(rest, labelVar))
  const wash = winning(hover, `--variant-${variant}Bg`) as string
  const fills = [palette.background.default, palette.background.paper].map(
    (surface) => inkOnFill(wash, surface),
  )
  return { label: label as string, fills }
}

/** A customer site in the dark scheme: base, then its own colours over it. */
const customerDark = createResponsiveTheme({
  themeOptions: mergeThemeOptions(
    siteBaseOptions('acme', 'dark'),
    hostThemeToThemeOptions(
      {
        colorSchemes: {
          dark: {
            // Light-ink accents, the kind whose derived text shade lifts
            // toward white in a dark scheme.
            primary: { main: '#6200ea' },
            tertiary: { main: '#5c6bc0', contrastText: '#FFFFFF' },
            // A dark-ink accent, the other direction.
            secondary: { main: '#03dac6' },
          },
        },
      },
      'dark',
    ),
  ),
})

const customerLight = createResponsiveTheme({
  themeOptions: mergeThemeOptions(
    siteBaseOptions('acme', 'light'),
    hostThemeToThemeOptions(
      {
        colorSchemes: {
          light: {
            primary: { main: '#6200ea' },
            tertiary: { main: '#5c6bc0', contrastText: '#FFFFFF' },
            secondary: { main: '#03dac6' },
          },
        },
      },
      'light',
    ),
  ),
})

const THEMES: ReadonlyArray<readonly [string, Theme]> = [
  ['console light', consoleThemeLight],
  ['console dark', consoleThemeDark],
  ['tenant light', tenantThemeLight],
  ['tenant dark', tenantThemeDark],
  ['customer light', customerLight],
  ['customer dark', customerDark],
]

const ACCENTS = [
  'primary',
  'secondary',
  'tertiary',
  'info',
  'error',
  'success',
  'warning',
] as const

const slot = (theme: Theme, color: string, name: string) =>
  (theme.palette as unknown as Record<string, Record<string, string>>)[color]?.[
    name
  ]

describe('AGL-3465: the dark-scheme tertiary contained hover', () => {
  it('fills with the tertiary hover shade under the tertiary ink, at AA', () => {
    const { label, fills } = hoveredButton(
      consoleThemeDark,
      'tertiary',
      'contained',
    )
    expect(fills).toEqual(['#a3afbf'])
    expect(fills[0]).toBe(slot(consoleThemeDark, 'tertiary', ACCENT_HOVER_FILL))
    expect(label).toBe('#000000DE')
    expect(label).toBe(consoleThemeDark.palette.tertiary.contrastText)
    const ratio = inkContrast(label, fills[0])
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST)
    expect(ratio).toBeCloseTo(8.08, 2)
  })

  it('does the same on a customer site, under the tenant default palette', () => {
    const { label, fills } = hoveredButton(
      tenantThemeDark,
      'tertiary',
      'contained',
    )
    expect(fills).toEqual(['#b4bfcd'])
    expect(label).toBe('#000000DE')
    expect(inkContrast(label, fills[0])).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    )
  })

  it('darkens AWAY from a white tertiary label instead of rising toward it', () => {
    // A customer tertiary with white ink. Its text shade is walked LIGHTER
    // for the dark page, so MUI's hover on it would put white on a pale
    // fill; the hover shade goes the other way.
    const palette = customerDark.palette.tertiary
    expect(palette.contrastText).toBe('#FFFFFF')
    expect(inkContrast('#FFFFFF', palette.dark)).toBeLessThan(AA_TEXT_CONTRAST)

    const { label, fills } = hoveredButton(
      customerDark,
      'tertiary',
      'contained',
    )
    expect(label).toBe('#FFFFFF')
    expect(fills[0]).not.toBe(palette.dark)
    expect(relativeLuminance(fills[0])).toBeLessThan(
      relativeLuminance(palette.main),
    )
    expect(inkContrast(label, fills[0])).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    )
  })

  it('the brand primary no longer hovers to white on light blue', () => {
    // What MUI painted before: white on `primary.dark`, 1.91:1.
    expect(
      contrastRatio('#FFFFFF', consoleThemeDark.palette.primary.dark),
    ).toBeCloseTo(1.91, 2)
    const { label, fills } = hoveredButton(
      consoleThemeDark,
      'primary',
      'contained',
    )
    expect(label).toBe('#FFFFFF')
    expect(fills).toEqual(['#007bb2'])
    expect(inkContrast(label, fills[0])).toBeCloseTo(4.69, 2)
  })
})

describe('every color × variant has a hover whose label clears AA', () => {
  it('in every shipped palette and a customer one, light and dark', () => {
    const failures: string[] = []
    let measured = 0
    for (const [name, theme] of THEMES) {
      for (const color of [...ACCENTS, 'inherit']) {
        for (const variant of ['contained', 'outlined', 'text'] as const) {
          const { label, fills } = hoveredButton(theme, color, variant)
          for (const fill of fills) {
            measured += 1
            const ratio = inkContrast(label, fill)
            if (!(ratio >= AA_TEXT_CONTRAST)) {
              failures.push(
                `${name} ${color} ${variant}: ${label} on ${fill} = ${ratio.toFixed(2)}`,
              )
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
    // 6 themes × 8 colors × (1 contained fill + 2 surfaces × 2 variants).
    expect(measured).toBe(6 * 8 * 5)
  })

  it('`surface`, a fill rather than a foreground, has a contained hover too', () => {
    // Its `dark` is a surface step, not text, so text and outlined surface
    // buttons have no accent label to protect and get no `hoverText`.
    for (const [name, theme] of THEMES) {
      const { label, fills } = hoveredButton(theme, 'surface', 'contained')
      expect({
        name,
        ok: inkContrast(label, fills[0]) >= AA_TEXT_CONTRAST,
      }).toEqual({ name, ok: true })
      expect(slot(theme, 'surface', ACCENT_HOVER_TEXT)).toBeUndefined()
    }
  })

  it('negative control: MUI’s own hover, `dark`, fails where the fix is needed', () => {
    // Guards against the sweep passing because the harness stopped reading
    // the hover: on these the pre-fix fill is measurably sub-AA.
    const darkFills = [
      [consoleThemeDark, 'primary'],
      [consoleThemeDark, 'secondary'],
      [consoleThemeDark, 'info'],
      [consoleThemeDark, 'error'],
      [tenantThemeDark, 'primary'],
      [consoleThemeLight, 'success'],
      [consoleThemeLight, 'warning'],
    ] as const
    for (const [theme, color] of darkFills) {
      const paletteColor = theme.palette[color]
      expect(
        inkContrast(paletteColor.contrastText, paletteColor.dark),
      ).toBeLessThan(AA_TEXT_CONTRAST)
      expect(hoveredButton(theme, color, 'contained').fills[0]).toBe(
        slot(theme, color, ACCENT_HOVER_FILL),
      )
    }
  })
})

describe('the hover shades change nothing that was already legible', () => {
  it('keeps `dark` as the fill wherever it already carried the ink', () => {
    for (const [name, theme] of THEMES) {
      for (const color of [...ACCENTS, 'surface']) {
        const paletteColor = (theme.palette as any)[color]
        const legible =
          inkContrast(paletteColor.contrastText, paletteColor.dark) >=
            AA_TEXT_CONTRAST &&
          contrastRatio(paletteColor.main, paletteColor.dark) >= 1.1
        if (legible) {
          expect({ name, color, hover: paletteColor.hover }).toEqual({
            name,
            color,
            hover: paletteColor.dark,
          })
        }
      }
    }
    // The brand's own light-scheme hover is the one people know.
    expect(consoleThemeLight.palette.primary.hover).toBe('#0077ad')
  })

  it('keeps `dark` as the hovered label wherever it already cleared the wash', () => {
    // One shipped label moves: the brand blue's text shade sits at 4.54:1
    // on the light page and 4.37:1 once the wash is under it.
    expect(consoleThemeLight.palette.primary.hoverText).toBe('#0073a8')
    expect(consoleThemeLight.palette.secondary.hoverText).toBe(
      consoleThemeLight.palette.secondary.dark,
    )
    expect(consoleThemeDark.palette.primary.hoverText).toBe(
      consoleThemeDark.palette.primary.dark,
    )
  })
})

describe('the overrides follow the scheme', () => {
  it('a CSS-vars theme emits the slot as a variable both schemes define', () => {
    const root = (consoleThemeCssVar.components as any).MuiButton.styleOverrides
      .root
    const hover = root({
      theme: consoleThemeCssVar,
      ownerState: { color: 'tertiary' },
    })['@media (hover: hover)']['&:hover']
    expect(hover['--variant-containedBg']).toMatch(
      /^var\(--mui-palette-tertiary-hover[,)]/,
    )
    expect(hover['--variant-textColor']).toMatch(
      /^var\(--mui-palette-tertiary-hoverText[,)]/,
    )
    const schemes = (consoleThemeCssVar as any).colorSchemes
    expect(schemes.dark.palette.tertiary.hover).toBe(
      consoleThemeDark.palette.tertiary.hover,
    )
    expect(schemes.light.palette.tertiary.hover).toBe(
      consoleThemeLight.palette.tertiary.hover,
    )
  })

  it('`inherit` keeps MUI’s grey hover — it has no palette entry', () => {
    const root = (consoleThemeDark.components as any).MuiButton.styleOverrides
      .root
    expect(
      root({ theme: consoleThemeDark, ownerState: { color: 'inherit' } })[
        '@media (hover: hover)'
      ],
    ).toBeUndefined()
  })

  it('a Fab hovers to the same shade, under the same ink', () => {
    for (const [theme, color] of [
      [consoleThemeDark, 'tertiary'],
      [consoleThemeDark, 'primary'],
      [tenantThemeDark, 'secondary'],
    ] as const) {
      const rules = renderRules(theme, MuiFab, { color })
      const fill = winning(hoverRules(rules), 'background-color') as string
      expect(fill).toBe(slot(theme, color, ACCENT_HOVER_FILL))
      expect(
        inkContrast(theme.palette[color].contrastText, fill),
      ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST)
    }
  })
})

describe('hoverFillShade', () => {
  it('darkens under a light label', () => {
    expect(
      hoverFillShade({
        main: '#00b0ff',
        dark: '#4dc8ff',
        contrastText: '#FFFFFF',
      }),
    ).toBe('#007bb2')
  })

  it('lightens under a dark label, where darkening would sink the ink', () => {
    const fill = hoverFillShade({
      main: '#4CAF50',
      dark: '#357a38',
      contrastText: '#000000DE',
    })
    expect(relativeLuminance(fill)).toBeGreaterThan(
      relativeLuminance('#4CAF50'),
    )
    expect(inkContrast('#000000DE', fill)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    )
  })

  it('steps toward the ink when the fill is already at the far pole', () => {
    // White under black: lightening changes nothing a pointer could see.
    const fill = hoverFillShade({
      main: '#FFFFFF',
      dark: '#FFFFFF',
      contrastText: '#000000',
    })
    expect(contrastRatio('#FFFFFF', fill)).toBeGreaterThanOrEqual(1.1)
    expect(inkContrast('#000000', fill)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    )
  })

  it('an authored slot passes through createResponsiveTheme untouched', () => {
    const theme = createResponsiveTheme({
      themeOptions: {
        palette: {
          mode: 'dark',
          primary: {
            main: '#00b0ff',
            contrastText: '#FFFFFF',
            hover: '#123456',
            hoverText: '#abcdef',
          },
        },
      },
    })
    expect(theme.palette.primary.hover).toBe('#123456')
    expect(theme.palette.primary.hoverText).toBe('#abcdef')
  })
})
