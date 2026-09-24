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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * WHERE A SITE MEMBER'S PASSWORD LIVES (AGL-3308).
 *
 * `hosts/{hostId}/siteMemberCredentials/{memberId}`, keyed by the member's
 * own id, beside the profile at `hosts/{hostId}/siteMembers/{memberId}`.
 *
 * The profile is what the console lists — the Users page, the Inbox, the
 * dashboard's newest members — so every member of the site reads it, viewers
 * included. A `salt:scrypt` hash on it was readable by all of them, and the
 * host catch-all let any content writer replace it and sign in as the
 * member. Firestore rules cannot hide one field of a readable document, so
 * the hash moved to a document no client reaches at all: the rules deny this
 * collection to every client, staff included, and only these server routes
 * read or write it.
 *
 * A `passwordScrypt` on the PROFILE answers for nothing. That was where the
 * hash lived before AGL-3308, and a one-shot migration moved every copy
 * across (2026-09-24). No route reads one there now, so a copy written onto a
 * profile, by staff or by a stale script, cannot open an account; each writer
 * here still deletes the field as it writes the credential document, and the
 * rules refuse a client that tries to set it.
 */

/**
 * The fields that belong on the credential document, and that a writer
 * deletes from the profile when it writes one.
 *
 * `passwordResetAt` travels with the hash: it says when the password was last
 * reset, which is a fact about the credential and nothing the console shows.
 */
export const MEMBER_CREDENTIAL_FIELDS = ['passwordScrypt', 'passwordResetAt'] as const

/** The member's credential document. */
export function memberCredentialRef(
  hostRef: FirebaseFirestore.DocumentReference,
  memberId: string,
): FirebaseFirestore.DocumentReference {
  return hostRef.collection('siteMemberCredentials').doc(memberId)
}

/** A usable stored hash: a non-empty string, or nothing. */
function hashOn(
  snapshot: FirebaseFirestore.DocumentSnapshot | null | undefined,
): string | undefined {
  if (!snapshot || snapshot.exists === false) return undefined
  const value = snapshot.get('passwordScrypt')
  return typeof value === 'string' && value ? value : undefined
}

/**
 * The hash a password is checked against: the credential document's, or none.
 *
 * Every flow that checks a password or binds a reset token to one asks this,
 * so the two can never disagree about which hash is current. A member with no
 * credential document has no password — sign-in refuses them, and a reset
 * link lets them set one.
 */
export function storedPasswordHash(
  credential: FirebaseFirestore.DocumentSnapshot | null | undefined,
): string | undefined {
  return hashOn(credential)
}

/** {@link storedPasswordHash} for a member document already in hand. */
export async function readMemberPasswordHash(
  hostRef: FirebaseFirestore.DocumentReference,
  member: FirebaseFirestore.DocumentSnapshot,
): Promise<string | undefined> {
  const credential = await memberCredentialRef(hostRef, member.id).get()
  return storedPasswordHash(credential)
}

/**
 * The profile patch that deletes any credential field from it — spread into
 * the same write that sets the credential document, so a hash never sits on
 * the document every member of the site can read.
 */
export function retiredCredentialFields(): Record<
  (typeof MEMBER_CREDENTIAL_FIELDS)[number],
  FirebaseFirestore.FieldValue
> {
  const remove = firebaseAdmin.firestore.FieldValue.delete()
  return { passwordScrypt: remove, passwordResetAt: remove }
}

/**
 * Whether a client-supplied member id names ONE document.
 *
 * `CollectionReference.doc()` appends a slash-separated PATH, so an id like
 * `a/b/c` would address a document nested under another member — the cart
 * cookie lesson of AGL-1763. Console routes take the id from a request body.
 */
export function isMemberDocumentId(memberId: string): boolean {
  return (
    memberId.length > 0 &&
    memberId.length <= 1500 &&
    !memberId.includes('/') &&
    memberId !== '.' &&
    memberId !== '..'
  )
}
