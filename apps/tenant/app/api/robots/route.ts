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

import { buildRobotsTxt, hostPublicOrigin } from '@aglyn/aglyn/server'
import getHost from '../../../utils/get-host'

export const dynamic = 'force-dynamic'

/**
 * Per-host robots.txt (SEO Toolkit): the middleware rewrites
 * `{tenant-site}/robots.txt` here. Allows everything and points crawlers at
 * the host's sitemap — unless the site has search discouraged (AGL-1263), in
 * which case it disallows everything and names no sitemap.
 *
 * That switch is why this route reads the host record at all; it used to be a
 * pure function of the request. The lookup also fixes the AGL-1160 bug the
 * sitemap and RSS already had here: the `Sitemap:` line was built from the
 * `Host` header, so a site reachable on both its custom domain and
 * `.aglyn.app` pointed crawlers at whichever name they happened to arrive on,
 * and a preview deployment advertised a `*.vercel.app` sitemap. A cache keys
 * on the URL and never the header, so one cached response could serve the
 * wrong origin to everyone.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const requestHost = request.headers.get('host') ?? ''
  const tenantHost = String(
    request.headers.get('x-aglyn-tenant-host') ??
      url.searchParams.get('host') ??
      '',
  )

  // Fail OPEN, deliberately: an unresolvable host yields the permissive
  // default rather than `Disallow: /`. A transient Firestore error must not be
  // able to de-index a customer's site, and the pages themselves still carry
  // the correct `noindex` either way.
  const host = tenantHost ? (await getHost({ host: tenantHost })).host : null
  const origin =
    hostPublicOrigin(host) ?? (requestHost ? `https://${requestHost}` : undefined)

  return new Response(buildRobotsTxt({ host, origin }), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      // CDN-cache for 5 minutes, serve stale up to an hour while refreshing
      // (AGL-1302) — matching the sitemap. The host read behind this route is
      // now served from the tagged document cache anyway, so flipping the
      // discourage switch still shows within about a minute of the doc TTL
      // even where a CDN honors the longer window. See the sitemap route's
      // measured note (AGL-1160): production overrode this header entirely,
      // so it states intent for fronts that respect it rather than being the
      // mechanism that saves the reads.
      'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
    },
  })
}
