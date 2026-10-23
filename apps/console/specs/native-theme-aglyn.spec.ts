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
 * The native apps' Aglyn theme is the look that ships (AGL-3950): the
 * console's resolved MUI scheme, the same one the native shared tokens are
 * generated from. This holds `THEME_PALETTES.aglyn` to that scheme, field by
 * field, so a change to the console's palette that skips the native theme is
 * red here: the text, divider and hover composited onto the paper they sit
 * on, and the status colors as the console's MUI Alert (standard) draws them.
 */

import { darken, decomposeColor, hslToRgb, lighten } from '@mui/material/styles'
import { getConsoleTheme } from '@aglyn/shared-ui-theme/console.theme'
import {
  deriveAccent,
  THEME_CONSOLE_FIELDS,
  THEME_PALETTES,
  type ThemeColors,
} from '@aglyn/aglyn/app-utils/native-themes'

function rgba(color: string): { rgb: number[]; alpha: number } {
  const decomposed = decomposeColor(color)
  const values = decomposed.type.startsWith('hsl') ? decomposeColor(hslToRgb(color)).values : decomposed.values
  return { rgb: values.slice(0, 3), alpha: decomposed.type.endsWith('a') ? (values[3] ?? 1) : 1 }
}

/** `color` as it renders over `ground`, as `#rrggbb`. */
function over(color: string, ground: string): string {
  const fg = rgba(color)
  const bg = rgba(ground)
  return `#${fg.rgb
    .map((value, index) =>
      Math.round(value * fg.alpha + bg.rgb[index] * (1 - fg.alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

function consoleScheme(mode: 'light' | 'dark'): Partial<ThemeColors> {
  const palette = getConsoleTheme(mode).palette
  const paper = palette.background.paper
  const solid = (color: string) => over(color, '#000000')
  const text = mode === 'light' ? darken : lighten
  const ground = mode === 'light' ? lighten : darken
  const alert = (intent: 'success' | 'warning' | 'error' | 'info') => ({
    bg: solid(ground(palette[intent].light, 0.9)),
    fg: solid(text(palette[intent].light, 0.6)),
  })
  return {
    canvas: solid(palette.background.default),
    surface: solid(paper),
    raised: solid(paper),
    hover: over(palette.action.hover, paper),
    borderSubtle: over(palette.divider, paper),
    textPrimary: over(palette.text.primary, paper),
    textSecondary: over(palette.text.secondary, paper),
    textTertiary: over(palette.text.disabled, paper),
    successBg: alert('success').bg,
    successFg: alert('success').fg,
    warningBg: alert('warning').bg,
    warningFg: alert('warning').fg,
    dangerBg: alert('error').bg,
    dangerFg: alert('error').fg,
    infoBg: alert('info').bg,
    infoFg: alert('info').fg,
  }
}

describe('the native Aglyn theme is the console’s scheme', () => {
  const aglyn = THEME_PALETTES.find((theme) => theme.id === 'aglyn')

  it('CONTROL: names its source and reads the console’s dark paper', () => {
    expect(aglyn?.source).toBe('console')
    expect(aglyn?.dark.surface).toBe('#2a3440')
  })

  it.each(['light', 'dark'] as const)('matches the console’s %s scheme field by field', (mode) => {
    const expected = consoleScheme(mode)
    expect(Object.keys(expected).sort()).toEqual([...THEME_CONSOLE_FIELDS].sort())
    const actual = Object.fromEntries(THEME_CONSOLE_FIELDS.map((field) => [field, aglyn?.[mode][field as keyof ThemeColors]]))
    expect(actual).toEqual(expected)
  })

  // The brand accent IS the console's primary (AGL-3990): the fill and the
  // white on it, the accent-text shade (`primary.dark`, AGL-1186) per scheme,
  // and the light hover fill (`primary.hover`, AGL-3465).
  it.each(['light', 'dark'] as const)('wears the console’s %s primary as its accent', (mode) => {
    const primary = getConsoleTheme(mode).palette.primary as { main: string; dark: string; contrastText: string; hover?: string }
    const accent = deriveAccent(aglyn?.accent ?? '')
    expect(accent?.fill).toBe(primary.main.toLowerCase())
    expect(accent?.on).toBe(primary.contrastText.toLowerCase())
    expect(mode === 'light' ? accent?.textLight : accent?.textDark).toBe(primary.dark.toLowerCase())
    if (mode === 'light') expect(accent?.hover).toBe(primary.hover?.toLowerCase())
  })
})
