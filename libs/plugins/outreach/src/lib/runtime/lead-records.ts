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
 * WHAT A SEQUENCE DOES TO A LEAD'S OWN RECORD (AGL-3234).
 *
 * Three touches, all on `orgs/{orgId}/leads/{leadId}` — the record system's
 * document, written in the record system's vocabulary (`@aglyn/aglyn`'s lead
 * statuses), never through an import of the CRM plugin:
 *
 *  - a SENT STEP moves a lead nobody has touched from New to Nurturing.
 *    Automated email is reaching it, so it is not untouched — the digest's
 *    unworked list would otherwise name every lead a sequence is working —
 *    but no person has engaged yet. Only a send moves it, never the
 *    enrollment: a step that never goes out has reached nobody.
 *  - a REPLY moves a lead that is New or Nurturing to Working. Somebody
 *    wrote back; the lead is being worked, and a queue that still showed it
 *    as New would send a rep to open a conversation already open. A lead
 *    already Working, closed, or converted is left as it is — a reply does
 *    not reopen a verdict or move a contact's record.
 *  - a CONVERSION re-points every enrollment made on the lead at the contact
 *    it became: the record system tells every plugin through its
 *    lead-conversion seam, and this is Sequences' share of it. The
 *    enrollment keeps its id, its thread and its place in the steps, and
 *    keeps naming the lead beside the contact, so both pages list it.
 *
 * Neither throws: a status that could not be moved is one a rep moves by
 * hand, and an enrollment that could not follow its lead is one the next
 * send stops as `contact_missing` and a rep re-enrolls.
 */

import { type CrmLeadStatus, crmLeadStatus } from '@aglyn/aglyn/app-utils/crm'
import type {
  PluginLeadConversionReport,
  PluginLeadConversionRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-lead-conversion'
import { FieldValue } from 'firebase-admin/firestore'
import { outreachOrgCollection } from '../storage/outreach-records'

type Firestore = FirebaseFirestore.Firestore

/** Firestore refuses a batch of more than 500 writes. */
const BATCH_LIMIT = 450

/**
 * Move a lead forward to `to` when it stands in one of `from`; `true` when
 * it moved. A converted lead is a contact's history and never moves.
 */
async function advanceOutreachLead(
  firestore: Firestore,
  input: { orgId: string; leadId: string },
  from: readonly CrmLeadStatus[],
  to: CrmLeadStatus,
): Promise<boolean> {
  try {
    // A lead is one org row (AGL-3275), so the site no longer names it.
    const ref = firestore.collection('orgs').doc(input.orgId).collection('leads').doc(input.leadId)
    const snapshot = await ref.get()
    if (!snapshot.exists) return false
    const lead = snapshot.data() ?? {}
    if (lead['convertedContactId'] || !from.includes(crmLeadStatus(lead as never))) return false
    await ref.set({ status: to, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return true
  } catch (error) {
    console.error(`[outreach] the lead could not be marked ${to}`, input.orgId, input.leadId, error)
    return false
  }
}

/** A lead nobody has touched, once a step was sent to it: Nurturing. `true` when it moved. */
export function markOutreachLeadNurturing(
  firestore: Firestore,
  input: { orgId: string; leadId: string },
): Promise<boolean> {
  return advanceOutreachLead(firestore, input, ['new'], 'nurturing')
}

/** A lead no person has engaged, once somebody replied: Working. `true` when it moved. */
export function markOutreachLeadWorking(
  firestore: Firestore,
  input: { orgId: string; leadId: string },
): Promise<boolean> {
  return advanceOutreachLead(firestore, input, ['new', 'nurturing'], 'working')
}

/** Every enrollment made on the lead now names the contact it became. */
export async function followOutreachLeadToContact(
  firestore: Firestore,
  input: Pick<PluginLeadConversionRequest, 'orgId' | 'leadId' | 'contactId'>,
): Promise<PluginLeadConversionReport> {
  const enrollments = outreachOrgCollection(firestore, input.orgId, 'enrollments')
  const rows = await enrollments.where('leadId', '==', input.leadId).get()
  const refs = rows.docs
    .filter((row) => row.get('target') !== 'contact' || String(row.get('contactId') ?? '') !== input.contactId)
    .map((row) => row.ref)
  for (let start = 0; start < refs.length; start += BATCH_LIMIT) {
    const batch = firestore.batch()
    for (const ref of refs.slice(start, start + BATCH_LIMIT)) {
      batch.update(ref, { target: 'contact', contactId: input.contactId, updatedAtMs: Date.now() })
    }
    await batch.commit()
  }
  return { enrollments: refs.length }
}
