const { TextEncoder, TextDecoder } = require('util')
const fs = require('fs')
const path = require('path')

// Keep tests hermetic (AGL-690). nx loads the repo-root .env into every
// task it runs, tests included, so a spec that should fail closed on a
// missing env var instead passes on the developer's real secret — and then
// fails in CI, which has no .env. That is how AGL-689 (gated-video tokens
// signed with a forgeable key) stayed green under coverage that exercised
// the exact mint path.
//
// Undo it here rather than via NX_LOAD_DOT_ENV_FILES=false so it holds no
// matter how jest is invoked — `nx test`, bare `jest`, or an IDE runner.
// Only values that still match the .env file are removed, so a variable CI
// genuinely provides survives even if it shares a name.
//
// PARSED BY DOTENV ITSELF, NOT BY A REGEX (AGL-1152).
//
// This used to read the file line by line and strip one layer of quotes. That
// is not what dotenv does: inside a DOUBLE-QUOTED value it also expands escape
// sequences, so a `.env` holding `FIREBASE_PRIVATE_KEY="-----BEGIN…\n…"` is
// loaded with REAL newlines — 1704 characters against the 1732 the raw text
// spells out. The comparison below then failed, the delete never happened, and
// the developer's actual private key sat in `process.env` for every spec in the
// workspace. It was the ONLY variable of the 17 that escaped, because it is the
// only one containing an escape sequence — which is to say the scrubber leaked
// precisely the class of secret it exists to contain, and AGL-689 was itself a
// signing-key bug.
//
// The visible symptom was 9 tenant suites failing to load: the private key
// survived, the single-line client email did not, and `cert()` refuses a
// partial credential.
//
// Using dotenv's own parser means there is no second implementation of its
// quoting and escaping rules to drift out of step with it.
;(() => {
  let raw
  try {
    raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  } catch {
    return // no root .env (CI) — nothing leaked, nothing to undo
  }
  let parsed
  try {
    parsed = require('dotenv').parse(raw)
  } catch {
    return // dotenv absent — fail open rather than take every suite down
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === value) delete process.env[key]
  }
})()

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
//
// NOTE (AGL-1139): under `testEnvironment: 'jsdom'` this block does nothing —
// `globalThis.fetch` is undefined inside the jsdom sandbox too, so it assigns
// undefined over undefined. A jsdom spec that needs `Response` has to bring
// its own; a spec that can run on `node` already has the real ones.
if (typeof global.fetch === 'undefined') {
  global.fetch = globalThis.fetch
  global.Headers = globalThis.Headers
  global.Request = globalThis.Request
  global.Response = globalThis.Response
}
