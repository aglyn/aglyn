/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { getDisplayName } from '@aglyn/shared-util-tools'
import { hoistNonReactStatics } from '@aglyn/shared-util-vendor'
import { CssBaseline } from '@mui/material'
import {
  Experimental_CssVarsProvider as MuiCssVarsProvider,
  experimental_extendTheme as muiExtendTheme,
} from '@mui/material/styles'
import { forwardRef, useMemo } from 'react'

export interface ThemeCssVarProviderProps
  extends Omit<JSX.ComponentProps<typeof MuiCssVarsProvider>, 'theme'> {
  theme?: Parameters<typeof muiExtendTheme>[0]
}

/**
 * Next app middleware for material-ui theme provider component
 *
 * Theme provider middleware component, automatically
 * removes the SSR style document node (e.g.#jss - server - side)
 *
 * @template T
 * @param {Props} props
 * @returns {IThemeCssVarProvider<T>}
 */
export function ThemeCssVarProvider<T>(props: ThemeCssVarProviderProps) {
  const { theme, children, ...rest } = props

  const _theme = useMemo(() => {
    return muiExtendTheme(theme)
  }, [theme])

  return (
    <MuiCssVarsProvider theme={_theme} defaultMode="system" {...rest}>
      {children}
    </MuiCssVarsProvider>
  )
}
ThemeCssVarProvider.displayName = 'ThemeCssVarProvider'
ThemeCssVarProvider.aglyn = true

export default ThemeCssVarProvider

export function withThemeCssVarProvider<P>(
  WrappedComponent: JSX.ComponentType<P>,
  options?: ThemeCssVarProviderProps & { disableCssBaseline?: boolean },
) {
  const { disableCssBaseline, ...opts } = options || {}

  const WithThemeCssVarProvider = forwardRef<any, P>((props, ref) => {
    const { ...rest } = props
    return (
      <ThemeCssVarProvider {...opts}>
        {disableCssBaseline ? (
          <WrappedComponent ref={ref} {...rest} />
        ) : (
          <CssBaseline enableColorScheme>
            <WrappedComponent ref={ref} {...rest} />
          </CssBaseline>
        )}
      </ThemeCssVarProvider>
    )
  })
  const displayName = getDisplayName(WrappedComponent)
  WithThemeCssVarProvider.displayName = `WithThemeCssVarProvider(${displayName})`
  hoistNonReactStatics(WithThemeCssVarProvider, WrappedComponent)

  return WithThemeCssVarProvider
}
