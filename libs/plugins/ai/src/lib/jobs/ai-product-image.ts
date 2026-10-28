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

import type { AiProductPhotoRead } from '../model/ai-products'
import type { AiImagePart } from '../providers/contract'
import {
  aiMediaAssetLocation,
  loadAiMediaSharp,
  readAiMediaAssetBytes,
  type AiMediaAssetBytes,
  type AiMediaAssetLocation,
} from './ai-media-asset'

/**
 * A PRODUCT'S PHOTO, as a `products` job shows it to the model (AGL-2916).
 *
 * Exactly one picture is read for a product: its FIRST media item, the photo
 * the storefront leads with. Nothing else of the media library is read or
 * sent — no other photo of the product, no other asset, no folder, no file
 * name and no alt text.
 *
 * The photo is read the way the media CDN would serve it
 * (`readAiMediaAssetBytes`): only an asset of this site's own library or its
 * org's, live, not private, visible to the site, not locked or quarantined.
 * A photo that is a link to somewhere else, or a raw storage URL, is not an
 * asset of the library and is not read at all; nothing is ever fetched from a
 * URL.
 *
 * What is sent is a new JPEG made from it: turned upright by its own
 * orientation, shrunk to fit inside `AI_PRODUCT_IMAGE_MAX_EDGE_PX` on its
 * longer edge (never enlarged), laid on white where it was transparent, and
 * encoded at `AI_PRODUCT_IMAGE_JPEG_QUALITY`. Encoding a new image carries none
 * of the original's metadata, so no camera, date or location embedded in the
 * file leaves with it. An animated image sends its first frame.
 */

/** The longer edge of the picture sent, in pixels. */
export const AI_PRODUCT_IMAGE_MAX_EDGE_PX = 768

/** The JPEG quality the picture is sent at. */
export const AI_PRODUCT_IMAGE_JPEG_QUALITY = 80

/** The largest original read, in bytes. */
export const AI_PRODUCT_IMAGE_MAX_SOURCE_BYTES = 15 * 1024 * 1024

/** The formats read; a vector drawing is not a product photo, and is not decoded. */
export const AI_PRODUCT_IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|avif)$/

/**
 * ASSUMED: how long the photo read takes — the media document, the CDN's
 * block, the storage download and the resize — which a pass's least time
 * counts (AGL-3035).
 */
export const AI_PRODUCT_IMAGE_READ_MS = 6_000

/** The part of `sharp` the photo read uses. */
interface SharpJpegPipeline {
  rotate(): SharpJpegPipeline
  resize(options: { width: number; height: number; fit: 'inside'; withoutEnlargement: true }): SharpJpegPipeline
  flatten(options: { background: { r: number; g: number; b: number } }): SharpJpegPipeline
  jpeg(options: { quality: number }): SharpJpegPipeline
  toBuffer(): Promise<Buffer>
}
type SharpJpeg = (input: Buffer, options?: { limitInputPixels?: number; animated?: boolean }) => SharpJpegPipeline

/** The reads that leave the process, replaceable where a spec needs to. */
export interface AiProductImageSeams {
  readBytes?: (
    firestore: FirebaseFirestore.Firestore,
    location: AiMediaAssetLocation,
    hostId: string,
  ) => Promise<AiMediaAssetBytes | null>
  encode?: (bytes: Buffer) => Promise<Buffer>
}

export type AiProductImage =
  | { status: 'read'; image: AiImagePart }
  | { status: Exclude<AiProductPhotoRead, 'read' | 'model'> }

/** The JPEG the model is shown, made from the original's bytes. */
export async function encodeAiProductImage(bytes: Buffer): Promise<Buffer> {
  const sharp = (await loadAiMediaSharp()) as SharpJpeg
  return sharp(bytes, { limitInputPixels: 64_000_000, animated: false })
    .rotate()
    .resize({
      width: AI_PRODUCT_IMAGE_MAX_EDGE_PX,
      height: AI_PRODUCT_IMAGE_MAX_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    // White, as channels: a transparent product shot reads on a white page.
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: AI_PRODUCT_IMAGE_JPEG_QUALITY })
    .toBuffer()
}

