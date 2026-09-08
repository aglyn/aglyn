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
import type { PaletteOptions, Theme, ThemeOptions } from '../vendor/mui'
import { consoleOptions, consoleOptionsDark } from './console.theme'
import createResponsiveTheme from './util/create-responsive-theme'

/**
 * The default palette a tenant site wears when it has authored none of its
 * own.
 *
 * MUI's stock accents, extended with every slot this platform adds on top of
 * a MUI palette — `tertiary`, `surface`, `tint`, `inputOutline` and the three
 * `svg*` records — so a site that never opens the theme editor still resolves
 * every token a component can ask for.
 *
 * Stock rather than the Aglyn brand because the brand palette carries a
 * signed-off sub-AA pairing (white on `#00b0ff`, 2.43:1): a considered
 * decision about OUR brand, and not one to hand a customer who never made it.
 * Every accent here clears the 4.5:1 AA text bar as text and carries its own
 * `contrastText` at AA on the fill, in both schemes.
 *
 * Non-palette options come from `consoleOptions`, so component behaviour,
 * type ramp, spacing and shadows are identical platform-wide — the palette is
 * the only thing a tenant default changes.
 */
/**
 * The one grey ramp, read from the brand palette rather than copied. A
 * neutral scale is not a brand decision, and a second copy is a second thing
 * to drift.
 */
const grey = (consoleOptions.palette as { grey: PaletteOptions['grey'] }).grey

const tenantColorScheme = {
  light: {
    primary: {
      main: '#1976d2',
      // The accent-as-text shade (`ACCENT_TEXT_SHADE`): 7.50:1 on the page,
      // 7.82:1 on paper. Authored for the same reason as the console's — the
      // slot every link resolves to belongs in the palette, not in a walk.
      dark: '#125393',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#9c27b0',
      dark: '#6d1b7b',
      contrastText: '#FFFFFF',
    },
    // A neutral slate for the third accent, matching the role `tertiary`
    // plays in the console palette.
    tertiary: {
      main: '#4a5568',
      dark: '#343b49',
      contrastText: '#FFFFFF',
    },
    surface: {
      main: '#f1f3f5',
      contrastText: '#000000DE',
    },
    tint: {
      primary: '#e8f1fb',
      secondary: '#f5e9f7',
      tertiary: '#eef0f3',
    },
    inputOutline: 'rgba(0, 0, 0, 0.23)',
    background: {
      default: '#fafafa',
      paper: '#ffffff',
    },
    info: {
      main: '#0288d1',
      dark: '#015f92',
      contrastText: '#000000DE',
    },
    error: {
      main: '#d32f2f',
      dark: '#942121',
      contrastText: '#FFFFFF',
    },
    success: {
      main: '#2e7d32',
      dark: '#205823',
      contrastText: '#FFFFFF',
    },
    warning: {
      main: '#ed6c02',
      dark: '#a64c01',
      contrastText: '#000000DE',
    },
    grey,
    svgBackground: {
      main: '#FAFAFA',
      hover: '#FAFAFA',
      active: '#FAFAFA',
      focus: '#FAFAFA',
    },
    svgFilled: {
      main: '#9E9E9E',
      hover: '#1976d2',
      active: '#1976d2',
      focus: '#1976d2',
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
      main: '#1976d2',
      // LIGHTER than `main`, as every accent-as-text shade must be on a dark
      // ground: 6.70:1 on the page, 5.96:1 on paper. MUI derives `dark` by
      // darkening in both schemes, which points the wrong way here.
      dark: '#5e9fe0',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#9c27b0',
      dark: '#ba68c8',
      contrastText: '#FFFFFF',
    },
    // Lifted from the light scheme's slate: `#4a5568` is 1.9:1 against this
    // page and would be a third accent nobody can read.
    tertiary: {
      main: '#94a3b8',
      dark: '#b4bfcd',
      contrastText: '#000000DE',
    },
    surface: {
      main: '#242c35',
      contrastText: '#FFFFFF',
    },
    // Tile fills, held around 1.5:1 from the page so a tinted tile has a
    // visible edge without a border.
    tint: {
      primary: '#1e3a5c',
      secondary: '#472653',
      tertiary: '#2e3742',
    },
    inputOutline: 'rgba(255, 255, 255, 0.23)',
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
    info: {
      main: '#0288d1',
      dark: '#4eacdf',
      contrastText: '#000000DE',
    },
    error: {
      main: '#d32f2f',
      dark: '#e06d6d',
      contrastText: '#FFFFFF',
    },
    success: {
      main: '#2e7d32',
      dark: '#6da470',
      contrastText: '#FFFFFF',
    },
    warning: {
      main: '#ed6c02',
      dark: '#f2984e',
      contrastText: '#000000DE',
    },
    grey,
    svgBackground: {
      main: '#242c35',
      hover: '#242c35',
      active: '#242c35',
      focus: '#242c35',
    },
    svgFilled: {
      main: '#9E9E9E',
      hover: '#5e9fe0',
      active: '#5e9fe0',
      focus: '#5e9fe0',
    },
    svgStroke: {
      main: '#FFFFFF',
      hover: '#FFFFFF',
      active: '#FFFFFF',
      focus: '#FFFFFF',
    },
  },
}

export const tenantOptions: ThemeOptions = {
  ...consoleOptions,
  palette: {
    mode: 'light',
    ...tenantColorScheme.light,
  },
}
export const tenantOptionsDark: ThemeOptions = {
  ...consoleOptionsDark,
  palette: {
    mode: 'dark',
    ...tenantColorScheme.dark,
  },
}

export const tenantThemeLight: Theme = createResponsiveTheme({
  themeOptions: { ...tenantOptions },
})
export const tenantThemeDark: Theme = createResponsiveTheme({
  themeOptions: { ...tenantOptionsDark },
})

/**
 * Hosts whose brand IS the platform brand, and which therefore keep
 * `consoleOptions` rather than the tenant default.
 *
 * Matched on the registrable domain the `[host]` route resolves, so a preview
 * deployment — which resolves the same host document — is covered by the same
 * entry. `aglyn.app` subdomains are CUSTOMER sites and are deliberately
 * absent: a customer on a platform subdomain is still a tenant.
 */
export const PLATFORM_BRAND_HOSTS: ReadonlySet<string> = new Set([
  'aglyn.com',
  'aglyn.io',
])

export function wearsPlatformBrand(host: string | undefined): boolean {
  return !!host && PLATFORM_BRAND_HOSTS.has(host.trim().toLowerCase())
}
