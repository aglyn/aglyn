/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { _isArr, _isNull } from '@aglyn/shared-util-tools'
import { getDisplayName, noop } from '@aglyn/shared-util-tools'
import { hoistNonReactStatics } from '@aglyn/shared-util-vendor'
import { CssBaseline, useMediaQuery } from '@mui/material'
import Cookies from 'js-cookie'
import {
  type ComponentType,
  createContext,
  forwardRef,
  type SyntheticEvent,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { useIsomorphicLayoutEffect } from 'react-use'
import { createTheme, type Theme, ThemeProvider } from '../../vendor/mui'
import {
  parseThemeModeCookie,
  THEME_MODE_COOKIE,
} from '../util/theme-mode-cookie'

export type ThemeMode = 'light' | 'dark' | 'system' | null
export type ThemeModeType = 'user' | 'system'
export type ThemeModeResult = [ThemeModeType, ThemeMode]
export type UseThemeMode = [
  mode: ThemeModeResult,
  toggleThemeMode: (event: SyntheticEvent<any>, to?: ThemeMode) => void,
  cookieMode: ThemeMode,
  /**
   * False when the surface renders light whatever the visitor asks for — a
   * site whose theme has no authored dark scheme (AGL-1292). Absent means
   * the surface can go dark; the console's own provider never sets it.
   */
  canGoDark?: boolean,
]

export const THEME_DISPLAY_NAME: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Device default',
}

export const getThemeModeDisplayName = (theme: ThemeMode) => {
  return THEME_DISPLAY_NAME[theme] || THEME_DISPLAY_NAME.system
}

/**
 * The cookie the visitor's choice is persisted in, spelled out as a type so
 * the name has one definition across the browser reader here and the
 * server-side one in `util/theme-mode-cookie`: the annotation fails to compile
 * if the two ever name different cookies.
 */
export const COOKIE_THEME_KEY: 'theme-color-mode' = THEME_MODE_COOKIE
export const ThemeContextDispatch = createContext<UseThemeMode>([
  ['system', 'system'],
  noop,
  'system',
])

export function useThemeMode() {
  return useContext(ThemeContextDispatch)
}

/**
 * The stored choice as this browser reads it.
 *
 * `js-cookie` reads `document.cookie`, so on a server render there is nothing
 * to read and every visitor looks like one who has chosen nothing. That is why
 * a server-rendered surface passes the mode it resolved from the request's
 * cookies into {@link useCookieThemeMode} instead of relying on this.
 */
function getCookieThemeMode(): ThemeMode {
  return parseThemeModeCookie(Cookies.get(COOKIE_THEME_KEY))
}

/**
 * The visitor's stored light/dark choice, and a setter that persists it.
 *
 * `initialMode` is the mode the surface's server render resolved from the
 * request's cookies — `null` when the request carried no choice. Supplying it
 * is what makes the FIRST render right: the state starts at the visitor's
 * choice on the server and at the identical value through hydration, rather
 * than starting empty and being corrected by the effect below once React has
 * hydrated the whole page. Omit it on a surface that only ever renders in a
 * browser, and the cookie is read directly.
 */
export function useCookieThemeMode(
  initialMode?: ThemeMode,
): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() =>
    initialMode === undefined ? getCookieThemeMode() : initialMode,
  )

  /**
   * Keeps the state in step with the cookie on each paint — another tab's
   * switcher, or a seed that went stale between the server render and
   * hydration. Browser-only: effects do not run during a server render, so
   * this never overwrites the seed with the server's empty read.
   */
  useIsomorphicLayoutEffect(() => {
    const cookieMode = getCookieThemeMode()
    setMode((prev) => (prev !== cookieMode ? cookieMode : prev))
  })

  const setCookieThemeMode = useCallback((newMode: ThemeMode) => {
    Cookies.set(COOKIE_THEME_KEY, newMode, { expires: 365 })
    setMode((prev) => (prev !== newMode ? newMode : prev))
  }, [])

  return useMemo(() => [mode, setCookieThemeMode], [mode, setCookieThemeMode])
}

