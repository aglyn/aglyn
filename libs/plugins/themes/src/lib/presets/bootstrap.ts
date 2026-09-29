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

/** Bootstrap 5.3's system font stack, which needs no loading. */
const SYSTEM_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", ' +
  '"Noto Sans", "Liberation Sans", Arial, sans-serif'

/** Bootstrap's own heading rule: weight 500, line height 1.2. */
const heading = (fontSize: string) => ({ fontSize, fontWeight: 500, lineHeight: 1.2 })

/**
 * Bootstrap (AGL-3405): the look of Bootstrap 5.3 — its palette and
 * dark mode, the system font stack, sentence-case buttons with no ripple or
 * elevation, 6px corners, bordered flat cards, compact bordered inputs, and
 * the translucent focus ring on every control.
 *
 * Colors are Bootstrap's own tokens. Where a Bootstrap text color would miss
 * the 4.5:1 body-text bar the validator holds a theme to, the darker
 * "emphasis" token it ships for that role is used instead.
 */
export const BOOTSTRAP_THEME: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#0d6efd', light: '#86b7fe', dark: '#0a58ca', contrastText: '#ffffff' },
      secondary: { main: '#6c757d', dark: '#565e64', contrastText: '#ffffff' },
      tertiary: { main: '#495057', contrastText: '#ffffff' },
      surface: { main: '#f8f9fa', contrastText: '#212529' },
      error: { main: '#dc3545', dark: '#b02a37', contrastText: '#ffffff' },
      warning: { main: '#ffc107', dark: '#997404', contrastText: '#000000' },
      info: { main: '#0dcaf0', dark: '#087990', contrastText: '#000000' },
      success: { main: '#198754', dark: '#146c43', contrastText: '#ffffff' },
      background: {
        default: '#ffffff',
        paper: '#ffffff',
      },
      text: { primary: '#212529', secondary: '#595c5f', disabled: '#adb5bd' },
      tint: { primary: '#cfe2ff', secondary: '#e2e3e5', tertiary: '#e9ecef' },
      divider: '#dee2e6',
    },
    dark: {
      primary: { main: '#0d6efd', light: '#3d8bfd', dark: '#6ea8fe', contrastText: '#ffffff' },
      secondary: { main: '#6c757d', dark: '#a7acb1', contrastText: '#ffffff' },
      tertiary: { main: '#adb5bd', contrastText: '#000000' },
      surface: { main: '#2b3035', contrastText: '#dee2e6' },
      error: { main: '#dc3545', dark: '#ea868f', contrastText: '#ffffff' },
      warning: { main: '#ffc107', dark: '#ffda6a', contrastText: '#000000' },
      info: { main: '#0dcaf0', dark: '#6edff6', contrastText: '#000000' },
      success: { main: '#198754', dark: '#75b798', contrastText: '#ffffff' },
      background: {
        default: '#212529',
        paper: '#2b3035',
      },
      text: { primary: '#dee2e6', secondary: '#adb5bd', disabled: '#6c757d' },
      tint: { primary: '#031633', secondary: '#161719', tertiary: '#343a40' },
      divider: '#495057',
    },
  },
  typography: {
    fontFamily: SYSTEM_STACK,
    variants: {
      h1: heading('2.5rem'),
      h2: heading('2rem'),
      h3: heading('1.75rem'),
      h4: heading('1.5rem'),
      h5: heading('1.25rem'),
      h6: heading('1rem'),
      body1: { fontSize: '1rem', lineHeight: 1.5 },
      body2: { fontSize: '0.875rem', lineHeight: 1.5 },
      button: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.5, textTransform: 'none' },
      overline: { fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em' },
    },
  },
  shape: { borderRadius: 6 },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 6, padding: '6px 12px', boxShadow: 'none' },
        sizeSmall: { borderRadius: 4, padding: '4px 8px', fontSize: '0.875rem' },
        sizeLarge: { borderRadius: 8, padding: '8px 16px', fontSize: '1.25rem' },
      },
      sx: {
        // The translucent ring Bootstrap draws around a focused control, in
        // the scheme's own primary tint.
        root: {
          '&.Mui-focusVisible': {
            outline: '0.25rem solid',
            outlineColor: 'primary.light',
            outlineOffset: 0,
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 6 } },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 6 } },
      sx: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: 'primary.light',
            borderWidth: 1,
          },
          '&.Mui-focused': {
            outline: '0.25rem solid',
            outlineColor: 'tint.primary',
          },
        },
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 6 } },
      sx: { root: { borderColor: 'divider' } },
    },
    MuiCardHeader: {
      sx: {
        root: {
          bgcolor: 'surface.main',
          borderBottom: 1,
          borderColor: 'divider',
          py: 1,
          px: 2,
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6, fontWeight: 700, fontSize: '0.75rem' },
      },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 6, border: '1px solid' } },
      variants: [
        { props: { severity: 'success', variant: 'standard' }, sx: { borderColor: 'success.main' } },
        { props: { severity: 'info', variant: 'standard' }, sx: { borderColor: 'info.main' } },
        { props: { severity: 'warning', variant: 'standard' }, sx: { borderColor: 'warning.main' } },
        { props: { severity: 'error', variant: 'standard' }, sx: { borderColor: 'error.main' } },
      ],
    },
    MuiTabs: {
      sx: { root: { borderBottom: 1, borderColor: 'divider' } },
    },
    MuiTab: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 400, fontSize: '1rem' } },
    },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none' } },
    },
    MuiLink: { defaultProps: { underline: 'always' } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { fontSize: '0.875rem', borderRadius: 6 },
      },
      sx: { tooltip: { bgcolor: 'common.black' }, arrow: { color: 'common.black' } },
    },
    MuiPaper: {
      sx: { root: { backgroundImage: 'none' } },
    },
    MuiMenu: {
      sx: { paper: { border: 1, borderColor: 'divider' } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 8 } },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0 },
      sx: {
        root: {
          border: 1,
          borderColor: 'divider',
          '&::before': { display: 'none' },
          '&:not(:last-of-type)': { borderBottom: 0 },
        },
      },
    },
    MuiTableCell: {
      sx: { root: { borderColor: 'divider' }, head: { fontWeight: 'bold' } },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 16, borderRadius: 6 } },
    },
  },
}
