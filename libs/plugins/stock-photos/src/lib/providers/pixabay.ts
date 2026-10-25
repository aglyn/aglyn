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

import { sniffPhotoContentType } from '@aglyn/aglyn/app-utils/upload-inspection'
import {
  STOCK_PHOTO_QUERY_MAX_CHARS,
  type StockPhoto,
  type StockPhotoDownload,
  type StockPhotoSearchRequest,
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'

/**
 * PIXABAY (AGL-3660): the first stock photo library, through its API
 * (https://pixabay.com/api/docs/). This module is the wire: the search
 * request, the answer's shape, the rate limit and the image fetch. The
 * cache its terms ask for sits around it (`server/search-cache.ts`).
 *
 * What the terms ask, and where each is kept:
 *
 * - **No permanent hotlinking.** A photo is DOWNLOADED, by
 *   {@link createPixabayClient}'s `download`, and the caller stores the bytes
 *   in the site's own media library. A page never names a Pixabay address.
 *   A search result shown to a member choosing a photo (the media picker's
 *   Stock photos tab, AGL-4066) is its small copy, fetched by the console's
 *   server and handed over as bytes, so no browser loads a Pixabay address
 *   either.
 * - **Cache requests for 24 hours.** `server/search-cache.ts`.
 * - **The rate limit** (100 requests a minute per key by default, reported
 *   in `X-RateLimit-*` headers). The client reads the headers on every answer
 *   and stops asking, keeping a margin, until the window resets; a 429 stops
 *   it for the window the answer names. A search it does not make answers
 *   `null`, and the caller uses its own fallback rather than retrying. The
 *   image hosts answer a burst of downloads with 429 too (AGL-3988), so the
 *   photos are fetched {@link PIXABAY_DOWNLOADS_AT_ONCE} at a time, and a 429
 *   pauses every download of the process for as long as it asks before the
 *   photo is asked for again.
 * - **Show where search results are from.** An AI job shows no search
 *   result: it places one photo. The media picker's Stock photos tab names
 *   the library over every result it shows, and each photo's details link
 *   its Pixabay page and the license. The asset records its credit either
 *   way (the photographer, the photo's Pixabay page and the license), which
 *   the media library shows in the asset's description.
 * - **Real human requests, no mass downloads.** A search runs only inside a
 *   site build a member started, or when a member searches the media
 *   picker; a page asks a handful at most, previews are fetched as a member
 *   scrolls to them and take turns with the downloads, and a photo is
 *   downloaded once per library.
 *
 * The key is read from the environment at each call and never leaves this
 * module: it rides the query string Pixabay requires, so a request URL is
 * never logged or thrown; errors name the status alone.
 */

export const PIXABAY_PROVIDER_ID = 'pixabay'
export const PIXABAY_LABEL = 'Pixabay'

/** The image search endpoint. */
export const PIXABAY_API_URL = 'https://pixabay.com/api/'

/**
 * The hosts a photo's bytes are fetched from: `largeImageURL` is served from
 * `pixabay.com/get/…`, previews from the CDN host. Nothing else is fetched,
 * however a redirect points.
 */
export const PIXABAY_IMAGE_HOSTS: ReadonlySet<string> = new Set([
  new URL('https://pixabay.com').hostname,
  new URL('https://cdn.pixabay.com').hostname,
])

export const PIXABAY_LICENSE = {
  name: 'Pixabay Content License',
  url: 'https://pixabay.com/service/license-summary/',
} as const

/** The longer edge of `largeImageURL`, the copy downloaded. */
export const PIXABAY_LARGE_EDGE = 1280

/**
 * Hits asked per search: enough to pick among, few enough to cache whole.
 * Pixabay's `q` matches any tag loosely (a robin tagged "food bowl" answers
 * "serving bowl"), and the caller now REJECTS every hit that does not show
 * the thing (AGL-3660), so it asks for twice what it used to keep the
 * accepted few in reach. Still one request.
 */
export const PIXABAY_PER_PAGE = 40

/** Requests kept in hand before the window resets, for other instances. */
export const PIXABAY_RATE_MARGIN = 5

/** The most this process asks in one minute when no header has said otherwise. */
export const PIXABAY_LOCAL_PER_MINUTE = 60

const SEARCH_TIMEOUT_MS = 8_000
const DOWNLOAD_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 3

/**
 * Photos fetched from Pixabay's image hosts at once, by every caller in this
 * process together (AGL-3988). The beta.270 Sugar Hollow Photography start
 * (2026-10-19) copied four at a time, and pixabay.com's Cloudflare answered
 * 429 to every one of them within 200 ms: a dataset's covers, then a home
 * page, then a contact page, each slot running through its three picks in
 * the same burst. Its terms also ask for no mass downloads.
 */
export const PIXABAY_DOWNLOADS_AT_ONCE = 2

/** Times a rate-limited download asks again before it gives up (AGL-3988). */
export const PIXABAY_DOWNLOAD_RETRIES = 3

/** The longest a rate-limited download waits before it asks again, whatever the answer said (AGL-3988). */
export const PIXABAY_DOWNLOAD_RETRY_MAX_MS = 8_000

/** The first wait after a 429 that names none; it doubles on each retry. */
const DOWNLOAD_RETRY_FIRST_MS = 1_000

/** A refusal that says "later": the rate limit, or a host too busy to answer. */
const RATE_LIMITED = new Set([429, 503])

/** How long a rate-limited answer asks to be left alone, in ms, from its `Retry-After`; `null` when it names none. */
export function pixabayRetryAfterMs(value: string | null, nowMs: number): number | null {
  const text = (value ?? '').trim()
  if (!text) return null
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000)
  const at = Date.parse(text)
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null
}

