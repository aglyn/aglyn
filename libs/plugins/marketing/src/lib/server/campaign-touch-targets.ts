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
  EMAIL_CAMPAIGNS_COLLECTION,
  campaignPlacedOnHost,
  normalizeCampaignUtmLabel,
  type EmailCampaign,
} from '../model/campaign-container'
import { readContainerIds } from '@aglyn/aglyn/app-utils/container-membership'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import { CAMPAIGN_KIND } from '../model/campaign-kind'

/**
 * WHAT A VISITOR'S TOUCH NAMES, CHECKED AGAINST WHAT IS STORED (AGL-3461).
 *
 * Two touches name a campaign DOCUMENT without a click on its mail: a page
 * the visitor viewed that is filed under a campaign, and a `utm_campaign`
 * label a campaign declares as its own. Both arrive from the visitor's
 * browser, so neither is trusted as sent:
 *
 *  - a page touch credits a campaign only while the campaign exists and the
 *    page is still filed under it — one screen read and one campaign read;
 *  - a label credits a campaign only when exactly one live campaign placed
 *    on the site declares it — one `array-contains` query on the org's
 *    campaigns, served by the automatic single-field index. A label two
 *    campaigns claim credits neither, rather than whichever the index
 *    happens to return first.
 *
 * The conversion join (`campaign-conversion-attribution.ts`) asks at an
 * identify moment and the first-visit beacon (`campaign-visit-beacon.ts`) on
 * a pageview. Each answer is memoized for a minute per Firestore instance —
 * the beacon is per pageview and a landing page's visitors all ask the same
 * question — so a campaign deleted or a page refiled is believed within the
 * minute, which is the staleness the site collector's own caches accept.
 *
 * Never throws: a lookup that fails answers "names nothing", and the touch is
 * then treated as the label or the page it is, credited to no document.
 */

/** How long one answer is believed, per Firestore instance. */
const MEMO_MS = 60_000

/** Size cap on each memo; cleared wholesale like every visitor-keyed map. */
const MEMO_MAX = 2_000

type Memo = Map<string, { value: unknown; at: number }>

const memos = new WeakMap<object, Memo>()

function memoFor(firestore: object): Memo {
  let memo = memos.get(firestore)
  if (!memo) {
    memo = new Map()
    memos.set(firestore, memo)
  }
  return memo
}

async function remembered<T>(
  firestore: object,
  key: string,
  read: () => Promise<T>,
): Promise<T> {
  const memo = memoFor(firestore)
  const hit = memo.get(key)
  const now = Date.now()
  if (hit && now - hit.at < MEMO_MS) return hit.value as T
  const value = await read()
  if (memo.size > MEMO_MAX) memo.clear()
  memo.set(key, { value, at: now })
  return value
}

/** A campaign container, as much of it as a touch's credit needs. */
export interface LiveCampaign {
  id: string
  name: string
}

/**
 * The campaign at `orgs/{orgId}/emailCampaigns/{campaignId}`, or `null` when
 * it does not exist or its owner retired it.
 */
export async function readLiveCampaign(
  options: { orgId: string; campaignId: string },
  firestore: any,
): Promise<LiveCampaign | null> {
  const { orgId, campaignId } = options
  if (!isDocumentId(orgId) || !isDocumentId(campaignId)) return null
  try {
    return await remembered(firestore, `campaign:${orgId}:${campaignId}`, async () => {
      const snapshot = await firestore
        .collection('orgs')
        .doc(orgId)
        .collection(EMAIL_CAMPAIGNS_COLLECTION)
        .doc(campaignId)
        .get()
      if (!snapshot.exists) return null
      const data = (snapshot.data() ?? {}) as Partial<EmailCampaign>
      if (data.deletedAt) return null
      return { id: campaignId, name: String(data.name ?? '').trim() || campaignId }
    })
  } catch (error) {
    console.error('[campaign-touch] campaign read failed', error)
    return null
  }
}

/**
 * The campaigns a site's screen is filed under right now, or `null` when the
 * screen does not exist.
 */
export async function readScreenCampaignIds(
  options: { hostId: string; screenId: string },
  firestore: any,
): Promise<string[] | null> {
  const { hostId, screenId } = options
  if (!isDocumentId(hostId) || !isDocumentId(screenId)) return null
  try {
    return await remembered(firestore, `screen:${hostId}:${screenId}`, async () => {
      const snapshot = await firestore
        .collection('hosts')
        .doc(hostId)
        .collection('screens')
        .doc(screenId)
        .get()
      if (!snapshot.exists) return null
      return readContainerIds(
        (snapshot.data() ?? {}) as Record<string, unknown>,
        CAMPAIGN_KIND,
      )
    })
  } catch (error) {
    console.error('[campaign-touch] screen read failed', error)
    return null
  }
}

/**
 * Of the campaigns a page touch carries, the first that the page is STILL
 * filed under and that still exists — or `null`.
 *
 * The touch carries the screen's campaigns in the screen's own order, so a
 * page filed under two campaigns credits the one it names first. One
 * outcome, one campaign: crediting both would count one visitor's form twice
 * across the org's campaigns.
 */
export async function filedCampaignForPage(
  options: {
    orgId: string
    hostId: string
    screenId: string
    campaignIds: readonly string[]
  },
  firestore: any,
): Promise<LiveCampaign | null> {
  const filed = await readScreenCampaignIds(options, firestore)
  if (!filed?.length) return null
  for (const campaignId of options.campaignIds) {
    if (!filed.includes(campaignId)) continue
    const campaign = await readLiveCampaign(
      { orgId: options.orgId, campaignId },
      firestore,
    )
    if (campaign) return campaign
  }
  return null
}

/**
 * The one live campaign placed on this site that declares `label` among its
 * `utmCampaigns`, or `null` — for no such campaign, and for two.
 */
export async function campaignForUtmLabel(
  options: { orgId: string; hostId: string; label: string | null | undefined },
  firestore: any,
): Promise<LiveCampaign | null> {
  const { orgId, hostId } = options
  const label = normalizeCampaignUtmLabel(options.label)
  if (!label || !isDocumentId(orgId)) return null
  try {
    return await remembered(firestore, `label:${orgId}:${hostId}:${label}`, async () => {
      const snapshot = await firestore
        .collection('orgs')
        .doc(orgId)
        .collection(EMAIL_CAMPAIGNS_COLLECTION)
        .where('utmCampaigns', 'array-contains', label)
        .limit(5)
        .get()
      const matches = (snapshot.docs ?? [])
        .map((doc: any) => ({ id: String(doc.id), data: (doc.data() ?? {}) as Partial<EmailCampaign> }))
        .filter(({ data }: { data: Partial<EmailCampaign> }) => !data.deletedAt)
        .filter(({ data }: { data: Partial<EmailCampaign> }) => campaignPlacedOnHost(data, hostId))
      if (matches.length !== 1) return null
      const [match] = matches
      return { id: match.id, name: String(match.data.name ?? '').trim() || match.id }
    })
  } catch (error) {
    console.error('[campaign-touch] label lookup failed', error)
    return null
  }
}
