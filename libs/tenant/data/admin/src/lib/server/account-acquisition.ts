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

import {
  ACCOUNT_ACQUISITION_FIELD,
  buildAccountAcquisition,
  readAccountAcquisition,
  type AccountAcquisition,
  type AcquisitionDoor,
} from '@aglyn/aglyn/app-utils/account-acquisition'
import {
  readRequestCity,
  readRequestGeo,
  readRequestRegionLabel,
  type HeaderReader,
} from '@aglyn/aglyn/app-utils/request-geo'
import firebaseAdmin from './firebase-admin'

/**
 * Write where an account came from, ONCE, at account creation (AGL-3289).
 *
 * The capture kept the first touch on the visitor's device; the door that
 * created the account hands it here, with what only the server knows beside
 * it: the door, the sign-in provider from the verified token, where the
 * request came from as the edge reported it, and whether the address had an
 * invitation waiting. The record goes on `users/{uid}` inside a transaction
 * that writes nothing when one is already there — the first write wins, and
 * a retry, a second tab or a later call can never restate it.
 *
 * The rules deny the field to every client, so this Admin SDK write is the
 * only way in. `createOrganization` copies it onto the workspace the account
 * creates.
 */

/**
 * How long after an account is created its door may still record where it
 * came from. A door calls within seconds of creating the account; a mobile
 * redirect or a slow verification page within minutes. Anything later is not
 * account creation, and a record written then would describe a later visit.
 */
export const ACCOUNT_ACQUISITION_WINDOW_MS = 30 * 60 * 1000

/** What a door knows when it records an account. */
export interface RecordAccountAcquisitionInput {
  uid: string
  /** When the auth record says the account was created; null refuses. */
  accountCreatedAtMs: number | null
  /** The first touch the device kept — untrusted. */
  touch: unknown
  door: AcquisitionDoor
  /** From the verified token's `sign_in_provider`. */
  provider: string | null
  /** The account's address, for the invitation check; null when it has none. */
  email: string | null
  /** The organization an invitation the door already found came from. */
  invitedToOrgId?: string | null
  /** The account-creating request's headers, for its geography. */
  headers: HeaderReader
  recordedBy: 'signup' | 'sso'
  nowMs?: number
  firestore?: FirebaseFirestore.Firestore
}

export type RecordAccountAcquisitionResult =
  | { status: 'recorded'; record: AccountAcquisition }
  | { status: 'exists'; record: AccountAcquisition | null }
  /** The account was not created just now, so this is not its creation. */
  | { status: 'not-new' }

/**
 * The organization whose invitation this address has waiting, or null. The
 * same query the console's invitation banner runs, one address wide.
 */
export async function pendingInvitationOrgId(
  email: string | null,
  firestore: FirebaseFirestore.Firestore = firebaseAdmin.app().firestore(),
): Promise<string | null> {
  const address = String(email ?? '').trim().toLowerCase()
  if (!address) return null
  try {
    const snapshot = await firestore
      .collectionGroup('invites')
      .where('email', 'in', [address])
      .where('acceptedAt', '==', null)
      .limit(1)
      .get()
    return snapshot.docs[0]?.ref.parent.parent?.id ?? null
  } catch (error) {
    // An unanswerable question costs the door's label, never the record.
    console.error('[account-acquisition] invitation lookup failed', error)
    return null
  }
}

/** Where the request came from, as a person reads it — no address, no coordinates. */
export function requestGeography(headers: HeaderReader): {
  country: string | null
  region: string | null
  city: string | null
} {
  return {
    country: readRequestGeo(headers).country,
    region: readRequestRegionLabel(headers),
    city: readRequestCity(headers),
  }
}

/** Record the account's acquisition unless it already has one. */
export async function recordAccountAcquisition(
  input: RecordAccountAcquisitionInput,
): Promise<RecordAccountAcquisitionResult> {
  const firestore = input.firestore ?? firebaseAdmin.app().firestore()
  const nowMs = input.nowMs ?? Date.now()
  if (
    input.accountCreatedAtMs === null ||
    !Number.isFinite(input.accountCreatedAtMs) ||
    nowMs - input.accountCreatedAtMs > ACCOUNT_ACQUISITION_WINDOW_MS
  ) {
    return { status: 'not-new' }
  }
  const invitedToOrgId =
    input.invitedToOrgId ??
    (input.door === 'signup-password' || input.door === 'signup-google'
      ? await pendingInvitationOrgId(input.email, firestore)
      : null)
  const record = buildAccountAcquisition({
    touch: input.touch,
    door: invitedToOrgId && input.door !== 'sso' ? 'invite' : input.door,
    provider: input.provider,
    geo: requestGeography(input.headers),
    invitedToOrgId,
    accountCreatedAtMs: input.accountCreatedAtMs,
    recordedBy: input.recordedBy,
    nowMs,
  })
  const userRef = firestore.collection('users').doc(input.uid)
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(userRef)
    const existing = snapshot.exists ? snapshot.get(ACCOUNT_ACQUISITION_FIELD) : undefined
    if (existing !== undefined && existing !== null) {
      return { status: 'exists', record: readAccountAcquisition(existing) } as const
    }
    tx.set(userRef, { [ACCOUNT_ACQUISITION_FIELD]: record }, { merge: true })
    return { status: 'recorded', record } as const
  })
}
