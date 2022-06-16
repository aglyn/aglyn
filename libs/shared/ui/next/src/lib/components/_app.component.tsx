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

import {HAS_DOCUMENT} from '@aglyn/shared-data-enums'
import type {JSXElementType} from '@aglyn/shared-data-types'
import type {MakeLinkElementsConfig, MakeMetaElementsConfig} from '@aglyn/shared-ui-jsx'
import {makeLinkElements, makeMetaElements} from '@aglyn/shared-ui-jsx'
import {arraySafe} from '@aglyn/shared-util-tools'
import Head from 'next/head'
import {Fragment, type ReactNode, useEffect, useMemo} from 'react'
import NextPageTitleProvider from '../contexts/next-page-title-provider'
import NextEmotionAppComponent, {
  type NextEmotionAppComponentProps,
} from './next-emotion-app.component'
import NextPageDecoratedLayoutComponent, {
  type NextPageDecoratedLayoutComponentProps,
} from './next-page-decorated-layout.component'


export interface _AppProps<Props, InitialProps> extends NextPageDecoratedLayoutComponentProps<Props, InitialProps>, NextEmotionAppComponentProps {
  children?: ReactNode
  headChildren?: ReactNode
  linkElements?: MakeLinkElementsConfig
  MainComponent?: JSXElementType<{children?: ReactNode}>
  metaElements?: MakeMetaElementsConfig
}

function _AppComponent<Props, InitialProps>(props: _AppProps<Props, InitialProps>) {
  const {
    headChildren,
    metaElements,
    linkElements,
    MainComponent,
    emotionCache,
    ...rest
  } = props

  const metaElementsMemoed: MakeMetaElementsConfig = useMemo(
    () => arraySafe(metaElements),
    [metaElements],
  )

  const linkElementsMemoed: MakeLinkElementsConfig = useMemo(
    () => arraySafe(linkElements),
    [linkElements],
  )

  useEffect(() => {
    if (HAS_DOCUMENT()) {
      // Remove the server-side injected CSS.
      const jssStyles = document?.querySelector('#jss-server-side')
      jssStyles?.parentElement?.removeChild(jssStyles)
    }
  }, [])

  return (
    <NextEmotionAppComponent emotionCache={emotionCache}>
      <NextPageTitleProvider>
        <Head>
          {makeMetaElements(metaElementsMemoed)}
          {makeLinkElements(linkElementsMemoed)}
          {headChildren}
        </Head>
        <MainComponent>
          <NextPageDecoratedLayoutComponent {...rest} />
        </MainComponent>
      </NextPageTitleProvider>
    </NextEmotionAppComponent>
  )
}
_AppComponent.displayName = '_AppComponent'
_AppComponent.aglyn = true
_AppComponent.defaultProps = {
  metaElements: [],
  linkElements: [],
  MainComponent: function MainComponent(props) {
    const {children} = props

    return (
      <Fragment>
        {children}
      </Fragment>
    )
  },
}

export {_AppComponent}
export default _AppComponent
