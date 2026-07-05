/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { IS_PRODUCTION, LINK_PREF, LINK_PRIORITY, META_PREF, } from '@aglyn/shared-data-enums'
import { makeLinkElements, makeMetaElements } from '@aglyn/shared-ui-jsx'
import {
  createEmotionCache,
  createEmotionServer,
  type EmotionCache,
  getConsoleMetaThemeColor,
} from '@aglyn/shared-ui-theme'
import { getDisplayName } from '@aglyn/shared-util-tools'
import { hoistNonReactStatics } from '@aglyn/shared-util-vendor'
import { getInitColorSchemeScript } from '@mui/material/styles'
import crypto from 'crypto'
import type { AppType, Enhancer } from 'next/dist/shared/lib/utils' // eslint-disable-next-line @next/next/no-document-import-in-page
import NextDocument, {
  type DocumentContext,
  type DocumentInitialProps,
  Head,
  Html,
  Main,
  NextScript,
} from 'next/document'
import { Children, type ComponentType } from 'react'


const cspHashOf = (text: string) => {
  const hash = crypto.createHash('sha256')
  hash.update(text)
  return `'sha256-${hash.digest('base64')}'`
}

export type LangParam = { lang?: string }
export type InitPropsResponse = Promise<DocumentInitialProps & LangParam>

export interface _EmotionDocumentProps extends LangParam {}

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
 * 1. (if-exists) getInitialProps _app.tsx
 * {@link NextEmotionAppComponent.getInitialProps}
 * 2. (if-exists) getInitialProps page {@link
 * NextPageWithLayout.getInitialProps}
 * 3. getInitialProps _document.tsx
 * {@link _EmotionDocumentComponent.getInitialProps}
 * 4. render _app.tsx {@link NextEmotionAppComponent.render}
 * 5. render page {@link NextPageWithLayout.render}
 * 6. render _document.tsx {@link _EmotionDocumentComponent.render}
 *
 * __Server-side (w/ error)__
 *
 * 1. (if-exists) getInitialProps _document.tsx
 * {@link _EmotionDocumentComponent.getInitialProps}
 * 2. render _app.tsx {@link NextEmotionAppComponent.render}
 * 3. render page {@link NextPageWithLayout.render}
 * 4. render _document.tsx {@link _EmotionDocumentComponent.render}
 *
 * __Client-side__
 * 1. (if-exists) getInitialProps _app.tsx
 * {@link NextEmotionAppComponent.getInitialProps}
 * 2. (if-exists) getInitialProps page {@link
 * NextPageWithLayout.getInitialProps}
 * 3. render _app.tsx {@link NextEmotionAppComponent.render}
 * 4. render page {@link NextPageWithLayout.render}
 * @see {@link NextAppThemedComponent}
 */
export class _EmotionDocumentComponent<
  P extends _EmotionDocumentProps,
> extends NextDocument<P> {
  public static displayName = '_EmotionDocumentComponent'
  public static readonly aglyn = true
  public static defaultLanguage = 'en'

  public static EmotionStyleElement(props) {
    const { key, css, ids } = props
    return (
      <style
        id={`emotion-server-${key}`}
        key={key}
        data-emotion={`${key} ${ids.join(' ')}`}
        dangerouslySetInnerHTML={{ __html: css }}
      />
    )
  }

  public static getDocumentLanguage(query: DocumentContext['query']) {
    const list = Array.isArray(query.lang)
      ? query.lang
      : [query.lang || this.defaultLanguage]
    return list.find(
      (item) => typeof item === 'string' && item.trim().length > 1,
    )
  }

  public static useWithEmotionCache(cache?: EmotionCache): Enhancer<AppType> {
    return function withEmotionCache<P>(
      Component: ComponentType<P & { emotionCache?: EmotionCache }>,
    ): ComponentType<P> {
      function WithEmotionCache(props: P) {
        return <Component emotionCache={cache} {...props} />
      }
      const displayName = getDisplayName(Component)
      WithEmotionCache.displayName = `WithEmotionCache(${displayName})`
      hoistNonReactStatics(WithEmotionCache, Component)
      return WithEmotionCache
    }
  }

  /**
   * Returns the context object with the addition of {@link renderPage}
   *
   * Callback defined inside {@link DocumentContext} executes `React`
   * rendering logic synchronously to support server-rendering wrappers
   */
  static async getInitialProps(ctx: DocumentContext): InitPropsResponse {
    const { renderPage, query } = ctx
    const lang = this.getDocumentLanguage(query)
    const emotionCache: EmotionCache = createEmotionCache({
      key: 'next',
    })
    const { extractCriticalToChunks } = createEmotionServer(emotionCache)
    const withEmotionCache = this.useWithEmotionCache(emotionCache)

    ctx.renderPage = () =>
      renderPage({
        enhanceApp: withEmotionCache,
      })

    const { styles: initialStyles, ...initialProps } =
      await NextDocument.getInitialProps(ctx)
    const { styles: emotionStyles } = extractCriticalToChunks(initialProps.html)

    const styles = Children.toArray(initialStyles)
      // Styles fragment is rendered after the app and page rendering finish.
      .concat(emotionStyles.map(this.EmotionStyleElement))

    return {
      ...initialProps,
      lang,
      styles,
    }
  }

  public render(): JSX.Element {
    const { lang } = this.props

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
          {makeMetaElements(
            META_PREF(
              getConsoleMetaThemeColor('light'),
              getConsoleMetaThemeColor('dark'),
            ),
          )}
          {makeLinkElements(LINK_PREF)}
        </Head>
        <body>
          {getInitColorSchemeScript({
            defaultMode: 'system',
            // Must match colorSchemeSelector: 'class' in extendTheme so the
            // init script adds a CSS class (e.g. "dark") to <html> instead of
            // a data-attribute, ensuring dark-mode CSS vars apply on first paint.
            attribute: '.%s',
          })}
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}

export default _EmotionDocumentComponent
