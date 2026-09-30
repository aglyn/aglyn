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
import { registerPluginRecordFactsReader } from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { AI_LIST_SEND_TIME_RESOURCE } from '../jobs/ai-email-bindings'

/**
 * A list's send time, as the plugin that keeps a site's sends answers it
 * (AGL-3080), stood in over a spec's own Firestore double — this plugin may
 * not load the marketing plugin that registers the real reader. It answers in
 * the shape that reader documents, `{ label, measured }`, from the sends to
 * the list AS the site asked about. Which slot the real rule picks, and why,
 * is held in the marketing plugin's own spec; this answers the slot of the
 * first measurable send, with three of them the least it suggests from.
 */

const OWNER = 'stand-in-send-history'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const millisOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : typeof value === 'number' ? value : 0

/** Registers the reader, reading through `firestore`. */
export function standInListSendTime(firestore: FirebaseFirestore.Firestore): void {
  registerPluginRecordFactsReader(
    AI_LIST_SEND_TIME_RESOURCE,
    {
      async read({ orgId, hostId, id }) {
        if (!hostId) return { ok: false, status: 400, error: 'A send time is read for one site.' }
        const snapshot = await firestore
          .collection('orgs')
          .doc(orgId)
          .collection('campaigns')
          .where('hostId', '==', hostId)
          .where('listId', '==', id)
          .where('status', '==', 'sent')
          .get()
        const measured = snapshot.docs.filter((doc) => Number(doc.get('stats.delivered') ?? 0) >= 20)
        if (measured.length < 3) return { ok: true, facts: { label: null, measured: 0 } }
        const at = new Date(millisOf(measured[0].get('sentAt')))
        const hour = at.getUTCHours()
        const label = `${WEEKDAYS[at.getUTCDay()]}s around ${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'} (UTC)`
        return { ok: true, facts: { label, measured: measured.length } }
      },
    },
    { pluginId: OWNER },
  )
}

/** Forgets it, so the next spec starts with nothing keeping sends. */
export function removeStandInListSendTime(): void {
  unregisterPluginServices(OWNER)
}
