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
 * - **Cache requests for 24 hours.** `server/search-cache.ts`.
 * - **The rate limit** (100 requests a minute per key by default, reported
 *   in `X-RateLimit-*` headers). The client reads the headers on every answer
 *   and stops asking, keeping a margin, until the window resets; a 429 stops
 *   it for the window the answer names. A search it does not make answers
 *   `null`, and the caller uses its own fallback rather than retrying.
 * - **Show where search results are from.** No search result is ever shown
 *   to anyone: a job places one photo. The asset records its credit anyway
 *   (the photographer, the photo's Pixabay page and the license), which the
 *   media library shows in the asset's description.
 * - **Real human requests, no mass downloads.** A search runs only inside a
 *   site build a member started, a page asks a handful at most, and a photo
 *   is downloaded once per site.
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

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** A Pixabay hit, with the address its bytes are fetched from. */
export interface PixabayPhoto extends StockPhoto {
  downloadUrl: string
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
  const rate: RateState = { remaining: null, resetAtMs: 0, recent: [] }

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
      let url = address
      const deadline = withTimeout(DOWNLOAD_TIMEOUT_MS, signal)
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        if (!isPixabayImageUrl(url)) return null
        let response: Response
        try {
          response = await doFetch(url, {
            method: 'GET',
            redirect: 'manual',
            signal: deadline,
          })
        } catch {
          return null
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) return null
          try {
            url = new URL(location, url).toString()
          } catch {
            return null
          }
          continue
        }
        if (!response.ok) return null
        const contentType = String(response.headers.get('content-type') ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase()
        if (!IMAGE_TYPES.has(contentType)) return null
        const declared = Number(response.headers.get('content-length'))
        if (Number.isFinite(declared) && declared > maxBytes) return null
        let bytes: Uint8Array
        try {
          bytes = new Uint8Array(await response.arrayBuffer())
        } catch {
          return null
        }
        if (!bytes.length || bytes.length > maxBytes) return null
        return { bytes, contentType }
      }
      return null
    },
  }
}
