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

import { isMediaCdnPath, isMediaRef } from '@aglyn/aglyn/app-utils/media-ref'

/*==========================================
 * A PRODUCT FILE'S PHOTOS, COPIED INTO THE STORE'S MEDIA LIBRARY (AGL-4245).
 *
 * A file from another store names its photos by their address on that
 * store. Kept as addresses, every photo would keep loading from the old
 * platform and break when the old store closes, so the apply copies each one
 * into the site's own media library and the product names the stored file
 * by its media reference, exactly as a photo the owner picked in the product
 * editor. This module is the pure half: which cells are photos to copy,
 * which are already the library's own, which are skipped and why, and the
 * file name it is stored under. The fetch, the store and the key a copied
 * photo is found by again are `product-image-copy.server.ts`.
 *
 * - **Copied**: an https address on the default port, with no user name.
 * - **Kept as it is**: a media reference or a media CDN path, which is
 *   already a file of an Aglyn library (an Aglyn export read back in).
 * - **Skipped, and said so in the dry run**: anything else. An `http://`
 *   address, a name with no address (a Wix file lists bare media names, and
 *   its host is not guessed), and every photo past the import's limit.
 *=========================================*/

/** The folder of the site's media library imported product photos are filed in. */
export const PRODUCT_IMPORT_FOLDER_NAME = 'Imported products'

/**
 * The largest photo copied: the media library's own limit for an uploaded
 * image (`IMAGE_MAX_BYTES` in the console's `media-upload-limits.ts`, 15 MB),
 * which the library checks again when it stores the bytes.
 */
export const PRODUCT_IMPORT_IMAGE_MAX_BYTES = 15 * 1024 * 1024

/**
 * The most distinct photos one import copies. A 500-product store with four
 * photos each is 2,000; past it the dry run lists what is skipped. The
 * storage itself is held to the plan by the library, photo by photo.
 */
export const PRODUCT_IMPORT_IMAGES_MAX = 2_000

/** One photo's own clock, as Bring my site gives one (`SITE_IMPORT_IMAGE_TIMEOUT_MS`). */
export const PRODUCT_IMPORT_IMAGE_TIMEOUT_MS = 8_000

/** The time a photo is started with: its fetch, and the library storing it. */
export const PRODUCT_IMPORT_IMAGE_SLOT_MS = PRODUCT_IMPORT_IMAGE_TIMEOUT_MS + 4_000

/** How many photos are fetched at once. */
export const PRODUCT_IMPORT_IMAGE_CONCURRENCY = 4

/** The image types the library takes from a server. */
export const PRODUCT_IMPORT_IMAGE_TYPES = /^image\/(?:jpeg|jpg|pjpeg|png|webp|gif)\b/i

/** Why a cell's photo is not copied. */
export type ProductImageSkip = 'notHttps' | 'notAddress' | 'mediaName' | 'overLimit'

/** What one photo cell is. */
export type ProductImageCell =
  | { kind: 'copy'; url: string }
  | { kind: 'stored'; value: string }
  | { kind: 'skip'; value: string; skip: ProductImageSkip }

const TRACKING_PARAM = /^(?:utm_[a-z]+|fbclid|gclid|msclkid|_ga)$/i
const DOMAIN_PATH = /^(?:[\w-]+\.)+[a-z]{2,}(?:[/?#].*)?$/i

/** One photo cell, read. `null` for a blank one. */
export function productImageCell(raw: unknown): ProductImageCell | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (isMediaRef(value) || isMediaCdnPath(value)) return { kind: 'stored', value }
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
  if (!hasScheme && !DOMAIN_PATH.test(value)) return { kind: 'skip', value, skip: 'mediaName' }
  let url: URL
  try {
    url = new URL(hasScheme ? value : `https://${value}`)
  } catch {
    return { kind: 'skip', value, skip: 'notAddress' }
  }
  if (url.protocol === 'http:') return { kind: 'skip', value, skip: 'notHttps' }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    return { kind: 'skip', value, skip: 'notAddress' }
  }
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key)
  return { kind: 'copy', url: url.toString() }
}

/** The photos one cell names: several, split by semicolons, spaces or bars (a Wix or Squarespace cell). */
export function productImageList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map((item) => String(item ?? '')) : String(raw ?? '').split(/[;|\s]+/)
  const out: string[] = []
  for (const item of list) {
    const value = item.trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

/** What the dry run says of a skipped photo. */
export function productImageSkipDetail(skip: ProductImageSkip): string {
  switch (skip) {
    case 'notHttps':
      return 'Not copied: the address starts with http://, not https://. Add this photo on the product.'
    case 'notAddress':
      return 'Not copied: this is not a web address a photo can be copied from. Add this photo on the product.'
    case 'mediaName':
      return 'Not copied: the file names the photo but not where it is online. Add this photo on the product.'
    case 'overLimit':
      return `Not copied: one import copies up to ${PRODUCT_IMPORT_IMAGES_MAX.toLocaleString('en-US')} photos. Import the rest in a second file, or add them on the product.`
  }
}

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** A file name for the library, from the photo's address and type. */
export function productImageFileName(url: string, contentType: string): string {
  let base = 'product-photo'
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
    base =
      last
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[^a-zA-Z0-9 _-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || base
  } catch {
    // An address that does not decode keeps the plain name.
  }
  return `${base.slice(0, 80)}.${EXTENSION[contentType] ?? 'jpg'}`
}

/** A content type as the library names it: `image/jpg` and `image/pjpeg` are JPEG. */
export function productImageContentType(header: string): string {
  const type = String(header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return type === 'image/jpg' || type === 'image/pjpeg' ? 'image/jpeg' : type
}
