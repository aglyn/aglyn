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

import { APP_CONSOLE, IS_PRODUCTION } from '@aglyn/shared-data-enums'
import {
  ConfirmationProviderComponent,
  LoadingLayoutComponent,
} from '@aglyn/shared-ui-jsx'
import { _AppComponent, type _AppProps } from '@aglyn/shared-ui-next'
import { SnackbarProvider } from '@aglyn/shared-ui-snackstack'
import {
  consoleThemeDark,
  consoleThemeLight,
  createWithThemeProvider,
  withThemeCssVarProvider,
} from '@aglyn/shared-ui-theme'
import { Fragment } from 'react'
import HostIdProvider from '../components/host-id-provider'
import FirebaseAppLayout from '../components/layouts/firebase-app.layout'
import OsfaTooltip from '../components/osfa-tooltip'
import '../public/_static/styles/styles.css'

// enableStaticRendering(true)
const withThemeProvider = createWithThemeProvider({
  theme: [consoleThemeLight, consoleThemeDark],
})

const MainComponent = withThemeCssVarProvider(
  (props: any) => {
    const { children } = props

    return (
      <FirebaseAppLayout>
        <LoadingLayoutComponent>
          <ConfirmationProviderComponent>
            <SnackbarProvider>
              <HostIdProvider>{children}</HostIdProvider>
            </SnackbarProvider>
            <OsfaTooltip />
          </ConfirmationProviderComponent>
        </LoadingLayoutComponent>
      </FirebaseAppLayout>
    )
  },
  { theme: { light: consoleThemeLight, dark: consoleThemeDark } },
)

export type _Props<Props, InitialProps> = _AppProps<Props, InitialProps>

function _App<Props, InitialProps>(props: _Props<Props, InitialProps>) {
  const { headChildren, ...rest } = props

  return (
    <_AppComponent
      MainComponent={MainComponent}
      meta={[
        {
          key: 'viewport',
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        { key: 'desc', name: 'description', content: APP_CONSOLE.DESCRIPTION },
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
_App.agyln = true
export default _App
