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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type {
  AglynOrgBilling,
  OrgBrandingProfile,
} from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { normalizeThemeHex } from '../tools/ai-theme-tool'
import { AI_THEME_BRAND_BUDGET_MS } from './ai-job-theme-budget'
import {
  aiMediaAssetLocation,
  loadAiMediaSharp,
  readAiMediaAssetBytes,
  type AiMediaAssetLocation,
} from './ai-media-asset'

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
 * The wall clock brand colors may take, declared with the theme step's time
 * (`ai-job-theme-budget.ts`), which counts it (AGL-3035).
 */
export { AI_THEME_BRAND_BUDGET_MS }

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

export type AiThemeLogoLocation = AiMediaAssetLocation

/**
 * Where a site's logo lives in a media library: a media reference or a CDN
 * path naming this site's library, or its org's. Anything else — an external
 * URL, an asset of some other site or org — has no location, and the logo is
 * left alone. The media library's own rule, shared with every job that reads
 * an asset (`ai-media-asset.ts`).
 */
export const logoMediaLocation = aiMediaAssetLocation

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
 * A library logo's colors, read the way the media CDN would serve it
 * (`readAiMediaAssetBytes`). `null` when the asset may not be read or the bytes
 * cannot be decoded.
 *
 * On Vercel the read and the decode run in the plugins' image function, the
 * one function that ships `sharp`'s native library (`ai-image-reads.ts`,
 * AGL-4048), inside the brand reads' own bound (`signal`); anywhere else they
 * run here. Either way an answer that does not come is a logo whose colors
 * could not be read.
 */
async function readLogoColors(
  firestore: FirebaseFirestore.Firestore,
  location: AiThemeLogoLocation,
  hostId: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  const images = await import('./ai-image-reads')
  const origin = images.aiImageReadsOrigin()
  if (!origin) return readAiThemeLogoColorsAt(firestore, location, hostId)
  // The location was held to the site's org already: an org asset's scope
  // IS that org, and a site's own asset needs none.
  const orgId = location.scope.isOrg ? location.scope.scopeId : ''
  const payload = images.aiImageReadsRequest('logo-colors', location, hostId, orgId)
  if (!payload) return null
  const answer = await images.requestAiImageReads<{ colors?: unknown }>(
    origin,
    payload,
    signal ?? AbortSignal.timeout(AI_THEME_BRAND_BUDGET_MS),
  )
  return logoColorsAnswer(answer?.colors)
}

/**
 * A library logo's colors read and decoded in THIS process, from a location
 * already held to the media library's rule: what `readLogoColors` does off
 * Vercel, and what the images function does for it on Vercel.
 */
export async function readAiThemeLogoColorsAt(
  firestore: FirebaseFirestore.Firestore,
  location: AiThemeLogoLocation,
  hostId: string,
): Promise<string[] | null> {
  const asset = await readAiMediaAssetBytes(firestore, location, hostId, {
    maxBytes: AI_THEME_LOGO_MAX_BYTES,
    types: LOGO_TYPES,
  })
  if (!asset) return null
  const sharp = (await loadAiMediaSharp()) as SharpPixels
  const { data, info } = await sharp(asset.buffer, { limitInputPixels: 64_000_000 })
    .resize(48, 48, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return dominantColorsFromPixels(data, info.channels)
}

/** What the images function answered, as hex colors: only colors leave it. */
function logoColorsAnswer(colors: unknown): string[] | null {
  if (!Array.isArray(colors)) return null
  return colors
    .map((color) => (typeof color === 'string' ? normalizeThemeHex(color) : null))
    .filter((hex): hex is string => Boolean(hex))
    .slice(0, AI_THEME_BRAND_COLORS_PER_SOURCE)
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

/**
 * The body as text, to `maxBytes`. Past the cap it is cut there, or with
 * `refuseOver` it is not read at all: `null`, the read canceled.
 */
async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  refuseOver = false,
  binary = false,
): Promise<{ text: string; bytes: number; truncated: boolean; data?: Uint8Array } | null> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done || !value) break
    const room = maxBytes - total
    if (value.byteLength > room) {
      await reader.cancel().catch(() => undefined)
      if (refuseOver) return null
      chunks.push(value.subarray(0, room))
      total += room
      truncated = true
      break
    }
    chunks.push(value)
    total += value.byteLength
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  // A picture's bytes are kept as they came (AGL-3976), never decoded as text.
  if (binary) return { text: '', bytes: total, truncated, data: joined }
  return { text: new TextDecoder().decode(joined), bytes: total, truncated }
}

