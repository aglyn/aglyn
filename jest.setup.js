const { TextEncoder, TextDecoder } = require('util')

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder
}

// firebase v12's @firebase/auth references the Fetch API directly at
// module load time. jsdom (jest's default test environment) doesn't
// implement fetch, so importing firebase/auth throws `ReferenceError:
// fetch is not defined` before any test code runs. Node's own built-in
// fetch (available as a bare global in this setup script's realm, same as
// TextEncoder above) covers it without pulling in extra web-platform deps.
if (typeof global.fetch === 'undefined') {
  global.fetch = globalThis.fetch
  global.Headers = globalThis.Headers
  global.Request = globalThis.Request
  global.Response = globalThis.Response
}