/** Waits `ms`, or less when `signal` aborts first; resolves either way. */
function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** A Pixabay hit, with the address its bytes are fetched from. */
export interface PixabayPhoto extends StockPhoto {
  downloadUrl: string
  /**
   * The small copy a search result shows (AGL-4066): `webformatURL` at its
   * 340-pixel-tall size, valid for the day the answer is cached. Absent on a
   * search cached before it was read; the large copy stands in then.
   */
  previewUrl?: string
}

/** The height of the copy a search result shows: one of `webformatURL`'s documented sizes. */
export const PIXABAY_PREVIEW_SIZE = 340

/**
 * `webformatURL` at the preview size: its documented `_640` swapped for
 * `_340`, or the address as it stands when it carries no size.
 */
export function pixabayPreviewUrl(webformatUrl: unknown): string | undefined {
  if (!isPixabayImageUrl(webformatUrl)) return undefined
  return webformatUrl.replace(/_640(\.[a-z]+)$/i, `_${PIXABAY_PREVIEW_SIZE}$1`)
}

/** The API key, from this process's environment. */
export function pixabayApiKeyFromEnv(): string {
  return (process.env['PIXABAY_API_KEY'] ?? '').trim()
}

/** A request's canonical form: what is sent, and what the cache keys on. */
export function pixabaySearchParams(
  request: StockPhotoSearchRequest,
): URLSearchParams {
  const query = request.query
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, STOCK_PHOTO_QUERY_MAX_CHARS)
    .trim()
  const params = new URLSearchParams()
  params.set('q', query)
  params.set('image_type', 'photo')
  params.set(
    'orientation',
    request.orientation === 'horizontal' || request.orientation === 'vertical'
      ? request.orientation
      : 'all',
  )
  const minWidth = Math.max(0, Math.floor(request.minWidth ?? 0))
  const minHeight = Math.max(0, Math.floor(request.minHeight ?? 0))
  if (minWidth) params.set('min_width', String(minWidth))
  if (minHeight) params.set('min_height', String(minHeight))
  if (request.people) params.set('category', 'people')
  params.set('safesearch', 'true')
  params.set('order', 'popular')
  params.set('per_page', String(PIXABAY_PER_PAGE))
  return params
}

/** `largeImageURL`'s size: the original scaled so its longer edge is at most 1280. */
export function pixabayLargeSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const longer = Math.max(width, height)
  if (!longer || longer <= PIXABAY_LARGE_EDGE) return { width, height }
  const scale = PIXABAY_LARGE_EDGE / longer
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

/** Whether `value` is an https address on one of Pixabay's image hosts. */
export function isPixabayImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      PIXABAY_IMAGE_HOSTS.has(url.hostname)
    )
  } catch {
    return false
  }
}

const text = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : ''

/**
 * The hits of an answer, each checked: an id, a download address on
 * Pixabay's image hosts, a size, and a page on pixabay.com. A hit that
 * fails any of them is dropped rather than repaired.
 */
export function parsePixabayAnswer(body: unknown): PixabayPhoto[] {
  const hits = (body as { hits?: unknown } | null)?.hits
  if (!Array.isArray(hits)) return []
  const photos: PixabayPhoto[] = []
  for (const hit of hits as Array<Record<string, unknown>>) {
    if (!hit || typeof hit !== 'object') continue
    const id = Number(hit['id'])
    const width = Number(hit['imageWidth'])
    const height = Number(hit['imageHeight'])
    const downloadUrl = hit['largeImageURL']
    const pageUrl = text(hit['pageURL'], 500)
    if (!Number.isSafeInteger(id) || id <= 0) continue
    if (!(width > 0) || !(height > 0)) continue
    if (!isPixabayImageUrl(downloadUrl)) continue
    if (!pageUrl.startsWith('https://pixabay.com/')) continue
    const user = text(hit['user'], 80)
    const userId = Number(hit['user_id'])
    const size = pixabayLargeSize(width, height)
    const previewUrl = pixabayPreviewUrl(hit['webformatURL'])
    photos.push({
      provider: PIXABAY_PROVIDER_ID,
      id: String(id),
      width: size.width,
      height: size.height,
      pageUrl,
      photographer: user || 'A Pixabay contributor',
      ...(user && Number.isSafeInteger(userId) && userId > 0
        ? {
            photographerUrl: `https://pixabay.com/users/${encodeURIComponent(user)}-${userId}/`,
          }
        : {}),
      tags: text(hit['tags'], 300)
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20),
      downloadUrl,
      ...(previewUrl ? { previewUrl } : {}),
    })
  }
  return photos
}

