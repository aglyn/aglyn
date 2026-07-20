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

    // Every default token resolves in a stock MUI theme.
    expect(options.map((option) => option.value)).toEqual(
      COLOR_PICKER_TOKEN_PATHS.map((token) => token.path),
    )
    // The stored value is the token path, never a resolved color.
    for (const option of options) {
      expect(option.value).not.toMatch(/^#|^rgb/)
    }
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
