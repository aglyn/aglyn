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

// Deep import, not the barrel: this module is bundled into the edge
// middleware, and the brand module is the one piece of `@aglyn/aglyn` it needs.
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'

/**
 * The body a middleware 404 carries (AGL-3261).
 *
 * Three gates refuse a path before Next.js routing ever sees it — the
 * `.well-known` namespace (AGL-3016), a non-auth path on the auth origin
 * (AGL-3090), and a first segment that names no workspace on the apex console
 * (AGL-3017). All three were `new NextResponse(null, { status: 404 })`, and a
 * 404 with no body and no `Content-Type` is not a page: a top-level navigation
 * onto one renders as **`ERR_INVALID_RESPONSE` — "This site can't be
 * reached"**, which reads as an outage rather than as a typo. MEASURED against
 * production, where `/support` and `/zzz-not-a-real-org` both answered 404 with
 * zero body bytes while `/billing` answered 200 with 91KB.
 *
 * `app/not-found.tsx` and `app/(app)/not-found.tsx` cannot help here, and that
 * is the whole reason this file exists: middleware answers first, so neither
 * boundary is ever reached for a path these gates refuse. Rewriting into one
 * does not rescue the status either — MEASURED (AGL-3290): the console's
 * server render stops at the loading splash above every page, so a server
 * `notFound()` never reaches the part of the render that sets a status, and
 * `/_missing` answered 200 with the 404 buried in its payload. The refusal
 * stays a refusal, and the body is where the help goes.
 *
 * Shaped after `sanctionsBlockResponse` in `sanctions-geo.ts`, which had the
 * same problem and solved it the same way: one self-contained document with no
 * scripts, because it renders on a response the rest of the console's pipeline
 * never touched.
 *
 * Two bodies, because the gates do not face the same audience:
 *
 * - `notFoundRefusal()` for `.well-known` and the auth origin. Machines probe
 *   those, and a white-label console reaches the first, so it names nobody.
 * - `unknownAddressRefusal()` for the workspace gate, which is where a PERSON
 *   lands — a typo, an old bookmark. It carries the brand and sends the
 *   browser on: to sign in, or into the console's own not-found page.
 */

/**
 * Deliberately names NOBODY.
 *
 * The 451 above it interpolates `operatorIdentity()` because a legal refusal
 * has to say who is refusing. This one does not: a white-label console reaches
 * exactly these gates, and every word that could name a company here would name
 * the wrong one on a deployment that never set `NEXT_PUBLIC_OPERATOR_*` — the
 * AGL-2016 trap, where a self-hosted console told a stranger to appeal to a
 * company that had never heard of them. "Page not found" needs no brand to be
 * true, so it carries none.
 */
const notFoundHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page not found</title></head>
<body style="font:16px/1.6 system-ui,sans-serif;margin:0;padding:12vh 6vw;color:#1a1a1a;background:#fff">
<h1 style="font-size:1.5rem;margin:0 0 1rem">Page not found</h1>
<p style="max-width:44rem;margin:0 0 1rem">There is nothing at this address. A link or a
bookmark that used to lead here may have moved.</p>
<p style="max-width:44rem;margin:0"><a href="/">Start again from the home page</a>.</p>
</body></html>`

/** Shared by both bodies; `notFoundRefusal` below says why each is there. */
const REFUSAL_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Robots-Tag': 'noindex',
} as const

/**
 * The refusal: **404**, with a page a person can read.
 *
 * `no-store` is load bearing rather than tidy. The unknown-slug verdict behind
 * the AGL-3017 gate is cached for five seconds on purpose, so that an org
 * created moments after something probed its slug is reachable at its own
 * address almost immediately. The console sits behind a CDN that caches by URL
 * and not by requester, so a cacheable 404 would pin that refusal onto the new
 * org's own customers for far longer than the verdict it came from was ever
 * trusted.
 *
 * `noindex` because a 404 is already excluded from an index by its status, and
 * the header costs nothing on the one that is served to a crawler walking a
 * dead link.
 */
export function notFoundRefusal(): Response {
  return new Response(notFoundHtml, {
    status: 404,
    headers: REFUSAL_HEADERS,
  })
}

/** Text and attribute safe: the brand is operator configuration. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface UnknownAddressRefusalOptions {
  /**
   * Where the browser goes next: a same-origin path the middleware built,
   * never anything read off the request unchecked.
   */
  forwardTo: string
  /**
   * Whether the request carried a live console session. It changes only the
   * words — where to go was already decided by `forwardTo`.
   */
  signedIn: boolean
}

/**
 * The refusal for an address that names no workspace (AGL-3290).
 *
 * Still a **404**, still no render: the status is what AGL-3017 exists for,
 * and a scanner walking a path list gets exactly what it got before. What
 * changed is who the body is for. The page `app.aglyn.com/sign` produced was a
 * bare "Page not found" that could not tell a signed-out visitor to sign in,
 * and sent a signed-in one to the home page instead of telling them anything
 * in the console.
 *
 * So the body forwards. A meta refresh, not a script and not a redirect: a
 * script would need the nonce this response never gets, and a 3xx would stop
 * answering 404 — at `/oauth/authorize`, a redirect to a sign-in page is the
 * very claim AGL-3017 was filed to stop the console making. A browser follows
 * the refresh at once; the link is there for one that will not.
 *
 * It names the brand, which the static body above deliberately does not. The
 * difference is where each can be served: this one is reached only on the
 * operator's own apex console — a custom console domain is routed into its
 * org before the workspace gate is asked, and a workspace subdomain names its
 * org in the host — so the brand here is always the deployment's own, the
 * same `PLATFORM_BRAND_NAME` on the sign-in page it forwards to. The icon is
 * the favicon glyph the root layout already serves, which an operator swaps
 * in their build context along with the rest of `/_static/images/brand`.
 *
 * No colour literals: the page follows the reader's light or dark scheme
 * through CSS system colours, so it matches the console either way without a
 * palette the console's theme cannot reach. The wave pattern is the one the
 * sign-in page is drawn on, so the hand-off between the two reads as one
 * page loading rather than two.
 */
export function unknownAddressRefusal({
  forwardTo,
  signedIn,
}: UnknownAddressRefusalOptions): Response {
  const brand = escapeHtml(PLATFORM_BRAND_NAME)
  const href = escapeHtml(forwardTo)
  const [message, action] = signedIn
    ? ['There is nothing at this address.', `Continue to ${brand}`]
    : [
        'There is nothing at this address. Sign in, and we’ll show you where ' +
          'to go from here.',
        `Sign in to ${brand}`,
      ]
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${href}">
<title>Page not found · ${brand}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:16px;font:16px/1.6 Roboto,system-ui,-apple-system,"Segoe UI",sans-serif;background:Canvas url(/_static/images/backgrounds/patterns/abstract-wave-lines.svg) center/cover no-repeat;color:CanvasText}
main{width:100%;max-width:440px;text-align:center}
h1{font-size:1.5rem;font-weight:500;margin:16px 0 8px}
p{margin:0 0 24px}
a{font-weight:500}
</style></head>
<body><main>
<img src="/_static/images/brand/icon-256x256.png" alt="${brand}" width="48" height="48">
<h1>Page not found</h1>
<p>${message}</p>
<a href="${href}">${action}</a>
</main></body></html>`
  return new Response(html, { status: 404, headers: REFUSAL_HEADERS })
}
