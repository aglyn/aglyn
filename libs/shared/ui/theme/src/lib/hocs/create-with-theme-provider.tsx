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

export type ThemeMode = 'light' | 'dark' | 'system' | null
export type ThemeModeType = 'user' | 'system'
export type ThemeModeResult = [ThemeModeType, ThemeMode]
export type UseThemeMode = [
  mode: ThemeModeResult,
  toggleThemeMode: (event: SyntheticEvent<any>, to?: ThemeMode) => void,
  cookieMode: ThemeMode,
]

export const THEME_DISPLAY_NAME: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Device default',
}

export const getThemeModeDisplayName = (theme: ThemeMode) => {
  return THEME_DISPLAY_NAME[theme] || THEME_DISPLAY_NAME.system
}

export const COOKIE_THEME_KEY = 'theme-color-mode'
export const ThemeContextDispatch = createContext<UseThemeMode>([
  ['system', 'system'],
  noop,
  'system',
])

export function useThemeMode() {
  return useContext(ThemeContextDispatch)
}

function getCookieThemeMode(): ThemeMode {
  const cookieMode = Cookies.get(COOKIE_THEME_KEY)
  if (cookieMode === 'dark' || cookieMode === 'light') {
    return cookieMode
  }
  return null
}

export function useCookieThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => getCookieThemeMode())

  /**
   * Update value on each paint if changed
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

export function useThemeModeState(): UseThemeMode {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const [cookieMode, setCookieMode] = useCookieThemeMode()

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
