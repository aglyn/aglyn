/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {APP_CONSOLE, IS_PRODUCTION} from '@aglyn/shared-data-enums'
import {ConfirmationProviderComponent, LoadingLayoutComponent} from '@aglyn/shared-ui-jsx'
import {_AppComponent, type _AppProps} from '@aglyn/shared-ui-next'
import {SnackbarProvider} from '@aglyn/shared-ui-snackstack'
import {consoleThemeDark, consoleThemeLight, createWithThemeProvider} from '@aglyn/shared-ui-theme'
import {Fragment} from 'react'
import './styles.css'


const withThemeProvider = createWithThemeProvider({
  theme: [consoleThemeLight, consoleThemeDark],
})

const MainComponent = withThemeProvider((props: any) => {
  const { children } = props

  return (
    <LoadingLayoutComponent>
      <ConfirmationProviderComponent>
        <SnackbarProvider>
          {children}
        </SnackbarProvider>
      </ConfirmationProviderComponent>
    </LoadingLayoutComponent>
  )
})

export interface _Props<Props, InitialProps> extends _AppProps<Props, InitialProps> {}

function _App<Props, InitialProps>(props: _Props<Props, InitialProps>) {
  const { headChildren, ...rest } = props

  return (
    <_AppComponent
      MainComponent={MainComponent}
      metaElements={[
        ['viewport', 'width=device-width, initial-scale=1'],
        ['description', APP_CONSOLE.DESCRIPTION],
      ]}
      headChildren={
        <Fragment>
          {!IS_PRODUCTION ? null : <Fragment></Fragment>}
          {headChildren}
        </Fragment>
      }
      {...rest}
    />
  )
}
_App.displayName = '_App'
export default _App
