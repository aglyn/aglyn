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

// lockdown-423: exempt — the landing half of a console-minted preview link. It
// verifies a signed blob and plants one cookie on this host; no Firestore write
// and no content. A locked site is still locked: the middleware's verdict and
// the loader's lockdown branch both run before the preview the cookie opens.

import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import {
  SITE_PREVIEW_COOKIE,
  SITE_PREVIEW_COOKIE_TTL_MS,
  sitePreviewReturnPath,
} from '@aglyn/aglyn/app-utils/site-preview'
import {
  mintSitePreviewToken,
  verifySitePreviewToken,
} from '@aglyn/tenant-data-admin/server/site-preview-token'
import { CNAME_HOST_PREFIX, getHost } from '../../../../utils/get-host'

export const dynamic = 'force-dynamic'

/**
 * Enter a site that is in preview, on its own address (AGL-4086).
 *
 * A custom domain is cross-site with every console cookie, so the console
 * cannot tell the site who is visiting. What it CAN do is hand the browser a
 * link: `https://{the site}/api/site-preview/enter?blob=…&return=/…`, with a
 * two-minute blob bound to the site. This route checks the blob against the
 * site the REQUEST's host resolves to, plants `aglyn_site_preview` — HttpOnly,
 * `SameSite=Lax`, on this host alone, 12 hours — and 302s to the page.
 *
 * The same link works on `*.aglyn.app`, where the sign-in's hint cookie
 * usually recognizes the team already; the console uses it for every
 * "open the site" button while the site is in preview, so one click behaves
 * the same on either address.
 *
 * ## What it refuses
 *
 * - A `return` that could leave this origin (a scheme, `//host`, a
 *   backslash) is replaced by `/`. The redirect is always to a path here.
 * - A blob that is expired, forged, of the cookie kind, or minted for another
 *   site plants nothing; the browser still lands on the page, where it is
 *   answered as the public is.
 * - A request on a host that resolves to no site plants nothing.
 *
 * The cookie is worthless anywhere else: bound to the site, 12 hours, and
 * verified on every request by the preview route.
 */

/** The tenant host a request's hostname names, as the middleware spells it. */
function tenantHostFor(hostname: string): string | null {
  if (!hostname || hostname === TENANT_APEX) return null
  if (hostname.endsWith(`.${TENANT_APEX}`)) {
    return hostname.slice(0, -(TENANT_APEX.length + 1))
  }
  if (process.env.NODE_ENV !== 'production') {
    if (hostname === 'localhost') return process.env['AGLYN_TENANT_DEMO'] || 'demo'
    if (hostname.endsWith('.localhost')) {
      return hostname.slice(0, -'.localhost'.length) || null
    }
  }
  return `${CNAME_HOST_PREFIX}${hostname}`
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const destination = sitePreviewReturnPath(url.searchParams.get('return'))
  const headers = new Headers({
    Location: destination,
    'Cache-Control': 'no-store',
    // The blob is in this URL; the page it lands on must not repeat it to
    // anything that page loads.
    'Referrer-Policy': 'no-referrer',
  })

  const hostname = (request.headers.get('host') ?? '')
    .split(':')[0]
    .toLowerCase()
  const tenantHost = tenantHostFor(hostname)
  const blob = url.searchParams.get('blob')
  if (tenantHost && blob) {
    try {
      const hostRes = await getHost({ host: tenantHost })
      const hostId = String(hostRes.host?.$id ?? '')
      if (hostId && verifySitePreviewToken('enter', blob, hostId)) {
        const { token } = mintSitePreviewToken('cookie', hostId)
        const maxAge = Math.floor(SITE_PREVIEW_COOKIE_TTL_MS / 1000)
        const secure = url.protocol === 'https:' ? '; Secure' : ''
        headers.append(
          'Set-Cookie',
          `${SITE_PREVIEW_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
        )
      }
    } catch (error) {
      // A lookup that fails plants nothing; the page answers as it would.
      console.error('[site-preview/enter] host lookup failed', error)
    }
  }
  return new Response(null, { status: 302, headers })
}
