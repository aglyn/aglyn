/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { Theme, ThemeOptions } from '@material-ui/core/styles'
import { createTheme } from './utils'
import { ConsoleTheme } from './console'
import './overrides'

/**
 * Builder Theme
 */
export namespace BuilderTheme {
  export const palette: ThemeOptions['palette'] = {
    ...ConsoleTheme.palette,
    primary: { main: '#0091ea' },
    secondary: { main: '#e040fb' },
    tertiary: { main: '#37474F' },
  }
  export const typography: ThemeOptions['typography'] = {
    ...ConsoleTheme.typography
  }
  export const props: ThemeOptions['props'] = {
    ...ConsoleTheme.props
  }
  export const overrides: ThemeOptions['overrides'] = {
    ...ConsoleTheme.overrides
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
