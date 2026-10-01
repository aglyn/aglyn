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

/**
 * THE "YOU'RE LEAVING THIS SITE" NOTICE (AGL-3452).
 *
 * A new free site's links to other domains come here first, as
 * `/_aglyn/leaving?to=<address>&sig=<signature>` on the site's own host. The
 * middleware rewrites that path to this handler and hands it the resolved
 * site in `x-aglyn-tenant-host`, as it does for `/api/locked` and the SEO
 * files; a request that arrives without the header did not come through a
 * site, and is answered with nothing.
 *
 * ## It never redirects
 *
 * A valid signature gets a page with the address in plain text and a
 * Continue LINK the visitor has to press. Nothing here sends a `Location`, so
 * a signed URL pasted into an email is still a warning page, never a hop.
 *
 * ## It refuses what the site did not link
 *
 * The signature binds the address to this site (`verifyLeavingDestination`).
 * An address without one, with another site's, or edited after signing gets
 * a 400 that prints no address and offers no Continue: otherwise any site's
 * notice would vouch for any address anyone chose to put in a link.
 *
 * The window is not re-checked here. The page that carried the link decided
 * that when it rendered; a signature that outlives its page only buys the
 * same warning again.
 */

import { hostPublicOrigin, resolveBrandingProfile } from '@aglyn/aglyn/server'
import {
  LEAVING_NOTICE_DESTINATION_PARAM,
  LEAVING_NOTICE_PATH,
  LEAVING_NOTICE_SIGNATURE_PARAM,
  normalizeLeavingDestination,
} from '@aglyn/aglyn/app-utils/leaving-notice'
import { siteOwnHosts } from '@aglyn/aglyn/app-utils/site-return-url'
import { visitorContentRefusal } from '@aglyn/tenant-data-admin'
import { verifyLeavingDestination } from '@aglyn/tenant-data-admin/server/leaving-notice'
import getHost from '../../../utils/get-host'
import getOrgBilling from '../../../utils/get-org-billing'
import {
  leavingBackHref,
  leavingNoticeHtml,
  leavingNoticeResponse,
  leavingRefusedHtml,
} from '../../../utils/leaving-notice-page'

export const dynamic = 'force-dynamic'

const notFound = () =>
  leavingNoticeResponse(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="robots" content="noindex, nofollow"><title>Not found</title>' +
      '</head><body><p>Not found.</p></body></html>',
    404,
  )

export async function GET(request: Request): Promise<Response> {
  // The HEADER only. The middleware sets it from the request's real host,
  // overwriting anything a client sent; a query parameter would let one
  // site's address render another site's notice.
  const tenantHost = request.headers.get('x-aglyn-tenant-host') ?? ''
  if (!tenantHost) return notFound()
  const { host } = await getHost({ host: tenantHost })
  const hostId = host?.$id as string | undefined
  if (!host || !hostId) return notFound()

  // A site taken down under a full lock serves nothing over `/api`, and a
  // notice vouching for its links is some of it. The middleware already
  // rewrites a locked site's `/_aglyn/leaving` to the lockdown notice; this
  // holds for a request that reached the handler another way.
  const down = await visitorContentRefusal({ hostId })
  if (down) return down

  const own = siteOwnHosts(host)
  const requestHostname = (request.headers.get('host') ?? '')
    .split(':')[0]
    .toLowerCase()
  const publicHostname = (() => {
    const origin = hostPublicOrigin(host)
    return origin ? new URL(origin).hostname : ''
  })()
  const siteHost = own.includes(requestHostname)
    ? requestHostname
    : publicHostname || requestHostname
  const referer = request.headers.get('referer')
  const backHosts = requestHostname ? [requestHostname, ...own] : own
  const backHref = leavingBackHref(referer, backHosts, LEAVING_NOTICE_PATH)
  const reported =
    backHref !== '/' && referer ? referer : `https://${siteHost}/`
  const site = {
    siteHost,
    backHref,
    reportHref: `/api/report-abuse?url=${encodeURIComponent(reported)}`,
  }

  // A rewritten request keeps the visitor's own URL, query included.
  const params = new URL(request.url).searchParams
  const destination = normalizeLeavingDestination(
    params.get(LEAVING_NOTICE_DESTINATION_PARAM),
  )
  if (
    !destination ||
    !verifyLeavingDestination(
      hostId,
      destination,
      params.get(LEAVING_NOTICE_SIGNATURE_PARAM),
    )
  ) {
    return leavingNoticeResponse(leavingRefusedHtml(site), 400)
  }

  // The product name the free tier already shows on this site's badge, so a
  // white-labelled workspace's notice names its own brand.
  const { org } = await getOrgBilling({ hostId })
  const brandName = resolveBrandingProfile(org as never).productName
  return leavingNoticeResponse(
    leavingNoticeHtml({ ...site, destination, brandName }),
  )
}
