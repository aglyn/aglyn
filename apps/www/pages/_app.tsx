import React from 'react'
import { AppProps } from 'next/app'
import Head from 'next/head'
import { ReactComponent as NxLogo } from '../public/nx-logo-white.svg'

function CustomApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Aglyn</title>
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="description" content="Contributions to the “no code” web application market by optimizing the process and necessary steps for a website to get off the ground for organizations"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      </Head>
      <div className="app">
        <main>
          <Component {...pageProps} />
        </main>
      </div>
    </>
  )
}

export default CustomApp
