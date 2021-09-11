// MARK – IMPORTS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withNx = require('@nrwl/next/plugins/with-nx')

// MARK – GLOBALS
const isProduction = Boolean(process.env.NODE_ENV === 'production')
const securityPolicy = isProduction
  ? 'default-src \'self\' aglyn.com *.aglyn.com'
  : 'default-src \'self\''

module.exports = withNx({
  headers: [
    // {
    //   key: 'Content-Security-Policy',
    //   value: securityPolicy,
    // },
  ],
})
