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

import { recordMediaServe } from '@aglyn/tenant-data-admin/server/media-serve-count'
import type { PaidMediaDelivery } from './paid-media-delivery'

/**
 * Counts the bandwidth a paid link sends from somewhere other than our CDN
 * route (AGL-3474). A delivery provider's URL and a signed Storage URL are
 * fetched straight from the provider or the bucket, so the request that hands
 * one out is the only one we see, and it counts what the link opens at full
 * size. A signed CDN URL is not counted here: its bytes reach `serveMediaCdn`,
 * which counts them. Awaited after the redirect, so the function lives until
 * the count is written.
 */
export async function countOffRouteServe(
  firestore: Parameters<typeof recordMediaServe>[0]['firestore'],
  delivery: PaidMediaDelivery,
): Promise<void> {
  if (delivery.ok !== true) return
  if (delivery.via === 'delivery') {
    await recordMediaServe({
      firestore,
      collection: delivery.collection,
      scopeId: delivery.scopeId,
      mediaId: delivery.mediaId,
      bandwidthBytes: delivery.sizeBytes,
      redirect: true,
    })
  } else if (delivery.via === 'signed-storage' && delivery.sizeBytes > 0) {
    await recordMediaServe({
      firestore,
      collection: delivery.collection,
      scopeId: delivery.scopeId,
      bandwidthBytes: delivery.sizeBytes,
    })
  }
}
