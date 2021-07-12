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

import { console } from '@aglyn/shared/ui/themes'
import { ServerStyleSheets } from '@material-ui/core/styles'
import { NextComponentType } from 'next'
import NextDocument, {
  DocumentContext,
  DocumentInitialProps,
  Head,
  Html,
  Main,
  NextScript,
} from 'next/document'
import { Children, HTMLProps } from 'react'


const isProduction = Boolean(process.env.NODE_ENV === 'production')

const jssMinify = {
  prefixer: null,
  cleanCSS: null,
}
if (isProduction) {
  /* eslint-disable @typescript-eslint/no-var-requires  */
  const postcss = require('postcss')
  const autoprefixer = require('autoprefixer')
  const CleanCSS = require('clean-css')
  /* eslint-enable @typescript-eslint/no-var-requires */

  jssMinify.prefixer = postcss([autoprefixer])
  jssMinify.cleanCSS = new CleanCSS()
}

export type InitPropsResponse = Promise<DocumentInitialProps>

export type MetaElemProps = HTMLProps<HTMLMetaElement>
export type LinkElemProps = HTMLProps<HTMLLinkElement>
export type MetaElementsConfig = [name: MetaElemProps['name'], content: MetaElemProps['content'], other?: MetaElemProps][]
export type LinkElementsConfig = [rel: LinkElemProps['rel'], href: LinkElemProps['href'], other?: LinkElemProps][]

/**
 * Document component handles the initial `document` markup and
 * renders only on the server side. Commonly used for implementing
 * server side rendering for `css-in-js` libraries.
 *
 * @example
 * > ## Resolution order
 * >
 * > ### Server-side
 * > 1. [_App]{@link _App}.getInitialProps (if-exists)
 * > 2. <PageComponent>.getInitialProps
 * > 3. [_Document]{@link _Document}.getInitialProps
 * > 4. [_App]{@link _App}.render
 * > 5. <PageComponent>.render
 * > 6. [_Document]{@link _Document}.render
 * >
 * > ### Server-side (w/ error)
 * > 1. [_Document]{@link _Document}.getInitialProps
 * > 2. [_App]{@link _App}.render
 * > 3. <PageComponent>.render
 * > 4. [_Document]{@link _Document}.render
 * >
 * > ### Client-side
 * > 1. [_App]{@link _App}.getInitialProps (if-exists)
 * > 2. <PageComponent>.getInitialProps
 * > 3. [_App]{@link _App}.render
 * > 4. <PageComponent>.render
 *
 * @exports
 * @class _Document
 * @extends {NextDocument<P>}
 * @template P
 */
export default class _Document<P = {}> extends NextDocument<P> {

  /**
   * Returns the context object with the addition of `renderPage`
   *
   * `renderPage` callback inside {DocumentContext} executes `React`
   * rendering logic synchronously to support server-rendering wrappers
   *
   * @param {DocumentContext} ctx
   * @returns {InitPropsResponse}
   */
  static async getInitialProps(ctx: DocumentContext): InitPropsResponse {
    // Render app and page and get the context of the page with collected side effects.
    const sheets = new ServerStyleSheets()
    const originalRenderPage = ctx.renderPage
    ctx.renderPage = () => originalRenderPage({
      // useful for wrapping the whole react tree
      enhanceApp: (App) => (props) => {
        // console.log('enhanceApp: App => props => {}', App, props)
        return sheets.collect(<App {...props} />)
      },

      // useful for wrapping in a per-page basis
      enhanceComponent: (Component: NextComponentType) => {
        // console.log('enhanceComponent: Component => {}',Component.displayName, Component)
        // console.log('component enhancement', Component)
        return Component
      },
    })
    const initialProps = await super.getInitialProps(ctx)
    // Minify css
    let css = sheets.toString()
    // It might be undefined, e.g. after an error.
    if (css && process.env.NODE_ENV === 'production' && jssMinify.prefixer && jssMinify.cleanCSS) {
      const result1 = await jssMinify.prefixer.process(css, {from: undefined})
      css = result1.css
      css = jssMinify.cleanCSS.minify(css).styles
    }

    return {
      ...initialProps,
      // Styles fragment is rendered after the app and page rendering finish.
      styles: [
        ...Children.toArray(initialProps.styles),
        // sheets.getStyleElement() // LEAVE FOR REFERENCE IN CASE OF ISSUE BELOW
        <style
          key="jss-server-side"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{__html: css}}
          id="jss-server-side"
        />,
      ],
    }
  }

  metaElements: MetaElementsConfig = [
    ['theme-color', console.palette.primary.main],
    ['X-UA-Compatible', 'IE=edge'],
  ]
  linkElements: LinkElementsConfig = [
    ['shortcut icon', '/favicon.ico'],
    ['manifest', '/manifest.json'],
    ['stylesheet', 'https://fonts.googleapis.com/css?family=Raleway:300,400,500,700&display=swap'],
  ]

  makeMetaElem = ([name, content, {...rest}]: MetaElementsConfig[number]) => (
    <meta key={name + content} name={name} content={content} {...rest} />
  )

  makeLinkElem = ([rel, href, {...rest}]: LinkElementsConfig[number]) => (
    <link key={href} rel={rel} href={href} {...rest} />
  )

  public render(): JSX.Element {
    return (
      <Html lang="en">
        <Head>
          {this.metaElements.map(this.makeMetaElem)}
          {this.linkElements.map(this.makeLinkElem)}
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}
