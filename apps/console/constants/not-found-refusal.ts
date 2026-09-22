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
 * would fix the body and lose what the gates are for — AGL-3017 is explicit
 * that a scanner walking a path list must not cost a render — so the refusal
 * stays a refusal and simply says so in HTML.
 *
 * Shaped after `sanctionsBlockResponse` in `sanctions-geo.ts`, which had the
 * same problem and solved it the same way: one self-contained document, no
 * scripts and no assets, because it renders on a response the rest of the
 * console's pipeline never touched.
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
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Robots-Tag': 'noindex',
    },
  })
}
