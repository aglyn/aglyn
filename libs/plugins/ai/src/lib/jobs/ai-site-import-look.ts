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

/*==========================================
 * THE SITE BROUGHT IN KEEPS ITS OWN LOOK (AGL-4084).
 *
 * The first wave's look pass, before the header and footer, with no model:
 *
 * - **The theme.** The owner's own home page is read once more as AglynBot
 *   (with the edge headers a site this platform serves gets), and the
 *   signals a guided start reads off the sites a person likes (AGL-3975:
 *   colors, ground, type mood, corners, buttons, cards, header, density,
 *   motion) pin the look: its strongest colorful color is the brand, its
 *   second the accent. The look is drawn and saved exactly as a guided
 *   start's (`aiSiteStyleFor`, `aiSaveSiteTheme`): a built-in base plus the
 *   brand colors and a pairing of the source's type mood, never its font.
 *   A site whose owner already chose a theme keeps it.
 * - **The logo.** The source header's logo, as the source draws it, into the
 *   site's media library once: an SVG is turned into a PNG 192 pixels tall
 *   (the library takes pictures, not drawings), a picture is kept as it is.
 * - **The listing.** The home page's own title, description and share
 *   picture become the site's listing, only while the site still has the
 *   listing it was created with: an owner's own words are never written
 *   over.
 *
 * Nothing here fails a wave: a source whose look cannot be read keeps the
 * site's theme, and a logo that cannot be brought in leaves the header its
 * name.
 *=========================================*/

import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import { aiSiteListingSeeded } from '../model/ai-site-entity'
import type { AiSiteImportHome, AiSiteImportLook, AiSiteImportPhoto } from '../model/ai-site-import'
import { aiSiteKindFor } from '../model/ai-site-kinds'
import { aiSiteSeed, aiSiteStyleFor, type AiSiteStyle } from '../model/ai-site-look'
import { aiSiteIsStarterSrc } from '../model/ai-site-photos'
import { AGLYN_BOT_USER_AGENT, type SiteImportCrawlSeams } from '../site-import/site-import-crawl'
import { bringInSiteImportPhotos, siteImportImageKey, siteImportLogoUrl } from '../site-import/site-import-images'
import { aiSaveSiteTheme, aiWorkspaceSiteStyles } from './ai-job-site-look'
import { aiSiteInspirationLookPins } from './ai-site-inspiration'
import { aiSiteInspirationSignals, type AiSiteInspirationSite } from './ai-site-inspiration-signals'
import {
  AI_THEME_BRAND_COLORS_PER_SOURCE,
  AI_THEME_REFERENCE_MAX_BYTES,
  AI_THEME_REFERENCE_STYLESHEETS,
  AI_THEME_STYLESHEET_MAX_BYTES,
  AI_THEME_THEME_COLOR_WEIGHT,
  fetchPublicTextDetailed,
  rankBrandColors,
  stylesheetUrlsOf,
  type AiReferencePage,
  type PublicFetchOptions,
  type PublicFetchResult,
} from './ai-theme-brand-inputs'

/** The height an SVG logo is drawn at as a picture: crisp at twice the header's 40. */
export const AI_SITE_IMPORT_LOGO_HEIGHT = 192

/** The largest logo file read. */
export const AI_SITE_IMPORT_LOGO_MAX_BYTES = 1024 * 1024

/** One read's own clock in the look pass. */
const LOOK_READ_MS = 8_000

type Fetch = (url: string, options: PublicFetchOptions) => Promise<PublicFetchResult>

