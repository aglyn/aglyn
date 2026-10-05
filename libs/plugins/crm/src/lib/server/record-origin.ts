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

import type {
  PluginRecordOriginReport,
  PluginRecordOriginRequest,
  PluginRecordOriginWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-record-origin'
import {
  consentGroupForHost,
  CONTACT_FACETS_FIELD,
  contactFacetPath,
  crmLeadSourceForOrigin,
  crmPicklistKey,
  normalizeContactEmail,
  personKey,
} from '@aglyn/aglyn/server'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  findContactByEmail,
  firebaseAdmin,
  getOrgForHost,
  restampCrmListFieldsAt,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { readLeadSourcePicklist } from './lead-source-picklist'

/*==========================================
 * A PERSON'S ORIGIN, AS A LEAD SOURCE (AGL-3519).
 *
 * The CRM's side of the platform's record-origin seam, and what its own
 * capture door calls after filing a person: a door's word for how it met
 * somebody — a form, a booking, a sequence — becomes the Lead source its
 * built-in value names (`CRM_LEAD_SOURCE_ORIGINS`), as the org spells it.
 *
 *  - ORIGINAL SOURCE. A record that already names a lead source keeps it;
 *    only an empty one is stamped, and a person the org cleared stays clear
 *    to every door that meets them again (`firstTouchOnly`).
 *  - A DEACTIVATED value stamps nothing: the org has said not to file
 *    people under it.
 *  - Both records the address is, as the site sees them: the lead, when the
 *    site may see it, and the site's own facet on the contact — a holder's
 *    knowledge of the person, like the rest of its profile.
 *
 * Each stamp is a transaction that reads the field and writes only into an
 * empty one, so a rep's pick made a moment earlier is never overwritten;
 * the list fields follow (`leadSourceKey`, `facetKeys`).
 *=========================================*/

type Firestore = FirebaseFirestore.Firestore

/** Where one stamp lands, for a caller that already holds the org. */
export interface CrmRecordOriginInput extends PluginRecordOriginRequest {
  org?: Record<string, unknown> | null
}

/** Stamps the origin on the lead and the site's contact facet the address is; how many took it. */
export async function stampCrmRecordOrigin(
  input: CrmRecordOriginInput,
  firestore: Firestore = firebaseAdmin.app().firestore(),
): Promise<PluginRecordOriginReport> {
  const email = normalizeContactEmail(input.email)
  const key = email ? personKey(email) : null
  if (!email || !key || !input.hostId) return { records: 0 }
  let orgId = input.orgId
  let org = input.org ?? null
  if (!orgId || !org) {
    const resolved = await getOrgForHost(input.hostId)
    if (!resolved || (orgId && resolved.orgId !== orgId)) return { records: 0 }
    orgId = resolved.orgId
    org = resolved.org as Record<string, unknown>
  }
  const label = crmLeadSourceForOrigin(await readLeadSourcePicklist(firestore, orgId), input.origin)
  if (!label) return { records: 0 }
  const orgRef = firestore.collection('orgs').doc(orgId)
  let records = 0

  /* THE LEAD, keyed on the person and seen by the site. */
  const leadRef = orgRef.collection('leads').doc(key)
  const leadStamped = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(leadRef)
    if (!snapshot.exists) return false
    const lead = snapshot.data() ?? {}
    if (!visibleToHost(lead['visibleTo'] as string[] | undefined, input.hostId)) return false
    if (typeof lead['leadSource'] === 'string' && lead['leadSource'].trim()) return false
    if (input.firstTouchOnly && Number(lead['submissionCount'] ?? 1) > 1) return false
    tx.update(leadRef, {
      leadSource: label,
      leadSourceKey: crmPicklistKey(label),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return true
  })
  if (leadStamped) {
    records += 1
    await restampCrmListFieldsAt(leadRef, 'leads')
  }

  /* THE CONTACT, on the site's own facet — present only once the site holds the person. */
  const found = await findContactByEmail(orgRef.collection('contacts'), email)
  if (found) {
    const groupId = consentGroupForHost(org, input.hostId).groupId
    const contactStamped = await firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(found.ref)
      const facets = (snapshot.data() ?? {})[CONTACT_FACETS_FIELD] as Record<string, unknown> | undefined
      const facet = facets?.[groupId] as Record<string, unknown> | undefined
      if (!facet || typeof facet !== 'object') return false
      if (typeof facet['leadSource'] === 'string' && facet['leadSource'].trim()) return false
      const interactions = Array.isArray(facet['interactions']) ? facet['interactions'].length : 0
      if (input.firstTouchOnly && interactions > 1) return false
      tx.update(found.ref, {
        [contactFacetPath(groupId, 'leadSource')]: label,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return true
    })
    if (contactStamped) {
      records += 1
      await restampCrmListFieldsAt(found.ref, 'contacts')
    }
  }
  return { records }
}

/** The writer the CRM registers on the platform's record-origin seam. Never throws. */
export const crmRecordOriginWriter: PluginRecordOriginWriter = {
  async stamp(request) {
    try {
      return await stampCrmRecordOrigin(request)
    } catch (error) {
      console.error('[crm] the lead source could not be stamped', request.hostId, error)
      return { records: 0 }
    }
  },
}
