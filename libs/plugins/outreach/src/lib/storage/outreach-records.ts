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
 * Where the org-scoped Outreach documents live, as the server reaches them
 * (AGL-2980). Server only — the references are the Admin SDK's. Each
 * document reads back into its model shape through `model/stored-records`,
 * re-exported here for the routes.
 */

import type { OutreachPersonRef } from '../model/outreach-api'
import {
  OUTREACH_COLLECTIONS,
  type OutreachEnrollment,
  type OutreachOrgCollection,
} from '../model/outreach.types'

export {
  readStoredOutreachEnrollment,
  readStoredOutreachMailbox,
  readStoredOutreachSequence,
} from '../model/stored-records'

/** `orgs/{orgId}/<collection>` for one of Outreach's org-scoped collections. */
export function outreachOrgCollection(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  collection: OutreachOrgCollection,
): FirebaseFirestore.CollectionReference {
  return firestore.collection('orgs').doc(orgId).collection(OUTREACH_COLLECTIONS[collection])
}

/**
 * The id of one person's enrollment in one sequence. Deterministic, so a
 * person is enrolled in a sequence once, ever: a second enroll finds the
 * first document where a random id would have made a second, and a second
 * run through the same emails is exactly what must not happen.
 *
 * `personId` is the contact's document id, or the lead's person key for an
 * enrollment made on a lead (AGL-3234). A lead that converts keeps its
 * enrollment under the key it was enrolled by; the enroll routes also
 * refuse a second enrollment of the same ADDRESS in one sequence, which is
 * what keeps the converted contact from being enrolled beside its lead.
 */
export function outreachEnrollmentId(sequenceId: string, personId: string): string {
  return `${sequenceId}_${personId}`
}

/** The record an enrollment names (AGL-3234): the lead while it targets one, the contact otherwise. */
export function outreachEnrollmentPerson(
  enrollment: Pick<OutreachEnrollment, 'target' | 'contactId' | 'leadId'>,
): OutreachPersonRef {
  return enrollment.target === 'lead' && enrollment.leadId
    ? { kind: 'lead', id: enrollment.leadId }
    : { kind: 'contact', id: enrollment.contactId }
}

/** The key the runtime files a person under: the id of whichever record they are. */
export function outreachPersonId(person: OutreachPersonRef): string {
  return person.id
}

/**
 * The timeline link for what a sequence does to a person (AGL-3234): the
 * lead's page while the enrollment targets a lead, the contact's after.
 */
export function outreachEnrollmentLink(
  enrollment: Pick<OutreachEnrollment, 'target' | 'contactId' | 'leadId'>,
): { contactId?: string; leadId?: string } {
  const person = outreachEnrollmentPerson(enrollment)
  return person.kind === 'lead' ? { leadId: person.id } : { contactId: person.id }
}
