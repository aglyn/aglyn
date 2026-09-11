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

import { paidMediaAssetOf, samePaidMediaLibrary } from '@aglyn/aglyn/server'

/**
 * Which products still sell one library asset as paid media: a members video
 * (AGL-2814) or a paid download (AGL-2847).
 *
 * Paid media is private, and the commerce routes refuse to deliver a file
 * that is not. That leaves one way to put it back in public: "Publish file"
 * in the media library, which gives the asset its permanent CDN URL again.
 * That URL names the same asset as every signed link a buyer was ever handed,
 * so stripping `exp` and `sig` off any of them would start working again. The
 * media route asks this before it publishes, and refuses while the answer is
 * not empty.
 *
 * It reads the products themselves rather than a marker stamped on the media
 * document. A marker is one more thing every product writer has to keep true,
 * and the products hub, the CSV import, duplication and a direct edit all
 * write these lists. The products cannot disagree with themselves.
 */

/** The product fields that hold paid media, each a list of `{ url }`. */
export const PAID_MEDIA_LISTS = ['gatedVideos', 'digitalFiles'] as const

/** A product that sells an asset as paid media. */
export interface PaidMediaUse {
  hostId: string
  productId: string
  productName: string
}

/** What the scan found, and whether it read everything it needed to. */
export interface PaidMediaUses {
  uses: PaidMediaUse[]
  /**
   * False when a ceiling stopped the scan. An incomplete "no product sells
   * this" is not an answer anyone may publish on.
   */
  complete: boolean
}

/** Sites read for an org-library asset before the scan calls itself partial. */
export const PAID_MEDIA_USE_HOST_CEILING = 200

/** Products read per site before the scan calls itself partial. */
export const PAID_MEDIA_USE_PRODUCT_CEILING = 5000

/** Sites whose catalogs are read at once. */
const HOST_CONCURRENCY = 8

interface QueryLike {
  where(field: string, op: '==', value: unknown): QueryLike
  select(...fields: string[]): QueryLike
  limit(count: number): QueryLike
  get(): Promise<{
    size: number
    docs: { id: string; get(field: string): unknown }[]
  }>
}

/** The part of Firestore the scan reads through. */
export interface PaidMediaUsesFirestore {
  collection(name: string): QueryLike & {
    doc(id: string): { collection(name: string): QueryLike }
  }
}

/**
 * Every product selling the asset `mediaId` in the library at `base` —
 * `hosts/{hostId}` or `orgs/{orgId}` — as paid media.
 *
 * `bucket` is the platform's media bucket, so a raw download URL from any
 * other bucket is never mistaken for this asset.
 */
export async function findPaidMediaUses(options: {
  firestore: PaidMediaUsesFirestore
  base: string
  mediaId: string
  bucket?: string
}): Promise<PaidMediaUses> {
  const { firestore, mediaId } = options
  const [root, scopeId] = String(options.base ?? '').split('/')
  if ((root !== 'hosts' && root !== 'orgs') || !scopeId || !mediaId) {
    return { uses: [], complete: false }
  }
  const library = root === 'orgs' ? `org:${scopeId}` : scopeId
  let complete = true

  let hostIds: string[]
  if (root === 'orgs') {
    const hosts = await firestore
      .collection('hosts')
      .where('orgId', '==', scopeId)
      .limit(PAID_MEDIA_USE_HOST_CEILING + 1)
      .get()
    if (hosts.size > PAID_MEDIA_USE_HOST_CEILING) complete = false
    hostIds = hosts.docs
      .slice(0, PAID_MEDIA_USE_HOST_CEILING)
      .map((host) => host.id)
  } else {
    // A site's own library can only be sold by that site.
    hostIds = [scopeId]
  }

  const namesThisAsset = (entry: unknown) => {
    const asset = paidMediaAssetOf((entry as { url?: unknown } | null)?.url, {
      bucket: options.bucket,
    })
    return asset?.mediaId === mediaId && samePaidMediaLibrary(asset.scope, library)
  }

  const uses: PaidMediaUse[] = []
  for (let index = 0; index < hostIds.length; index += HOST_CONCURRENCY) {
    const batch = hostIds.slice(index, index + HOST_CONCURRENCY)
    const catalogs = await Promise.all(
      batch.map(async (hostId) => ({
        hostId,
        products: await firestore
          .collection('hosts')
          .doc(hostId)
          .collection('products')
          .select('name', 'deletedAt', ...PAID_MEDIA_LISTS)
          .limit(PAID_MEDIA_USE_PRODUCT_CEILING + 1)
          .get(),
      })),
    )
    for (const { hostId, products } of catalogs) {
      if (products.size > PAID_MEDIA_USE_PRODUCT_CEILING) complete = false
      for (const product of products.docs.slice(0, PAID_MEDIA_USE_PRODUCT_CEILING)) {
        // A deleted product sells nothing. Restoring one brings back paid media
        // the commerce routes refuse until the file is private again.
        if (product.get('deletedAt')) continue
        const sells = PAID_MEDIA_LISTS.some((list) => {
          const entries = product.get(list)
          return Array.isArray(entries) && entries.some(namesThisAsset)
        })
        if (sells) {
          uses.push({
            hostId,
            productId: product.id,
            productName: String(product.get('name') ?? '') || product.id,
          })
        }
      }
    }
  }
  return { uses, complete }
}

/** What the media library tells an author whose publish was refused. */
export function paidMediaPublishRefusal(result: PaidMediaUses): string {
  const { uses } = result
  if (!uses.length) {
    return (
      'We could not check every product that might sell this file, so it ' +
      'stays private. Remove it from any product that uses it, then publish ' +
      'it again.'
    )
  }
  const names = uses
    .slice(0, 3)
    .map((use) => `“${use.productName}”`)
    .join(', ')
  const more = uses.length > 3 ? ` and ${uses.length - 3} more` : ''
  const which = uses.length === 1 ? 'that product' : 'those products'
  return (
    `This file is sold on ${names}${more}. Remove it from ${which} before ` +
    'publishing it: a public copy would let anyone have it without buying.'
  )
}
