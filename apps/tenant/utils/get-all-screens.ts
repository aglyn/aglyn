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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

export async function getAllScreens(
  host: Aglyn.HostUid,
  nextPageToken?: string,
) {
  const data: { screens: Record<string, unknown>[]; nextPageToken: string; error: Error | null } = { screens: [], nextPageToken: '', error: null }
  const firestore = firebaseAdmin.app().firestore()

  await firestore
    .collection('hosts')
    .doc(host)
    .collection('screens')
    .where('status', '==', Aglyn.HostScreenStatus.PUBLISHED)
    .limit(5)
    .get()
    .then((screens) => {
      screens.forEach((screen) => {
        data.screens.push(screen.data())
      })
    })
    .catch((error) => {
      console.error(error)
      data.error = error
    })

  return data
}
export default getAllScreens
