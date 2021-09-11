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
  createEmotionCache,
  createEmotionServer,
  EmotionCache,
  getConsoleMetaThemeColor,
} from '@aglyn/shared/ui/themes'
import Document from 'next/document'
import NextDocument, {
  DocumentContext,
  DocumentInitialProps,
  Head,
  Html,
  Main,
  NextScript,
} from 'next/document'
import { Children } from 'react'
// import { ServerStyleSheet } from 'styled-components'


const isProduction = Boolean(process.env.NODE_ENV === 'production')
const preconnectElements: MakeLinkElementsConfig = [
  ['preconnect', 'https://www.googletagmanager.com'],
  ['preconnect', 'https://www.google-analytics.com'],
  ['preconnect', 'https://adservice.google.com'],
  ['preconnect', 'https://static.doubleclick.net'],
  ['preconnect', 'https://googleads.g.doubleclick.net'],
  ['preconnect', 'https://fonts.googleapis.com'],
  ['preconnect', 'https://fonts.gstatic.com', {crossOrigin: 'anonymous'}],
]
const metaElements: MakeMetaElementsConfig = [
  [undefined, 'en-us', {httpEquiv: 'content-language'}],
  [undefined, 'IE=edge', {httpEquiv: 'X-UA-Compatible'}],
  ['theme-color', getConsoleMetaThemeColor('light'), {media: '(prefers-color-scheme: light)'}],
  ['theme-color', getConsoleMetaThemeColor('dark'), {media: '(prefers-color-scheme: dark)'}],
]
const linkElements: MakeLinkElementsConfig = [
  ['shortcut icon', '/_static/images/favicons/favicon.ico'],
  ['icon', '/_static/images/favicons/favicon.svg', {type: 'image/svg+xml'}],
  ['alternate icon', '/_static/images/favicons/favicon.png', {type: 'image/png'}],
  ['manifest', '/_static/_pwa/manifest.json'],
  ['stylesheet', 'https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,300;0,400;0,500;0,700;0,900;1,300;1,400;1,500;1,700&display=swap'],
]

export type LangParam = { lang?: string }
export type InitPropsResponse = Promise<DocumentInitialProps & LangParam>

export interface _DocumentProps extends LangParam {}

/**
 * Document component handles the initial `document` markup and
 * renders only on the server side. Commonly used for implementing
 * server side rendering for `css-in-js` libraries.
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
 * @exports
 * @class _Document
 * @extends {NextDocument<P>}
 * @template P
 */
class _Document<P extends _DocumentProps> extends Document<P> {

  static displayName = '_Document'

  /**
   * Returns the context object with the addition of `renderPage`
   *
   * `renderPage` callback inside {DocumentContext} executes `React`
   * rendering logic synchronously to support server-rendering wrappers
   *
   * @param {DocumentContext} ctx
   * @returns {InitPropsResponse}
   */
  static async getInitialProps(ctx: DocumentContext): InitPropsResponse {
    const originalRenderPage = ctx.renderPage
    const cache: EmotionCache = createEmotionCache()
    const {extractCriticalToChunks} = createEmotionServer(cache)

    ctx.renderPage = () =>
      originalRenderPage({
        enhanceApp: (App: any) => (props) => (
          <App emotionCache={cache} {...props} />
        ),
      })

    const initialProps = await NextDocument.getInitialProps(ctx)
    const emotionStyles = extractCriticalToChunks(initialProps.html)
    const emotionStyleTags = emotionStyles.styles.map((style) => (
      <style
        key={style.key}
        data-emotion={`${style.key} ${style.ids.join(' ')}`}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{__html: style.css}}
      />
    ))

    return {
      ...initialProps,
      lang: ctx.query.lang as string ?? 'en',
      // Styles fragment is rendered after the app and page rendering finish.
      styles: [
        ...Children.toArray(initialProps.styles),
        ...emotionStyleTags,
      ],
    }
  }

  public render(): JSX.Element {
    const { lang } = this.props
    return (
      <Html lang={lang}>
        <Head>
          <meta charSet="utf-8"/>
          {makeLinkElements(preconnectElements)}
          {makeMetaElements(metaElements)}
          {makeLinkElements(linkElements)}
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap"
          />
        </Head>
        <body>
          <Main/>
          <NextScript/>
        </body>
      </Html>
    )
  }
}

export default _Document
