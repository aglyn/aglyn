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

import { createHash } from 'node:crypto'
import { STOCK_PHOTO_SEARCH_CACHE_COLLECTION, STOCK_PHOTO_SEARCH_CACHE_MS } from '../constants'

/**
 * SEARCHES, KEPT 24 HOURS (AGL-3660): `stockPhotoSearches/{key}`.
 *
 * Pixabay's terms ask every API request cached for 24 hours, and every
 * library's limit is easier kept by asking it less. One document per
 * search a library answered — the hits it returned, an empty answer
 * included, since that too was a request — keyed by a SHA-256 of the
 * provider and the request's canonical parameters (never the key), so the
 * same words asked by any site within the day cost no request.
 *
 * Holds no workspace's data: search words chosen from a site's kind and a
 * section's subject, and the library's own public facts about its photos.
 * Deny-all to every client; written and read here alone through the Admin
 * SDK; removed by its TTL policy on `expiresAt`, and treated as absent once
 * past it whether or not the policy has swept it yet.
 */

/** What the cache holds for one search. */
export interface StockPhotoCachedSearch<Photo> {
  photos: Photo[]
}

export interface StockPhotoSearchCache<Photo> {
  get(key: string): Promise<StockPhotoCachedSearch<Photo> | null>
  put(key: string, value: StockPhotoCachedSearch<Photo>): Promise<void>
}

/** The document id a search is cached under. */
export function stockPhotoSearchCacheKey(provider: string, canonical: string): string {
  return createHash('sha256').update(`${provider}\n${canonical}`).digest('hex')
}

type Firestore = Pick<FirebaseFirestore.Firestore, 'collection'>

/**
 * The Firestore cache. `firestore` is resolved per call so registering the
 * provider at boot opens no connection. A read or a write that fails is a
 * miss and a skipped write: the cache saves requests, it never stops one.
 */
export function createFirestoreSearchCache<Photo>(options: {
  firestore: () => Promise<Firestore>
  now?: () => number
}): StockPhotoSearchCache<Photo> {
  const now = options.now ?? Date.now
  return {
    async get(key) {
      try {
        const snapshot = await (await options.firestore())
          .collection(STOCK_PHOTO_SEARCH_CACHE_COLLECTION)
          .doc(key)
          .get()
        const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
        if (!data) return null
        const expires = data['expiresAt'] as { toMillis?: () => number } | Date | number | undefined
        const expiresMs =
          typeof expires === 'number'
            ? expires
            : expires instanceof Date
              ? expires.getTime()
              : typeof expires?.toMillis === 'function'
                ? expires.toMillis()
                : 0
        if (!(expiresMs > now())) return null
        return Array.isArray(data['photos']) ? { photos: data['photos'] as Photo[] } : null
      } catch (error) {
        console.warn('stock photos: the search cache could not be read', { error: String(error) })
        return null
      }
    },
    async put(key, value) {
      try {
        const at = now()
        await (await options.firestore())
          .collection(STOCK_PHOTO_SEARCH_CACHE_COLLECTION)
          .doc(key)
          .set({
            photos: value.photos,
            createdAt: new Date(at),
            expiresAt: new Date(at + STOCK_PHOTO_SEARCH_CACHE_MS),
          })
      } catch (error) {
        console.warn('stock photos: the search cache could not be written', { error: String(error) })
      }
    },
  }
}
