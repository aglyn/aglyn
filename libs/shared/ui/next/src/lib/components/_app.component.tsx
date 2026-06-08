/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { HAS_DOCUMENT } from '@aglyn/shared-data-enums'
import { EmotionCacheProvider } from '@aglyn/shared-ui-jsx'
import Head from 'next/head'
import {
  Fragment,
  type LinkHTMLAttributes,
  type MetaHTMLAttributes,
  useEffect,
} from 'react'
import NextPageTitleProvider from '../contexts/next-page-title-provider'
import PageDecorated, { type PageDecoratedProps } from './page-decorated'

type BaseProps<Props, InitialProps> = PageDecoratedProps<Props, InitialProps> &
  Parameters<typeof EmotionCacheProvider>[0]

export type _AppProps<Props, InitialProps> = BaseProps<Props, InitialProps> & {
  children?: JSX.Children
  headChildren?: JSX.Children
  MainComponent?: JSX.ElementType<{ children?: JSX.Children }>
  meta?: (MetaHTMLAttributes<HTMLMetaElement> & { key?: JSX.Key })[]
  link?: (LinkHTMLAttributes<HTMLLinkElement> & { key?: JSX.Key })[]
}

/**
 * Next.js custom _app.jsx with cached emotion styles
 *
 * App component manages mounting and hydration for the client app at the
 * Next.JS app entry point, removes server styles additionally responsible for
 * rendering every page Component
 *
 * # Resolution order
 * __Server-side__
 *
 * 1. (if-exists) getInitialProps _app.tsx
 * {@link _AppComponent.getInitialProps}
 * 2. (if-exists) getInitialProps page {@link
 * NextPageWithLayout.getInitialProps}
 * 3. getInitialProps _document.tsx
 * {@link _EmotionDocumentComponent.getInitialProps}
 * 4. render _app.tsx {@link _AppComponent.render}
 * 5. render page {@link NextPageWithLayout.render}
 * 6. render _document.tsx {@link _EmotionDocumentComponent.render}
 *
 * __Server-side (w/ error)__
 *
 * 1. (if-exists) getInitialProps _document.tsx
 * {@link _EmotionDocumentComponent.getInitialProps}
 * 2. render _app.tsx {@link _AppComponent.render}
 * 3. render page {@link NextPageWithLayout.render}
 * 4. render _document.tsx {@link _EmotionDocumentComponent.render}
 *
 * __Client-side__
 * 1. (if-exists) getInitialProps _app.tsx
 * {@link _AppComponent.getInitialProps}
 * 2. (if-exists) getInitialProps page {@link
 * NextPageWithLayout.getInitialProps}
 * 3. render _app.tsx {@link _AppComponent.render}
 * 4. render page {@link NextPageWithLayout.render}
 *
 * @see {@link _EmotionDocumentComponent}
 */
export function _AppComponent<Props, InitialProps>(
  props: _AppProps<Props, InitialProps>,
) {
  const {
    headChildren,
    MainComponent = ({ children }) => <Fragment>{children}</Fragment>,
    emotionCache,
    meta,
    link,
    ...rest
  } = props

  useEffect(() => {
    if (HAS_DOCUMENT()) {
      // Remove the server-side injected CSS.
      const jssStyles = document?.querySelector('#jss-server-side')
      jssStyles?.parentElement?.removeChild(jssStyles)
    }
  }, [])

  return (
    <EmotionCacheProvider emotionCache={emotionCache}>
      <NextPageTitleProvider>
        <Head>
          {meta?.map((props, i) => (
            <meta {...props} key={props.id ?? props.key ?? i} />
          ))}
          {link?.map((props, i) => (
            <link {...props} key={props.id ?? props.key ?? i} />
          ))}
          {headChildren}
        </Head>
        <MainComponent>
          <PageDecorated {...rest} />
        </MainComponent>
      </NextPageTitleProvider>
    </EmotionCacheProvider>
  )
}
_AppComponent.displayName = '_AppComponent'
_AppComponent.aglyn = true

export default _AppComponent
