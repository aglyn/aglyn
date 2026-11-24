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

import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import { createHash } from 'node:crypto'
import {
  PRODUCT_IMPORT_FOLDER_NAME,
  PRODUCT_IMPORT_IMAGE_CONCURRENCY,
  PRODUCT_IMPORT_IMAGE_MAX_BYTES,
  PRODUCT_IMPORT_IMAGE_SLOT_MS,
  PRODUCT_IMPORT_IMAGE_TIMEOUT_MS,
  PRODUCT_IMPORT_IMAGE_TYPES,
  productImageContentType,
  productImageFileName,
} from './product-images'

/*==========================================
 * COPYING A PRODUCT FILE'S PHOTOS, ON THE SERVER (AGL-4245).
 *
 * - **The guard.** A photo's address is the file's, so it is fetched only
 *   through the platform's SSRF primitives in `@aglyn/tenant-data-admin`
 *   (`resolvePublicIp` + `createPinnedDispatcher`, the plugin fetch proxy's,
 *   which `site-image-source.ts` already uses here): https on the default
 *   port, no credentials, a name that resolves only to public addresses and
 *   a socket pinned to the address checked. A redirect is followed only by
 *   running every check again on where it points, up to three hops, so a
 *   public address cannot hand the fetch to a private one. The body is read
 *   to a byte cap under a clock, and only as JPEG, PNG, WebP or GIF.
 *   (Bring my site's `fetchPublicTextDetailed` does the same over the same
 *   primitives, but lives in the AI plugin, which this plugin may not import.)
 * - **The store.** Bytes go in only through the media library's server door
 *   (`pluginMediaIngest().ingest`), which checks the member, the lockdown,
 *   the bytes' structure, the takedown list and the storage band as an
 *   upload is checked, and files them in the "Imported products" folder.
 * - **Never a second copy.** Each photo is asked for by its key first
 *   (`findImportedPhoto`), so a photo two products share, a chunk retried,
 *   or the same file imported again finds the copy already stored.
 * - **One photo never fails a product.** Every refusal is an answer, never
 *   a throw, and the product is written without that photo.
 *=========================================*/

/** The key the site's library holds a copied photo by, the same as Bring my site's `siteImportImageKey`. */
export function productImageKey(url: string): string {
  return `import:${createHash('sha256').update(url).digest('hex').slice(0, 32)}`
}

/** Why a photo's fetch read nothing. */
export type ProductImageRefusal =
  | 'refused-url'
  | 'private-address'
  | 'too-many-redirects'
  | 'http-status'
  | 'content-type'
  | 'too-large'
  | 'network'

export interface ProductImageFetchResult {
  ok: boolean
  /** The body, when `ok`. */
  data?: Uint8Array
  contentType: string
  refusal: ProductImageRefusal | null
  status?: number
}

/** The guard primitives and the transport, injectable for a spec. */
export interface ProductImageFetchDeps {
  resolvePublicIp(hostname: string): Promise<string | null>
  createPinnedDispatcher(ip: string): unknown
  fetch: (url: string, init: Record<string, unknown>) => Promise<Response>
}

const MAX_REDIRECT_HOPS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

async function guardDeps(): Promise<ProductImageFetchDeps> {
  // By relative path, never by the lib's specifier (`pos-reader-splash-server.ts` says why).
  const { createPinnedDispatcher, resolvePublicIp } = await import('../server/pos-reader-splash-server')
  return { createPinnedDispatcher, resolvePublicIp, fetch: (url, init) => fetch(url, init as RequestInit) }
}

const refused = (refusal: ProductImageRefusal, status?: number): ProductImageFetchResult => ({
  ok: false,
  contentType: '',
  refusal,
  ...(status !== undefined ? { status } : {}),
})

async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

/** One photo's bytes, under the guard above. Never throws. */
export async function fetchProductImage(
  url: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
  deps?: ProductImageFetchDeps,
): Promise<ProductImageFetchResult> {
  const maxBytes = options.maxBytes ?? PRODUCT_IMPORT_IMAGE_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? PRODUCT_IMPORT_IMAGE_TIMEOUT_MS
  const guard = deps ?? (await guardDeps())
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let current = url
  try {
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      let parsed: URL
      try {
        parsed = new URL(current)
      } catch {
        return refused('refused-url')
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
        return refused('refused-url')
      }
      const pinned = await guard.resolvePublicIp(parsed.hostname)
      if (!pinned) return refused('private-address')
      const dispatcher = guard.createPinnedDispatcher(pinned) as { close?: () => Promise<void> }
      try {
        const response = await guard.fetch(parsed.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          dispatcher,
          headers: { Accept: 'image/webp,image/png,image/jpeg,image/gif;q=0.9' },
        })
        if (REDIRECT_STATUSES.has(response.status)) {
          await response.body?.cancel().catch(() => undefined)
          const location = response.headers.get('location')
          if (!location) return refused('http-status', response.status)
          try {
            current = new URL(location, parsed).toString()
          } catch {
            return refused('refused-url')
          }
          continue
        }
        if (!response.ok || !response.body) {
          await response.body?.cancel().catch(() => undefined)
          return refused('http-status', response.status)
        }
        const contentType = response.headers.get('content-type') ?? ''
        if (!PRODUCT_IMPORT_IMAGE_TYPES.test(contentType)) {
          await response.body.cancel().catch(() => undefined)
          return refused('content-type', response.status)
        }
        const declared = Number(response.headers.get('content-length') ?? '')
        if (Number.isFinite(declared) && declared > maxBytes) {
          await response.body.cancel().catch(() => undefined)
          return refused('too-large', response.status)
        }
        const data = await readCapped(response.body, maxBytes)
        if (!data) return refused('too-large', response.status)
        return { ok: true, data, contentType: productImageContentType(contentType), refusal: null }
      } finally {
        await dispatcher.close?.().catch(() => undefined)
      }
    }
    return refused('too-many-redirects')
  } catch {
    return refused('network')
  } finally {
    clearTimeout(timer)
  }
}

