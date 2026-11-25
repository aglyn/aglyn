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
 * A photo too large for one upload is made smaller first (the longest side
 * at most {@link POD_IMAGE_MAX_EDGE} pixels, re-encoded), so a service's
 * full-size mockups arrive rather than being skipped. A photo that cannot be
 * fetched, or is not an image, is left out; the product is imported without
 * it and the result says how many were. The product's own gallery is copied
 * up to {@link POD_IMAGES_PER_PRODUCT}, and every color's own photo beside
 * it, so each choice on the product page still shows its picture.
 */

const IMAGE_HOSTS = new Set<string>(POD_IMAGE_ORIGINS.map((origin) => new URL(origin).hostname))

/** Gallery photos copied per product; each variant's own photo is copied beside them. */
export const POD_IMAGES_PER_PRODUCT = 12

/** Every photo copied for one product, gallery and variants together. */
export const POD_IMAGES_MAX_TOTAL = 60

/** The largest photo uploaded as it is: one upload request's body must stay under the platform's limit. */
export const POD_IMAGE_MAX_BYTES = 3 * 1024 * 1024

/** The largest photo fetched at all; a larger one is made smaller before upload. */
export const POD_IMAGE_FETCH_MAX_BYTES = 30 * 1024 * 1024

/** The longest side of a photo that had to be made smaller. */
export const POD_IMAGE_MAX_EDGE = 2400

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
    if (Number.isFinite(declared) && declared > POD_IMAGE_FETCH_MAX_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > POD_IMAGE_FETCH_MAX_BYTES) return null
    if (bytes.length <= POD_IMAGE_MAX_BYTES) return { base64: bytes.toString('base64'), contentType }
    const smaller = await shrinkImage(bytes, contentType)
    return smaller ? { base64: smaller.bytes.toString('base64'), contentType: smaller.contentType } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A photo over the upload limit, made smaller: the longest side at most
 * {@link POD_IMAGE_MAX_EDGE}, re-encoded in its own format (a PNG mockup
 * keeps its transparency) and, if still too large, as a JPEG at a lower
 * quality. `null` when it cannot be made small enough.
 */
export async function shrinkImage(bytes: Buffer, contentType: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (contentType === 'image/gif') return null
  try {
    const { default: sharp } = await import('sharp')
    const resized = () =>
      sharp(bytes, { failOn: 'none' }).rotate().resize({ width: POD_IMAGE_MAX_EDGE, height: POD_IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    const attempts: Array<() => Promise<{ bytes: Buffer; contentType: string }>> = [
      async () =>
        contentType === 'image/png'
          ? { bytes: await resized().png({ compressionLevel: 9, palette: true }).toBuffer(), contentType: 'image/png' }
          : contentType === 'image/webp'
            ? { bytes: await resized().webp({ quality: 85 }).toBuffer(), contentType: 'image/webp' }
            : { bytes: await resized().jpeg({ quality: 85, mozjpeg: true }).toBuffer(), contentType: 'image/jpeg' },
      async () => ({ bytes: await resized().webp({ quality: 80 }).toBuffer(), contentType: 'image/webp' }),
      async () => ({ bytes: await resized().jpeg({ quality: 72, mozjpeg: true }).toBuffer(), contentType: 'image/jpeg' }),
    ]
    for (const attempt of attempts) {
      const out = await attempt()
      if (out.bytes.length > 0 && out.bytes.length <= POD_IMAGE_MAX_BYTES) return out
    }
    return null
  } catch {
    return null
  }
}

/**
 * The photos to copy, in order: the product's gallery up to
 * {@link POD_IMAGES_PER_PRODUCT}, then each variant's own photo not already
 * among them, at most {@link POD_IMAGES_MAX_TOTAL} in all.
 */
export function photosToCopy(gallery: readonly string[], variantPhotos: readonly string[]): string[] {
  const out = [...new Set(gallery)].slice(0, POD_IMAGES_PER_PRODUCT)
  for (const url of variantPhotos) {
    if (out.length >= POD_IMAGES_MAX_TOTAL) break
    if (url && !out.includes(url)) out.push(url)
  }
  return out
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
  const wanted = [...new Set(sourceUrls)].slice(0, POD_IMAGES_MAX_TOTAL)
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
