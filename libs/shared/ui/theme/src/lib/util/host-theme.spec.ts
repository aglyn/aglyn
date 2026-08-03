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
import { createTheme } from '../../vendor/mui'
import {
  getGoogleFontsUrl,
  hasHostTheme,
  hostThemeToThemeOptions,
  mergeThemeOptions,
  sanitizeHostTheme,
} from './host-theme'
import { consoleOptions } from '../console.theme'

describe('hostThemeToThemeOptions', () => {
  it('returns mode-only palette options for an empty theme', () => {
    expect(hostThemeToThemeOptions(undefined, 'light')).toEqual({
      palette: { mode: 'light' },
    })
    expect(hostThemeToThemeOptions({}, 'dark')).toEqual({
      palette: { mode: 'dark' },
    })
  })

  it('forwards scheme colors and lets MUI derive missing shades', () => {
    const theme: HostTheme = {
      colorSchemes: {
        light: {
          primary: { main: '#336699' },
          background: { default: '#fafafa' },
          divider: '#e0e0e0',
        },
        dark: {
          primary: { main: '#88aacc' },
        },
      },
    }

    const light = hostThemeToThemeOptions(theme, 'light')
    expect(light.palette).toMatchObject({
      mode: 'light',
      primary: { main: '#336699' },
      background: { default: '#fafafa' },
      divider: '#e0e0e0',
    })

    const dark = hostThemeToThemeOptions(theme, 'dark')
    expect(dark.palette).toMatchObject({
      mode: 'dark',
      primary: { main: '#88aacc' },
    })

    // MUI derives the unset shades from `main`.
    const mui = createTheme(light)
    expect(mui.palette.primary.light).toBeTruthy()
    expect(mui.palette.primary.dark).toBeTruthy()
    expect(mui.palette.primary.contrastText).toBeTruthy()
  })

  it('maps typography font family and variant overrides', () => {
    const options = hostThemeToThemeOptions(
      {
        typography: {
          fontFamily: '"Inter", sans-serif',
          variants: {
            h1: { fontWeight: 800 },
            button: { textTransform: 'none' },
          },
        },
      },
      'light',
    )
    expect(options.typography).toEqual({
      fontFamily: '"Inter", sans-serif',
      h1: { fontWeight: 800 },
      button: { textTransform: 'none' },
    })
  })

  it('maps shape, spacing, and whitelisted component overrides', () => {
    const options = hostThemeToThemeOptions(
      {
        shape: { borderRadius: 12 },
        spacing: 4,
        components: {
          MuiButton: { defaultProps: { disableElevation: true } },
          MuiEvilComponent: { styleOverrides: { root: { display: 'none' } } },
        },
      },
      'light',
    )
    expect(options.shape).toEqual({ borderRadius: 12 })
    expect(options.spacing).toBe(4)
    expect(options.components).toEqual({
      MuiButton: { defaultProps: { disableElevation: true } },
    })
  })
})

describe('sanitizeHostTheme', () => {
  it('strips non-whitelisted components without mutating the input', () => {
    const theme: HostTheme = {
      components: {
        MuiLink: { styleOverrides: { root: { textDecoration: 'none' } } },
        MuiDataGrid: { defaultProps: { density: 'compact' } },
      },
    }
    const sanitized = sanitizeHostTheme(theme)
    expect(Object.keys(sanitized.components ?? {})).toEqual(['MuiLink'])
    expect(Object.keys(theme.components ?? {})).toEqual([
      'MuiLink',
      'MuiDataGrid',
    ])
  })

  it('drops the components branch entirely when nothing survives', () => {
    const sanitized = sanitizeHostTheme({
      components: { MuiDataGrid: { defaultProps: {} } },
    })
    expect(sanitized.components).toBeUndefined()
  })
})

