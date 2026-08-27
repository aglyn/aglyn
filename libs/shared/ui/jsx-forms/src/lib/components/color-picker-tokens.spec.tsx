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

import { createTheme, ThemeProvider } from '@aglyn/shared-ui-theme'
import { render, renderHook } from '@testing-library/react'

import {
  buildColorTokenOptions,
  COLOR_PICKER_TOKEN_PATHS,
  ColorPickerTokensContext,
  resolvePaletteToken,
  TokenSwatch,
  useColorPickerTokenOptions,
} from './color-picker-tokens'

describe('resolvePaletteToken', () => {
  const palette = {
    primary: { main: '#123456' },
    divider: '#e0e0e0',
  }

  it('resolves nested paths and single-key paths', () => {
    expect(resolvePaletteToken(palette, 'primary.main')).toBe('#123456')
    expect(resolvePaletteToken(palette, 'divider')).toBe('#e0e0e0')
  })

  it('returns undefined for unknown or non-string targets', () => {
    expect(resolvePaletteToken(palette, 'primary.contrastText')).toBeUndefined()
    expect(resolvePaletteToken(palette, 'primary')).toBeUndefined()
    expect(resolvePaletteToken(undefined, 'primary.main')).toBeUndefined()
  })
})

describe('buildColorTokenOptions (AGL-588)', () => {
  it('carries token PATHS with both scheme resolutions', () => {
    const light = createTheme({ palette: { mode: 'light' } })
      .palette as unknown as Record<string, unknown>
    const dark = createTheme({ palette: { mode: 'dark' } })
      .palette as unknown as Record<string, unknown>
    const options = buildColorTokenOptions(light, dark)

    const paper = options.find((option) => option.value === 'background.paper')
    expect(paper).toBeDefined()
    expect(paper?.light).toBe('#fff')
    expect(paper?.dark).toBe('#121212')

    // The offered tokens are the default paths that the palette actually
    // resolves, in order. A stock MUI theme has no `tertiary`/`surface`/`tint`,
    // so those brand-only slots drop out — see the brand-palette case below.
    const stockPaths = COLOR_PICKER_TOKEN_PATHS.map((token) => token.path)
    expect(options.map((option) => option.value)).toEqual(
      stockPaths.filter((path) => !/^(tertiary|surface|tint)\./.test(path)),
    )
    // The stored value is the token path, never a resolved color.
    for (const option of options) {
      expect(option.value).not.toMatch(/^#|^rgb/)
    }
  })

  // AGL-1206: all three "Secondary" entries pointed at `primary.*`, so
  // choosing Secondary in the picker silently applied the PRIMARY colour —
  // and the repeated `primary.main` path gave the grid two identical React
  // keys, which is what AGL-1192 was seeing.
  it('offers secondary tokens that actually resolve to secondary', () => {
    const light = {
      primary: { main: '#00b0ff' },
      secondary: { main: '#e040fb' },
    }
    const options = buildColorTokenOptions(light, light)

    const secondary = options.find((o) => o.label === 'Secondary')
    expect(secondary?.value).toBe('secondary.main')
    expect(secondary?.light).toBe('#e040fb')

    const primary = options.find((o) => o.label === 'Primary')
    expect(primary?.value).toBe('primary.main')
    expect(primary?.light).toBe('#00b0ff')
  })

  it('never emits a duplicate token path', () => {
    const palette = {
      primary: { main: '#1', light: '#2', dark: '#3' },
      secondary: { main: '#4', light: '#5', dark: '#6' },
      tertiary: { main: '#7' },
      surface: { main: '#8' },
      grey: { 300: '#9', 600: '#a', 900: '#b' },
      common: { white: '#fff', black: '#000' },
      divider: '#c',
    }
    const values = buildColorTokenOptions(palette, palette).map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('offers the brand-only slots when the palette defines them', () => {
    const brand = {
      tertiary: { main: '#404C5C' },
      surface: { main: '#F8F9FA' },
      grey: { 600: '#757575' },
    }
    const options = buildColorTokenOptions(brand, {
      tertiary: { main: '#7C8CA3' },
      surface: { main: '#202934' },
      grey: { 600: '#757575' },
    })
    const tertiary = options.find((o) => o.value === 'tertiary.main')
    // The swatch shows BOTH scheme resolutions — the slate lifts in dark.
    expect(tertiary?.light).toBe('#404C5C')
    expect(tertiary?.dark).toBe('#7C8CA3')
    expect(options.find((o) => o.value === 'grey.600')?.light).toBe('#757575')
  })

  // AGL-1244: `tint` is a group of STRING leaves, not a `{ main }` record, so
  // it resolves through a different branch of `resolvePaletteToken` than every
  // other brand slot. If the picker could not offer it, an author repointing
  // the mega-menu tiles would have had to type the hex back in.
  it('offers the tints, which are string leaves rather than {main}', () => {
    const options = buildColorTokenOptions(
      {
        tint: { primary: '#E6F5FF', secondary: '#FBE6FE', tertiary: '#EEF0F2' },
      },
      {
        tint: { primary: '#143043', secondary: '#3D1443', tertiary: '#262B31' },
      },
    )
    const tint = options.find((o) => o.value === 'tint.primary')
    expect(tint?.label).toBe('Tint primary')
    // Both resolutions, which is what makes the swatch show the flip the
    // deleted `@scheme dark` slices used to hand-write.
    expect(tint?.light).toBe('#E6F5FF')
    expect(tint?.dark).toBe('#143043')
    expect(options.map((o) => o.value)).toEqual([
      'tint.primary',
      'tint.secondary',
      'tint.tertiary',
    ])
  })

  it('drops tokens that resolve in neither palette', () => {
    const options = buildColorTokenOptions(
      { primary: { main: '#111' } },
      { primary: { main: '#eee' } },
    )
    expect(options).toEqual([
      {
        value: 'primary.main',
        label: 'Primary',
        light: '#111',
        dark: '#eee',
      },
    ])
  })
})

describe('useColorPickerTokenOptions', () => {
  it('prefers context-provided options', () => {
    const provided = [
      { value: 'primary.main', label: 'Primary', light: '#111', dark: '#eee' },
    ]
    const { result } = renderHook(() => useColorPickerTokenOptions(), {
      wrapper: ({ children }) => (
        <ColorPickerTokensContext.Provider value={provided}>
          {children}
        </ColorPickerTokensContext.Provider>
      ),
    })
    expect(result.current).toBe(provided)
  })

  it('falls back to the ambient theme palette, filed under its scheme', () => {
    const theme = createTheme({ palette: { mode: 'dark' } })
    const { result } = renderHook(() => useColorPickerTokenOptions(), {
      wrapper: ({ children }) => (
        <ThemeProvider theme={theme}>{children}</ThemeProvider>
      ),
    })
    const paper = result.current.find(
      (option) => option.value === 'background.paper',
    )
    expect(paper?.dark).toBe('#121212')
    expect(paper?.light).toBeUndefined()
  })
})

/**
 * The emotion rules attached to a rendered element, joined into one CSS
 * string. The swatch is styled entirely through `styled()`, so the generated
 * declarations are the only place its geometry can be read back.
 */
function renderedCss(element: HTMLElement): string {
  const sheets = Array.from(document.querySelectorAll('style'))
    .map((style) => {
      // Emotion writes rule text into the tag while it is not in speedy
      // mode and inserts through the CSSOM when it is; read both, and
      // normalise the separator spacing the CSSOM adds back.
      const text = style.textContent ?? ''
      if (text) return text
      const rules = (style as HTMLStyleElement).sheet?.cssRules
      return rules
        ? Array.from(rules)
            .map((rule) => rule.cssText)
            .join('\n')
        : ''
    })
    .join('\n')
    .replace(/\s+/g, ' ')
    .replace(/\s*([:;,{}])\s*/g, '$1')
  return Array.from(element.classList)
    .flatMap(
      (className) =>
        sheets.match(new RegExp(`\\.${className}\\{[^}]*\\}`, 'g')) ?? [],
    )
    .join('\n')
}

describe('TokenSwatch geometry', () => {
  const renderSwatch = (props: Record<string, unknown>) => {
    const { container } = render(
      <ThemeProvider theme={createTheme()}>
        <TokenSwatch data-testid="swatch" {...props} />
      </ThemeProvider>,
    )
    return renderedCss(container.querySelector('[data-testid="swatch"]')!)
  }

  it('anchors its layers on the border box so no tile edge shows', () => {
    // A background left on the default `padding-box` origin is positioned in
    // an area two pixels smaller than the bordered box it paints, and the
    // repeat fills the leftover edge bands from the next tile — where a
    // diagonal split sits several pixels across.
    const css = renderSwatch({ light: '#111111', dark: '#eeeeee' })
    expect(css).toContain('background-origin:border-box')
    expect(css).toContain('background-repeat:no-repeat')
    expect(css).toContain('background-size:100% 100%')
  })

  it('meets the two halves exactly on the diameter', () => {
    const css = renderSwatch({ light: '#111111', dark: '#eeeeee' })
    expect(css).toContain(
      'linear-gradient(105deg,#111111 0 50%,#eeeeee 50% 100%)',
    )
  })

  it('keeps the chequerboard tiling under a translucent fill', () => {
    const css = renderSwatch({ light: '#111111', dark: '#eeeeee', alpha: 0.25 })
    expect(css).toContain('repeating-conic-gradient')
    // The fill covers the swatch once; only the chequerboard repeats.
    expect(css).toContain('background-repeat:no-repeat,repeat')
    expect(css).toContain('background-size:100% 100%,8px 8px')
  })

  it('paints a single flat fill when both schemes resolve alike', () => {
    const css = renderSwatch({ light: '#111111', dark: '#111111' })
    expect(css).toContain('linear-gradient(#111111,#111111)')
    expect(css).not.toContain('105deg')
  })
})
