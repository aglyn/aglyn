/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type { NextMiddleware } from 'next/server'
import { NextResponse } from 'next/server'
// Shared with `with-aglyn.nextjs.config.js` so the frame-ancestors allowlist
// has one definition (AGL-523). Root-level because the config is plain
// CommonJS outside the nx graph and must `require` the same file — see the
// console middleware for the full reasoning.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  baseCspDirectives,
  isSecureTransport,
  reportingDirectives,
  reportingEndpointsHeader,
  tenantImgSrcDirective,
} from '../../security-origins'

/**
 * NO SANCTIONS GEO-BLOCK HERE, ON PURPOSE (AGL-1492).
 *
 * The block lives in `apps/console/constants/sanctions-geo.ts` and is wired
 * into the console only. It was considered here and deliberately not added:
 *
 * ToS §3.6 forbids "you" — the party that registers for the Services, per the
 * §2 definition — from accessing them from an embargoed region. §2 separately
 * defines an "End User" as a visitor to a customer's Host, expressly "as
 * distinct from your Account with Aglyn". A visitor in Havana reading a
 * customer's blog is not Aglyn onboarding a sanctioned customer; the party
 * being served is the customer, who was screened at signup by the console
 * block and is screened again by Stripe at payment.
 *
 * Wiring it here would instead geo-block **every customer's website, worldwide,
 * on their own custom domains** — silently deciding, on their behalf and
 * without their knowledge, who may read their content. That is a product
 * decision with real customer impact, and it is not one the Terms require. If
 * it is ever wanted, it belongs to a customer as a per-Host setting they opt
 * into, not to a compliance commit.
 *
 * If you are here to "close the gap": it is not a gap. Read ToS §§2, 3.6.
 */

/**
 * The way you configure your matcher items depend on your route structure.
 * E.g. if you decide to put all your posts under `/posts/[postSlug]`,
 * you'll need to add an extra matcher item "/posts/:path*".
 *
 * The reason we do this is to prevent the TOFIXmiddleware from matching
 * absolute paths like "demo.vercel.pub/_sites/steven" and have the content
 * from `steven` be served.

 * Match all paths except for:
 * 1 /api routes
 * 2 /_next (Next.js internals)
 * 3 /fonts (inside /public)
 * 4 /examples (inside /public)
 * 5 all root files inside /public (e.g. /favicon.ico)
 *
 * Here's a breakdown of each matcher item:
 * @example
 * "/" - Matches the root path of the site.
 * @example
 * "/([^/.]*)" - Matches all first-level paths (e.g.
 *   demo.vercel.pub/platforms-starter-kit) but exclude `/public` files by
 *   excluding paths containing `.` (e.g. /logo.png)
 * @example
 * "/_sites/:path*" – for all custom hostnames under the `/_sites/[host]*`
 *   dynamic route (demo.vercel.pub, platformize.co) we do this to make sure
 *   "demo.vercel.pub/_sites/steven" is not matched and throws a 404.
 */
export const config = {
  // prettier-ignore
  matcher: [
    // '/',
    // '/([^/.]*)',
    // '/(\\?\\!favicon.ico|robots.txt)',
    // '/(\\?\\!_next|_static|api)/:path*',
    // '/_sites/:path*',
    '/((?!api|_next|_static|fonts|examples|[\\w-]+\\.\\w+).*)',
    // Per-host SEO files, rewritten to the api routes with the resolved
    // tenant host (SEO Toolkit).
    '/sitemap.xml',
    '/robots.txt',
    '/manifest.webmanifest',
    // Per-collection RSS (AGL-1385), same reason as the three above: the
    // matcher excludes anything shaped `name.ext`, so a feed path would never
    // reach a route at all.
    '/:collection/rss.xml',
  ],
}

type EnvVercelEnv = 'production' | 'development' | 'preview' | undefined

// Preview/branch deployment urls have no tenant subdomain, so the host is
// resolved from a ?tenantHost= override (persisted in a cookie for
// subsequent navigations) and falls back to the demo host.
const TENANT_HOST_PARAM = 'tenantHost'
const TENANT_HOST_COOKIE = 'aglyn-tenant-host'

