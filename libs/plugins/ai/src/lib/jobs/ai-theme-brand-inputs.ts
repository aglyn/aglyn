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

import { parseMediaCdnScope, type MediaCdnScope } from '@aglyn/aglyn/app-utils/media-cdn-scope'
import { isMediaCdnPath, MEDIA_CDN_ROUTE, parseMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import type {
  AglynOrgBilling,
  OrgBrandingProfile,
} from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { normalizeThemeHex } from '../tools/ai-theme-tool'

/**
 * The brand a theme job builds on (AGL-2938): the colors that belong to the
 * site before anyone describes them.
 *
 * - **The workspace's brand color** — a white-label workspace's, and only
 *   theirs: without the entitlement the resolved profile is the platform's,
 *   which is no customer's brand.
 * - **The site logo** — when the logo is an asset of the site's own media
 *   library or its org's, read from storage and reduced to its dominant
 *   colors. Never fetched from a URL: a logo that is not a library asset is
 *   left alone.
 * - **A page the brief links to** — fetched through the same SSRF guard the
 *   plugin fetch proxy uses (a public address, pinned; https only; every
 *   redirect re-validated), capped in bytes and time, and reduced to the
 *   colors its markup and stylesheets use.
 *
 * Only hex colors leave this module. Nothing a page or a logo SAYS reaches a
 * prompt, so there is nothing in them to follow. Each source is best effort:
 * one that cannot be read is named in a note and the proposal is made
 * without it.
 */

export type AiThemeBrandSource = 'organization' | 'logo' | 'reference'

/** How the prompt names where each brand color came from. */
export const AI_THEME_BRAND_SOURCE_WORDS: Record<AiThemeBrandSource, string> = {
  organization: 'the workspace brand color',
  logo: 'from the site logo',
  reference: 'from the page the brief links to',
}

export interface AiThemeBrandColor {
  hex: string
  source: AiThemeBrandSource
}

export interface AiThemeBrandInputs {
  colors: AiThemeBrandColor[]
  /** A source that could not be read, in customer-safe words. */
  notes: string[]
}

/** The most colors one source contributes. */
export const AI_THEME_BRAND_COLORS_PER_SOURCE = 4

/** The largest logo decoded for its colors. */
export const AI_THEME_LOGO_MAX_BYTES = 5 * 1024 * 1024

/** The most of a linked page, and of each of its stylesheets, that is read. */
export const AI_THEME_REFERENCE_MAX_BYTES = 512 * 1024
export const AI_THEME_STYLESHEET_MAX_BYTES = 256 * 1024

/** The stylesheets of a linked page that are read beside it. */
export const AI_THEME_REFERENCE_STYLESHEETS = 2

/**
 * The wall clock brand colors may take. The step runs inside the route's
 * inline budget, and a proposal without a page's colors is better than no
 * proposal before the budget ends.
 */
export const AI_THEME_BRAND_BUDGET_MS = 8_000

const FETCH_TIMEOUT_MS = 4_000
const MAX_REDIRECT_HOPS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

type Rgb = [red: number, green: number, blue: number]

const toHex = ([red, green, blue]: Rgb) =>
  `#${[red, green, blue]
    .map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0'))
    .join('')}`

const channelsOf = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** How far a color is from grey: the spread of its channels. */
const chroma = ([red, green, blue]: Rgb) => Math.max(red, green, blue) - Math.min(red, green, blue)

/** Colors closer than this read as the same color in a palette. */
const SAME_COLOR_DISTANCE = 40

/** A spread under this reads as a grey, which says little about a brand. */
const GREY_CHROMA = 38

/** The distinct colors of a ranked list, colorful ones first when there are any. */
function distinctColors(ranked: readonly Rgb[], count: number): string[] {
  const colorful = ranked.filter((color) => chroma(color) > GREY_CHROMA)
  const chosen: Rgb[] = []
  for (const color of colorful.length ? colorful : ranked) {
    if (chosen.some((other) => distance(other, color) < SAME_COLOR_DISTANCE)) continue
    chosen.push(color)
    if (chosen.length === count) break
  }
  return chosen.map(toHex)
}

/* ------------------------------------------------------------------------ *
 * The workspace's brand color
 * ------------------------------------------------------------------------ */

/** A white-label workspace's own brand color; nothing for any other workspace. */
export function organizationBrandColors(
  org: Partial<AglynOrgBilling> | null | undefined,
): AiThemeBrandColor[] {
  if (!checkEntitlement(org, 'whiteLabel')) return []
  const raw = (org?.brandingProfile as OrgBrandingProfile | undefined)?.primaryColor
  const hex = typeof raw === 'string' ? normalizeThemeHex(raw) : null
  return hex ? [{ hex, source: 'organization' }] : []
}

/* ------------------------------------------------------------------------ *
 * The site logo
 * ------------------------------------------------------------------------ */

export interface AiThemeLogoLocation {
  scope: MediaCdnScope
  /** The CDN scope segment, which is also a quarantine key. */
  scopeSegment: string
  mediaId: string
}

/**
 * Where a site's logo lives in a media library: a media reference or a CDN
 * path naming this site's library, or its org's. Anything else — an external
 * URL, an asset of some other site or org — has no location, and the logo is
 * left alone.
 */
export function logoMediaLocation(
  logoUrl: unknown,
  hostId: string,
  orgId: string,
): AiThemeLogoLocation | null {
  let scopeSegment: string
  let mediaId: string
  const ref = parseMediaRef(logoUrl)
  if (ref) {
    scopeSegment = ref.scope
    mediaId = ref.mediaId
  } else if (isMediaCdnPath(logoUrl)) {
    const rest = logoUrl.slice(`${MEDIA_CDN_ROUTE}/`.length)
    const slash = rest.indexOf('/')
    scopeSegment = rest.slice(0, slash)
    mediaId = rest.slice(slash + 1)
  } else {
    return null
  }
  const scope = parseMediaCdnScope(scopeSegment)
  if (!scope) return null
  const owned = scope.isOrg ? scope.scopeId === orgId : scope.scopeId === hostId
  return owned ? { scope, scopeSegment, mediaId } : null
}

/**
 * The dominant colors of an image's pixels: transparent pixels skipped, the
 * rest grouped into coarse buckets, the busiest distinct buckets first, and
 * the near-white and near-black edges a logo sits on dropped while anything
 * else is there.
 */
export function dominantColorsFromPixels(
  data: ArrayLike<number>,
  channels: number,
  count = AI_THEME_BRAND_COLORS_PER_SOURCE,
): string[] {
  const buckets = new Map<number, { sum: Rgb; pixels: number }>()
  for (let index = 0; index + channels <= data.length; index += channels) {
    if (channels >= 4 && data[index + 3] < 128) continue
    const pixel: Rgb = [data[index], data[index + 1], data[index + 2]]
    const key = ((pixel[0] >> 4) << 8) | ((pixel[1] >> 4) << 4) | (pixel[2] >> 4)
    const bucket = buckets.get(key) ?? { sum: [0, 0, 0] as Rgb, pixels: 0 }
    bucket.sum = [bucket.sum[0] + pixel[0], bucket.sum[1] + pixel[1], bucket.sum[2] + pixel[2]]
    bucket.pixels += 1
    buckets.set(key, bucket)
  }
  const ranked = [...buckets.values()]
    .sort((a, b) => b.pixels - a.pixels)
    .map(({ sum, pixels }): Rgb => [sum[0] / pixels, sum[1] / pixels, sum[2] / pixels])
  const edge = (color: Rgb) => Math.min(...color) > 235 || Math.max(...color) < 20
  const inside = ranked.filter((color) => !edge(color))
  return distinctColors(inside.length ? inside : ranked, count)
}

/** The part of `sharp` the logo read uses. */
interface SharpPixelPipeline {
  resize(width: number, height: number, options: { fit: 'inside' }): SharpPixelPipeline
  ensureAlpha(): SharpPixelPipeline
  raw(): SharpPixelPipeline
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Buffer
    info: { channels: number }
  }>
}
type SharpPixels = (input: Buffer, options?: { limitInputPixels?: number }) => SharpPixelPipeline

