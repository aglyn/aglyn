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

/**
 * WHAT MAIL DOES TO A LEAD'S STAGE: delivered (AGL-3446), and answered
 * (AGL-3080).
 *
 * A lead nobody has touched, once a campaign email or a sequence step has
 * been delivered to it, moves from New to Nurturing: automated email is
 * reaching it, so the CRM digest must not count it as unworked, but no person
 * has engaged yet. A lead that WROTE BACK — New or Nurturing — moves to
 * Working: somebody answered, the lead is being worked, and a queue that
 * still showed it as New would send a rep to open a conversation already
 * open. A sender reaches both through the record email-state seam's
 * `reached` and `replied` (`stampRecordEmailReach`, `stampRecordEmailReply`),
 * never by importing the CRM.
 *
 * Found by address rather than by audience: a lead's document id IS the
 * `personKey` of its address (`orgs/{orgId}/leads/{personKey}`, AGL-3275),
 * so every audience — the leads, a list, a segment, typed-in addresses, a
 * sequence's enrollment — resolves the people it reached to their lead rows
 * by one batched read, with no query and no index.
 *
 * Only a lead the sending site holds is moved — `visibleTo` names it — so
 * one brand's mail never writes the stage of a lead another brand in the
 * same organization keeps. Only the stages named move; Working, the closed
 * states and a converted lead are left as they stand, so mail never reopens
 * a verdict or moves a contact's record.
 *
 * Never throws: the mail has already gone, and a stage that could not be
 * written is one a rep sets by hand.
 */

import {
  CRM_COLLECTIONS,
  CRM_LEAD_STATUS_PICKLIST,
  type CrmLeadStatus,
  crmLeadStatus,
  crmLeadStatusLabelFor,
  effectiveCrmLeadStatusPicklist,
} from '@aglyn/aglyn/app-utils/crm'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'

/** `getAll` takes this many references per call, and a batch this many writes. */
const CHUNK = 300

/** Move the leads at these addresses that stand in `from` to `to`; how many moved. */
async function advanceLeadsAt(
  firestore: Firestore,
  input: { orgId: string; hostId: string; emails: readonly string[] },
  from: readonly CrmLeadStatus[],
  to: CrmLeadStatus,
): Promise<number> {
  if (!input.orgId || !input.emails.length) return 0
  const keys = [
    ...new Set(input.emails.map((email) => personKey(email)).filter((key): key is string => Boolean(key))),
  ]
  const leads = firestore.collection('orgs').doc(input.orgId).collection('leads')
  /*
   * The org's label for the stage, stamped beside the meaning (AGL-3512) —
   * read once, and only once a lead is due to move. A list that cannot be
   * read stamps the meaning alone, which every reader labels itself.
   */
  let label: string | null | undefined
  const labelFor = async (): Promise<string | null> => {
    if (label !== undefined) return label
    try {
      const list = await firestore
        .collection('orgs')
        .doc(input.orgId)
        .collection(CRM_COLLECTIONS.picklists)
        .doc(CRM_LEAD_STATUS_PICKLIST)
        .get()
      label = crmLeadStatusLabelFor(effectiveCrmLeadStatusPicklist(list.data()), to)
    } catch (error) {
      console.error('[crm] the lead statuses could not be read', input.orgId, error)
      label = null
    }
    return label
  }
  let moved = 0
  for (let start = 0; start < keys.length; start += CHUNK) {
    try {
      const snapshots = await firestore.getAll(...keys.slice(start, start + CHUNK).map((key) => leads.doc(key)))
      const batch = firestore.batch()
      let writes = 0
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue
        const lead = snapshot.data() ?? {}
        if (lead['convertedContactId']) continue
        if (!visibleToHost(lead['visibleTo'] as string[] | undefined, input.hostId)) continue
        if (!from.includes(crmLeadStatus(lead as never))) continue
        const statusLabel = await labelFor()
        batch.set(
          snapshot.ref,
          { status: to, ...(statusLabel ? { statusLabel } : {}), updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        )
        writes += 1
      }
      if (writes) {
        await batch.commit()
        moved += writes
      }
    } catch (error) {
      console.error(`[crm] the leads could not be marked ${to}`, input.orgId, error)
    }
  }
  return moved
}

/** Move the delivered-to leads still New to Nurturing; how many moved. */
export function nurtureReachedLeads(
  firestore: Firestore,
  input: { orgId: string; hostId: string; emails: readonly string[] },
): Promise<number> {
  return advanceLeadsAt(firestore, input, ['new'], 'nurturing')
}

/** Move the leads that wrote back, still New or Nurturing, to Working; how many moved. */
export function workRepliedLeads(
  firestore: Firestore,
  input: { orgId: string; hostId: string; emails: readonly string[] },
): Promise<number> {
  return advanceLeadsAt(firestore, input, ['new', 'nurturing'], 'working')
}
