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

import type { NextPage } from 'next'
import type { AppProps as NextAppProps } from 'next/app'

type AnyProps = Partial<Record<string, unknown>>
type EmptyObj = Partial<Record<never, unknown>>

export interface NextPageGetLayoutFn {
  (page: JSX.Element, props: NextAppWithLayoutProps): JSX.Element
}

export interface NextPageLayoutObject<P = EmptyObj> {
  Component: JSX.ElementType<P>
  props?: P
}

export interface NextPageMemberLayout {
  layouts?: NextPageLayoutObject<any>[]
  layout?: NextPageGetLayoutFn
}

export type NextPageWithLayout<
  Props = AnyProps,
  InitialProps = Props,
> = NextPage<Props, InitialProps> & NextPageMemberLayout

export interface NextAppWithLayoutProps<Props = AnyProps, InitialProps = Props>
  extends NextAppProps<Props> {
  Component: NextPageWithLayout<Props, InitialProps>
}

function GetLayout(page: JSX.Element, initialProps?: any) {
  return page
}

export function getNextPageLayout<Props, InitialProps>(
  props: NextAppWithLayoutProps<Props, InitialProps>,
): NextPageGetLayoutFn {
  const { Component } = props
  const { layout, layouts } = Component

  if (layout) return layout

  if (Array.isArray(layouts)) {
    return layouts.reduce((page, layout) => {
      const { Component, props } = layout
      return (innerPage, initialProps) => {
        return page(<Component {...props} children={innerPage} />, initialProps)
      }
    }, GetLayout)
  }

  return GetLayout
}

export default getNextPageLayout
