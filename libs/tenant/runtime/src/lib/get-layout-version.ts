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
import {
  firebaseAdmin,
  layoutConverter,
  layoutVersionConverter,
} from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import applyDuePublishSchedule from './apply-publish-schedule'

/**
 * Backstop TTL only (AGL-1302): a layout publish goes through the console's
 * `/api/screens/revalidate`, which busts `tenant-data:{hostId}` on the
 * tenant alongside dropping every dependent page — so publishes stay
 * instant and 60s only bounds unannounced writes, exactly like the page's
 * own ISR window did.
 */
const LAYOUT_VERSION_TTL_SECONDS = 60

/**
 * Fetches a layout's published version (the `versionId` pointer on the
 * layout doc). Errors and missing docs resolve to `version: undefined` so a
 * broken layout never 404s a published screen — composition falls back to
 * the bare screen.
 *
 * The layout chain runs on EVERY page of a site that carries chrome, which
 * made this pair of reads one of the most amplified in the render
 * (AGL-1302). The doc+version pair is cached whole; a layout carrying a
 * PENDING publish schedule is served but never stored, because
 * `applyDuePublishSchedule` needs the live `Timestamp` (`publishAt.seconds`
 * does not survive the cache's JSON round trip) and the flip it performs is
 * a write this cache must not suppress.
 */
async function readPublishedLayoutVersion(hostId: string, layoutId: string) {
  const data = {
    layout: undefined as Aglyn.AglynLayout | undefined,
    version: undefined as Aglyn.AglynLayoutVersion | undefined,
    error: null as unknown,
  }
  const firestore = firebaseAdmin.app().firestore()
  const layoutRef = firestore
    .collection('hosts')
    .doc(hostId)
    .collection('layouts')
    .doc(layoutId)

  try {
    const layoutSnapshot = await layoutRef
      .withConverter(layoutConverter)
      .get()
    if (!layoutSnapshot.exists) return data
    data.layout = layoutSnapshot.data() as Aglyn.AglynLayout

    // Scheduled publishing applies to layouts too (AGL-61).
    const versionId = await applyDuePublishSchedule({
      hostId,
      collectionName: 'layouts',
      docId: layoutId,
      parent: data.layout,
    })
    if (!versionId) return data

    const versionSnapshot = await layoutRef
      .collection('versions')
      .withConverter(layoutVersionConverter)
      .doc(versionId)
      .get()
    if (!versionSnapshot.exists) return data
    data.version = versionSnapshot.data() as Aglyn.AglynLayoutVersion
  } catch (error) {
    console.error(error)
    data.error = error
  }

  return data
}

export async function getPublishedLayoutVersion(options: {
  hostId: Aglyn.HostUid
  layoutId: Aglyn.LayoutUid
}) {
  const hostId = options?.hostId as string
  const layoutId = options?.layoutId as string
  try {
    return await withRenderCache({
      key: ['tenant-layout-version', hostId, layoutId],
      revalidate: LAYOUT_VERSION_TTL_SECONDS,
      tags: [tenantDataTag(hostId)],
      read: () => readPublishedLayoutVersion(hostId, layoutId),
      // Errors, missing layouts and pending schedules are served fresh each
      // time — only a clean published read is worth replaying.
      store: (value) =>
        !value.error &&
        value.layout !== undefined &&
        (value.layout as { publishSchedule?: { status?: string } })
          .publishSchedule?.status !== 'pending',
    })
  } catch (error) {
    // The cache wrapper itself failed; degrade to the uncached read so a
    // caching problem can never 404 a published screen.
    console.error(error)
    return readPublishedLayoutVersion(hostId, layoutId)
  }
}

export default getPublishedLayoutVersion
