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

const PKG_VERSION = String(pkg?.version ?? 'UNDEFINED')
const PROCESS_VERSION = String(process.version ?? 'UNDEFINED')
const PROCESS_VERSIONS = String(process.versions ?? 'UNDEFINED')

const COMMIT_REF = JSON.stringify(process.env.COMMIT_REF)

const IS_DEVELOPMENT = process.env.NODE_ENV === 'development'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const IS_TEST = process.env.NODE_ENV === 'test'

const SECURITY_HEADERS = [
  /**
   * This header controls DNS prefetching, allowing browsers to proactively perform domain name
   * resolution on external links, images, CSS, JavaScript, and more. This prefetching is performed
   * in the background, so the DNS is more likely to be resolved by the time the referenced items
   * are needed. This reduces latency when the user clicks a link.
   */
  {key: 'X-DNS-Prefetch_Control', value: 'on'},

  /**
   * This header indicates whether the site should be allowed to be displayed within an iframe.
   * This can prevent against clickjacking attacks. This header has been superseded by CSP's
   * frame-ancestors option, which has better support in modern browsers.
   */
  {key: 'X-Frame-Options', value: 'SAMEORIGIN'},

  /**
   * This header prevents the browser from attempting to guess the type of content if the
   * Content-Type header is not explicitly set. This can prevent XSS exploits for websites that
   * allow users to upload and share files. For example, a user trying to download an image, but
   * having it treated as a different Content-Type like an executable, which could be malicious.
   * This header also applies to downloading browser extensions. The only valid value for this
   * header is nosniff.
   */
  {key: 'X-Content-Type-Options', value: 'nosniff'},

  /**
   * This header stops pages from loading when they detect reflected cross-site scripting (XSS)
   * attacks. Although this protection is not necessary when sites implement a strong
   * Content-Security-Policy disabling the use of inline JavaScript ('unsafe-inline'), it can still
   * provide protection for older web browsers that don't support CSP.
   */
  {key: 'X-XSS-Protection', value: '1; mode=block'},

  /**
   * This header informs browsers it should only be accessed using HTTPS, instead of using HTTP.
   * Using the configuration below, all present and future subdomains will use HTTPS for a max-age
   * of 2 years. This blocks access to pages or subdomains that can only be served over HTTP.
   *
   * Note: If you're deploying to Vercel, this header is not necessary as it's automatically added
   * to all deployments.
   */
  {key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload'},
]

const BRAND_HEADERS = [
  {key: 'x-aglyn-package-version', value: `${PKG_VERSION.toLowerCase()}`},
  {key: 'x-aglyn-process-version', value: `${PROCESS_VERSION.toLowerCase()}`},
  {key: 'x-aglyn-process-versions', value: `${PROCESS_VERSIONS.toLowerCase()}`},
]


/**
 * Base configuration for NextJS Apps next.config.js
 * @param opts {import('@nrwl/next/plugins/with-nx').WithNxOptions}
 **/
const withAglynNxNext = (opts = {}) => {
  console.log('process.env.NODE_ENV', process.env.NODE_ENV, IS_PRODUCTION)

  return withNx({
    ...opts,
    env: {
      PKG_VERSION,
      COMMIT_REF,
      PROCESS_VERSION,
      PROCESS_VERSIONS,
      ...opts?.env,
    },

    // Disable production source maps
    productionBrowserSourceMaps: false,

    // Next.js provides gzip compression to compress rendered content and static files. In general
    // you will want to enable compression on a HTTP proxy like nginx, to offload load from the
    // Node.js process.
    compress: true,

    optimizeFonts: IS_PRODUCTION,

    // Opt-in to using the Next.js compiler for minification. This is 7x faster than Terser.
    swcMinify: false,

    target: 'experimental-serverless-trace',

    reactStrictMode: !IS_PRODUCTION,

    typescript: {
      // Motivated by https://github.com/zeit/next.js/issues/7687
      ignoreDevErrors: IS_PRODUCTION,
      ignoreBuildErrors: IS_PRODUCTION,

      ...opts?.typescript,
    },

    eslint: {
      ignoreDuringBuilds: IS_PRODUCTION,
      ...opts?.eslint,
    },

    nx: {
      // Set this to false if you do not want to use SVGR
      // See: https://github.com/gregberge/svgr
      svgr: true,
    },

    images: {
      formats: ['image/avif', 'image/webp'],
      domains: [
        'aglyn.com',
        'console.aglyn.com',
        'cdn.aglyn.com',
      ],
      ...opts?.images,
    },

    // Will be available on server only
    serverRuntimeConfig: {
      ...opts?.serverRuntimeConfig,
    },
    // Will be available on both server and client
    publicRuntimeConfig: {
      staticFolder: '/static',
      ...opts?.publicRuntimeConfig,
    },

    experimental: {
      // ssr and displayName are configured by default
      styledComponents: true,
      ...opts?.experimental,
    },

    async headers() {
      const headers = typeof opts?.headers === 'function'
        ? await opts.headers() || []
        : opts?.headers || []

      return [
        {
          source: '/(.*)',
          headers: [
            ...SECURITY_HEADERS,
            ...BRAND_HEADERS,
          ],
        },
        ...headers,
      ]
    },

    webpack(config, options, ...args) {
      const {webpack, buildId} = options
      config.plugins.push(
        new webpack.DefinePlugin({
          'process.env.BUILD_ID': JSON.stringify(buildId),
        }),
      )

      return opts?.webpack
        ? opts.webpack(config, options, ...args)
        : config
    },

  })
}

module.exports = withAglynNxNext
