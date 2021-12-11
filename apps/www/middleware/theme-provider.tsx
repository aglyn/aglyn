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

import {
  Theme,
  ThemeProvider as MuiThemeProvider,
  ThemeProviderProps as MuiThemeProviderProps,
} from '@aglyn/shared-feature-themes'
import React from 'react'
import { NextAppMiddleware } from '../lib/next-app'

/**
 * Next app middleware for material-ui theme provider component
 *
 * Theme provider middleware component, automatically
 * removes the SSR style document node (e.g.#jss - server - side)
 *
 * @template T
 * @param {Props} props
 * @returns {ThemeProviderElement<T>}
 */
export function ThemeProviderComponent<T>(props: Props): ThemeProviderElement<T> {
  const { theme, children, selector, ...rest } = props

  React.useEffect(() => {
    function removeSsrStyles() {
      // Remove the server-side injected CSS from the client side to
      // avoid client and server style rule conflicts
      const jssStyles = document.querySelector(selector)
      if (jssStyles) {
        jssStyles.parentElement.removeChild(jssStyles)
      }
    }
    removeSsrStyles()
  }, [selector])

  return (
    <MuiThemeProvider theme={theme} {...rest}>
      {children}
    </MuiThemeProvider>
  )
}
ThemeProviderComponent.defaultProps = {
  selector: '#jss-server-side',
}
ThemeProviderComponent.displayName = 'ThemeProviderComponent'

export type Props = MuiThemeProviderProps & { selector?: string }
export type ThemeProviderElement<T> = React.ReactElement<MuiThemeProviderProps<T>>
export type ThemeProviderMiddleware<T = Theme, P = Props> = (theme: T) => NextAppMiddleware<P>

export const themeProvider: ThemeProviderMiddleware<any, any> = (theme) => ({
  name: 'themeProviderSsr',
  Component: (props) => <ThemeProviderComponent {...props} theme={theme} />,
})
