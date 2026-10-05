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

import type { PluginRevocation } from '@aglyn/aglyn/server'
import type { PluginRevocationReader } from '@aglyn/aglyn/plugin-manager/plugin-revocations'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'

/**
 * The marketplace's kill switch, read for a plugin that is not this one
 * (`plugin-revocations`, AGL-3080): `revocations/{listingId}`, the document
 * staff write when they pull a listing or one of its versions. The send path
 * asks it before it mails a design that was installed from a listing.
 *
 * A failed read throws through, so the asker refuses rather than guesses.
 */
export const marketplaceRevocationReader: PluginRevocationReader = {
  async revocation(listingId) {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('revocations')
      .doc(listingId)
      .get()
    return snapshot.exists ? ((snapshot.data() ?? null) as PluginRevocation | null) : null
  },
}
