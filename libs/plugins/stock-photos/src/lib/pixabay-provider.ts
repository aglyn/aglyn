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

import type { StockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import {
  createPixabayClient,
  isPixabayImageUrl,
  PIXABAY_LABEL,
  PIXABAY_LICENSE,
  PIXABAY_PROVIDER_ID,
  pixabaySearchParams,
  type PixabayClient,
  type PixabayClientOptions,
  type PixabayPhoto,
} from './providers/pixabay'
import { stockPhotoSearchCacheKey, type StockPhotoSearchCache } from './server/search-cache'

/**
 * Core's stock photo provider, on Pixabay (AGL-3660): the client in
 * `providers/pixabay.ts`, with every search answered from the 24-hour cache
 * first. Configured once `PIXABAY_API_KEY` is set; until then it answers as
 * absent and a caller keeps its own photos.
 */
export function createPixabayStockPhotoProvider(
  options: PixabayClientOptions & {
    cache?: StockPhotoSearchCache<PixabayPhoto> | null
    client?: PixabayClient
  } = {},
): StockPhotoProvider {
  const client = options.client ?? createPixabayClient(options)
  const cache = options.cache ?? null
  return {
    id: PIXABAY_PROVIDER_ID,
    label: PIXABAY_LABEL,
    isConfigured: () => client.configured(),
    async search(request, searchOptions) {
      const params = pixabaySearchParams(request)
      if (!params.get('q')) return { photos: [], cached: false }
      const key = stockPhotoSearchCacheKey(PIXABAY_PROVIDER_ID, params.toString())
      const hit = cache ? await cache.get(key) : null
      if (hit) return { photos: hit.photos, cached: true }
      const photos = await client.search(request, searchOptions?.signal)
      if (!photos) return null
      if (cache) await cache.put(key, { photos })
      return { photos, cached: false }
    },
    async download(photo, downloadOptions) {
      if (photo.provider !== PIXABAY_PROVIDER_ID) return null
      const url = (photo as Partial<PixabayPhoto>).downloadUrl
      if (!isPixabayImageUrl(url)) return null
      return client.download(url, downloadOptions)
    },
    credit(photo) {
      return {
        providerLabel: PIXABAY_LABEL,
        license: PIXABAY_LICENSE.name,
        licenseUrl: PIXABAY_LICENSE.url,
        // The Content License asks no credit; it is recorded on the asset anyway.
        attributionRequired: false,
        text: `Photo by ${photo.photographer} on ${PIXABAY_LABEL}.`,
      }
    },
  }
}
