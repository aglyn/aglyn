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
 * Two touches, both on `hosts/{hostId}/leads/{leadId}` — the record system's
 * document, written in the record system's vocabulary (`@aglyn/aglyn`'s lead
 * statuses), never through an import of the CRM plugin:
 *
 *  - a REPLY moves a lead nobody has touched from New to Working. Somebody
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

import { crmLeadStatus } from '@aglyn/aglyn/app-utils/crm'
import type {
  PluginLeadConversionReport,
  PluginLeadConversionRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-lead-conversion'
import { FieldValue } from 'firebase-admin/firestore'
import { outreachOrgCollection } from '../storage/outreach-records'

type Firestore = FirebaseFirestore.Firestore

/** Firestore refuses a batch of more than 500 writes. */
const BATCH_LIMIT = 450

/** A lead nobody has touched, once somebody replied: Working. `true` when it moved. */
export async function markOutreachLeadWorking(
  firestore: Firestore,
  input: { hostId: string; leadId: string },
): Promise<boolean> {
  try {
    const ref = firestore.collection('hosts').doc(input.hostId).collection('leads').doc(input.leadId)
    const snapshot = await ref.get()
    if (!snapshot.exists) return false
    const lead = snapshot.data() ?? {}
    if (lead['convertedContactId'] || crmLeadStatus(lead as never) !== 'new') return false
    await ref.set({ status: 'working', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return true
  } catch (error) {
    console.error('[outreach] the lead could not be marked working', input.hostId, input.leadId, error)
    return false
  }
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
