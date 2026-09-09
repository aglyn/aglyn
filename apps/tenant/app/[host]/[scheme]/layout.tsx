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
import { parseSchemeRouteSegment } from '@aglyn/shared-ui-theme/util/scheme-route-segment'
import type { ReactNode } from 'react'
import getSiteNav from '../../../utils/get-site-nav'
import { hostSeoTitleParts } from '../../../utils/not-found-title'
import AdminBarSlot from '../admin-bar/admin-bar-slot'
import getOrgBilling from '../../../utils/get-org-billing'
import { getHostCached } from '../host-data'
import { orgBrandFavicon, resolveSiteFaviconHref } from '../site-favicon'
import { HostThemeProviders } from '../host-theme-providers'

/**
 * Per-host layout (App Router): resolves the tenant host to apply its MUI
 * theme and preload its Google Fonts. This is the App Router home for the
 * per-host theming the Pages Router `_app` did from `pageProps.data.host` —
 * it depends on the resolved host, so it lives under `[host]` rather than
 * the host-agnostic root layout. Wraps both the catch-all render route and
 * the search route.
 *
 * It sits under `[scheme]` as well because the scheme is the other thing the
 * theme depends on and the other thing every route beneath shares (AGL-2708):
 * one layout builds the document in the scheme its path names, and the two
 * schemes cache separately.
 */
export default async function HostLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ host: string; scheme: string }>
}) {
  const { host, scheme } = await params
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
   * The site's public top-level pages (AGL-2187), for the error boundaries.
   *
   * Resolved HERE because `not-found.tsx` and `error.tsx` receive no `params`
   * and so cannot resolve the host at all — the same constraint that put the
   * logo and name on this line, documented on `host-brand.context.tsx`.
   *
   * Cached per host with a tag a publish busts, so this costs one cached
   * lookup on the render path rather than a screen sweep per page, and it
   * cannot reject: every failure inside degrades to an empty nav. A layout
   * that threw over a decoration for the 404 would take the whole site down
   * with it.
   */
  const siteLinks = await getSiteNav(hostRes.host)

  /**
   * The visitor's own light/dark choice, decided here rather than in the
   * browser.
   *
   * The switcher stores the choice in a cookie and the provider reads it with
   * `js-cookie`, which reads `document.cookie` — a global no server render
   * has. Left to that reader alone, a visitor who asked for dark is served a
   * light document and waits for React to hydrate the whole page before it
   * flips: on a screen of a few thousand nodes that is seconds of the wrong
   * scheme, and no flip at all where hydration never finishes. The cookie is
   * on the request; reading it here is what puts the chosen scheme in the
   * first byte.
   *
   * It has to be the SERVER that decides, not a media query or a pre-paint
   * script, because a site's dark scheme is resolved in JS and has no CSS
   * form: the MUI theme is single-mode and swapped between schemes, and every
   * node's persisted `@scheme dark` slice is merged against the active
   * theme's `palette.mode` while the tree renders. A stylesheet that flipped
   * the palette would leave those author overrides on their light values —
   * half a dark page.
   *
   * ⚠️ WHY THIS IS A PARAM AND NOT A COOKIE READ (AGL-2708).
   *
   * `cookies()` and `headers()` are dynamic APIs. Reading either one here
   * throws `DYNAMIC_SERVER_USAGE` the moment Next renders this segment in a
   * static context — which the catch-all page beneath asks for by declaring
   * `revalidate` and `generateStaticParams`. That is not a theoretical
   * hazard: it took every tenant page to a 500 in production, on a build
   * whose tests, typecheck and production builds were all green, because the
   * failure only appears when an ISR route regenerates at request time.
   *
   * So the request is read where reading it is free — the middleware, which
   * runs ahead of the cache on every request — and the answer is spent as a
   * path segment. Next's route cache keys on the pathname, so `light` and
   * `dark` are two cached documents of one page rather than one document that
   * can serve neither honestly. Per-visitor theming and a shared cache are
   * irreconcilable; per-SCHEME theming and two cached documents are not.
   *
   * The scheme arrives already resolved — `resolveSchemeRouteSegment` applies
   * the same precedence `useThemeModeState` does, so the server render and
   * the hydration after it cannot disagree. It is handed to the provider as
   * the DEVICE mode because that is the seat the resolved value occupies:
   * `useThemeModeState` takes `mode = cookieMode ?? systemMode`, and with no
   * cookie readable on the server, `systemMode` is what decides the markup.
   * The browser then reads the cookie itself at hydration, which is what
   * restores the "user chose this" half — a switcher radio inside a menu the
   * visitor has to open, never a colour that changes under them.
   *
   * What none of this gives up is the database. Every read underneath — the
   * host document and its id resolution, the screen, its version, the
   * components, the layout version, collections, forms, variables — goes
   * through `withRenderCache`, an `unstable_cache` keyed per host and held
   * for `PUBLISHED_SITE_DATA_TTL_SECONDS`, busted by the publish path's
   * `revalidateTag`.
   */
  const initialDeviceMode = parseSchemeRouteSegment(scheme)

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
  const titleParts = hostSeoTitleParts(hostRes.host)
  return (
    <HostThemeProviders
      hostTheme={hostTheme}
      initialDeviceMode={initialDeviceMode}
      brandLogoUrl={brandLogoUrl}
      brandName={hostRes.host?.displayName}
      siteLinks={siteLinks}
      hostKey={host}
      // The title parts the not-found boundary's client half composes with
      // on a client-side navigation (AGL-2648) — the same two fields its
      // `generateMetadata` reads on the server, so both halves agree.
      siteTitle={titleParts.siteTitle}
      titleSeparator={titleParts.separator}
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
