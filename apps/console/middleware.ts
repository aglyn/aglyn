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

import { NextResponse, type NextRequest } from 'next/server'
import { APEX_LABELS, WORKSPACE_DOMAIN } from './constants/workspace-domain'
// One source of truth for the frame-ancestors allowlist, shared with
// `with-aglyn.nextjs.config.js` so the two cannot drift (AGL-523).
//
// It lives at the repo root rather than in a lib because `next.config.js` —
// plain CommonJS, and not an nx project — has to `require` it too. Routing it
// through a lib would mean the config could not read it, and the two would
// drift into disagreeing CSPs, which is the exact class of bug AGL-523 was.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { baseCspDirectives } from '../../security-origins'

/**
 * Where violations are posted (AGL-523). Same-origin and outside the matcher
 * below, so reporting cannot recurse through this middleware.
 */
const CSP_REPORT_PATH = '/api/csp-report'

/** The `Reporting-Endpoints` group name `report-to` resolves against. */
const CSP_REPORT_GROUP = 'csp'

/**
 * Workspace-subdomain gate (AGL-236): on `{slug}.<workspace domain>`
 * requests, verifies the slug against the `orgSlugs` collection and bounces
 * unknown workspaces to the apex console. In-app org scoping stays
 * client-side (OrgScopeProvider); this only stops dead subdomains
 * from rendering a broken console.
 *
 * This gate spent its whole life switched off. `WORKSPACE_DOMAIN` was a local
 * `process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN` with no fallback while seven
 * other copies of the same constant defaulted to `'aglyn.com'`, and the var is
 * unset in production — so the file that decided WHO MAY BE SERVED opted out
 * while the file that mints `__session` did not. It now shares one constant
 * with them (`constants/workspace-domain.ts`), which is the actual fix; the
 * missing `??` was only how it surfaced.
 *
 * NOTE: `/api/*` is outside the matcher below, so this is not a boundary on
 * its own — the Vercel domain allowlist is. This layer stops an unregistered
 * host from rendering a console; it cannot stop one from calling an API route.
 */

/**
 * First path segments that are never org-scoped (AGL-627). These live at the
 * apex path on every host, so the workspace-subdomain rewrite must leave them
 * alone or `/signin` would become `/{slug}/signin` and 404.
 */
const APEX_PATH_SEGMENTS = new Set([
  'manage',
  'admin',
  'signin',
  'signout',
  'signup',
  'verify-email',
  'account-recovery',
])
const CACHE_TTL_MS = 60_000
type SlugVerdict = { known: boolean; movedTo: string | null; at: number }
const slugCache = new Map<string, SlugVerdict>()

/**
 * Ask our own Admin-SDK route whether a workspace slug exists.
 *
 * The previous implementation read Firestore's REST API directly with the
 * public web key. On this project that returns `403 PERMISSION_DENIED` for
 * every slug — App Check is enforced, and an edge request carries no App
 * Check token. Since only 200 and 404 were treated as authoritative, a 403
 * fell through to `{ known: true }`, so ARMING THIS GATE WOULD HAVE MADE
 * THINGS WORSE: every rogue subdomain would have been judged a real workspace
 * and had its path rewritten into `/{slug}/…`.
 *
 * `/api/*` is excluded from the matcher, so calling our own origin here
 * cannot recurse.
 *
 * The call goes to THIS request's own origin, not to a hardcoded apex. An
 * earlier draft used `https://app.<domain>` for "robustness" and it was
 * strictly worse: a preview deployment would have asked production for a
 * verdict, and a build whose verdict route did not exist upstream yet failed
 * open silently — which is how this was caught. The request has already
 * reached this deployment, so its origin resolves here by construction.
 */
async function resolveOrgSlug(
  slug: string,
  origin: string,
): Promise<Omit<SlugVerdict, 'at'>> {
  const cached = slugCache.get(slug)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached
  try {
    const response = await fetch(
      `${origin}/api/orgs/slug-verdict?slug=${encodeURIComponent(slug)}`,
      { headers: { accept: 'application/json' } },
    )
    if (!response.ok) return { known: true, movedTo: null }
    const payload = await response.json().catch(() => null)
    if (payload == null || typeof payload.known !== 'boolean') {
      return { known: true, movedTo: null }
    }
    // A degraded verdict is the route telling us it could not reach Firestore.
    // Honour it for this request but never cache it, or one blip pins every
    // slug open for the full TTL.
    if (payload.degraded) return { known: true, movedTo: null }
    const verdict = {
      known: payload.known as boolean,
      movedTo: (payload.movedTo as string | null) ?? null,
      at: Date.now(),
    }
    slugCache.set(slug, verdict)
    return verdict
  } catch {
    return { known: true, movedTo: null }
  }
}

