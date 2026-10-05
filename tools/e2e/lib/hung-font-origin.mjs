/**
 * @license
 * Copyright 2026 Aglyn LLC
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

// The font origin, hung — preloaded into the tenant production smoke's SECOND
// server with `node --import` (AGL-3566). Never loaded by the app itself.
//
// Every fetch to Google's stylesheet origin answers with a promise that never
// settles, whatever signal the caller passed. That is the failure beta.222 met
// on Vercel (AGL-3565): `AbortSignal.timeout(2500)` was on the request, the
// promise still never settled, and the layout's await on it held every
// uncached client page to the 60 s function limit.
//
// A local server that accepts and never answers is NOT this fault, and was
// tried first: undici honors the abort signal against a silent socket, the
// fetch rejects at 2.5 s, and the pre-hotfix module rendered every page in
// under 3 s — green against the very code that took production down. What
// has to be simulated is the promise that does not settle, because "the
// signal will bound it" is the assumption that failed.
//
// Installed BEFORE Next patches `fetch`, so Next's patched fetch — its data
// cache, its per-key lock and its dedupe — wraps this one exactly as it wraps
// undici in production. Only the origin's answer is replaced.

const HUNG_HOSTNAME = 'fonts.googleapis.com'

/**
 * What this module prints, which the smoke reads back from the server's
 * output (spelled out again there — importing this module installs it):
 * that it loaded, and that a request really was held. Without both, the hung
 * pass would quietly be a second live pass.
 */
const HUNG_FONT_ORIGIN_INSTALLED = '[hung-font-origin] installed'
const HUNG_FONT_ORIGIN_HELD = '[hung-font-origin] holding open forever'

const originalFetch = globalThis.fetch

const urlOf = (input) => {
  try {
    if (typeof input === 'string') return new URL(input)
    if (input instanceof URL) return input
    return new URL(input?.url)
  } catch {
    return null
  }
}

globalThis.fetch = function hungFontOriginFetch(input, init) {
  if (urlOf(input)?.hostname === HUNG_HOSTNAME) {
    console.log(`${HUNG_FONT_ORIGIN_HELD}: ${urlOf(input).href}`)
    return new Promise(() => {})
  }
  return originalFetch.call(this, input, init)
}

console.log(`${HUNG_FONT_ORIGIN_INSTALLED} (pid ${process.pid})`)
