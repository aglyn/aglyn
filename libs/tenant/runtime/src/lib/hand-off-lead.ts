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
 * WHAT A LEAD HANDS TO THE CONTACT IT BECAME (AGL-3233).
 *
 * Salesforce's convert moves the lead's activities to the contact, so the
 * calls and emails a rep logged while working the lead are the first
 * entries on the contact's timeline rather than history stranded on a
 * frozen record. This is that move, for every door that converts a lead —
 * the dialog, the REST API, and the doors that close a lead on their own
 * when the person signs up or buys — so the two records never disagree
 * about what happened.
 *
 * Three things move, once the lead carries `convertedContactId`:
 *
 *  - every activity filed on the lead gains the contact, and keeps the
 *    lead: the contact's timeline reads it, and the lead's page still does;
 *  - every task filed on the lead gains the contact the same way;
 *  - every plugin with a lead-conversion listener is told — a sequence
 *    enrollment naming the lead re-points itself to the contact.
 *
 * Batched, bounded and never throwing: the conversion has happened, and a
 * timeline that could not be moved is one somebody reads on the lead's
 * page, which still links to the contact. The counts are returned for the
 * caller's own report.
 */

import { CRM_COLLECTIONS, normalizeContactEmail } from '@aglyn/aglyn/server'
import {
  type PluginLeadConversionBy,
  runPluginLeadConversionListeners,
} from '@aglyn/aglyn/plugin-manager/plugin-lead-conversion'
import { FieldValue } from 'firebase-admin/firestore'

/** Firestore refuses a batch of more than 500 writes. */
const BATCH_LIMIT = 450

/** The most rows one hand-off moves — a lead with more has been worked for years. */
const ROWS_LIMIT = 2_000

export interface HandOffLeadRecordsInput {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  hostId: string
  leadId: string
  contactId: string
  email: unknown
  by: PluginLeadConversionBy
}

export interface HandOffLeadRecordsReport {
  activities: number
  tasks: number
  /** Each plugin's own report, or `null` for a listener that threw. */
  plugins: Record<string, Readonly<Record<string, number | boolean | null>> | null>
}

/** Stamp `contactId` onto every row of `collection` that names the lead and not the contact yet. */
async function pointAtContact(
  firestore: FirebaseFirestore.Firestore,
  collection: FirebaseFirestore.CollectionReference,
  leadId: string,
  contactId: string,
): Promise<number> {
  const rows = await collection.where('leadId', '==', leadId).limit(ROWS_LIMIT).get()
  const refs = rows.docs
    .filter((row) => String(row.get('contactId') ?? '') !== contactId)
    .map((row) => row.ref)
  for (let start = 0; start < refs.length; start += BATCH_LIMIT) {
    const batch = firestore.batch()
    for (const ref of refs.slice(start, start + BATCH_LIMIT)) {
      batch.update(ref, { contactId, updatedAt: FieldValue.serverTimestamp() })
    }
    await batch.commit()
  }
  return refs.length
}

export async function handOffLeadRecords(
  input: HandOffLeadRecordsInput,
): Promise<HandOffLeadRecordsReport> {
  const { firestore, orgId, hostId, leadId, contactId, by } = input
  const orgRef = firestore.collection('orgs').doc(orgId)
  const report: HandOffLeadRecordsReport = { activities: 0, tasks: 0, plugins: {} }
  try {
    report.activities = await pointAtContact(
      firestore,
      orgRef.collection(CRM_COLLECTIONS.activities),
      leadId,
      contactId,
    )
  } catch (error) {
    console.error('handOffLeadRecords: activities', hostId, leadId, error)
  }
  try {
    report.tasks = await pointAtContact(
      firestore,
      orgRef.collection(CRM_COLLECTIONS.tasks),
      leadId,
      contactId,
    )
  } catch (error) {
    console.error('handOffLeadRecords: tasks', hostId, leadId, error)
  }
  const email = normalizeContactEmail(input.email)
  if (email) {
    report.plugins = await runPluginLeadConversionListeners({
      orgId,
      hostId,
      leadId,
      contactId,
      email,
      by,
    })
  }
  return report
}

export default handOffLeadRecords
