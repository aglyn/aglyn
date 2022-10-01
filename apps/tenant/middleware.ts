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
 * from
 * `steven` be served.
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
    '/',
    '/([^/.]*)',
    // '/(\\?\\!favicon.ico|robots.txt)',
    // '/(\\?\\!_next|_static|api)/:path*',
    '/_sites/:path*',
  ],
}

type EnvVercelEnv = 'production' | 'development' | 'preview' | undefined

export const middleware: NextMiddleware = (req, event) => {
  const reqHost = req?.headers?.get('host') || 'console.aglyn.io'
  const AGLYN_TENANT_HOST_CNAME = process.env.AGLYN_TENANT_HOST_CNAME
  const VERCEL_ENV: EnvVercelEnv = process.env.VERCEL_ENV as EnvVercelEnv
  const NODE_ENV = process.env.NODE_ENV
  const PROD_NODE_ENV = NODE_ENV === 'production'
  const PROD_VERCEL_ENV = VERCEL_ENV === 'production'
  const PREV_VERCEL_ENV = VERCEL_ENV === 'preview'
  const isProdVercel = PROD_NODE_ENV && PROD_VERCEL_ENV

  console.log('process.env.VERCEL_ENV', PREV_VERCEL_ENV)

  // If localhost, assign the host value manually
  // If prod, get the custom domain/subdomain value by removing the root URL
  // (in the case of "test.vercel.app", "vercel.app" is the root URL)
  let tenant: string

  switch (true) {
    case isProdVercel && reqHost === AGLYN_TENANT_HOST_CNAME:
    case isProdVercel && reqHost.endsWith(`.${AGLYN_TENANT_HOST_CNAME}`):
      tenant = AGLYN_TENANT_HOST_CNAME
      break
    case isProdVercel && reqHost.endsWith(`.aglyn.app`):
      tenant = reqHost.replace(`.aglyn.app`, '')
      break
    case /*PREV_VERCEL_ENV && */ reqHost.endsWith(`.vercel.app`):
    case reqHost === 'localhost:4500':
      tenant = 'tenant'
      break
    case reqHost.endsWith(`.localhost:4500`):
      // Development and testing (localhost:4500)
      tenant = reqHost.replace(`.localhost:4500`, '') || 'tenant'
      break
    default:
      console.log('REDIR!!', req.nextUrl.pathname, 'https://console.aglyn.io')
      return NextResponse.redirect('https://console.aglyn.io')
  }

  if (
    req.nextUrl.pathname === '/login' &&
    (req.cookies.get('next-auth.session-token') ||
      req.cookies.get('__Secure-next-auth.session-token'))
  ) {
    console.log('REDIRECTING!!!!!', req.nextUrl.pathname, '/')
    return NextResponse.redirect('/')
  }

  // rewrite to the current hostname under the pages/_sites folder
  // the main logic component will happen in pages/_sites/[host]/[...path].tsx
  const rewrite = `/_sites/${tenant}${req.nextUrl.pathname}`
  console.log('REWR!!', req.nextUrl.pathname, '', rewrite)
  return NextResponse.rewrite(new URL(rewrite, req.url))
}
