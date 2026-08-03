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

/**
 * First-party origins and the CSP directives built from them (AGL-523).
 *
 * Extracted from `with-aglyn.nextjs.config.js` so the **middleware** can build
 * the same policy the config used to emit. That move is the fix for a real
 * production bug, and the reason is worth keeping:
 *
 * The config emitted a static `Content-Security-Policy` response header, and on
 * Vercel that value also lands on the REQUEST the renderer sees. Next resolves
 * the nonce with
 *
 *     headers['content-security-policy'] || headers['content-security-policy-report-only']
 *
 * so a 632-character policy with **no `script-src`** short-circuited the `||`
 * and shadowed the middleware's 75-character nonce policy — which arrived
 * intact under the report-only name and was never read. Result: every script
 * rendered with `nonce="$undefined"`, and enforcing would have served zero
 * JavaScript platform-wide.
 *
 * Measured, not inferred: `/csp-check` on production reported the enforcing
 * header present at 632 chars with `hasScriptSrc: false`, alongside the
 * report-only header at 75 chars with the nonce parsing cleanly.
 *
 * So there must be exactly ONE `Content-Security-Policy` per response, owned by
 * the middleware, and it must carry `script-src`. Plain CommonJS with no
 * imports so the edge runtime can bundle it and `next.config.js` can `require`
 * it.
 */

/** Origins allowed to frame us, and the first-party set generally. */
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
]

/**
 * The non-script half of the policy, unchanged in meaning from what the config
 * used to send: `frame-ancestors` is the clickjacking allowlist, `object-src
 * 'none'` kills `<object>`/`<embed>` plugin-XSS, and `base-uri 'self'` blocks
 * `<base>`-tag hijacking of relative URLs (AGL-518).
 *
 * `isProduction` mirrors the config's own behaviour of also allowing the
 * `http://` forms off production, so local development keeps working.
 */
function baseCspDirectives(isProduction) {
  const remote = PRODUCTION_DOMAINS.map((domain) => `https://${domain}`)
  const local = PRODUCTION_DOMAINS.map((domain) => `http://${domain}`)
  const safe = isProduction ? remote : remote.concat(local)
  return `object-src 'none'; base-uri 'self'; frame-ancestors ${safe.join(' ')}`
}

module.exports = { PRODUCTION_DOMAINS, baseCspDirectives }
