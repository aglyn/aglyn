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
  // Per-request CSP nonce (AGL-518). Next reads it from the request
  // Content-Security-Policy header and stamps it on the scripts it emits;
  // `strict-dynamic` then trusts the chunks those scripts load. Shipped
  // REPORT-ONLY so the browser reports violations without blocking — flip to
  // enforcing by renaming the response header to `Content-Security-Policy`
  // (after confirming reports are clean and noncing any inline scripts, e.g.
  // the GA snippet). Layers over the enforcing object-src/base-uri/
  // frame-ancestors CSP already set in with-aglyn.nextjs.config.js.
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // BOTH names on the request (AGL-523). Next reads `content-security-policy`
  // and falls back to `content-security-policy-report-only`, so setting both
  // survives an intermediary that drops or sanitises one of them — which is the
  // live suspect: this exact build nonces all 50 scripts under `next start`
  // locally and none of them on Vercel, where an edge middleware and a Node
  // function are separate hops.
  //
  // Same value in both, so Next's precedence cannot pick a policy that
  // disagrees with the one the browser is sent. `/csp-check` reports which
  // arrived.
  requestHeaders.set('Content-Security-Policy', csp)
  requestHeaders.set('Content-Security-Policy-Report-Only', csp)
  const pass = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } })
    res.headers.set('Content-Security-Policy-Report-Only', csp)
    return res
  }
  const rewriteTo = (url: URL) => {
    const res = NextResponse.rewrite(url, {
      request: { headers: requestHeaders },
    })
    res.headers.set('Content-Security-Policy-Report-Only', csp)
    return res
  }

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
