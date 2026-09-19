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

import { mediaDeliveryProvider } from '@aglyn/aglyn/plugin-manager/media-delivery-provider'
import {
  firebaseAdmin,
  type MediaDeliveryAsset,
  removeMediaDeliveryCopies,
  syncMediaDeliveryCopies,
} from '@aglyn/tenant-data-admin'
import { after } from 'next/server'
import { isVideoUploadType } from '../media-upload-limits'

/**
 * The console routes' half of the delivery copies (AGL-2824): where a video
 * written to the library is copied to the configured delivery provider, and
 * where one taken out of it loses its copies.
 *
 * Every function here asks `mediaDeliveryProvider('store')` FIRST, before
 * anything else runs. With no provider configured to store — every
 * deployment without one, and the default — none of them reads, writes or
 * schedules anything, so a route calling them behaves exactly as it did.
 *
 * The copy runs after the response (`after()`): a 200 MB film streams from
 * the bucket to the provider, and the person uploading it has nothing to
 * wait for. A copy that fails leaves the video serving from the platform,
 * which is what it did before there was a provider.
 */

export interface MediaDeliveryCopyScope {
  collection: 'hosts' | 'orgs'
  scopeId: string
  /**
   * The owning org, whose release flag decides whether a copy is made.
   * Resolved from the library when the caller does not have it.
   */
  orgId?: string | null
  scopeRef: FirebaseFirestore.DocumentReference
}

/**
 * Schedules the copy of one asset's video to the delivery provider, after
 * the response. `contentType`, when the caller knows it, skips everything
 * that is not a video before anything is scheduled. Answers whether a copy
 * was scheduled.
 */
export function scheduleMediaDeliveryCopies(input: {
  scope: MediaDeliveryCopyScope
  mediaId: string
  contentType?: string
}): boolean {
  if (!mediaDeliveryProvider('store')) return false
  if (input.contentType !== undefined && !isVideoUploadType(input.contentType)) {
    return false
  }
  const { scope, mediaId } = input
  after(async () => {
    try {
      const result = await syncMediaDeliveryCopies({
        docRef: scope.scopeRef.collection('media').doc(mediaId),
        asset: { collection: scope.collection, scopeId: scope.scopeId, mediaId },
        bucket: firebaseAdmin
          .app()
          .storage()
          .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
        ...(scope.orgId === undefined ? {} : { orgId: scope.orgId }),
      })
      if (result.failed.length) {
        console.warn(
          '[media-delivery] some copies failed; those representations serve from the platform',
          JSON.stringify({ scopeId: scope.scopeId, mediaId, failed: result.failed }),
        )
      }
    } catch (error) {
      console.error(
        '[media-delivery] copy did not run',
        JSON.stringify({ scopeId: scope.scopeId, mediaId }),
        error,
      )
    }
  })
  return true
}

/**
 * Removes every copy of one asset from the delivery provider, or answers null
 * when no provider is configured to store. Never throws.
 */
export async function removeAssetDeliveryCopies(
  asset: MediaDeliveryAsset,
): Promise<{ removed: number; failed: boolean } | null> {
  if (!mediaDeliveryProvider('store')) return null
  return removeMediaDeliveryCopies({ asset })
}

/**
 * A takedown's half (AGL-2824): removes every copy of the asset and, when
 * that worked, clears the document's record of them, so a release does not
 * hand out URLs for objects that are gone. Null when no provider is
 * configured to store. Never throws.
 */
export async function takeDownAssetDeliveryCopies(input: {
  asset: MediaDeliveryAsset
  docRef: FirebaseFirestore.DocumentReference
}): Promise<{ removed: number; failed: boolean } | null> {
  const removal = await removeAssetDeliveryCopies(input.asset)
  if (!removal || removal.failed) return removal
  try {
    // `update`, not a merged `set`: a document deleted meanwhile has no
    // record left to clear, and a merged `set` would create an empty one.
    await input.docRef.update({
      deliveryCopies: firebaseAdmin.firestore.FieldValue.delete(),
    })
  } catch (error) {
    // gRPC NOT_FOUND: that deleted document, which is the outcome wanted.
    if ((error as { code?: unknown } | null)?.code === 5) return removal
    console.error(
      '[media-delivery] copies removed but their record was not cleared',
      JSON.stringify(input.asset),
      error,
    )
  }
  return removal
}
