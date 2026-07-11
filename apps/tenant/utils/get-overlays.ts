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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Marketing hub overlays (AGL-251): the host's configured announcement
 * bars and popups from `hosts/{hostId}/overlays`. Fail-open — on error an
 * empty list is returned and the legacy single bar/popup fields apply.
 */
export async function getOverlays(options: {
  hostId: string
}): Promise<Array<Aglyn.HostOverlay & { $id: string }>> {
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(options.hostId)
      .collection('overlays')
      .limit(50)
      .get()
    return snapshot.docs.map((doc) => ({
      $id: doc.id,
      ...(doc.data() as Aglyn.HostOverlay),
    }))
  } catch (error) {
    console.error(error)
    return []
  }
}

export default getOverlays
