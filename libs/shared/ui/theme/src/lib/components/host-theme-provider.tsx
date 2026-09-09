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
'use client'

import type { HostTheme } from '@aglyn/shared-data-types'
import { _isArr } from '@aglyn/shared-util-tools'
import { CssBaseline } from '@mui/material'
import { createContext, useContext, useMemo } from 'react'
import type { Theme, ThemeOptions } from '../../vendor/mui'
import { ThemeProvider } from '../../vendor/mui'
import {
  type ThemeMode,
  ThemeContextDispatch,
  type UseThemeMode,
  useThemeModeState,
} from '../hocs/create-with-theme-provider'
import { createResponsiveTheme } from '../util/create-responsive-theme'
import {
  hasHostTheme,
  hostThemeToThemeOptions,
  mergeThemeOptions,
} from '../util/host-theme'

/**
 * Carries the persisted host theme document from wherever it is fetched
 * (e.g. Next page props) down to {@link HostThemeProvider}, which may live
 * above the page tree in _app.
 */
export const HostThemeDocumentContext = createContext<HostTheme | undefined>(
  undefined,
)

export function useHostThemeDocument() {
  return useContext(HostThemeDocumentContext)
}

export type HostThemeProviderProps = {
  /** Host theme document; falls back to {@link HostThemeDocumentContext} when omitted. */
  theme?: HostTheme
  /** Theme(s) rendered when the host has no customization. A single theme is used for both schemes. */
  fallback: Theme | [lightTheme: Theme, darkTheme: Theme]
  /**
   * Options the host's overrides are layered onto (AGL-1180). Supply the
   * same brand theme `fallback` was built from: without it a host that sets
   * one value loses the brand for every value it did NOT set, because the
   * converter emits only what was explicitly customized and MUI fills the
   * rest from its own stock palette.
   */
  baseOptions?: ThemeOptions | [light: ThemeOptions, dark: ThemeOptions]
  /** Extra options merged into both generated schemes (e.g. portal container defaults). */
  themeOptions?: ThemeOptions
  /**
   * The visitor's stored light/dark choice, resolved from the request's
   * cookies by the server component above this one; `null` when they have
   * chosen nothing. It is what the first render is built from, so a visitor
   * who asked for dark gets dark in the first byte rather than a light page
   * that repaints once React has hydrated. Omitted, the mode is read from
   * `document.cookie`, which no server render can see.
   */
  initialMode?: ThemeMode
  disableCssBaseline?: boolean
  children?: JSX.Children
}

/**
 * Site-facing theme provider: renders children under the host's persisted
 * MUI theme, resolving light/dark via the shared cookie +
 * prefers-color-scheme mode state (same machinery as
 * `createWithThemeProvider`, so `useThemeMode` toggles keep working).
 *
 * An explicit choice is decided before paint, from `initialMode`. Device
 * default is not: `prefers-color-scheme` is answerable only in a browser, so a
 * visitor who follows their device gets the light scheme in the server's HTML
 * and the dark one once the page has hydrated. A site resolves its dark scheme
 * in JS — a single-mode theme swapped between schemes, and node styles whose
 * `@scheme dark` slices are merged against `palette.mode` — so there is no CSS
 * form of that decision for a media query to make instead.
 */
export function HostThemeProvider(props: HostThemeProviderProps) {
  const {
    theme,
    fallback,
    baseOptions,
    themeOptions,
    initialMode,
    disableCssBaseline,
    children,
  } = props
  const contextTheme = useHostThemeDocument()
  const hostTheme = theme ?? contextTheme
  const themeModeState = useThemeModeState(initialMode)
  const [[, themeMode], toggleThemeMode, cookieMode] = themeModeState
  const requested = themeMode === 'dark' ? 'dark' : 'light'

  /**
   * Dark follows the visitor unless the site switched it off.
   *
   * A site needs no dark design of its own to go dark: the platform's default
   * dark palette (`consoleOptionsDark`, handed in as `baseOptions`) renders
   * under whatever dark colors the site authored, by the same layering that
   * gives it the brand palette in light (AGL-1180), and a host with no theme
   * at all gets the dark fallback. Content that carries light-only hex
   * backgrounds still reads badly under dark text tokens — that is a content
   * choice, and the site owner makes it with `darkScheme: 'off'` in the theme
   * editor, which keeps every visitor on light. The theme mode switcher reads
   * the same answer and hides on such a site (AGL-2676).
   */
  const canGoDark = hostTheme?.darkScheme !== 'off'
  const scheme = requested === 'dark' && !canGoDark ? 'light' : requested

  // The mode state plus whether this site can honor a dark request, so a
  // visitor-facing control (the theme mode switcher) can tell a site that
  // will never go dark from one that merely is not dark right now.
  const modeContext = useMemo<UseThemeMode>(
    () => [themeModeState[0], toggleThemeMode, cookieMode, canGoDark],
    [themeModeState, toggleThemeMode, cookieMode, canGoDark],
  )

  const activeTheme = useMemo<Theme>(() => {
    if (!hasHostTheme(hostTheme)) {
      const [light, dark] = _isArr(fallback) ? fallback : [fallback, fallback]
      return scheme === 'dark' ? dark : light
    }
    // Layer the host's overrides onto the brand base rather than replacing
    // it (AGL-1180) — otherwise customizing one value repaints every other
    // slot in MUI's stock palette.
    const [lightBase, darkBase] = _isArr(baseOptions)
      ? baseOptions
      : [baseOptions, baseOptions]
    const base = (scheme === 'dark' ? darkBase : lightBase) ?? {}
    const converted = mergeThemeOptions(
      base,
      hostThemeToThemeOptions(hostTheme, scheme),
    )
    return createResponsiveTheme({
      themeOptions: {
        ...converted,
        ...themeOptions,
        palette: { ...converted.palette, ...themeOptions?.palette },
        components: { ...converted.components, ...themeOptions?.components },
      },
    })
  }, [hostTheme, fallback, baseOptions, themeOptions, scheme])

  return (
    <ThemeContextDispatch.Provider value={modeContext}>
      <ThemeProvider theme={activeTheme}>
        {disableCssBaseline ? (
          children
        ) : (
          <CssBaseline enableColorScheme>{children}</CssBaseline>
        )}
      </ThemeProvider>
    </ThemeContextDispatch.Provider>
  )
}
HostThemeProvider.displayName = 'HostThemeProvider'

export default HostThemeProvider
