/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { Theme, ThemeOptions } from '@material-ui/core/styles'
import { createTheme } from './utils'
import './overrides'

/**
 * Console Theme
 */
export namespace ConsoleTheme {
  export const palette: ThemeOptions['palette'] = {
    type: 'light',
    primary: { main: '#404c5c' },
    secondary: { main: '#039be5' },
    tertiary: { main: '#9c27b0' },
    quaternary: { main: '#e040fb' },
    info: { main: '#4dd0e1' },
    warning: { main: '#ffab40' },
    error: { main: '#e53935' },
    success: { main: '#4caf50' },
  }
  export const typography: ThemeOptions['typography'] = {
    fontFamily: '"Raleway", "Helvetica", "Arial", sans-serif',
    fontSize: 14,
    htmlFontSize: 16,
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 700,
    h1: {
      fontSize: '4rem',
      fontWeight: 200,
      lineHeight: 1.167,
      letterSpacing: 'auto',
    },
    h2: {
      fontSize: '3.75rem',
      fontWeight: 300,
      lineHeight: 1.2,
      letterSpacing: 'auto',
    },
    h3: {
      fontSize: '3rem',
      fontWeight: 400,
      lineHeight: 1.167,
      letterSpacing: 'auto',
    },
    h4: {
      fontSize: '2.125rem',
      fontWeight: 400,
      lineHeight: 1.235,
      letterSpacing: 'auto',
    },
    h5: {
      fontSize: '1.5rem',
      fontWeight: 500,
      lineHeight: 1.334,
      letterSpacing: 'auto',
    },
    h6: {
      fontSize: '1.25rem',
      fontWeight: 700,
      lineHeight: 1.6,
      letterSpacing: 'auto',
    },
    subtitle1: {
      fontSize: '1.2rem',
      fontWeight: 400,
      lineHeight: 1.65,
      letterSpacing: 'auto',
    },
    subtitle2: {
      fontSize: '1rem',
      fontWeight: 500,
      lineHeight: 1.57,
      letterSpacing: 'auto',
    },
    body1: {
      fontSize: '1rem',
      fontWeight: 400,
      lineHeight: 1.5,
      letterSpacing: 'auto',
    },
    body2: {
      fontSize: '0.875rem',
      fontWeight: 400,
      lineHeight: 1.43,
      letterSpacing: 'auto',
    },
    button: {
      fontSize: '0.875rem',
      fontWeight: 500,
      lineHeight: 1.75,
      letterSpacing: 'auto',
    },
    caption: {
      fontSize: '0.75rem',
      fontWeight: 400,
      lineHeight: 1.66,
      letterSpacing: 'auto',
    },
    overline: {
      fontSize: '0.75rem',
      fontWeight: 400,
      lineHeight: 2.66,
      letterSpacing: 'auto',
    },
  }
  export const props: ThemeOptions['props'] = {
    MuiIconButton: {
      // color: 'inherit', // Default color to inherit
    },
  }
  export const overrides: ThemeOptions['overrides'] = {
    MuiAvatar: {
      root: {
        width: 32,
        height: 32,
      },
    },
    MuiIconButton: { root: { padding: 8 } },
  }
  export const options: ThemeOptions = {
    palette: ConsoleTheme.palette,
    typography: ConsoleTheme.typography,
    props: ConsoleTheme.props,
    overrides: ConsoleTheme.overrides,
  }
  export const theme: Theme = createTheme(options)
}

export default ConsoleTheme.theme
