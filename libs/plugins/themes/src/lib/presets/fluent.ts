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

/** Segoe UI first, as Fluent's web stack does; nothing to load. */
const SYSTEM_STACK =
  '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif'

/** Fluent's heading rule: SemiBold, its own line heights. */
const heading = (fontSize: string, lineHeight: number) => ({
  fontSize,
  fontWeight: 600,
  lineHeight,
})

/** Fluent's shadow ramp, at the two depths cards and flyouts use. */
const SHADOW_4 = '0 2px 4px rgba(0, 0, 0, 0.14), 0 0 2px rgba(0, 0, 0, 0.12)'
const SHADOW_16 = '0 8px 16px rgba(0, 0, 0, 0.14), 0 0 2px rgba(0, 0, 0, 0.12)'
const SHADOW_64 = '0 32px 64px rgba(0, 0, 0, 0.24), 0 0 8px rgba(0, 0, 0, 0.2)'

/**
 * Fluent (AGL-3411): the look of Microsoft's Fluent 2 — its brand ramp and
 * neutral tokens in light and dark, Segoe UI with the Fluent type ramp, 4px
 * controls and 8px surfaces, SemiBold labels, the white "secondary" button,
 * inputs underlined in the brand on focus, thin progress, and depth from its
 * shadow ramp rather than from borders.
 */
