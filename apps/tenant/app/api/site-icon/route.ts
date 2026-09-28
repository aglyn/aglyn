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

import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { showsPlatformAttribution } from '@aglyn/aglyn/server'
import { getSiteLockdown } from '@aglyn/tenant-data-admin'
// Deep import: one predicate and the set it reads, not the theme barrel's
// React providers.
import { wearsPlatformBrand } from '@aglyn/shared-ui-theme/tenant.theme'
import { orgBrandFavicon } from '../../[host]/site-favicon'
import getHost from '../../../utils/get-host'
import getOrgBilling from '../../../utils/get-org-billing'
import {
  siteFaviconSrc,
  siteIconAnswer,
  type SiteIconKind,
} from '../../../utils/site-icons'

export const dynamic = 'force-dynamic'

/**
 * A 1×1 fully transparent PNG in an ICO container: the favicon of a site
 * that has none. A real image rather than a 404, so a tab paints the
 * browser's own blank and no uptime check or network log reports an error on
 * every page view.
 */
const BLANK_ICO = Buffer.from(
  'AAABAAEAAQEAAAEAIABEAAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAABAAAAAQgGAAAAHxXEiQAAAAtJREFUeJxjYAACAAAFAAF6Xqs/AAAAAElFTkSuQmCC',
  'base64',
)

// Cached at the edge per host like the manifest, but for minutes rather than
// an hour: an icon a customer just uploaded should reach a link preview soon.
const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=3600'

/**
 * Is this site under an active lock? The middleware already serves a locked
 * host's 503 ahead of the rewrite here; this covers a direct `/api` request,
 * which the middleware's matcher never sees.
 */
async function siteLocked(hostId: string | undefined): Promise<boolean> {
  if (!hostId) return false
  return (await getSiteLockdown(hostId)) !== null
}

/**
 * `/favicon.ico` and `/apple-touch-icon.png` for a tenant host (AGL-3382).
 *
 * Both used to be answered by the origin itself — the favicon was Aglyn's
 * multi-size mark, a static file in `public/`, and the touch icon a 404 — so an
 * unfurler that found no `apple-touch-icon` link on the page, which was every
 * one of them, previewed every customer's link as Aglyn. The middleware now
 * rewrites both paths here with the resolved host, the same way it reaches
 * the manifest, and this answers with the SITE's icon.
 *
 * A redirect rather than the bytes: the media CDN route already serves, caches
 * and signs these files, and a relative `Location` resolves against whatever
 * domain the visitor asked on — a custom domain or the platform subdomain —
 * without this route needing to know which.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  // Header first, query second — the same contract as the manifest route.
  const host =
    request.headers.get('x-aglyn-tenant-host') ??
    url.searchParams.get('host') ??
    ''
  const kind: SiteIconKind =
    (request.headers.get('x-aglyn-site-icon') ??
      url.searchParams.get('icon')) === 'apple-touch-icon'
      ? 'apple-touch-icon'
      : 'favicon'

  // The operator's own marketing hosts are decided before any read: their
  // icon is the platform's, and asking Firestore would only confirm it.
  const platformBrand = wearsPlatformBrand(host)
  const site = !platformBrand && host ? (await getHost({ host }))?.host : null
  // `no-store`: the lock lifting must not wait out a cached refusal.
  if (await siteLocked(site?.$id)) return notFound('no-store')
  // The org is only read when the site has no favicon of its own: its
  // white-label mark is the next fallback, and its plan decides whether the
  // last one is ours or a blank (AGL-2183).
  const org =
    kind === 'favicon' && site?.$id && !siteFaviconSrc(site)
      ? (await getOrgBilling({ hostId: site.$id })).org
      : undefined
  const brandFavicon =
    org && site?.$id
      ? resolveMediaSrc(orgBrandFavicon(org), { hostId: site.$id })
      : undefined

  const answer = siteIconAnswer({
    kind,
    platformBrand,
    host: site,
    brandFavicon,
    // An unread org suppresses, as the layout's link does: a blank tab for
    // one render beats our mark on a paid customer's domain.
    attribution: org ? showsPlatformAttribution(org) : false,
  })
  if (answer.kind === 'redirect') {
    return new Response(null, {
      status: 302,
      headers: { Location: answer.location, 'Cache-Control': CACHE_CONTROL },
    })
  }
  if (answer.kind === 'blank') {
    return new Response(new Uint8Array(BLANK_ICO), {
      status: 200,
      headers: {
        'Content-Type': 'image/x-icon',
        'Cache-Control': CACHE_CONTROL,
      },
    })
  }
  return notFound(CACHE_CONTROL)
}

function notFound(cacheControl: string): Response {
  return new Response(null, {
    status: 404,
    headers: { 'Cache-Control': cacheControl },
  })
}
