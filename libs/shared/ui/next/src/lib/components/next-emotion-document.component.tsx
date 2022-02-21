/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {IS_PRODUCTION, LINK_PREF, LINK_PRIORITY, META_PREF} from '@aglyn/shared-data-enums'
import {
  createEmotionCache,
  createEmotionServer,
  type EmotionCache,
} from '@aglyn/shared-feature-themes'
import {makeLinkElements, makeMetaElements} from '@aglyn/shared-ui-jsx'
import {getDisplayName} from '@aglyn/shared-util-tools'
import crypto from 'crypto'
import NextDocument, {
  type DocumentContext,
  type DocumentInitialProps,
  Head,
  Html,
  Main,
  NextScript,
} from 'next/document'
import {Children} from 'react'


const cspHashOf = (text: string) => {
  const hash = crypto.createHash('sha256')
  hash.update(text)
  return `'sha256-${hash.digest('base64')}'`
}
export type LangParam = {lang?: string}
export type InitPropsResponse = Promise<DocumentInitialProps & LangParam>


export interface NextEmotionDocumentComponentProps extends LangParam {}

/**
 * Next.js custom _document.jsx with cached emotion styles
 *
 * Document component handles the initial `document` markup and
 * renders only on the server side. Commonly used for implementing
 * server side rendering for `css-in-js` libraries.
 *
 * # Resolution order
 * __Server-side__
 *
 * 1. (if-exists) getInitialProps _app.tsx {@link NextEmotionAppComponent.getInitialProps}
 * 2. (if-exists) getInitialProps page {@link NextPageWithLayout.getInitialProps}
 * 3. getInitialProps _document.tsx {@link NextEmotionDocumentComponent.getInitialProps}
 * 4. render _app.tsx {@link NextEmotionAppComponent.render}
 * 5. render page {@link NextPageWithLayout.render}
 * 6. render _document.tsx {@link NextEmotionDocumentComponent.render}
 *
 * __Server-side (w/ error)__
 *
 * 1. (if-exists) getInitialProps _document.tsx {@link NextEmotionDocumentComponent.getInitialProps}
 * 2. render _app.tsx {@link NextEmotionAppComponent.render}
 * 3. render page {@link NextPageWithLayout.render}
 * 4. render _document.tsx {@link NextEmotionDocumentComponent.render}
 *
 * __Client-side__
 * 1. (if-exists) getInitialProps _app.tsx {@link NextEmotionAppComponent.getInitialProps}
 * 2. (if-exists) getInitialProps page {@link NextPageWithLayout.getInitialProps}
 * 3. render _app.tsx {@link NextEmotionAppComponent.render}
 * 4. render page {@link NextPageWithLayout.render}
 * @see {@link NextAppWrapperComponent}
 */
class NextEmotionDocumentComponent<P extends NextEmotionDocumentComponentProps> extends NextDocument<P> {

  static displayName = '_Document'

  /**
   * Returns the context object with the addition of {@link renderPage}
   *
   * Callback defined inside {@link DocumentContext} executes `React`
   * rendering logic synchronously to support server-rendering wrappers
   */
  static async getInitialProps(ctx: DocumentContext): InitPropsResponse {
    const originalRenderPage = ctx.renderPage
    const cache: EmotionCache = createEmotionCache()
    const {extractCriticalToChunks} = createEmotionServer(cache)

    ctx.renderPage = () =>
      originalRenderPage({
        enhanceApp: (App: any) => {
          const displayName = `EmotionCachedApp(${getDisplayName(App)})`
          const component = (props: unknown) => (
            <App emotionCache={cache} {...props} />
          )
          component.displayName = displayName
          return component
        },
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
    const {lang} = this.props

    let csp = `default-src 'self'; script-src 'self' ${cspHashOf(
      NextScript.getInlineScriptSource(this.props),
    )}`
    if (IS_PRODUCTION) {
      csp = `default-src 'self' aglyn.com *.aglyn.com' ${cspHashOf(
        NextScript.getInlineScriptSource(this.props),
      )}`
    }

    return (
      <Html lang={lang}>
        <Head>
          <meta charSet="utf-8" />
          {/*<meta httpEquiv="Content-Security-Policy" content={csp}/>*/}
          {makeLinkElements(LINK_PRIORITY)}
          {makeMetaElements(META_PREF)}
          {makeLinkElements(LINK_PREF)}
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}

NextEmotionDocumentComponent.displayName = 'NextEmotionDocumentComponent'

export {NextEmotionDocumentComponent}
export default NextEmotionDocumentComponent
