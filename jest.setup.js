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
;(() => {
  let raw
  try {
    raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  } catch {
    return // no root .env (CI) — nothing leaked, nothing to undo
  }
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
    if (!match) continue
    const [, key] = match
    let value = match[2].trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted) value = value.slice(1, -1)
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
if (typeof global.fetch === 'undefined') {
  global.fetch = globalThis.fetch
  global.Headers = globalThis.Headers
  global.Request = globalThis.Request
  global.Response = globalThis.Response
}
