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

import {
  buildRewriteSiteHostPath,
  IMPLICIT_DIRS,
} from '@aglyn/tenant-feature-instance'
import { IS_PRODUCTION } from '@aglyn/shared-data-enums'
import { type NextRequest, NextResponse } from 'next/server'

export default function middleware(req: NextRequest) {
  const {
    nextUrl: { pathname },
    headers,
  } = req
  // Get hostname (e.g. vercel.com, test.vercel.app, etc.)
  const requestHost = headers.get('host') || ''

  const { HOST, AGLYN_HOST, AGLYN_TENANT_HOST_CNAME } = process.env

  // If localhost, assign the host value manually
  // If prod, get the custom domain/subdomain value by removing the root URL
  // (in the case of "test.vercel.app", "vercel.app" is the root URL)
  let siteHost: string

  if (IS_PRODUCTION) {
    switch (true) {
      case requestHost === AGLYN_TENANT_HOST_CNAME:
      case requestHost.endsWith(`.${AGLYN_TENANT_HOST_CNAME}`):
        siteHost = AGLYN_TENANT_HOST_CNAME
        break
      default:
        requestHost.replace(`.${AGLYN_HOST}`, '')
        break
    }
  } else {
    // Development and testing (localhost:4500 / vercel.app)
    siteHost = requestHost.replace(`.${HOST}`, '')
  }

  // Prevent security issues – users should not be able to canonically access
  // the pages/_sites folder and its respective contents. This can also be
  // done via rewrites to a custom 404 page
  if (pathname.startsWith(`/_tenants`)) {
    return new Response(null, { status: 404 })
  }

  if (!IMPLICIT_DIRS.some((path) => pathname.startsWith(path))) {
    // rewrite to the current hostname under the pages/_sites folder
    // the main logic component will happen in pages/_sites/[host]/[...path].tsx
    return NextResponse.rewrite(
      buildRewriteSiteHostPath({ host: siteHost, pathname }),
    )
  }
}