/** What the client knows of its rate limit window. */
interface RateState {
  /** Requests the last answer said are left, or null before any answer. */
  remaining: number | null
  /** When the window the last answer described resets. */
  resetAtMs: number
  /** This process's own requests in the last minute. */
  recent: number[]
}

export interface PixabayClientOptions {
  /** The key, read at each call. */
  apiKey?: () => string
  fetch?: typeof fetch
  now?: () => number
  /** How a rate-limited download waits; specs hand in one that records and returns at once. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface PixabayClient {
  configured(): boolean
  /** The hits, or `null` when no request was made or it failed. */
  search(
    request: StockPhotoSearchRequest,
    signal?: AbortSignal,
  ): Promise<PixabayPhoto[] | null>
  download(
    url: string,
    options: { maxBytes: number; signal?: AbortSignal },
  ): Promise<StockPhotoDownload | null>
  /** Whether a search would be made now; for the caller's log. */
  rateLimited(): boolean
}

const withTimeout = (ms: number, signal?: AbortSignal): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms)

export function createPixabayClient(
  options: PixabayClientOptions = {},
): PixabayClient {
  const apiKey = options.apiKey ?? pixabayApiKeyFromEnv
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepFor
  const rate: RateState = { remaining: null, resetAtMs: 0, recent: [] }

  // Downloads take turns (AGL-3988): a few at once, and none while a 429 asked to wait.
  let downloading = 0
  const waiting: Array<() => void> = []
  /** Until when Pixabay's image hosts asked this process to leave them alone. */
  let pausedUntil = 0
  /** Takes a turn to download; `false` when `signal` aborted while it waited. */
  const takeTurn = async (signal?: AbortSignal): Promise<boolean> => {
    while (downloading >= PIXABAY_DOWNLOADS_AT_ONCE) {
      if (signal?.aborted) return false
      await new Promise<void>((resolve) => {
        const done = () => {
          signal?.removeEventListener('abort', done)
          const at = waiting.indexOf(done)
          if (at >= 0) waiting.splice(at, 1)
          resolve()
        }
        waiting.push(done)
        signal?.addEventListener('abort', done, { once: true })
      })
    }
    downloading += 1
    const pause = pausedUntil - now()
    if (pause > 0) await sleep(pause, signal)
    if (signal?.aborted) {
      giveTurn()
      return false
    }
    return true
  }
  const giveTurn = () => {
    downloading = Math.max(0, downloading - 1)
    waiting.shift()?.()
  }

  const rateLimited = (): boolean => {
    const at = now()
    rate.recent = rate.recent.filter((time) => at - time < 60_000)
    if (rate.recent.length >= PIXABAY_LOCAL_PER_MINUTE) return true
    return (
      rate.remaining !== null &&
      rate.remaining <= PIXABAY_RATE_MARGIN &&
      at < rate.resetAtMs
    )
  }

  const readRate = (response: Response) => {
    const remaining = Number(response.headers.get('x-ratelimit-remaining'))
    const reset = Number(response.headers.get('x-ratelimit-reset'))
    if (response.status === 429) {
      rate.remaining = 0
      rate.resetAtMs =
        now() + (Number.isFinite(reset) && reset > 0 ? reset : 60) * 1000
      return
    }
    if (
      response.headers.has('x-ratelimit-remaining') &&
      Number.isFinite(remaining)
    ) {
      rate.remaining = remaining
      rate.resetAtMs =
        now() + (Number.isFinite(reset) && reset > 0 ? reset : 60) * 1000
    }
  }

  return {
    configured: () => apiKey().length > 0,
    rateLimited,
    async search(request, signal) {
      const key = apiKey()
      if (!key) return null
      const params = pixabaySearchParams(request)
      if (!params.get('q')) return null
      if (rateLimited()) return null
      rate.recent.push(now())
      // The key goes first and the URL is never logged or thrown.
      const url = `${PIXABAY_API_URL}?key=${encodeURIComponent(key)}&${params.toString()}`
      let response: Response
      try {
        response = await doFetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: withTimeout(SEARCH_TIMEOUT_MS, signal),
        })
      } catch {
        console.warn('pixabay: the search did not answer')
        return null
      }
      readRate(response)
      if (!response.ok) {
        console.warn('pixabay: the search was refused', {
          status: response.status,
        })
        return null
      }
      try {
        return parsePixabayAnswer(await response.json())
      } catch {
        console.warn('pixabay: the search answered something other than JSON')
        return null
      }
    },
    async download(address, { maxBytes, signal }) {
      // Every way a copy fails says why (AGL-3923): from 2026-10-18 07:38Z
      // production stored no stock photo at all while its searches answered,
      // and nothing said whether Pixabay refused, redirected or timed out.
      // The address is signed, so only its host is ever logged.
      const failed = (reason: string, detail: Record<string, unknown> = {}) => {
        if (!signal?.aborted)
          console.warn('pixabay: a photo download failed', { reason, ...detail })
        return null
      }
      /** One try: the photo, `null` for a failure of its own, or how long the hosts asked to wait. */
      const once = async (): Promise<StockPhotoDownload | null | { waitMs: number | null; detail: Record<string, unknown> }> => {
        let url = address
        const deadline = withTimeout(DOWNLOAD_TIMEOUT_MS, signal)
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
          if (!isPixabayImageUrl(url)) return failed('host', { host: hostOf(url), hop })
          let response: Response
          try {
            response = await doFetch(url, {
              method: 'GET',
              redirect: 'manual',
              signal: deadline,
            })
          } catch (error) {
            return failed(deadline.aborted ? 'timeout' : 'network', { host: hostOf(url), error: String(error).slice(0, 160) })
          }
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location')
            if (!location) return failed('redirect-without-location', { status: response.status })
            try {
              url = new URL(location, url).toString()
            } catch {
              return failed('redirect-unreadable', { status: response.status })
            }
            continue
          }
          const detail = {
            status: response.status,
            host: hostOf(url),
            server: response.headers.get('server') ?? null,
            ray: response.headers.get('cf-ray') ? true : false,
          }
          if (RATE_LIMITED.has(response.status))
            return { waitMs: pixabayRetryAfterMs(response.headers.get('retry-after'), now()), detail }
          if (!response.ok) return failed('status', detail)
          const labeled = String(response.headers.get('content-type') ?? '')
            .split(';')[0]
            .trim()
            .toLowerCase()
          const declared = Number(response.headers.get('content-length'))
          if (Number.isFinite(declared) && declared > maxBytes) return failed('too-large', { declared, maxBytes })
          let bytes: Uint8Array
          try {
            bytes = new Uint8Array(await response.arrayBuffer())
          } catch (error) {
            return failed(deadline.aborted ? 'timeout' : 'body', { error: String(error).slice(0, 160) })
          }
          if (!bytes.length || bytes.length > maxBytes) return failed('size', { bytes: bytes.length, maxBytes })
          // The bytes say what the photo is, never the label (AGL-3923): photo
          // 10157445 came labeled image/png and was not PNG, and the media
          // library's own check refused it. The same signatures decide here.
          const contentType = sniffPhotoContentType(bytes)
          if (!contentType || !IMAGE_TYPES.has(contentType))
            return failed('type', { declared: labeled.slice(0, 60), sniffed: contentType, status: response.status })
          if (contentType !== labeled)
            console.info('pixabay: a photo was labeled other than its bytes', { declared: labeled.slice(0, 60), sniffed: contentType })
          return { bytes, contentType }
        }
        return failed('too-many-redirects', { hops: MAX_REDIRECTS + 1 })
      }
      // A 429 is the hosts asking to wait, never a refusal of this photo
      // (AGL-3988): every download of the process waits it out together, then
      // this one asks again, a few times, inside the caller's own time.
      for (let attempt = 0; ; attempt += 1) {
        if (!(await takeTurn(signal))) return null
        let result: Awaited<ReturnType<typeof once>>
        try {
          result = await once()
        } finally {
          giveTurn()
        }
        if (!result || 'bytes' in result) return result
        if (attempt >= PIXABAY_DOWNLOAD_RETRIES || signal?.aborted)
          return failed('status', { ...result.detail, attempts: attempt + 1 })
        const waitMs = Math.min(
          PIXABAY_DOWNLOAD_RETRY_MAX_MS,
          result.waitMs ?? DOWNLOAD_RETRY_FIRST_MS * 2 ** attempt,
        )
        pausedUntil = Math.max(pausedUntil, now() + waitMs)
      }
    },
  }
}

/** A URL's host alone, for a log line: the rest of a Pixabay image address is signed. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'unreadable'
  }
}
