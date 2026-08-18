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

import { lightBlue } from '@mui/material/colors'
import type { PaletteOptions, Theme, ThemeOptions } from '../vendor/mui'
import { buildFontFamilyList } from './constants'
import { accentTextColor } from './util/accent-text'
import createResponsiveTheme, {
  createResponsiveCssVarTheme,
} from './util/create-responsive-theme'

export type ColorVariant = 'light' | 'dark'
export type BackgroundRecord = PaletteOptions['background']
export type OrdinalIdentifier<K extends string = ''> =
  | 'primary'
  | 'secondary'
  | 'tertiary'
export type OrdinalRecord<T extends OrdinalIdentifier = OrdinalIdentifier> =
  Pick<PaletteOptions, T>
export type PrimaryRecord = OrdinalRecord<'primary'>['primary']
export type SecondaryRecord = OrdinalRecord<'secondary'>['secondary']
export type TertiaryRecord = OrdinalRecord<'tertiary'>['tertiary']
export type ActionIdentifier = 'svgBackground' | 'svgFilled' | 'svgStroke'
export type ActionRecord = Pick<PaletteOptions, ActionIdentifier>

const colorScheme = {
  light: {
    // Palette rotated 2026-08-03 (AGL-1186): the blue accent that every
    // component was already opting into is now `primary`, so nothing has to
    // opt out of a primary that was really a surface tone. Whole colour
    // objects moved, so each keeps the contrastText it shipped with.
    // `contrastText` is deliberately ABSENT (AGL-1293, Zach 2026-08-18:
    // "text uses should be computed and use the primary.contrastText"). It
    // used to be the literal `#FFFFFF`, which is 2.43:1 on `#00b0ff` — every
    // filled primary button, chip and badge in the product, below even the
    // 3:1 non-text bar. Leaving the slot empty hands it to MUI's
    // `getContrastText()` against the AA `contrastThreshold`
    // `createResponsiveTheme` now sets, which computes ink at 8.65:1. That
    // computation is what reaches a tenant's generated palette too; a
    // hardcoded swap never would.
    //
    // `main` stays `#00b0ff`: it is the brand colour and it is only ever a
    // FILL or a border here. Rendered as text it is handled by
    // `accentTextColor` → `primary.dark`.
    primary: {
      main: '#00b0ff',
    },
    secondary: {
      main: '#e040fb',
      contrastText: '#FFFFFF',
    },
    tertiary: {
      main: '#404C5C',
      contrastText: '#FFFFFF',
    },
    surface: {
      main: `#F8F9FA`,
      contrastText: '#000000',
    },
    // Pale accent washes used as tile/panel FILLS (AGL-1244). Each member is
    // named after the accent whose icon sits on it — the mega-menu's blue
    // tiles pair `tint.primary` with a `primary.dark` glyph — so the pairing
    // is legible from the token names alone. These were the last raw hexes on
    // the marketing nav; they are not `primary.light` (`#33BFFF`) and never
    // were, which is why the slot had to be named rather than borrowed.
    tint: {
      primary: '#E6F5FF',
      secondary: '#FBE6FE',
      tertiary: '#EEF0F2',
    },
    background: {
      default: '#F5F5F5',
      paper: '#FFFFFF',
    },
    info: {
      main: '#1e88e5',
      contrastText: '#FFFFFF',
    },
    error: {
      main: '#E53935',
      contrastText: '#FFFFFF',
    },
    success: {
      main: '#4CAF50',
      contrastText: '#000000DE',
    },
    warning: {
      main: '#FFAB40',
      contrastText: '#000000DE',
    },
    grey: {
      50: '#FAFAFA',
      100: '#F5F5F5',
      200: '#EEEEEE',
      300: '#E0E0E0',
      400: '#BDBDBD',
      500: '#9E9E9E',
      600: '#757575',
      700: '#616161',
      800: '#424242',
      900: '#212121',
      A100: '#D5D5D5',
      A200: '#AAAAAA',
      A400: '#303030',
      A700: '#616161',
    },
    svgBackground: {
      main: '#FAFAFA',
      hover: '#FAFAFA',
      active: '#FAFAFA',
      focus: '#FAFAFA',
    },
    svgFilled: {
      main: '#9E9E9E',
      hover: lightBlue['400'],
      active: lightBlue['400'],
      focus: lightBlue['400'],
    },
    svgStroke: {
      main: '#FFFFFF',
      hover: '#FFFFFF',
      active: '#FFFFFF',
      focus: '#FFFFFF',
    },
  },
  dark: {
    // Computed, not authored — see the light scheme's note. `#00b0ff` is the
    // same brand blue in both schemes, so the computed pairing is the same
    // ink, and the two dark-mode white-on-blue button fills AGL-1293
    // measured at 2.43:1 stop being the only failures dark mode had.
    primary: {
      main: '#00b0ff',
    },
    secondary: {
      main: '#e040fb',
      contrastText: '#FFFFFF',
    },
    // Dark takes a LIFTED slate, not the brand `#404C5C`: that scores 1.38
    // against this scheme's page and would just move the old invisibility
    // bug from primary to tertiary. `#7C8CA3` measures 5.02 vs page and
    // 3.63 vs a raised panel, and needs dark ink rather than white (6.14
    // against black, 3.42 against white).
    tertiary: {
      main: '#7C8CA3',
      contrastText: '#000000DE',
    },
    surface: {
      main: `#202934`,
      contrastText: '#FFFFFF',
    },
    // The hand-curated dark counterparts the 15 tinted tiles carried in their
    // `@scheme dark` slices before the token existed (AGL-1244). Carrying the
    // exact values here is what lets those slices be DELETED without dark mode
    // shifting: a literal needs a slice, a token flips on its own.
    tint: {
      primary: '#143043',
      secondary: '#3D1443',
      tertiary: '#262B31',
    },
    background: {
      default: '#161c21',
      paper: '#2a3440',
    },
    info: {
      main: '#1e88e5',
      contrastText: '#FFFFFF',
    },
    error: {
      main: '#E53935',
      contrastText: '#FFFFFF',
    },
    success: {
      main: '#4CAF50',
      contrastText: '#000000DE',
    },
    warning: {
      main: '#FFAB40',
      contrastText: '#000000DE',
    },
    grey: {
      50: '#FAFAFA',
      100: '#F5F5F5',
      200: '#EEEEEE',
      300: '#E0E0E0',
      400: '#BDBDBD',
      500: '#9E9E9E',
      600: '#757575',
      700: '#616161',
      800: '#424242',
      900: '#212121',
      A100: '#D5D5D5',
      A200: '#AAAAAA',
      A400: '#303030',
      A700: '#616161',
    },
    svgBackground: {
      main: '#FAFAFA',
      hover: '#FAFAFA',
      active: '#FAFAFA',
      focus: '#FAFAFA',
    },
    svgFilled: {
      main: '#9E9E9E',
      hover: lightBlue['A100'],
      active: lightBlue['A100'],
      focus: lightBlue['A100'],
    },
    svgStroke: {
      main: '#FFFFFF',
      hover: '#FFFFFF',
      active: '#FFFFFF',
      focus: '#FFFFFF',
    },
  },
}

