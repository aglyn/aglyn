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

const nextComposePlugins = require('next-compose-plugins')
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer')
const pkg = require('../package.json')
const withNx = require('@nrwl/next/plugins/with-nx')
const deepFillIn = require('mout/object/deepFillIn')

const PACKAGE_VERSION = String(pkg?.version ?? '0.0.0')
const PROCESS_VERSION = String(process.version)
const PROCESS_VERSIONS = process.versions

const NODE_ENV = process.env.NODE_ENV
const IS_DEVELOPMENT = NODE_ENV === 'development'
const IS_PRODUCTION = NODE_ENV === 'production'
const IS_TEST = NODE_ENV === 'test'

const ANALYZE_BUNDLE = process.env.NEXT_ANALYZE_BUNDLE === 'true'

let REMOTE_DOMAINS = [
  'aglyn.com',
  'app.aglyn.com',
  'bucket.aglyn.com',
  'cdn.aglyn.com',
  'cloud.aglyn.com',
  'cname.aglyn.com',
  'console.aglyn.com',
  'proxy.aglyn.com',
  'space.aglyn.com',
  'static.aglyn.com',
  'storage.aglyn.com',
  'tenant.aglyn.com',
  'host.aglyn.com',
  'hostname.aglyn.com',
  'www.aglyn.com',
  'aglyn.app',
]
let LOCAL_DOMAINS = [
  'localhost',
  'localhost:4000',
  'localhost:4100',
  'localhost:4200',
  'localhost:4210',
  'localhost:4300',
  'localhost:4400',
  'localhost:4500',
]
const REMOTE_URLS = REMOTE_DOMAINS.map((i) => `https://${i}`)
const LOCAL_URLS = REMOTE_DOMAINS.map((i) => `http://${i}`)
const SAFE_DOMAINS = !IS_PRODUCTION
  ? REMOTE_DOMAINS.concat(LOCAL_DOMAINS)
  : REMOTE_DOMAINS
const SAFE_URLS = !IS_PRODUCTION ? REMOTE_URLS.concat(LOCAL_URLS) : REMOTE_URLS