const LOGO_TYPES = /^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/

/**
 * A library logo's colors, read the way the media CDN would serve it: the
 * document live and not private, an org asset visible to this site, the
 * scope not locked and the asset not quarantined, the object path inside the
 * scope's own media prefix. `null` when any of that does not hold or the
 * bytes cannot be decoded.
 */
async function readLogoColors(
  firestore: FirebaseFirestore.Firestore,
  location: AiThemeLogoLocation,
  hostId: string,
): Promise<string[] | null> {
  const { scope, mediaId } = location
  const snapshot = await firestore
    .collection(scope.isOrg ? 'orgs' : 'hosts')
    .doc(scope.scopeId)
    .collection('media')
    .doc(mediaId)
    .get()
  const media = (snapshot.exists ? snapshot.data() : null) as Record<string, unknown> | null
  if (!media || media['deletedAt'] || media['private']) return null
  if (scope.isOrg && !visibleToHost(media['visibleTo'] as string[] | undefined, hostId)) return null
  if (!LOGO_TYPES.test(String(media['contentType'] ?? ''))) return null
  if (typeof media['sizeBytes'] === 'number' && media['sizeBytes'] > AI_THEME_LOGO_MAX_BYTES) {
    return null
  }
  const [{ mediaCdnServeBlock }, { mediaStoragePathInScope }, { firebaseAdmin }, { loadSharp }] =
    await Promise.all([
      import('@aglyn/tenant-data-admin/server/serve-media-cdn'),
      import('@aglyn/tenant-data-admin/server/media-storage-path'),
      import('@aglyn/tenant-data-admin/server/firebase-admin'),
      import('@aglyn/tenant-data-admin/server/media-variants'),
    ])
  const blocked = await mediaCdnServeBlock(scope, {
    contentSha256: typeof media['contentSha256'] === 'string' ? media['contentSha256'] : undefined,
    contentHash: typeof media['contentHash'] === 'string' ? media['contentHash'] : undefined,
    scopeSegment: location.scopeSegment,
    mediaId,
  })
  if (blocked) return null
  const objectPath = mediaStoragePathInScope({
    storagePath: media['storagePath'],
    base: `${scope.isOrg ? 'orgs' : 'hosts'}/${scope.scopeId}`,
    mediaId,
  })
  const [buffer] = (await firebaseAdmin
    .app()
    .storage()
    .bucket(process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'] || undefined)
    .file(objectPath)
    .download()) as [Buffer]
  if (buffer.length > AI_THEME_LOGO_MAX_BYTES) return null
  const sharp = (await loadSharp()) as unknown as SharpPixels
  const { data, info } = await sharp(buffer, { limitInputPixels: 64_000_000 })
    .resize(48, 48, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return dominantColorsFromPixels(data, info.channels)
}

/* ------------------------------------------------------------------------ *
 * A page the brief links to
 * ------------------------------------------------------------------------ */

const URL_IN_BRIEF = /\bhttps?:\/\/[^\s<>"'`)\]]+/i

/** The first https link in a brief, or `null` — an http link is not followed. */
export function referenceUrlOf(brief: string): URL | null {
  const match = URL_IN_BRIEF.exec(brief)
  if (!match) return null
  try {
    const url = new URL(match[0].replace(/[.,;:!?]+$/, ''))
    return url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** How much a page's declared `theme-color` counts beside one use of a color. */
export const AI_THEME_THEME_COLOR_WEIGHT = 25

const THEME_COLOR_META = /<meta\b[^>]*\bname\s*=\s*["']?theme-color\b[^>]*>/gi
const CONTENT_ATTRIBUTE = /\bcontent\s*=\s*["']?\s*([^"'\s>]+)/i
// A `#` after `&` is a character reference (`&#039;`), not a color.
const HEX_LITERAL = /(?<!&)#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi
const RGB_LITERAL = /rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/gi

/** Every color a page's markup or a stylesheet uses, weighted by how often. */
export function colorsFromMarkup(text: string): Map<string, number> {
  const weights = new Map<string, number>()
  const add = (hex: string | null, weight: number) => {
    if (hex) weights.set(hex, (weights.get(hex) ?? 0) + weight)
  }
  for (const tag of text.match(THEME_COLOR_META) ?? []) {
    add(normalizeThemeHex(CONTENT_ATTRIBUTE.exec(tag)?.[1] ?? ''), AI_THEME_THEME_COLOR_WEIGHT)
  }
  for (const match of text.matchAll(HEX_LITERAL)) add(normalizeThemeHex(match[0]), 1)
  for (const match of text.matchAll(RGB_LITERAL)) {
    add(toHex([Number(match[1]), Number(match[2]), Number(match[3])]), 1)
  }
  return weights
}

const STYLESHEET_LINK = /<link\b[^>]*\brel\s*=\s*["']?stylesheet\b[^>]*>/gi
const HREF_ATTRIBUTE = /\bhref\s*=\s*["']?\s*([^"'\s>]+)/i

/** The https stylesheets a page links, resolved against it, at most a few. */
export function stylesheetUrlsOf(html: string, pageUrl: string): string[] {
  const urls: string[] = []
  for (const tag of html.match(STYLESHEET_LINK) ?? []) {
    const href = HREF_ATTRIBUTE.exec(tag)?.[1]
    if (!href) continue
    try {
      const url = new URL(href, pageUrl)
      if (url.protocol === 'https:' && !urls.includes(url.toString())) urls.push(url.toString())
    } catch {
      continue
    }
    if (urls.length === AI_THEME_REFERENCE_STYLESHEETS) break
  }
  return urls
}

/** The most used distinct colors, the colorful before the greys. */
export function rankBrandColors(
  weights: ReadonlyMap<string, number>,
  count = AI_THEME_BRAND_COLORS_PER_SOURCE,
): string[] {
  const ranked = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => channelsOf(hex))
  return distinctColors(ranked, count)
}

/** One abort for the caller's signal and a clock, whichever ends first. */
function deadline(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', onAbort)
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done || !value) break
    const room = maxBytes - total
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room))
      await reader.cancel().catch(() => undefined)
      break
    }
    chunks.push(value)
    total += value.byteLength
  }
  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

/**
 * A public https resource as text, through the plugin fetch proxy's SSRF
 * guard: the host must resolve only to public addresses and the socket is
 * pinned to the address checked; no credentials in the URL and no port but
 * the default; every redirect re-enters the same checks; the body is read to
 * a byte cap under a clock, and only a content type the caller accepts is
 * read at all. `null` for anything that does not hold.
 */
export async function fetchPublicText(
  url: string,
  options: { maxBytes: number; accept: RegExp; signal?: AbortSignal; timeoutMs?: number },
): Promise<{ text: string; url: string } | null> {
  const { createPinnedDispatcher, resolvePublicIp } = await import(
    '@aglyn/tenant-data-admin/server/serve-plugin-fetch'
  )
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    let parsed: URL
    try {
      parsed = new URL(current)
    } catch {
      return null
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    if (parsed.port && parsed.port !== '443') return null
    const pinned = await resolvePublicIp(parsed.hostname)
    if (!pinned) return null
    const dispatcher = createPinnedDispatcher(pinned)
    const clock = deadline(options.signal, options.timeoutMs ?? FETCH_TIMEOUT_MS)
    try {
      // `dispatcher` is undici's, which the global fetch honors; a variable
      // rather than a literal keeps the DOM `RequestInit` check off it.
      const init = {
        method: 'GET',
        redirect: 'manual' as const,
        signal: clock.signal,
        dispatcher,
        headers: { Accept: 'text/html, text/css;q=0.9' },
      }
      const response = await fetch(parsed.toString(), init as RequestInit)
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location')
        if (!location) return null
        current = new URL(location, parsed).toString()
        continue
      }
      if (!response.ok || !response.body) return null
      if (!options.accept.test(response.headers.get('content-type') ?? '')) return null
      return { text: await readCapped(response.body, options.maxBytes), url: parsed.toString() }
    } catch {
      return null
    } finally {
      clock.done()
      await dispatcher.close().catch(() => undefined)
    }
  }
  return null
}

/** A linked page's colors, from its markup and its first stylesheets. */
async function readReferenceColors(url: URL, signal: AbortSignal): Promise<string[] | null> {
  const page = await fetchPublicText(url.toString(), {
    maxBytes: AI_THEME_REFERENCE_MAX_BYTES,
    accept: /text\/html|application\/xhtml\+xml/i,
    signal,
  })
  if (!page) return null
  const weights = colorsFromMarkup(page.text)
  for (const sheet of stylesheetUrlsOf(page.text, page.url)) {
    const css = await fetchPublicText(sheet, {
      maxBytes: AI_THEME_STYLESHEET_MAX_BYTES,
      accept: /text\/css/i,
      signal,
    })
    if (!css) continue
    for (const [hex, weight] of colorsFromMarkup(css.text)) {
      weights.set(hex, (weights.get(hex) ?? 0) + weight)
    }
  }
  return rankBrandColors(weights)
}

/* ------------------------------------------------------------------------ *
 * Gathering
 * ------------------------------------------------------------------------ */

/** The two reads that leave the process, replaceable where a spec needs to. */
export interface AiThemeBrandSeams {
  logoColors?: (
    firestore: FirebaseFirestore.Firestore,
    location: AiThemeLogoLocation,
    hostId: string,
  ) => Promise<string[] | null>
  referenceColors?: (url: URL, signal: AbortSignal) => Promise<string[] | null>
}

export async function gatherAiThemeBrandInputs(
  input: {
    firestore: FirebaseFirestore.Firestore
    org: Partial<AglynOrgBilling> | null
    hostId: string
    /** The site's host document. */
    host: Record<string, unknown>
    brief: string
    signal?: AbortSignal
  },
  seams: AiThemeBrandSeams = {},
): Promise<AiThemeBrandInputs> {
  const colors: AiThemeBrandColor[] = [...organizationBrandColors(input.org)]
  const notes: string[] = []
  const clock = deadline(input.signal, AI_THEME_BRAND_BUDGET_MS)
  const add = (found: readonly string[], source: AiThemeBrandSource) => {
    for (const hex of found.slice(0, AI_THEME_BRAND_COLORS_PER_SOURCE)) {
      if (!colors.some((color) => color.hex === hex)) colors.push({ hex, source })
    }
  }
  try {
    const location = logoMediaLocation(
      input.host['logoUrl'],
      input.hostId,
      String(input.host['orgId'] ?? ''),
    )
    if (location) {
      const found = await (seams.logoColors ?? readLogoColors)(
        input.firestore,
        location,
        input.hostId,
      ).catch(() => null)
      if (found) add(found, 'logo')
      else notes.push("The site logo's colors could not be read, so the proposal does not use them.")
    }
    const reference = referenceUrlOf(input.brief)
    if (reference) {
      const found = clock.signal.aborted
        ? null
        : await (seams.referenceColors ?? readReferenceColors)(reference, clock.signal).catch(
            () => null,
          )
      if (found?.length) add(found, 'reference')
      else {
        notes.push(
          `The page at ${reference.hostname} could not be read for its colors, so the proposal does not use them.`,
        )
      }
    }
  } finally {
    clock.done()
  }
  return { colors, notes }
}
