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

// Deep import (not the barrel) so this Server Component doesn't pull the
// theme lib's createContext HOCs into the RSC graph (AGL-405).
import { resolveSiteTheme } from '@aglyn/aglyn/app-utils/marketplace-theme'
import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { getGoogleFontsUrl } from '@aglyn/shared-ui-theme/util/host-theme'
import type { ReactNode } from 'react'
import AdminBarSlot from './admin-bar/admin-bar-slot'
import getOrgBilling from '../../utils/get-org-billing'
import { getHostCached } from './host-data'
import { orgBrandFavicon, resolveSiteFaviconHref } from './site-favicon'
import { HostThemeProviders } from './host-theme-providers'

/**
 * Per-host layout (App Router): resolves the tenant host to apply its MUI
 * theme and preload its Google Fonts. This is the App Router home for the
 * per-host theming the Pages Router `_app` did from `pageProps.data.host` —
 * it depends on the resolved host, so it lives under `[host]` rather than
 * the host-agnostic root layout. Wraps both the catch-all render route and
 * the search route.
 */
export default async function HostLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ host: string }>
}) {
  const { host } = await params
  const hostRes = await getHostCached(host)
  // default ⊕ marketplace theme ⊕ site overrides (AGL-1021). The default is
  // applied below by HostThemeProvider; these are the upper two layers.
  const hostTheme = resolveSiteTheme(hostRes.host)
  const fontsHref = getGoogleFontsUrl(hostTheme?.fonts)
  // The navigation loader's logo is a THIRD reader of `logoUrl`, alongside the
  // manifest icon and the white-label badge, and it resolved none of the stored
  // forms (AGL-1407). Site-RELATIVE is correct here — unlike the manifest icon,
  // this one really is an `<img>` on the page, with a base URL to resolve
  // against — so the plain resolver rather than the absolute one.
  const brandLogoUrl = resolveMediaSrc(hostRes.host?.logoUrl, {
    hostId: hostRes.host?.$id,
  })
  /**
   * The site's own favicon (AGL-1421).
   *
   * `seo.favicon` has had a console card and a stored value for as long as the
   * SEO toolkit has existed, and NOTHING rendered it — the app emitted no
   * `<link rel="icon">` at all, so every browser fell back to the origin's
   * `/favicon.ico`, which is `apps/tenant/public/favicon.ico`: **Aglyn's**
   * mark, in the tab of every customer's site. That is the same failure
   * AGL-1252 fixed for the install manifest, one surface over — a white-label
   * site is not white-label while our icon is in the tab.
   *
   * Emitted only when the site set one. A site with nothing configured keeps
   * today's fallback rather than getting an empty `href`, which browsers
   * resolve against the page and would request the page as an icon.
   *
   * Site-RELATIVE like the manifest link and the brand logo: this is fetched
   * by the document that declared it, so it has a base URL to resolve against.
   * (The manifest ICON is the exception — the OS fetches it with no page.)
   *
   * No `type`: the two favicons in production are an `.ico` and a `.png`, the
   * stored value carries no MIME, and a WRONG `type` is worse than none —
   * browsers use it to pick between candidates and will skip the only one.
   */
  const siteFavicon = resolveMediaSrc(hostRes.host?.seo?.favicon, {
    hostId: hostRes.host?.$id,
  })

  /**
   * The white-label half AGL-1421 left open (AGL-2183).
   *
   * The comment above is right that an EMPTY href is worse than none — but
   * "none" means the browser requests the origin's `/favicon.ico`, and on this
   * app that file is Aglyn's mark. So on a white-label customer's own domain,
   * the tab carried our logo, on the very surface whose comment says a
   * white-label site is not white-label while it does.
   *
   * Two additions, in precedence order after the site's own icon:
   *
   *  - the ORG's `branding.faviconUrl`. That field was collected in the
   *    branding editor, validated, persisted and resolved, and read by exactly
   *    one consumer — the console's own chrome. An agency uploaded its mark
   *    and got it nowhere their clients' visitors would ever look.
   *  - failing both, `data:,` for an org entitled to concealment. It is the
   *    standard "no favicon" form: a valid, empty data URL, so the browser
   *    renders nothing and never falls back to the origin. A blank tab is a
   *    small loss; a competitor's logo in it is a broken promise.
   *
   * `showsPlatformAttribution` is the gate rather than a fresh entitlement
   * check, because it already encodes the asymmetry this needs: an UNRESOLVED
   * org suppresses. `getOrgBilling` fails open with `org: null` on a Firestore
   * error, `resolveOrgEntitlements(null)` resolves to the free plan, and a
   * transient read failure on an Agency site would otherwise put our mark back
   * in their tab.
   *
   * No new Firestore read: `getOrgBilling` is render-cached on a 60s TTL and
   * `load-page-data` already calls it for this same request.
   */
  const orgRes = await getOrgBilling({ hostId: hostRes.host?.$id })
  const faviconHref = resolveSiteFaviconHref({
    siteFavicon,
    brandFavicon: resolveMediaSrc(orgBrandFavicon(orgRes.org), {
      hostId: hostRes.host?.$id,
    }),
    org: orgRes.org,
  })
  return (
    <HostThemeProviders
      hostTheme={hostTheme}
      brandLogoUrl={brandLogoUrl}
      brandName={hostRes.host?.displayName}
    >
      {/* Per-host manifest (AGL-1252). A relative href on purpose: the
          browser resolves it against the site's own origin, so one link tag
          serves every customer domain and every aglyn.app subdomain without
          the layout needing to know which it is on. */}
      <link rel="manifest" href="/manifest.webmanifest" />
      {faviconHref ? <link rel="icon" href={faviconHref} /> : null}
      {fontsHref ? (
        <>
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link rel="stylesheet" href={fontsHref} />
        </>
      ) : null}
      {children}
      {/* Edit-access admin bar (AGL-1302 follow-on) — renders nothing unless
          release_edit_bar is on; anonymous visitors get no output at all. */}
      <AdminBarSlot host={host} />
    </HostThemeProviders>
  )
}
