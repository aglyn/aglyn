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
import { Fragment, useEffect } from 'react'
import { AppProps } from 'next/app'
import Head from 'next/head'
import { APP } from '../../www/const'
import { AglynExtension, initializeApp } from '@aglyn/framework/sdk'
import { consoleTheme } from '@aglyn/shared/ui/themes'


try {
  initializeApp({
    extensions: {
      [AglynExtension.COMPONENTS]: true
    }
  })
} catch (e) {
  console.error(e, 'initialize aglyn app')
}

const previewProduction = false
const isProduction = process.env.NODE_ENV === 'production' || previewProduction

export default function _App(props: AppProps) {
  const {Component, pageProps} = props

  useEffect(() => {
    // Remove the server-side injected CSS.
    const jssStyles = document.querySelector('#jss-server-side')
    if (jssStyles) {
      jssStyles.parentElement.removeChild(jssStyles)
    }
  }, [])

  const Wrapper = isProduction ? Fragment : Fragment // StrictMode

  return (
    <Wrapper>
      <Head>
        <title>{APP.META_TITLE}</title>
        <meta name="description" content={APP.META_DESCRIPTION} />
      </Head>
      <MuiThemeProvider theme={consoleTheme}>
        <CssBaseline>
          <div className="app">
            <main>
              <Component {...pageProps} />
            </main>
          </div>
        </CssBaseline>
      </MuiThemeProvider>
    </Wrapper>
  )
}
