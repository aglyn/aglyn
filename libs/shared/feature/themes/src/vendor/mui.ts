/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import type { Theme } from '@mui/material/styles'

import type { Shadows } from '@mui/material/styles/shadows'
import type { WithStyles } from '@mui/styles'

import type { ClassKeyInferable } from '@mui/styles/withStyles'

import type { Shape } from '@mui/system/createTheme/shape'
import type { ColorPropOverrides, IActionStates } from '../lib/theme.types'


//    _____     _______ ____  ____  ___ ____  _____ ____
//   / _ \ \   / / ____|  _ \|  _ \|_ _|  _ \| ____/ ___|
//  | | | \ \ / /|  _| | |_) | |_) || || | | |  _| \___ \
//  | |_| |\ V / | |___|  _ <|  _ < | || |_| | |___ ___) |
//   \___/  \_/  |_____|_| \_\_| \_\___|____/|_____|____/


declare module '@mui/material/Button' {
  interface ButtonPropsColorOverrides extends ColorPropOverrides {}
}
declare module '@mui/material/ButtonGroup' {
  interface ButtonGroupPropsColorOverrides extends ColorPropOverrides {}
}
declare module '@mui/material/ToggleButtonGroup' {
  interface ToggleButtonGroupPropsColorOverrides extends ColorPropOverrides {}
}
declare module '@mui/material/Fab' {
  interface FabPropsColorOverrides extends ColorPropOverrides {}
}
declare module '@mui/material/SvgIcon' {
  interface SvgIconPropsColorOverrides extends ColorPropOverrides {}
}
declare module '@mui/material/AppBar' {
  interface AppBarPropsColorOverrides extends ColorPropOverrides {}
}

declare module '@mui/material/styles/createPalette' {
  interface TypeBackground {
    secondary: string
  }
  interface Palette {
    tertiary: Palette['primary']
    quaternary: Palette['primary']
  }
  interface PaletteOptions {
    tertiary?: PaletteOptions['primary']
    quaternary?: PaletteOptions['primary']
  }
}
declare module '@mui/material/styles' {
  /**
   * START EXAMPLE – MODULE AUGMENTATION ↓
   * ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
   * ```typescript
   * // Add new property ↓
   * declare module '@mui/material/styles' {
   *   interface Theme {
   *     status: {
   *       danger: React.CSSProperties['color'],
   *     }
   *   }
   *   interface ThemeOptions {
   *     status: {
   *       danger: React.CSSProperties['color']
   *     }
   *   }
   * }
   * const theme = createMuiTheme({
   *   status: {
   *     danger: '#e53e3e',
   *   },
   * })
   *
   * // Add to existing property (e.g., palette, typography) ↓
   * declare module "@mui/material/styles" {
   *   interface Palette {
   *     neutral: Palette['primary']
   *   }
   *   interface PaletteOptions {
   *     neutral: PaletteOptions['primary']
   *   }
   * }
   * const theme = createMuiTheme({
   *   palette: {
   *     neutral: {
   *       main: '#5c6ac4',
   *     },
   *   },
   * })
   * ```
   * ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   * END EXAMPLE – MODULE AUGMENTATION ↑
   */


  interface Theme {
    insetShadows: Shadows
    shape: Shape & { appIconBorderRadius: number | string }
  }

  interface Palette {
    background: Palette['background']
    tertiary: Palette['primary']
    quaternary: Palette['primary']
    svgBackground: IActionStates
    svgFilled: IActionStates
    svgStroke: IActionStates
    text: Palette['text']
  }

  interface PaletteOptions {
    background?: PaletteOptions['background']
    tertiary?: PaletteOptions['primary']
    quaternary?: PaletteOptions['primary']
    svgBackground?: IActionStates
    svgFilled?: IActionStates
    svgStroke?: IActionStates
    text?: PaletteOptions['text']
  }

  type ExtendPropsOfWithStyles<P extends { classes?: ClassNameMap<string> },
    StylesType extends ClassKeyInferable<any, any>,
    IncludeTheme extends boolean | undefined = false> = P & WithStyles<StylesType, IncludeTheme>
}

declare module '@mui/styles' {
  interface DefaultTheme extends Theme {}
}


//   _______  ______   ___  ____ _____ ____
//  | ____\ \/ /  _ \ / _ \|  _ \_   _/ ___|
//  |  _|  \  /| |_) | | | | |_) || | \___ \
//  | |___ /  \|  __/| |_| |  _ < | |  ___) |
//  |_____/_/\_\_|    \___/|_| \_\|_| |____/


export type {
  Overwrite,
} from '@mui/types'

export type {
  ShapeOptions,
  Spacing,
  SpacingOptions,
  MuiStyledOptions as StyledOptions,
  MuiStyledOptions,
  SxProps,
} from '@mui/system'

export { visuallyHidden } from '@mui/utils'

export type {
  Breakpoint,
  BreakpointOverrides,
  Breakpoints,
  BreakpointsOptions,
  ClassNameMap,
  ColorFormat,
  ColorObject,
  ComponentsOverrides,
  ComponentsProps,
  ComponentsPropsList,
  ComponentsVariants,
  CreateMUIStyled,
  CSSObject,
  Direction,
  Duration,
  Easing,
  ExtendPropsOfWithStyles,
  Palette,
  PaletteColor,
  PaletteColorOptions,
  PaletteOptions,
  SimplePaletteColorOptions,
  StyledComponentProps,
  Theme,
  ThemedProps,
  ThemeOptions,
  ThemeWithProps,
  Transitions,
  TransitionsOptions,
  TypographyStyle,
  TypographyVariant,
  TypographyVariants,
  TypographyVariantsOptions,
} from '@mui/material/styles'


export type {
  ColorPartial,
  CommonColors,
  TypeBackground,
  TypeText,
} from '@mui/material/styles/createPalette'

export type {
  Shadows,
} from '@mui/material/styles/shadows'

export type {
  ClassKeyInferable,
} from '@mui/styles/withStyles'

export type { Shape } from '@mui/system/createTheme/shape'

export {
  alpha,
  createTheme,
  darken,
  decomposeColor,
  easing,
  emphasize,
  experimentalStyled,
  getContrastRatio,
  getLuminance,
  hexToRgb,
  hslToRgb,
  lighten,
  recomposeColor,
  responsiveFontSizes,
  rgbToHex,
  styled,
  StyledEngineProvider,
  ThemeProvider,
  useTheme,
  useThemeProps,
} from '@mui/material/styles'

export type {
  BaseCreateCSSProperties,
  BaseCSSProperties,
  CSSProperties,
  ServerStyleSheets,
  StyledProps,
  StyleRules,
  StyleRulesCallback,
  Styles,
  StylesOptions,
  StylesProviderProps,
  ThemedComponentProps,
  ThemeOfStyles,
  ThemeProviderProps,
  WithStyles,
  WithStylesOptions,
  WithTheme,
  WithThemeCreatorOption,
} from '@mui/styles'

export {
  createStyles,
  getThemeProps,
  jssPreset,
  makeStyles,
  StylesContext,
  StylesProvider,
  useThemeVariants,
  withStyles,
  withThemeCreator,
} from '@mui/styles'