export async function middleware(request: NextRequest) {
  // CSP script-src: ENFORCING for everyone (AGL-518, AGL-523).
  //
  // The rule everything here follows, found by measurement and documented
  // nowhere: **the response `Content-Security-Policy` is copied onto the
  // request the renderer reads.** Next resolves the nonce with
  // `content-security-policy || …-report-only`, so an enforcing policy that
  // carries no `script-src` short-circuits the `||` and shadows the nonce
  // policy entirely — which is why every script rendered `nonce="$undefined"`
  // while a perfectly good nonce sat in the report-only header.
  //
  // The consequence that decided the shape below: "script-src report-only" and
  // "the nonce works" cannot both be true. Leaving `script-src` out of the
  // enforcing header is what breaks the nonce. So there is exactly ONE policy
  // header, and it carries script-src.
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const baseDirectives = baseCspDirectives(
    process.env.NODE_ENV === 'production',
  )
  // Not `strict-dynamic`, and this is MEASURED, not assumed — the same
  // signed-in flow was run under both policies and counted:
  //
  //   script-src 'self' https: blob: 'nonce-…'  →   1 violation
  //   'strict-dynamic'                          →  70 violations
  //
  // `strict-dynamic` makes `'self'`, `https:` and `blob:` inert, and nonce
  // propagation does not reach Next's chunk loads — so `'self'` going inert
  // takes the whole bundle with it. Do not re-adopt it without fixing that
  // first.
  //
  // The single remaining violation is `script-src / eval`, and it is benign:
  // `Function("return function*() {}")` inside a try/catch — the feature probe
  // in `is-generator-function`. Blocked, it is caught and returns false, so no
  // `'unsafe-eval'` is needed (AGL-1238 tracks dropping the dependency).
  //
  // This still blocks the real XSS vector — an injected inline `<script>` has
  // no nonce and does not run — plus `http:` and `data:` sources.
  const scriptSrc = `script-src 'self' https: blob: 'nonce-${nonce}'`
  // BOTH directives, because neither is universally supported: `report-uri` is
  // deprecated but is what Safari and older Chrome actually send, while
  // `report-to` is the modern one and needs the `Reporting-Endpoints` header
  // below to resolve its group name. Sending one alone loses a browser family,
  // and `csp-report.ts` reads both wire formats for the same reason.
  const reportDirectives =
    `report-uri ${CSP_REPORT_PATH}; report-to ${CSP_REPORT_GROUP}`
  // `x-nonce` is for our own inline scripts to read via `headers()`; Next's own
  // scripts are nonced from the CSP header, not from this.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  const applyCsp = (res: NextResponse) => {
    // Resolves the `report-to` group named in the policies below. Without this
    // header `report-to` names a group the browser has never heard of and is
    // silently ignored — which looks exactly like "no violations", the same
    // false all-clear this whole endpoint exists to end.
    res.headers.set(
      'Reporting-Endpoints',
      `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`,
    )
    // ONE policy carrying script-src and the base directives together, so it is
    // self-consistent by construction: the nonce Next stamps on scripts is read
    // from this exact string. Splitting them is what shadowed the nonce — see
    // the note above `nonce`.
    //
    // Reporting stays on now that it enforces: a violation here is a script
    // that DID NOT run, which is the most urgent thing the log can carry.
    res.headers.set(
      'Content-Security-Policy',
      `${scriptSrc}; ${baseDirectives}; ${reportDirectives}`,
    )
    return res
  }
  const pass = () =>
    applyCsp(NextResponse.next({ request: { headers: requestHeaders } }))
  const rewriteTo = (url: URL) =>
    applyCsp(
      NextResponse.rewrite(url, { request: { headers: requestHeaders } }),
    )

  const hostname = (request.headers.get('host') ?? '').split(':')[0].toLowerCase()
  if (hostname === WORKSPACE_DOMAIN || !hostname.endsWith(`.${WORKSPACE_DOMAIN}`)) {
    return pass()
  }
  const slug = hostname.slice(0, -(WORKSPACE_DOMAIN.length + 1))
  if (slug.includes('.') || APEX_LABELS.has(slug)) {
    return pass()
  }
  const verdict = await resolveOrgSlug(slug, new URL(request.url).origin)
  if (verdict.movedTo) {
    const moved = request.nextUrl.clone()
    moved.hostname = `${verdict.movedTo}.${WORKSPACE_DOMAIN}`
    return NextResponse.redirect(moved, 308)
  }
  if (verdict.known) {
    // On a workspace subdomain the org IS the hostname, so the path should
    // not repeat it (AGL-627): `acme.aglyn.com/hosts/x`, never
    // `acme.aglyn.com/acme/hosts/x`. Routes are still the canonical
    // `/[orgSlug]/…` underneath, so rewrite the org segment back in.
    //
    // Account, staff and auth routes are NOT org-scoped and must not be
    // rewritten — they exist at the apex path on every host. An already
    // prefixed path passes through so canonical links keep working.
    const segments = request.nextUrl.pathname.split('/').filter(Boolean)
    const first = segments[0]
    if (first !== slug && !APEX_PATH_SEGMENTS.has(first ?? '')) {
      const rewritten = request.nextUrl.clone()
      rewritten.pathname = `/${slug}${
        request.nextUrl.pathname === '/' ? '' : request.nextUrl.pathname
      }`
      return rewriteTo(rewritten)
    }
    return pass()
  }
  const apex = request.nextUrl.clone()
  apex.hostname = `app.${WORKSPACE_DOMAIN}`
  apex.pathname = '/'
  apex.search = `?unknown-workspace=${encodeURIComponent(slug)}`
  return NextResponse.redirect(apex)
}

export const config = {
  // Pages and data routes only — assets, API routes, and the Firebase
  // auth-helper namespace (/__/*, AGL-462) are never workspace-scoped and
  // must reach the next.config rewrite untouched on every host.
  matcher: ['/((?!api|__|_next/static|_next/image|favicon.ico|_static).*)'],
}
