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
 * The mobile theme (AGL-3620): the console's palette, light and dark, from
 * the generated tokens, plus the type scale and spacing the components use.
 *
 * The scheme follows the device unless the person picked one in Settings;
 * the pick is remembered on the device.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useColorScheme, type TextStyle } from 'react-native'
import { MOBILE_THEME_TOKENS, type MobileColorScheme, type MobilePalette } from './tokens'

export type SchemePreference = 'system' | MobileColorScheme

export interface MobileTheme {
  scheme: MobileColorScheme
  colors: MobilePalette
  radius: number
  /** `space(2)` is 16: the console's 8-point grid. */
  space: (units: number) => number
  type: Record<'title' | 'heading' | 'body' | 'label' | 'caption', TextStyle>
}

const TYPE: MobileTheme['type'] = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
}

export function createMobileTheme(scheme: MobileColorScheme): MobileTheme {
  const unit = MOBILE_THEME_TOKENS.spacing
  return {
    scheme,
    colors: MOBILE_THEME_TOKENS[scheme] as MobilePalette,
    radius: MOBILE_THEME_TOKENS.radius * 2,
    space: (units) => units * unit,
    type: TYPE,
  }
}

const PREFERENCE_KEY = 'aglyn.scheme-preference'

interface ThemeContextValue {
  theme: MobileTheme
  preference: SchemePreference
  setPreference(next: SchemePreference): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function MobileThemeProvider({ children }: { children: ReactNode }) {
  const device = useColorScheme()
  const [preference, setPreferenceState] = useState<SchemePreference>('system')

  useEffect(() => {
    AsyncStorage.getItem(PREFERENCE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') setPreferenceState(stored)
      })
      .catch(() => undefined)
  }, [])

  const setPreference = useCallback((next: SchemePreference) => {
    setPreferenceState(next)
    AsyncStorage.setItem(PREFERENCE_KEY, next).catch(() => undefined)
  }, [])

  const scheme: MobileColorScheme =
    preference === 'system' ? (device === 'dark' ? 'dark' : 'light') : preference
  const value = useMemo(
    () => ({ theme: createMobileTheme(scheme), preference, setPreference }),
    [scheme, preference, setPreference],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useMobileTheme(): MobileTheme {
  const value = useContext(ThemeContext)
  // Outside a provider (a plugin spec, say) the light theme is a fine default.
  return value?.theme ?? createMobileTheme('light')
}

export function useSchemePreference(): Pick<ThemeContextValue, 'preference' | 'setPreference'> {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useSchemePreference needs <MobileThemeProvider> around it')
  return { preference: value.preference, setPreference: value.setPreference }
}
