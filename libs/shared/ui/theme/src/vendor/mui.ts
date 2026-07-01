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

import type { Theme as MuiTheme } from '@mui/material/styles'
import type { Color as MuiColor, CSSProperties, Shadows } from '@mui/material/styles'
// import type { ExtraColorOptions } from '@mui/material/styles/createPalette'
// import type { WithStyles } from '@mui/styles'
// import type { ClassKeyInferable } from '@mui/styles/withStyles'
import type { ColorPropOverrides, IActionStates } from '../lib/theme.types'
// import type {ContainerTypeMap} from '@mui/material/Container'

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
declare module '@mui/material/Container' {
  interface ContainerOwnProps {
    variant?: 'vertical' | 'horizontal' | 'boxed'
  }
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
  interface AppBarPropsColorOverrides extends ColorPropOverrides {
    surface: true
  }
}
declare module '@mui/material/IconButton' {
  interface AppBarPropsColorOverrides extends ColorPropOverrides {}
}
declare module '@mui/material/Tabs' {
  interface TabsPropsIndicatorColorOverrides extends ColorPropOverrides {}
}
declare module '@mui/system' {
  interface Shape {
    appIconBorderRadius: number | string
  }
}
declare module '@mui/material/styles' {
  type ExtraColor = Palette['primary']
  type ExtraColorOptions = PaletteOptions['primary']

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

  interface PaletteOptions {
    background?: PaletteOptions['background']
    tertiary?: ExtraColorOptions
    surface?: ExtraColorOptions
    svgBackground?: IActionStates
    svgFilled?: IActionStates
    svgStroke?: IActionStates
    text?: PaletteOptions['text']
  }

  interface TypeBackground {}

  interface Palette {
    background: Palette['background']
    tertiary: ExtraColor
    surface: ExtraColor
    svgBackground: IActionStates
    svgFilled: IActionStates
    svgStroke: IActionStates
    text: Palette['text']
  }

  interface ZIndex {
    max: number
    min: number
  }

  interface Mixins {
    menuArrow: CSSProperties
  }

  interface ThemeOptions {
    shadowsInset?: Shadows
  }

  interface Theme {
    palette: Palette
    shadowsInset: Shadows
  }

  interface Theme {
    vars: Omit<
      Theme,
      'typography' | 'mixins' | 'breakpoints' | 'direction' | 'transitions'
    >
  }

  interface DefaultTheme extends Theme {}

  // type ExtendPropsOfWithStyles<
  //   P extends { classes?: ClassNameMap<string> },
  //   StylesType extends ClassKeyInferable<any, any>,
  //   IncludeTheme extends boolean | undefined = false
  // > = P & WithStyles<StylesType, IncludeTheme>
}

declare module '@mui/styles' {
  interface DefaultTheme extends MuiTheme {}
}

//   _______  ______   ___  ____ _____ ____
//  | ____\ \/ /  _ \ / _ \|  _ \_   _/ ___|
//  |  _|  \  /| |_) | | | | |_) || | \___ \
//  | |___ /  \|  __/| |_| |  _ < | |  ___) |
//  |_____/_/\_\_|    \___/|_| \_\|_| |____/

export type { Overwrite } from '@mui/types'

export {
  type ShapeOptions,
  type Spacing,
  type SpacingOptions,
  type MuiStyledOptions,
  type SxProps,
  type BoxProps,
} from '@mui/system'

export { darkScrollbar } from '@mui/material'
export { visuallyHidden } from '@mui/utils'

export {
  type Breakpoint,
  type BreakpointOverrides,
  type Breakpoints,
  type BreakpointsOptions,
  type ClassNameMap,
  type ColorFormat,
  type ColorObject,
  type ComponentsOverrides,
  type ComponentsProps,
  type ComponentsPropsList,
  type ComponentsVariants,
  type CreateMUIStyled,
  type CSSObject,
  type Direction,
  type Duration,
  type Easing,
  // type ExtendPropsOfWithStyles,
  type Palette,
  type PaletteColor,
  type PaletteColorOptions,
  type PaletteOptions,
  type SimplePaletteColorOptions,
  type StyledComponentProps,
  type Theme,
  type ThemedProps,
  type ThemeOptions,
  type ThemeWithProps,
  type Transitions,
  type TransitionsOptions,
  type TypographyStyle,
  type TypographyVariant,
  type TypographyVariants,
  type TypographyVariantsOptions,
  alpha,
  createTheme,
  darken,
  decomposeColor,
  easing,
  emphasize,
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
  experimental_sx as sx,
  getInitColorSchemeScript,
} from '@mui/material/styles'

export type ColorPartial = Partial<MuiColor>
export {
  type CommonColors,
  type TypeBackground,
  type TypeText,
  type Shadows,
} from '@mui/material/styles'

// export { type ClassKeyInferable, type CreateCSSProperties } from '@mui/styles/withStyles'

export { type Shape } from '@mui/system'

export {
  type BaseCreateCSSProperties,
  type BaseCSSProperties,
  type CSSProperties,
  type ServerStyleSheets,
  type StyledProps,
  type StyleRules,
  type StyleRulesCallback,
  type Styles,
  type StylesOptions,
  type StylesProviderProps,
  type ThemedComponentProps,
  type ThemeOfStyles,
  type ThemeProviderProps,
  type WithStyles,
  type WithStylesOptions,
  type WithTheme,
  type WithThemeCreatorOption,
  getThemeProps,
  jssPreset,
  StylesContext,
  StylesProvider,
  useThemeVariants,
  withThemeCreator,
  makeStyles,
  withStyles,
  createStyles,
} from '@mui/styles'
