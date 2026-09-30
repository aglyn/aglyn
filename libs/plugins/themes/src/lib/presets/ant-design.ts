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

/** Ant Design's font stack, which needs no loading. */
const SYSTEM_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", ' +
  'Arial, "Noto Sans", sans-serif'

/** Ant Design's heading rule: SemiBold, its own line heights. */
const heading = (fontSize: string, lineHeight: number) => ({
  fontSize,
  fontWeight: 600,
  lineHeight,
})

/** The primary button's lift, and the elevated surfaces' shadow. */
const BUTTON_SHADOW = '0 2px 0 rgba(5, 145, 255, 0.1)'
const THUMB_SHADOW = '0 2px 4px 0 rgba(0, 35, 11, 0.2)'
const POPUP_SHADOW =
  '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), ' +
  '0 9px 28px 8px rgba(0, 0, 0, 0.05)'

/**
 * Ant Design (AGL-3411): the look of Ant Design 5 — its default token set and
 * dark algorithm, 14px body type, 6px corners, 32px controls, the white
 * "default" button with a hairline border, inputs that turn blue with a soft
 * focus halo, bordered cards and tags, and its pill switch.
 *
 * Where an Ant color misses the contrast bar the validator holds a theme to —
 * white on its green is 2.3:1 — the next shade of the same palette is used.
 */
