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
import type {
  Color as MuiColor,
  CssVarsTheme,
  CSSProperties,
  Shadows,
} from '@mui/material/styles'
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
/**
 * `<Typography variant="lede">` and its two siblings (AGL-1308).
 *
 * The `TypographyVariants` augmentation further down puts the three variants
 * on the THEME; this is what lets a component ASK for one. Declaring the theme
 * side alone is the half-fix that compiles the theme and then rejects every
 * use of it — the same trap `TypographyVariantsOptions` without
 * `TypographyVariants` sets, one level up.
 */
declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    lede: true
    bodyCompact: true
    micro: true
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
declare module '@mui/material/Chip' {
  interface ChipPropsColorOverrides extends ColorPropOverrides {}
}
declare module '@mui/material/IconButton' {
  // Was `AppBarPropsColorOverrides` — a copy-paste from the block above, so
  // this augmented nothing and IconButton never accepted `tertiary`.
  interface IconButtonPropsColorOverrides extends ColorPropOverrides {}
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
   * Pale accent washes used as SURFACES (AGL-1244) — `tint.primary`,
   * `tint.secondary`, `tint.tertiary`.
   *
   * A group of string leaves like `background` and `text`, NOT a
   * `PaletteColor`: there is no ramp to walk and no `contrastText`, because a
   * tint is never a component `color` — the ink on it is the accent token the
   * tile's icon already uses. That is also why `tint` is absent from
   * `ColorPropOverrides`: `<Button color="tint">` would have no foreground to
   * pair with and must stay a type error.
   */
  interface PaletteTint {
    primary: string
    secondary: string
    tertiary: string
    violet: string
    info: string
    success: string
    warning: string
  }

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

  /**
   * The resting border of an outlined input.
   *
   * A token because MUI has none: `OutlinedInput` hardcodes
   * `rgba(0, 0, 0, 0.23)` / `rgba(255, 255, 255, 0.23)` inside its own
   * styles, so there is nothing on the theme to read. Anything that has to
   * draw an input BESIDE a MUI one — Stripe Elements, which paints its fields
   * inside a cross-origin iframe from an `appearance` object we hand it — can
   * otherwise only match by copying those literals, and the copy silently
   * stops matching the first time the scheme moves.
   *
   * Deliberately NOT `divider` (`rgba(0, 0, 0, 0.12)`): half the weight, so a
   * field drawn with it reads as a different, lighter control sitting next to
   * ours — which is precisely the mismatch this token exists to prevent.
   *
   * A string leaf like `background` and `text`, not a `PaletteColor`: there is
   * no ramp and no `contrastText`, because nothing is ever drawn ON it.
   */
  interface PaletteOptions {
    background?: PaletteOptions['background']
    tertiary?: ExtraColorOptions
    surface?: ExtraColorOptions
    /**
     * The brand gradient's violet, promoted to a token: the marketing CTA
     * band paints `rgb(122, 92, 240)` between the primary blue and
     * `secondary.main`, and accent chips that want that same ink had nothing
     * to reference — every use was a fresh literal.
     */
    violet?: ExtraColorOptions
    tint?: Partial<PaletteTint>
    inputOutline?: string
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
    violet: ExtraColor
    inputOutline: string
    tint: PaletteTint
    svgBackground: IActionStates
    svgFilled: IActionStates
    svgStroke: IActionStates
    text: Palette['text']
  }

  /**
   * The brand's extra rungs on the font-weight scale (AGL-1308).
   *
   * MUI ships four — `fontWeightLight/Regular/Medium/Bold` — and the brand
   * adds three above them: 600, 800 and 900, all real weights because Roboto
   * Flex is a variable face covering 100–1000. Declaring them here is what
   * makes `createTheme({ typography: { fontWeightSemiBold: 600 } })` compile;
   * without the augmentation `TypographyVariantsOptions` is a closed shape and
   * the theme itself does not typecheck.
   *
   * They are reachable the way the built-ins are: `@mui/system`'s `style()`
   * retries a miss as `${prop}${capitalize(value)}`, so `fontWeight: 'black'`
   * resolves to `typography.fontWeightBlack`.
   *
   * BOTH interfaces, and that is not belt-and-braces. `TypographyVariantsOptions`
   * is what `createTheme` ACCEPTS and `TypographyVariants` is what the resolved
   * `theme.typography` HANDS BACK — augmenting only the first compiles the
   * theme and then fails every reader, which is the shape this was in.
   *
   * Optional on the options side, required on the resolved side: an override
   * may omit it (MUI merges the default in), a reader may not have to check.
   *
   * ## And three SCALE variants
   *
   * `lede`, `bodyCompact` and `micro` — 17px, 13px and 11px with their line
   * heights — exist because the built pages kept reaching for those sizes and,
   * with nothing to ask for, wrote the pixels: /press alone carried 286 such
   * literals. Full variant objects rather than bare sizes, so one pick brings
   * the line height with it. Named for the JOB rather than the number, so the
   * name survives a retune: a lede stays the lede if the brand moves it to
   * 18px. `@mui/material/Typography` is augmented separately, above, so a
   * component can ASK for one.
   *
   * ⚑ Declared in THIS file rather than beside the values in
   * `console.theme.ts`, because module augmentation belongs with the rest of
   * the vendor augmentations — and putting it here is what let it be added
   * without touching a file another session was editing at the time.
   */
  interface TypographyVariantsOptions {
    fontWeightSemiBold?: number
    fontWeightExtraBold?: number
    fontWeightBlack?: number
    lede?: CSSProperties
    bodyCompact?: CSSProperties
    micro?: CSSProperties
  }

  interface TypographyVariants {
    fontWeightSemiBold: number
    fontWeightExtraBold: number
    fontWeightBlack: number
    lede: CSSProperties
    bodyCompact: CSSProperties
    micro: CSSProperties
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
    // CssVarsTheme['vars'] supplies the members MUI requires on vars (font,
    // opacity, overlays, …); the Omit layers our theme augmentations on top.
    vars: CssVarsTheme['vars'] &
      Omit<
        Theme,
        'typography' | 'mixins' | 'breakpoints' | 'direction' | 'transitions' | 'vars'
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
