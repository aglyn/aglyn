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
  makeStyles,
  Palette,
  PaletteColor,
  PaletteColorOptions,
  PaletteOptions,
  recomposeColor,
  responsiveFontSizes,
  rgbToHex,
  SimplePaletteColorOptions,
  StyledComponentProps,
  StyledEngineProvider,
  styled,
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
} from '@material-ui/core/styles'
// import { Components } from '@material-ui/core/styles/components'
// import { Mixins, MixinsOptions } from '@material-ui/core/styles/createMixins'
// import { Typography, TypographyOptions } from '@material-ui/core/styles/createTypography'
// import { ResponsiveFontSizesOptions } from '@material-ui/core/styles/responsiveFontSizes'
// import { Shadows } from '@material-ui/core/styles/shadows'
// import { ZIndex, ZIndexOptions } from '@material-ui/core/styles/zIndex'
import {
  BaseCreateCSSProperties,
  BaseCSSProperties,
  createStyles,
  CSSProperties,
  getThemeProps,
  jssPreset,
  ServerStyleSheets,
  StyledComponent,
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
  // withTheme,
  withThemeCreator,
  WithThemeCreatorOption,
} from '@material-ui/styles'
import { ClassKeyInferable } from '@material-ui/styles/withStyles'
import { ShapeOptions, Spacing, SpacingOptions } from '@material-ui/system'


export * as JSS from 'jss'
export { default as jssRtl } from 'jss-rtl'

declare module '@material-ui/core/styles' {
  /**
   * START EXAMPLE – MODULE AUGMENTATION ↓
   * ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
   * ```typescript
   * // Add new property ↓
   * declare module '@material-ui/core/styles' {
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
   * declare module "@material-ui/core/styles" {
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
    svgBg?: {
      base: string;
      active: string;
    };
    svgFilled?: {
      base: string;
      active: string;
    };
    svgStroke?: {
      base: string;
      active: string;
    }
  }

  interface PaletteOptions {
    tertiary: PaletteOptions['primary']
    quaternary: PaletteOptions['primary']
    svgBg?: {
      base: string;
      active: string;
    };
    svgFilled?: {
      base: string;
      active: string;
    };
    svgStroke?: {
      base: string;
      active: string;
    }
  }

  type ExtendPropsOfWithStyles<P extends { classes?: ClassNameMap<string> },
    StylesType extends ClassKeyInferable<any, any>,
    IncludeTheme extends boolean | undefined = false,
    > = P & WithStyles<StylesType, IncludeTheme>
}

declare module '@material-ui/styles' {
  interface DefaultTheme extends Theme {}
}

export {
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
  ServerStyleSheets,
  // Shadows,
  SimplePaletteColorOptions,
  ShapeOptions,
  Spacing,
  SpacingOptions,
  StyleRules,
  StyleRulesCallback,
  StyledComponent,
  StyledComponentProps,
  StyledEngineProvider,
  StyledProps,
  Styles,
  StylesContext,
  StylesOptions,
  StylesProvider,
  StylesProviderProps,
  Theme,
  ThemeOfStyles,
  ThemeOptions,
  ThemeProvider,
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
