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

import type { HostTheme } from '@aglyn/shared-data-types'

/** MUI's own stack. */
const ROBOTO_STACK = '"Roboto", "Helvetica", "Arial", sans-serif'

/**
 * Material UI (AGL-3422): MUI's own default theme, as its default theme
 * viewer documents it — which is NOT what a site gets by default.
 *
 * The platform's default keeps MUI's palette but lays its own type ramp over
 * it (a Black 900 h1, a heavy `displayXl`) and changes a handful of component
 * defaults. This theme puts every one of those back to MUI's: Roboto, the
 * stock type scale with its Light 96px h1 and uppercase buttons, the stock
 * light and dark palettes, 4px corners, 40px avatars, arrowless tooltips,
 * default-colored icon buttons and FABs, and app bars that give way to the
 * dark surface in dark mode.
 *
 * Two things stay, because they are fixes rather than looks: the platform
 * draws a link and a text button's label in the readable shade of its color
 * (`primary.dark`, which is why the ramps below carry MUI's own `dark`), and
 * a toolbar honors `disableGutters`.
 *
 * MUI has no tertiary, surface or tint colors, and the platform's components
 * ask for them, so they are MUI's own greys and 50-shade washes.
 */
export const MATERIAL_UI_THEME: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#1976d2', light: '#42a5f5', dark: '#1565c0', contrastText: '#ffffff' },
      secondary: { main: '#9c27b0', light: '#ba68c8', dark: '#7b1fa2', contrastText: '#ffffff' },
      tertiary: { main: '#616161', light: '#9e9e9e', dark: '#424242', contrastText: '#ffffff' },
      surface: { main: '#f5f5f5', contrastText: 'rgba(0, 0, 0, 0.87)' },
      error: { main: '#d32f2f', light: '#ef5350', dark: '#c62828', contrastText: '#ffffff' },
      warning: { main: '#ed6c02', light: '#ff9800', dark: '#e65100', contrastText: '#ffffff' },
      info: { main: '#0288d1', light: '#03a9f4', dark: '#01579b', contrastText: '#ffffff' },
      success: { main: '#2e7d32', light: '#4caf50', dark: '#1b5e20', contrastText: '#ffffff' },
      background: {
        default: '#ffffff',
        paper: '#ffffff',
      },
      text: {
        primary: 'rgba(0, 0, 0, 0.87)',
        secondary: 'rgba(0, 0, 0, 0.6)',
        disabled: 'rgba(0, 0, 0, 0.38)',
      },
      tint: { primary: '#e3f2fd', secondary: '#f3e5f5', tertiary: '#f5f5f5' },
      divider: 'rgba(0, 0, 0, 0.12)',
    },
    dark: {
      primary: { main: '#90caf9', light: '#e3f2fd', dark: '#42a5f5', contrastText: 'rgba(0, 0, 0, 0.87)' },
      secondary: { main: '#ce93d8', light: '#f3e5f5', dark: '#ab47bc', contrastText: 'rgba(0, 0, 0, 0.87)' },
      tertiary: { main: '#bdbdbd', light: '#e0e0e0', dark: '#9e9e9e', contrastText: 'rgba(0, 0, 0, 0.87)' },
      surface: { main: '#1e1e1e', contrastText: '#ffffff' },
      error: { main: '#f44336', light: '#e57373', dark: '#d32f2f', contrastText: '#ffffff' },
      warning: { main: '#ffa726', light: '#ffb74d', dark: '#f57c00', contrastText: 'rgba(0, 0, 0, 0.87)' },
      // MUI's own light shade here is retired from this codebase's palette; MUI
      // derives an equivalent one when it is left out.
      info: { main: '#29b6f6', dark: '#0288d1', contrastText: 'rgba(0, 0, 0, 0.87)' },
      success: { main: '#66bb6a', light: '#81c784', dark: '#388e3c', contrastText: 'rgba(0, 0, 0, 0.87)' },
      background: {
        default: '#121212',
        paper: '#121212',
      },
      text: {
        primary: '#ffffff',
        secondary: 'rgba(255, 255, 255, 0.7)',
        disabled: 'rgba(255, 255, 255, 0.5)',
      },
      tint: { primary: '#0d2a40', secondary: '#2a1a2e', tertiary: '#1e1e1e' },
      divider: 'rgba(255, 255, 255, 0.12)',
    },
  },
  fonts: [{ family: 'Roboto', weights: [300, 400, 500, 700], source: 'google' }],
  typography: {
    fontFamily: ROBOTO_STACK,
    // MUI's default scale, verbatim.
    variants: {
      h1: { fontSize: '6rem', fontWeight: 300, lineHeight: 1.167, letterSpacing: '-0.01562em' },
      h2: { fontSize: '3.75rem', fontWeight: 300, lineHeight: 1.2, letterSpacing: '-0.00833em' },
      h3: { fontSize: '3rem', fontWeight: 400, lineHeight: 1.167, letterSpacing: '0em' },
      h4: { fontSize: '2.125rem', fontWeight: 400, lineHeight: 1.235, letterSpacing: '0.00735em' },
      h5: { fontSize: '1.5rem', fontWeight: 400, lineHeight: 1.334, letterSpacing: '0em' },
      h6: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.6, letterSpacing: '0.0075em' },
      subtitle1: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.75, letterSpacing: '0.00938em' },
      subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.57, letterSpacing: '0.00714em' },
      body1: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.5, letterSpacing: '0.00938em' },
      body2: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.43, letterSpacing: '0.01071em' },
      button: {
        fontSize: '0.875rem',
        fontWeight: 500,
        lineHeight: 1.75,
        letterSpacing: '0.02857em',
        textTransform: 'uppercase',
      },
      caption: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.66, letterSpacing: '0.03333em' },
      overline: {
        fontSize: '0.75rem',
        fontWeight: 400,
        lineHeight: 2.66,
        letterSpacing: '0.08333em',
        textTransform: 'uppercase',
      },
      // The platform's own rungs, which MUI does not have, at MUI's own
      // proportions: the hero is the h1 face, and the three body rungs sit
      // between MUI's body and caption.
      displayXl: { fontSize: '6rem', fontWeight: 300, lineHeight: 1.167, letterSpacing: '-0.01562em' },
      lede: { fontSize: '1.125rem', fontWeight: 400, lineHeight: 1.5, letterSpacing: '0.00938em' },
      bodyCompact: { fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.43, letterSpacing: '0.01071em' },
      micro: { fontSize: '0.6875rem', fontWeight: 400, lineHeight: 1.66, letterSpacing: '0.03333em' },
    },
  },
  shape: { borderRadius: 4 },
  spacing: 8,
  components: {
    // Each of these puts back a default the platform's theme changed.
    MuiAppBar: { defaultProps: { enableColorOnDark: false } },
    MuiAvatar: { styleOverrides: { root: { width: 40, height: 40 } } },
    MuiFab: { defaultProps: { color: 'default' } },
    MuiIconButton: { defaultProps: { color: 'default' } },
    MuiTooltip: { defaultProps: { arrow: false } },
  },
}
