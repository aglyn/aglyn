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

import { contactCampaignFieldPath, readCampaignIds } from '@aglyn/aglyn/app-utils/campaign-membership'
import type {
  PluginLeadConversionReport,
  PluginLeadConversionRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-lead-conversion'
import { consentGroupForSite } from '@aglyn/tenant-data-admin/server/organizations'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * WHAT A LEAD'S CAMPAIGNS BECOME WHEN IT CONVERTS (AGL-3254).
 *
 * A lead is filed under a site's campaigns at the top of its own document;
 * a contact holds the same membership inside the site's consent-group
 * facet, because a contact is shared across the org and a campaign is one
 * site's. When the lead becomes a contact, the campaigns go with it — added
 * to what the contact already carries there with `arrayUnion`, never in
 * place of it — so the campaign's page goes on listing the person after
 * they became a contact, and a lead a sequence enrolled under a campaign
 * does not leave the campaign by converting.
 *
 * The CRM's own module, because a lead and a contact are the CRM's records
 * (docs/PACKAGES.md rule 3): it runs as the CRM's share of the platform's
 * lead-conversion seam, which every door that converts a lead — the
 * dialog, the REST API, a sign-up, a purchase — reaches through
 * `handOffLeadRecords`. Never throws: the conversion has happened, and a
 * membership that could not be carried is one the contact's page can pick
 * by hand.
 */
export async function carryLeadCampaignsToContact(
  firestore: FirebaseFirestore.Firestore,
  request: Pick<PluginLeadConversionRequest, 'orgId' | 'hostId' | 'leadId' | 'contactId'>,
): Promise<PluginLeadConversionReport> {
  try {
    const lead = await firestore
      .collection('hosts')
      .doc(request.hostId)
      .collection('leads')
      .doc(request.leadId)
      .get()
    const campaignIds = readCampaignIds(lead.exists ? (lead.data() as Record<string, unknown>) : null)
    if (!campaignIds.length) return { campaigns: 0 }
    const group = await consentGroupForSite(request.hostId)
    await firestore
      .collection('orgs')
      .doc(request.orgId)
      .collection('contacts')
      .doc(request.contactId)
      .update({
        [contactCampaignFieldPath(group.groupId)]: FieldValue.arrayUnion(...campaignIds),
        updatedAt: FieldValue.serverTimestamp(),
      })
    return { campaigns: campaignIds.length }
  } catch (error) {
    console.error('[crm] the lead’s campaigns could not be carried to the contact', request.hostId, request.leadId, error)
    return { campaigns: null }
  }
}
