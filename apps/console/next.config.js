// MARK – IMPORTS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withAglyn = require('../../next.config')

// MARK – GLOBALS
const isProduction = Boolean(process.env.NODE_ENV === 'production')
const securityPolicy = isProduction
  ? 'default-src \'self\' aglyn.com *.aglyn.com'
  : 'default-src \'self\''

module.exports = withAglyn({
  headers: [
    // {
    //   key: 'Content-Security-Policy',
    //   value: securityPolicy,
    // },
  ],
})
