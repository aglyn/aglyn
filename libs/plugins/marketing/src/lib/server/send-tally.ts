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

import type { PluginSendTallyRequest } from '@aglyn/aglyn/plugin-manager/plugin-send-tallies'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { FieldValue } from 'firebase-admin/firestore'
import { resolveCampaignSendRef } from './campaign-conversion-attribution'

/**
 * One more unsubscribe on a campaign send, told by the plugin that serves the
 * site's unsubscribe link (`plugin-send-tallies`). Never throws.
 *
 * The link carries the site and the send id it was signed over, and nothing
 * else; the send is the organization's (`orgs/{orgId}/campaigns/{sendId}`),
 * or still the site's when the migration has not reached it, and
 * `resolveCampaignSendRef` finds whichever holds it. A send in neither place
 * was discarded — or is not a campaign's — and answers `false`.
 *
 * `update()`, never a merge-set: a merge-set would re-create a send deleted
 * between the resolve and the write as a husk holding one `stats` map, and
 * `update()` refuses a missing document.
 */
export async function countCampaignSendUnsubscribe(request: PluginSendTallyRequest): Promise<boolean> {
  try {
    const firestore = firebaseAdmin.app().firestore()
    const orgId = await resolveOrgIdForHost(request.hostId)
    const sendRef = await resolveCampaignSendRef({
      hostId: request.hostId,
      sendId: request.sendId,
      orgId,
      firestore,
    })
    if (!sendRef) return false
    await sendRef.update({ 'stats.unsubscribes': FieldValue.increment(1) })
    return true
  } catch {
    // The suppression is the write that mattered, and it has landed.
    return false
  }
}