/** What the result says of a photo that was not copied. */
export function productImageRefusalWords(refusal: ProductImageRefusal, status?: number): string {
  switch (refusal) {
    case 'refused-url':
      return 'its address is not one a photo can be copied from'
    case 'private-address':
      return 'its address does not lead to a public website'
    case 'too-many-redirects':
      return 'its address forwards too many times'
    case 'http-status':
      return status === 404 || status === 410 ? 'the old store no longer has it' : `the old store answered with an error${status ? ` (${status})` : ''}`
    case 'content-type':
      return 'it is not a JPEG, PNG, WebP or GIF photo'
    case 'too-large':
      return `it is larger than ${Math.round(PRODUCT_IMPORT_IMAGE_MAX_BYTES / (1024 * 1024))} MB`
    case 'network':
      return 'the old store did not answer in time'
  }
}

/** One photo's answer. */
export type CopiedProductImage =
  | { ok: true; src: string; mediaId: string; created: boolean; key: string }
  | { ok: false; reason: string }

export interface ProductImageCopierDeps {
  ingest: PluginMediaIngest | null
  fetch?: (url: string) => Promise<ProductImageFetchResult>
  now?: () => number
}

export interface ProductImageCopier {
  /** The addresses of `urls` with no answer yet. */
  pending(urls: readonly string[]): string[]
  /** An address's answer, once it has one. */
  result(url: string): CopiedProductImage | undefined
  /**
   * Copies every address of `urls` without an answer, a few at a time,
   * starting none that could not finish before `deadlineAt`. `true` when
   * every one has an answer; `false` when time ran out first, and the row
   * is written on the next pass, which finds what this one stored.
   */
  copy(urls: readonly string[], deadlineAt: number): Promise<boolean>
}

/** A copier for one chunk of one import: its answers are kept, so a photo two rows share is copied once. */
export function productImageCopier(
  input: { hostId: string; uid: string | null },
  deps: ProductImageCopierDeps,
): ProductImageCopier {
  const now = deps.now ?? Date.now
  const fetchImage = deps.fetch ?? ((url: string) => fetchProductImage(url))
  const answers = new Map<string, CopiedProductImage>()
  let folder: Promise<string | null> | null = null

  const folderId = () => {
    const ingest = deps.ingest
    folder ??= ingest?.ensureFolder && input.uid
      ? ingest.ensureFolder({ hostId: input.hostId, uid: input.uid, name: PRODUCT_IMPORT_FOLDER_NAME }).catch(() => null)
      : Promise.resolve(null)
    return folder
  }

  const copyOne = async (url: string): Promise<CopiedProductImage> => {
    const ingest = deps.ingest
    if (!ingest?.findImportedPhoto || !input.uid) return { ok: false, reason: 'the media library could not be reached' }
    const key = productImageKey(url)
    try {
      const held = await ingest.findImportedPhoto({ hostId: input.hostId, sourceKey: key })
      if (held) return { ok: true, src: held.src, mediaId: held.mediaId, created: false, key }
      const into = await folderId()
      if (!into) return { ok: false, reason: `the "${PRODUCT_IMPORT_FOLDER_NAME}" folder could not be made in your media library` }
      const fetched = await fetchImage(url)
      if (!fetched.ok || !fetched.data) {
        return { ok: false, reason: productImageRefusalWords(fetched.refusal ?? 'network', fetched.status) }
      }
      let domain = ''
      try {
        domain = new URL(url).hostname
      } catch {
        // The address was read once already; a name is only a label here.
      }
      const stored = await ingest.ingest({
        hostId: input.hostId,
        uid: input.uid,
        fileName: productImageFileName(url, fetched.contentType),
        contentType: fetched.contentType,
        bytes: fetched.data,
        folderId: into,
        importedFrom: { key, url, domain },
      })
      // A union does not narrow across this repo's library boundaries (`strictNullChecks` is off).
      if (!stored.ok) {
        const refusal = String((stored as { reason?: string }).reason ?? '').replace(/\.$/, '')
        return { ok: false, reason: refusal ? `your media library did not take it (${refusal})` : 'your media library did not take it' }
      }
      const asset = stored as { src: string; mediaId: string }
      return { ok: true, src: asset.src, mediaId: asset.mediaId, created: true, key }
    } catch (error) {
      console.warn('[commerce] a product photo could not be copied', { hostId: input.hostId, error })
      return { ok: false, reason: 'it could not be copied' }
    }
  }

  const pending = (urls: readonly string[]) => [...new Set(urls)].filter((url) => !answers.has(url))

  return {
    pending,
    result: (url) => answers.get(url),
    async copy(urls, deadlineAt) {
      const queue = pending(urls)
      const worker = async () => {
        while (queue.length) {
          if (deadlineAt - now() < PRODUCT_IMPORT_IMAGE_SLOT_MS) return
          const url = queue.shift() as string
          answers.set(url, await copyOne(url))
        }
      }
      await Promise.all(Array.from({ length: Math.min(PRODUCT_IMPORT_IMAGE_CONCURRENCY, queue.length) }, worker))
      return pending(urls).length === 0
    },
  }
}
