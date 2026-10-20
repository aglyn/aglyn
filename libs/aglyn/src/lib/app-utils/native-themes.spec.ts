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
  deriveAccent,
  deriveThemeFromPreview,
  THEME_ACCENTS,
  THEME_ACCENT_SWATCHES,
  THEME_DARK_RAIL_SEEDS,
  THEME_DENSITIES,
  THEME_FIGMA_BASE,
  THEME_PALETTES,
  THEME_PREVIEWS,
  THEME_RETIRED_ACCENTS,
  themeContrast,
  themeLerp,
  type ThemeColors,
} from './native-themes'

/**
 * The native themes (AGL-3950). Figma's Native App variables are the
 * source wherever they define a value; these hold the values to Figma, and
 * the two derivations (accents, and the Ocean and Warm themes from their
 * previews) to the readability bars they promise.
 */

const COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/

/**
 * Figma's Accent collection, mode by mode (variables read 2026-10-19, after
 * Blue became the console's primary and every mode's on-accent went white,
 * AGL-3990).
 */
const FIGMA_ACCENT_MODES = {
  blue: {
    fill: '#00b0ff',
    icon: '#00b0ff',
    soft: '#00b0ff29',
    ring: '#00b0ff',
    on: '#ffffff',
    hover: '#0077ad',
    pressed: '#006999',
    textLight: '#0077ad',
    textDark: '#4dc8ff',
  },
  violet: { fill: '#5b3fd6', icon: '#8c72f5', soft: '#7a5cf02e', ring: '#7a5cf0', on: '#ffffff', hover: '#4e34c2', pressed: '#4129aa' },
  pink: { fill: '#e040fb', icon: '#c93ae3', soft: '#e040fb29', ring: '#e040fb', on: '#ffffff', hover: '#cc2ee6', pressed: '#b523cf' },
  workspaceBrand: { fill: '#2e7d5b', icon: '#2e8f66', soft: '#2e7d5b2e', ring: '#3fa77a', on: '#ffffff', hover: '#276c4e', pressed: '#205a41' },
}

