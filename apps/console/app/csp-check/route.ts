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

import { headers } from 'next/headers'

/**
 * Does the CSP nonce the middleware sets on the REQUEST actually reach the
 * renderer? (AGL-523)
 *
 * Production serves `"nonce":"$undefined"` for every script, so no script is
 * nonced, so `strict-dynamic` — which makes `'self'` inert — would block all
 * JavaScript if the policy were enforced. The same production build served from
 * `next start` locally nonces all 50 scripts, so the code is right and
 * something between the middleware and the function differs on Vercel.
 *
 * This route answers that directly instead of by inference. It runs behind the
 * same middleware as a page (the matcher excludes `/api`, not this path) and
 * reports what `headers()` actually contains.
 *
 * **It deliberately reveals no nonce values** — only presence, length and
 * whether Next's own parser would extract something. A nonce is per-request and
 * useless to an attacker who already has the response, but there is no reason
 * to print one, and a diagnostic that leaks is worse than no diagnostic.
 *
 * Temporary: delete once AGL-523 lands. It exists because the alternative is
 * guessing at a security control, which is how this issue's description came to
 * claim the nonce was "verified working live" when it reaches nothing.
 */

/** Next's own extractor, copied so this reports what NEXT would see. */
const CSP_NONCE_SOURCE_REGEX = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/
function nonceFromCsp(value: string | null): string | null {
  if (!value) return null
  const directives = value.split(';').map((directive) => directive.trim())
  const directive =
    directives.find((dir) => dir.startsWith('script-src')) ||
    directives.find((dir) => dir.startsWith('default-src'))
  if (!directive) return null
  for (const source of directive.split(/\s+/).slice(1)) {
    const match = source.trim().match(CSP_NONCE_SOURCE_REGEX)
    if (match) return match[1]
  }
  return null
}

export async function GET(): Promise<Response> {
  const requestHeaders = await headers()
  const enforcing = requestHeaders.get('content-security-policy')
  const reportOnly = requestHeaders.get('content-security-policy-report-only')
  const xNonce = requestHeaders.get('x-nonce')

  // Next prefers the enforcing header and only falls back to report-only, so
  // report both arms: an enforcing header WITHOUT a script-src would shadow a
  // perfectly good report-only one and yield no nonce at all.
  const describe = (value: string | null) => ({
    present: value !== null,
    length: value?.length ?? 0,
    hasScriptSrc: Boolean(value && /(^|;)\s*script-src\b/.test(value)),
    nonceParsed: Boolean(nonceFromCsp(value)),
  })

  return Response.json(
    {
      note: 'AGL-523 diagnostic. No nonce values are returned.',
      // What Next would end up with, by its own precedence rule.
      nextWouldSeeNonce: Boolean(
        nonceFromCsp(enforcing) || (!enforcing && nonceFromCsp(reportOnly)),
      ),
      contentSecurityPolicy: describe(enforcing),
      contentSecurityPolicyReportOnly: describe(reportOnly),
      xNonce: { present: xNonce !== null, length: xNonce?.length ?? 0 },
      // If x-nonce survives and the CSP header does not, the override channel
      // works and the CSP header specifically is being dropped or rewritten.
      middlewareHeaderChannelWorks: xNonce !== null,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  )
}

export const dynamic = 'force-dynamic'
