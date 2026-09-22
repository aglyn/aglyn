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

import { CAMPAIGN_MEMBERSHIP_FIELD } from '@aglyn/aglyn/app-utils/campaign-membership'
import type {
  PluginMembershipDetacher,
  PluginMembershipDetachReport,
} from '@aglyn/aglyn/plugin-manager/plugin-membership-detach'
import { FieldValue } from 'firebase-admin/firestore'
import { outreachOrgCollection } from '../storage/outreach-records'

/**
 * OUTREACH'S SHARE OF A CAMPAIGN DELETION (AGL-3254).
 *
 * A sequence and its enrollments name the campaigns they are in from their
 * own documents, under the organization, in collections the core does not
 * name — so the marketing plugin's deletion cannot reach them and asks
 * every plugin's membership detacher instead. This one clears the campaign
 * id out of every sequence and every enrollment of the org still carrying
 * it, with the same walk the owner makes over its forms: `array-contains`
 * on the automatic single-field index, `arrayRemove` of the one id, in
 * pages under Firestore's batch limit, bounded per request and reporting
 * `remaining` so the deletion holds the container for a second run.
 *
 * Only the campaign membership field is Outreach's to clear: a request
 * about any other container's field answers nothing detached, because the
 * sequences carry no such field. The records themselves stay, and so do
 * the campaign's credits: what a sequence produced for a campaign that is
 * gone is in a report document nobody reads any more, which is the
 * conversions rollup's own fate.
 */

/** Members detached in one write, under the 500-operation batch limit. */
const DETACH_BATCH = 400

/** How many pages one request walks per collection. */
const DETACH_PASSES = 25

async function detachFrom(
  collection: FirebaseFirestore.CollectionReference,
  campaignId: string,
): Promise<PluginMembershipDetachReport> {
  const firestore = collection.firestore
  let detached = 0
  for (let pass = 0; pass < DETACH_PASSES; pass += 1) {
    const page = await collection.where(CAMPAIGN_MEMBERSHIP_FIELD, 'array-contains', campaignId).limit(DETACH_BATCH).get()
    if (page.empty) return { detached, remaining: false }
    const batch = firestore.batch()
    for (const member of page.docs) {
      batch.update(member.ref, { [CAMPAIGN_MEMBERSHIP_FIELD]: FieldValue.arrayRemove(campaignId) })
    }
    await batch.commit()
    detached += page.size
    if (page.size < DETACH_BATCH) return { detached, remaining: false }
  }
  return { detached, remaining: true }
}

/** The detacher, on the Firestore it is handed. */
export function createOutreachCampaignDetacher(deps: {
  firestore(): FirebaseFirestore.Firestore
}): PluginMembershipDetacher {
  return async ({ orgId, field, id }) => {
    // A site with no organization holds no sequences, and a container held
    // in any other field is not one a sequence joins: nothing to detach.
    if (!orgId || field !== CAMPAIGN_MEMBERSHIP_FIELD) return { detached: 0, remaining: false }
    const firestore = deps.firestore()
    const sequences = await detachFrom(outreachOrgCollection(firestore, orgId, 'sequences'), id)
    const enrollments = await detachFrom(outreachOrgCollection(firestore, orgId, 'enrollments'), id)
    return {
      detached: sequences.detached + enrollments.detached,
      remaining: sequences.remaining || enrollments.remaining,
    }
  }
}
