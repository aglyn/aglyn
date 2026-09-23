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
 * THE SITE'S THEME FOR EITHER SCHEME (AGL-3284).
 *
 * An "Always dark" element on a light page renders under the theme this
 * context hands back. It must be the site's OWN dark theme — the same
 * construction the provider would use if the visitor had asked for dark — or a
 * pinned band wears MUI's stock palette instead of the site's.
 */

import { createTheme, type Theme, useTheme } from '@mui/material/styles'
import { render } from '@testing-library/react'
import { consoleThemeDark, consoleThemeLight } from '../console.theme'
import { HostThemeProvider } from './host-theme-provider'
import {
  createSiteSchemeThemes,
  type SiteSchemeThemes,
  useSiteSchemeThemes,
} from './site-scheme-themes'

describe('createSiteSchemeThemes', () => {
  it('builds nothing until a scheme is asked for, then each once', () => {
    const build = jest.fn((scheme: 'light' | 'dark') =>
      createTheme({ palette: { mode: scheme } }),
    )
    const themes = createSiteSchemeThemes(build)
    expect(build).not.toHaveBeenCalled()
    const dark = themes('dark')
    expect(themes('dark')).toBe(dark)
    expect(build).toHaveBeenCalledTimes(1)
    expect(themes('light').palette.mode).toBe('light')
    expect(build).toHaveBeenCalledTimes(2)
  })
})

describe('HostThemeProvider provides both schemes', () => {
  let captured: { active?: Theme; themes?: SiteSchemeThemes } = {}
  function Capture() {
    captured = { active: useTheme(), themes: useSiteSchemeThemes() }
    return null
  }

  const renderHost = (
    theme: Parameters<typeof HostThemeProvider>[0]['theme'],
    fallback: Parameters<typeof HostThemeProvider>[0]['fallback'] = [
      consoleThemeLight,
      consoleThemeDark,
    ],
  ) =>
    render(
      <HostThemeProvider theme={theme} fallback={fallback} initialMode="light">
        <Capture />
      </HostThemeProvider>,
    )

  beforeEach(() => {
    captured = {}
    document.cookie = 'theme-color-mode=light'
  })

  it('answers the active scheme with the very theme it renders', () => {
    renderHost({ colorSchemes: { light: { primary: { main: '#6f4e37' } } } })
    // MUI's provider hands `useTheme` a shallow copy (it adds `vars`), so the
    // identity to compare is the palette the copy carries over.
    expect(captured.themes?.('light')?.palette).toBe(captured.active?.palette)
  })

  it("answers the other scheme with the site's own dark colors", () => {
    renderHost({
      colorSchemes: {
        light: {},
        dark: {
          primary: { main: '#6f4e37' },
          background: { default: '#161c21' },
        },
      },
    })
    const dark = captured.themes?.('dark')
    expect(captured.active?.palette.mode).toBe('light')
    expect(dark?.palette.mode).toBe('dark')
    expect(dark?.palette.primary.main).toBe('#6f4e37')
    expect(dark?.palette.background.default).toBe('#161c21')
  })

  it('answers from the fallback pair when the host has no theme', () => {
    renderHost(undefined)
    expect(captured.themes?.('dark')).toBe(consoleThemeDark)
    expect(captured.themes?.('light')).toBe(consoleThemeLight)
  })

  it('still answers dark on a site that switched dark off for visitors', () => {
    // `darkScheme: 'off'` governs the visitor's choice; an author's "Always
    // dark" band is content, and still gets the site's dark theme.
    renderHost({
      darkScheme: 'off',
      colorSchemes: { light: {}, dark: { primary: { main: '#6f4e37' } } },
    })
    expect(captured.themes?.('dark')?.palette.mode).toBe('dark')
  })
})
