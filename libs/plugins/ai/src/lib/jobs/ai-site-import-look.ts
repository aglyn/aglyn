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
 * - **The theme.** The owner's own home page is read once more as AglynBot,
 *   with the edge headers a site this platform serves gets whether or not a
 *   caller hands them in (AGL-4108: production handed none, our own edge
 *   challenged the read, and the 10/29 site kept the starter's indigo), and
 *   the signals a guided start reads off the sites a person likes
 *   (AGL-3975: colors, ground, type mood, corners, buttons, cards, header,
 *   density, motion) pin the look. What the reader found of the source's
 *   look (AGL-4106) pins it closer (AGL-4108): its buttons' fill is the
 *   brand and its links' color the accent, its page's ground is the site's,
 *   its eyebrows' own color the theme's third and its eyebrows spaced
 *   capitals with no line before them (AGL-4138), and its own font family
 *   is the site's wherever the theme font catalog has it, else a pairing of
 *   its type mood. The look is drawn and saved
 *   exactly as a guided start's (`aiSiteStyleFor`, `aiSaveSiteTheme`): a
 *   built-in base plus the brand colors and fonts, every color held to the
 *   theme's reading checks. A site whose owner already chose a theme keeps
 *   it.
 * - **The logo.** The source header's logo, as the source draws it, into the
 *   site's media library once: an SVG is turned into a PNG 192 pixels tall
 *   (the library takes pictures, not drawings), a picture is kept as it is.
 * - **The listing.** The home page's own title, description and share
 *   picture become the site's listing, only while the site still has the
 *   listing it was created with: an owner's own words are never written
 *   over.
 *
 * A bare read never leaves the stock theme (AGL-4152). A source with no color
 * of its own to read (no colorful button, link or declared palette) takes its brand from its logo's dominant colorful hue, then its hero photo's,
 * read from the library's copy. With no picture to read either, what its
 * stylesheets use most decides, and with none of that the site still gets the
 * seed's own look for its kind of site, as a guided start with no answer does,
 * and the look says so (`from`). An owner's chosen theme is still kept.
 *
 * Nothing here fails a wave: a logo that cannot be brought in leaves the header
 * its name.
 *=========================================*/

import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import { themeFontFacts, type ThemeFontFacts } from '@aglyn/aglyn/plugin-manager/plugin-theme-font-catalog'
import { syncHostProjectionForMembers } from '@aglyn/tenant-data-admin/server/host-memberships'
import { aiSiteListingSeeded } from '../model/ai-site-entity'
import type { AiSiteImportFinish, AiSiteImportHome, AiSiteImportLook, AiSiteImportLookFrom, AiSiteImportPhoto, SiteImportLookFacts } from '../model/ai-site-import'
import { aiSiteKindFor } from '../model/ai-site-kinds'
import { aiHexOklch, aiSiteSeed, aiSiteStyleFor, type AiSiteLookPins, type AiSiteSourceFont, type AiSiteStyle } from '../model/ai-site-look'
import { aiSiteIsStarterSrc } from '../model/ai-site-photos'
import { AGLYN_BOT_USER_AGENT, siteImportOrigins, type SiteImportCrawlSeams } from '../site-import/site-import-crawl'
import { siteImportReadStylesheets } from '../site-import/site-import-css'
import { NO_SITE_IMPORT_HEADERS, siteImportEdgeHeadersFor, type SiteImportHeadersFor } from '../site-import/site-import-edge'
import { siteImportStylesheetLinks } from '../site-import/site-import-html'
import { bringInSiteImportPhotos, siteImportImageKey, siteImportLogoUrl } from '../site-import/site-import-images'
import { aiSaveSiteTheme, aiWorkspaceSiteStyles } from './ai-job-site-look'
import { aiSiteInspirationLookPins } from './ai-site-inspiration'
import { aiSiteInspirationSignals, type AiSiteInspirationSite } from './ai-site-inspiration-signals'
import {
  AI_THEME_BRAND_COLORS_PER_SOURCE,
  AI_THEME_REFERENCE_MAX_BYTES,
  AI_THEME_THEME_COLOR_WEIGHT,
  fetchPublicTextDetailed,
  logoMediaLocation,
  rankBrandColors,
  readLogoColors,
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

/** The clock on starting the home page's stylesheets' reads: however many it links, a pass waits no longer than this and one read's own. */
const LOOK_SHEETS_MS = 12_000

type Fetch = (url: string, options: PublicFetchOptions) => Promise<PublicFetchResult>

/**
 * The home page and its stylesheets, every one to the crawl's byte budget
 * (AGL-4152), read as AglynBot (AGL-4084).
 * `headersFor` is asked for every request and every redirect hop, as the
 * crawl asks it (`aiSiteImportLookHeaders`: the edge header only to the
 * site's own origins). `null` when the page cannot be read.
 */
export async function readSiteImportLookPage(
  url: string,
  input: { fetch?: Fetch; headersFor?: SiteImportHeadersFor | null; signal?: AbortSignal },
): Promise<AiReferencePage | null> {
  const fetchText = input.fetch ?? fetchPublicTextDetailed
  const headersFor = input.headersFor ?? null
  const read = (address: string, maxBytes: number, accept: RegExp) =>
    fetchText(address, {
      maxBytes,
      accept,
      userAgent: AGLYN_BOT_USER_AGENT,
      timeoutMs: LOOK_READ_MS,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(headersFor ? { headersFor } : {}),
    }).catch(() => null)
  const page = await read(url, AI_THEME_REFERENCE_MAX_BYTES, /text\/html|application\/xhtml\+xml/i)
  if (!page?.ok) return null
  const startedAt = Date.now()
  const stylesheets = await siteImportReadStylesheets(siteImportStylesheetLinks(page.text, page.url), (sheet, maxBytes) => read(sheet, maxBytes, /text\/css|text\/plain/i), {
    outOfTime: () => Date.now() - startedAt >= LOOK_SHEETS_MS,
  })
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

/** How colorful a color must be to carry a brand: the inspiration reader's own floor. */
const COLORFUL_CHROMA = 0.04

const colorful = (hex: string | null | undefined): hex is string => !!hex && /^#[0-9a-f]{6}$/i.test(hex) && aiHexOklch(hex).C >= COLORFUL_CHROMA

/**
 * The brand and accent a source's look facts give (AGL-4108): the fill of
 * its filled buttons as the brand, the color of its links as the accent
 * where it is a color of its own, and the reverse where its buttons are not
 * colorful. The theme draws the brand at the nearest shade of it that reads
 * (`aiSiteColors`): aglyn.com's light blue buttons, under white words at
 * 2.4:1, come out at the deeper blue of its own links.
 */
export function aiSiteImportBrandOf(facts: (Pick<SiteImportLookFacts, 'buttonFill' | 'link'> & Pick<Partial<SiteImportLookFacts>, 'palette'>) | null | undefined): { brand: string; accent: string | null } | null {
  const fill = colorful(facts?.buttonFill) ? (facts?.buttonFill as string).toLowerCase() : null
  const link = colorful(facts?.link) ? (facts?.link as string).toLowerCase() : null
  // What its root declares its brand to be (AGL-4152), where nothing on its home page draws it.
  const palette = (facts?.palette ?? []).filter(colorful).map((hex) => hex.toLowerCase())
  const brand = fill ?? link ?? palette[0]
  if (!brand) return null
  return { brand, accent: (link && link !== brand ? link : palette.find((hex) => hex !== brand)) ?? null }
}

const solidHex = (value: string | null | undefined): string | null => (value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null)

/**
 * The look a source's signals pin (AGL-4084), drawn the way a guided start's
 * is: the kind of site its own description says, the import's seed, its
 * strongest color as the brand. What the reader found of its look
 * (`facts`, AGL-4108) pins it closer: its buttons' fill as the brand and its
 * links' color as the accent, its eyebrows' own color as the third, and its
 * own fonts where the catalog has them (`fonts`). Its pictures' colors
 * (`pictures`, AGL-4152) stand in for a brand where its facts show none. `null`
 * where nothing showed a color to carry a brand, unless asked to draw the look
 * from the seed alone (`draw`), which the pass does rather than leave the site
 * in the stock theme.
 *
 * How the owner asked the site to be finished (AGL-4152) says what else:
 * - **Keep my site** (`keep`, and an import that names none) pins the rest
 *   of its look as it draws it: its page's ground and its dark bands', its
 *   buttons' corners and case and their own fill and words, every inspiration
 *   signal, and its eyebrows set as spaced capitals.
 * - **Improve it** (`improve`) pins only the brand, accent and third colors
 *   and the fonts, so the base that suits the kind of site shows with its own
 *   corners, buttons, grounds and eyebrows.
 */
export function aiSiteImportStyle(
  site: AiSiteInspirationSite | null,
  input: {
    seed: number
    description: string
    avoid?: readonly AiSiteStyle[]
    facts?: SiteImportLookFacts | null
    fonts?: AiSiteStyle['sourceFonts']
    finish?: AiSiteImportFinish | null
    pictures?: readonly string[]
    draw?: boolean
  },
): AiSiteStyle | null {
  const facts = input.facts ?? null
  const finish: AiSiteImportFinish = input.finish === 'improve' ? 'improve' : 'keep'
  const pictured = input.pictures?.[0] ? { brand: input.pictures[0].toLowerCase(), accent: input.pictures[1]?.toLowerCase() ?? null } : null
  const own = aiSiteImportBrandOf(facts) ?? pictured
  if (!site && !own && !input.draw) return null
  const kind = aiSiteKindFor(input.description)
  const signals = site ? aiSiteInspirationLookPins({ v: 1, sites: [site], unread: 0 }, { kind, seed: input.seed }) : {}
  // Improve keeps the brand's colors and its type, and nothing else its source draws.
  const pins: AiSiteLookPins =
    finish === 'improve'
      ? {
          ...(signals.brand ? { brand: signals.brand } : {}),
          ...(signals.hue !== undefined ? { hue: signals.hue } : {}),
          ...(signals.accent !== undefined ? { accent: signals.accent } : {}),
          ...(signals.fonts ? { fonts: signals.fonts } : {}),
        }
      : signals
  if (own) {
    pins.brand = own.brand
    pins.hue = Math.round(aiHexOklch(own.brand).h) % 360
    if (own.accent) pins.accent = Math.round(aiHexOklch(own.accent).h) % 360
  }
  // Its buttons' corners round the theme's shape where its stylesheets did not say (AGL-4108).
  const radius = facts?.buttonRadius
  if (finish === 'keep' && typeof radius === 'number' && Number.isFinite(radius) && radius >= 0) {
    pins.buttons ??= radius >= 24 ? 'pill' : radius <= 2 ? 'square' : 'rounded'
    pins.corners ??= radius <= 2 ? 'sharp' : radius <= 10 ? 'soft' : radius <= 20 ? 'round' : 'pill'
  }
  // Its eyebrows as it sets them (AGL-4138): spaced capitals with no line before them — the
  // reader takes an eyebrow only in capitals, and no mark a page draws before one is a word of
  // it — and their own color, where it is one, as the theme's third.
  if (facts && finish === 'keep') pins.eyebrow = 'caps'
  if (colorful(facts?.eyebrow)) pins.tertiary = (facts?.eyebrow as string).toLowerCase()
  if (!pins.brand && !input.draw) return null
  const style = aiSiteStyleFor({ kind, answer: {}, seed: input.seed, brand: pins.brand, avoid: input.avoid ?? [], pins })
  const fonts = input.fonts ? { sourceFonts: input.fonts } : {}
  if (finish === 'improve') return { ...style, finish, ...fonts }
  // Keep my site (AGL-4152): its grounds, its buttons' case, and its filled buttons as it draws them.
  const page = solidHex(facts?.background)
  const darkPage = solidHex(facts?.darkBackground)
  const buttonFill = solidHex(facts?.buttonFill)
  const buttonText = buttonFill ? solidHex(facts?.buttonText) : null
  const caseOf = (value: string | null | undefined) => (value === 'upper' || value === 'none' ? value : null)
  const buttonCase = caseOf(facts?.buttonCase)
  const outlinedCase = caseOf(facts?.outlinedCase)
  const textCase = caseOf(facts?.textCase)
  const paper = solidHex(facts?.paperBackground)
  const darkPaper = solidHex(facts?.darkPaper)
  const outlinedFill = solidHex(facts?.outlinedFill)
  const buttonOutline = solidHex(facts?.buttonOutline)
  return {
    ...style,
    finish,
    ...(page ? { page } : {}),
    ...(darkPage ? { darkPage } : {}),
    ...(paper ? { paper } : {}),
    ...(darkPaper ? { darkPaper } : {}),
    ...(buttonCase ? { buttonCase } : {}),
    ...(outlinedCase ? { outlinedCase } : {}),
    ...(textCase ? { textCase } : {}),
    ...(outlinedFill ? { outlinedFill } : {}),
    ...(buttonOutline ? { buttonOutline } : {}),
    ...(buttonFill ? { buttonFill } : {}),
    ...(buttonText ? { buttonText } : {}),
    ...fonts,
  }
}

/** A family's facts, as the theme font catalog answers them. */
export type AiSiteImportFontFacts = (family: string) => Promise<ThemeFontFacts | undefined>

/**
 * The source's own fonts (AGL-4108), each where the theme font catalog has
 * the family (Google Fonts', as the fonts plugin registers it), or the
 * source loads it from Google Fonts itself: its body's and its headings'.
 * `null` where its body's family is neither, and the pairing of the source's
 * type mood sets the site instead.
 */
export async function aiSiteImportSourceFonts(
  facts: Pick<SiteImportLookFacts, 'fonts'> | null | undefined,
  lookup: AiSiteImportFontFacts = themeFontFacts,
): Promise<AiSiteStyle['sourceFonts']> {
  const fonts = facts?.fonts
  if (!fonts?.body) return null
  const loaded = new Set(fonts.google.map((family) => family.toLowerCase()))
  const resolve = async (family: string | null): Promise<AiSiteSourceFont | null> => {
    if (!family) return null
    const known = await lookup(family).catch(() => undefined)
    if (known) return { family: known.family, category: known.category, weights: [...known.weights] }
    return loaded.has(family.toLowerCase()) ? { family, category: 'sans-serif', weights: [] } : null
  }
  const body = await resolve(fonts.body)
  if (!body) return null
  const heading = fonts.headings && fonts.headings.toLowerCase() !== body.family.toLowerCase() ? await resolve(fonts.headings) : null
  return { body, heading }
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
  /** The edge headers for the source, asked with its domain; absent, the edge is asked as the crawl asks it (AGL-4108). */
  headersFor?: SiteImportCrawlSeams['headersFor']
  /** The edge's own answer, per address (`siteImportEdgeHeadersFor`), where no `headersFor` is given. */
  edgeHeadersFor?: typeof siteImportEdgeHeadersFor
  /** A family's facts in the theme font catalog (`themeFontFacts`). */
  fontFacts?: AiSiteImportFontFacts
  save?: typeof aiSaveSiteTheme
  others?: typeof aiWorkspaceSiteStyles
  ingest?: PluginMediaIngest | null
  rasterize?: AiSiteImportRasterize
  /** The site's document, as the listing reads it. */
  readHost?: (firestore: FirebaseFirestore.Firestore, hostId: string) => Promise<Record<string, unknown> | null>
  writeHost?: (firestore: FirebaseFirestore.Firestore, hostId: string, updates: Record<string, unknown>) => Promise<void>
  /** Re-fans the rows every site list reads a site's icon from (AGL-3972), after the look sets one. */
  syncMemberships?: (orgId: string, hostId: string) => Promise<void>
  /** A picture in the library's dominant colors (AGL-4152); `null` where it cannot be read. */
  pictureColors?: AiSiteImportPictureColors
}

/** A picture in the site's library's dominant colors (`dominantColorsFromPixels`). */
export type AiSiteImportPictureColors = (photo: AiSiteImportPhoto, input: { firestore: FirebaseFirestore.Firestore; hostId: string; orgId: string; signal?: AbortSignal }) => Promise<readonly string[] | null>

/** The library's copy of a picture, decoded where `sharp` is shipped (`readLogoColors`, AGL-4048). */
const pictureColorsOf: AiSiteImportPictureColors = async (photo, { firestore, hostId, orgId, signal }) => {
  const location = logoMediaLocation(photo.src, hostId, orgId)
  if (!location) return null
  return readLogoColors(firestore, location, hostId, AbortSignal.any([AbortSignal.timeout(LOOK_READ_MS), ...(signal ? [signal] : [])]))
}

/** A read of a picture's colorful colors: none where it has none, or cannot be read. */
async function colorfulColorsOf(photo: AiSiteImportPhoto, read: AiSiteImportPictureColors, input: Parameters<AiSiteImportPictureColors>[1]): Promise<string[]> {
  const colors = await read(photo, input).catch((error: unknown) => {
    console.warn('[site-import] a picture’s colors could not be read', { hostId: input.hostId, error })
    return null
  })
  return (colors ?? []).filter(colorful).map((hex) => hex.toLowerCase())
}

/** The most pictures the home page's menus bring into the library (AGL-4139). */
export const AI_SITE_IMPORT_MENU_PICTURES = 4

/** The pictures the home page's menus show (AGL-4139), each once, the first few: a featured card's. */
export function aiSiteImportMenuPictures(home: Pick<AiSiteImportHome, 'nav'>): Array<{ url: string; alt: string }> {
  const seen = new Set<string>()
  const out: Array<{ url: string; alt: string }> = []
  for (const group of home.nav?.items ?? []) {
    for (const column of group.columns ?? []) {
      if (!column.image || seen.has(column.image.url) || out.length >= AI_SITE_IMPORT_MENU_PICTURES) continue
      seen.add(column.image.url)
      out.push({ url: column.image.url, alt: column.image.alt })
    }
  }
  return out
}

/** Whether the site still has no icon of its own (AGL-4139): an owner's is never written over. */
function faviconOpen(seo: unknown): boolean {
  const favicon = (seo as { favicon?: unknown } | null | undefined)?.favicon
  return favicon === undefined || favicon === null || (typeof favicon === 'string' && !favicon.trim())
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
  /** How the site is finished (AGL-4152): Keep my site keeps more of the source's look. Absent is `keep`. */
  finish?: AiSiteImportFinish | null
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
  input: { hostId: string; uid: string; domain: string; logo: NonNullable<AiSiteImportHome['brand']['logo']>; alt: string; headersFor?: SiteImportHeadersFor | null; signal?: AbortSignal },
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
      ...(input.headersFor ? { headersFor: input.headersFor } : {}),
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
  const headersFor = await aiSiteImportLookHeaders(input.domain, deps)
  const seed = aiSiteSeed(input.jobId)
  const page = await readSiteImportLookPage(home.url, { ...(deps.fetch ? { fetch: deps.fetch } : {}), headersFor, ...(input.signal ? { signal: input.signal } : {}) })
  // The source's own signals, its brand colors as it draws them solid.
  const signals = page ? aiSiteInspirationSignals(page) : null
  const site = signals && page ? { ...signals, colors: aiSiteImportBrandColors(page) } : signals
  const avoid = await (deps.others ?? aiWorkspaceSiteStyles)(firestore, { orgId: input.orgId, hostId })
  // What the reader found of its look, its buttons, ground and fonts (AGL-4108).
  const facts = home.look ?? null
  const fonts = await aiSiteImportSourceFonts(facts, deps.fontFacts)
  const ingest = deps.ingest ?? null
  const logo = home.brand.logo
    ? await aiSiteImportLogo(
        { hostId, uid: input.uid, domain: input.domain, logo: home.brand.logo, alt: home.siteName || home.brand.text, headersFor, ...(input.signal ? { signal: input.signal } : {}) },
        { ingest, ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.rasterize ? { rasterize: deps.rasterize } : {}) },
      )
    : null
  // No color of its own (AGL-4152): its logo's colorful colors, else its hero photo's, else its share picture's.
  let pictures: string[] = []
  let from: AiSiteImportLookFrom = 'source'
  if (!aiSiteImportBrandOf(facts)) {
    const read = deps.pictureColors ?? pictureColorsOf
    const asked = { firestore, hostId, orgId: input.orgId, ...(input.signal ? { signal: input.signal } : {}) }
    const ofLogo = logo ? await colorfulColorsOf(logo, read, asked) : []
    if (ofLogo.length) {
      pictures = ofLogo.slice(0, 2)
      from = 'logo'
    } else {
      for (const image of [home.hero, home.ogImage ? { url: home.ogImage, alt: '' } : null]) {
        if (!image) continue
        const { assets } = await bringInSiteImportPhotos(
          { hostId, uid: input.uid, domain: input.domain, images: [image], deadlineAt: Date.now() + LOOK_READ_MS, ...(input.signal ? { signal: input.signal } : {}) },
          { ingest, ...(deps.fetch ? { fetch: deps.fetch } : {}) },
        )
        const ofPhoto = assets[0] ? await colorfulColorsOf(assets[0], read, asked) : []
        if (!ofPhoto.length) continue
        pictures = ofPhoto.slice(0, 1)
        from = 'photo'
        break
      }
    }
  }
  const described = { seed, description: `${home.siteName} ${home.description}`, avoid, facts, fonts, finish: input.finish ?? null, pictures }
  let style = aiSiteImportStyle(site, described)
  // Nothing anywhere to read a color from: the seed's look for its kind, never the stock theme.
  if (!style) {
    style = aiSiteImportStyle(site, { ...described, draw: true }) as AiSiteStyle
    from = 'seed'
  }
  const saved = await (deps.save ?? aiSaveSiteTheme)(firestore, { hostId, jobId: input.jobId, style })
  if (saved.write === 'missing') throw new Error(`site ${hostId} vanished while its look was brought in`)
  const theme: AiSiteImportLook['theme'] = saved.write === 'kept' ? 'kept' : 'applied'
  // The pictures its menus show, in the library like its pages' photos (AGL-4139), for the header's panels.
  const menuImages = aiSiteImportMenuPictures(home)
  const menuPictures = menuImages.length
    ? (
        await bringInSiteImportPhotos(
          { hostId, uid: input.uid, domain: input.domain, images: menuImages, deadlineAt: Date.now() + LOOK_READ_MS, ...(input.signal ? { signal: input.signal } : {}) },
          { ingest, ...(deps.fetch ? { fetch: deps.fetch } : {}) },
        )
      ).assets
    : []
  // The site's listing in its own words, only over the one it was created with.
  let seo = false
  const host = await (deps.readHost ?? readHostDoc)(firestore, hostId)
  if (host) {
    const updates: Record<string, unknown> = aiSiteImportListingUpdates(host['seo'], host['displayName'], home)
    // The site's icon from the one its head names, where the site has none (AGL-4139).
    if (home.favicon && faviconOpen(host['seo'])) {
      const icon = await bringInSiteImportPhotos(
        { hostId, uid: input.uid, domain: input.domain, images: [{ url: home.favicon, alt: '' }], deadlineAt: Date.now() + LOOK_READ_MS, ...(input.signal ? { signal: input.signal } : {}) },
        { ingest, ...(deps.fetch ? { fetch: deps.fetch } : {}) },
      )
      const photo = icon.assets[0]
      if (photo) updates['seo.favicon'] = photo.src
    }
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
      // Every site list reads the icon the members' rows carry (AGL-3972).
      if (updates['seo.favicon']) {
        await (deps.syncMemberships ?? syncHostProjectionForMembers)(input.orgId, hostId).catch((error: unknown) => {
          console.warn('[site-import] the site lists were not told of the new icon', { hostId, error })
        })
      }
    }
  }
  const drawn = {
    ...(typeof style.headerAlign === 'string' ? { headerAlign: style.headerAlign } : {}),
    ...(typeof style.rhythm === 'string' ? { rhythm: style.rhythm } : {}),
    ...(typeof style.motion === 'string' ? { motion: style.motion } : {}),
  }
  const colors = [...new Set([...(facts ? [facts.buttonFill, facts.link, facts.eyebrow, ...(facts.palette ?? [])].filter(colorful).map((hex) => hex.toLowerCase()) : []), ...pictures, ...(site?.colors ?? [])])]
  return { at: input.at, theme, from, colors, logo, ...(menuPictures.length ? { pictures: menuPictures } : {}), seo, seed: style.seed, style: drawn }
}

/**
 * The headers the look's reads of the source go with, per address (AGL-4108),
 * exactly as the crawl's (`siteRequestHeaders`): the caller's where it hands
 * them in, else the edge's own, so a site this platform serves is read past
 * its challenge however the step was registered; and nothing for any address
 * off the site's two origins, a redirect hop's included. Never throws.
 *
 * The 10/29 look read went without the header twice over: no caller handed
 * one in, and the read passed headers the fetch does not take, which is why
 * this is a function the fetch asks for every hop (`headersFor`).
 */
export async function aiSiteImportLookHeaders(
  domain: string,
  deps: Pick<AiSiteImportLookDeps, 'headersFor' | 'edgeHeadersFor'>,
): Promise<SiteImportHeadersFor> {
  const origins = siteImportOrigins(domain)
  let inner: SiteImportHeadersFor = NO_SITE_IMPORT_HEADERS
  try {
    if (deps.headersFor) {
      const headers = await deps.headersFor(domain)
      if (headers && Object.keys(headers).length) inner = () => headers
    } else {
      inner = await (deps.edgeHeadersFor ?? siteImportEdgeHeadersFor)(origins)
    }
  } catch (error) {
    console.warn('[site-import] the edge headers could not be read; reading the look without them', { domain, error })
  }
  return (url: URL) => (origins.includes(url.origin) ? inner(url) : {})
}
