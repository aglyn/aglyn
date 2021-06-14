import { themes } from '@aglyn/shared/ui/react'
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
import React from 'react'


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

export type MetaElemProps = React.HTMLProps<HTMLMetaElement>
export type LinkElemProps = React.HTMLProps<HTMLLinkElement>
export type MetaElementsConfig = [name: MetaElemProps['name'], content: MetaElemProps['content'], other?: MetaElemProps][]
export type LinkElementsConfig = [rel: LinkElemProps['rel'], href: LinkElemProps['href'], other?: LinkElemProps][]

/**
 * Document component handles the initial `document` markup and
 * renders only on the server side. Commonly used for implementing
 * server side rendering for `css-in-js` libraries.
 *
 * Resolution order
 * On the server:
 * 1. app.getInitialProps
 * 2. page.getInitialProps
 * 3. document.getInitialProps
 * 4. app.render
 * 5. page.render
 * 6. document.render
 *
 * On the server with error:
 * 1. document.getInitialProps
 * 2. app.render
 * 3. page.render
 * 4. document.render
 *
 * On the client
 * 1. app.getInitialProps
 * 2. page.getInitialProps
 * 3. app.render
 * 4. page.render
 *
 * @exports
 * @class AppDocument
 * @extends {NextDocument<P>}
 * @template P
 */
class AppDocument<P = {}> extends NextDocument<P> {

  /**
   * Returns the context object with the addition of `renderPage`
   *
   * `renderPage` callback inside {DocumentContext} executes `React`
   * rendering logic synchronously to support server-rendering wrappers
   *
   * @param {DocumentContext} ctx
   * @returns {InitPropsResponse}
   */
  public static async getInitialProps(ctx: DocumentContext): InitPropsResponse {
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
      const result1 = await jssMinify.prefixer.process(css, { from: undefined })
      css = result1.css
      css = jssMinify.cleanCSS.minify(css).styles
    }

    return {
      ...initialProps,
      // Styles fragment is rendered after the app and page rendering finish.
      styles: [
        ...React.Children.toArray(initialProps.styles),
        // sheets.getStyleElement() // LEAVE FOR REFERENCE IN CASE OF ISSUE BELOW
        <style
          key="jss-server-side"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: css }}
          id="jss-server-side"
        />,
      ],
    }
  }

  metaElements: MetaElementsConfig = [
    ['theme-color', themes.console.palette.primary.main],
  ]
  linkElements: LinkElementsConfig = [
    ['shortcut icon', '/favicon.ico'],
    ['manifest', '/manifest.json'],
    ['stylesheet', 'https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap'],
  ]

  static makeMetaElem = ([name, content, { ...rest }]: MetaElementsConfig[number]) => (
    <meta key={name + content} content={content} name={name} {...rest} />
  )

  static makeLinkElem = ([rel, href, { ...rest }]: LinkElementsConfig[number]) => (
    <link key={href} href={href} rel={rel} {...rest} />
  )

  public render(): JSX.Element {
    return (
      <>
        <Html lang="en">
          <Head>
            {this.linkElements.map(AppDocument.makeLinkElem)}
            {this.metaElements.map(AppDocument.makeMetaElem)}
          </Head>
          <body>
          <Main />
          <NextScript />
          </body>
        </Html>
      </>
    )
  }
}

export default AppDocument
