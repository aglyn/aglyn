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

const bundleAnalyzer = require('@next/bundle-analyzer')
const nextComposePlugins = require('next-compose-plugins')
const pkg = require('../package.json')
const withNx = require('@nrwl/next/plugins/with-nx')
const deepFillIn = require('mout/object/deepFillIn')

const PKG_VERSION = String(pkg?.version ?? 'NULL')
const PROCESS_VERSION = String(process.version ?? 'NULL')
const PROCESS_VERSIONS = String(process.versions ?? 'NULL')

const COMMIT_REF = String(process.env.COMMIT_REF ?? 'NULL')

const NODE_ENV = process.env.NODE_ENV
const IS_DEVELOPMENT = NODE_ENV === 'development'
const IS_PRODUCTION = NODE_ENV === 'production'
const IS_TEST = NODE_ENV === 'test'

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
 * @type {import('./nextjs-base.config').WithAglynOptions}
 **/
const AGLYN_CONFIG = {
  aglyn: {
    analyzeBundle: process.env.NEXT_ANALYZE_BUNDLE === 'true',
    analyzerOptions: {},
  },
  // Next.js provides gzip compression to compress rendered content and static
  // files. In general, you will want to enable compression on a HTTP proxy like
  // nginx, to offload load from the Node.js process.
  compress: true,
  // Opt-in to using the Next.js compiler for minification. This is 7x faster
  // than Terser.
  crossOrigin: 'anonymous',
  env: {
    PKG_VERSION,
    COMMIT_REF,
    PROCESS_VERSION,
    PROCESS_VERSIONS,
  },
  eslint: {
    ignoreDuringBuilds: IS_PRODUCTION,
  },
  experimental: {
    // ssr and displayName are configured by default
    styledComponents: false,
    optimizeImages: true,
    // optimizeCss: true,
    // Next.js can automatically create a standalone folder which copies only
    // the necessary files for a production deployment including select files in
    // node_modules
    outputStandalone: false,
    // Concurrent features in React 18 include built-in support for server-side
    // Suspense and SSR streaming support, allowing you to server-render pages
    // using HTTP streaming
    concurrentFeatures: false,
    // React Server Components allow us to render everything, including the
    // components themselves, on the server. This is fundamentally different
    // from server-side rendering where you're pre-generating HTML on the server
    serverComponents: false,
    workerThreads: true,
  },
  generateEtags: true,
  headers: async () => {
    return [
      {
        source: '/(.*)',
        headers: [
          ...SECURITY_HEADERS,
          ...BRAND_HEADERS,
        ],
      },
    ]
  },
  httpAgentOptions: {keepAlive: true},
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    disableStaticImages: false,
    domains: [
      'aglyn.com',
      'console.aglyn.com',
      'cdn.aglyn.com',
    ],
    formats: ['image/avif', 'image/webp'],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    loader: 'default',
    minimumCacheTTL: 60,
    path: '/_next/image',
  },
  nx: {
    // Set this to false if you do not want to use SVGR
    // See: https://github.com/gregberge/svgr
    svgr: true,
  },
  onDemandEntries: {maxInactiveAge: 15000, pagesBufferLength: 2},
  optimizeFonts: true,
  outputFileTracing: true,
  productionBrowserSourceMaps: false,
  poweredByHeader: true,
  // Available on both server and client
  publicRuntimeConfig: {
    staticFolder: '/_static',
  },
  reactStrictMode: !IS_PRODUCTION,
  // Available on server only
  serverRuntimeConfig: {},
  staticPageGenerationTimeout: 30,
  swcMinify: true,
  trailingSlash: false,
  typescript: {
    // Motivated by https://github.com/zeit/next.js/issues/7687
    // ignoreDevErrors: IS_PRODUCTION,
    ignoreBuildErrors: IS_PRODUCTION,
  },
  webpack5: true,
  // Disable production source maps
  webpack: (config, options) => {
    const {webpack, buildId} = options
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.BUILD_ID': JSON.stringify(buildId),
      }),
    )
    return config
  },
}


/**
 * Base configuration for NextJS Apps next.config.js
 * @param nextConfig {import('./nextjs-base.config').WithAglynOptions}
 **/
function withAglyn(nextConfig = {}) {
  console.log('process.env.NODE_ENV', NODE_ENV)

  /**
   * Base configuration for NextJS Apps next.config.js
   * @param userConfig {import('./nextjs-base.config').WithAglynOptions}
   * @returns WithAglynOptions
   **/
  const useAglyn = (userConfig = {}) => {
    const merged = deepFillIn(AGLYN_CONFIG, userConfig),
      aglynConfig = merged.aglyn

    return {
      ...merged,
      // webpack5: typeof userConfig.webpack5 === 'undefined'
      //   ? AGLYN_CONFIG.webpack5
      //   : userConfig.webpack5,

      headers: async () => {
        const aglynConfigHeaders = await AGLYN_CONFIG.headers()
        const nextConfigHeaders = typeof merged?.headers === 'function'
          ? await merged.headers() || []
          : merged?.headers || []

        return [
          ...aglynConfigHeaders,
          ...nextConfigHeaders,
        ]
      },

      webpack: (config, options, ...args) => {
        const aglynWebpackConfig = AGLYN_CONFIG.webpack(config, options, ...args)

        if (aglynConfig.analyzeBundle) {
          const {BundleAnalyzerPlugin} = require('webpack-bundle-analyzer')
          const {
            serverFilename,
            clientFilename,
            analyzerMode,
            ...analyzerOptions
          } = aglynConfig.analyzerOptions
          const fileExt = analyzerMode === 'json' ? 'json' : 'html'

          config.plugins.push(
            new BundleAnalyzerPlugin({
              analyzerMode: analyzerMode || 'static',
              reportFilename: options.isServer
                ? serverFilename || `../analyzer/server.${fileExt}`
                : clientFilename || `./analyzer/client.${fileExt}`,
              ...analyzerOptions,
            }),
          )
        }

        if (typeof merged.webpack === 'function') {
          return merged.webpack(aglynWebpackConfig, options, ...args)
        }

        return aglynWebpackConfig
      },
    }
  }

  return nextComposePlugins([
    useAglyn, withNx,
  ], nextConfig)
}


module.exports = withAglyn
