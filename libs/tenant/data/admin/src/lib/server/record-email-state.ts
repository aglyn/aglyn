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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import {
  CRM_EMAIL_STATE_FIELD,
  nextCrmEmailState,
  readCrmEmailState,
  type CrmEmailState,
} from '@aglyn/aglyn/app-utils/email-state'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { FieldValue } from 'firebase-admin/firestore'
import { findContactByEmail } from './contact-email-index'
import firebaseAdmin from './firebase-admin'

/**
 * THE VERDICT ON AN ADDRESS, STAMPED ON THE RECORDS THAT CARRY IT (AGL-3245).
 *
 * The senders write their lists — the platform suppression list, the
 * organization's do-not-contact list — and those are what a send consults.
 * This is the other half: the same verdict written onto the lead and the
 * contact a person reads, as `emailState`, so the record and the lists
 * agree. Every writer of a list calls this beside its write.
 *
 * One address can be several records: the contact the organization holds
 * (found through the address index, `findContactByEmail`), and a lead on
 * each site the organization owns — leads are keyed by `personKey`, so a
 * lead is addressed directly under every host. All of them are stamped;
 * the verdict is about the address, not about which record a rep opened.
 *
 * The write keeps the STRONGER verdict (`nextCrmEmailState`): a member's
 * do-not-contact mark is not undone by a later bounce, and `ok` lands only
 * when a caller forces it. `updatedAt` is left alone — a verdict is
 * something that happened to the person, not an edit the team made, and a
 * list sorted on recency must not reshuffle on a bounce.
 *
 * Never throws: the list is the control, and a record that could not be
 * stamped is a chip a page goes without, logged.
 */

export interface StampRecordEmailStateInput {
  orgId: string
  email: string
  state: CrmEmailState
  /** Write the state whatever the record holds — a release. */
  force?: boolean
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: FirebaseFirestore.Firestore
}

export interface StampRecordEmailStateResult {
  /** Records whose state moved. */
  contacts: number
  leads: number
}

const NONE: StampRecordEmailStateResult = { contacts: 0, leads: 0 }

/** The sites an organization owns, by id: `hosts` where `orgId` is the org's. */
async function orgHostIds(firestore: FirebaseFirestore.Firestore, orgId: string): Promise<string[]> {
  const hosts = await firestore.collection('hosts').where('orgId', '==', orgId).select().get()
  return hosts.docs.map((doc) => doc.id)
}

/**
 * Applies the verdict to one record; answers whether it moved. A read then
 * a merge rather than a transaction: two verdicts landing together each
 * compare against a state at least as old as their own, and the ranking
 * makes the order of two writes of the same rank immaterial.
 */
async function stampRecord(
  ref: FirebaseFirestore.DocumentReference,
  incoming: CrmEmailState,
  force: boolean,
): Promise<boolean> {
  const snapshot = await ref.get()
  if (!snapshot.exists) return false
  const current = readCrmEmailState(snapshot.data() as Record<string, unknown>)
  const next = nextCrmEmailState(current, incoming, { force })
  // The current verdict stood, or the same verdict arrived again — a second
  // run of the caller — and there is nothing to write.
  if (
    next === current ||
    (current &&
      next.status === current.status &&
      next.atMs === current.atMs &&
      next.source === current.source &&
      next.detail === current.detail)
  ) {
    return false
  }
  await ref.set({ [CRM_EMAIL_STATE_FIELD]: next }, { merge: true })
  return true
}

/** Stamps the verdict on the contact and every lead the address is — see the module note. */
export async function stampRecordEmailState(
  input: StampRecordEmailStateInput,
): Promise<StampRecordEmailStateResult> {
  const email = normalizeContactEmail(input.email)
  const key = email ? personKey(email) : null
  if (!email || !key || !input.orgId) return NONE
  const firestore = input.firestore ?? firebaseAdmin.app().firestore()
  const state: CrmEmailState = {
    status: input.state.status,
    atMs: Number.isFinite(input.state.atMs) && input.state.atMs > 0 ? input.state.atMs : Date.now(),
    source: input.state.source,
    detail: input.state.detail ? String(input.state.detail).replace(/\s+/g, ' ').trim().slice(0, 500) : null,
    ...(input.state.enrollmentId ? { enrollmentId: input.state.enrollmentId } : {}),
  }
  const force = input.force === true
  const result: StampRecordEmailStateResult = { contacts: 0, leads: 0 }
  try {
    const contacts = firestore.collection('orgs').doc(input.orgId).collection('contacts')
    const contact = await findContactByEmail(contacts, email)
    if (contact && (await stampRecord(contact.ref, state, force))) result.contacts += 1
  } catch (error) {
    console.error('[record-email-state] the contact could not be stamped', input.orgId, error)
  }
  try {
    for (const hostId of await orgHostIds(firestore, input.orgId)) {
      const lead = firestore.collection('hosts').doc(hostId).collection('leads').doc(key)
      if (await stampRecord(lead, state, force)) result.leads += 1
    }
  } catch (error) {
    console.error('[record-email-state] the leads could not be stamped', input.orgId, error)
  }
  return result
}

/**
 * The same verdict, from a SITE's point of view (AGL-3245): the campaign
 * webhook and the unsubscribe link know the site the send left from and
 * not the organization, so the organization is read off the host first.
 */
export async function stampRecordEmailStateForHost(
  input: Omit<StampRecordEmailStateInput, 'orgId'> & { hostId: string },
): Promise<StampRecordEmailStateResult> {
  if (!input.hostId) return NONE
  const firestore = input.firestore ?? firebaseAdmin.app().firestore()
  try {
    const host = await firestore.collection('hosts').doc(input.hostId).get()
    const orgId = host.exists ? String(host.get('orgId') ?? '') : ''
    if (!orgId) return NONE
    return await stampRecordEmailState({ ...input, orgId, firestore })
  } catch (error) {
    console.error('[record-email-state] the site’s organization could not be read', input.hostId, error)
    return NONE
  }
}

/** A field write that clears the state: what a release with nothing to say writes. */
export const CRM_EMAIL_STATE_CLEAR = { [CRM_EMAIL_STATE_FIELD]: FieldValue.delete() } as const
