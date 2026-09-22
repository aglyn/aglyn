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

import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import {
  CRM_COLLECTIONS,
  crmActivityLogHasRoom,
  crmScopeTokens,
  type CrmActivityLink,
} from '@aglyn/aglyn/app-utils/crm'
import { countCrmActivitiesForRecord } from '@aglyn/tenant-data-admin/server/crm-records'
import { createHash } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  buildCampaignFilingActivity,
  type CampaignFilingAction,
  type CampaignFilingRef,
} from '../model/campaign-filing-activity'

/**
 * FILES A FILING ON THE RECORD'S TIMELINE (AGL-3274), from the server.
 *
 * The two doors that file a lead under a campaign on the server — the
 * `leads-create` route behind the New lead drawer, and the conversion's
 * carry of a lead's campaigns onto the contact — write the entry through
 * this, with the scope a record made on the site carries and the CRM's
 * own id as the filing plugin, exactly as the console's hook writes one.
 *
 * ## Once, when the caller says so
 *
 * A member's act is an act each time, and the route's entries are added
 * with fresh ids. The conversion carry runs from a seam every converting
 * door reaches, and a door that runs twice must not file twice — so a
 * caller that hands in a `dedupeKey` gets a keyed `create()`, and the
 * second run finds its own entry and writes nothing. The key is hashed
 * under the CRM's id the way the timeline seam hashes a plugin's, so no
 * caller's raw key becomes a document id.
 *
 * ## Never throws
 *
 * The membership has landed by the time this runs; an entry that could
 * not be filed is logged, and the record's page shows the campaigns from
 * the document either way. A record at its activity ceiling is refused
 * before anything is written, in the same breath.
 */

type Firestore = FirebaseFirestore.Firestore

export interface CampaignFilingActivitiesInput {
  orgId: string
  /**
   * The organization document, when the caller already holds it — the
   * scope tokens read `defaultResourceScope` and the consent groups off
   * it. Read here otherwise.
   */
  org?: Record<string, unknown> | null
  /** The site the entry carries as provenance. */
  hostId: string
  link: CrmActivityLink
  action: CampaignFilingAction
  campaigns: readonly CampaignFilingRef[]
  atMs: number
  /** The member who did it, or `''` for the conversion. */
  byUid: string
  byName?: string | null
  /**
   * A key that files each campaign's entry once across runs — the carry's
   * — or nothing for a member's act, which is new each time.
   */
  dedupeKey?: string | null
}

/** The document id a keyed entry files under: the CRM's namespace, never a raw key. */
export function campaignFilingActivityId(key: string): string {
  return `plg_${createHash('sha256').update(`${BUNDLE_ID}:${key}`).digest('hex').slice(0, 28)}`
}

/** gRPC `ALREADY_EXISTS`, which `create()` rejects with when the document is there. */
const ALREADY_EXISTS = 6

/**
 * The names of a site's campaigns, by id, for the entries that name them.
 * A container that is gone answers its id, so the entry still says which.
 */
export async function siteCampaignRefs(
  firestore: Firestore,
  hostId: string,
  campaignIds: readonly string[],
): Promise<CampaignFilingRef[]> {
  if (!campaignIds.length) return []
  const containers = firestore.collection('hosts').doc(hostId).collection('emailCampaigns')
  const found = await firestore.getAll(...campaignIds.map((id) => containers.doc(id)))
  return campaignIds.map((id, index) => ({
    id,
    name: String(found[index]?.get('name') ?? '').trim() || id,
  }))
}

/** Files one entry per campaign; answers how many were written. */
export async function fileCampaignFilingActivities(
  firestore: Firestore,
  input: CampaignFilingActivitiesInput,
): Promise<number> {
  if (!input.campaigns.length) return 0
  try {
    const orgRef = firestore.collection('orgs').doc(input.orgId)
    const org =
      input.org ?? ((await orgRef.get()).data() as Record<string, unknown> | undefined) ?? null
    const visibleTo = crmScopeTokens(org, consentGroupForHost(org, input.hostId))
    if (!crmActivityLogHasRoom(await countCrmActivitiesForRecord(orgRef, input.link))) {
      console.warn('[crm] the filing was not written on the timeline: the record’s log is full', input.link)
      return 0
    }
    const activities = orgRef.collection(CRM_COLLECTIONS.activities)
    let written = 0
    for (const campaign of input.campaigns) {
      const entry = {
        ...buildCampaignFilingActivity({
          action: input.action,
          campaign,
          link: input.link,
          hostId: input.hostId,
          visibleTo,
          atMs: input.atMs,
          byUid: input.byUid,
          byName: input.byName ?? null,
        }),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (input.dedupeKey) {
        try {
          await activities.doc(campaignFilingActivityId(`${input.dedupeKey}:${campaign.id}`)).create(entry)
          written += 1
        } catch (error) {
          if ((error as { code?: unknown })?.code !== ALREADY_EXISTS) throw error
        }
      } else {
        await activities.add(entry)
        written += 1
      }
    }
    return written
  } catch (error) {
    console.error('[crm] the filing could not be written on the timeline', input.link, error)
    return 0
  }
}
