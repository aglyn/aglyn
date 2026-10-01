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

import { registerPluginSendTally } from '@aglyn/aglyn/plugin-manager/plugin-send-tallies'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * The send tally the plugin that sends campaigns registers (AGL-3080), stood
 * in for this plugin's specs — this plugin may not load the marketing plugin.
 * It counts what that plugin's `send-tally.ts` counts, over whatever store
 * the spec hands it: the send at the org (`orgs/{orgId}/campaigns/{sendId}`),
 * else at the site for a send the migration has not reached, `update()`d so a
 * send in neither place is never created. What the marketing plugin itself
 * answers is held in its own spec.
 */
export function standInSendTally(options: {
  firestore: () => any
  orgIdForHost: (hostId: string) => Promise<string | null>
}): void {
  registerPluginSendTally(
    {
      async unsubscribed({ hostId, sendId }) {
        const db = options.firestore()
        const orgId = await options.orgIdForHost(hostId)
        // By path: a stand-in names the owner's storage, it does not decide it.
        const refs = [
          ...(orgId ? [db.collection(`orgs/${orgId}/campaigns`).doc(sendId)] : []),
          db.collection(`hosts/${hostId}/campaigns`).doc(sendId),
        ]
        for (const ref of refs) {
          if (!(await ref.get()).exists) continue
          await ref.update({ 'stats.unsubscribes': FieldValue.increment(1) })
          return true
        }
        return false
      },
    },
    { pluginId: 'marketing' },
  )
}
