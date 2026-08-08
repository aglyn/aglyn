/**
 * @license
 * Copyright 2024 Aglyn LLC
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
import { firebaseAdmin, screenVersionConverter } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * The version doc is the LARGEST read of a render (the whole node tree), and
 * it is keyed by `versionId` — a publish points the screen doc at a NEW
 * version, so a re-publish lands under a new cache key on its own. The TTL
 * is still kept short rather than treating versions as immutable, because
 * the editor can save into an already-published version doc; 60s bounds
 * that exactly like the page's ISR window did, and the publish-path tag
 * bust covers the announced case (AGL-1302).
 */
const SCREEN_VERSION_TTL_SECONDS = 60

async function readScreenVersionDoc(
  hostId: string,
  screenId: string,
  versionId: string,
): Promise<Aglyn.AglynScreen | null> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('screens')
    .doc(screenId)
    .collection('versions')
    .withConverter(screenVersionConverter)
    .doc(versionId)
    .get()
  return snapshot.exists ? (snapshot.data() as Aglyn.AglynScreen) : null
}

export async function getScreenVersion(options: {
  hostId: Aglyn.HostUid
  screenId: Aglyn.ScreenUid
  versionId: Aglyn.VersionUid
}) {
  const hostId = options?.hostId as string
  const screenId = options?.screenId as string
  const versionId = options?.versionId as string
  const data = {
    version: undefined as Aglyn.AglynScreen,
    nextPageToken: '',
    error: null,
  }

  try {
    const version = await withRenderCache({
      key: ['tenant-screen-version', hostId, screenId, versionId],
      revalidate: SCREEN_VERSION_TTL_SECONDS,
      tags: [tenantDataTag(hostId)],
      read: () => readScreenVersionDoc(hostId, screenId, versionId),
      store: (value) => value !== null,
    })
    if (version) data.version = version
  } catch (error) {
    console.error(error)
    data.error = error
  }

  return data
}

export default getScreenVersion
