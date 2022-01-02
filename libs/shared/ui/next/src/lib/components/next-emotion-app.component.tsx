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
import NextAppWrapperComponent, {
  type NextAppWrapperComponentProps,
} from './next-app-wrapper.component'
import NextPageDecoratedLayoutComponent, {
  type NextPageDecoratedLayoutComponentProps,
} from './next-page-decorated-layout.component'


// Client-side cache, shared for the whole session of the user in the browser.
const clientSideEmotionCache = createEmotionCache()

export interface NextEmotionAppComponentProps<Props, InitialProps> extends NextPageDecoratedLayoutComponentProps<Props, InitialProps> {
  emotionCache?: EmotionCache
  NextAppWrapperProps?: Omit<NextAppWrapperComponentProps, 'children'>
}

/**
 *
 * App component manages mounting and hydration for the client app
 * at the Next.JS app entry point, removes server styles and is
 * responsible for rendering every page Component
 *
 * @example
 * > ## Resolution order
 * >
 * > ### Server-side
 * > 1. {@link NextAppWrapperComponent.getInitialProps} (if-exists)
 * > 2. <PageComponent>.getInitialProps
 * > 3. {@link NextEmotionDocumentComponent.getInitialProps}
 * > 4. {@link NextAppWrapperComponent.render}
 * > 5. <PageComponent>.render
 * > 6. {@link NextEmotionDocumentComponent.render}
 * >
 * > ### Server-side (w/ error)
 * > 1. {@link NextEmotionDocumentComponent.getInitialProps}
 * > 2. {@link NextAppWrapperComponent.render}
 * > 3. <PageComponent>.render
 * > 4. {@link NextEmotionDocumentComponent.render}
 * >
 * > ### Client-side
 * > 1. {@link NextAppWrapperComponent.getInitialProps} (if-exists)
 * > 2. <PageComponent>.getInitialProps
 * > 3. {@link NextAppWrapperComponent.render}
 * > 4. <PageComponent>.render
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
      <NextAppWrapperComponent {...NextAppWrapperComponent}>
        <NextPageDecoratedLayoutComponent {...rest} />
      </NextAppWrapperComponent>
    </CacheProvider>
  )
}
NextEmotionAppComponent.displayName = 'NextEmotionAppComponent'

export {NextEmotionAppComponent}
export default NextEmotionAppComponent