export const ANT_DESIGN_THEME: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#1677ff', light: '#69b1ff', dark: '#0958d9', contrastText: '#ffffff' },
      secondary: { main: '#722ed1', dark: '#531dab', contrastText: '#ffffff' },
      tertiary: { main: '#595959', dark: '#434343', contrastText: '#ffffff' },
      surface: { main: '#fafafa', contrastText: '#1f1f1f' },
      error: { main: '#ff4d4f', dark: '#cf1322', contrastText: '#ffffff' },
      warning: { main: '#faad14', dark: '#ad6800', contrastText: '#000000' },
      info: { main: '#1677ff', dark: '#0958d9', contrastText: '#ffffff' },
      success: { main: '#389e0d', dark: '#237804', contrastText: '#ffffff' },
      background: {
        default: '#f5f5f5',
        paper: '#ffffff',
      },
      text: { primary: '#1f1f1f', secondary: '#595959', disabled: '#bfbfbf' },
      tint: { primary: '#e6f4ff', secondary: '#f9f0ff', tertiary: '#f5f5f5' },
      divider: '#d9d9d9',
    },
    dark: {
      primary: { main: '#1668dc', light: '#3c89e8', dark: '#65a9f3', contrastText: '#ffffff' },
      secondary: { main: '#854eca', dark: '#ab7ae0', contrastText: '#ffffff' },
      tertiary: { main: '#a6a6a6', dark: '#d9d9d9', contrastText: '#000000' },
      surface: { main: '#1f1f1f', contrastText: '#d9d9d9' },
      error: { main: '#dc4446', dark: '#f37370', contrastText: '#ffffff' },
      warning: { main: '#d89614', dark: '#e8b339', contrastText: '#000000' },
      info: { main: '#1668dc', dark: '#65a9f3', contrastText: '#ffffff' },
      success: { main: '#49aa19', dark: '#8fd460', contrastText: '#000000' },
      background: {
        default: '#000000',
        paper: '#141414',
      },
      text: { primary: '#d9d9d9', secondary: '#a6a6a6', disabled: '#595959' },
      tint: { primary: '#111a2c', secondary: '#1a1325', tertiary: '#1f1f1f' },
      divider: '#424242',
    },
  },
  typography: {
    fontFamily: SYSTEM_STACK,
    variants: {
      displayXl: { fontSize: '3.5rem', fontWeight: 600, lineHeight: 1.15 },
      h1: heading('2.375rem', 1.21),
      h2: heading('1.875rem', 1.27),
      h3: heading('1.5rem', 1.33),
      h4: heading('1.25rem', 1.4),
      h5: heading('1rem', 1.5),
      h6: heading('0.875rem', 1.57),
      subtitle1: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.5 },
      subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.57 },
      body1: { fontSize: '0.875rem', lineHeight: 1.5714 },
      body2: { fontSize: '0.75rem', lineHeight: 1.6667 },
      button: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.5714, textTransform: 'none' },
      caption: { fontSize: '0.75rem', lineHeight: 1.6667 },
      overline: { fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em' },
      lede: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.5 },
      bodyCompact: { fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.54 },
      micro: { fontSize: '0.6875rem', fontWeight: 400, lineHeight: 1.64 },
    },
  },
  shape: { borderRadius: 6 },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 6, padding: '4px 15px', minHeight: 32, lineHeight: 1.5714 },
        sizeSmall: { borderRadius: 4, padding: '0 7px', minHeight: 24 },
        sizeLarge: { borderRadius: 8, padding: '7px 15px', minHeight: 40, fontSize: '1rem' },
        containedPrimary: { boxShadow: BUTTON_SHADOW },
      },
      variants: [
        // Ant's "default" button: white, hairline border, and the brand only
        // on hover.
        {
          props: { variant: 'outlined', color: 'primary' },
          sx: {
            bgcolor: 'background.paper',
            borderColor: 'divider',
            color: 'text.primary',
            '&:hover': { bgcolor: 'background.paper', borderColor: 'primary.main', color: 'primary.main' },
          },
        },
        {
          props: { variant: 'text', color: 'primary' },
          sx: { color: 'text.primary', '&:hover': { bgcolor: 'action.hover' } },
        },
      ],
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 6 } },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 6 } },
      sx: {
        root: {
          bgcolor: 'background.paper',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'primary.light' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'primary.main', borderWidth: 1 },
          '&.Mui-focused': { outline: '2px solid', outlineColor: 'tint.primary' },
        },
      },
    },
    MuiPaper: {
      sx: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 8 } },
      sx: { root: { borderColor: 'divider' } },
    },
    MuiCardHeader: {
      sx: { root: { borderBottom: 1, borderColor: 'divider', minHeight: 56 }, title: { fontWeight: 'semiBold' } },
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
      defaultProps: { size: 'small', variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 4, height: 22, fontSize: '0.75rem' } },
      variants: [
        { props: { variant: 'outlined', color: 'default' }, sx: { bgcolor: 'surface.main', borderColor: 'divider' } },
      ],
    },
    MuiTabs: {
      sx: { root: { borderBottom: 1, borderColor: 'divider', minHeight: 46 } },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 400, fontSize: '0.875rem', minHeight: 46, minWidth: 0, padding: '12px 0', marginRight: 32 },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: { width: 44, height: 22, padding: 0 },
        switchBase: {
          padding: 2,
          '&.Mui-checked': { transform: 'translateX(22px)' },
          '&.Mui-checked + .MuiSwitch-track': { opacity: 1 },
        },
        thumb: { width: 18, height: 18, boxShadow: THUMB_SHADOW },
        track: { borderRadius: 11, opacity: 1 },
      },
      sx: {
        switchBase: { color: 'common.white', '&.Mui-checked': { color: 'common.white' } },
        track: { bgcolor: 'text.disabled' },
      },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 8, border: '1px solid', padding: '4px 12px' } },
      variants: [
        { props: { severity: 'success', variant: 'standard' }, sx: { borderColor: 'success.main' } },
        { props: { severity: 'info', variant: 'standard' }, sx: { borderColor: 'info.main' } },
        { props: { severity: 'warning', variant: 'standard' }, sx: { borderColor: 'warning.main' } },
        { props: { severity: 'error', variant: 'standard' }, sx: { borderColor: 'error.main' } },
      ],
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: { tooltip: { borderRadius: 6, fontSize: '0.875rem', padding: '6px 8px' } },
      sx: { tooltip: { bgcolor: 'grey.900' }, arrow: { color: 'grey.900' } },
    },
    MuiMenu: {
      styleOverrides: { paper: { borderRadius: 8, boxShadow: POPUP_SHADOW }, list: { padding: 4 } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { borderRadius: 4, minHeight: 32, fontSize: '0.875rem' } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 8, boxShadow: POPUP_SHADOW } },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0 },
      sx: {
        root: {
          border: 1,
          borderColor: 'divider',
          '&::before': { display: 'none' },
          '&:not(:last-of-type)': { borderBottom: 0 },
          '&:first-of-type': { borderTopLeftRadius: 8, borderTopRightRadius: 8 },
          '&:last-of-type': { borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
        },
      },
    },
    MuiAccordionSummary: {
      sx: { root: { bgcolor: 'surface.main' } },
    },
    MuiTableCell: {
      sx: { root: { borderColor: 'divider' }, head: { bgcolor: 'surface.main', fontWeight: 'semiBold' } },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 8, borderRadius: 100 }, bar: { borderRadius: 100 } },
      sx: { root: { bgcolor: 'action.hover' } },
    },
    MuiLink: { defaultProps: { underline: 'none' } },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none', padding: '4px 15px' } },
    },
  },
}
