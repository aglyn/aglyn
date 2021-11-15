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

import {
  alpha,
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
  createTheme,
  CSSObject,
  darken,
  decomposeColor,
  Direction,
  Duration,
  Easing,
  easing,
  emphasize,
  experimentalStyled,
  ExtendPropsOfWithStyles,
  getContrastRatio,
  getLuminance,
  hexToRgb,
  hslToRgb,
  lighten,
  Palette,
  PaletteColor,
  PaletteColorOptions,
  PaletteOptions,
  recomposeColor,
  responsiveFontSizes,
  rgbToHex,
  SimplePaletteColorOptions,
  styled,
  StyledComponentProps,
  StyledEngineProvider,
  Theme,
  ThemedProps,
  ThemeOptions,
  ThemeProvider,
  ThemeWithProps,
  Transitions,
  TransitionsOptions,
  TypographyStyle,
  TypographyVariant,
  TypographyVariants,
  TypographyVariantsOptions,
  useTheme,
  useThemeProps,
} from '@mui/material/styles'
// import { Components } from '@mui/material/styles/components'
// import { Mixins, MixinsOptions } from '@mui/material/styles/createMixins'
// import { Typography, TypographyOptions } from '@mui/material/styles/createTypography'
// import { ResponsiveFontSizesOptions } from '@mui/material/styles/responsiveFontSizes'
import { Shadows } from '@mui/material/styles/shadows'
import {
  BaseCreateCSSProperties,
  BaseCSSProperties,
  createStyles,
  CSSProperties,
  getThemeProps,
  jssPreset,
  makeStyles,
  ServerStyleSheets,
  StyledProps,
  StyleRules,
  StyleRulesCallback,
  Styles,
  StylesContext,
  StylesOptions,
  StylesProvider,
  StylesProviderProps,
  ThemedComponentProps,
  ThemeOfStyles,
  ThemeProviderProps,
  useThemeVariants,
  WithStyles,
  withStyles,
  WithStylesOptions,
  WithTheme,
  withThemeCreator,
  WithThemeCreatorOption,
} from '@mui/styles'
import type { ClassKeyInferable } from '@mui/styles/withStyles'
import type {
  FilteringStyledOptions,
  MuiStyledOptions,
  ShapeOptions,
  Spacing,
  SpacingOptions,
  StyledComponent,
  SxProps,
} from '@mui/system'
import { Shape } from '@mui/system/createTheme/shape'
import { visuallyHidden } from '@mui/utils'
import type { ElementType } from 'react'
import { TypeActionSvgState } from '../lib/theme.types'


type StyledOptions<P = any, FP extends keyof P = keyof P> = FilteringStyledOptions<P, FP> & MuiStyledOptions
type StyledElement = StyledComponent<Pick<any, string | number | symbol> & { theme?: Theme; as?: ElementType<any>; sx?: SxProps<Theme>; }, any, Theme>

export * as JSS from 'jss'
export { default as jssRtl } from 'jss-rtl'

interface ColorPropOverrides {
  quaternary: true
  tertiary: true
}

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

  interface Palette {
    tertiary: Palette['primary']
    quaternary: Palette['primary']
    svgBg?: TypeActionSvgState
    svgFilled?: TypeActionSvgState
    svgStroke?: TypeActionSvgState
    background: Palette['background']
    text: Palette['text']
  }

  interface PaletteOptions {
    tertiary?: PaletteOptions['primary']
    quaternary?: PaletteOptions['primary']
    svgBg?: TypeActionSvgState
    svgFilled?: TypeActionSvgState
    svgStroke?: TypeActionSvgState
    background?: PaletteOptions['background']
  }

  interface Theme {
    insetShadows: Shadows
    shape: Shape & {appIconBorderRadius: number | string}
  }

  type ExtendPropsOfWithStyles<P extends { classes?: ClassNameMap<string> },
    StylesType extends ClassKeyInferable<any, any>,
    IncludeTheme extends boolean | undefined = false> = P & WithStyles<StylesType, IncludeTheme>
}

declare module '@mui/styles' {
  interface DefaultTheme extends Theme {}
}

export type {
  StyledOptions, StyledElement,
  BaseCSSProperties,
  BaseCreateCSSProperties,
  Breakpoint,
  BreakpointOverrides,
  Breakpoints,
  BreakpointsOptions,
  CSSObject,
  CSSProperties,
  ClassNameMap,
  ColorFormat,
  ColorObject,
  // Components,
  ComponentsOverrides,
  ComponentsProps,
  ComponentsPropsList,
  ComponentsVariants,
  CreateMUIStyled,
  Direction,
  Duration,
  Easing,
  ExtendPropsOfWithStyles,
  // MixinsOptions,
  // Mixins,
  Palette,
  PaletteColor,
  PaletteColorOptions,
  PaletteOptions,
  // ResponsiveFontSizesOptions,
  Shadows,
  SimplePaletteColorOptions,
  ShapeOptions,
  Spacing,
  SpacingOptions,
  StyleRules,
  StyleRulesCallback,
  StyledComponent,
  StyledComponentProps,
  StyledProps,
  Styles,
  StylesOptions,
  StylesProviderProps,
  Theme,
  ThemeOfStyles,
  ThemeOptions,
  ThemeProviderProps,
  ThemeWithProps,
  ThemedComponentProps,
  ThemedProps,
  Transitions,
  TransitionsOptions,
  // Typography,
  // TypographyOptions,
  TypographyStyle,
  TypographyVariant,
  TypographyVariants,
  TypographyVariantsOptions,
  WithStyles,
  WithStylesOptions,
  WithTheme,
  WithThemeCreatorOption,
  // ZIndex,
  // ZIndexOptions,
}

export {
  ServerStyleSheets,
  StyledEngineProvider,
  StylesContext,
  StylesProvider,
  ThemeProvider,
  alpha,
  createStyles,
  createTheme,
  darken,
  decomposeColor,
  easing,
  emphasize,
  experimentalStyled,
  getContrastRatio,
  getLuminance,
  getThemeProps,
  hexToRgb,
  hslToRgb,
  jssPreset,
  lighten,
  makeStyles,
  recomposeColor,
  responsiveFontSizes,
  rgbToHex,
  styled,
  useTheme,
  useThemeProps,
  useThemeVariants,
  withStyles,
  // withTheme,
  withThemeCreator,
}

export {
  visuallyHidden,
}
