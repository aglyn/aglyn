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

import { Theme, ThemeOptions } from '@material-ui/core/styles'
import { createTheme } from './utils'
import { ConsoleTheme } from './console'
import './createPalette'


/**
 * Builder Theme
 */
export namespace BuilderTheme {
  export const palette: ThemeOptions['palette'] = {
    ...ConsoleTheme.palette,
    primary: {main: '#0091ea'},
    secondary: {main: '#e040fb'},
    tertiary: {main: '#37474F'},
  }
  export const typography: ThemeOptions['typography'] = {
    ...ConsoleTheme.typography,
  }
  export const props: ThemeOptions['props'] = {
    ...ConsoleTheme.props,
  }
  export const overrides: ThemeOptions['overrides'] = {
    ...ConsoleTheme.overrides,
  }
  export const options: ThemeOptions = {
    palette: palette,
    typography: typography,
    props: props,
    overrides: overrides,
  }
  export const theme: Theme = createTheme(options)
}

export default BuilderTheme.theme
