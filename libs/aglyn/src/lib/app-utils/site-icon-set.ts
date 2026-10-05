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

import { MEDIA_CDN_SEGMENT } from './media-cdn-scope'
import { isMediaCdnUrl } from './media-ref'

/**
 * Every icon a published site serves, derived from the one file its author
 * uploaded (AGL-3484).
 *
 * A site's Favicon and App icon are a single media reference each. A browser
 * tab draws 16px, iOS a 180px touch icon, an installer anything from 48px to
 * 512px plus a maskable tile — and every one of them used to download the
 * original upload, a 512×512 PNG to paint a 16px tab. This module is the
 * grammar of the derived set: which sizes exist, how each is addressed on the
 * media CDN, and which `<link>` and manifest entries describe them. The pixels
 * are drawn by `site-icon-render.ts` in `@aglyn/tenant-data-admin`, behind the
 * `?icon=` representation of `serveMediaCdn`; the tenant layout, manifest and
 * `/favicon.ico` route build their URLs here, so the three can never name a
 * size the renderer does not draw.
 *
 * ## Addressing
 *
 * A derived icon is the asset's own stable CDN URL plus three parameters:
 *
 *  - `icon` — the {@link SiteIconSpec}, e.g. `png-32`, `flat-180`,
 *    `maskable-512` or `ico`. Only the sizes listed below parse, so the cache
 *    key space is bounded and nobody can ask the renderer for a 20000px tile.
 *  - `bg` — the plate color, six hex digits, for the two plates that have one.
 *  - `v` — the asset's `contentHash`. With it the response is cached for a
 *    year; a DAM Replace changes the hash, so the next render names a new URL
 *    and the old one is never asked for again. A stale `v` that does arrive
 *    redirects to the current one.
 */

/** The CDN query parameter that selects a derived icon. */
export const SITE_ICON_PARAM = 'icon'
/** The plate color of a flattened or maskable icon, six hex digits. */
export const SITE_ICON_BACKGROUND_PARAM = 'bg'
/** The asset's `contentHash`, which keys the year-long cache. */
export const SITE_ICON_VERSION_PARAM = 'v'

/** Tab, bookmark and taskbar sizes, as `<link rel="icon" type="image/png">`. */
export const FAVICON_PNG_SIZES = [16, 32, 48] as const
/** The images packed into the site's `/favicon.ico`. */
export const FAVICON_ICO_SIZES = [16, 32, 48] as const
/** iPhone (180), iPad Pro (167) and iPad (152) home-screen icons. */
export const APPLE_TOUCH_ICON_SIZES = [180, 167, 152] as const
/** The manifest's `purpose: "any"` set. */
export const MANIFEST_ICON_SIZES = [
  48, 72, 96, 128, 144, 152, 192, 256, 384, 512,
] as const
/** The manifest's `purpose: "maskable"` set. */
export const MANIFEST_MASKABLE_ICON_SIZES = [192, 512] as const

/**
 * The diameter of the maskable safe zone, as a fraction of the icon.
 *
 * The Web App Manifest spec promises only a centered circle of 40% radius
 * survives every launcher mask. A mark's box is therefore fitted inside the
 * square INSCRIBED in that circle — {@link maskableMarkSize} — so even its
 * corners stay uncropped on a circle mask.
 */
export const MASKABLE_SAFE_ZONE = 0.8

/** The plate of a site with no theme background: white, like the manifest's. */
export const DEFAULT_SITE_ICON_BACKGROUND = 'ffffff'

/**
 * One derived icon.
 *
 *  - `transparent` — the mark center-fit on a transparent square. Favicons
 *    and the manifest's `any` set.
 *  - `flat` — the same, flattened onto the theme background. iOS renders
 *    transparency black, so every apple-touch-icon is one of these.
 *  - `maskable` — the mark inside the safe zone on the theme background.
 *  - `ico` — the {@link FAVICON_ICO_SIZES} transparent PNGs in one ICO.
 */
export type SiteIconSpec =
  | { plate: 'transparent' | 'flat' | 'maskable'; size: number }
  | { plate: 'ico' }

const PLATE_SIZES: Record<
  Exclude<SiteIconSpec['plate'], 'ico'>,
  readonly number[]
> = {
  transparent: [...new Set([...FAVICON_PNG_SIZES, ...MANIFEST_ICON_SIZES])],
  flat: APPLE_TOUCH_ICON_SIZES,
  maskable: MANIFEST_MASKABLE_ICON_SIZES,
}

const PLATE_PREFIX = {
  transparent: 'png',
  flat: 'flat',
  maskable: 'maskable',
} as const

/** The spec's spelling in the `icon` parameter. */
export function formatSiteIconSpec(spec: SiteIconSpec): string {
  return spec.plate === 'ico' ? 'ico' : `${PLATE_PREFIX[spec.plate]}-${spec.size}`
}

/**
 * Reads the `icon` parameter back; `null` for anything this module would not
 * have written — an unknown plate, or a size outside that plate's list.
 */
