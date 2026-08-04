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

import { resolveSiteTheme } from '@aglyn/aglyn/app-utils/marketplace-theme'
import getHost from '../../../utils/get-host'

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

  const name = site?.displayName || site?.name || 'Site'
  // `short_name` is what a home screen actually shows, and it is truncated
  // hard. Better to cut it deliberately than let the OS do it mid-word.
  const shortName = name.length > 12 ? `${name.slice(0, 12).trim()}` : name

  // The site's own colours, from the LIGHT scheme.
  //
  // A manifest carries one `theme_color` and one `background_color`, but a
  // theme here defines light and dark independently (AGL-1020) — so this is a
  // choice, not a lookup. Light is the right one: these values paint the
  // install prompt and the splash screen, which the OS shows before the page
  // has rendered and therefore before any `prefers-color-scheme` is applied.
  //
  // Defaults are neutral rather than ours: a site with no theme should look
  // unbranded, not like Aglyn.
  const light = theme?.colorSchemes?.light
  const themeColor = light?.primary?.main || '#000000'
  const backgroundColor = light?.background?.default || '#ffffff'

  /**
   * Icons come from the site's own logo when it has one.
   *
   * The empty case is deliberate rather than incidental (AGL-1022's rule): a
   * site with no logo gets **no `icons` array at all**, so the browser falls
   * back to a screenshot of the page. An entry pointing at a missing image
   * would install a broken tile, which is the failure this whole issue is
   * about — someone else's branding, or none, on a customer's home screen.
   */
  const icons = site?.logoUrl
    ? [
        {
          src: site.logoUrl,
          // `any` rather than `maskable`: a logo that has not been designed
          // with a safe zone gets cropped into a circle on Android, and we
          // cannot know whether a customer's has one.
          purpose: 'any',
          sizes: '512x512',
        },
      ]
    : undefined

  const manifest = {
    name,
    short_name: shortName,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: themeColor,
    background_color: backgroundColor,
    ...(icons ? { icons } : {}),
  }

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
