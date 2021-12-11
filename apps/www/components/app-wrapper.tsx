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

import {APP_WWW, IS_PRODUCTION} from '@aglyn/shared-data-brand'
import {consoleThemeLight, withTheme} from '@aglyn/shared-feature-themes'
import {
  AppLoaderOverlayView,
  AppLoaderProviderComponent,
  makeLinkElements,
  MakeLinkElementsConfig,
  makeMetaElements,
  MakeMetaElementsConfig,
} from '@aglyn/shared-ui-jsx'
import Head from 'next/head'
import {Fragment, ReactNode, useEffect} from 'react'
import {AppContextProvider} from '../contexts/app-context'
import {CurrentUserProviderComponent} from '../contexts/current-user-context'
import {AppController} from '../lib/aglyn-deprecated'
import HsEmbedScript from './hs-embed-script'


const metaElements: MakeMetaElementsConfig = [
  ['viewport', 'width=device-width, initial-scale=1'],
  ['description', APP_WWW.META_DESCRIPTION],
]
const linkElements: MakeLinkElementsConfig = []

export interface AppWrapperProps {
  children: ReactNode
  app?: AppController
}

function AppWrapperRaw(props: AppWrapperProps) {
  const {app, children} = props

  useEffect(() => {
    // Remove the server-side injected CSS.
    // const jssStyles = document.querySelector('#jss-server-side')
    // if (jssStyles) jssStyles.parentElement.removeChild(jssStyles)
  }, [])

  useEffect(() => {
    if (IS_PRODUCTION) {
      app?.getAnalytics()
    }
  }, [app])

  const Wrapper = IS_PRODUCTION ? Fragment : Fragment

  return (
    <Wrapper>
      <Head>
        <title>{APP_WWW.META_TITLE}</title>
        {makeMetaElements(metaElements)}
        {makeLinkElements(linkElements)}
      </Head>
      <div className="app">
        <AppContextProvider value={app}>
          <CurrentUserProviderComponent>
            <AppLoaderProviderComponent>
              <main>{children}</main>
              <AppLoaderOverlayView />
            </AppLoaderProviderComponent>
          </CurrentUserProviderComponent>
        </AppContextProvider>
      </div>
      {IS_PRODUCTION && (<HsEmbedScript />)}
    </Wrapper>
  )
}
AppWrapperRaw.displayName = 'AppWrapper'

const AppWrapper = withTheme({theme: consoleThemeLight})(AppWrapperRaw)
export default AppWrapper