const SECURITY_HEADERS = [
  /**
   * This header indicates whether the site should be allowed to be displayed
   * within an iframe. This can prevent against clickjacking attacks. This
   * header has been superseded by CSP's frame-ancestors option, which has
   * better support in modern browsers.
   */
  {
    key: 'X-Frame-Options',
    value: `allow-from ${SAFE_URLS.join(' ')}`,
  },

  /**
   * This header helps prevent cross-site scripting (XSS), clickjacking and
   * other code injection attacks. Content Security Policy (CSP) can specify
   * allowed origins for content including scripts, stylesheets, images, fonts,
   * objects, media (audio, video), iframes, and more.
   */
  {
    key: 'Content-Security-Policy',
    value: `frame-ancestors ${SAFE_URLS.join(' ')}`,
  },

  /**
   * This header controls DNS prefetching, allowing browsers to proactively
   * perform domain name resolution on external links, images, CSS, JavaScript,
   * and more. This prefetching is performed in the background, so the DNS is
   * more likely to be resolved by the time the referenced items are needed.
   * This reduces latency when the user clicks a link.
   */
  { key: 'X-DNS-Prefetch-Control', value: 'on' },

  /**
   * This header prevents the browser from attempting to guess the type of
   * content if the Content-Type header is not explicitly set. This can prevent
   * XSS exploits for websites that allow users to upload and share files. For
   * example, a user trying to download an image, but having it treated as a
   * different Content-Type like an executable, which could be malicious. This
   * header also applies to downloading browser extensions. The only valid
   * value for this header is nosniff.
   */
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  /**
   * This header stops pages from loading when they detect reflected cross-site
   * scripting (XSS) attacks. Although this protection is not necessary when
   * sites implement a strong Content-Security-Policy disabling the use of
   * inline JavaScript ('unsafe-inline'), it can still provide protection for
   * older web browsers that don't support CSP.
   */
  { key: 'X-XSS-Protection', value: '1; mode=block' },

  /**
   * This header informs browsers it should only be accessed using HTTPS,
   * instead of using HTTP. Using the configuration below, all present and
   * future subdomains will use HTTPS for a max-age of 2 years. This blocks
   * access to pages or subdomains that can only be served over HTTP.
   *
   * Note: If you're deploying to Vercel, this header is not necessary as it's
   * automatically added to all deployments.
   */
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const BRAND_HEADERS = [
  { key: 'x-aglyn-package-version', value: PACKAGE_VERSION },
  { key: 'x-aglyn-process-version', value: PROCESS_VERSION },
]

/**
 * Base configuration for NextJS Apps next.config.js
 * @type {import('./nextjs-base.config').WithAglynOptions}
 **/
const AGLYN_CONFIG = {
  aglyn: {
    analyzeBundle: ANALYZE_BUNDLE && !IS_PRODUCTION,
    analyzerOptions: {},
  },
  compiler: {
    /**
     * Enables automatically removing JSX properties. These are often used for
     * testing. Similar to babel-plugin-react-remove-properties.
     *
     * Note: The regexes defined here are processed in Rust so the syntax is
     * different from {@link RegExp | JavaScript `RegEx`}
     *
     * @example reactRemoveProperties: {properties: ['^data-custom$']}
     * @example reactRemoveProperties: true || false
     * @see {@link https://docs.rs/regex | Rust Regex Docs}
     * @inheritDoc
     */
    reactRemoveProperties: { properties: ['^data-test'] },

    /**
     * ssr and displayName are configured by default
     */
    // styledComponents: true,
  },

  /**
   * Next.js provides gzip compression to compress rendered content and static
   * files. In general, you will want to enable compression on a HTTP proxy like
   * nginx, to offload load from the Node.js process.
   */
  compress: IS_PRODUCTION,

  crossOrigin: IS_PRODUCTION ? 'anonymous' : undefined,
  env: {
    AGLYN_HOST: process.env.AGLYN_HOST,
    AGLYN_HOSTNAME: process.env.AGLYN_HOSTNAME,
    AGLYN_PORT: process.env.AGLYN_PORT,
    AGLYN_PROTOCOL: process.env.AGLYN_PROTOCOL,
    AGLYN_URL: process.env.AGLYN_URL,
    COMMIT_REF: process.env.COMMIT_REF,
    PACKAGE_VERSION: PACKAGE_VERSION,
    PROCESS_VERSION: process.version,
    PROCESS_VERSIONS: process.versions,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_URL: process.env.VERCEL_URL,
  },
  eslint: {
    ignoreDuringBuilds: IS_PRODUCTION,
  },
  experimental: {
    optimizeImages: IS_PRODUCTION,
    // optimizeCss: true,
    /**
     * Next.js can automatically create a standalone folder which copies only
     * the necessary files for a production deployment including select files in
     * node_modules
     */
    outputStandalone: false,
    /**
     * Concurrent features in React 18 include built-in support for server-side
     * Suspense and SSR streaming support, allowing you to server-render pages
     * using HTTP streaming
     */
    concurrentFeatures: false,
    /**
     * React Server Components allow us to render everything, including the
     * components themselves, on the server. This is fundamentally different
     * from server-side rendering where you're pre-generating HTML on the server
     */
    serverComponents: false,
    workerThreads: true,

    /**
     * required to stop the FATAL heap crash
     */
    esmExternals: false,
  },
  generateEtags: true,
  headers: async () => {
    return [
      {
        source: '/(.*)',
        headers: [...SECURITY_HEADERS, ...BRAND_HEADERS],
      },
    ]
  },
  httpAgentOptions: { keepAlive: true },
  images: {
    /**
     * deviceSizes
     * DEFAULT [640, 750, 828, 1080, 1200, 1920, 2048, 3840]
     */
    deviceSizes: [600, 768, 900, 1080, 1200, 1536, 1920, 2560],
    disableStaticImages: false,
    domains: SAFE_DOMAINS,
    /**
     * imageSizes
     * DEFAULT: [16, 32, 48, 64, 96, 128, 256, 384]
     */
    imageSizes: [24, 40, 64, 96, 144, 256, 390, 512],
    formats: ['image/avif', 'image/webp'],
    loader: 'default',
    minimumCacheTTL: 60 * 60 * 24, // 24hrs = 86400sec
    path: '/_next/image',
  },
  nx: {
    /**
     * Set this to false if you do not want to use SVGR
     * @see https://github.com/gregberge/svgr
     */
    svgr: false,
  },
  onDemandEntries: {
    /**
     * period (in ms) where the server will keep pages in the buffer
     */
    maxInactiveAge: 1000 * 30,
    /**
     * number of pages that should be kept simultaneously without being disposed
     */
    pagesBufferLength: 2,
  },
  optimizeFonts: IS_PRODUCTION,
  // outputFileTracing: true,
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  /**
   * Available on both server and client
   */
  publicRuntimeConfig: {
    staticFolder: '/_static',
  },
  reactStrictMode: !IS_PRODUCTION,
  /**
   * Available on server only
   */
  serverRuntimeConfig: {},
  staticPageGenerationTimeout: 15,

  /**
   * Opt-in to using the Next.js compiler for minification. This is 7x faster
   * than Terser.
   */
  swcMinify: true,

  /**
   * Include a trailing slash for page paths
   */
  trailingSlash: false,

  typescript: {
    /**
     * Motivated by https://github.com/zeit/next.js/issues/7687
     */
    // ignoreDevErrors: IS_PRODUCTION,
    ignoreBuildErrors: IS_PRODUCTION,
  },
  // Disable production source maps
  webpack: (config, options) => {
    const { webpack, buildId, isServer } = options
    // if (!isServer) {
    //   /** @see https://github.com/vercel/next.js/issues/7755#issuecomment-812805708 */
    //   config.resolve.fallback.fs = false
    // }
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
  console.log(
    'process.env.NODE_ENV',
    NODE_ENV,
    '; CSRF_SECRET',
    process.env.CSRF_SECRET,
  )

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

      generateBuildId: async () => {
        console.log('merged?.generateBuildId', merged?.generateBuildId())
        return await ((typeof merged?.generateBuildId === 'function' &&
          merged.generateBuildId()) ||
          getCommitRef())
      },

      headers: async () => {
        const aglynConfigHeaders = await AGLYN_CONFIG.headers()
        const nextConfigHeaders =
          typeof merged.headers === 'function'
            ? (await merged.headers()) || []
            : merged?.headers || []

        return [...aglynConfigHeaders, ...nextConfigHeaders]
      },

      webpack: (webpackConfig, options) => {
        const config = AGLYN_CONFIG.webpack(webpackConfig, options)

        if (aglynConfig.analyzeBundle) {
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
          return merged.webpack(config, options)
        }

        return config
      },
    }
  }

  return nextComposePlugins([useAglyn, withNx], nextConfig)
}

module.exports = withAglyn

function getCommitRef() {
  return (
    (
      process.env.COMMIT_REF ||
      process.env.NEXT_PUBLIC_COMMIT_REF ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      ''
    ).slice(0, 6) || null
  )
}