/** Why {@link fetchPublicTextDetailed} read nothing. */
export type PublicFetchRefusal =
  /** Not https, a port, credentials, or not a URL at all. */
  | 'refused-url'
  /** The name resolves to a private address, or not at all. */
  | 'private-address'
  /** A redirect the caller's `redirectAllowed` refused. */
  | 'redirect-refused'
  | 'too-many-redirects'
  /** An answer that was not 2xx; `status` says which. */
  | 'http-status'
  /** A 2xx whose content type the caller does not accept. */
  | 'content-type'
  /** Past `maxBytes` with `refuseOver` set. */
  | 'too-large'
  /** The socket, the clock or the caller's signal ended it. */
  | 'network'

/**
 * One shape for both outcomes, read by `ok`: a union does not narrow across
 * this repo's library boundaries (`strictNullChecks` is off), so a caller
 * could not reach either arm's fields.
 */
export interface PublicFetchResult {
  ok: boolean
  /** The address read, after redirects; or the one that was refused. */
  url: string
  /** Empty unless `ok`. */
  text: string
  bytes: number
  /** Cut at `maxBytes` (never with `refuseOver`). */
  truncated: boolean
  contentType: string
  /** Null when `ok`. */
  refusal: PublicFetchRefusal | null
  status?: number
  /** Where a refused redirect pointed. */
  location?: string
  /** The body's bytes, with `binary`; absent otherwise. */
  data?: Uint8Array
}

function refusedFetch(
  refusal: PublicFetchRefusal,
  url: string,
  extra: { status?: number; location?: string } = {},
): PublicFetchResult {
  return { ok: false, url, text: '', bytes: 0, truncated: false, contentType: '', refusal, ...extra }
}

export interface PublicFetchOptions {
  maxBytes: number
  accept: RegExp
  signal?: AbortSignal
  timeoutMs?: number
  /** Sent as `User-Agent`; the runtime's own when absent. */
  userAgent?: string
  /** Sent as `Accept`. */
  acceptHeader?: string
  /**
   * Extra headers for one hop, asked again for EVERY hop's own address
   * (AGL-4085): a header meant for one host never rides a redirect to
   * another. `Accept` and `User-Agent` above always win over these.
   */
  headersFor?: (url: URL) => Readonly<Record<string, string>> | undefined
  /** Asked of every redirect hop before it is followed; the SSRF checks run as well. */
  redirectAllowed?: (from: URL, to: URL) => boolean
  /** Refuse a body over `maxBytes` rather than cut it. */
  refuseOver?: boolean
  /** Keep the body's bytes as `data` rather than decode them as text (a picture, AGL-3976). */
  binary?: boolean
}

/**
 * A public https resource as text, through the plugin fetch proxy's SSRF
 * guard: the host must resolve only to public addresses and the socket is
 * pinned to the address checked; no credentials in the URL and no port but
 * the default; every redirect re-enters the same checks and the caller's own
 * `redirectAllowed`; the body is read to a byte cap under a clock, and only a
 * content type the caller accepts is read at all. Says why when it reads
 * nothing.
 */
