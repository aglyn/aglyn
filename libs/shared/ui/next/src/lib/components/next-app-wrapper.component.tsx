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

import {HAS_DOCUMENT, IS_PRODUCTION} from '@aglyn/shared-data-enums'
import type {JSXElementType} from '@aglyn/shared-data-types'
import {consoleThemeLight, withTheme} from '@aglyn/shared-feature-themes'
import {
  makeLinkElements,
  type MakeLinkElementsConfig,
  makeMetaElements,
  type MakeMetaElementsConfig,
} from '@aglyn/shared-ui-jsx'
import Head from 'next/head'

import {Fragment, type HTMLAttributes, type ReactNode, useEffect} from 'react'


export interface NextAppWrapperComponentProps {
  children?: ReactNode
  headChildren?: ReactNode
  documentTitle?: HTMLAttributes<HTMLTitleElement>['children']
  metaElements?: MakeMetaElementsConfig
  linkElements?: MakeLinkElementsConfig
  mainWrapper?: JSXElementType<{children?: ReactNode}>
}

function NextAppWrapperComponentRaw(props: NextAppWrapperComponentProps) {
  const {
    children,
    headChildren,
    documentTitle,
    metaElements,
    linkElements,
    mainWrapper,
  } = props
  const Wrapper = IS_PRODUCTION ? Fragment : Fragment // StrictMode
  const MainWrapper = mainWrapper || Fragment

  useEffect(() => {
    if (HAS_DOCUMENT()) {
      // Remove the server-side injected CSS.
      const jssStyles = document?.querySelector('#jss-server-side')
      jssStyles?.parentElement?.removeChild(jssStyles)
    }
  }, [])

  return (
    <Wrapper>
      <Head>
        <title>{documentTitle}</title>
        {makeMetaElements(metaElements || [])}
        {makeLinkElements(linkElements || [])}
        {headChildren}
      </Head>
      <MainWrapper>
        {children}
      </MainWrapper>
    </Wrapper>
  )
}
NextAppWrapperComponentRaw.displayName = 'NextAppWrapperComponent'
NextAppWrapperComponentRaw.defaultProps = {
  metaElements: [],
  linkElements: [],
  mainWrapper: Fragment,
}

export const NextAppWrapperComponent = withTheme({theme: consoleThemeLight})(
  NextAppWrapperComponentRaw,
)
export default NextAppWrapperComponent
