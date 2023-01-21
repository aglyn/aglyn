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

import {
  CssVarsThemeOptions,
  experimental_extendTheme as muiExtendTheme,
} from '@mui/material/styles'
import {
  createTheme,
  darken,
  getContrastRatio,
  lighten,
  responsiveFontSizes,
  type Theme,
  type ThemeOptions,
} from '../../vendor/mui'

enum ContrastText {
  LIGHT = 'rgba(0, 0, 0, 0.87)',
  DARK = '#FFFFFF',
}

function getContrastTextColor(background, contrastThreshold) {
  return getContrastRatio(background, ContrastText.DARK) >= contrastThreshold ??
    3
    ? ContrastText.DARK
    : ContrastText.LIGHT
}
function addShade(paletteColor, shade, variant, tonalOffset) {
  const tonalOffsetLight = tonalOffset['light'] || (tonalOffset ?? 0.2)
  const tonalOffsetDark = tonalOffset['dark'] || (tonalOffset ?? 0.2) * 1.5

  if (!paletteColor[shade]) {
    // eslint-disable-next-line no-prototype-builtins
    if (paletteColor.hasOwnProperty(variant)) {
      paletteColor[shade] = paletteColor[variant]
    } else if (shade === 'light') {
      paletteColor.light = lighten(paletteColor.main, tonalOffsetLight)
    } else if (shade === 'dark') {
      paletteColor.dark = darken(paletteColor.main, tonalOffsetDark)
    } else if (shade === 'contrastText') {
      paletteColor.contrastText = getContrastTextColor(
        paletteColor.main,
        tonalOffsetDark,
      )
    }
  }
}
function addShadeVariants(paletteColor, tonalOffset?) {
  addShade(paletteColor, 'dark', undefined, tonalOffset)
  addShade(paletteColor, 'light', undefined, tonalOffset)
  addShade(paletteColor, 'contrastText', undefined, tonalOffset)
}

export type CreateResponsiveThemeOptions = {
  themeOptions?: ThemeOptions
  responsiveFontSizesOptions?: any
}

/**
 * START EXAMPLE – OVERRIDE DEFAULT PROPS ↓
 * ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
 * ```typescript
 * const theme = createMuiTheme({
 *   props: {
 *     // Name of the component ⚛️
 *     MuiButtonBase: {
 *       // The default props to change
 *       disableRipple: true, // No more ripple, on the whole application 💣!
 *     },
 *   },
 * })
 * ```
 * ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 * END EXAMPLE – OVERRIDE DEFAULT PROPS ↑
 *
 * START EXAMPLE – OVERRIDE DEFAULT STYLES ↓
 * ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
 * ```typescript
 * const theme = createMuiTheme({
 *   overrides: {
 *     // Style sheet name ⚛️
 *     MuiButton: {
 *       // Name of the rule
 *       text: {
 *         // Some CSS
 *         color: 'white',
 *       },
 *     },
 *     MuiCssBaseline: {
 *       '@global': {
 *         html: {
 *           WebkitFontSmoothing: 'auto',
 *         },
 *       },
 *     },
 *   },
 * })
 * ```
 * ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 * END EXAMPLE – OVERRIDE DEFAULT STYLES ↑
 *
 * @param {ThemeOptions} options
 * @returns {Theme}
 */
export function createResponsiveTheme(
  options: CreateResponsiveThemeOptions,
): Theme {
  const { themeOptions, responsiveFontSizesOptions } = options
  let theme = createTheme(themeOptions)
  addShadeVariants(theme.palette.tertiary, theme.palette.tonalOffset)
  addShadeVariants(theme.palette.surface, theme.palette.tonalOffset)

  theme = responsiveFontSizes(theme, {
    // Override to include `xs` and `xl` - default: ['sm', 'md', 'lg']
    breakpoints: ['xs', 'sm', 'md', 'lg', 'xl'],
    ...responsiveFontSizesOptions,
  })

  return theme
}

export function createResponsiveCssVarTheme(
  light: Theme,
  dark: Theme,
  options?: CssVarsThemeOptions,
) {
  const { palette: lightPalette, ...lightTheme } = light
  const { palette: darkPalette } = dark

  return muiExtendTheme({
    ...lightTheme,
    ...options,
    colorSchemes: {
      ...options?.colorSchemes,
      light: { palette: lightPalette, ...options?.colorSchemes?.light },
      dark: { palette: darkPalette, ...options?.colorSchemes?.dark },
    },
  })
}

export default createResponsiveTheme
