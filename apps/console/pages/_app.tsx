/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'
import { AppProps } from 'next/app'
import Head from 'next/head'
import { ReactComponent as NxLogo } from '../public/nx-logo-white.svg'
import './styles.css'
import Website from '@aglyn/website/core'

Website.App.init()

function CustomApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Welcome to console!</title>
      </Head>
      <div className="app">
        <header className="flex">
          <NxLogo width="75" height="50" />
          <h1>Welcome to console!</h1>
        </header>
        <main>
          <Component {...pageProps} />
        </main>
      </div>
    </>
  )
}

export default CustomApp
