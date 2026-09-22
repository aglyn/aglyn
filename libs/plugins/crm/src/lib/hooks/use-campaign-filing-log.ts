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
'use client'

import {
  CRM_COLLECTIONS,
  consentGroupForHost,
  createResourceUid,
  crmScopeTokens,
  type CrmActivityLink,
} from '@aglyn/aglyn'
import { useFirestore, useUser, useUserName } from '@aglyn/tenant-feature-instance'
import { collection, doc, setDoc } from 'firebase/firestore'
import { useCallback } from 'react'
import {
  buildCampaignFilingActivity,
  type CampaignFilingRef,
} from '../model/campaign-filing-activity'

/** What one surface's save changed, by campaign, with the names it showed. */
export interface CampaignFilingChange {
  filed?: readonly CampaignFilingRef[]
  removed?: readonly CampaignFilingRef[]
}

/**
 * FILES A MEMBER'S FILING ON THE RECORD'S TIMELINE (AGL-3274), from the
 * console.
 *
 * The lead's Campaigns card and the Leads list's bulk bar write the
 * membership client-direct — a one-field update the rules already admit —
 * so the entry that records it is written the same way, into the org's
 * activity collection the log dialog writes, with the scope a record made
 * on this site carries (`crmScopeTokens`), the signed-in member as author,
 * and the CRM's own id as the filing plugin.
 *
 * Bookkeeping beside the act: the membership has landed by the time this
 * runs, so a write that fails is logged and the filing stands — the card
 * shows the campaigns from the document, not from the timeline.
 */
export function useCampaignFilingLog(input: {
  orgId: string | null | undefined
  /** The site the entry carries as provenance: the lead's, or the contact's viewing site. */
  hostId: string | null | undefined
  org: Record<string, unknown> | null | undefined
}) {
  const { orgId, hostId, org } = input
  const firestore = useFirestore()
  const { data: user } = useUser()
  const authorName = useUserName()
  const uid = user?.uid

  return useCallback(
    async (link: CrmActivityLink, change: CampaignFilingChange): Promise<void> => {
      if (!orgId || !hostId || !uid) return
      const entries = [
        ...(change.filed ?? []).map((campaign) => ({ action: 'filed' as const, campaign })),
        ...(change.removed ?? []).map((campaign) => ({ action: 'removed' as const, campaign })),
      ]
      if (!entries.length) return
      const visibleTo = crmScopeTokens(org, consentGroupForHost(org, hostId))
      const atMs = Date.now()
      const activities = collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.activities)
      for (const entry of entries) {
        try {
          // Named by the platform's own id, as every console resource is.
          await setDoc(doc(activities, createResourceUid()), {
            ...buildCampaignFilingActivity({
              action: entry.action,
              campaign: entry.campaign,
              link,
              hostId,
              visibleTo,
              atMs,
              byUid: uid,
              byName: authorName || null,
            }),
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        } catch (error) {
          console.error('[crm] the filing could not be written on the timeline', error)
        }
      }
    },
    [firestore, orgId, hostId, org, uid, authorName],
  )
}

export default useCampaignFilingLog
