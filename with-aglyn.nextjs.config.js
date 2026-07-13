/**
 * @license
 * Copyright 2023 Aglyn LLC
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

const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer')
const pkg = require('./package.json')
const withNx = require('@nx/next/plugins/with-nx')
const deepFillIn = require('mout/object/deepFillIn')

const PACKAGE_VERSION = String(pkg?.version ?? '0.0.0')
const PROCESS_VERSION = String(process.version)
const PROCESS_VERSIONS = process.versions

const NODE_ENV = process.env.NODE_ENV
const IS_DEVELOPMENT = NODE_ENV === 'development'
const IS_PRODUCTION = NODE_ENV === 'production'
const IS_TEST = NODE_ENV === 'test'

const ANALYZE_BUNDLE = process.env.NEXT_ANALYZE_BUNDLE === 'true'

const PRODUCTION_DOMAINS = [
  'aglyn.io',
  'admin.aglyn.com',
  'admin.aglyn.io',
  'aglyn.com',
  'app.aglyn.com',
  'app.aglyn.io',
  // Dedicated OAuth origin (AGL-462/465): the Firebase auth helper iframe
  // is served here, so it must be able to frame itself (frame-ancestors).
  'auth.aglyn.com',
  'auth.aglyn.io',
  'cdn.aglyn.com',
  'cdn.aglyn.io',
  'cname.aglyn.com',
  'cname.aglyn.io',
  'console.aglyn.com',
  'console.aglyn.io',
  'demo.aglyn.com',
  'demo.aglyn.io',
  'host.aglyn.com',
  'host.aglyn.io',
  'io.aglyn.com',
  'io.aglyn.io',
  'proxy.aglyn.com',
  'proxy.aglyn.io',
  'tenant.aglyn.com',
  'tenant.aglyn.io',
  'www.aglyn.com',
  'www.aglyn.io',

  // // Ideas
  // 'app.aglyn.com',
  // 'bucket.aglyn.com',
  // 'cloud.aglyn.com',
  // 'proxy.aglyn.com',
  // 'space.aglyn.com',
  // 'static.aglyn.com',
  // 'storage.aglyn.com',
  // 'host.aglyn.com',
  // 'hostname.aglyn.com',
]

const DEVELOPMENT_DOMAINS = IS_PRODUCTION
  ? []
  : [
      'localhost',
      'localhost:4000',
      'localhost:4100',
      'localhost:4200', // console / app
      'localhost:4210',
      'localhost:4300',
      'localhost:4400',
      'localhost:4500', // tenant
    ]

const REMOTE_URLS = PRODUCTION_DOMAINS.map((i) => `https://${i}`)
const LOCAL_URLS = PRODUCTION_DOMAINS.map((i) => `http://${i}`)
const SAFE_URLS = !IS_PRODUCTION ? REMOTE_URLS.concat(LOCAL_URLS) : REMOTE_URLS

const SAFE_DOMAINS = !IS_PRODUCTION
  ? PRODUCTION_DOMAINS.concat(DEVELOPMENT_DOMAINS)
  : PRODUCTION_DOMAINS

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
 * @type {import('./with-aglyn.nextjs.config').WithAglynOptions}
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
    reactRemoveProperties: { properties: ['^data-test', 'displayName'] },

    /**
     * ssr and displayName are configured by default
     */
    // styledComponents: true,
    // emotion: {}
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
    FIREBASE_AUTH_EMULATOR_ENABLED: process.env.FIREBASE_AUTH_EMULATOR_ENABLED,
    FIREBASE_DATABASE_EMULATOR_ENABLED: process.env.FIREBASE_DATABASE_EMULATOR_ENABLED,
    FIREBASE_FIRESTORE_EMULATOR_ENABLED: process.env.FIREBASE_FIRESTORE_EMULATOR_ENABLED,
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
  /**
   * Disable the static/dynamic page dev indicator.
   * In Next.js 16 the handleStaticIndicator function accesses
   * window.next.router.components before the Pages Router is initialized,
   * causing a race-condition TypeError on every page load in dev.
   * Setting this to false compiles out the entire indicator code path.
   */
  devIndicators: false,

  experimental: {
    workerThreads: true,

    /**
     * required to stop the FATAL heap crash
     */
    esmExternals: false,

    // optimizeCss: true,
  },

  /**
   * Bundle @mui/* packages through webpack instead of treating them as Node.js
   * externals. This resolves a systemic ESM/CJS interop mismatch: with
   * esmExternals:false, MUI's *.mjs files are compiled by webpack without the
   * c.n() harmony interop wrapper (because webpack sees their imports as ESM at
   * build time), but at runtime require() returns { __esModule:true, default:fn }
   * instead of a callable function — causing TypeError: m is not a function
   * during Next.js "Collecting page data". Transpiling keeps all interop inside
   * webpack's own module graph, where it is handled correctly.
   */
  transpilePackages: [
    '@emotion/cache',
    '@emotion/react',
    '@emotion/serialize',
    '@emotion/styled',
    '@mui/base',
    '@mui/icons-material',
    '@mui/lab',
    '@mui/material',
    '@mui/private-theming',
    '@mui/styled-engine',
    '@mui/styles',
    '@mui/system',
    '@mui/utils',
    '@mui/x-data-grid',
    '@mui/x-date-pickers',
    '@mui/x-virtualizer',
    '@popperjs/core',
  ],
  turbopack: {
    rules: {
      '*.svg': {
        loaders: [
          {
            loader: '@svgr/webpack',
            options: {
              exportType: 'named',
              namedExport: 'ReactComponent',
              plugins: ['@svgr/plugin-jsx'],
            },
          },
        ],
        as: '*.js',
      },
    },
  },
  /**
   * Next.js can automatically create a standalone folder which copies only
   * the necessary files for a production deployment including select files in
   * node_modules
   */
  // output: 'standalone',

  pageExtensions: ['mdx', 'md', 'jsx', 'js', 'tsx', 'ts'],
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
    deviceSizes: [640, 768, 828, 1080, 1200, 1920, 2048, 3840],
    disableStaticImages: false,
    domains: SAFE_DOMAINS,
    /**
     * imageSizes
     * DEFAULT: [16, 32, 48, 64, 96, 128, 256, 384]
     */
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
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
    svgr: true,
  },
  // onDemandEntries: {
  //   /**
  //    * period (in ms) where the server will keep pages in the buffer
  //    */
  //   maxInactiveAge: 1000 * 30,
  //   /**
  //    * number of pages that should be kept simultaneously without being disposed
  //    */
  //   pagesBufferLength: 2,
  // },
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
    /**
     * Next resolves tsconfig `paths` against the app dir, while TypeScript 7
     * (no baseUrl) declares them root-relative in tsconfig.base.json
     * (AGL-460). Each app carries a generated Next-only tsconfig with the
     * aliases rebased — regenerate via tools/scripts/sync-next-tsconfigs.mjs.
     * See docs/TYPESCRIPT7.md.
     */
    tsconfigPath: 'tsconfig.next.json',
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

    // SVGR: process *.svg files imported from JS/TS with named ReactComponent export.
    // nx.svgr:true is a no-op in @nx/next v22 withNx; the rule must be added explicitly.
    // Exclude SVGs from ALL existing asset/resource rules (Next.js may register more than one).
    config.module.rules.forEach((rule) => {
      if (rule.test instanceof RegExp && rule.test.test('.svg')) {
        rule.exclude = /\.svg$/i
      }
    })
    config.module.rules.push({
      test: /\.svg$/i,
      issuer: /\.[jt]sx?$/,
      // Prevent webpack 5 asset module type from overriding loader output.
      type: 'javascript/auto',
      use: [
        {
          loader: '@svgr/webpack',
          options: {
            exportType: 'named',
            namedExport: 'ReactComponent',
            // Explicitly list only the JSX plugin so SVGO never runs.
            // SVGO (included by @svgr/webpack's defaultPlugins) fails on SVG files
            // that start with a comment node instead of the <svg> element.
            plugins: ['@svgr/plugin-jsx'],
          },
        },
      ],
    })

    return config
  },
}

/**
 * Base configuration for NextJS Apps next.config.js
 * @param nextConfig {import('./with-aglyn.nextjs.config').WithAglynOptions}
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
   * @param userConfig {import('./with-aglyn.nextjs.config').WithAglynOptions}
   * @returns WithAglynOptions
   **/
  const handleUserConfig = (userConfig = {}) => {
    const { aglyn: aglynConfig, ...merged } = deepFillIn(
      AGLYN_CONFIG,
      userConfig,
    )

    return {
      ...merged,
      // webpack5: typeof userConfig.webpack5 === 'undefined'
      //   ? AGLYN_CONFIG.webpack5
      //   : userConfig.webpack5,

      generateBuildId: async () => {
        let buildId
        if (typeof merged?.generateBuildId === 'function') {
          const response = await merged?.generateBuildId?.()
          if (response) buildId = response
        }
        if (!buildId) buildId = await getCommitRef()
        console.log('generateBuildId', buildId)
        return buildId
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

        if (typeof userConfig.webpack === 'function') {
          return userConfig.webpack(config, options)
        }

        return config
      },
    }
  }

  return withNx(handleUserConfig(nextConfig))
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
