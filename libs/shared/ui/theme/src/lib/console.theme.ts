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
    primary: {
      main: '#00b0ff',
      contrastText: '#FFFFFF',
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
    primary: {
      main: '#00b0ff',
      contrastText: '#FFFFFF',
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
        root: {
          '&a[disabled], &.disabled': {
            pointerEvents: 'none',
            textDecoration: 'none',
            filter: 'grayscale(1) opacity(0.65)',
          },
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
        root: {
          '&[disabled], &.disabled': {
            pointerEvents: 'none',
            textDecoration: 'none',
            filter: 'grayscale(1) opacity(0.65)',
          },
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
    // The brand's named weights, beyond MUI's four (Zach 2026-08-25).
    //
    // MUI ships Light 300 / Regular 400 / Medium 500 / Bold 700, and the
    // brand type ramp uses three more — the press page's own typography
    // card states it: "Black (heroes) · ExtraBold (H2) · Bold · SemiBold ·
    // Regular · Light (numerals)". Without these, reaching 600/800/900 meant
    // typing a raw number, which pins an element to a weight instead of to
    // the brand and leaves it behind when the ramp moves.
    //
    // They are ADDITIVE — `createTypography` deep-merges unknown keys
    // through its `...other`, so nothing MUI defines changes. And they are
    // reachable the same way the built-ins are: `@mui/system`'s `style()`
    // retries a miss as `${prop}${capitalize(value)}`, so `fontWeight:
    // 'extraBold'` resolves to `typography.fontWeightExtraBold`. The
    // besigner's weight picker discovers them off the theme rather than
    // from a list, so they appear in the panel without another edit.
    //
    // Roboto Flex is a variable face covering 100–1000, so every rung here
    // renders as a real weight rather than a synthesised one.
    fontWeightSemiBold: 600,
    fontWeightExtraBold: 800,
    fontWeightBlack: 900,
    // The brand's display ramp, so `variant="h1"` / `"h2"` MEANS the brand
    // (Zach 2026-08-25). MUI's defaults are Light 300 at 96px/60px — a
    // display face for a Material app, and nothing like the type card on
    // /press ("Black (heroes) · ExtraBold (H2)"). Because they did not match,
    // every heading on a built page carried a hand-written `fontSize` and
    // `fontWeight`, which is how eleven of them shipped at Light 300: the
    // variant said Heading 2 and rendered as something nobody chose.
    //
    // Scoped deliberately to h1 and h2. They have ZERO `variant="hN"` usages
    // in the console and one in the tenant app, so this restyles no product
    // surface — it only changes what a SITE gets when it asks for a heading,
    // which is exactly the thing that should follow the brand. h3–h6 carry
    // 95 usages between them and are left on MUI's scale; `overline` has 19
    // and is left alone for the same reason.
    //
    // `responsiveFontSizes` runs over these afterwards (xs→xl), so these are
    // the DESKTOP end of a ramp that scales itself down — 56px/40px here
    // land near the 34px/30px the mobile frames show.
    h1: {
      fontSize: '3.5rem',
      fontWeight: 900,
      lineHeight: 1.05,
      letterSpacing: '-0.025em',
    },
    h2: {
      fontSize: '2.5rem',
      fontWeight: 800,
      lineHeight: 1.15,
      letterSpacing: '-0.02em',
    },
    // The three text rungs the brand uses that MUI's scale has no name for
    // (Zach 2026-08-25). MUI runs 16 / 14 / 12 (`body1` / `body2` /
    // `caption`); the built pages kept reaching for 17, 13 and 11 and, with
    // nothing to ask for, wrote the pixels. /press alone carried 286 such
    // literals — 165 of them the same 11px metadata line — each one pinned to
    // a size instead of to the scale.
    //
    // Full variant objects rather than bare sizes, so one pick brings the
    // line height with it: `variant="micro"` or, where the element's own
    // variant must stay, `fontSize: 'micro.fontSize'` — the token path the
    // Font Size picker already offers for `h4.fontSize`.
    //
    // Named for the job, not the number, so the name survives a retune: a
    // lede stays the lede if the brand moves it to 18px.
    lede: {
      fontSize: '1.0625rem',
      fontWeight: 400,
      lineHeight: 1.6,
    },
    bodyCompact: {
      fontSize: '0.8125rem',
      fontWeight: 400,
      lineHeight: 1.5,
    },
    micro: {
      fontSize: '0.6875rem',
      fontWeight: 400,
      lineHeight: 1.6,
    },
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
