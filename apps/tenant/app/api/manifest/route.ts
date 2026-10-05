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

import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
import { resolveSiteTheme } from '@aglyn/aglyn/app-utils/site-theme'
import { getSiteIconFacts } from '@aglyn/tenant-runtime/get-site-icon-facts'
import getHost from '../../../utils/get-host'
import {
  buildSiteManifest,
  siteManifestIconSrc,
} from '../../../utils/site-icons'

export const dynamic = 'force-dynamic'

/**
 * Per-host web app manifest (AGL-1252).
 *
 * `apps/tenant` serves every customer's site from one codebase, so the static
 * manifest that has sat unreferenced in `public/_static/_pwa/` since the App
 * Router migration could never have been linked: it advertises every site as
 * "Aglyn", with Aglyn's icons and colour. A customer installing their own shop
 * would get **our** branding on their home screen — worse than not being
 * installable, because it reads as a bug they cannot fix.
 *
 * Reached the same way `sitemap.xml` and `robots.txt` are: the middleware
 * rewrites `{tenant-site}/manifest.webmanifest` here with the resolved host.
 * That indirection is not decoration — the tenant matcher excludes anything
 * matching `[\w-]+\.\w+`, so a manifest served from a `[host]/…` route would
 * never be rewritten and would 404 on every site. Two existing files already
 * hit that wall, which is why they live here too.
 *
 * Every field is derived from the site's settings by `buildSiteManifest`
 * (AGL-3484), including the full icon set — ten `any` sizes and two maskable
 * ones, each drawn at its declared size from the site's App icon, favicon or
 * logo. The one read this adds is the icon source's media document, for its
 * type and the content hash that versions every icon URL.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  // Header first, query second — the query can be dropped across dev
  // rewrites, which is why the middleware sends both.
  const host =
    request.headers.get('x-aglyn-tenant-host') ??
    url.searchParams.get('host') ??
    ''

  const hostRes = host ? await getHost({ host }) : null
  const site = hostRes?.host
  const theme = site ? resolveSiteTheme(site) : undefined
  const facts = await getSiteIconFacts({
    hostId: site?.$id,
    srcs: [siteManifestIconSrc(site)],
  })
  const manifest = buildSiteManifest({
    site,
    theme,
    origin: hostPublicOrigin(site),
    facts,
  })

  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      // The spec's own type. `application/json` works in practice but some
      // installability checks are stricter.
      'Content-Type': 'application/manifest+json',
      // Cached at the edge per host, like the other per-host SEO files, and
      // revalidated on publish through the existing path.
      'Cache-Control': 's-maxage=3600, stale-while-revalidate',
    },
  })
}
