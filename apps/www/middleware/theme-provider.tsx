/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'
import {
  Theme,
  ThemeProvider as MuiThemeProvider,
  ThemeProviderProps as MuiThemeProviderProps
} from '@material-ui/core/styles'
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
      if (jssStyles) { jssStyles.parentElement.removeChild(jssStyles) }
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
  selector: '#jss-server-side'
}
ThemeProviderComponent.displayName = 'ThemeProviderComponent'

export type Props = MuiThemeProviderProps & { selector?: string }
export type ThemeProviderElement<T> = React.ReactElement<MuiThemeProviderProps<T>>
export type ThemeProviderMiddleware<T = Theme, P = Props> = (theme: T) => NextAppMiddleware<P>

export const themeProvider: ThemeProviderMiddleware<any, any> = (theme) => ({
  name: 'themeProviderSsr',
  Component: props => <ThemeProviderComponent {...props} theme={theme} />
})