describe('the accents', () => {
  it.each(Object.entries(FIGMA_ACCENT_MODES))('reproduces Figma’s %s mode exactly', (id, mode) => {
    const named = THEME_ACCENTS.find((entry) => entry.id === id)
    expect(named?.accent).toMatchObject(mode)
    expect(deriveAccent(mode.ring)).toMatchObject(mode)
  })

  it('anchors contrast where the console measures it: the brand blue is 2.43:1 on white', () => {
    expect(themeContrast('#00b0ff', '#ffffff')).toBeCloseTo(2.43, 2)
  })

  it('keeps a brand color that carries white at 3:1 with white on it, as Figma draws Pink', () => {
    const pinkish = deriveAccent('#e040fa')
    expect(pinkish?.fill).toBe('#e040fa')
    expect(pinkish?.on).toBe('#ffffff')
    expect(themeContrast(pinkish?.fill ?? '', pinkish?.on ?? '')).toBeGreaterThanOrEqual(3)
  })

  it('never puts ink on a fill: every accent, named or derived, carries white (Zach, 2026-10-19)', () => {
    for (const color of ['#00b0ff', '#e040fb', '#ffab40', '#ffffff', '#c2571a', '#7a5cf0', '#3fa77a']) {
      expect([color, deriveAccent(color)?.on]).toEqual([color, '#ffffff'])
    }
  })

  it('wears the console primary as the brand blue: #00B0FF under white, #0077AD and #4DC8FF as text (AGL-3990)', () => {
    const blue = deriveAccent('#00b0ff')
    expect(blue).toMatchObject({ fill: '#00b0ff', on: '#ffffff', textLight: '#0077ad', textDark: '#4dc8ff', hover: '#0077ad' })
    expect(themeContrast(blue?.textLight ?? '', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(themeContrast(blue?.textDark ?? '', '#2a3440')).toBeGreaterThanOrEqual(4.5)
  })

  it('reads a retired blue as the brand blue: an accent saved from the old #0073AE swatch', () => {
    expect(THEME_RETIRED_ACCENTS).toEqual({ '#0073ae': '#00b0ff' })
    expect(deriveAccent('#0073ae')).toEqual(deriveAccent('#00b0ff'))
    expect(deriveAccent('#0073AE')).toEqual(deriveAccent('#00b0ff'))
  })

  it('darkens a color under 3:1 until white text reads, as Figma draws the workspace green', () => {
    for (const color of ['#00b0fe', '#3fa779']) {
      const accent = deriveAccent(color)
      expect(accent?.on).toBe('#ffffff')
      expect(accent?.fill).not.toBe(color)
      expect(themeContrast(accent?.fill ?? '', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['#0077ad', '#c2571a', '#087e8b', '#ffab40', '#4caf50', '#d2462f', '#404c5c', '#ffffff', '#000000'])(
    'derives %s so every shade reads where it is drawn',
    (color) => {
      const accent = deriveAccent(color)
      expect(accent).not.toBeNull()
      if (!accent) return
      for (const value of Object.values(accent)) expect(value).toMatch(COLOR)
      expect(accent.ring).toBe(color)
      expect(accent.soft).toBe(`${color}29`)
      expect(themeContrast(accent.fill, accent.on)).toBeGreaterThanOrEqual(3)
      expect(themeContrast(accent.textLight, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(themeContrast(accent.textDark, '#1e262e')).toBeGreaterThanOrEqual(color === '#000000' ? 1 : 4.5)
    },
  )

  it('answers nothing for a value that is not a color', () => {
    expect(deriveAccent('blue')).toBeNull()
    expect(deriveAccent('#12345')).toBeNull()
  })

  it('offers Figma’s five swatches, #00B0FF the one brand blue', () => {
    expect(THEME_ACCENT_SWATCHES.map((swatch) => [swatch.label, swatch.color])).toEqual([
      ['Brand blue', '#00b0ff'],
      ['Violet', '#7a5cf0'],
      ['Pink', '#e040fb'],
      ['Green', '#2e7d5b'],
      ['Warm', '#c2571a'],
    ])
  })
})

describe('the themes', () => {
  const readable = (colors: ThemeColors) =>
    [colors.canvas, colors.surface, colors.raised].every(
      (ground) =>
        themeContrast(colors.textPrimary, ground) >= 4.5 && themeContrast(colors.textSecondary, ground) >= 4.5,
    )

  it('lists the six themes: the console’s look, three from Figma, two derived from Figma’s previews', () => {
    expect(THEME_PALETTES.map((theme) => [theme.id, theme.source])).toEqual([
      ['aglyn', 'console'],
      ['quiet', 'figma'],
      ['night', 'figma'],
      ['ocean', 'derived'],
      ['warm', 'derived'],
      ['highContrast', 'figma'],
    ])
  })

  it('holds every color to #RRGGBB(AA)', () => {
    for (const theme of THEME_PALETTES) {
      for (const value of [...Object.values(theme.light), ...Object.values(theme.dark), theme.accent]) {
        expect([theme.id, value]).toEqual([theme.id, expect.stringMatching(COLOR)])
      }
    }
  })

  it('keeps Night the same in both appearances', () => {
    const night = THEME_PALETTES.find((theme) => theme.id === 'night')
    expect(night?.alwaysDark).toBe(true)
    expect(night?.light).toEqual(night?.dark)
  })

  it('derives Ocean and Warm from their previews by the documented rule', () => {
    for (const id of ['ocean', 'warm'] as const) {
      const theme = THEME_PALETTES.find((entry) => entry.id === id)
      const preview = THEME_PREVIEWS[id]
      const derived = deriveThemeFromPreview(preview, THEME_DARK_RAIL_SEEDS[id])
      expect(theme?.light).toEqual(derived.light)
      expect(theme?.dark).toEqual(derived.dark)
      expect(theme?.light).toMatchObject({ canvas: preview.canvas, surface: preview.surface, rail: preview.rail })
      expect(theme?.accent).toBe(preview.accent)
    }
  })

  it('keeps every theme’s text readable on its own grounds', () => {
    for (const theme of THEME_PALETTES) {
      expect([theme.id, 'light', readable(theme.light)]).toEqual([theme.id, 'light', true])
      expect([theme.id, 'dark', readable(theme.dark)]).toEqual([theme.id, 'dark', true])
    }
  })
})

it('names the shipping theme after the configured brand, never a literal', () => {
  const aglyn = THEME_PALETTES.find((theme) => theme.id === 'aglyn')
  expect(aglyn).toMatchObject({ label: '', brandLabel: true })
})

it('exports the Figma base the preview derivation starts from, so the platforms can replay it', () => {
  expect(THEME_FIGMA_BASE.light.borderSubtle).toBe('#e3e7ec')
  expect(THEME_FIGMA_BASE.dark.surface).toBe('#1e262e')
  const ocean = deriveThemeFromPreview(THEME_PREVIEWS.ocean, THEME_DARK_RAIL_SEEDS.ocean)
  expect(ocean.light.borderSubtle).toBe(themeLerp(THEME_FIGMA_BASE.light.borderSubtle, THEME_PREVIEWS.ocean.rail, 0.18))
  expect(ocean.dark.canvas).toBe(themeLerp(THEME_FIGMA_BASE.dark.canvas, THEME_DARK_RAIL_SEEDS.ocean, 0.22))
  expect(ocean.light.textPrimary).toBe(THEME_FIGMA_BASE.light.textPrimary)
})

describe('the densities', () => {
  it('holds Figma’s rows: 32 and 28 pt rows, 52 and 44 pt title bars', () => {
    expect(THEME_DENSITIES.map((density) => [density.id, density.rowHeight, density.titlebarHeight, density.listRowHeight])).toEqual([
      ['comfortable', 32, 52, 60],
      ['compact', 28, 44, 48],
    ])
  })
})
