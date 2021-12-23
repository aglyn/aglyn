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

import type {AnyProps} from '@aglyn/shared-data-types'
import type {NextPage} from 'next'
import type {AppProps} from 'next/app'
import type {ReactElement} from 'react'


export type GetLayoutFn<Props = AnyProps, InitialProps = Props> = (
  page: ReactElement,
  props: AppPropsWithLayout<Props, InitialProps>,
) => ReactElement

export type NextGetLayoutProps<Props = AnyProps, InitialProps = Props> = {
  getLayout?: GetLayoutFn<Props, InitialProps>
}

export type NextPageWithLayout<Props = AnyProps, InitialProps = Props> =
  NextPage<Props, InitialProps>
  & NextGetLayoutProps<Props, InitialProps>

export type NextComponentWithLayoutProps<Props = AnyProps, InitialProps = Props> = {
  Component: NextPageWithLayout<Props, InitialProps>
}

export type AppPropsWithLayout<Props = AnyProps, InitialProps = Props> =
  AppProps<Props>
  & NextComponentWithLayoutProps<Props, InitialProps>

/**
 * Handle default noop fn doe getLayout
 * @param props
 */
export function nextPageGetLayoutFn<Props, InitialProps>(
  props: Pick<AppPropsWithLayout<Props, InitialProps>, 'Component'>,
) {
  const {Component} = props
  return Component.getLayout ?? ((page) => page)
}

/**
 * Decorate next page with defined layout
 * Uses the getLayout defined at the page level, if available
 *
 * @param props
 * @constructor
 */
export function NextAppWithLayout<Props, InitialProps>(
  props: AppPropsWithLayout<Props, InitialProps>,
): ReactElement {
  const {Component, pageProps} = props
  const getLayout = nextPageGetLayoutFn(props)

  return getLayout(<Component {...pageProps} />, props)
}

export default NextAppWithLayout
