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
import {
  APEX_LABELS,
  hostnameOf,
  isWorkspaceDomainHost,
  WORKSPACE_DOMAIN,
} from './constants/workspace-domain'
import { enforceSanctionsGeo } from './constants/sanctions-geo'
// One source of truth for the frame-ancestors allowlist, shared with
// `with-aglyn.nextjs.config.js` so the two cannot drift (AGL-523).
//
// It lives at the repo root rather than in a lib because `next.config.js` —
// plain CommonJS, and not an nx project — has to `require` it too. Routing it
// through a lib would mean the config could not read it, and the two would
// drift into disagreeing CSPs, which is the exact class of bug AGL-523 was.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { baseCspDirectives, imgSrcDirective } from '../../security-origins'

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
/**
 * The auth family, which a **custom console domain may never render**
 * (AGL-1099, AGL-1353 D6).
 *
 * The design's biggest structural bet is that the credential prompt only ever
 * happens on an origin we control: no Firebase authorized-domain entry is
 * needed for a custom domain, no OAuth helper iframe is ever framed there, and
 * nothing durable is left on an origin whose DNS the customer can re-point at
 * themselves. The client half of that is `createAuthInstance(app, 'ephemeral')`
 * sealing `setPersistence` shut (AGL-1379); this is the route half, and the
 * memo names it as owed a test here rather than assumed.
 *
 * A subset of `APEX_PATH_SEGMENTS` — the rest (`manage`, `admin`, `signout`)
 * are legitimate on a white-label console and stay served. `signout` in
 * particular must work locally: ending a session on the host that holds it can
 * never be the wrong answer.
 */
const AUTH_PATH_SEGMENTS = new Set([
  'signin',
  'signup',
  'verify-email',
  'account-recovery',
])
const CACHE_TTL_MS = 60_000
type SlugVerdict = { known: boolean; movedTo: string | null; at: number }
const slugCache = new Map<string, SlugVerdict>()

type ConsoleDomainVerdict = {
  known: boolean
  servable: boolean
  orgSlug: string | null
  at: number
}
const consoleDomainCache = new Map<string, ConsoleDomainVerdict>()

/** No claim on this host — localhost, a preview, a self-hosted install. */
const UNKNOWN_CONSOLE_DOMAIN = {
  known: false,
  servable: false,
  orgSlug: null,
}

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

/**
 * Ask our own Admin-SDK route whether this hostname is a live custom console
 * domain, and for which org (AGL-1099c).
 *
 * Same shape, same origin discipline and same failure posture as
 * `resolveOrgSlug` above, for the same reasons — an edge Firestore read returns
 * `403` for everything under App Check, and a hardcoded apex would make a
 * preview deployment ask production.
 *
 * The one difference that matters: an unresolvable host here fails open as
 * `known: false`, which means *pass the request through untouched*, not *serve
 * it as somebody's console*. There is no org to pin it to, so failing open
 * cannot accidentally scope a request into an org — it can only leave the host
 * exactly as unhandled as it is today.
 */
async function resolveConsoleDomainHost(
  host: string,
  origin: string,
): Promise<Omit<ConsoleDomainVerdict, 'at'>> {
  const cached = consoleDomainCache.get(host)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached
  try {
    const response = await fetch(
      `${origin}/api/orgs/console-domain-verdict?host=${encodeURIComponent(host)}`,
      { headers: { accept: 'application/json' } },
    )
    if (!response.ok) return UNKNOWN_CONSOLE_DOMAIN
    const payload = await response.json().catch(() => null)
    if (payload == null || typeof payload.known !== 'boolean') {
      return UNKNOWN_CONSOLE_DOMAIN
    }
    // Honoured for this request, never cached — one Firestore blip must not
    // pin a host's verdict for the full TTL in either direction.
    if (payload.degraded) return UNKNOWN_CONSOLE_DOMAIN
    const verdict = {
      known: payload.known as boolean,
      servable: payload.servable === true,
      orgSlug: (payload.orgSlug as string | null) ?? null,
      at: Date.now(),
    }
    consoleDomainCache.set(host, verdict)
    return verdict
  } catch {
    return UNKNOWN_CONSOLE_DOMAIN
  }
}

/**
 * The org-scoped path rewrite, shared by both host gates.
 *
 * Routes are canonically `/[orgSlug]/…`, but on a host that already names the
 * org the path must not repeat it (AGL-627): `acme.aglyn.com/hosts/x`, never
 * `acme.aglyn.com/acme/hosts/x`. Account, staff and auth routes live at the
 * apex path on every host and must not be rewritten, and an already-prefixed
 * path passes through so canonical links keep working.
 *
 * Returns `null` when the path needs no rewrite.
 */
