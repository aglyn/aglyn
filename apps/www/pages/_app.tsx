/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { CssBaseline } from '@material-ui/core'
import { MuiThemeProvider } from '@material-ui/core/styles'
import { themes } from '@aglyn/shared/ui/react'
import React, { Fragment, StrictMode, useEffect } from 'react'
import { AppProps } from 'next/app'
import Head from 'next/head'
import { AppLoaderProviderComponent } from '../contexts/app-loader-context'
import { useOnRouteChangeComplete } from '../hooks/router-events'
import { withAppController } from '../lib/aglyn-deprecated'
import AppLoaderOverlayView from '../views/AppLoaderOverlayView'
import { AppContextProvider } from '../contexts/app-context'
import { CurrentUserProviderComponent } from '../contexts/current-user-context'
import { MetaElementsConfig } from './_document'


const previewProduction = false
const isProduction = process.env.NODE_ENV === 'production' || previewProduction
const appOptions = {
  ...(isProduction
    ? {}
    : {
      authEmulator: 'http://localhost:9099/',
      firestoreEmulator: { host: 'localhost', port: 8080 },
    }),
}
const app = withAppController(appOptions)

const metaElements: MetaElementsConfig = [
  ['viewport', 'width=device-width,initial-scale=1'],
]


function _App(props: AppProps) {
  const { Component, pageProps } = props

  useEffect(() => {
    // Remove the server-side injected CSS.
    const jssStyles = document.querySelector('#jss-server-side')
    if (jssStyles) {
      jssStyles.parentElement.removeChild(jssStyles)
    }
  }, [])

  useEffect(() => {
    if (isProduction) {
      app.getAnalytics()
    }
  }, [])

  useOnRouteChangeComplete(() => {
    if (isProduction) {
      app.getAnalytics().logEvent('page_view')
    }
  })

  const Wrapper = isProduction ? Fragment : Fragment// StrictMode

  return (
    <Wrapper>
      <AppContextProvider value={app}>
        <CurrentUserProviderComponent>
          <Head>
            <title>Aglyn</title>
            <link rel="shortcut icon" href="/favicon.ico" />
            <link rel="manifest" href="/manifest.json" />
            <meta
              name="description"
              content="Contributions to the “no code” web application market by optimizing the process and necessary steps for a website to get off the ground for organizations"
            />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          </Head>
          <MuiThemeProvider theme={themes.console}>
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
  )
}

export default _App
