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
import applyDuePublishSchedule from './apply-publish-schedule'

/**
 * Fetches a layout's published version (the `versionId` pointer on the
 * layout doc). Errors and missing docs resolve to `version: undefined` so a
 * broken layout never 404s a published screen — composition falls back to
 * the bare screen.
 */
export async function getPublishedLayoutVersion(options: {
  hostId: Aglyn.HostUid
  layoutId: Aglyn.LayoutUid
}) {
  const hostId = options?.hostId as string
  const layoutId = options?.layoutId as string
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

export default getPublishedLayoutVersion