/**
 * The `x-powered-by` value (AGL-2088). A LITERAL, not an import.
 *
 * The canonical definition is `PLATFORM_GENERATOR_NAME` in
 * `libs/aglyn/.../plan-entitlements.ts`, and the `<meta name="generator">` tag
 * reads it from there. This file cannot: middleware runs in the edge runtime,
 * and every other middleware in the repo — console included — imports only
 * app-local `constants/` or the root `security-origins`, precisely so a
 * server-only graph (firebase-admin, the entitlement resolvers) never gets
 * dragged into an edge bundle.
 *
 * The copy is kept honest by assertion rather than by hope:
 * `platform-fingerprint-headers.spec.ts` imports the lib constant and asserts
 * the header this middleware actually emits equals it, so a rename in one
 * place fails a test instead of quietly shipping two different names to
 * detectors that key on the string.
 */
const PLATFORM_GENERATOR_NAME = 'Aglyn'

/**
 * Lockdown verdict at the REQUEST level (AGL-1501). The edge runtime cannot
 * query Firestore (see the `cname--` sentinel above), so the verdict comes
 * from this deployment's own Node route — the same fetch-a-verdict pattern
 * the console middleware uses for slug/domain verdicts — memoized per
 * isolate so a hot host costs one fetch per TTL, not one per request.
 *
 * Sitting HERE and not only in the (ISR-cached) loader is the point: a
 * taken-down host must stop serving CACHED pages immediately, and only the
 * middleware runs before the cache. 30s memo + the lockdown route's own
 * revalidation fan-out bound the worst-case stale window to seconds, not
 * the page's `revalidate = 60`.
 *
 * FAIL OPEN on any error: an unreachable verdict route is an outage, not a
 * lockdown — same posture as the console middleware's verdict fetches. The
 * loader's own lockdown branch is the defence in depth behind this.
 */
const LOCKDOWN_VERDICT_TTL_MS = 30_000
const lockdownVerdicts = new Map<
  string,
  { at: number; blocked: boolean; attribution: boolean; overQuota: boolean }
>()

/**
 * Should this request be replaced by the 503 notice? (AGL-1511)
 *
 * A READ-ONLY lock answers false: the entire point of that mode is that the
 * customer's site keeps serving and earning while writes are frozen, so the
 * one thing this function must never do for it is take the pages away. The
 * site's WRITE endpoints refuse separately (`visitorWriteRefusal`), which is
 * where they have to be anyway — `/api` is not in this middleware's matcher.
 *
 * An unrecognised or absent `mode` blocks, matching the pure default: a
 * strictness this build cannot read is treated as `full`, so an older
 * verdict route meeting a newer middleware fails toward the shipped
 * behaviour rather than toward serving a locked site.
 */
async function hostVerdict(
  origin: string,
  tenantHost: string,
): Promise<{ blocked: boolean; attribution: boolean; overQuota: boolean }> {
  const cached = lockdownVerdicts.get(tenantHost)
  if (cached && Date.now() - cached.at < LOCKDOWN_VERDICT_TTL_MS) {
    return {
      blocked: cached.blocked,
      attribution: cached.attribution,
      overQuota: cached.overQuota,
    }
  }
  let blocked = false
  // Platform attribution (AGL-2088) rides on the SAME verdict — the route
  // already holds the host and org docs the answer needs, so a header that
  // honours the `whiteLabel` entitlement costs no additional edge round trip.
  //
  // ⚠️ THE TWO FIELDS FAIL IN OPPOSITE DIRECTIONS, and the initialisers above
  // and here are the whole mechanism. `blocked` starts false so an unreachable
  // verdict keeps customer sites serving — an outage is not a takedown.
  // `attribution` starts false so the same unreachable verdict emits NOTHING:
  // a fetch that throws, a non-200, unparseable JSON, or a response from an
  // older deployment that has no `attribution` field at all must never be read
  // as "this site is not white-labelled". Only an explicit `true` emits.
  let attribution = false
  // THE FREE PLAN'S BANDWIDTH CAP (AGL-1967/2070/2155), and it starts FALSE
  // with `blocked` rather than with `attribution`, because it fails in the
  // same direction: an unreachable verdict, a non-200, unparseable JSON, or a
  // response from an older deployment that has no `overQuota` field at all
  // must all keep the site serving. A cap is a cost control; an outage that
  // reads as a cap would take every free site on the platform down at once,
  // which is a far worse day than the egress bill it was protecting.
  //
  // ⚠️ ENFORCING HERE IS THE POINT, exactly as it is for the lock. Only the
  // middleware runs before the ISR cache, and a capped site's remaining
  // egress is served from that cache — a gate in the loader alone would let a
  // viral free site keep serving its hot pages indefinitely while the cap
  // "engaged" against pages nobody was requesting.
  let overQuota = false
  try {
    const response = await fetch(
      `${origin}/api/lockdown-verdict?host=${encodeURIComponent(tenantHost)}`,
      { headers: { accept: 'application/json' } },
    )
    if (response.ok) {
      const data = (await response.json().catch(() => null)) as {
        locked?: boolean
        mode?: string
        attribution?: boolean
        overQuota?: boolean
      } | null
      blocked = data?.locked === true && data?.mode !== 'read-only'
      attribution = data?.attribution === true
      overQuota = data?.overQuota === true
    }
  } catch {
    // Fail open on the lock and the cap, closed on the attribution.
  }
  lockdownVerdicts.set(tenantHost, {
    at: Date.now(),
    blocked,
    attribution,
    overQuota,
  })
  return { blocked, attribution, overQuota }
}