const shadowKeyUmbraOpacity = 0.2
const shadowKeyPenumbraOpacity = 0.14
const shadowAmbientShadowOpacity = 0.12

function createShadowInset(...px: number[]) {
  return [
    `inset ${px[0]}px ${px[1]}px ${px[2]}px ${px[3]}px rgba(0,0,0,${shadowKeyUmbraOpacity})`,
    `inset ${px[4]}px ${px[5]}px ${px[6]}px ${px[7]}px rgba(0,0,0,${shadowKeyPenumbraOpacity})`,
    `inset ${px[8]}px ${px[9]}px ${px[10]}px ${px[11]}px rgba(0,0,0,${shadowAmbientShadowOpacity})`,
  ].join(',')
}

const baseOptions: ThemeOptions = {
  components: {
    MuiAppBar: {
      defaultProps: {
        enableColorOnDark: true,
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: {
          width: 32,
          height: 32,
        },
      },
    },
    MuiButton: {
      defaultProps: {
        color: 'primary',
      },
      styleOverrides: {
        // AGL-1293. MUI's own variants set `--variant-textColor` and
        // `--variant-outlinedColor` to `palette[color].main` — i.e. they
        // paint the BRAND colour as normal-size text. For this palette that
        // is `#00b0ff` at 2.43:1 on white. Both vars move to the computed
        // accent-text shade; `--variant-outlinedBorder` and
        // `--variant-containedBg` are left on `main`, because a border and a
        // fill owe 3:1, not 4.5:1, and the brand colour is meant to be seen
        // there.
        root: ({ theme, ownerState }) => {
          const accent = accentTextColor(theme, ownerState?.color)
          return {
            '&a[disabled], &.disabled': {
              pointerEvents: 'none',
              textDecoration: 'none',
              filter: 'grayscale(1) opacity(0.65)',
            },
            ...(accent && {
              '--variant-textColor': accent,
              '--variant-outlinedColor': accent,
            }),
          }
        },
      },
    },
    MuiFab: {
      defaultProps: {
        color: 'primary',
      },
    },
    MuiIconButton: {
      defaultProps: {
        color: 'primary',
      },
      // color: 'inherit', // Default color to inherit
      styleOverrides: {
        root: ({ theme }) => ({
          padding: theme.spacing(1),
        }),
      },
      variants: [
        {
          props: { variant: 'outlined' } as any, // @TODO ⚠️ fix typing
          style: ({ theme }) => ({
            border: `1px solid`,
            borderColor: `inherit`,
          }),
        },
      ],
    },
    MuiLink: {
      defaultProps: {
        color: 'primary',
      },
      styleOverrides: {
        // AGL-1293. A Link is text by definition, so `color="primary"`
        // resolving to `palette.primary.main` is always the wrong bar. Only
        // the PaletteColor keys are rewritten — `inherit`, `textPrimary`,
        // `textSecondary` and `textDisabled` return undefined from
        // `accentTextColor` and keep MUI's resolution.
        root: ({ theme, ownerState }) => {
          const accent = accentTextColor(theme, ownerState?.color)
          return {
            '&[disabled], &.disabled': {
              pointerEvents: 'none',
              textDecoration: 'none',
              filter: 'grayscale(1) opacity(0.65)',
            },
            ...(accent && { color: accent }),
          }
        },
      },
    },
    // AGL-1293. `textColor="primary"` paints the SELECTED tab label
    // `palette.primary.main`. The indicator underneath it keeps `main` — it
    // is non-text and owes 3:1 — so the brand colour still reads as the
    // selection cue.
    MuiTab: {
      styleOverrides: {
        root: ({ theme, ownerState }) => {
          const textColor = ownerState?.textColor
          const accent =
            textColor === 'primary' || textColor === 'secondary'
              ? accentTextColor(theme, textColor)
              : undefined
          return accent ? { '&.Mui-selected': { color: accent } } : {}
        },
      },
    },
    // MuiMenu: {},
    // No accent defaults live here any more (AGL-1186). Tabs, checkboxes,
    // radios, switches, sliders, progress and badges each briefly carried
    // `color: 'secondary'` to escape a `primary` that was a surface tone.
    // Now that `primary` IS the accent they render correctly on MUI's own
    // default, and a per-component default is exactly what the rotation
    // exists to remove.
    //
    // That includes the `MuiTabs` default AGL-1181 records as its fix: it
    // was removed here deliberately, not reverted. The rotation fixed the
    // root cause the default was papering over, so a reader who finds
    // nothing at that issue's write-up is looking at the right file.
    MuiToolbar: {
      styleOverrides: {
        // Honour `disableGutters` (AGL-1230). This override targets the ROOT
        // slot, and `disableGutters` only drops the `gutters` slot — so the
        // padding survived the prop, app-wide, and the prop silently did
        // nothing at ≥sm. It cost the marketing nav a 24px offset against the
        // page container at every width below the container's clamp.
        root: ({ theme, ownerState }) =>
          ownerState?.disableGutters
            ? {}
            : {
                [theme.breakpoints.up('sm')]: {
                  paddingLeft: theme.spacing(3),
                  paddingRight: theme.spacing(3),
                },
              },
      },
    },
    MuiTooltip: {
      defaultProps: {
        arrow: true,
      },
    },
  },
  // mixins: {},
  shadowsInset: [
    'none',
    createShadowInset(0, 2, 1, -1, 0, 1, 1, -0, 0, 1, 3, -0),
    createShadowInset(0, 3, 1, -2, 0, 2, 2, -0, 0, 1, 5, -0),
    createShadowInset(0, 3, 3, -2, 0, 3, 4, -0, 0, 1, 8, -0),
    createShadowInset(0, 2, 4, -1, 0, 4, 5, -0, 0, 1, 10, -0),
    createShadowInset(0, 3, 5, -1, 0, 5, 8, -0, 0, 1, 14, -0),
    createShadowInset(0, 3, 5, -1, 0, 6, 10, -0, 0, 1, 18, -0),
    createShadowInset(0, 4, 5, -2, 0, 7, 10, -1, 0, 2, 16, -1),
    createShadowInset(0, 5, 5, -3, 0, 8, 10, -1, 0, 3, 14, -2),
    createShadowInset(0, 5, 6, -3, 0, 9, 12, -1, 0, 3, 16, -2),
    createShadowInset(0, 6, 6, -3, 0, 10, 14, -1, 0, 4, 18, -3),
    createShadowInset(0, 6, 7, -4, 0, 11, 15, -1, 0, 4, 20, -3),
    createShadowInset(0, 7, 8, -4, 0, 12, 17, -2, 0, 5, 22, -4),
    createShadowInset(0, 7, 8, -4, 0, 13, 19, -2, 0, 5, 24, -4),
    createShadowInset(0, 7, 9, -4, 0, 14, 21, -2, 0, 5, 26, -4),
    createShadowInset(0, 8, 9, -5, 0, 15, 22, -2, 0, 6, 28, -5),
    createShadowInset(0, 8, 10, -5, 0, 16, 24, -2, 0, 6, 30, -5),
    createShadowInset(0, 8, 11, -5, 0, 17, 26, -2, 0, 6, 32, -5),
    createShadowInset(0, 9, 11, -5, 0, 18, 28, -2, 0, 7, 34, -6),
    createShadowInset(0, 9, 12, -6, 0, 19, 29, -2, 0, 7, 36, -6),
    createShadowInset(0, 10, 13, -6, 0, 20, 31, -3, 0, 8, 38, -7),
    createShadowInset(0, 10, 13, -6, 0, 21, 33, -3, 0, 8, 40, -7),
    createShadowInset(0, 10, 14, -6, 0, 22, 35, -3, 0, 8, 42, -7),
    createShadowInset(0, 11, 14, -7, 0, 23, 36, -3, 0, 9, 44, -8),
    createShadowInset(0, 11, 15, -7, 0, 24, 38, -3, 0, 9, 46, -8),
  ],
  shape: {
    borderRadius: 4,
    appIconBorderRadius: `17.544%`,
  },
  spacing: 8,
  typography: {
    fontFamily: buildFontFamilyList().join(','),
  },
  zIndex: {
    max: 2147483647,
    min: -2147483648,
  },
}

export const consoleOptions: ThemeOptions = {
  ...baseOptions,
  palette: {
    mode: 'light',
    ...colorScheme.light,
  },
}
export const consoleOptionsDark: ThemeOptions = {
  ...baseOptions,
  palette: {
    mode: 'dark',
    ...colorScheme.dark,
  },
}

export const consoleThemeLight: Theme = createResponsiveTheme({
  themeOptions: { ...consoleOptions },
})
export const consoleThemeDark: Theme = createResponsiveTheme({
  themeOptions: { ...consoleOptionsDark },
})

export const consoleThemeCssVar = createResponsiveCssVarTheme(
  consoleThemeLight,
  consoleThemeDark,
)

export const getConsoleTheme = (mode: 'light' | 'dark' = 'light') => {
  const theme = {
    light: consoleThemeLight,
    dark: consoleThemeDark,
  }
  return theme[mode]
}
export const getConsoleMetaThemeColor = (mode: 'light' | 'dark' = 'light') => {
  const themeColor = {
    light: consoleThemeLight.palette.secondary.main,
    dark: consoleThemeDark.palette.primary.main,
  }
  return themeColor[mode]
}
export default consoleThemeLight
