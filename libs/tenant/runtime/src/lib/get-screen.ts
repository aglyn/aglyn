/**
 * @license
 * Copyright 2022 Aglyn LLC
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
import { firebaseAdmin, screenConverter } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * Backstop TTL only (AGL-1302): a screen publish flips `versionId` on this
 * doc, and the publish path already busts `tenant-data:{hostId}` through the
 * tenant `/api/revalidate` route, so publishes stay as instant as AGL-1150
 * made them. 60s matches the page's own ISR window for everything else.
 */
const SCREEN_DOC_TTL_SECONDS = 60

async function readScreenDoc(
  hostId: string,
  screenId: string,
): Promise<Aglyn.AglynScreen | null> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('screens')
    .withConverter(screenConverter)
    .doc(screenId)
    .get()
  return snapshot.exists ? (snapshot.data() as Aglyn.AglynScreen) : null
}

export async function getScreen(options: {
  screenId: Aglyn.ScreenUid
  hostId: Aglyn.HostUid
}) {
  const { screenId, hostId } = options
  const data = {
    screen: undefined as Aglyn.AglynScreen,
    nextPageToken: '',
    error: null,
  }

  try {
    const screen = await withRenderCache({
      key: ['tenant-screen-doc', hostId as string, screenId as string],
      revalidate: SCREEN_DOC_TTL_SECONDS,
      tags: [tenantDataTag(hostId as string)],
      read: () => readScreenDoc(hostId as string, screenId as string),
      // Never store a missing screen, and never store a doc carrying a
      // PENDING publish schedule: `applyDuePublishSchedule` reads
      // `publishSchedule.publishAt.seconds` off a live Timestamp, and the
      // JSON round trip a cache hit implies decays that to `_seconds` —
      // which would make every pending schedule look already due. A pending
      // schedule therefore keeps its doc read fresh until it resolves.
      store: (value) =>
        value !== null &&
        (value as { publishSchedule?: { status?: string } }).publishSchedule
          ?.status !== 'pending',
    })
    if (screen) data.screen = screen
  } catch (error) {
    console.error(error)
    data.error = error
  }

  return data
}

export default getScreen