/**
 * The resolved theme mode, in two layers with the visitor's own choice on top.
 *
 * An EXPLICIT choice comes from the cookie, which a server render can read
 * from the request — pass it as `initialMode` and the surface paints that
 * scheme in its first byte. It outranks the device: a visitor who asked for
 * light gets light on a dark laptop, and the ordering below is the only thing
 * that decides it, so the two layers are kept as separate inputs rather than
 * collapsed into one seed by the caller.
 *
 * DEVICE DEFAULT is the other layer. `prefers-color-scheme` is a media
 * feature, so a server has nothing to evaluate it against and `useMediaQuery`
 * answers light for every server render. `initialDeviceMode` supplies that
 * answer from the request instead — the `Sec-CH-Prefers-Color-Scheme` client
 * hint, where the browser sends one.
 *
 * It is fed in as `defaultMatches` rather than substituted for the media query
 * because that is the value React reads for BOTH the server render and the
 * hydration render: `useMediaQuery` publishes `defaultMatches` as its server
 * snapshot and only switches to the live `matchMedia` result once hydration is
 * complete. Seeding any earlier layer instead leaves the media query answering
 * light for the hydration commit, and the tree repaints light before the real
 * snapshot arrives — the flash this exists to remove, moved one frame later.
 */
export function useThemeModeState(
  initialMode?: ThemeMode,
  initialDeviceMode?: ThemeMode,
): UseThemeMode {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', {
    defaultMatches: initialDeviceMode === 'dark',
  })
  const [cookieMode, setCookieMode] = useCookieThemeMode(initialMode)

  const systemMode = useMemo<ThemeMode>(() => {
    return prefersDark ? 'dark' : 'light'
  }, [prefersDark])

  const [type, mode] = useMemo<ThemeModeResult>(() => {
    if (cookieMode && cookieMode !== 'system') {
      return ['user', cookieMode]
    }
    return ['system', systemMode]
  }, [cookieMode, systemMode])

  const toggleThemeMode = useCallback(
    (event: SyntheticEvent<any>, to?: ThemeMode) => {
      let newMode: ThemeMode

      switch (true) {
        case _isNull(to):
        case to === 'system':
          newMode = 'system'
          break
        case to === 'dark':
        case to === 'light':
          newMode = to
          break
        case _isNull(cookieMode):
          newMode = 'light'
          break
        case cookieMode === 'light':
          newMode = 'dark'
          break
        case cookieMode === 'dark':
        default:
          newMode = 'system'
          break
      }

      setCookieMode(newMode)
    },
    [cookieMode, setCookieMode],
  )

  return useMemo(
    () => [[type, mode], toggleThemeMode, cookieMode],
    [type, mode, toggleThemeMode, cookieMode],
  )
}

export type WithThemeProviderOptions = {
  theme: Theme | [lightTheme: Theme, darkTheme: Theme]
  disableCssBaseline?: boolean
}

export function createWithThemeProvider(options: WithThemeProviderOptions) {
  const { theme, disableCssBaseline } = options
  const [lightTheme, darkTheme] = !_isArr(theme)
    ? [
        theme,
        createTheme({ ...theme, palette: { ...theme?.palette, mode: 'dark' } }),
      ]
    : theme

  return function withThemeProvider<P>(WrappedComponent: JSX.ComponentType<P>) {
    const WithThemeProvider = forwardRef<any, P>((props, ref) => {
      const { ...rest } = props
      const ThemeModeState = useThemeModeState()
      const activeTheme = useMemo<Theme>(() => {
        const [[, themeMode]] = ThemeModeState
        return themeMode === 'dark' ? darkTheme : lightTheme
      }, [ThemeModeState])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const WrappedAny = WrappedComponent as ComponentType<any>
      return (
        <ThemeContextDispatch.Provider value={ThemeModeState}>
          <ThemeProvider theme={activeTheme}>
            {disableCssBaseline ? (
              <WrappedAny ref={ref} {...rest} />
            ) : (
              <CssBaseline enableColorScheme>
                <WrappedAny ref={ref} {...rest} />
              </CssBaseline>
            )}
          </ThemeProvider>
        </ThemeContextDispatch.Provider>
      )
    })
    const displayName = getDisplayName(WrappedComponent)
    WithThemeProvider.displayName = `WithThemeProvider(${displayName})`
    hoistNonReactStatics(WithThemeProvider, WrappedComponent)

    return WithThemeProvider
  }
}
export default createWithThemeProvider