/**
 * The product's first photo as a picture part, or what kept it from being
 * one. Never throws: a photo that cannot be read leaves the copy to be written
 * from the product's words, and says so.
 *
 * On Vercel the read and the encode run in the plugins' image function, the
 * one function that ships `sharp`'s native library (`ai-image-reads.ts`,
 * AGL-4048), bounded by `AI_PRODUCT_IMAGE_READ_MS`, the time a pass counts
 * for it; anywhere else, and wherever a caller hands its own reads (a spec,
 * the eval harness), they run here. Either way an answer that does not come
 * is an unreadable photo.
 */
export async function readAiProductImage(
  firestore: FirebaseFirestore.Firestore,
  input: { value: string | null | undefined; hostId: string; orgId: string },
  seams: AiProductImageSeams = {},
): Promise<AiProductImage> {
  if (!input.value) return { status: 'none' }
  const location = aiMediaAssetLocation(input.value, input.hostId, input.orgId)
  if (!location) return { status: 'not-in-library' }
  try {
    const images = seams.readBytes || seams.encode ? null : await import('./ai-image-reads')
    const origin = images?.aiImageReadsOrigin() ?? null
    if (images && origin) {
      const payload = images.aiImageReadsRequest('product-photo', location, input.hostId, input.orgId)
      if (!payload) return { status: 'unreadable' }
      const answer = await images.requestAiImageReads<{ read?: unknown }>(
        origin,
        payload,
        AbortSignal.timeout(AI_PRODUCT_IMAGE_READ_MS),
      )
      return productImageAnswer(answer?.read)
    }
    return await readAiProductImageAt(firestore, location, input.hostId, seams)
  } catch (error) {
    console.error('ai product image read failed', { hostId: input.hostId, error })
    return { status: 'unreadable' }
  }
}

/**
 * The photo read and encoded in THIS process, from a location already held
 * to the media library's rule: what `readAiProductImage` does off Vercel,
 * and what the images function does for it on Vercel. Throws when the read
 * or the encode does.
 */
export async function readAiProductImageAt(
  firestore: FirebaseFirestore.Firestore,
  location: AiMediaAssetLocation,
  hostId: string,
  seams: AiProductImageSeams = {},
): Promise<AiProductImage> {
  const read =
    seams.readBytes ??
    ((store, where, site) =>
      readAiMediaAssetBytes(store, where, site, {
        maxBytes: AI_PRODUCT_IMAGE_MAX_SOURCE_BYTES,
        types: AI_PRODUCT_IMAGE_TYPES,
      }))
  const asset = await read(firestore, location, hostId)
  if (!asset) return { status: 'unreadable' }
  const jpeg = await (seams.encode ?? encodeAiProductImage)(asset.buffer)
  if (!jpeg.length) return { status: 'unreadable' }
  return { status: 'read', image: { type: 'image', mediaType: 'image/jpeg', data: jpeg.toString('base64') } }
}

/**
 * What the images function answered, held to the shapes a read takes: a
 * JPEG picture part, or the asset not being the library's. Anything else is
 * an unreadable photo.
 */
function productImageAnswer(answer: unknown): AiProductImage {
  const read = (answer ?? {}) as { status?: unknown; image?: Record<string, unknown> | null }
  if (read.status === 'not-in-library') return { status: 'not-in-library' }
  if (read.status !== 'read') return { status: 'unreadable' }
  const data = read.image?.['data']
  const isJpeg = read.image?.['type'] === 'image' && read.image['mediaType'] === 'image/jpeg'
  return isJpeg && typeof data === 'string' && data.length > 0
    ? { status: 'read', image: { type: 'image', mediaType: 'image/jpeg', data } }
    : { status: 'unreadable' }
}
