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

import {
  registerPluginRecordFactsReader,
  type PluginRecordFactsReader,
} from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import {
  campaignSendTimeLabel,
  suggestCampaignSendTime,
} from '../model/campaign-send-time'
import { orgCampaignSends } from './campaign-org-refs'

type Firestore = FirebaseFirestore.Firestore

/**
 * WHEN A LIST READS ITS MAIL, for a plugin that does not keep the sends.
 *
 * The send-time rule (`model/campaign-send-time.ts`) needs a list's past
 * sends, and the sends are this plugin's: `orgs/{orgId}/campaigns`, one
 * document per send. Another plugin that wants to say when a list is best
 * mailed — the AI plugin, drafting a campaign from a brief — asks here by the
 * list's id through the core's record-facts seam, and never reads the sends
 * itself.
 *
 * ## What leaves this plugin
 *
 * The suggested slot and how many sends it was chosen among. No send, no
 * subject, no recipient and no count of one: an aggregate every member of the
 * site may see on its campaign reports, so the reader applies no rule beyond
 * the site it is asked on.
 *
 * ## One site's history
 *
 * Sends belong to the organization, and so does a list, so the org's sends to
 * the list are narrowed to the ones sent AS the site asked about: another
 * site's audience opening at another hour is not this site's history. Three
 * equality filters, which Firestore serves by merging single-field indexes —
 * no composite index.
 *
 * Facts, in this shape:
 *
 *  - `label`: the slot as a person reads it ("Tuesdays around 9 AM (UTC)"),
 *    or `null` with too little history to suggest one;
 *  - `measured`: the sends the slot was chosen among (0 when none).
 */

/** The resource another plugin asks for, with a list's id. */
export const LIST_SEND_TIME_FACTS_RESOURCE = 'listSendTime'

/** The most past sends the rule reads for one list on one site. */
export const LIST_SEND_TIME_HISTORY_SCAN = 50

const MARKETING_PLUGIN_ID = 'marketing'

const millisOf = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  const toMillis = (value as { toMillis?: () => number } | null)?.toMillis
  return typeof toMillis === 'function' ? toMillis.call(value) : 0
}

export function createListSendTimeFactsReader(
  firestore: () => Firestore,
): PluginRecordFactsReader {
  return {
    async read(request) {
      const listId = String(request.id ?? '').trim()
      if (!request.hostId) {
        return { ok: false, status: 400, error: 'A send time is read for one site.' }
      }
      if (!request.orgId || !listId) {
        return { ok: false, status: 404, error: 'That list has no send history here.' }
      }
      const snapshot = await orgCampaignSends(firestore(), request.orgId)
        .where('hostId', '==', request.hostId)
        .where('listId', '==', listId)
        .where('status', '==', 'sent')
        .select('sentAt', 'stats.delivered', 'stats.uniqueOpens')
        .limit(LIST_SEND_TIME_HISTORY_SCAN)
        .get()
      const suggestion = suggestCampaignSendTime(
        snapshot.docs.map((doc) => ({
          sentAtMs: millisOf(doc.get('sentAt')),
          delivered: Number(doc.get('stats.delivered') ?? 0),
          uniqueOpens: Number(doc.get('stats.uniqueOpens') ?? 0),
        })),
      )
      return {
        ok: true,
        facts: suggestion
          ? { label: campaignSendTimeLabel(suggestion), measured: suggestion.measured }
          : { label: null, measured: 0 },
      }
    },
  }
}

/**
 * Registers the reader; the console surface calls it, the one process that
 * runs AI jobs (AGL-3026). Idempotent: a second call replaces the first.
 */
export function registerListSendTimeFacts(firestore: () => Firestore): void {
  registerPluginRecordFactsReader(
    LIST_SEND_TIME_FACTS_RESOURCE,
    createListSendTimeFactsReader(firestore),
    { pluginId: MARKETING_PLUGIN_ID },
  )
}
