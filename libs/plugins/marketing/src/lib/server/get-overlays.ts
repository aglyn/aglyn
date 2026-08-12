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

import * as Aglyn from '@aglyn/aglyn/server'
import * as MarketingModel from '../model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * One of three per-render reads AGL-1302 left uncached (AGL-1440).
 *
 * This fires on every render of every path, and Firestore bills a minimum of
 * one read for a query returning nothing — so a site that has never created an
 * overlay still paid for asking. 60s is the same backstop every other cached
 * compose read uses; the publish path's `revalidateTag(tenant-data:{hostId})`
 * busts it the instant an author publishes.
 *
 * Worst stale read: an overlay edited directly (outside a publish) shows its
 * previous copy for up to 60s. Nothing here is an entitlement or a security
 * decision — `marketingOverlays` is checked against the live org document by
 * the caller, which is why the gate is there and not in here.
 */
const OVERLAYS_TTL_SECONDS = 60

/**
 * Marketing hub overlays (AGL-251): the host's configured announcement
 * bars and popups from `hosts/{hostId}/overlays`. Fail-open — on error an
 * empty list is returned and the legacy single bar/popup fields apply.
 */
export async function getOverlays(options: {
  hostId: string
}): Promise<Array<MarketingModel.HostOverlay & { $id: string }>> {
  try {
    return await withRenderCache({
      key: ['marketing-overlays', options.hostId],
      revalidate: OVERLAYS_TTL_SECONDS,
      tags: [tenantDataTag(options.hostId)],
      read: () => readOverlays(options.hostId),
    })
  } catch (error) {
    // A throwing read is never stored — `unstable_cache` writes nothing when
    // the callback rejects — so the fail-open empty list stays per-request.
    console.error(error)
    return []
  }
}

async function readOverlays(
  hostId: string,
): Promise<Array<MarketingModel.HostOverlay & { $id: string }>> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('overlays')
    .limit(50)
    .get()
  return snapshot.docs.map((doc) => ({
    $id: doc.id,
    ...(doc.data() as MarketingModel.HostOverlay),
  }))
}

export default getOverlays
