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

import {type AnyProps} from '@aglyn/shared-data-types'
import {objectDeepMerge} from '@aglyn/shared-util-vendor'
import {type NextPage} from 'next'
import {type AppProps as NextAppProps} from 'next/app'
import {type ReactElement} from 'react'


export type NextPageGetLayoutFn = (
  page: ReactElement,
  props: NextAppWithLayoutProps,
) => ReactElement

export type NextPageMemberLayout = {
  getLayout?: NextPageGetLayoutFn
  layoutComponent?: NextPageWithLayout
  layoutProps?: {
    [P in NextPageWithLayout['displayName']]: AnyProps
  }
}

export type NextPageWithLayout<Props = AnyProps, InitialProps = Props> =
  & NextPage<Props, InitialProps>
  & NextPageMemberLayout

export type NextAppWithLayoutProps<Props = AnyProps, InitialProps = Props> = NextAppProps<Props> & {
  Component: NextPageWithLayout<Props, InitialProps>
  mergedLayoutProps?: NextPageMemberLayout['layoutProps']
  defaultGetLayout?: NextPageGetLayoutFn,
}

const GET_LAYOUT_NOOP = (page: ReactElement) => page

export function getNextPageLayout<Props, InitialProps>(
  props: NextAppWithLayoutProps<Props, InitialProps>,
): NextPageGetLayoutFn {
  const {Component, mergedLayoutProps, defaultGetLayout} = props

  if (Component.getLayout) {
    return Component.getLayout
  }

  if (Component.layoutComponent) {
    const ComponentLayout = Component.layoutComponent
    const layoutProps = objectDeepMerge(
      {},
      ComponentLayout.layoutProps || {},
      Component.layoutProps || {},
      mergedLayoutProps || {},
    )

    return (page, props) => {
      const OuterComponent = getNextPageLayout({
        ...props,
        Component: ComponentLayout,
        mergedLayoutProps: layoutProps,
      })
      return OuterComponent((
        <ComponentLayout {...layoutProps[ComponentLayout.displayName] || {}}>
          {page}
        </ComponentLayout>
      ), props)
    }
  }

  return defaultGetLayout || GET_LAYOUT_NOOP
}

export default getNextPageLayout
