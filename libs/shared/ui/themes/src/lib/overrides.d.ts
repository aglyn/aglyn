/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

/** START EXAMPLE – MODULE AUGMENTATION ↓
 * ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
 * ```typescript
 * // Add new property ↓
 * declare module '@material-ui/core/styles/createMuiTheme' {
 *   interface Theme {
 *     status: {
 *       danger: React.CSSProperties['color'],
 *     }
 *   }
 *   interface ThemeOptions {
 *     status: {
 *       danger: React.CSSProperties['color']
 *     }
 *   }
 * }
 * const theme = createMuiTheme({
 *   status: {
 *     danger: '#e53e3e',
 *   },
 * })
 *
 * // Add to existing property (e.g., palette, typography) ↓
 * declare module "@material-ui/core/styles/createPalette" {
 *   interface Palette {
 *     neutral: Palette['primary']
 *   }
 *   interface PaletteOptions {
 *     neutral: PaletteOptions['primary']
 *   }
 * }
 * const theme = createMuiTheme({
 *   palette: {
 *     neutral: {
 *       main: '#5c6ac4',
 *     },
 *   },
 * })
 * ```
 * ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 * END EXAMPLE – MODULE AUGMENTATION ↑
 */
export declare module '@material-ui/core/styles/createPalette' {
  interface Palette {
    tertiary: Palette['primary']
    quaternary: Palette['primary']
  }

  interface PaletteOptions {
    tertiary: PaletteOptions['primary']
    quaternary: PaletteOptions['primary']
  }
}
