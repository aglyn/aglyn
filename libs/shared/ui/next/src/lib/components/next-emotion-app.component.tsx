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

import {CacheProvider, createEmotionCache, type EmotionCache} from '@aglyn/shared-feature-themes'
import {
  NextAppWrapperComponent,
  type NextAppWrapperComponentProps,
} from './next-app-wrapper.component'
import {
  NextPageDecoratedLayoutComponent,
  type NextPageDecoratedLayoutComponentProps,
} from './next-page-decorated-layout.component'


// Client-side cache, shared for the whole session of the user in the browser.
const clientSideEmotionCache = createEmotionCache()

export interface NextEmotionAppComponentProps<Props, InitialProps> extends NextPageDecoratedLayoutComponentProps<Props, InitialProps> {
  emotionCache?: EmotionCache
  NextAppWrapperProps?: Omit<NextAppWrapperComponentProps, 'children'>
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
 *
 * @see {@link NextEmotionDocumentComponent}
 */
function NextEmotionAppComponent<Props, InitialProps>(props: NextEmotionAppComponentProps<Props, InitialProps>) {
  const {
    emotionCache = clientSideEmotionCache,
    NextAppWrapperProps,
    ...rest
  } = props

  return (
    <CacheProvider value={emotionCache}>
      <NextAppWrapperComponent {...NextAppWrapperProps}>
        <NextPageDecoratedLayoutComponent {...rest} />
      </NextAppWrapperComponent>
    </CacheProvider>
  )
}
NextEmotionAppComponent.displayName = 'NextEmotionAppComponent'
NextEmotionAppComponent.aglyn = true

export {NextEmotionAppComponent}
export default NextEmotionAppComponent
