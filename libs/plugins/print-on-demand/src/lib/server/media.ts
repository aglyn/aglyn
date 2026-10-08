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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { POD_IMAGE_ORIGINS } from '../constants/bundle-common'
import { podFetch } from './config'

/**
 * A service's product photos, copied into the site's own media library
 * (AGL-3641).
 *
 * A published page loads images only from the site's own addresses and the
 * library's storage — its `img-src` is enforced — so a photo left on the
 * service's CDN would not show. Each one is fetched once, from the
 * service's own image hosts only, and posted to the console's upload route
 * AS THE MEMBER who imported it, so the library applies every check, quota
 * and counter an Upload button would, and the photo is theirs to edit.
 *
 * A photo that cannot be fetched, is too large for one upload, or is not an
 * image is left out; the product is imported without it and the result says
 * how many were. Only the first few photos are copied; the rest stay at the
 * service.
 */

const IMAGE_HOSTS = new Set<string>(POD_IMAGE_ORIGINS.map((origin) => new URL(origin).hostname))

/** Photos copied per product. */
export const POD_IMAGES_PER_PRODUCT = 8

/** The largest photo copied: one upload request's body must stay under the platform's limit. */
export const POD_IMAGE_MAX_BYTES = 3 * 1024 * 1024

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function isPodImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && IMAGE_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

export interface MediaCopyContext {
  /** The console's own origin, where the upload route answers. */
  origin: string
  /** The member's `Authorization` header. */
  authorization: string
  hostId: string
}

async function fetchImage(url: string): Promise<{ base64: string; contentType: string } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await podFetch()(url, { method: 'GET', signal: controller.signal, redirect: 'error' })
    if (!response.ok) return null
    const contentType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!IMAGE_TYPES.has(contentType)) return null
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > POD_IMAGE_MAX_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > POD_IMAGE_MAX_BYTES) return null
    return { base64: bytes.toString('base64'), contentType }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function fileNameFor(name: string, index: number, contentType: string): string {
  const base = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'product'
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]
  return `${base}-${index + 1}.${extension}`
}

/**
 * Copies photos into the library. Answers each source URL's library URL —
 * the site's own `cdnPath` where the workspace serves media through it, the
 * stored file's address otherwise — and how many were left out.
 */
export async function copyImagesToLibrary(
  context: MediaCopyContext,
  productName: string,
  sourceUrls: readonly string[],
): Promise<{ urls: Map<string, string>; skipped: number }> {
  const urls = new Map<string, string>()
  let skipped = 0
  const wanted = [...new Set(sourceUrls)].slice(0, POD_IMAGES_PER_PRODUCT)
  for (const [index, sourceUrl] of wanted.entries()) {
    if (!isPodImageUrl(sourceUrl)) {
      skipped += 1
      continue
    }
    const image = await fetchImage(sourceUrl)
    if (!image) {
      skipped += 1
      continue
    }
    let payload: Record<string, unknown> = {}
    let ok: boolean
    try {
      const response = await podFetch()(new URL('/api/media/upload', context.origin).toString(), {
        method: 'POST',
        headers: { Authorization: context.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId: context.hostId,
          fileName: fileNameFor(productName, index, image.contentType),
          contentType: image.contentType,
          data: image.base64,
        }),
      })
      payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
      ok = response.ok
    } catch {
      ok = false
    }
    const mediaId = typeof payload['mediaId'] === 'string' ? payload['mediaId'] : ''
    if (!ok || !mediaId) {
      skipped += 1
      continue
    }
    const stored = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(context.hostId)
      .collection('media')
      .doc(mediaId)
      .get()
      .catch(() => null)
    const address = String(stored?.get('cdnPath') || stored?.get('url') || payload['url'] || '')
    if (address) urls.set(sourceUrl, address)
    else skipped += 1
  }
  return { urls, skipped }
}
