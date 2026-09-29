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

/** The system face on Apple devices, and the platform's own everywhere else. */
const SYSTEM_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif'

/** The lifted white knob of a switch or a slider, and a raised segment. */
const KNOB_SHADOW = '0 3px 8px rgba(0, 0, 0, 0.15), 0 3px 1px rgba(0, 0, 0, 0.06)'
const SEGMENT_SHADOW = '0 3px 8px rgba(0, 0, 0, 0.12), 0 3px 1px rgba(0, 0, 0, 0.04)'
const MENU_SHADOW = '0 10px 40px rgba(0, 0, 0, 0.18)'

/**
 * Cupertino (AGL-3411): in the style of Apple's iOS — the system face with
 * the Dynamic Type sizes, the system colors on grouped backgrounds in light
 * and dark, white rounded cards on gray, capsule buttons and tinted buttons in
 * place of outlines, segmented controls for tabs, the green switch, and
 * inset grouped lists.
 *
 * The system colors are used where they clear the contrast bar the validator
 * holds a theme to and their "accessible" variants where they do not: white
 * on system green is 2.2:1, so success is the accessible green, and the
 * vivid green stays for the switch through `success.light`.
 */
export const CUPERTINO_THEME: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#007aff', light: '#409cff', dark: '#0066cc', contrastText: '#ffffff' },
      secondary: { main: '#5856d6', dark: '#3634a3', contrastText: '#ffffff' },
      tertiary: { main: '#8e8e93', dark: '#636366', contrastText: '#ffffff' },
      surface: { main: '#e5e5ea', contrastText: '#1c1c1e' },
      error: { main: '#ff3b30', dark: '#d70015', contrastText: '#ffffff' },
      warning: { main: '#ff9500', dark: '#c93400', contrastText: '#000000' },
      info: { main: '#0071a4', dark: '#005a82', contrastText: '#ffffff' },
      success: { main: '#248a3d', light: '#34c759', dark: '#1e7a35', contrastText: '#ffffff' },
      background: {
        default: '#f2f2f7',
        paper: '#ffffff',
      },
      text: { primary: '#1c1c1e', secondary: '#6c6c70', disabled: '#c7c7cc' },
      tint: { primary: '#dbeaff', secondary: '#e6e5fa', tertiary: '#f2f2f7' },
      divider: '#c6c6c8',
    },
    dark: {
      primary: { main: '#0a84ff', light: '#409cff', dark: '#409cff', contrastText: '#ffffff' },
      secondary: { main: '#5e5ce6', dark: '#7d7aff', contrastText: '#ffffff' },
      tertiary: { main: '#8e8e93', dark: '#aeaeb2', contrastText: '#000000' },
      surface: { main: '#2c2c2e', contrastText: '#ffffff' },
      error: { main: '#ff453a', dark: '#ff6961', contrastText: '#000000' },
      warning: { main: '#ff9f0a', dark: '#ffb340', contrastText: '#000000' },
      info: { main: '#64d2ff', dark: '#70d7ff', contrastText: '#000000' },
      success: { main: '#30d158', light: '#30d158', dark: '#30db5b', contrastText: '#000000' },
      background: {
        default: '#000000',
        paper: '#1c1c1e',
      },
      text: { primary: '#ffffff', secondary: '#98989f', disabled: '#48484a' },
      tint: { primary: '#0a2a4d', secondary: '#221f4d', tertiary: '#1c1c1e' },
      divider: '#38383a',
    },
  },
  typography: {
    fontFamily: SYSTEM_STACK,
    // Dynamic Type at its default size: large title, titles 1–3, headline,
    // body at 17pt, subhead, footnote and captions.
    variants: {
      displayXl: { fontSize: '4rem', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.015em' },
      h1: { fontSize: '2.125rem', fontWeight: 700, lineHeight: 1.2, letterSpacing: '0.37px' },
      h2: { fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.21, letterSpacing: '0.36px' },
      h3: { fontSize: '1.375rem', fontWeight: 700, lineHeight: 1.27, letterSpacing: '0.35px' },
      h4: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.25, letterSpacing: '0.38px' },
      h5: { fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.29, letterSpacing: '-0.41px' },
      h6: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.33, letterSpacing: '-0.24px' },
      subtitle1: { fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.29, letterSpacing: '-0.41px' },
      subtitle2: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.33, letterSpacing: '-0.24px' },
      body1: { fontSize: '1.0625rem', lineHeight: 1.29, letterSpacing: '-0.41px' },
      body2: { fontSize: '0.9375rem', lineHeight: 1.33, letterSpacing: '-0.24px' },
      button: { fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.29, letterSpacing: '-0.41px', textTransform: 'none' },
      caption: { fontSize: '0.75rem', lineHeight: 1.33 },
      overline: { fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.38, letterSpacing: '0.02em', textTransform: 'uppercase' },
      lede: { fontSize: '1.25rem', fontWeight: 400, lineHeight: 1.25, letterSpacing: '0.38px' },
      bodyCompact: { fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.38, letterSpacing: '-0.08px' },
      micro: { fontSize: '0.6875rem', fontWeight: 400, lineHeight: 1.18, letterSpacing: '0.07px' },
    },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 12, padding: '10px 20px', '&:active': { opacity: 0.7 } },
        sizeSmall: { borderRadius: 999, padding: '4px 12px', fontSize: '0.9375rem' },
        sizeLarge: { borderRadius: 14, padding: '14px 24px' },
      },
      variants: [
        // iOS has no outlined button; its bordered style is a tinted fill.
        {
          props: { variant: 'outlined', color: 'primary' },
          sx: {
            border: 0,
            bgcolor: 'tint.primary',
            color: 'primary.dark',
            '&:hover': { border: 0, bgcolor: 'tint.primary' },
          },
        },
        {
          props: { variant: 'text', color: 'primary' },
          sx: { '&:hover': { bgcolor: 'transparent', opacity: 0.7 } },
        },
      ],
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 999 } },
    },
    // iOS fields are gray capsules with no rule: MUI's filled field, with its
    // underline off and its label kept inside.
    MuiTextField: { defaultProps: { variant: 'filled' } },
    MuiFilledInput: {
      defaultProps: { disableUnderline: true },
      styleOverrides: { root: { borderRadius: 10 } },
      sx: {
        root: {
          bgcolor: 'surface.main',
          '&:hover': { bgcolor: 'surface.main' },
          '&.Mui-focused': { bgcolor: 'surface.main', outline: '3px solid', outlineColor: 'tint.primary' },
          '&.Mui-error': { outline: '2px solid', outlineColor: 'error.main' },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 10 } },
      sx: {
        root: {
          bgcolor: 'surface.main',
          '& .MuiOutlinedInput-notchedOutline': { border: 0 },
          '&.Mui-focused': { outline: '3px solid', outlineColor: 'tint.primary' },
          '&.Mui-error': { outline: '2px solid', outlineColor: 'error.main' },
        },
      },
    },
    MuiPaper: {
      sx: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { borderRadius: 12 } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      variants: [
        {
          props: { color: 'primary' },
          sx: { bgcolor: 'background.paper', color: 'text.primary', borderBottom: 1, borderColor: 'divider' },
        },
      ],
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 999, fontWeight: 500 } },
      variants: [
        { props: { variant: 'filled', color: 'default' }, sx: { bgcolor: 'surface.main' } },
      ],
    },
    // Tabs as a segmented control.
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 0, padding: 2, borderRadius: 9, display: 'inline-flex' },
        indicator: { display: 'none' },
      },
      sx: { root: { bgcolor: 'surface.main' } },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          minHeight: 0,
          padding: '6px 16px',
          borderRadius: 7,
          fontSize: '0.8125rem',
          fontWeight: 500,
        },
      },
      sx: {
        root: {
          color: 'text.primary',
          '&.Mui-selected': { bgcolor: 'background.paper', color: 'text.primary', fontWeight: 'semiBold', boxShadow: SEGMENT_SHADOW },
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: { width: 51, height: 31, padding: 0 },
        switchBase: {
          padding: 2,
          '&.Mui-checked': { transform: 'translateX(20px)' },
          '&.Mui-checked + .MuiSwitch-track': { opacity: 1 },
        },
        thumb: { width: 27, height: 27, boxShadow: KNOB_SHADOW },
        track: { borderRadius: 16, opacity: 1 },
      },
      sx: {
        switchBase: {
          color: 'common.white',
          '&.Mui-checked': { color: 'common.white' },
          // Green unless the page names a color — keyed to the base's own
          // color class, where MUI's checked track rule lives.
          '&.MuiSwitch-colorPrimary.Mui-checked + .MuiSwitch-track': { bgcolor: 'success.light' },
        },
        track: { bgcolor: 'surface.main' },
      },
    },
    MuiSlider: {
      styleOverrides: {
        thumb: { width: 28, height: 28, boxShadow: KNOB_SHADOW, '&::before': { boxShadow: 'none' } },
        track: { height: 4, border: 0 },
        rail: { height: 4, opacity: 1 },
      },
      sx: { thumb: { bgcolor: 'common.white' }, rail: { bgcolor: 'surface.main' } },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 12 } },
    },
    MuiTooltip: {
      defaultProps: { arrow: false },
      styleOverrides: { tooltip: { borderRadius: 8, fontSize: '0.8125rem', padding: '6px 10px' } },
      sx: { tooltip: { bgcolor: 'text.primary', color: 'background.paper' } },
    },
    MuiMenu: {
      styleOverrides: { paper: { borderRadius: 14, boxShadow: MENU_SHADOW, minWidth: 220 }, list: { padding: 0 } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { minHeight: 44, fontSize: '1.0625rem' } },
      sx: { root: { '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'divider' } } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 14 } },
    },
    // Accordions as an inset grouped list.
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0, square: true },
      sx: {
        root: {
          bgcolor: 'background.paper',
          '&::before': { display: 'none' },
          '&:first-of-type': { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
          '&:last-of-type': { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
          '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'divider' },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 10 } },
    },
    MuiTableCell: {
      sx: { root: { borderColor: 'divider' }, head: { color: 'text.secondary', fontWeight: 'regular' } },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 4, borderRadius: 2 }, bar: { borderRadius: 2 } },
      sx: { root: { bgcolor: 'surface.main' } },
    },
    MuiLink: { defaultProps: { underline: 'none' } },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none' } },
    },
  },
}
