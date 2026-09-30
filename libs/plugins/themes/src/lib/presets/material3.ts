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

/**
 * Material 3 (AGL-3405): Material Design 3's baseline scheme, the generation
 * after the Material 2 look MUI ships by default — tonal surfaces instead of
 * shadows, pill buttons, larger rounder corners (12px cards, 28px dialogs), a
 * tall tab indicator, sentence-case labels, the M3 type scale and its switch.
 *
 * Colors are the M3 baseline roles: primary, secondary and tertiary, the
 * surface-container tones for `surface` and `paper`, and `outline-variant`
 * for dividers. M3 has no success, warning or info role, so those are M3
 * tonal palettes at the same tones as its error role.
 */
export const MATERIAL3_THEME: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#6750a4', dark: '#4f378b', contrastText: '#ffffff' },
      secondary: { main: '#625b71', dark: '#4a4458', contrastText: '#ffffff' },
      tertiary: { main: '#7d5260', dark: '#633b48', contrastText: '#ffffff' },
      surface: { main: '#ece6f0', contrastText: '#1d1b20' },
      error: { main: '#b3261e', dark: '#8c1d18', contrastText: '#ffffff' },
      warning: { main: '#7d5700', dark: '#5f4100', contrastText: '#ffffff' },
      info: { main: '#00639b', dark: '#004a77', contrastText: '#ffffff' },
      success: { main: '#386a20', dark: '#1f5109', contrastText: '#ffffff' },
      background: {
        default: '#fef7ff',
        paper: '#f7f2fa',
      },
      text: { primary: '#1d1b20', secondary: '#49454f', disabled: '#79747e' },
      tint: { primary: '#eaddff', secondary: '#e8def8', tertiary: '#ffd8e4' },
      divider: '#cac4d0',
    },
    dark: {
      primary: { main: '#d0bcff', dark: '#d0bcff', contrastText: '#381e72' },
      secondary: { main: '#ccc2dc', dark: '#e8def8', contrastText: '#332d41' },
      tertiary: { main: '#efb8c8', dark: '#ffd8e4', contrastText: '#492532' },
      surface: { main: '#2b2930', contrastText: '#e6e0e9' },
      error: { main: '#f2b8b5', dark: '#f9dedc', contrastText: '#601410' },
      warning: { main: '#f8bd2a', dark: '#ffdea0', contrastText: '#412d00' },
      info: { main: '#93ccff', dark: '#cde5ff', contrastText: '#003352' },
      success: { main: '#9cd67d', dark: '#b8f397', contrastText: '#0c3900' },
      background: {
        default: '#141218',
        paper: '#1d1b20',
      },
      text: { primary: '#e6e0e9', secondary: '#cac4d0', disabled: '#938f99' },
      tint: { primary: '#4f378b', secondary: '#4a4458', tertiary: '#633b48' },
      divider: '#49454f',
    },
  },
  fonts: [{ family: 'Roboto', weights: [400, 500, 700], source: 'google' }],
  typography: {
    fontFamily: '"Roboto", system-ui, sans-serif',
    // The M3 type scale: display for h1–h3, headline for h4–h5, title for
    // h6 and the subtitles, body and label for the rest.
    variants: {
      // Above display-large, at M3's display weight: regular, never heavy.
      displayXl: { fontSize: '4.5rem', fontWeight: 400, lineHeight: 1.1, letterSpacing: '-0.5px' },
      h1: { fontSize: '3.5625rem', fontWeight: 400, lineHeight: 1.12, letterSpacing: '-0.25px' },
      h2: { fontSize: '2.8125rem', fontWeight: 400, lineHeight: 1.16, letterSpacing: 0 },
      h3: { fontSize: '2.25rem', fontWeight: 400, lineHeight: 1.22, letterSpacing: 0 },
      h4: { fontSize: '2rem', fontWeight: 400, lineHeight: 1.25, letterSpacing: 0 },
      h5: { fontSize: '1.75rem', fontWeight: 400, lineHeight: 1.29, letterSpacing: 0 },
      h6: { fontSize: '1.375rem', fontWeight: 400, lineHeight: 1.27, letterSpacing: 0 },
      subtitle1: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.5, letterSpacing: '0.15px' },
      subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.43, letterSpacing: '0.1px' },
      body1: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.5, letterSpacing: '0.5px' },
      body2: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.43, letterSpacing: '0.25px' },
      button: {
        fontSize: '0.875rem',
        fontWeight: 500,
        lineHeight: 1.43,
        letterSpacing: '0.1px',
        textTransform: 'none',
      },
      caption: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.33, letterSpacing: '0.4px' },
      // body-large for the lede, body-small and label-small below body.
      lede: { fontSize: '1.125rem', fontWeight: 400, lineHeight: 1.5, letterSpacing: '0.15px' },
      bodyCompact: { fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.38, letterSpacing: '0.25px' },
      micro: { fontSize: '0.6875rem', fontWeight: 500, lineHeight: 1.45, letterSpacing: '0.5px' },
      overline: {
        fontSize: '0.6875rem',
        fontWeight: 500,
        lineHeight: 1.45,
        letterSpacing: '0.5px',
        textTransform: 'none',
      },
    },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 20, padding: '10px 24px' },
        sizeSmall: { padding: '6px 16px' },
        sizeLarge: { padding: '12px 32px' },
      },
      variants: [
        // M3's outlined button draws its border in `outline`, not a faded
        // primary.
        { props: { variant: 'outlined' }, sx: { borderColor: 'text.disabled' } },
        // The filled-tonal button: secondary container, on-secondary-container.
        {
          props: { variant: 'contained', color: 'secondary' },
          sx: { bgcolor: 'tint.secondary', color: 'text.primary', '&:hover': { bgcolor: 'tint.secondary', boxShadow: 1 } },
        },
      ],
    },
    MuiFab: {
      styleOverrides: { root: { borderRadius: 16 } },
      sx: { root: { boxShadow: 3 } },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 20 } },
    },
    MuiPaper: {
      styleOverrides: { rounded: { borderRadius: 12 } },
      sx: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { borderRadius: 12 } },
      sx: { root: { bgcolor: 'surface.main' } },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      variants: [
        {
          props: { color: 'primary' },
          sx: { bgcolor: 'surface.main', color: 'text.primary' },
        },
      ],
    },
    MuiChip: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 8, height: 32, fontWeight: 500 } },
      variants: [{ props: { variant: 'outlined' }, sx: { borderColor: 'text.disabled' } }],
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 4 } },
      sx: { root: { '& .MuiOutlinedInput-notchedOutline': { borderColor: 'text.disabled' } } },
    },
    MuiFilledInput: {
      styleOverrides: { root: { borderTopLeftRadius: 4, borderTopRightRadius: 4 } },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
      },
      sx: { root: { borderBottom: 1, borderColor: 'divider' } },
    },
    MuiTab: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 500, minHeight: 48 } },
    },
    MuiSwitch: {
      styleOverrides: {
        root: { width: 52, height: 32, padding: 0 },
        switchBase: {
          padding: 8,
          '&.Mui-checked': { transform: 'translateX(20px)', padding: 4 },
          '&.Mui-checked .MuiSwitch-thumb': { width: 24, height: 24 },
          '&.Mui-checked + .MuiSwitch-track': { opacity: 1 },
        },
        thumb: { width: 16, height: 16, boxShadow: 'none' },
        track: { borderRadius: 16, opacity: 1, border: '2px solid', boxSizing: 'border-box' },
      },
      sx: {
        switchBase: {
          color: 'text.disabled',
          '&.Mui-checked': { color: 'primary.contrastText' },
          '&.Mui-checked + .MuiSwitch-track': { bgcolor: 'primary.main', borderColor: 'primary.main' },
        },
        track: { bgcolor: 'surface.main', borderColor: 'text.disabled' },
      },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 28, padding: 8 } },
      sx: { paper: { bgcolor: 'surface.main' } },
    },
    MuiMenu: {
      styleOverrides: { paper: { borderRadius: 4 } },
      sx: { paper: { bgcolor: 'surface.main' } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { minHeight: 48 } },
    },
    MuiTooltip: {
      defaultProps: { arrow: false },
      styleOverrides: { tooltip: { borderRadius: 4, fontSize: '0.75rem', padding: '4px 8px' } },
      sx: { tooltip: { bgcolor: 'text.primary', color: 'background.default' } },
    },
    // M3 has no alert; its closest is a tonal container, so the message sits
    // on the surface tone and only the icon carries the severity — which
    // also keeps it legible in dark, where MUI's own tinted fill all but
    // disappears into the page.
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 12 } },
      variants: [
        { props: { variant: 'standard' }, sx: { bgcolor: 'surface.main', color: 'text.primary' } },
      ],
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 4, borderRadius: 4 }, bar: { borderRadius: 4 } },
      sx: { root: { bgcolor: 'tint.primary' } },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0 },
      styleOverrides: { root: { borderRadius: 12, '&::before': { display: 'none' } } },
      sx: { root: { bgcolor: 'surface.main', mb: 1 } },
    },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none' } },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 28 } },
    },
  },
}
