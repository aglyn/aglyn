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

// Deep import, like every other reader of these fields on the render path.
import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { resolvePageLocale } from '@aglyn/aglyn/app-utils/seo-locale'
import {
  DEFAULT_SITE_ICON_BACKGROUND,
  normalizeSiteIconBackground,
  type SiteIconSourceFacts,
  type SiteManifestIcon,
  siteIconDerivable,
  siteIconSrc,
  siteManifestIcons,
} from '@aglyn/aglyn/app-utils/site-icon-set'
import type { HostTheme } from '@aglyn/shared-data-types'

/**
 * The icons and colors a link preview, a home screen and a browser tab take
 * from a published site (AGL-3382).
 *
 * A link unfurler (iMessage, Slack) and Safari read three things: the page's
 * `apple-touch-icon`, failing that the origin's `/apple-touch-icon.png` and
 * `/favicon.ico`, and `<meta name="theme-color">`. The page emitted neither
 * of the first and the origin answered the fallbacks with Aglyn's own mark,
 * so every customer's link previewed as Aglyn. These are the pure halves of
 * the fix, shared by the `[host]` layout, the manifest and the icon route so
 * the three cannot disagree about which icon or which color is the site's.
 */

/** The fields of a host record this module reads. */
export interface SiteIconHost {
  $id?: string
  seo?: { favicon?: string; appIcon?: string } | null
}

/** The fields of a host record the manifest reads. */
export interface SiteManifestHost extends SiteIconHost {
  name?: string
  displayName?: string
  logoUrl?: string
  defaultLocale?: string
  locales?: string[]
  seo?: {
    title?: string
    description?: string
    favicon?: string
    appIcon?: string
  } | null
}

/**
 * The site's favicon, resolved to a fetchable site-relative src.
 *
 * The same resolver the layout's `<link rel="icon">` uses, so a `media:`
 * reference, a legacy CDN path and a raw URL all resolve exactly as they do
 * there.
 */
export function siteFaviconSrc(
  host: SiteIconHost | null | undefined,
): string | undefined {
  return resolveMediaSrc(host?.seo?.favicon, { hostId: host?.$id })
}

/**
 * The site's `apple-touch-icon`: its square app icon, failing that its
 * favicon, failing both nothing.
 *
 * The app icon comes first because it is artwork drawn for exactly this
 * slot — a square mark shown large. A favicon is a 16–32px glyph and scales
 * up poorly, but it is still the SITE's mark, which is the whole point: an
 * unfurler that finds no link falls back to the origin's own files.
 *
 * `logoUrl` is deliberately NOT a fallback here, unlike the manifest. A
 * wordmark is a wide rectangle, and iOS crops a touch icon to a square — the
 * result is a sliver of the lockup, which reads as broken rather than as the
 * site.
 */
export function siteAppleTouchIconSrc(
  host: SiteIconHost | null | undefined,
): string | undefined {
  return (
    resolveMediaSrc(host?.seo?.appIcon, { hostId: host?.$id }) ||
    siteFaviconSrc(host)
  )
}

/**
 * The site's primary color in one scheme, as the manifest's `theme_color`
 * reads it: the resolved site theme's `primary.main`, with no default.
 *
 * Undefined rather than a fallback so each caller decides what "unset" means.
 * The manifest needs a value and uses a neutral black; a `<meta>` is better
 * omitted, which leaves the browser's own chrome color in place.
 */
export function siteThemeColor(
  theme: HostTheme | null | undefined,
  scheme: 'light' | 'dark',
): string | undefined {
  return theme?.colorSchemes?.[scheme]?.primary?.main || undefined
}

export interface ThemeColorMeta {
  content: string
  media?: string
}

/**
 * The `<meta name="theme-color">` tags a site emits.
 *
 * One tag with no `media` for a light-only site. When the site authored a
 * dark primary and has not turned dark off (`darkScheme: 'off'` keeps every
 * visitor on light), the two schemes each get a tag scoped to their
 * `prefers-color-scheme`, which is the form Safari and Chrome both honor.
 */
export function siteThemeColorMeta(
  theme: HostTheme | null | undefined,
): ThemeColorMeta[] {
  const light = siteThemeColor(theme, 'light')
  const dark =
    theme?.darkScheme === 'off' ? undefined : siteThemeColor(theme, 'dark')
  if (!dark || dark === light) return light ? [{ content: light }] : []
  return [
    ...(light
      ? [{ content: light, media: '(prefers-color-scheme: light)' }]
      : []),
    { content: dark, media: '(prefers-color-scheme: dark)' },
  ]
}

