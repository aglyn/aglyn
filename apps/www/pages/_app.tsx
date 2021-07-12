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

import CssBaseline from '@material-ui/core/CssBaseline'
import { MuiThemeProvider } from '@material-ui/core/styles'
import { console } from '@aglyn/shared/ui/themes'
import { Fragment, useEffect } from 'react'
import type { AppProps } from 'next/app'
import Head from 'next/head'
import { AppLoaderProviderComponent } from '../contexts/app-loader-context'
import AppLoaderOverlayView from '../views/AppLoaderOverlayView'
import { AppContextProvider } from '../contexts/app-context'
import { CurrentUserProviderComponent } from '../contexts/current-user-context'
import { APP } from '../const'


declare function require(
  moduleNames: string[],
  onLoad: (...args: any[]) => void,
): void
import * as AppController from '../lib/aglyn-deprecated'


const previewProduction = false
const isProduction = process.env.NODE_ENV === 'production' || previewProduction
const appOptions = {
  ...(isProduction
    ? {}
    : {
      authEmulator: 'http://localhost:9099/',
      firestoreEmulator: {host: 'localhost', port: 8080},
    }),
}

let app
if (typeof window !== 'undefined') {
  require(['../lib/aglyn-deprecated'], (withAppController: typeof AppController) => {
    app = withAppController.withAppController(appOptions)
  })
}

/**
 *
 * App component manages mounting and hydration for the client app
 * at the Next.JS app entry point, removes server styles and is
 * responsible for rendering every page Component
 *
 * @example
 * > ## Resolution order
 * >
 * > ### Server-side
 * > 1. [_App]{@link _App}.getInitialProps (if-exists)
 * > 2. <PageComponent>.getInitialProps
 * > 3. [_Document]{@link _Document}.getInitialProps
 * > 4. [_App]{@link _App}.render
 * > 5. <PageComponent>.render
 * > 6. [_Document]{@link _Document}.render
 * >
 * > ### Server-side (w/ error)
 * > 1. [_Document]{@link _Document}.getInitialProps
 * > 2. [_App]{@link _App}.render
 * > 3. <PageComponent>.render
 * > 4. [_Document]{@link _Document}.render
 * >
 * > ### Client-side
 * > 1. [_App]{@link _App}.getInitialProps (if-exists)
 * > 2. <PageComponent>.getInitialProps
 * > 3. [_App]{@link _App}.render
 * > 4. <PageComponent>.render
 *
 * @param {AppProps} props
 * @returns {JSX.Element}
 */
function _App(props: AppProps): JSX.Element {
  const {Component, pageProps} = props

  useEffect(() => {
    // Remove the server-side injected CSS.
    const jssStyles = document.querySelector('#jss-server-side')
    if (jssStyles) jssStyles.parentElement.removeChild(jssStyles)
  }, [])

  useEffect(() => {
    if (isProduction) {
      app.getAnalytics()
    }
  }, [])

  const Wrapper = isProduction ? Fragment : Fragment// StrictMode

  return (
    <>
      <Head>
        <title children={APP.META_TITLE} />
        <meta name="description" content={APP.META_DESCRIPTION} />
      </Head>
      <Wrapper>
        <AppContextProvider value={app}>
          <CurrentUserProviderComponent>
            <MuiThemeProvider theme={console}>
              <CssBaseline>
                <AppLoaderProviderComponent>
                  <div className="app">
                    <main>
                      <Component {...pageProps} />
                    </main>
                  </div>
                  <AppLoaderOverlayView />
                </AppLoaderProviderComponent>
              </CssBaseline>
            </MuiThemeProvider>
          </CurrentUserProviderComponent>
        </AppContextProvider>
      </Wrapper>
    </>
  )
}
_App.displayName = '_App'
export default _App
