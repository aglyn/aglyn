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

/** Carbon's one overlay shadow — menus and popovers; tiles have none. */
const OVERLAY_SHADOW = '0 2px 6px rgba(0, 0, 0, 0.3)'

/**
 * Carbon (AGL-3411): the look of IBM's Carbon Design System — the White theme
 * and the g100 dark theme, IBM Plex Sans with Carbon's light display type,
 * square corners everywhere, 48px buttons with their label set to the left,
 * filled fields with a bottom rule, flat tiles, pill tags, the inset focus
 * ring, and the toggle that turns green.
 */
export const CARBON_THEME: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#0f62fe', light: '#4589ff', dark: '#0043ce', contrastText: '#ffffff' },
      secondary: { main: '#393939', dark: '#161616', contrastText: '#ffffff' },
      tertiary: { main: '#6f6f6f', dark: '#525252', contrastText: '#ffffff' },
      surface: { main: '#f4f4f4', contrastText: '#161616' },
      error: { main: '#da1e28', dark: '#a2191f', contrastText: '#ffffff' },
      warning: { main: '#f1c21b', dark: '#8e6a00', contrastText: '#000000' },
      info: { main: '#0043ce', dark: '#002d9c', contrastText: '#ffffff' },
      success: { main: '#198038', dark: '#0e6027', contrastText: '#ffffff' },
      background: {
        default: '#ffffff',
        paper: '#ffffff',
      },
      text: { primary: '#161616', secondary: '#525252', disabled: '#8d8d8d' },
      tint: { primary: '#edf5ff', secondary: '#e0e0e0', tertiary: '#f4f4f4' },
      divider: '#e0e0e0',
    },
    dark: {
      primary: { main: '#0f62fe', light: '#4589ff', dark: '#78a9ff', contrastText: '#ffffff' },
      secondary: { main: '#6f6f6f', dark: '#c6c6c6', contrastText: '#ffffff' },
      tertiary: { main: '#8d8d8d', dark: '#c6c6c6', contrastText: '#000000' },
      surface: { main: '#262626', contrastText: '#f4f4f4' },
      error: { main: '#fa4d56', dark: '#ff8389', contrastText: '#000000' },
      warning: { main: '#f1c21b', dark: '#f1c21b', contrastText: '#000000' },
      info: { main: '#4589ff', dark: '#78a9ff', contrastText: '#000000' },
      success: { main: '#42be65', dark: '#6fdc8c', contrastText: '#000000' },
      background: {
        default: '#161616',
        paper: '#161616',
      },
      text: { primary: '#f4f4f4', secondary: '#c6c6c6', disabled: '#6f6f6f' },
      tint: { primary: '#001d6c', secondary: '#393939', tertiary: '#262626' },
      divider: '#393939',
    },
  },
  fonts: [{ family: 'IBM Plex Sans', weights: [300, 400, 600], source: 'google' }],
  typography: {
    fontFamily: '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif',
    // Carbon's productive and expressive sets: display and the largest
    // headings are LIGHT (300), which is the most recognizable thing about it.
    variants: {
      displayXl: { fontSize: '4.75rem', fontWeight: 300, lineHeight: 1.17, letterSpacing: '-0.5px' },
      h1: { fontSize: '3.375rem', fontWeight: 300, lineHeight: 1.19 },
      h2: { fontSize: '2.625rem', fontWeight: 300, lineHeight: 1.19 },
      h3: { fontSize: '2rem', fontWeight: 400, lineHeight: 1.25 },
      h4: { fontSize: '1.75rem', fontWeight: 400, lineHeight: 1.29 },
      h5: { fontSize: '1.25rem', fontWeight: 400, lineHeight: 1.4 },
      h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.375 },
      subtitle1: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.375 },
      subtitle2: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.29, letterSpacing: '0.16px' },
      body1: { fontSize: '1rem', lineHeight: 1.5 },
      body2: { fontSize: '0.875rem', lineHeight: 1.43, letterSpacing: '0.16px' },
      button: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.29, letterSpacing: '0.16px', textTransform: 'none' },
      caption: { fontSize: '0.75rem', lineHeight: 1.33, letterSpacing: '0.32px' },
      overline: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.33, letterSpacing: '0.32px', textTransform: 'none' },
      lede: { fontSize: '1.25rem', fontWeight: 300, lineHeight: 1.4 },
      bodyCompact: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.29, letterSpacing: '0.16px' },
      micro: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.33, letterSpacing: '0.32px' },
    },
  },
  shape: { borderRadius: 0 },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        // Carbon sets the label to the left with a wide right gutter, where
        // an icon would sit.
        root: {
          borderRadius: 0,
          minHeight: 48,
          padding: '11px 48px 11px 15px',
          justifyContent: 'flex-start',
          textAlign: 'left',
        },
        sizeSmall: { minHeight: 32, padding: '5px 32px 5px 15px' },
        sizeLarge: { minHeight: 64, padding: '14px 64px 14px 15px', fontSize: '1rem' },
      },
      sx: {
        root: {
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
        },
      },
      variants: [
        // Carbon's "tertiary" button: a blue stroke that fills on hover.
        {
          props: { variant: 'outlined', color: 'primary' },
          sx: {
            borderColor: 'primary.main',
            color: 'primary.main',
            '&:hover': { bgcolor: 'primary.main', color: 'primary.contrastText' },
          },
        },
      ],
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 0 } },
    },
    MuiFab: {
      styleOverrides: { root: { borderRadius: 0 } },
    },
    // Carbon's field is a filled box with a bottom rule and its label inside,
    // which is MUI's filled field; an outlined one keeps the same fill below.
    MuiTextField: { defaultProps: { variant: 'filled' } },
    MuiFilledInput: {
      styleOverrides: { root: { borderRadius: 0 } },
      sx: {
        root: {
          bgcolor: 'surface.main',
          '&:hover': { bgcolor: 'surface.main' },
          '&.Mui-focused': { bgcolor: 'surface.main', outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
          '&::before': { borderBottomColor: 'text.disabled' },
          '&::after': { display: 'none' },
          '&.Mui-error': { outline: '2px solid', outlineColor: 'error.main', outlineOffset: '-2px' },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 0 } },
      sx: {
        root: {
          bgcolor: 'surface.main',
          '& .MuiOutlinedInput-notchedOutline': {
            border: 0,
            borderBottom: 1,
            borderColor: 'text.disabled',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'text.secondary' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
          '&.Mui-focused': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': { border: 0 },
          '&.Mui-error': { outline: '2px solid', outlineColor: 'error.main', outlineOffset: '-2px' },
        },
      },
    },
    MuiPaper: {
      sx: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      sx: { root: { bgcolor: 'surface.main' } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      // The UI shell header is black in every theme.
      variants: [
        {
          props: { color: 'primary' },
          sx: { bgcolor: 'grey.900', color: 'common.white', borderBottom: 1, borderColor: 'grey.800' },
        },
      ],
    },
    MuiChip: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { borderRadius: 24, height: 24, fontSize: '0.75rem' } },
      variants: [
        { props: { variant: 'filled', color: 'default' }, sx: { bgcolor: 'divider', color: 'text.primary' } },
      ],
    },
    MuiTabs: {
      styleOverrides: { root: { minHeight: 40 }, indicator: { height: 2 } },
      sx: { root: { borderBottom: 2, borderColor: 'divider' } },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 400, minHeight: 40, minWidth: 0, padding: '11px 16px', alignItems: 'flex-start' },
      },
      sx: {
        root: { color: 'text.secondary', '&.Mui-selected': { fontWeight: 'semiBold', color: 'text.primary' } },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: { width: 48, height: 24, padding: 0 },
        switchBase: {
          padding: 3,
          '&.Mui-checked': { transform: 'translateX(24px)' },
          '&.Mui-checked + .MuiSwitch-track': { opacity: 1 },
        },
        thumb: { width: 18, height: 18, boxShadow: 'none' },
        track: { borderRadius: 12, opacity: 1 },
      },
      sx: {
        switchBase: {
          color: 'common.white',
          '&.Mui-checked': { color: 'common.white' },
          // Carbon's toggle turns green, not blue, when the page did not
          // name a color. Keyed to the base's own color class: MUI's checked
          // track rule sits on this element, so a rule from the root would
          // tie with it on specificity and lose on order.
          '&.MuiSwitch-colorPrimary.Mui-checked + .MuiSwitch-track': { bgcolor: 'success.main' },
        },
        track: { bgcolor: 'text.disabled' },
      },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 0, borderLeft: '3px solid' } },
      variants: [
        { props: { severity: 'success', variant: 'standard' }, sx: { borderLeftColor: 'success.main' } },
        { props: { severity: 'info', variant: 'standard' }, sx: { borderLeftColor: 'info.main' } },
        { props: { severity: 'warning', variant: 'standard' }, sx: { borderLeftColor: 'warning.main' } },
        { props: { severity: 'error', variant: 'standard' }, sx: { borderLeftColor: 'error.main' } },
      ],
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: { tooltip: { borderRadius: 2, fontSize: '0.875rem', padding: '8px 16px' } },
      sx: { tooltip: { bgcolor: 'text.primary', color: 'background.default' }, arrow: { color: 'text.primary' } },
    },
    MuiMenu: {
      styleOverrides: { paper: { borderRadius: 0, boxShadow: OVERLAY_SHADOW }, list: { padding: 0 } },
      sx: { paper: { bgcolor: 'surface.main' } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { minHeight: 40, fontSize: '0.875rem' } },
      sx: { root: { borderBottom: 1, borderColor: 'divider' } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 0 } },
      sx: { paper: { bgcolor: 'surface.main' } },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0, square: true },
      sx: {
        root: {
          bgcolor: 'transparent',
          borderTop: 1,
          borderColor: 'divider',
          '&::before': { display: 'none' },
          '&:last-of-type': { borderBottom: 1, borderBottomColor: 'divider' },
        },
      },
    },
    MuiTableCell: {
      sx: {
        root: { borderColor: 'divider' },
        head: { bgcolor: 'divider', fontWeight: 'semiBold' },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 4, borderRadius: 0 } },
      sx: { root: { bgcolor: 'divider' } },
    },
    MuiLink: { defaultProps: { underline: 'hover' } },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none', borderRadius: 0 } },
    },
    MuiCheckbox: {
      styleOverrides: { root: { borderRadius: 0 } },
    },
  },
}
