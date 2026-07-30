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
 * The personal profile document, `users/{uid}` (AGL-1127).
 *
 * It holds what Manage Account → Basic info edits (`firstName`, `lastName`,
 * `phoneNumber`, `organization`) plus the avatar the console shows for you.
 * It is NOT an identity source: email and display name for OTHER people are
 * read from the org roster (`orgs/{id}/members/{uid}`), which works for SSO
 * accounts that project-level auth cannot see at all (AGL-1122). Nothing here
 * duplicates them, so there is nothing to drift.
 *
 * Until this existed, no account-creation path wrote the doc — it was born
 * the first time someone saved Basic info, so a fresh account rendered the
 * form against a document that did not exist. Measured on production
 * 2026-07-30: 1 of 3 accounts had one, and the account that did had exactly
 * the four Basic-info fields.
 */

import { splitDisplayName } from '@aglyn/shared-util-tools'
import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'

const firestore = () => firebaseAdmin.app().firestore()

export interface SeedUserProfileInput {
  /** The provider's single name string, when the assertion carries one. */
  displayName?: string | null
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
}

/**
 * Create `users/{uid}` if it is missing and prefill the name fields from the
 * identity provider, without ever overwriting what the user has typed.
 *
 * Only ABSENT fields are written, so re-running on every sign-in — which is
 * what the SSO route does — cannot undo an edit: rename yourself in Basic
 * info and the IdP's copy stays out of it.
 *
 * Best-effort by contract. Provisioning access must not fail because a
 * cosmetic prefill did, so the caller is expected to let a rejection through
 * rather than surface it; the profile self-heals on the next sign-in.
 *
 * @returns what the seed actually wrote, for logging and tests.
 */
export async function seedUserProfile(
  uid: string,
  input: SeedUserProfileInput = {},
): Promise<{ created: boolean; fields: string[] }> {
  const ref = (input.firestore ?? firestore()).collection('users').doc(uid)
  const snapshot = await ref.get()
  const { firstName, lastName } = splitDisplayName(input.displayName)

  const blank = (value: unknown) =>
    typeof value !== 'string' || !value.trim()

  const seed: Record<string, unknown> = {}
  if (firstName && blank(snapshot.get('firstName'))) seed['firstName'] = firstName
  if (lastName && blank(snapshot.get('lastName'))) seed['lastName'] = lastName

  // An existing doc with nothing missing needs no write at all — the common
  // case on every sign-in after the first.
  if (snapshot.exists && !Object.keys(seed).length) {
    return { created: false, fields: [] }
  }
  // A doc with no name to seed is still worth creating: it is where the
  // avatar and the notification mutes land, and its absence is what made
  // those read as "this account has none" rather than "not set yet".
  if (!snapshot.exists) seed['createdAt'] = FieldValue.serverTimestamp()

  await ref.set(seed, { merge: true })
  return {
    created: !snapshot.exists,
    fields: Object.keys(seed).filter((key) => key !== 'createdAt'),
  }
}

export default seedUserProfile
