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

/** Tailwind's tight tracking, which every heading in this style carries. */
const TIGHT = '-0.025em'

/** The soft, one-step shadow a card and a raised tab carry, and nothing heavier. */
const SHADOW_SM = '0 1px 2px 0 rgb(0 0 0 / 0.05)'
const SHADOW_MD = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'

/**
 * Minimal (AGL-3405): the neutral look of shadcn/ui on Tailwind's zinc scale
 * — near-black primary (near-white in dark), Inter with tight headings,
 * hairline borders instead of elevation, segmented tabs, pill switches and a
 * restrained focus ring.
 *
 * The app bar, text buttons and outlined buttons in the PRIMARY color take
 * the page's own surface and text instead of a filled accent, which is what
 * makes the style read as quiet; any other color a page asks for keeps its
 * fill.
 */
export const MINIMAL_THEME: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#18181b', dark: '#18181b', contrastText: '#fafafa' },
      secondary: { main: '#52525b', dark: '#3f3f46', contrastText: '#fafafa' },
      tertiary: { main: '#71717a', dark: '#52525b', contrastText: '#ffffff' },
      surface: { main: '#f4f4f5', contrastText: '#18181b' },
      error: { main: '#dc2626', dark: '#b91c1c', contrastText: '#ffffff' },
      warning: { main: '#f59e0b', dark: '#b45309', contrastText: '#09090b' },
      info: { main: '#2563eb', dark: '#1d4ed8', contrastText: '#ffffff' },
      success: { main: '#16a34a', dark: '#15803d', contrastText: '#ffffff' },
      background: {
        default: '#ffffff',
        paper: '#ffffff',
      },
      text: { primary: '#09090b', secondary: '#71717a', disabled: '#a1a1aa' },
      tint: { primary: '#f4f4f5', secondary: '#f4f4f5', tertiary: '#fafafa' },
      divider: '#e4e4e7',
    },
    dark: {
      primary: { main: '#fafafa', dark: '#fafafa', contrastText: '#18181b' },
      secondary: { main: '#a1a1aa', dark: '#d4d4d8', contrastText: '#09090b' },
      tertiary: { main: '#a1a1aa', dark: '#d4d4d8', contrastText: '#09090b' },
      surface: { main: '#27272a', contrastText: '#fafafa' },
      error: { main: '#ef4444', dark: '#f87171', contrastText: '#09090b' },
      warning: { main: '#f59e0b', dark: '#fbbf24', contrastText: '#09090b' },
      info: { main: '#3b82f6', dark: '#60a5fa', contrastText: '#09090b' },
      success: { main: '#22c55e', dark: '#4ade80', contrastText: '#09090b' },
      background: {
        default: '#09090b',
        paper: '#09090b',
      },
      text: { primary: '#fafafa', secondary: '#a1a1aa', disabled: '#52525b' },
      tint: { primary: '#27272a', secondary: '#27272a', tertiary: '#18181b' },
      divider: '#27272a',
    },
  },
  fonts: [{ family: 'Inter', weights: [400, 500, 600, 700, 800], source: 'google' }],
  typography: {
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
    variants: {
      displayXl: { fontSize: '3.75rem', fontWeight: 800, lineHeight: 1, letterSpacing: TIGHT },
      h1: { fontSize: '2.25rem', fontWeight: 800, lineHeight: 1.1, letterSpacing: TIGHT },
      h2: { fontSize: '1.875rem', fontWeight: 600, lineHeight: 1.2, letterSpacing: TIGHT },
      h3: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3, letterSpacing: TIGHT },
      h4: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.4, letterSpacing: TIGHT },
      h5: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
      h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 },
      body1: { fontSize: '1rem', lineHeight: 1.75 },
      body2: { fontSize: '0.875rem', lineHeight: 1.5 },
      button: { fontSize: '0.875rem', fontWeight: 500, textTransform: 'none' },
      overline: { fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.05em' },
      // shadcn's `lead`, `text-sm` and `text-xs`.
      lede: { fontSize: '1.25rem', fontWeight: 400, lineHeight: 1.75 },
      bodyCompact: { fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.5 },
      micro: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.33 },
    },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 6, padding: '8px 16px', boxShadow: 'none' },
        sizeSmall: { padding: '6px 12px' },
        sizeLarge: { padding: '10px 32px' },
      },
      sx: {
        root: {
          '&.Mui-focusVisible': {
            outline: '2px solid',
            outlineColor: 'text.secondary',
            outlineOffset: '2px',
          },
        },
      },
      variants: [
        {
          props: { variant: 'outlined', color: 'primary' },
          sx: {
            borderColor: 'divider',
            color: 'text.primary',
            '&:hover': { bgcolor: 'surface.main', borderColor: 'divider' },
          },
        },
        {
          props: { variant: 'text', color: 'primary' },
          sx: { color: 'text.primary', '&:hover': { bgcolor: 'surface.main' } },
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
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'text.disabled' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: 'text.secondary',
            borderWidth: 1,
          },
        },
      },
    },
    MuiInputLabel: {
      sx: { root: { '&.Mui-focused': { color: 'text.primary' } } },
    },
    MuiPaper: {
      sx: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 12, boxShadow: SHADOW_SM } },
      sx: { root: { borderColor: 'divider' } },
    },
    MuiMenu: {
      styleOverrides: { paper: { boxShadow: SHADOW_MD, borderRadius: 6 } },
      sx: { paper: { border: 1, borderColor: 'divider' } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { borderRadius: 4, margin: '0 4px', fontSize: '0.875rem' } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 12, boxShadow: SHADOW_MD } },
      sx: { paper: { border: 1, borderColor: 'divider' } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      variants: [
        {
          props: { color: 'primary' },
          sx: {
            bgcolor: 'background.paper',
            color: 'text.primary',
            borderBottom: 1,
            borderColor: 'divider',
          },
        },
      ],
    },
    MuiChip: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { borderRadius: 6, fontWeight: 600, fontSize: '0.75rem' } },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 0, padding: 4, borderRadius: 8, display: 'inline-flex' },
        indicator: { display: 'none' },
      },
      sx: { root: { bgcolor: 'surface.main' } },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          minHeight: 0,
          padding: '6px 12px',
          borderRadius: 6,
          fontWeight: 500,
          fontSize: '0.875rem',
        },
      },
      sx: {
        root: {
          color: 'text.secondary',
          '&.Mui-selected': {
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: SHADOW_SM,
          },
        },
      },
    },
    MuiAlert: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 8 } },
      sx: { root: { bgcolor: 'background.paper', color: 'text.primary' } },
    },
    MuiTooltip: {
      defaultProps: { arrow: false },
      styleOverrides: {
        tooltip: { fontSize: '0.75rem', borderRadius: 6, padding: '6px 12px' },
      },
      sx: { tooltip: { bgcolor: 'text.primary', color: 'background.paper' } },
    },
    MuiSwitch: {
      styleOverrides: {
        root: { width: 44, height: 24, padding: 0 },
        switchBase: {
          padding: 2,
          '&.Mui-checked': { transform: 'translateX(20px)' },
          '&.Mui-checked + .MuiSwitch-track': { opacity: 1 },
        },
        thumb: { width: 20, height: 20, boxShadow: 'none' },
        track: { borderRadius: 12, opacity: 1 },
      },
      sx: {
        switchBase: {
          color: 'background.paper',
          '&.Mui-checked': { color: 'background.paper' },
          '&.Mui-checked + .MuiSwitch-track': { bgcolor: 'primary.main' },
        },
        track: { bgcolor: 'divider' },
      },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0, square: true },
      sx: {
        root: {
          bgcolor: 'transparent',
          borderBottom: 1,
          borderColor: 'divider',
          '&::before': { display: 'none' },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 8, borderRadius: 999 }, bar: { borderRadius: 999 } },
      sx: { root: { bgcolor: 'surface.main' } },
    },
    MuiLink: {
      defaultProps: { underline: 'always' },
      variants: [
        {
          props: { color: 'primary' },
          sx: { color: 'text.primary', fontWeight: 500, textUnderlineOffset: '4px' },
        },
      ],
    },
    MuiTableCell: {
      sx: { root: { borderColor: 'divider' }, head: { color: 'text.secondary', fontWeight: 500 } },
    },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none', borderRadius: 6 } },
    },
  },
}