export function parseSiteIconSpec(value: unknown): SiteIconSpec | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return null
  if (raw === 'ico') return { plate: 'ico' }
  const match = /^(png|flat|maskable)-(\d{1,4})$/.exec(raw)
  if (!match) return null
  const plate = (Object.keys(PLATE_PREFIX) as Array<keyof typeof PLATE_PREFIX>)
    .find((key) => PLATE_PREFIX[key] === match[1])
  const size = Number(match[2])
  if (!plate || !PLATE_SIZES[plate].includes(size)) return null
  return { plate, size }
}

/** Whether a spec is drawn on the theme background rather than transparency. */
export function siteIconUsesBackground(spec: SiteIconSpec): boolean {
  return spec.plate === 'flat' || spec.plate === 'maskable'
}

/** The served type of a derived icon. */
export function siteIconContentType(spec: SiteIconSpec): string {
  return spec.plate === 'ico' ? 'image/x-icon' : 'image/png'
}

/**
 * The side of the box a maskable icon's mark is fitted into: the square
 * inscribed in the {@link MASKABLE_SAFE_ZONE} circle, so no launcher mask can
 * reach any part of it.
 */
export function maskableMarkSize(size: number): number {
  return Math.floor((size * MASKABLE_SAFE_ZONE) / Math.SQRT2)
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i

/**
 * A theme color as the `bg` parameter carries it: six lowercase hex digits,
 * or `undefined` for anything that is not a plain color.
 *
 * A theme's `background.default` is free CSS text. `#rgb`, `#rrggbb`,
 * `#rrggbbaa` (alpha dropped — a plate is opaque by definition) and `rgb()` /
 * `rgba()` are read; a gradient, a `var()` or a named color is not a color
 * this module can put in a URL, and the caller's default stands in.
 */
export function normalizeSiteIconBackground(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  const hex = HEX.exec(trimmed)
  if (hex) {
    const digits = hex[1].toLowerCase()
    if (digits.length === 3) {
      return digits
        .split('')
        .map((digit) => digit + digit)
        .join('')
    }
    return digits.slice(0, 6)
  }
  const rgb = RGB.exec(trimmed)
  if (rgb) {
    const channels = rgb.slice(1, 4).map(Number)
    if (channels.some((channel) => channel > 255)) return undefined
    return channels
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')
  }
  return undefined
}

/**
 * What one read of the source asset's media document says, or `null` when it
 * was not read (a raw URL, or a failed read).
 */
export interface SiteIconSourceFacts {
  /** The upload's MIME type. */
  contentType?: string
  /** The upload's content hash — the cache key a DAM Replace changes. */
  contentHash?: string
}

/** Types `sharp` cannot decode, which therefore pass through as uploaded. */
const UNDERIVABLE_TYPES: ReadonlySet<string> = new Set([
  'image/x-icon',
  'image/vnd.microsoft.icon',
])

/**
 * Whether the derived set can be drawn from this source.
 *
 * Only an asset our CDN serves has a renderer behind it; a hotlinked or raw
 * storage URL is linked as it is, exactly as before. A known non-image or an
 * ICO (which `sharp` cannot decode) passes through too. Unknown facts derive
 * anyway: the renderer redirects to the original for anything it cannot draw,
 * so a failed read costs a hop, never a broken icon.
 */
export function siteIconDerivable(
  src: string | undefined | null,
  facts?: SiteIconSourceFacts | null,
): boolean {
  if (!src || !isMediaCdnUrl(src)) return false
  const type = facts?.contentType
  return !type || siteIconSourceTypeDerivable(type)
}

/**
 * Whether the renderer can draw from an upload of this MIME type: any image
 * `sharp` decodes, SVG included (it is rasterized at each size).
 */
export function siteIconSourceTypeDerivable(type: unknown): boolean {
  return (
    typeof type === 'string' &&
    type.startsWith('image/') &&
    !UNDERIVABLE_TYPES.has(type)
  )
}

/** Whether the source is an SVG, which also passes through as `sizes="any"`. */
export function siteIconIsSvg(
  src: string | undefined | null,
  facts?: SiteIconSourceFacts | null,
): boolean {
  if (!src) return false
  if (facts?.contentType) return facts.contentType === 'image/svg+xml'
  if (isMediaCdnUrl(src)) return false
  return /\.svg$/i.test(src.split(/[?#]/)[0] ?? '')
}

/**
 * The URL of one derived icon of `src`, or `undefined` when `src` is not a
 * CDN URL and so has no renderer behind it.
 *
 * The parameters merge into a query `src` already carries — a signed private
 * asset's `exp`/`sig` — and their order is fixed, so one icon has one URL and
 * one cache entry.
 */
export function siteIconSrc(
  src: string | undefined | null,
  spec: SiteIconSpec,
  options: { background?: string | null; version?: string | null } = {},
): string | undefined {
  if (!src || !isMediaCdnUrl(src)) return undefined
  const params: Array<[string, string]> = [
    [SITE_ICON_PARAM, formatSiteIconSpec(spec)],
  ]
  if (siteIconUsesBackground(spec)) {
    params.push([
      SITE_ICON_BACKGROUND_PARAM,
      normalizeSiteIconBackground(options.background) ??
        DEFAULT_SITE_ICON_BACKGROUND,
    ])
  }
  if (options.version && MEDIA_CDN_SEGMENT.test(options.version)) {
    params.push([SITE_ICON_VERSION_PARAM, options.version])
  }
  const query = params.map(([key, value]) => `${key}=${value}`).join('&')
  return `${src}${src.includes('?') ? '&' : '?'}${query}`
}

/** One `<link>` the layout emits. */
export interface SiteIconLink {
  rel: 'icon' | 'apple-touch-icon'
  href: string
  type?: string
  sizes?: string
}

const square = (size: number) => `${size}x${size}`

/**
 * The `<link rel="icon">` set for a favicon source.
 *
 * Derivable: a PNG per {@link FAVICON_PNG_SIZES}, each with its real `type`
 * and `sizes`, then the SVG itself as `sizes="any"` when the source is one —
 * last, so a browser that draws SVG favicons prefers it and one that does not
 * already has its PNG. Anything else is the single link it always was.
 */
export function siteFaviconLinks(
  src: string | undefined | null,
  facts?: SiteIconSourceFacts | null,
): SiteIconLink[] {
  if (!src) return []
  const svg = siteIconIsSvg(src, facts)
  const passThrough: SiteIconLink = {
    rel: 'icon',
    href: src,
    ...(svg ? { type: 'image/svg+xml', sizes: 'any' } : {}),
  }
  if (!siteIconDerivable(src, facts)) return [passThrough]
  const version = facts?.contentHash
  return [
    ...FAVICON_PNG_SIZES.map((size) => ({
      rel: 'icon' as const,
      href: siteIconSrc(src, { plate: 'transparent', size }, { version }) ?? src,
      type: 'image/png',
      sizes: square(size),
    })),
    ...(svg ? [passThrough] : []),
  ]
}

/**
 * The `<link rel="apple-touch-icon">` set: each of
 * {@link APPLE_TOUCH_ICON_SIZES}, flattened onto `background`, or the single
 * pass-through link for a source with no renderer behind it.
 */
export function siteAppleTouchIconLinks(
  src: string | undefined | null,
  facts?: SiteIconSourceFacts | null,
  background?: string | null,
): SiteIconLink[] {
  if (!src) return []
  if (!siteIconDerivable(src, facts)) {
    return [{ rel: 'apple-touch-icon', href: src }]
  }
  const version = facts?.contentHash
  return APPLE_TOUCH_ICON_SIZES.map((size) => ({
    rel: 'apple-touch-icon' as const,
    href:
      siteIconSrc(src, { plate: 'flat', size }, { background, version }) ?? src,
    sizes: square(size),
  }))
}

/** One entry of the manifest's `icons`. */
export interface SiteManifestIcon {
  src: string
  sizes: string
  type?: string
  purpose: 'any' | 'maskable'
}

/**
 * The manifest's whole `icons` array for one source, which the caller has
 * already made ABSOLUTE (an installer fetches icons with no page to resolve
 * against).
 *
 * Derivable: every {@link MANIFEST_ICON_SIZES} size as `purpose: "any"`, then
 * {@link MANIFEST_MASKABLE_ICON_SIZES} as `purpose: "maskable"` on
 * `background`, then the SVG as `sizes: "any"` when the source is one. Each
 * `sizes` is a measurement, because the renderer draws exactly that square.
 * Anything else is the single `sizes: "any"` entry it always was: nothing
 * measured it, so nothing may claim a pixel size for it (AGL-2204).
 */
export function siteManifestIcons(
  src: string | undefined | null,
  facts?: SiteIconSourceFacts | null,
  background?: string | null,
): SiteManifestIcon[] {
  if (!src) return []
  const svg = siteIconIsSvg(src, facts)
  const passThrough: SiteManifestIcon = {
    src,
    sizes: 'any',
    ...(svg ? { type: 'image/svg+xml' } : {}),
    purpose: 'any',
  }
  if (!siteIconDerivable(src, facts)) return [passThrough]
  const version = facts?.contentHash
  const entry = (
    plate: 'transparent' | 'maskable',
    size: number,
  ): SiteManifestIcon => ({
    src: siteIconSrc(src, { plate, size }, { background, version }) ?? src,
    sizes: square(size),
    type: 'image/png',
    purpose: plate === 'maskable' ? 'maskable' : 'any',
  })
  return [
    ...MANIFEST_ICON_SIZES.map((size) => entry('transparent', size)),
    ...MANIFEST_MASKABLE_ICON_SIZES.map((size) => entry('maskable', size)),
    ...(svg ? [passThrough] : []),
  ]
}
