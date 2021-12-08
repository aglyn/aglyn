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

  // eslint-disable-next-line @typescript-eslint/no-var-requires
const withNx = require('@nrwl/next/plugins/with-nx')
const pkg = require('./package.json')
const deepmerge = require('deepmerge')

const PKG_VERSION = String(pkg.version ?? 'UNDEFINED')
const NODE_VERSION = String(process.version ?? 'UNDEFINED')

const NODE_ENV = JSON.stringify(process.env.NODE_ENV)
const COMMIT_REF = JSON.stringify(process.env.COMMIT_REF)

const DEVELOPMENT = NODE_ENV === 'development'
const PRODUCTION = NODE_ENV === 'production'
const PREVIEW = NODE_ENV === 'preview'
const READY = PRODUCTION || PREVIEW

const DEFAULT_HEADERS = [
  { key: 'x-frame-options', value: 'SAMEORIGIN' },
  { key: 'x-content-type-options', value: 'nosniff' },
  { key: 'x-aglyn-package-version', value: `${PKG_VERSION.toLowerCase()}` },
  { key: 'x-aglyn-process-version', value: `${NODE_VERSION.toLowerCase()}` },
  !PRODUCTION && { key: 'x-aglyn-package-versions', value: `${PKG_VERSION.toLowerCase()}` },
].filter((i) => Boolean(i))


/**
 * @type {import('@nrwl/next/plugins/with-nx').WithNxOptions}
 **/
const aglynOptions = ({
  // Opt-in to using the Next.js compiler for minification. This is 7x faster than Terser.
  swcMinify: PRODUCTION,
  // Disable production source maps
  productionBrowserSourceMaps: false,

  // Disable compression only in production
  compress: READY,

  reactStrictMode: !PRODUCTION,
  target: 'experimental-serverless-trace',
  typescript: {
    // Motivated by https://github.com/zeit/next.js/issues/7687
    ignoreDevErrors: PRODUCTION,
    ignoreBuildErrors: PRODUCTION,
  },
  eslint: {
    ignoreDuringBuilds: PRODUCTION,
  },

  serverRuntimeConfig: {
    // Will only be available on the server side
    mySecret: 'secret',
    secondSecret: process.env.SECOND_SECRET, // Pass through env variables
  },
  publicRuntimeConfig: {
    // Will be available on both server and client
    staticFolder: '/static',
  },

  experimental: {
    // ssr and displayName are configured by default
    styledComponents: true,
  },
})


/**
 * Base configuration for NextJS Apps next.config.js
 * @param opts {import('@nrwl/next/plugins/with-nx').WithNxOptions}
 **/
const withAglynNxNext = (opts = {}) => {
  const withAglynOptions = deepmerge(opts, withAglynNxNext.options)

  withAglynOptions.headers = async () => {
    const userHeaders = typeof opts.headers === 'function'
      ? [...opts.headers()]
      : [...opts.headers]
    // const userPathOther = []
    // const userPathAll = userHeaders.find((h)=> {
    //   if (h?.source === '/:path*') {
    //     return true
    //   }
    //   userPathOther.push(h)
    //   return false
    // }) || {}
    return [
      {
        source: '/:path*',
        headers: DEFAULT_HEADERS,
      },
      ...userHeaders,
    ]
  }

  withAglynOptions.webpack = (config, options, ...args) => {
    const { webpack, buildId } = options
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.BUILD_ID': JSON.stringify(buildId),
        'process.env.PKG_VERSION': PKG_VERSION,
        'process.env.NODE_VERSION': NODE_VERSION,
        'process.env.COMMIT_REF': COMMIT_REF,
        'process.env.NODE_ENV': NODE_ENV,
      }),
    )

    return opts?.webpack ? opts.webpack(config, options, ...args) : config
  }

  return withNx(withAglynOptions)
}

withAglynNxNext.options = aglynOptions

module.exports = withAglynNxNext
