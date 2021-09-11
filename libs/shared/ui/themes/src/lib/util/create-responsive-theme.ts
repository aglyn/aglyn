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

import { createTheme, responsiveFontSizes, Theme, ThemeOptions } from '../../vendor/mui'


export type CreateResponsiveThemeOptions = {
  themeOptions?: ThemeOptions
  responsiveFontSizesOptions?: any
}

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
export function createResponsiveTheme(options: CreateResponsiveThemeOptions): Theme {
  const {themeOptions, responsiveFontSizesOptions} = options
  let theme = createTheme(themeOptions)

  theme = responsiveFontSizes(theme, {
    // Override to include `xs` and `xl` - default: ['sm', 'md', 'lg']
    breakpoints: ['xs', 'sm', 'md', 'lg', 'xl'],
    ...responsiveFontSizesOptions,
  })

  return theme
}
export default createResponsiveTheme
