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

import { _isArr } from '@aglyn/shared-util-guards'
import { getDisplayName } from '@aglyn/shared-util-tools'
import CssBaseline from '@mui/material/CssBaseline'
import { ComponentType, memo } from 'react'
import { Theme, ThemeProvider } from '../../vendor/mui'


export type WithThemeOptions = {
  theme: Theme | [lightTheme: Theme, darkTheme: Theme]
  disableCssBaseline?: boolean
}

function withTheme(options: WithThemeOptions) {
  const {theme, disableCssBaseline} = {...options}
  const [lightTheme, darkTheme] = _isArr(theme) ? theme : [theme]

  return function WithTheme<P>(Component: ComponentType<P>) {
    const displayName = `WithTheme(${getDisplayName(Component)})`

    function WithTheme(props: P & { themeType?: 'light' | 'dark' }) {
      const {themeType, ...rest} = props
      const activeTheme = themeType === 'dark' ? darkTheme : lightTheme
      return (
        <ThemeProvider theme={activeTheme}>
          {!disableCssBaseline ? <CssBaseline /> : null}
          <Component {...rest as P} />
        </ThemeProvider>
      )
    }
    WithTheme.displayName = displayName
    return memo(WithTheme)
  }
}
export { withTheme }
export default withTheme
