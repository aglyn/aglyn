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

import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { createResourceUid, type PluginApiRequest } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  publisherAgreementAcceptanceRecord,
  type PublisherAgreementAction,
  type PublisherAgreementAcceptanceRecord,
} from '../model/publisher-agreement'

/*==========================================
 * RECORDING EACH AGREEMENT (AGL-4105).
 *
 * Every publisher save carries the Marketplace Publisher Agreement, ticked in
 * the form (`publisherAgreementConsentRefusal` refuses one that does not), and
 * each one is recorded here: an append-only document under the org,
 * `orgs/{orgId}/publisherAgreementAcceptances/{id}`, with the version and the
 * snapshot's pin, the person, whether they acted as staff, the save and what
 * it wrote, and the device's address and browser, as the hardware terms'
 * acceptance keeps them (AGL-4038). The rules deny every client read and
 * write; only these routes write it, and nothing ever updates one.
 *
 * Written BEFORE the save it agrees to, so no save stands without its record:
 * a record that cannot be written throws into the route's own 500 and the
 * save does not happen. A save refused later (a verifier finding, a taken
 * handle) leaves a record of an agreement given to a save that did not land,
 * which is what happened.
 *
 * The org's `publisherProfiles/{orgId}.publisherAgreement` is then rewritten
 * as a note of the last acceptance, on a profile that exists (this never
 * creates one), for the staff review page. It gates nothing.
 *=========================================*/

/** `orgs/{orgId}/publisherAgreementAcceptances`, one document per save. */
export const PUBLISHER_AGREEMENT_ACCEPTANCES = 'publisherAgreementAcceptances'

/** The profile note of the last acceptance, as `publisherAgreement` stores it. */
export function publisherAgreementNote(record: PublisherAgreementAcceptanceRecord) {
  return {
    version: record.version,
    sha256: record.sha256,
    bytes: record.bytes,
    acceptedBy: record.uid,
    acceptedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  }
}

/**
 * Records one save's agreement, then notes it on the org's profile.
 *
 * @param input.request the save's request, for the device's address and
 *   browser.
 * @param input.targetId what the save writes (a listing, the profile), or the
 *   source it publishes when the listing has no id yet.
 * @param input.noteOnProfile false where the caller writes the note itself in
 *   the same write as the profile (the profile save).
 */
export async function recordPublisherAgreementAcceptance(input: {
  firestore: FirebaseFirestore.Firestore
  request: Pick<PluginApiRequest, 'headers'> & Partial<Pick<PluginApiRequest, 'socket'>>
  orgId: string
  uid: string
  staff?: boolean
  action: PublisherAgreementAction
  targetId?: string | null
  noteOnProfile?: boolean
  now?: number
}): Promise<PublisherAgreementAcceptanceRecord> {
  const headers = input.request.headers ?? {}
  const userAgent = headers['user-agent']
  const record = publisherAgreementAcceptanceRecord({
    orgId: input.orgId,
    uid: input.uid,
    staff: input.staff,
    action: input.action,
    targetId: input.targetId ?? null,
    ip: readClientIp(headers, { remoteAddress: input.request.socket?.remoteAddress }),
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    atMs: input.now ?? Date.now(),
  })
  await input.firestore
    .collection('orgs')
    .doc(input.orgId)
    .collection(PUBLISHER_AGREEMENT_ACCEPTANCES)
    .doc(createResourceUid())
    .create({
      ...record,
      acceptedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
  if (input.noteOnProfile !== false) {
    const profileRef = input.firestore.collection('publisherProfiles').doc(input.orgId)
    const profile = await profileRef.get()
    // A profile that exists and is not an erasure's tombstone: the note never
    // makes a profile, and never puts content back on an erased one.
    if (profile.exists && profile.get('handle') && profile.get('erased') !== true) {
      await profileRef.set({ publisherAgreement: publisherAgreementNote(record) }, { merge: true })
    }
  }
  return record
}
