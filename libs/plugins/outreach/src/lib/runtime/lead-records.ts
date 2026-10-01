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
 * WHAT A SEQUENCE DOES WHEN A LEAD BECOMES A CONTACT (AGL-3234).
 *
 * A CONVERSION re-points every enrollment made on the lead at the contact it
 * became: the record system tells every plugin through its lead-conversion
 * seam, and this is Sequences' share of it. The enrollment keeps its id, its
 * thread and its place in the steps, and keeps naming the lead beside the
 * contact, so both pages list it.
 *
 * What a sequence does to the lead's OWN record — a sent step moving a New
 * lead to Nurturing, a reply moving it to Working — is the record system's
 * to write, and Sequences tells it through the record email-state seam
 * (`stampRecordEmailReach`, `stampRecordEmailReply`, AGL-3080) rather than
 * writing the lead here.
 *
 * Never throws for a missing enrollment: one that could not follow its lead
 * is one the next send stops as `contact_missing` and a rep re-enrolls.
 */

import type {
  PluginLeadConversionReport,
  PluginLeadConversionRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-lead-conversion'
import { outreachOrgCollection } from '../storage/outreach-records'

type Firestore = FirebaseFirestore.Firestore

/** Firestore refuses a batch of more than 500 writes. */
const BATCH_LIMIT = 450

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
