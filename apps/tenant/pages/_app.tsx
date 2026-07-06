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

import type * as Aglyn from '@aglyn/aglyn'
import { APP_CONSOLE, IS_PRODUCTION } from '@aglyn/shared-data-enums'
import { _AppComponent, type _AppProps } from '@aglyn/shared-ui-next'
import {
  consoleThemeDark,
  consoleThemeLight,
  getGoogleFontsUrl,
  HostThemeDocumentContext,
  HostThemeProvider,
} from '@aglyn/shared-ui-theme'
import { Fragment } from 'react'

// enableStaticRendering(true)
const MainComponent = ({ children }: { children?: JSX.Children }) => {
  return (
    <HostThemeProvider fallback={[consoleThemeLight, consoleThemeDark]}>
      {children}
    </HostThemeProvider>
  )
}

function _App<Props, Initial>(props: _AppProps<Props, Initial>) {
  const { headChildren, ...rest } = props
  const host = (rest.pageProps as { data?: { host?: Aglyn.AglynHost } })?.data
    ?.host
  const hostTheme = host?.theme
  const fontsHref = getGoogleFontsUrl(hostTheme?.fonts)

  return (
    <HostThemeDocumentContext.Provider value={hostTheme}>
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
            {fontsHref ? (
              <Fragment>
                <link
                  key="host-fonts-preconnect"
                  rel="preconnect"
                  href="https://fonts.gstatic.com"
                  crossOrigin="anonymous"
                />
                <link key="host-fonts" rel="stylesheet" href={fontsHref} />
              </Fragment>
            ) : null}
            {headChildren}
          </Fragment>
        }
        {...rest}
      />
    </HostThemeDocumentContext.Provider>
  )
}
_App.displayName = '_App'
export default _App