function orgScopedPath(request: NextRequest, slug: string): URL | null {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean)
  const first = segments[0]
  if (first === slug || APEX_PATH_SEGMENTS.has(first ?? '')) return null
  const rewritten = request.nextUrl.clone()
  rewritten.pathname = `/${slug}${
    request.nextUrl.pathname === '/' ? '' : request.nextUrl.pathname
  }`
  return rewritten
}

export async function middleware(request: NextRequest) {
  // Sanctions / OFAC geo-block (AGL-1492), FIRST — before the nonce, before
  // any host verdict, before any Firestore-backed lookup.
  //
  // The order is the point twice over. An embargoed request must not be able
  // to spend our Firestore quota on a verdict lookup, and — more importantly —
  // "we do not serve this region" has to be answered by the layer that decides
  // WHETHER to serve, not by one of the layers that decides WHAT to serve. Put
  // below the host gates it would be reachable only on hosts those gates pass.
  //
  // This covers every console page including `/signup` and `/signin`, which is
  // the surface ToS §3.6 is actually about. It does NOT cover `/api/*` — those
  // sit outside the matcher below, exactly as the workspace-host gate does, so
  // the two routes that provide the service on their own (`/api/auth/session`
  // mints the session; `/api/orgs/create` provisions the org) carry the same
  // check directly. Same reasoning as `rejectUnknownWorkspaceHost`.
  //
  // Re-wrapped as a `NextResponse` rather than returned as the plain `Response`
  // the policy module builds. `sanctions-geo.ts` stays framework-free so the
  // route handlers can share it, but returning a bare `Response` from here
  // widens this function's inferred return type to `NextResponse | Response`,
  // and every existing caller that reads `.cookies` off it stops type-checking.
  // The conversion is lossless — body, status and headers all carry.
  const refused = enforceSanctionsGeo(request.headers, 'page')
  if (refused) return new NextResponse(refused.body, refused)

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
  const isProduction = process.env.NODE_ENV === 'production'
  const baseDirectives = baseCspDirectives(isProduction)
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
  // The single remaining violation in production is `script-src / eval`, and it
  // is benign: `Function("return function*() {}")` inside a try/catch — the
  // feature probe in `is-generator-function`. Blocked, it is caught and returns
  // false, so no `'unsafe-eval'` is needed there (AGL-1238 tracks dropping the
  // dependency).
  //
  // Development is the exception, and it is not optional: React's dev build
  // uses `eval()` for debugging features like reconstructing a callstack from
  // another environment, and without it every dev page load logs "eval() is not
  // supported in this environment". React never evals in production, so the
  // escape hatch is gated on the SAME `NODE_ENV` check the base directives use
  // above — `'unsafe-eval'` in a production policy would hand an injected
  // string back its ability to become code.
  //
  // This still blocks the real XSS vector — an injected inline `<script>` has
  // no nonce and does not run — plus `http:` and `data:` sources.
  const scriptSrc = `script-src 'self' https: blob: 'nonce-${nonce}'${
    isProduction ? '' : " 'unsafe-eval'"
  }`
  // CSP img-src: REPORT-ONLY, on purpose (AGL-1685). The reasoning for the
  // directive's contents lives with it in `security-origins.js`; what belongs
  // here is why it goes in a SECOND header rather than into the one above.
  //
  // The rule this file opens with says there must be exactly ONE
  // `Content-Security-Policy`, and that is still true — this is not a second
  // one. The hazard that rule exists for is the nonce: Next resolves it with
  // `content-security-policy || …-report-only`
  // (`next/dist/server/app-render/app-render.js:167`, read in the installed
  // version, not assumed), so a report-only header can only ever shadow the
  // nonce when the ENFORCING header is missing or carries no `script-src`.
  // Ours always carries it, three lines up, so the `||` short-circuits before
  // the header below is ever consulted. Deleting `script-src` from the
  // enforcing policy is what would make this dangerous — not adding this.
  //
  // Putting `img-src` into the enforcing header instead is the thing not to do
  // until the reports say it is safe. Eight product surfaces let a user, a
  // publisher or an enterprise IdP put an arbitrary host into an `<img>` — they
  // are listed against `imgSrcDirective` — so enforcing today breaks features,
  // and breaks them the quiet way: an avatar or a customer's own logo that
  // stops rendering for one org and throws nothing.
  const imgSrc = imgSrcDirective(isProduction)
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
    // The candidate `img-src`, measured before it is enforced (AGL-1685).
    // It carries its own `report-uri`/`report-to`: a report-only policy with no
    // reporting directive is the exact mistake AGL-518 shipped for months —
    // it detects violations and tells nobody, which reads as an all-clear.
    // Reports arrive at the same collector with `disposition: "report"` and
    // `effectiveDirective: "img-src"`, so they are separable from the enforcing
    // script-src stream in the log without a second endpoint.
    res.headers.set(
      'Content-Security-Policy-Report-Only',
      `${imgSrc}; ${reportDirectives}`,
    )
    return res
  }
  const pass = () =>
    applyCsp(NextResponse.next({ request: { headers: requestHeaders } }))
  const rewriteTo = (url: URL) =>
    applyCsp(
      NextResponse.rewrite(url, { request: { headers: requestHeaders } }),
    )

  const hostname = hostnameOf(request.headers.get('host'))
  if (!hostname) return pass()
  // Anything off the workspace domain may be a custom console domain — and may
  // equally be localhost, a preview deployment or a self-hosted install. Only a
  // Firestore claim can tell them apart, so ask (AGL-1099c).
  if (!isWorkspaceDomainHost(hostname)) {
    return await serveConsoleDomain(request, hostname, {
      pass,
      rewriteTo,
    })
  }
  if (hostname === WORKSPACE_DOMAIN) return pass()
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
    const rewritten = orgScopedPath(request, slug)
    return rewritten ? rewriteTo(rewritten) : pass()
  }
  const apex = request.nextUrl.clone()
  apex.hostname = `app.${WORKSPACE_DOMAIN}`
  apex.pathname = '/'
  apex.search = `?unknown-workspace=${encodeURIComponent(slug)}`
  return NextResponse.redirect(apex)
}

