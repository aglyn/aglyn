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
  ],
}

type EnvVercelEnv = 'production' | 'development' | 'preview' | undefined

// Preview/branch deployment urls have no tenant subdomain, so the host is
// resolved from a ?tenantHost= override (persisted in a cookie for
// subsequent navigations) and falls back to the demo host.
const TENANT_HOST_PARAM = 'tenantHost'
const TENANT_HOST_COOKIE = 'aglyn-tenant-host'

export const middleware: NextMiddleware = (req, event) => {
  const reqHost = req?.headers?.get('host') || 'console.aglyn.io'
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
    case reqHost === 'console.aglyn.io':
    case reqHost === 'localhost:4500': {
      const override =
        req.nextUrl.searchParams.get(TENANT_HOST_PARAM) ||
        req.cookies.get(TENANT_HOST_COOKIE)?.value
      console.debug(
        'Tenant Host Switch=',
        'assign',
        "reqHost.endsWith('.vercel.app')=",
        reqHost.endsWith('.vercel.app'),
        "reqHost === 'console.aglyn.io'=",
        reqHost === 'console.aglyn.io',
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
    default:
      console.debug(
        'Tenant Host Switch=',
        'Redirecting',
        'req.nextUrl.pathname=',
        req.nextUrl.pathname,
        'Destination=',
        'https://console.aglyn.io',
      )
      return NextResponse.redirect('https://console.aglyn.io')
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
  if (
    req.nextUrl.pathname === '/sitemap.xml' ||
    req.nextUrl.pathname === '/robots.txt'
  ) {
    const seoUrl = req.nextUrl.clone()
    seoUrl.pathname =
      req.nextUrl.pathname === '/sitemap.xml' ? '/api/sitemap' : '/api/robots'
    seoUrl.searchParams.set('host', tenantHost)
    // The query can be dropped across dev rewrites, so the resolved tenant
    // host also travels as a request header the api routes prefer.
    const seoHeaders = new Headers(req.headers)
    seoHeaders.set('x-aglyn-tenant-host', tenantHost)
    return NextResponse.rewrite(seoUrl, { request: { headers: seoHeaders } })
  }

  // rewrite to the current hostname under the pages/_sites folder
  // the main logic component will happen in pages/_sites/[host]/[...path].tsx
  const rewrite = `/_sites/${tenantHost}${req.nextUrl.pathname}`
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
  const response = NextResponse.rewrite(new URL(rewrite, req.url))
  const overrideParam = req.nextUrl.searchParams.get(TENANT_HOST_PARAM)
  if (overrideParam) {
    response.cookies.set(TENANT_HOST_COOKIE, overrideParam, { path: '/' })
  }
  return response
}