export const FLUENT_THEME: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#0f6cbd', light: '#2886de', dark: '#115ea3', contrastText: '#ffffff' },
      secondary: { main: '#5b5fc7', dark: '#444791', contrastText: '#ffffff' },
      tertiary: { main: '#616161', dark: '#424242', contrastText: '#ffffff' },
      surface: { main: '#f5f5f5', contrastText: '#242424' },
      error: { main: '#c50f1f', dark: '#b10e1c', contrastText: '#ffffff' },
      warning: { main: '#f7630c', dark: '#bc4b09', contrastText: '#000000' },
      info: { main: '#0f6cbd', dark: '#115ea3', contrastText: '#ffffff' },
      success: { main: '#107c10', dark: '#0e700e', contrastText: '#ffffff' },
      background: {
        default: '#fafafa',
        paper: '#ffffff',
      },
      text: { primary: '#242424', secondary: '#616161', disabled: '#bdbdbd' },
      tint: { primary: '#ebf3fc', secondary: '#e8ebfa', tertiary: '#f0f0f0' },
      divider: '#e0e0e0',
    },
    dark: {
      primary: { main: '#115ea3', light: '#2886de', dark: '#479ef5', contrastText: '#ffffff' },
      secondary: { main: '#4f52b2', dark: '#9299f7', contrastText: '#ffffff' },
      tertiary: { main: '#adadad', dark: '#d6d6d6', contrastText: '#000000' },
      surface: { main: '#333333', contrastText: '#ffffff' },
      error: { main: '#dc626d', dark: '#e37d80', contrastText: '#000000' },
      warning: { main: '#f98845', dark: '#faa06b', contrastText: '#000000' },
      info: { main: '#479ef5', dark: '#62abf5', contrastText: '#000000' },
      success: { main: '#54b054', dark: '#6ccb5f', contrastText: '#000000' },
      background: {
        default: '#1f1f1f',
        paper: '#292929',
      },
      text: { primary: '#ffffff', secondary: '#d6d6d6', disabled: '#5c5c5c' },
      tint: { primary: '#082338', secondary: '#1e1f3d', tertiary: '#333333' },
      divider: '#3d3d3d',
    },
  },
  typography: {
    fontFamily: SYSTEM_STACK,
    // The Fluent 2 web ramp: display, large title, titles 1–3, subtitles,
    // body 1 at 14px and caption 1 at 12px.
    variants: {
      displayXl: { fontSize: '4.25rem', fontWeight: 600, lineHeight: 1.35 },
      h1: heading('2.5rem', 1.3),
      h2: heading('2rem', 1.25),
      h3: heading('1.75rem', 1.29),
      h4: heading('1.5rem', 1.33),
      h5: heading('1.25rem', 1.4),
      h6: heading('1rem', 1.375),
      subtitle1: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.4 },
      subtitle2: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.375 },
      body1: { fontSize: '0.875rem', lineHeight: 1.43 },
      body2: { fontSize: '0.75rem', lineHeight: 1.33 },
      button: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.43, textTransform: 'none' },
      caption: { fontSize: '0.75rem', lineHeight: 1.33 },
      overline: { fontSize: '0.625rem', fontWeight: 600, lineHeight: 1.4, letterSpacing: '0.04em' },
      lede: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.375 },
      bodyCompact: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.33 },
      micro: { fontSize: '0.625rem', fontWeight: 400, lineHeight: 1.4 },
    },
  },
  shape: { borderRadius: 4 },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 4, padding: '5px 12px', minHeight: 32, minWidth: 96 },
        sizeSmall: { padding: '3px 8px', minHeight: 24, minWidth: 64, fontSize: '0.75rem' },
        sizeLarge: { padding: '8px 16px', minHeight: 40, fontSize: '1rem' },
      },
      sx: {
        // Fluent's focus: a solid stroke in the text color, never a glow.
        root: { '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: '1px' } },
      },
      variants: [
        // The "secondary" appearance: a white button with a neutral stroke.
        {
          props: { variant: 'outlined', color: 'primary' },
          sx: {
            bgcolor: 'background.paper',
            borderColor: 'text.disabled',
            color: 'text.primary',
            '&:hover': { bgcolor: 'surface.main', borderColor: 'text.disabled' },
          },
        },
        // "Subtle": no fill until hovered.
        {
          props: { variant: 'text', color: 'primary' },
          sx: { color: 'text.primary', '&:hover': { bgcolor: 'surface.main' } },
        },
      ],
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 4 } },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 4 } },
      sx: {
        root: {
          bgcolor: 'background.paper',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider', borderBottomColor: 'text.secondary' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'text.disabled', borderBottomColor: 'text.primary' },
          // Focus draws the brand line along the bottom edge only.
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 1,
            borderColor: 'divider',
            borderBottomWidth: 2,
            borderBottomColor: 'primary.main',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: { rounded: { borderRadius: 8 } },
      sx: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { borderRadius: 8, boxShadow: SHADOW_4 } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 4, height: 24, fontWeight: 600, fontSize: '0.75rem' } },
    },
    MuiTabs: {
      styleOverrides: { indicator: { height: 3, borderRadius: 2 } },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 400, minHeight: 44, minWidth: 0, padding: '10px 12px' },
      },
      sx: { root: { '&.Mui-selected': { fontWeight: 'semiBold', color: 'text.primary' } } },
    },
    MuiSwitch: {
      styleOverrides: {
        root: { width: 40, height: 20, padding: 0 },
        switchBase: {
          padding: 3,
          '&.Mui-checked': { transform: 'translateX(20px)' },
          '&.Mui-checked + .MuiSwitch-track': { opacity: 1, border: 0 },
        },
        thumb: { width: 14, height: 14, boxShadow: 'none' },
        track: { borderRadius: 10, opacity: 1, border: '1px solid', boxSizing: 'border-box' },
      },
      sx: {
        switchBase: {
          color: 'text.secondary',
          '&.Mui-checked': { color: 'common.white' },
          '&.Mui-checked + .MuiSwitch-track': { bgcolor: 'primary.main' },
        },
        track: { bgcolor: 'background.paper', borderColor: 'text.secondary' },
      },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 4, border: '1px solid' } },
      variants: [
        { props: { severity: 'success', variant: 'standard' }, sx: { borderColor: 'success.main' } },
        { props: { severity: 'info', variant: 'standard' }, sx: { borderColor: 'info.main' } },
        { props: { severity: 'warning', variant: 'standard' }, sx: { borderColor: 'warning.main' } },
        { props: { severity: 'error', variant: 'standard' }, sx: { borderColor: 'error.main' } },
      ],
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: {
        tooltip: { borderRadius: 4, fontSize: '0.75rem', padding: '5px 11px', boxShadow: SHADOW_16 },
      },
      sx: {
        tooltip: { bgcolor: 'background.paper', color: 'text.primary' },
        arrow: { color: 'background.paper' },
      },
    },
    MuiMenu: {
      styleOverrides: { paper: { borderRadius: 4, boxShadow: SHADOW_16 }, list: { padding: 4 } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { borderRadius: 4, minHeight: 32, fontSize: '0.875rem' } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 8, boxShadow: SHADOW_64 } },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0, square: true },
      sx: { root: { bgcolor: 'transparent', '&::before': { display: 'none' } } },
    },
    MuiAccordionSummary: {
      styleOverrides: { root: { flexDirection: 'row-reverse', gap: 8, fontWeight: 600 } },
    },
    MuiTableCell: {
      sx: { root: { borderColor: 'divider' }, head: { fontWeight: 'semiBold' } },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 2, borderRadius: 1 }, bar: { borderRadius: 1 } },
      sx: { root: { bgcolor: 'divider' } },
    },
    MuiLink: { defaultProps: { underline: 'hover' } },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
  },
}