describe('mergeThemeOptions (AGL-1180)', () => {
  // The regression: `hasHostTheme({ spacing: 8 })` is true, so customizing a
  // single unrelated value used to switch the whole site off the brand theme
  // and onto MUI's stock palette.
  it('keeps every brand colour when the host customizes only spacing', () => {
    const merged = mergeThemeOptions(
      consoleOptions,
      hostThemeToThemeOptions({ spacing: 8 }, 'light'),
    )
    const palette = merged.palette as Record<string, { main?: string }>
    expect(palette['primary']?.main).toBe('#404C5C')
    expect(palette['secondary']?.main).toBe('#00b0ff')
    expect(palette['tertiary']?.main).toBe('#e040fb')
  })

  it('applies the override without dropping its siblings', () => {
    const merged = mergeThemeOptions(
      consoleOptions,
      hostThemeToThemeOptions(
        { colorSchemes: { light: { primary: { main: '#123456' } } } },
        'light',
      ),
    )
    const palette = merged.palette as Record<string, { main?: string }>
    expect(palette['primary']?.main).toBe('#123456')
    // The whole point: overriding primary must not repaint secondary.
    expect(palette['secondary']?.main).toBe('#00b0ff')
  })

  // The reason components must merge deeply: the brand styles several of
  // them with FUNCTIONS of the theme, which JSON cannot express — so a
  // shallow merge would let a one-property override delete styling the
  // editor could never put back.
  it('keeps a component style function when the host overrides a sibling prop', () => {
    const rootStyle = () => ({ padding: 8 })
    const merged = mergeThemeOptions(
      {
        components: {
          MuiButton: {
            defaultProps: { color: 'secondary', size: 'small' },
            styleOverrides: { root: rootStyle },
          },
        },
      } as any,
      {
        components: {
          MuiButton: { defaultProps: { color: 'primary' } },
        },
      } as any,
    )
    const button = (merged.components as any).MuiButton
    expect(button.defaultProps.color).toBe('primary')
    // Untouched sibling property and the function both survive.
    expect(button.defaultProps.size).toBe('small')
    expect(button.styleOverrides.root).toBe(rootStyle)
  })

  it('leaves other components alone when one is overridden', () => {
    const merged = mergeThemeOptions(
      {
        components: {
          MuiButton: { defaultProps: { color: 'secondary' } },
          MuiLink: { defaultProps: { underline: 'hover' } },
        },
      } as any,
      { components: { MuiButton: { defaultProps: { color: 'primary' } } } } as any,
    )
    expect((merged.components as any).MuiLink.defaultProps.underline).toBe(
      'hover',
    )
  })

  it('replaces arrays rather than merging them', () => {
    const merged = mergeThemeOptions(
      { components: { MuiX: { variants: ['a', 'b', 'c'] } } } as any,
      { components: { MuiX: { variants: ['z'] } } } as any,
    )
    expect((merged.components as any).MuiX.variants).toEqual(['z'])
  })

  it('keeps every theme component when the host overrides none', () => {
    const merged = mergeThemeOptions(
      consoleOptions,
      hostThemeToThemeOptions({ spacing: 8 }, 'light'),
    )
    expect(Object.keys(merged.components ?? {}).length).toBe(
      Object.keys(consoleOptions.components ?? {}).length,
    )
  })

  it('carries the base through when the host customizes nothing', () => {
    const merged = mergeThemeOptions(
      consoleOptions,
      hostThemeToThemeOptions(undefined, 'light'),
    )
    const palette = merged.palette as Record<string, { main?: string }>
    expect(palette['primary']?.main).toBe('#404C5C')
    expect(merged.shape).toEqual(consoleOptions.shape)
  })
})

describe('hasHostTheme', () => {
  it('treats undefined and empty documents as absent', () => {
    expect(hasHostTheme(undefined)).toBe(false)
    expect(hasHostTheme({})).toBe(false)
    expect(hasHostTheme({ spacing: 8 })).toBe(true)
  })
})

describe('getGoogleFontsUrl', () => {
  it('returns undefined when nothing needs loading', () => {
    expect(getGoogleFontsUrl(undefined)).toBeUndefined()
    expect(getGoogleFontsUrl([])).toBeUndefined()
    expect(
      getGoogleFontsUrl([{ family: 'Menlo', source: 'system' }]),
    ).toBeUndefined()
  })

  it('builds a css2 url with sorted weights and swap display', () => {
    expect(
      getGoogleFontsUrl([
        { family: 'Open Sans', weights: [700, 400] },
        { family: 'Inter', source: 'google' },
      ]),
    ).toBe(
      'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&family=Inter&display=swap',
    )
  })
})
