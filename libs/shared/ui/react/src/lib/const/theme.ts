/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { map } from '@aglyn/shared/util/helpers'
import type { Color } from '@material-ui/core'
import { cyan, lightBlue, lime, orange, red, purple } from '@material-ui/core/colors'
import { createMuiTheme, responsiveFontSizes, Theme, ThemeOptions } from '@material-ui/core/styles'
import type { CSSProperties } from 'react'

// START EXAMPLE – MODULE AUGMENTATION ↓
// ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
// // Add new property ↓
// declare module '@material-ui/core/styles/createMuiTheme' {
//   interface Theme {
//     status: {
//       danger: React.CSSProperties['color'],
//     }
//   }
//   interface ThemeOptions {
//     status: {
//       danger: React.CSSProperties['color']
//     }
//   }
// }
// const theme = createMuiTheme({
//   status: {
//     danger: '#e53e3e',
//   },
// })
//
// // Add to existing property (e.g. palette, typography) ↓
// declare module "@material-ui/core/styles/createPalette" {
//   interface Palette {
//     neutral: Palette['primary']
//   }
//   interface PaletteOptions {
//     neutral: PaletteOptions['primary']
//   }
// }
// const theme = createMuiTheme({
//   palette: {
//     neutral: {
//       main: '#5c6ac4',
//     },
//   },
// })
// ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// END EXAMPLE – MODULE AUGMENTATION ↑

// START EXAMPLE – OVERRIDE DEFAULT PROPS ↓
// ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
// const theme = createMuiTheme({
//   props: {
//     // Name of the component ⚛️
//     MuiButtonBase: {
//       // The default props to change
//       disableRipple: true, // No more ripple, on the whole application 💣!
//     },
//   },
// })
// ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// END EXAMPLE – OVERRIDE DEFAULT PROPS ↑

// START EXAMPLE – OVERRIDE DEFAULT STYLES ↓
// ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
// const theme = createMuiTheme({
//   overrides: {
//     // Style sheet name ⚛️
//     MuiButton: {
//       // Name of the rule
//       text: {
//         // Some CSS
//         color: 'white',
//       },
//     },
//     MuiCssBaseline: {
//       '@global': {
//         html: {
//           WebkitFontSmoothing: 'auto',
//         },
//       },
//     },
//   },
// })
// ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// END EXAMPLE – OVERRIDE DEFAULT STYLES ↑

declare module '@material-ui/core/styles/createPalette' {
  interface Palette {
    tertiary: Palette['primary']
    quaternary: Palette['primary']
    brand: {
      primary: CSSProperties['color']
      secondary: CSSProperties['color']
      purple: Color
      coral: CSSProperties['color']
      green: CSSProperties['color']
      orange: CSSProperties['color']
    }
  }

  interface PaletteOptions {
    tertiary: PaletteOptions['primary']
    quaternary: PaletteOptions['primary']
    brand: {
      primary: CSSProperties['color']
      secondary: CSSProperties['color']
      purple: Color
      coral: CSSProperties['color']
      green: CSSProperties['color']
      orange: CSSProperties['color']
    }
  }
}

/**
 * Console Theme
 */
const consoleOptions: ThemeOptions = {
  palette: {
    type: 'light',
    primary: { main: '#404c5c' },
    secondary: { main: lightBlue['600'] /* '#039be5' */ },
    tertiary: { main: purple['500'] /* '#9c27b0' */ },
    quaternary: { main: purple.A200 /* '#e040fb' */ },
    brand: {
      primary: purple['500'],
      secondary: lightBlue['500'],
      purple: purple,
      coral: '#ef464f',
      green: '#00c853',
      orange: '#f2ab5d',
    },
    info: { main: cyan['300'] },
    warning: { main: orange.A200 },
    error: { main: red['600'] },
  },
  props: {
    MuiIconButton: {
      // color: 'inherit', // Default color to inherit
    },
  },
  overrides: {
    MuiAvatar: {
      root: {
        width: 32,
        height: 32,
      },
    },
    MuiIconButton: { root: { padding: 8 } },
  },
}

/**
 * Builder Theme
 */
const builderOptions: ThemeOptions = {
  ...consoleOptions,
  palette: {
    ...consoleOptions.palette,
    primary: { main: lightBlue['A700'] } /* #0091EA */,
    secondary: { main: purple['A200'] } /* #E040FB */,
    tertiary: { main: '#37474F' },
  },
}

/**
 *
 * @param {ThemeOptions} options
 * @returns {Theme}
 */
export function createTheme(options?: ThemeOptions): Theme {
  const theme = createMuiTheme(options)
  theme.palette.tertiary = theme.palette.augmentColor(theme.palette.tertiary)
  theme.palette.quaternary = theme.palette.augmentColor(theme.palette.quaternary)
  return responsiveFontSizes(theme, {
    // Override to include `xs` and `xl` - default: ['sm', 'md', 'lg']
    breakpoints: ['xs', 'sm', 'md', 'lg', 'xl'],
  })
}

export const options = {
  console: consoleOptions,
  builder: builderOptions,
}

export const themes = map(options, (value) => createTheme(value))