export async function fetchPublicTextDetailed(
  url: string,
  options: PublicFetchOptions,
): Promise<PublicFetchResult> {
  const { createPinnedDispatcher, resolvePublicIp } = await import('./ai-theme-brand-server')
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    let parsed: URL
    try {
      parsed = new URL(current)
    } catch {
      return refusedFetch('refused-url', current)
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return refusedFetch('refused-url', current)
    }
    if (parsed.port && parsed.port !== '443') {
      return refusedFetch('refused-url', current)
    }
    const pinned = await resolvePublicIp(parsed.hostname)
    if (!pinned) return refusedFetch('private-address', parsed.toString())
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
        headers: {
          ...(options.headersFor?.(parsed) ?? {}),
          Accept: options.acceptHeader ?? 'text/html, text/css;q=0.9',
          ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}),
        },
      }
      const response = await fetch(parsed.toString(), init as RequestInit)
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => undefined)
        const location = response.headers.get('location')
        if (!location) {
          return refusedFetch('http-status', parsed.toString(), { status: response.status })
        }
        let next: URL
        try {
          next = new URL(location, parsed)
        } catch {
          return refusedFetch('redirect-refused', parsed.toString(), { location })
        }
        if (options.redirectAllowed && !options.redirectAllowed(parsed, next)) {
          return refusedFetch('redirect-refused', parsed.toString(), { location: next.toString() })
        }
        current = next.toString()
        continue
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined)
        return refusedFetch('http-status', parsed.toString(), { status: response.status })
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (!options.accept.test(contentType)) {
        await response.body.cancel().catch(() => undefined)
        return refusedFetch('content-type', parsed.toString(), { status: response.status })
      }
      const declared = Number(response.headers.get('content-length') ?? '')
      if (options.refuseOver && Number.isFinite(declared) && declared > options.maxBytes) {
        await response.body.cancel().catch(() => undefined)
        return refusedFetch('too-large', parsed.toString(), { status: response.status })
      }
      const body = await readCapped(response.body, options.maxBytes, options.refuseOver, options.binary === true)
      if (!body) {
        return refusedFetch('too-large', parsed.toString(), { status: response.status })
      }
      return { ok: true, url: parsed.toString(), contentType, refusal: null, ...body }
    } catch {
      return refusedFetch('network', parsed.toString())
    } finally {
      clock.done()
      await dispatcher.close().catch(() => undefined)
    }
  }
  return refusedFetch('too-many-redirects', current)
}

/** {@link fetchPublicTextDetailed}, answering `null` for anything it refused. */
export async function fetchPublicText(
  url: string,
  options: { maxBytes: number; accept: RegExp; signal?: AbortSignal; timeoutMs?: number },
): Promise<{ text: string; url: string } | null> {
  const result = await fetchPublicTextDetailed(url, options)
  return result.ok ? { text: result.text, url: result.url } : null
}

/**
 * A public page as it was read: its markup and the text of its first
 * stylesheets ({@link AI_THEME_REFERENCE_STYLESHEETS}), each under its byte
 * cap. What a theme job takes its colors from and a site start its
 * inspiration signals (AGL-3975); never a crawl, one page and its sheets.
 */
export interface AiReferencePage {
  /** The address the markup was finally read at, after redirects. */
  url: string
  html: string
  stylesheets: string[]
}

/** A page and its first stylesheets through {@link fetchPublicText}; `null` when the page cannot be read. */
export async function readReferencePage(url: URL, signal: AbortSignal): Promise<AiReferencePage | null> {
  const page = await fetchPublicText(url.toString(), {
    maxBytes: AI_THEME_REFERENCE_MAX_BYTES,
    accept: /text\/html|application\/xhtml\+xml/i,
    signal,
  })
  if (!page) return null
  const stylesheets: string[] = []
  for (const sheet of stylesheetUrlsOf(page.text, page.url)) {
    const css = await fetchPublicText(sheet, {
      maxBytes: AI_THEME_STYLESHEET_MAX_BYTES,
      accept: /text\/css/i,
      signal,
    })
    if (css) stylesheets.push(css.text)
  }
  return { url: page.url, html: page.text, stylesheets }
}

/** A read page's brand colors: every color its markup and stylesheets use, ranked. */
export function referencePageColors(page: Pick<AiReferencePage, 'html' | 'stylesheets'>): string[] {
  const weights = colorsFromMarkup(page.html)
  for (const css of page.stylesheets) {
    for (const [hex, weight] of colorsFromMarkup(css)) {
      weights.set(hex, (weights.get(hex) ?? 0) + weight)
    }
  }
  return rankBrandColors(weights)
}

/** A linked page's colors, from its markup and its first stylesheets. */
async function readReferenceColors(url: URL, signal: AbortSignal): Promise<string[] | null> {
  const page = await readReferencePage(url, signal)
  return page ? referencePageColors(page) : null
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
    /** The brand reads' bound, which a read made elsewhere waits no longer than. */
    signal?: AbortSignal,
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
        clock.signal,
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
