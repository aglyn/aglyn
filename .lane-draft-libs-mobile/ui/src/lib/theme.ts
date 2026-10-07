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

import palette from './console-palette.json'

/*==========================================
 * MOBILE THEME TOKENS (AGL-3618).
 *
 * Colors come only from `console-palette.json`, which a spec in
 * `libs/shared/ui/theme` holds equal to the console's MUI palette. Spacing,
 * radius and type are the console theme's scale restated for React Native:
 * MUI's 8px spacing unit, its 4px shape radius doubled for touch surfaces,
 * and the type sizes the console's body, subtitle and heading variants use.
 * Screens read named tokens; a raw number or hex in a screen means a token is
 * missing here.
 *=========================================*/

export type ColorMode = 'light' | 'dark'

export type MobilePalette = (typeof palette)['light']

export interface MobileTheme {
  mode: ColorMode
  palette: MobilePalette
  /** `spacing(2)` = 16, as MUI's `theme.spacing`. */
  spacing: (units: number) => number
  radius: { control: number; surface: number; pill: number }
  type: {
    caption: number
    body: number
    subtitle: number
    title: number
    headline: number
    display: number
  }
  weight: { regular: '400'; medium: '500'; bold: '700' }
  /** The smallest touch target either platform's guidelines allow. */
  touchTarget: number
}

const SPACING_UNIT = 8

export function createMobileTheme(mode: ColorMode): MobileTheme {
  return {
    mode,
    palette: mode === 'dark' ? palette.dark : palette.light,
    spacing: (units: number) => units * SPACING_UNIT,
    radius: { control: 8, surface: 12, pill: 999 },
    type: { caption: 12, body: 16, subtitle: 18, title: 20, headline: 24, display: 34 },
    weight: { regular: '400', medium: '500', bold: '700' },
    touchTarget: 48,
  }
}

export const lightTheme = createMobileTheme('light')
export const darkTheme = createMobileTheme('dark')
