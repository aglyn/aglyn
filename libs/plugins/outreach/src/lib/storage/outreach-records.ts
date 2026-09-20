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

import { OUTREACH_COLLECTIONS, type OutreachOrgCollection } from '../model/outreach.types'

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
 */
export function outreachEnrollmentId(sequenceId: string, contactId: string): string {
  return `${sequenceId}_${contactId}`
}