const sameHost = (a: string, b: string) => {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

/**
 * The home page and its first stylesheets, read as AglynBot (AGL-4084), the
 * edge headers going with the page and with a stylesheet only on the page's
 * own host. `null` when the page cannot be read.
 */
export async function readSiteImportLookPage(
  url: string,
  input: { fetch?: Fetch; headers?: Readonly<Record<string, string>> | null; signal?: AbortSignal },
): Promise<AiReferencePage | null> {
  const fetchText = input.fetch ?? fetchPublicTextDetailed
  const headers = input.headers && Object.keys(input.headers).length ? input.headers : null
  const read = (address: string, maxBytes: number, accept: RegExp, own: boolean) =>
    fetchText(address, {
      maxBytes,
      accept,
      userAgent: AGLYN_BOT_USER_AGENT,
      timeoutMs: LOOK_READ_MS,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(headers && own ? { headers } : {}),
    }).catch(() => null)
  const page = await read(url, AI_THEME_REFERENCE_MAX_BYTES, /text\/html|application\/xhtml\+xml/i, true)
  if (!page?.ok) return null
  const stylesheets: string[] = []
  for (const sheet of stylesheetUrlsOf(page.text, page.url).slice(0, AI_THEME_REFERENCE_STYLESHEETS)) {
    const css = await read(sheet, AI_THEME_STYLESHEET_MAX_BYTES, /text\/css/i, sameHost(sheet, page.url))
    if (css?.ok) stylesheets.push(css.text)
  }
  return { url: page.url, html: page.text, stylesheets }
}

const SOLID_HEX = /(?<!&)#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi
const SOLID_RGB = /rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/gi
const THEME_COLOR = /<meta\b[^>]*\bname\s*=\s*["']?theme-color\b[^>]*\bcontent\s*=\s*["']?\s*(#[0-9a-f]{3,6})/gi

const hexOf = (value: string): string | null => {
  const raw = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw
  if (/^#[0-9a-f]{3}$/.test(raw)) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
  return null
}

/**
 * A source's brand colors as it DRAWS them (AGL-4084): the colors its markup
 * and stylesheets use solid, most used first, the colorful before the greys.
 * A translucent color is a tint of one (a hover, a focus ring), never a use
 * of it, so it is not counted: aglyn.com's focus rings, a light blue at a
 * quarter strength, outnumbered the deep blue its buttons and links are
 * drawn in, which the theme reader would otherwise take as its brand.
 */
export function aiSiteImportBrandColors(page: Pick<AiReferencePage, 'html' | 'stylesheets'>): string[] {
  const weights = new Map<string, number>()
  const add = (hex: string | null, weight = 1) => {
    if (hex) weights.set(hex, (weights.get(hex) ?? 0) + weight)
  }
  for (const match of page.html.matchAll(THEME_COLOR)) add(hexOf(match[1] ?? ''), AI_THEME_THEME_COLOR_WEIGHT)
  for (const text of [page.html, ...page.stylesheets]) {
    for (const match of text.matchAll(SOLID_HEX)) add(hexOf(match[0]))
    for (const match of text.matchAll(SOLID_RGB)) {
      const alpha = match[4]
      if (alpha !== undefined && (alpha.endsWith('%') ? Number(alpha.slice(0, -1)) < 100 : Number(alpha) < 1)) continue
      const channels = [match[1], match[2], match[3]].map((value) => Math.min(255, Number(value)))
      add(`#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`)
    }
  }
  return rankBrandColors(weights, AI_THEME_BRAND_COLORS_PER_SOURCE)
}

/**
 * The look a source's signals pin (AGL-4084), drawn the way a guided start's
 * is: the kind of site its own description says, the import's seed, its
 * strongest color as the brand. `null` where the source showed no color to
 * carry a brand, so the site keeps the theme it has.
 */
export function aiSiteImportStyle(
  site: AiSiteInspirationSite | null,
  input: { seed: number; description: string; avoid?: readonly AiSiteStyle[] },
): AiSiteStyle | null {
  if (!site) return null
  const kind = aiSiteKindFor(input.description)
  const pins = aiSiteInspirationLookPins({ v: 1, sites: [site], unread: 0 }, { kind, seed: input.seed })
  if (!pins.brand) return null
  return aiSiteStyleFor({ kind, answer: {}, seed: input.seed, brand: pins.brand, avoid: input.avoid ?? [], pins })
}

/**
 * The site's listing in the home page's own words (AGL-4084), as field
 * paths: its title and description each only where the site still has the
 * one it was created with, so an owner's own listing is never written over.
 * `{}` with nothing to write.
 */
export function aiSiteImportListingUpdates(seo: unknown, displayName: unknown, home: Pick<AiSiteImportHome, 'title' | 'description'>): Record<string, string> {
  const seeded = aiSiteListingSeeded(seo, displayName)
  const current = (seo && typeof seo === 'object' ? seo : {}) as Record<string, unknown>
  const updates: Record<string, string> = {}
  const title = home.title.replace(/\s+/g, ' ').trim()
  const description = home.description.replace(/\s+/g, ' ').trim()
  if (title && seeded.title && title !== current['title']) updates['seo.title'] = title
  if (description && seeded.description && description !== current['description']) updates['seo.description'] = description
  return updates
}

/** Whether the site's share picture is still open: none, or the starter's (AGL-3988). */
function shareOpen(seo: unknown): boolean {
  const image = (seo as { image?: unknown } | null | undefined)?.image
  if (image === undefined || image === null) return true
  return typeof image === 'string' && (!image.trim() || aiSiteIsStarterSrc(image))
}

/** Turns an SVG drawing into a PNG of a height; `null` where it cannot. */
export type AiSiteImportRasterize = (svg: Uint8Array, height: number) => Promise<Uint8Array | null>

export interface AiSiteImportLookDeps {
  fetch?: Fetch
  headersFor?: SiteImportCrawlSeams['headersFor']
  save?: typeof aiSaveSiteTheme
  others?: typeof aiWorkspaceSiteStyles
  ingest?: PluginMediaIngest | null
  rasterize?: AiSiteImportRasterize
  /** The site's document, as the listing reads it. */
  readHost?: (firestore: FirebaseFirestore.Firestore, hostId: string) => Promise<Record<string, unknown> | null>
  writeHost?: (firestore: FirebaseFirestore.Firestore, hostId: string, updates: Record<string, unknown>) => Promise<void>
}

export interface AiSiteImportLookInput {
  firestore: FirebaseFirestore.Firestore
  hostId: string
  orgId: string
  /** The member the logo and the share picture are stored as. */
  uid: string
  /** The import job's id, which the look's seed is drawn from. */
  jobId: string
  domain: string
  home: AiSiteImportHome
  at: string
  signal?: AbortSignal
}

async function readHostDoc(firestore: FirebaseFirestore.Firestore, hostId: string): Promise<Record<string, unknown> | null> {
  const snapshot = await firestore.collection('hosts').doc(hostId).get()
  return snapshot.exists ? ((snapshot.data() ?? {}) as Record<string, unknown>) : null
}

async function writeHostDoc(firestore: FirebaseFirestore.Firestore, hostId: string, updates: Record<string, unknown>): Promise<void> {
  await firestore.collection('hosts').doc(hostId).update(updates)
}

/** Turns an SVG into a PNG in this process, where `sharp` is shipped; `null` where it is not. */
async function rasterizeHere(svg: Uint8Array, height: number): Promise<Uint8Array | null> {
  const images = await import('./ai-image-reads')
  const origin = images.aiImageReadsOrigin()
  if (origin) return images.requestAiLogoRaster(origin, svg, height)
  return images.rasterizeAiLogoSvg(svg, height)
}

/**
 * The source header's logo in the site's library (AGL-4084), once: the copy
 * a page already brought in is reused by its key. An SVG becomes a PNG.
 * `null` where it cannot be brought in, and the header then prints the name.
 */
export async function aiSiteImportLogo(
  input: { hostId: string; uid: string; domain: string; logo: NonNullable<AiSiteImportHome['brand']['logo']>; alt: string; headers?: Readonly<Record<string, string>> | null; signal?: AbortSignal },
  deps: { fetch?: Fetch; ingest: PluginMediaIngest | null; rasterize?: AiSiteImportRasterize },
): Promise<AiSiteImportPhoto | null> {
  const ingest = deps.ingest
  const url = siteImportLogoUrl(input.logo.url)
  if (!ingest?.findImportedPhoto || !url) return null
  const sourceKey = siteImportImageKey(url)
  try {
    const held = await ingest.findImportedPhoto({ hostId: input.hostId, sourceKey })
    if (held) return { mediaId: held.mediaId, src: held.src, alt: input.alt, from: url, ...(held.width ? { width: held.width } : {}), ...(held.height ? { height: held.height } : {}) }
    const fetched = await (deps.fetch ?? fetchPublicTextDetailed)(url, {
      maxBytes: AI_SITE_IMPORT_LOGO_MAX_BYTES,
      accept: /^image\//i,
      acceptHeader: 'image/svg+xml,image/png,image/webp,image/jpeg;q=0.9',
      userAgent: AGLYN_BOT_USER_AGENT,
      timeoutMs: LOOK_READ_MS,
      refuseOver: true,
      binary: true,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.headers && sameHost(url, `https://${input.domain}/`) ? { headers: input.headers } : {}),
    })
    if (!fetched.ok || !fetched.data?.byteLength) return null
    const type = fetched.contentType.split(';')[0].trim().toLowerCase()
    let bytes: Uint8Array | null = fetched.data
    let contentType = type
    if (type === 'image/svg+xml' || input.logo.type === 'svg') {
      bytes = await (deps.rasterize ?? rasterizeHere)(fetched.data, AI_SITE_IMPORT_LOGO_HEIGHT).catch(() => null)
      contentType = 'image/png'
    } else if (!/^image\/(?:png|jpeg|webp|gif)$/.test(type)) {
      return null
    }
    if (!bytes?.byteLength) return null
    const stored = await ingest.ingest({
      hostId: input.hostId,
      uid: input.uid,
      fileName: `logo.${contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]}`,
      contentType,
      bytes,
      ...(input.alt ? { alt: input.alt.slice(0, 250) } : {}),
      importedFrom: { key: sourceKey, url, domain: input.domain },
    })
    if (!stored.ok) return null
    return { mediaId: stored.mediaId, src: stored.src, alt: input.alt, from: url, ...(stored.width ? { width: stored.width } : {}), ...(stored.height ? { height: stored.height } : {}) }
  } catch (error) {
    console.warn('[site-import] the logo could not be brought in', { hostId: input.hostId, error })
    return null
  }
}

/** The look pass (AGL-4084): the theme, the logo and the listing, from the owner's own home page. No model. */
export async function aiRunSiteImportLook(input: AiSiteImportLookInput, deps: AiSiteImportLookDeps = {}): Promise<AiSiteImportLook> {
  const { firestore, hostId, home } = input
  let headers: Readonly<Record<string, string>> | null = null
  if (deps.headersFor) {
    try {
      headers = await deps.headersFor(input.domain)
    } catch (error) {
      console.warn('[site-import] the edge headers could not be read; reading the look without them', { domain: input.domain, error })
    }
  }
  const seed = aiSiteSeed(input.jobId)
  const page = await readSiteImportLookPage(home.url, { ...(deps.fetch ? { fetch: deps.fetch } : {}), headers, ...(input.signal ? { signal: input.signal } : {}) })
  // The source's own signals, its brand colors as it draws them solid.
  const signals = page ? aiSiteInspirationSignals(page) : null
  const site = signals && page ? { ...signals, colors: aiSiteImportBrandColors(page) } : signals
  const avoid = await (deps.others ?? aiWorkspaceSiteStyles)(firestore, { orgId: input.orgId, hostId })
  const style = aiSiteImportStyle(site, { seed, description: `${home.siteName} ${home.description}`, avoid })
  let theme: AiSiteImportLook['theme'] = 'unread'
  if (style) {
    const saved = await (deps.save ?? aiSaveSiteTheme)(firestore, { hostId, jobId: input.jobId, style })
    if (saved.write === 'missing') throw new Error(`site ${hostId} vanished while its look was brought in`)
    theme = saved.write === 'kept' ? 'kept' : 'applied'
  }
  const ingest = deps.ingest ?? null
  const logo = home.brand.logo
    ? await aiSiteImportLogo(
        { hostId, uid: input.uid, domain: input.domain, logo: home.brand.logo, alt: home.siteName || home.brand.text, headers, ...(input.signal ? { signal: input.signal } : {}) },
        { ingest, ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.rasterize ? { rasterize: deps.rasterize } : {}) },
      )
    : null
  // The site's listing in its own words, only over the one it was created with.
  let seo = false
  const host = await (deps.readHost ?? readHostDoc)(firestore, hostId)
  if (host) {
    const updates: Record<string, unknown> = aiSiteImportListingUpdates(host['seo'], host['displayName'], home)
    if (home.ogImage && shareOpen(host['seo'])) {
      const share = await bringInSiteImportPhotos(
        { hostId, uid: input.uid, domain: input.domain, images: [{ url: home.ogImage, alt: '' }], deadlineAt: Date.now() + LOOK_READ_MS, ...(input.signal ? { signal: input.signal } : {}) },
        { ingest, ...(deps.fetch ? { fetch: deps.fetch } : {}) },
      )
      const photo = share.assets[0]
      if (photo) {
        updates['seo.image'] = photo.src
        if (photo.width) updates['seo.imageWidth'] = photo.width
        if (photo.height) updates['seo.imageHeight'] = photo.height
      }
    }
    if (Object.keys(updates).length) {
      await (deps.writeHost ?? writeHostDoc)(firestore, hostId, updates)
      seo = true
    }
  }
  const drawn = style
    ? {
        ...(typeof style.headerAlign === 'string' ? { headerAlign: style.headerAlign } : {}),
        ...(typeof style.rhythm === 'string' ? { rhythm: style.rhythm } : {}),
        ...(typeof style.motion === 'string' ? { motion: style.motion } : {}),
      }
    : null
  return { at: input.at, theme, colors: site?.colors ?? [], logo, seo, seed: style ? style.seed : seed, style: drawn }
}
