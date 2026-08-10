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
import { baseCspDirectives } from '../../security-origins'

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

export const middleware: NextMiddleware = (req, event) => {
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
  const overrideParam = req.nextUrl.searchParams.get(TENANT_HOST_PARAM)
  if (overrideParam) {
    response.cookies.set(TENANT_HOST_COOKIE, overrideParam, { path: '/' })
  }
  return response
}
