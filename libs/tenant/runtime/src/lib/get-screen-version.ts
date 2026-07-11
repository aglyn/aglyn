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
  const firestore = firebaseAdmin.app().firestore()

  // List batch of users, 1000 at a time.
  await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('screens')
    .doc(screenId)
    .collection('versions')
    .withConverter(screenVersionConverter)
    .doc(versionId)
    .get()
    .then((res) => {
      if (!res.exists) return
      data.version = res.data() as Aglyn.AglynScreen
    })
    .catch((error) => {
      console.error(error)
      data.error = error
    })

  return data
}

export default getScreenVersion
