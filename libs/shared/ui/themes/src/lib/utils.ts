/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { createMuiTheme, responsiveFontSizes, Theme, ThemeOptions } from '@material-ui/core/styles'
import './overrides'

/**
 * START EXAMPLE – OVERRIDE DEFAULT PROPS ↓
 * ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
 * ```typescript
 * const theme = createMuiTheme({
 *   props: {
 *     // Name of the component ⚛️
 *     MuiButtonBase: {
 *       // The default props to change
 *       disableRipple: true, // No more ripple, on the whole application 💣!
 *     },
 *   },
 * })
 * ```
 * ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 * END EXAMPLE – OVERRIDE DEFAULT PROPS ↑
 *
 * START EXAMPLE – OVERRIDE DEFAULT STYLES ↓
 * ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
 * ```typescript
 * const theme = createMuiTheme({
 *   overrides: {
 *     // Style sheet name ⚛️
 *     MuiButton: {
 *       // Name of the rule
 *       text: {
 *         // Some CSS
 *         color: 'white',
 *       },
 *     },
 *     MuiCssBaseline: {
 *       '@global': {
 *         html: {
 *           WebkitFontSmoothing: 'auto',
 *         },
 *       },
 *     },
 *   },
 * })
 * ```
 * ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 * END EXAMPLE – OVERRIDE DEFAULT STYLES ↑
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
