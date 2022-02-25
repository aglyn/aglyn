/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {_isEqualitySameType} from '@aglyn/shared-util-guards'
import useMediaQuery from '@mui/material/useMediaQuery'
import Cookie from 'js-cookie'
import {useCallback, useMemo, useState} from 'react'


export type ThemeMode = 'light' | 'dark' | 'system'
export type UseThemeMode = [
  mode: ThemeMode,
  toggleThemeMode: (mode?: ThemeMode) => void
]

export const COOKIE_THEME_KEY = 'theme-color-scheme'

export function useHandleThemeModes(defaultMode?: ThemeMode): UseThemeMode {
  const prefDark = useMediaQuery('(prefers-color-scheme: dark)')
  const cookieMode = Cookie.get(COOKIE_THEME_KEY)
  const [localMode, setLocalMode] = useState<ThemeMode | null>(null)

  const mode = useMemo(() => {
    const value = localMode
      || cookieMode
      || prefDark
      || defaultMode
    if (value === 'system') return prefDark ? 'dark' : 'light'
    if (value === 'dark') return 'dark'
    if (value === 'light') return 'light'
    return 'system'
  }, [cookieMode, defaultMode, localMode, prefDark])

  const toggleThemeMode = useCallback((to?: ThemeMode) => {
    const override = _isEqualitySameType(to, 'light', 'dark', 'system') ? to : null
    const value = override || (
      mode === 'light' ? 'system'
        : mode === 'system' ? 'dark'
          : mode === 'dark' ? 'light'
            : 'system'
    )
    Cookie.set(COOKIE_THEME_KEY, value, {expires: 365})
    setLocalMode(value)
  }, [mode])

  return useMemo(() => [mode, toggleThemeMode], [mode, toggleThemeMode])
}

export default useHandleThemeModes