/** What a home screen shows under an installed icon, and it cuts hard. */
export const MANIFEST_SHORT_NAME_MAX = 12

/**
 * The manifest's `short_name`: the longest run of whole leading words that
 * fits in {@link MANIFEST_SHORT_NAME_MAX} characters.
 *
 * Never a mid-word cut — `Ready To Roll` becomes `Ready To`, not
 * `Ready To Rol`. When even the first word is too long it is kept whole: the
 * OS then ellipsizes a real word, which reads as a name, where a cut of our
 * own reads as a typo.
 */
export function manifestShortName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length <= MANIFEST_SHORT_NAME_MAX) return trimmed
  const words = trimmed.split(/\s+/)
  let short = words[0]
  for (const word of words.slice(1)) {
    const next = `${short} ${word}`
    if (next.length > MANIFEST_SHORT_NAME_MAX) break
    short = next
  }
  return short
}

/**
 * The plate a flattened or maskable icon is drawn on, and the manifest's
 * `background_color`: the light scheme's page background, as six hex digits.
 *
 * Light for the manifest's reason — these paint before any
 * `prefers-color-scheme` applies — and white when the site has no theme or a
 * background that is not a plain color, so a site with nothing set looks
 * unbranded rather than like ours.
 */
export function siteIconBackground(
  theme: HostTheme | null | undefined,
): string {
  return (
    normalizeSiteIconBackground(
      theme?.colorSchemes?.light?.background?.default,
    ) ?? DEFAULT_SITE_ICON_BACKGROUND
  )
}

/**
 * The source of the manifest's icon set (AGL-3484): the site's App icon, then
 * its favicon, then its logo — resolved, still site-relative.
 *
 * Every size is center-fit from this one file, so a wide logo installs
 * letterboxed rather than stretched; the App icon leads because it is the
 * artwork drawn for exactly this slot.
 */
export function siteManifestIconSrc(
  host: SiteManifestHost | null | undefined,
): string | undefined {
  return (
    resolveMediaSrc(host?.seo?.appIcon, { hostId: host?.$id }) ||
    siteFaviconSrc(host) ||
    resolveMediaSrc(host?.logoUrl, { hostId: host?.$id })
  )
}

/** The site's web app manifest, every field derived from its settings. */
export interface SiteManifest {
  name: string
  short_name: string
  description?: string
  lang: string
  start_url: '/'
  scope: '/'
  display: 'standalone'
  theme_color: string
  background_color: string
  icons?: SiteManifestIcon[]
}

/**
 * The whole web app manifest for a site (AGL-3484) — nothing in it is entered
 * by hand, so a customer who never thinks about installability still gets a
 * complete one from what they already filled in.
 *
 *  - `name` — the SEO title, then the site's display name, then its name.
 *  - `short_name` — {@link manifestShortName} of that.
 *  - `description` — the SEO description, when there is one.
 *  - `lang` — the Languages card, through the same chain as `<html lang>`.
 *  - `start_url` and `scope` — the site root.
 *  - `theme_color` / `background_color` — the LIGHT scheme's primary and page
 *    background, neutral black and white when unset.
 *  - `icons` — {@link siteManifestIcons} of {@link siteManifestIconSrc}, made
 *    absolute against `origin`. A site with no mark, or one whose mark cannot
 *    be absolutized, gets no `icons` at all, so an installer falls back to a
 *    screenshot instead of a broken tile (AGL-1022).
 *
 * `facts` is what `getSiteIconFacts` read for the icon source, keyed by its
 * site-relative src; absent facts derive the set without a cache version.
 */
export function buildSiteManifest(options: {
  site: SiteManifestHost | null | undefined
  theme: HostTheme | null | undefined
  /** The site's public origin, for absolute icon URLs. */
  origin?: string | null
  facts?: ReadonlyMap<string, SiteIconSourceFacts>
}): SiteManifest {
  const { site, theme, origin, facts } = options
  const name =
    site?.seo?.title?.trim() || site?.displayName || site?.name || 'Site'
  const description = site?.seo?.description?.trim()
  const background = siteIconBackground(theme)
  const relative = siteManifestIconSrc(site)
  const icons = siteManifestIcons(
    absoluteIconSrc(relative, origin),
    relative ? facts?.get(relative) : undefined,
    background,
  )
  return {
    name,
    short_name: manifestShortName(name),
    ...(description ? { description } : {}),
    lang: resolvePageLocale({ host: site }),
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: siteThemeColor(theme, 'light') || '#000000',
    background_color: `#${background}`,
    ...(icons.length ? { icons } : {}),
  }
}

