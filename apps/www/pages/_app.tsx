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

import {IS_PRODUCTION} from '@aglyn/shared-data-brand'
import {CacheProvider, createEmotionCache, EmotionCache} from '@aglyn/shared-feature-themes'
import {AppProps as NextAppProps} from 'next/app'
import AppWrapper from '../components/app-wrapper'
import {withAppController} from '../lib/aglyn-deprecated/lib/controllers/app-controller'


const previewProduction = true
const appOptions = IS_PRODUCTION || previewProduction ? {} : {
  authEmulator: 'http://localhost:9099/',
  firestoreEmulator: {host: 'localhost', port: 8080},
}

let app

if (!app) {
  app = withAppController(appOptions)
}
// console.log('app', app)

// Client-side cache, shared for the whole session of the user in the browser.
const clientSideEmotionCache = createEmotionCache()

interface _AppProps extends NextAppProps {
  emotionCache?: EmotionCache
}

/**
 *
 * App component manages mounting and hydration for the client app
 * at the Next.JS app entry point, removes server styles and is
 * responsible for rendering every page Component
 *
 * @example
 *  ## Resolution order
 *
 *  ### Server-side
 *  1. [_App]{@link _App}.getInitialProps (if-exists)
 *  2. <PageComponent>.getInitialProps
 *  3. [_Document]{@link _Document}.getInitialProps
 *  4. [_App]{@link _App}.render
 *  5. <PageComponent>.render
 *  6. [_Document]{@link _Document}.render
 *
 *  ### Server-side (w/ error)
 *  1. [_Document]{@link _Document}.getInitialProps
 *  2. [_App]{@link _App}.render
 *  3. <PageComponent>.render
 *  4. [_Document]{@link _Document}.render
 *
 *  ### Client-side
 *  1. [_App]{@link _App}.getInitialProps (if-exists)
 *  2. <PageComponent>.getInitialProps
 *  3. [_App]{@link _App}.render
 *  4. <PageComponent>.render
 *
 * @param props - the _AppProps
 * @returns JSX.Element
 */
export default function _App(props: _AppProps) {
  const {Component, emotionCache = clientSideEmotionCache, pageProps} = props
  return (
    <CacheProvider value={emotionCache}>
      <AppWrapper app={app}>
        <Component {...pageProps} />
      </AppWrapper>
    </CacheProvider>
  )
}
