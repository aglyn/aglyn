//MARK – IMPORTS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withNx = require('@nrwl/next/plugins/with-nx')
const pkg = require('../../package.json')

//MARK – GLOBALS
const isProduction = Boolean(process.env.NODE_ENV === 'production')

module.exports = withNx({
  nx: {
    // Set this to false if you do not want to use SVGR
    // See: https://github.com/gregberge/svgr
    svgr: true,
  },
  target: 'experimental-serverless-trace',
  typescript: {
    // Motivated by https://github.com/zeit/next.js/issues/7687
    ignoreDevErrors: isProduction,
    ignoreBuildErrors: isProduction,
  },
  webpack: (config, options) => {
    const { webpack, buildId } = options
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.BUILD_ID': JSON.stringify(buildId),
        'process.env.VERSION': JSON.stringify(pkg.version),
        'process.env.COMMIT_REF': JSON.stringify(process.env.COMMIT_REF),
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      }),
    )
    return config
  },
})
