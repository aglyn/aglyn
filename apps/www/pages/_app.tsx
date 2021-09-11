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
  makeLinkElements,
  MakeLinkElementsConfig,
  makeMetaElements,
  MakeMetaElementsConfig,
} from '@aglyn/shared/ui/react'
import {
  CacheProvider,
  consoleTheme,
  createEmotionCache,
  EmotionCache,
  withTheme,
} from '@aglyn/shared/ui/themes'
import { AppProps as NextAppProps } from 'next/app'
import Head from 'next/head'
import { Fragment, PropsWithChildren, useEffect } from 'react'
import { APP } from '../const'
import { AppContextProvider } from '../contexts/app-context'
import { AppLoaderProviderComponent } from '../contexts/app-loader-context'
import { CurrentUserProviderComponent } from '../contexts/current-user-context'
import * as AppController from '../lib/aglyn-deprecated'
import AppLoaderOverlayView from '../views/AppLoaderOverlayView'


declare function require(moduleNames: string[], onLoad: (...args: any[]) => void): void
const previewProduction = false
const isProduction = process.env.NODE_ENV === 'production' || previewProduction

let app
if (typeof window !== 'undefined') {
  require(['../lib/aglyn-deprecated'], (withAppController: typeof AppController) => {
    const appOptions = {
      ...(isProduction ? {} : {
        authEmulator: 'http://localhost:9099/',
        firestoreEmulator: {host: 'localhost', port: 8080},
      }),
    }
    app = withAppController.withAppController(appOptions)
  })
}

const metaElements: MakeMetaElementsConfig = [
  ['viewport', 'width=device-width, initial-scale=1'],
  ['description', APP.META_DESCRIPTION],
]
const linkElements: MakeLinkElementsConfig = []

function AppWrapperRaw(props) {
  const {children} = props

  useEffect(() => {
    // Remove the server-side injected CSS.
    // const jssStyles = document.querySelector('#jss-server-side')
    // if (jssStyles) jssStyles.parentElement.removeChild(jssStyles)
  }, [])

  useEffect(() => {
    if (isProduction) {
      app.getAnalytics()
    }
  }, [])

  const Wrapper = isProduction ? Fragment : Fragment

  return (
    <Wrapper>
      <Head>
        <title>{APP.META_TITLE}</title>
        {makeMetaElements(metaElements)}
        {makeLinkElements(linkElements)}
      </Head>
      <div className="app">
        <AppContextProvider value={app}>
          <CurrentUserProviderComponent>
            <AppLoaderProviderComponent>
              <main>
                {children}
              </main>

              <AppLoaderOverlayView/>
            </AppLoaderProviderComponent>
          </CurrentUserProviderComponent>
        </AppContextProvider>
      </div>
      {isProduction ? /* HubSpot Embed Code */ (
        <script
          type="text/javascript"
          id="hs-script-loader"
          async
          defer
          src="//js.hs-scripts.com/20566719.js"
        />
      ) : null}

    </Wrapper>
  )
}
AppWrapperRaw.displayName = 'AppWrapper'
const AppWrapper = withTheme({
  theme: consoleTheme,
  cssBaseline: true,
})(AppWrapperRaw)

// Client-side cache, shared for the whole session of the user in the browser.
const clientSideEmotionCache = createEmotionCache()

export interface _AppProps extends NextAppProps {
  emotionCache?: EmotionCache
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
function _App(props: _AppProps) {
  const {Component, emotionCache = clientSideEmotionCache, pageProps} = props

  return (
    <CacheProvider value={emotionCache}>
      <AppWrapper>
        <Component {...pageProps} />
      </AppWrapper>
    </CacheProvider>
  )
}
_App.displayName = '_App'
_App.getInitialProps = async ({ctx, Component}) => {
  let pageProps = {}

  if (Component.getInitialProps) {
    pageProps = await Component.getInitialProps(ctx)
  }

  return {
    pageProps: {
      lang: ctx.query.lang || 'en',
      ...pageProps,
    },
  }
}
export default _App


if (process.browser) {
  console.log(
    `%c
       d8888          888                         888      888       .d8888b.
      d88888          888                         888      888      d88P  Y88b
     d88P888          888                         888      888      888    888
    d88P 888  .d88b.  888 888  888 88888b.        888      888      888
   d88P  888 d88P"88b 888 888  888 888 "88b       888      888      888
  d88P   888 888  888 888 888  888 888  888       888      888      888    888
 d8888888888 Y88b 888 888 Y88b 888 888  888       888      888      Y88b  d88P
d88P     888  "Y88888 888  "Y88888 888  888       88888888 88888888  "Y8888P"
                  888          888
             Y8b d88P     Y8b d88P
              "Y88P"       "Y88P"

                            Copyright (c) 2021 Aglyn LLC. All Rights Reserved.

Hello there, Friend! 👋

For detailed information please visit 'https://aglyn.com' or you may send an
email to 'info@aglyn.com'.
– Aglyn Engineering Team
`,
    'font-family:monospace;color:#E040FB;font-size:12px;',
  )
}
