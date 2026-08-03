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
import { renderHook } from '@testing-library/react'

import {
  buildColorTokenOptions,
  COLOR_PICKER_TOKEN_PATHS,
  ColorPickerTokensContext,
  resolvePaletteToken,
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
    // resolves, in order. A stock MUI theme has no `tertiary`/`surface`, so
    // those brand-only slots drop out — see the brand-palette case below.
    const stockPaths = COLOR_PICKER_TOKEN_PATHS.map((token) => token.path)
    expect(options.map((option) => option.value)).toEqual(
      stockPaths.filter((path) => !/^(tertiary|surface)\./.test(path)),
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
