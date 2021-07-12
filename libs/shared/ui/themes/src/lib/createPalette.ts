/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { Palette, PaletteOptions } from '@material-ui/core/styles/createPalette'


declare module '@material-ui/core/styles/createPalette' {
  interface Palette {
    tertiary: Palette['primary']
    quaternary: Palette['primary']
  }

  interface PaletteOptions {
    tertiary: PaletteOptions['primary']
    quaternary: PaletteOptions['primary']
  }
}

export {}

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
