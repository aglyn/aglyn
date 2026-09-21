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

// Its own subpath, never the plugin-manager barrel: what a published page
// does not need, it must not import.
import { registerPluginMediaPublishGuard } from '@aglyn/aglyn/plugin-manager/plugin-media-publish'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  findPaidMediaUses,
  paidMediaPublishRefusal,
  type PaidMediaUsesFirestore,
} from './paid-media-uses'

/**
 * Commerce’s answer to the platform's media-publish question (AGL-3080).
 *
 * The media library used to hold this rule itself, which meant the console
 * knew what a product is, which two of its fields hold paid media, and that a
 * deleted one sells nothing. It asks now, and this is the answer.
 *
 * ⚠️ A ceiling that stopped the scan is a REFUSAL with no blocker to name,
 * never a pass: "we could not check" and "nothing sells this" point opposite
 * ways, and only one of them is safe to publish on. The contract says the
 * same thing about a throw, which is why nothing is caught here.
 */
export function registerCommerceMediaPublishGuard(): void {
  registerPluginMediaPublishGuard(
    {
      check: async (request) => {
        const uses = await findPaidMediaUses({
          firestore: firebaseAdmin.app().firestore() as PaidMediaUsesFirestore,
          base: request.base,
          mediaId: request.mediaId,
          ...(request.bucket ? { bucket: request.bucket } : {}),
        })
        if (uses.complete && !uses.uses.length) return null
        return {
          reason: paidMediaPublishRefusal(uses),
          blockers: uses.uses.map((use) => ({
            label: use.productName,
            refId: use.productId,
            hostId: use.hostId,
          })),
          complete: uses.complete,
        }
      },
    },
    { pluginId: BUNDLE_ID },
  )
}

