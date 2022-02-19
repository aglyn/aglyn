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

import React, {ErrorInfo, FunctionComponent} from 'react'
import App from 'next/app'
import {AppContext} from 'next/dist/pages/_app'


export type NextAppMiddleware<T = Record<string, unknown>> = {
  /**
   * human readable identifier of middleware
   */
  name?: string
  /**
   * Static function which is executed before rendering. Used
   * for blocking data requirements for every single page in
   * your application, e.g. server side data fetching.
   */
  getInitialProps?(appContext: AppContext): T | Promise<T>
  /**
   * Component which is rendered in custom App.
   */
  Component?: FunctionComponent<T>
  componentDidCatch?(error: Error, errorInfo: ErrorInfo): App['componentDidCatch']
}

export type ComponentDidCatchMiddlewareHandler = {
  (
    allMiddleware: any,
    error: Error,
    _errorInfo: ErrorInfo,
  ): void
}

export type NextAppMiddlewareBuilder = (options: NextAppBuilderOptions) => typeof App
export type NextAppBuilderOptions = {
  middleware: NextAppMiddleware[]
}

const execDidCatchAppMiddleware: ComponentDidCatchMiddlewareHandler = (
  allMiddleware,
  error,
  errorInfo,
) => {
  return allMiddleware.forEach(({componentDidCatch}) => {
    if (componentDidCatch) {
      componentDidCatch(error, errorInfo)
    }
  })
}

const renderPage = (
  allMiddleware,
  {Component: PageComponent, pageProps: {middlewareProps, ...props}},
) => {
  return allMiddleware
    .filter(({Component: MiddlewareComponent}) => !!MiddlewareComponent)
    .reduceRight(
      (nestedElement, {Component: MiddlewareComponent, id}) => (
        <MiddlewareComponent {...props} {...middlewareProps[id]}>
          {nestedElement}
        </MiddlewareComponent>
      ),
      <PageComponent {...props} />,
    )
}

/**
 * Generates a custom next App using middleware.
 *
 * Usage
 *
 * ```
 *
 * const getInitialProps = ({ router }) => {
 *    const data = await fetch(getDataForPage(router.pathname));
 *    return { data };
 * }
 *
 * const ssrDataMiddleware = {
 *   Component: SsrDataProvider,
 *   getInitialProps
 * };
 * const layoutMiddleware = { Component: LayoutComponent };
 *
 * nextAppBuilder({
 *   middleware: [
 *     ssrDataMiddleware,
 *     layoutMiddleware
 *   ]
 * })
 *
 * ```
 *
 * @param middleware
 */
const nextAppBuilder: NextAppMiddlewareBuilder = ({middleware = []}) => {
  const allMiddleware = middleware.map((singleMiddleware, index) => ({
    ...singleMiddleware,
    id: `nextAppMiddleware-${index}`,
  }))

  class NextAppMiddlewareComponent extends App {

    // TODO: FIX THE NEED TO USE getInitialProps as it disables the automatic SSR sitewide
    static async getInitialProps({Component, ctx, router}): Promise<{pageProps: any}> {
      let pageProps = {}
      const {AppTree} = ctx
      const extendPageProps = props => {
        pageProps = {
          ...pageProps,
          ...props,
        }
      }
      if (Component.getInitialProps) {
        extendPageProps(await Component.getInitialProps(ctx))
      }

      let middlewareProps

      const InternalAppTree = props => {
        const enhancedPageProps = {...pageProps, middlewareProps, ...props}
        return <AppTree pageProps={enhancedPageProps} />
      }

      const allInitialProps = await Promise.all(
        allMiddleware.map(async ({getInitialProps, id, name}) => {
          let initialProps = {}
          if (getInitialProps) {
            try {
              initialProps = await getInitialProps({
                Component,
                router,
                ctx,
                AppTree: InternalAppTree,
              })
            }
            catch (error) {
              console.warn(`getInitialProps failed for middleware with name ${name || 'unnamed'}`, error)
            }
          }
          return {initialProps, id}
        }),
      )

      middlewareProps = allInitialProps.reduce(
        (props, {id, initialProps}) => ({
          ...props,
          [id]: initialProps,
        }),
        {},
      )

      extendPageProps({middlewareProps})
      return {pageProps}
    }

    componentDidCatch(error, errorInfo): void {
      execDidCatchAppMiddleware(allMiddleware, error, errorInfo)
      // This is needed to render errors correctly in development / production
      super.componentDidCatch(error, errorInfo)
    }

    render(): JSX.Element {
      const {Component, pageProps, ...otherProps} = this.props
      return renderPage(allMiddleware, {
        Component,
        pageProps: {...pageProps, ...otherProps},
      })
    }
  }

  return NextAppMiddlewareComponent
}

export default nextAppBuilder