/**
 * A resolved src made absolute: an installer fetches manifest icons out of
 * band, with no page to resolve a relative src against (AGL-1407). Already
 * absolute passes through; relative with no origin is `undefined`, never a
 * guess.
 */
function absoluteIconSrc(
  src: string | undefined,
  origin: string | null | undefined,
): string | undefined {
  if (!src) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src
  if (src.startsWith('//')) return `https:${src}`
  if (!origin) return undefined
  return src.startsWith('/') ? `${origin}${src}` : `${origin}/${src}`
}

/** The two origin-level icon paths an unfurler or browser falls back to. */
export type SiteIconKind = 'favicon' | 'apple-touch-icon'

/**
 * The platform's own icons, for the operator's marketing hosts only. Both
 * live under `/_static`, which the tenant middleware never rewrites.
 */
export const PLATFORM_ICON_PATHS: Record<SiteIconKind, string> = {
  favicon: '/_static/favicon.ico',
  'apple-touch-icon': '/_static/images/brand/icon-180x180.png',
}

export type SiteIconAnswer =
  | { kind: 'redirect'; location: string }
  | { kind: 'blank' }
  | { kind: 'not-found' }

/**
 * How `/favicon.ico` or `/apple-touch-icon.png` answers on a host.
 *
 *  - The operator's own marketing hosts keep the platform's icon — theirs IS
 *    the platform brand.
 *  - Every other host gets its own icon: a touch icon from
 *    {@link siteAppleTouchIconSrc}, a favicon from the site's favicon and
 *    then the org's white-label mark, the same precedence the layout's
 *    `<link rel="icon">` follows.
 *  - A site with no favicon keeps the attribution rule the layout's link
 *    follows (AGL-2183, `resolveSiteFaviconHref`): where the plan shows
 *    platform attribution the favicon is ours, as it always was; anywhere
 *    else it is a transparent blank, so a white-label tab shows the browser's
 *    default rather than a 404 in every visitor's network log. The touch icon
 *    is never ours on a customer host — a plain 404 is what an unfurler
 *    treats as "no icon".
 */
export function siteIconAnswer(options: {
  kind: SiteIconKind
  /** Whether the host is one of the operator's own brand hosts. */
  platformBrand: boolean
  host: SiteIconHost | null | undefined
  /** The org's white-label favicon, already resolved to a fetchable src. */
  brandFavicon?: string
  /** `showsPlatformAttribution(org)` — false when the org could not be read. */
  attribution?: boolean
  /** `getSiteIconFacts` for the source, keyed by its resolved src. */
  facts?: ReadonlyMap<string, SiteIconSourceFacts>
  /** {@link siteIconBackground} — the touch icon's plate. */
  background?: string
}): SiteIconAnswer {
  const { kind, platformBrand, host, brandFavicon, attribution } = options
  if (platformBrand) {
    return { kind: 'redirect', location: PLATFORM_ICON_PATHS[kind] }
  }
  const source = siteIconSourceFor(kind, host, brandFavicon)
  if (source) {
    return {
      kind: 'redirect',
      location: siteIconLocation(kind, source, options),
    }
  }
  if (kind === 'apple-touch-icon') return { kind: 'not-found' }
  return attribution
    ? { kind: 'redirect', location: PLATFORM_ICON_PATHS.favicon }
    : { kind: 'blank' }
}

/** The file `/favicon.ico` or `/apple-touch-icon.png` is derived from. */
export function siteIconSourceFor(
  kind: SiteIconKind,
  host: SiteIconHost | null | undefined,
  brandFavicon?: string,
): string | undefined {
  return kind === 'apple-touch-icon'
    ? siteAppleTouchIconSrc(host)
    : siteFaviconSrc(host) || brandFavicon
}

/**
 * Where an origin-level icon path sends the browser (AGL-3484): the derived
 * multi-size ICO for `/favicon.ico`, the 180px flattened touch icon for
 * `/apple-touch-icon.png`, both versioned so they cache for a year. A source
 * with no renderer behind it — a hotlink, an uploaded `.ico` — is the
 * original, as it always was.
 */
function siteIconLocation(
  kind: SiteIconKind,
  source: string,
  options: {
    facts?: ReadonlyMap<string, SiteIconSourceFacts>
    background?: string
  },
): string {
  const facts = options.facts?.get(source)
  if (!siteIconDerivable(source, facts)) return source
  const version = facts?.contentHash
  return (
    (kind === 'apple-touch-icon'
      ? siteIconSrc(
          source,
          { plate: 'flat', size: 180 },
          { background: options.background, version },
        )
      : siteIconSrc(source, { plate: 'ico' }, { version })) ?? source
  )
}