export const middleware: NextMiddleware = async (req, event) => {
  const reqHost = req?.headers?.get('host') || 'app.aglyn.com'
  const AGLYN_TENANT_HOST_CNAME = process.env.AGLYN_TENANT_HOST_CNAME
  const AGLYN_TENANT_DEMO = process.env.AGLYN_TENANT_DEMO
  const VERCEL_ENV = process.env.VERCEL_ENV as EnvVercelEnv
  const IS_VERCEL = process.env.VERCEL
  const NODE_ENV = process.env.NODE_ENV
  const PROD_NODE_ENV = NODE_ENV === 'production'
  const PROD_VERCEL_ENV = VERCEL_ENV === 'production'
  const PREV_VERCEL_ENV = VERCEL_ENV === 'preview'

  console.debug(
    'process.env.VERCEL_ENV=',
    VERCEL_ENV,
    'process.env.AGLYN_TENANT_DEMO=',
    AGLYN_TENANT_DEMO,
    'process.env.VERCEL=',
    IS_VERCEL,
    'reqHost=',
    reqHost,
    "req?.headers?.get('host')=",
    req?.headers?.get('host'),
  )

  // If localhost, assign the host value manually
  // If prod, get the custom domain/subdomain value by removing the root URL
  // (in the case of "test.vercel.app", "vercel.app" is the root URL)
  let tenantHost: string

  switch (true) {
    // Deployment
    case IS_VERCEL && reqHost === AGLYN_TENANT_HOST_CNAME:
    case IS_VERCEL && reqHost.endsWith(`.${AGLYN_TENANT_HOST_CNAME}`):
      console.debug(
        'Tenant Host Switch',
        'assign',
        'reqHost == AGLYN_TENANT_HOST_CNAME=',
        reqHost === AGLYN_TENANT_HOST_CNAME,
        'reqHost.endsWith(`.${AGLYN_TENANT_HOST_CNAME}`)=',
        reqHost.endsWith(`.${AGLYN_TENANT_HOST_CNAME}`),
      )
      tenantHost = AGLYN_TENANT_HOST_CNAME
      break
    // Subdomain deployment
    case IS_VERCEL && reqHost.endsWith(`.aglyn.app`):
      console.debug(
        'Tenant Host Switch=',
        'replace',
        'request.endsWith=',
        '.aglyn.app',
        '.replace(`.aglyn.app`)=',
        reqHost.replace(`.aglyn.app`, ''),
      )
      tenantHost = reqHost.replace(`.aglyn.app`, '')
      break
    // Vercel deployment urls (preview, branch and canonical project domains)
    case IS_VERCEL && reqHost.endsWith('.vercel.app'):
    case reqHost === 'app.aglyn.com':
    case reqHost === 'localhost:4500': {
      const override =
        req.nextUrl.searchParams.get(TENANT_HOST_PARAM) ||
        req.cookies.get(TENANT_HOST_COOKIE)?.value
      console.debug(
        'Tenant Host Switch=',
        'assign',
        "reqHost.endsWith('.vercel.app')=",
        reqHost.endsWith('.vercel.app'),
        "reqHost === 'app.aglyn.com'=",
        reqHost === 'app.aglyn.com',
        "reqHost === 'localhost:4500'=",
        reqHost === 'localhost:4500',
        'override=',
        override,
        'request.match=',
        override || AGLYN_TENANT_DEMO || 'demo',
      )
      tenantHost = override || AGLYN_TENANT_DEMO || 'demo'
      break
    }
    // Local preview dev/test
    case reqHost.endsWith(`.localhost:4500`):
      console.debug(
        'Tenant Host Switch=',
        'replace',
        'request.endsWith=',
        '.localhost:4500',
        '.replace(`.localhost:4500`)=',
        reqHost.replace(`.localhost:4500`, ''),
      )
      tenantHost = reqHost.replace(`.localhost:4500`, '') || 'demo'
      break
    default: {
      // Custom domains (AGL-166): any other hostname is a customer domain
      // CNAMEd at Vercel. The edge runtime can't query Firestore, so the
      // hostname travels as a `cname--` sentinel and getStaticProps
      // resolves it via host.cname (unknown domains 404 there). Only
      // host-shaped names proceed; garbage still bounces to the console.
      const hostname = reqHost.split(':')[0].toLowerCase()
      if (IS_VERCEL && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) {
        console.debug('Tenant Host Switch=', 'cname', 'hostname=', hostname)
        tenantHost = `cname--${hostname}`
        break
      }
      console.debug(
        'Tenant Host Switch=',
        'Redirecting',
        'req.nextUrl.pathname=',
        req.nextUrl.pathname,
        'Destination=',
        'https://app.aglyn.com',
      )
      return NextResponse.redirect('https://app.aglyn.com')
    }
  }

  if (
    req.nextUrl.pathname === '/login' &&
    (req.cookies.get('next-auth.session-token') ||
      req.cookies.get('__Secure-next-auth.session-token'))
  ) {
    console.debug(
      'Tenant Host Switch=',
      'Redirecting',
      '/login=',
      req.cookies.get('next-auth.session-token'),
      '"" OR=',
      req.cookies.get('__Secure-next-auth.session-token'),
    )
    return NextResponse.redirect(new URL('/', req.url))
  }

  // Lockdown (AGL-1501): a locked host serves the 503 notice for EVERY
  // matched path — pages, sitemap, robots, manifest, feeds — before any
  // cached HTML can answer. Checked ahead of the SEO rewrites on purpose so
  // a taken-down site stops advertising its content too.
  const verdict = await hostVerdict(req.nextUrl.origin, tenantHost)
  // The bandwidth cap (AGL-2155) rewrites to the SAME notice route, which
  // re-derives which of the two it is and words itself accordingly. A lock
  // OUTRANKS a cap by falling first: both serve a 503, but a staff takedown
  // must not be described to a visitor as a traffic limit.
  if (verdict.blocked || verdict.overQuota) {
    const lockedUrl = req.nextUrl.clone()
    lockedUrl.pathname = '/api/locked'
    lockedUrl.search = ''
    lockedUrl.searchParams.set('host', tenantHost)
    // The host ALSO travels as a request header, exactly like the SEO
    // rewrites below: a route handler behind a rewrite sees the ORIGINAL
    // request URL, so a query set on the rewrite target alone never reaches
    // it (verified against a production-mode server, AGL-1501) — the header
    // is what survives.
    const lockedHeaders = new Headers(req.headers)
    lockedHeaders.set('x-aglyn-tenant-host', tenantHost)
    return NextResponse.rewrite(lockedUrl, {
      request: { headers: lockedHeaders },
    })
  }

  // Per-host SEO files resolve through api routes (SEO Toolkit). Clone the
  // request URL so the host query survives the rewrite.
  //
  // `manifest.webmanifest` joins them for the same reason (AGL-1252): the
  // matcher above excludes anything matching `[\w-]+\.\w+`, so a manifest
  // served from a `[host]/…` route would never be rewritten and would 404 on
  // every site.
  const SEO_REWRITES: Record<string, string> = {
    '/sitemap.xml': '/api/sitemap',
    '/robots.txt': '/api/robots',
    '/manifest.webmanifest': '/api/manifest',
  }
  // A collection's feed at `/{collection}/rss.xml` (AGL-1385). The feed route
  // has existed since AGL-81 and was reachable only as
  // `/api/collections-rss?host=cname--acme.com&collection=blog` — a URL whose
  // host parameter is an internal sentinel, so nothing could link to it and
  // nothing did. This is the linkable form: no host to get right, and it
  // survives a domain change because the middleware resolves the host per
  // request.
  const rssMatch = /^\/([\w-]+)\/rss\.xml$/.exec(req.nextUrl.pathname)
  const seoPathname = rssMatch
    ? '/api/collections-rss'
    : SEO_REWRITES[req.nextUrl.pathname]
  if (seoPathname) {
    const seoUrl = req.nextUrl.clone()
    seoUrl.pathname = seoPathname
    seoUrl.searchParams.set('host', tenantHost)
    if (rssMatch) seoUrl.searchParams.set('collection', rssMatch[1])
    // The query can be dropped across dev rewrites, so the resolved tenant
    // host also travels as a request header the api routes prefer.
    const seoHeaders = new Headers(req.headers)
    seoHeaders.set('x-aglyn-tenant-host', tenantHost)
    return NextResponse.rewrite(seoUrl, { request: { headers: seoHeaders } })
  }

  // Rewrite to the resolved tenant host as the first path segment; the
  // catch-all render lives at app `[host]/[[...slug]]` (search at
  // `app/[host]/search`). No `_sites` namespace is needed: the matcher above
  // already keeps `/api`, `/_next`, etc. off this rewrite, and API routes are
  // in `pages/api` (which win over the `[host]` catch-all). Preserve the
  // query string (search pages, tenantHost overrides).
  const rewrite = `/${tenantHost}${req.nextUrl.pathname}${req.nextUrl.search}`
  console.debug(
    'Tenant Host Switch=',
    'Rewriting',
    'rewrite=',
    rewrite,
    'tenantHost=',
    tenantHost,
    'req.nextUrl.pathname=',
    req.nextUrl.pathname,
  )
  const baseDirectives = baseCspDirectives(
    process.env.NODE_ENV === 'production',
  )
  // The tenant sets NO `script-src`, in either header. Deliberate, and the
  // reasoning is worth keeping because the obvious fix does not work
  // (AGL-518 → AGL-523 → AGL-1228).
  //
  // There used to be a report-only `script-src 'self' 'nonce-…'
  // 'strict-dynamic'` here, described as gathering evidence before flipping to
  // enforcing. It gathered nothing. Measured on two live sites: a published
  // page carries **33 `<script>` tags and ZERO nonce attributes** while the
  // header advertised a nonce. Under `strict-dynamic` nothing but the nonce can
  // authorise a script, so all 33 violated the policy on every page load of
  // every published site — a policy structurally guaranteed to report
  // everything can never surface anything new. It was an experiment with no
  // power, costing a `randomUUID` and a header on every response, so it is
  // gone rather than left to look like evidence someone is waiting on.
  //
  // TWO independent causes, and fixing one alone changes nothing visible:
  //
  // 1. ISR. Tenant pages are cached: at revalidation they render outside any
  //    request, so there is no header to read and the payload carries
  //    `"nonce":"$undefined"`. Measured — two requests to one cached page
  //    returned BYTE-IDENTICAL HTML with a DIFFERENT nonce in each response
  //    header. A per-request nonce cannot match cached bytes. This is the one
  //    that blocks enforcing.
  // 2. Shadowing. The response CSP is mirrored onto the request, and Next
  //    resolves the nonce as `content-security-policy || …-report-only`, so an
  //    enforcing policy carrying no `script-src` short-circuits the `||`. Same
  //    defect AGL-523 fixed on the console. Sufficient on its own: the nonce
  //    would be `$undefined` here even with no caching at all.
  //
  // So someone who fixes only the shadowing will find the scripts still
  // unnonced, and should not read that as the fix having failed.
  //
  // Dropping `strict-dynamic` for a plain `script-src 'self'` is not an escape
  // either: Next emits ~12 INLINE scripts per page for RSC flight data, and
  // `'self'` alone blocks inline. Making this enforceable needs a real design —
  // a nonce baked into the cached bytes (per-page-version, not per-visitor) or
  // build-time hashes — not a header change. Tracked in AGL-1228.
  //
  // What DOES enforce here, unchanged: the base directives below — `object-src
  // 'none'`, `base-uri 'self'`, `frame-ancestors` — plus the plugin sandbox.
  const response = NextResponse.rewrite(new URL(rewrite, req.url))
  response.headers.set('Content-Security-Policy', baseDirectives)
  // A REPORT-ONLY `img-src`, and its reporting endpoint (AGL-1703). What the
  // directive contains, and why it is not the console's, lives with
  // `tenantImgSrcDirective`. What belongs here is why a second header is safe
  // on the surface AGL-1228 removed one from.
  //
  // The AGL-1228 header was unsafe for a reason that does not generalise: it
  // advertised a per-request `nonce-…`, and tenant pages are ISR-cached, so
  // the header and the bytes could never agree. This one is the same string on
  // every response — there is nothing per-request in it to go stale — and it
  // names no `script-src` and no nonce, so it cannot re-create that mismatch.
  //
  // Nor can it shadow a nonce. Next resolves one as `content-security-policy
  // || …-report-only` (`next/dist/server/app-render/app-render.js:167`, read in
  // the installed version, not assumed). The enforcing header is set on the
  // line above, unconditionally, so the `||` short-circuits and this header is
  // never consulted.
  //
  // That short-circuit is why this goes HERE and on no other return path. The
  // `/api/locked` and SEO rewrites above set no CSP at all, so a report-only
  // header added to one of those WOULD become the string Next parses for a
  // nonce — the AGL-523 shadowing shape, rebuilt. Pair it with the enforcing
  // header or leave it off.
  //
  // It carries its own reporting tail: a report-only policy with no reporting
  // directive detects violations and tells nobody, which is what AGL-518
  // shipped for months and what reads as an all-clear. The endpoint is RELATIVE
  // on purpose — it resolves against the document, so it lands on the
  // customer's own domain and reaches `apps/tenant/app/api/csp-report`, which
  // the matcher at the top of this file keeps out of the host rewrite.
  //
  // Which directives that tail holds depends on the transport, and NOT because
  // one backs the other up — `report-to` suppresses `report-uri`, so over plain
  // http the pair delivers nothing at all (AGL-1788; the measured table lives
  // with `reportingDirectives`). Published customer sites are https, so this
  // changes nothing for them; it is `nx serve tenant` that was silent.
  const secureTransport = isSecureTransport(req.headers, req.nextUrl.protocol)
  const endpoints = reportingEndpointsHeader(secureTransport)
  if (endpoints) response.headers.set('Reporting-Endpoints', endpoints)
  response.headers.set(
    'Content-Security-Policy-Report-Only',
    `${tenantImgSrcDirective(process.env.NODE_ENV === 'production')}; ` +
      reportingDirectives(secureTransport),
  )
  // The deliberate, versionless platform fingerprint (AGL-2088), replacing the
  // accidental `x-aglyn-package-version` / `x-aglyn-process-version` pair that
  // shipped from `next.config` on every response of every site regardless of
  // entitlement.
  //
  // WHY THE MIDDLEWARE IS THE ONLY PLACE THIS CAN GO. A build-time
  // `headers()` rule has no request and so no host. A server component cannot
  // set response headers at all. A route handler could, but published pages
  // are not route handlers. That leaves this function, which is also the first
  // layer that knows which site it is serving.
  //
  // ISR-safe, unlike the AGL-1228 nonce that had to be removed from this same
  // response: the value is a constant, and the per-host decision comes from a
  // verdict memoized OUTSIDE the page cache. Middleware runs ahead of the
  // cache on every request, so a site that white-labels tomorrow stops sending
  // the header within the verdict TTL — it does not have to wait for cached
  // HTML to expire. (The `<meta name="generator">` tag IS baked into that
  // cached HTML and lags by the page's `revalidate`; the header is the faster
  // half of the pair, not the slower.)
  //
  // `x-powered-by` rather than a bespoke name: it is the field detectors
  // already parse, and `poweredByHeader: false` in the shared config means
  // Next emits no value of its own to collide with.
  if (verdict.attribution) {
    response.headers.set('x-powered-by', PLATFORM_GENERATOR_NAME)
  }
  const overrideParam = req.nextUrl.searchParams.get(TENANT_HOST_PARAM)
  if (overrideParam) {
    response.cookies.set(TENANT_HOST_COOKIE, overrideParam, { path: '/' })
  }
  return response
}