/**
 * The custom-console-domain gate (AGL-1099c).
 *
 * Three outcomes, and the reasoning for each is in
 * `resolveConsoleDomain`/`resolveConsoleDomainHost` above:
 *
 * 1. **No claim** → pass. localhost, previews and self-hosted installs must
 *    keep working, and a lookup outage lands here too.
 * 2. **Claimed, live and entitled** → rewrite into `/{orgSlug}/…`. The path is
 *    the pin: one host serves exactly one org, and the org cannot be changed by
 *    anything in the request, because it came from a document keyed on the
 *    host. The auth family is refused first — see `AUTH_PATH_SEGMENTS`.
 * 3. **Claimed but not servable** — the org lost `whiteLabel`, the claim was
 *    suspended, or it was never activated → send the visitor to a console that
 *    works, rather than leaving them on a dead hostname that reads as an
 *    outage.
 *
 * Outcome 3 is a **307, not a 308**, and that is a deliberate departure from
 * AGL-1353 D7's wording. Suspension is reversible by design — re-upgrade and
 * re-activate — while a 308 is cacheable by default and effectively
 * irreversible in a browser. Committing every visitor's browser to a permanent
 * redirect off a customer's own domain, because a card declined for a day, is
 * not a state we could get back out of. (AGL-1430 makes the same argument
 * about `www`↔apex redirects, from the same property.)
 */
async function serveConsoleDomain(
  request: NextRequest,
  hostname: string,
  respond: {
    pass: () => NextResponse
    rewriteTo: (url: URL) => NextResponse
  },
): Promise<NextResponse> {
  const verdict = await resolveConsoleDomainHost(
    hostname,
    new URL(request.url).origin,
  )
  if (!verdict.known) return respond.pass()

  const fallback = request.nextUrl.clone()
  fallback.hostname = verdict.orgSlug
    ? `${verdict.orgSlug}.${WORKSPACE_DOMAIN}`
    : `app.${WORKSPACE_DOMAIN}`

  if (!verdict.servable || !verdict.orgSlug) {
    fallback.pathname = '/'
    fallback.search = '?console-domain=inactive'
    return NextResponse.redirect(fallback, 307)
  }

  // Sign-in never happens on the custom domain. Until the AGL-1099e handoff
  // exists this is where the user is sent; afterwards this is where the handoff
  // starts. Either way the credential prompt stays on an origin we control.
  const first = request.nextUrl.pathname.split('/').filter(Boolean)[0] ?? ''
  if (AUTH_PATH_SEGMENTS.has(first)) {
    const authHost = request.nextUrl.clone()
    authHost.hostname = `app.${WORKSPACE_DOMAIN}`
    return NextResponse.redirect(authHost, 307)
  }

  const rewritten = orgScopedPath(request, verdict.orgSlug)
  return rewritten ? respond.rewriteTo(rewritten) : respond.pass()
}

export const config = {
  // Pages and data routes only — assets, API routes, and the Firebase
  // auth-helper namespace (/__/*, AGL-462) are never workspace-scoped and
  // must reach the next.config rewrite untouched on every host.
  //
  // `sw.js` is excluded for a sharper reason than "it is an asset" (AGL-1053):
  // this middleware can answer with a redirect, and a redirect served in place
  // of the script fails registration with a content-type error rather than
  // anything that names the cause. A service worker must also be fetched from
  // the scope it claims, so it cannot simply be moved under `/_static`.
  matcher: [
    '/((?!api|__|_next/static|_next/image|favicon.ico|_static|sw.js).*)',
  ],
}
