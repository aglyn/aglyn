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

import { FieldValue } from 'firebase-admin/firestore'
import type { PluginSiteBeaconRequest } from '@aglyn/aglyn/plugin-manager/plugin-site-beacons'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { CAMPAIGN_VISIT_REPORTS_COLLECTION } from '../model/campaign-visits'
import {
  campaignForUtmLabel,
  readLiveCampaign,
  readScreenCampaignIds,
} from './campaign-touch-targets'

/**
 * The body field that marks a beacon as a campaign visit. The site runtime
 * sends it; the collector hands the beacon here after its host, lockdown and
 * rate gates.
 */
export const CAMPAIGN_VISIT_BEACON_FIELD = 'campaignVisit'

/** The most campaigns one beacon may name, matching the page touch. */
const MAX_CAMPAIGNS = 5

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/

function idsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids: string[] = []
  for (const entry of raw) {
    const id = typeof entry === 'string' ? entry.trim() : ''
    if (!DOCUMENT_ID.test(id) || ids.includes(id)) continue
    ids.push(id)
    if (ids.length >= MAX_CAMPAIGNS) break
  }
  return ids
}

/**
 * Counts one campaign visit beacon (AGL-3461) into
 * `orgs/{orgId}/campaignVisitReports/{campaignId}`.
 *
 * The body says what the visitor's browser saw — the screen and the
 * campaigns its page was filed under, the `utm_campaign` label on the
 * address, and which of those the device claimed as a FIRST visit — and none
 * of it is believed as sent:
 *
 *  - a page's campaign is counted only while the screen is still filed under
 *    it and the campaign still exists;
 *  - a label is counted only for the one live campaign on the site that
 *    declares it;
 *  - a campaign named by both the page and the label in one beacon is one
 *    visit, and counts once.
 *
 * `views` moves for the page's campaigns only — a label is an arrival, not a
 * view of the campaign's pages. Never throws past the collector, which logs
 * and answers 204 either way.
 */
export async function countCampaignVisitBeacon(
  request: PluginSiteBeaconRequest,
  firestore: any = firebaseAdmin.app().firestore(),
): Promise<number> {
  const { hostId, day, body } = request
  const orgId = await resolveOrgIdForHost(hostId)
  if (!orgId) return 0
  const month = String(day ?? '').slice(0, 7)

  /** Per campaign: whether this pageview viewed its page, and whether it was a first visit. */
  const counted = new Map<string, { view: boolean; first: boolean }>()
  const note = (id: string, view: boolean, first: boolean) => {
    const held = counted.get(id) ?? { view: false, first: false }
    counted.set(id, { view: held.view || view, first: held.first || first })
  }

  const screenId = typeof body['screenId'] === 'string' ? body['screenId'].trim() : ''
  const carried = idsOf(body['campaignIds'])
  const firsts = new Set(idsOf(body['first']))
  if (DOCUMENT_ID.test(screenId) && carried.length) {
    const filed = await readScreenCampaignIds({ hostId, screenId }, firestore)
    for (const id of carried) {
      if (!filed?.includes(id)) continue
      if (!(await readLiveCampaign({ orgId, campaignId: id }, firestore))) continue
      note(id, true, firsts.has(id))
    }
  }

  const label = typeof body['utmCampaign'] === 'string' ? body['utmCampaign'] : ''
  if (label && body['firstLabel'] === true) {
    const campaign = await campaignForUtmLabel({ orgId, hostId, label }, firestore)
    if (campaign) note(campaign.id, false, true)
  }

  const reports = firestore
    .collection('orgs')
    .doc(orgId)
    .collection(CAMPAIGN_VISIT_REPORTS_COLLECTION)
  await Promise.all(
    [...counted.entries()].map(([campaignId, { view, first }]) => {
      const fields: Record<string, unknown> = {
        ...(view ? { views: FieldValue.increment(1) } : {}),
        ...(first ? { firstVisits: FieldValue.increment(1) } : {}),
      }
      if (!Object.keys(fields).length) return Promise.resolve()
      return reports.doc(campaignId).set(
        {
          ...fields,
          ...(/^\d{4}-\d{2}$/.test(month) ? { byMonth: { [month]: fields } } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    }),
  )
  return counted.size
}
