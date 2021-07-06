/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import CssBaseline from '@material-ui/core/CssBaseline'
import { MuiThemeProvider } from '@material-ui/core/styles'
import { console } from '@aglyn/shared/ui/themes'
import React, { Fragment, StrictMode, useEffect } from 'react'
import { AppProps } from 'next/app'
import Head from 'next/head'
import { APP } from '../../www/const'
import Website from '@aglyn/website/core'


Website.App.init()


const previewProduction = false
const isProduction = process.env.NODE_ENV === 'production' || previewProduction

function _App(props: AppProps) {
  const {Component, pageProps} = props

  useEffect(() => {
    // Remove the server-side injected CSS.
    const jssStyles = document.querySelector('#jss-server-side')
    if (jssStyles) {
      jssStyles.parentElement.removeChild(jssStyles)
    }
  }, [])

  const Wrapper = isProduction ? Fragment : Fragment// StrictMode

  return (
    <Wrapper>
      <Head>
        <title children={APP.META_TITLE} />
        <meta name="description" content={APP.META_DESCRIPTION} />
      </Head>
      <MuiThemeProvider theme={console}>
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

export default _App
