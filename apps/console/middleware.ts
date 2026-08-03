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
  // Per-request CSP nonce, ENFORCING (AGL-518, fixed in AGL-523).
  //
  // Next reads the nonce out of the `Content-Security-Policy` header on the
  // request and stamps it on every script it emits; `strict-dynamic` then
  // trusts the chunks those scripts load.
  //
  // It reached zero scripts in production for as long as this was report-only,
  // and the cause is a mirroring rule worth stating plainly: **the response
  // `Content-Security-Policy` is copied onto the request the renderer reads.**
  // A static policy from `with-aglyn.nextjs.config.js` therefore shadowed this
  // one — Next resolves with `content-security-policy || …-report-only`, so a
  // 632-character policy carrying no `script-src` short-circuited the `||` and
  // the nonce policy sitting in the report-only header was never read. Every
  // script rendered `nonce="$undefined"`.
  //
  // That rule also means "enforce the base directives, rehearse script-src" is
  // not a reachable state: any enforcing CSP shadows the nonce policy, and with
  // no nonce `strict-dynamic` — which makes `'self'` inert — blocks everything.
  // Enforcing the nonce'd script-src is what makes the nonce work at all.
  const nonce = crypto.randomUUID().replace(/-/g, '')
  // ENFORCED policy. Deliberately NOT `strict-dynamic` yet.
  //
  // `strict-dynamic` makes `'self'`, `https:` and `blob:` inert — trust flows
  // only from a nonced script to what it loads. That is the right destination,
  // and it verifiably works on the sign-in page (React hydrates, reCAPTCHA and
  // GA both execute). But the besigner canvas and the realm-plugin `blob:`
  // imports are behind a login I cannot exercise here, and under
  // `strict-dynamic` a single un-nonced inline script there is a blank page.
  //
  // So enforce the policy whose failure modes are known, and rehearse the
  // strict one below. This still blocks the actual XSS vector — an injected
  // inline `<script>` has no nonce and does not run — plus `http:` and `data:`
  // sources. Same-origin chunks, https third parties (reCAPTCHA, GA) and
  // `blob:` plugin imports all keep working without depending on trust
  // propagation.
  const scriptSrc = `script-src 'self' https: blob: 'nonce-${nonce}'`
  // The destination policy, reported not enforced, so violations from the
  // surfaces I could not sign into show up before it is switched on.
  const strictScriptSrc = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
  const baseDirectives = baseCspDirectives(
    process.env.NODE_ENV === 'production',
  )
  // `x-nonce` is for our own inline scripts to read via `headers()`; Next's
  // own scripts are nonced from the CSP header, not from this.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // One policy, carrying script-src and the base directives together. Because
  // the response header is mirrored onto the request, this is self-consistent
  // by construction: the nonce Next stamps on scripts is read from this exact
  // string, so it is always the nonce this header authorises.
  const policy = `${scriptSrc}; ${baseDirectives}`
  const applyCsp = (res: NextResponse) => {
    res.headers.set('Content-Security-Policy', policy)
    // Next reads the nonce from the ENFORCING header, which carries one — so
    // adding this report-only header cannot shadow anything. It exists purely
    // to collect violations against the stricter destination policy.
    res.headers.set(
      'Content-Security-Policy-Report-Only',
      `${strictScriptSrc}; ${baseDirectives}`,
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
