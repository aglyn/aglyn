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
import { normalizePhone } from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import {
  getContactSuppression,
  suppressPhoneContact,
} from './contact-suppression'
import firebaseAdmin from './firebase-admin'

const firestore = () => firebaseAdmin.app().firestore()

export interface SeedUserProfileInput {
  /** The provider's single name string, when the assertion carries one. */
  displayName?: string | null
  /**
   * Avatar and phone from the same assertion (AGL-1131). Callers pass these
   * through `resolveIdpPhotoUrl` / `resolveIdpPhone`, which is where the
   * https-only check on the photo lives — this function does not re-validate.
   */
  photoUrl?: string | null
  phoneNumber?: string | null
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
  // Same absent-only rule: a directory photo fills an empty avatar, and never
  // replaces one somebody uploaded. `photoUrl` here, not `photoURL` — this
  // doc's spelling differs from the roster's, and writing the roster's would
  // add a field Manage Account does not read.
  if (input.photoUrl?.trim() && blank(snapshot.get('photoUrl'))) {
    seed['photoUrl'] = input.photoUrl.trim()
  }
  // The phone is the one seeded field with a legal dimension, so it carries
  // two guards the others do not (AGL-1592).
  //
  // THE DEFECT THIS EXISTS TO PREVENT. Privacy Policy v4 §11 says a user may
  // ask us to delete the phone number we hold. Clearing the field is not
  // enough: `/api/auth/sso-jit` and `/api/auth/session` both run this seed on
  // EVERY sign-in, and "absent field" is exactly the condition that makes it
  // write. A naive deletion therefore undoes itself the next time the person
  // signs in, from the customer's IdP, with no trace — the honoured request
  // and the resurrected number look identical in the data.
  //
  // Two keys, because neither one covers the whole defect:
  //
  //  - `phoneNumberErasedAt` on this document catches the same account. It is
  //    free (the snapshot is already in hand) and it is what runs on the hot
  //    path, so the common case adds no read at all.
  //  - the number-keyed suppression record catches the SAME PERSON ARRIVING AS
  //    A DIFFERENT ACCOUNT — reprovisioned in the IdP, or signing up
  //    self-serve alongside their SSO seat. Their new `users/{uid}` has no
  //    marker on it, so the per-account key alone would re-store a number
  //    somebody asked us to stop holding.
  //
  // The suppression lookup is reached only when we are actually about to write
  // a phone, which is the first sign-in of an account and no other time; an
  // erased account short-circuits on the marker before spending the read.
  //
  // Note which suppressions block this: ONLY `erasePhoneOnFile`. "Stop calling
  // me" is not "stop holding my number" — see contact-suppression.ts — and
  // treating a do-not-call as a deletion request would answer a question the
  // person did not ask.
  if (input.phoneNumber?.trim() && blank(snapshot.get('phoneNumber'))) {
    let refused = Boolean(snapshot.get('phoneNumberErasedAt'))
    if (!refused) {
      try {
        const suppression = await getContactSuppression(
          input.phoneNumber,
          input.firestore ?? undefined,
        )
        refused = Boolean(suppression?.erasePhoneOnFile) && !suppression?.revokedAt
      } catch (error) {
        // Fail CLOSED, in step with `isPhoneContactSuppressed`. A lookup that
        // throws leaves us unable to say whether this number was erased on
        // request, and re-storing it in that state is the failure this guard
        // exists for. A cosmetic prefill is worth nothing next to it.
        console.error(
          '[user-profiles] suppression lookup failed; not seeding phone',
          error,
        )
        refused = true
      }
    }
    if (!refused) seed['phoneNumber'] = input.phoneNumber.trim()
  }

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

/**
 * "Delete the phone number you hold for me" — the second half of Privacy
 * Policy v4 §11 (AGL-1592). Deliberately adjacent to `seedUserProfile`,
 * because the two are halves of one invariant: this sets the marker that one
 * reads, and changing either without the other silently restores the defect.
 *
 * WHAT IT DOES, AND WHY IT IS NOT JUST A DELETE
 *
 *  1. Removes `users/{uid}.phoneNumber` outright (`FieldValue.delete()`, not
 *     `null` — the request was to stop holding it, and a nulled field still
 *     reads as "we have a phone slot for this person").
 *  2. Stamps `phoneNumberErasedAt`, which is what stops the IdP re-asserting
 *     it on the next sign-in.
 *  3. Writes a suppression record for the number, with `erasePhoneOnFile`.
 *
 * Step 3 is the one that looks contradictory and is not. Deleting every copy
 * of a number does NOT protect the person from being called — it destroys the
 * only artefact that could recognise them, so the same number arriving later
 * from a customer's CRM, a support ticket, or their own re-typed profile is a
 * number we have never heard of and will happily dial. The minimal retained
 * record is what makes the deletion request mean what the person meant by it.
 * The full reasoning, and the statutory carve-outs it rests on, are in
 * contact-suppression.ts.
 *
 * §11 does not currently say this. It should — see the wording proposed on
 * AGL-1592. Do not resolve the mismatch by making the code forget the number.
 *
 * WHY THE MARKER LIVES ON A CLIENT-WRITABLE DOCUMENT. `users/{uid}` is
 * writable by its owner (and by staff) under the Firestore rules, so this
 * marker is not tamper-proof. It does not need to be: the only party who can
 * clear it is the person it protects, and a person clearing their own erasure
 * marker is a person changing their mind, not an attacker. The adversary here
 * is our own seeding code path, which is server-side and honours it. Moving
 * the marker to a server-only document would buy nothing and cost a second
 * read on every sign-in.
 *
 * A stale marker is harmless: it only ever suppresses an IdP prefill, and a
 * user who types a number back in has a non-blank field, which the seed skips
 * anyway.
 *
 * @param phoneNumber the number to suppress. Defaults to whatever the profile
 *        currently holds — pass it explicitly when the request named a number
 *        we do not have on file.
 * @returns `suppressed` is the E.164 that went onto the do-not-contact list,
 *          or null when there was no recognizable number to record.
 */
export async function forgetUserPhoneNumber(input: {
  uid: string
  phoneNumber?: string | null
  /** Staff member who took the request, for the suppression record. */
  recordedByUid?: string | null
  note?: string | null
  firestore?: any
}): Promise<{ cleared: boolean; suppressed: string | null }> {
  const db = input.firestore ?? firestore()
  const ref = db.collection('users').doc(input.uid)
  const snapshot = await ref.get()
  const onFile = snapshot.exists ? snapshot.get('phoneNumber') : null
  const target = normalizePhone(input.phoneNumber ?? onFile)

  // The suppression is written FIRST. If it fails, the number is still on the
  // profile and the request is visibly unfulfilled — which is recoverable by
  // retrying. The other order deletes our only copy of the number and then
  // fails to record it, leaving nothing to retry with.
  let suppressed: string | null = null
  if (target) {
    const result = await suppressPhoneContact({
      phoneNumber: target,
      source: 'erasure-request',
      uid: input.uid,
      recordedByUid: input.recordedByUid ?? null,
      note: input.note ?? null,
      erasePhoneOnFile: true,
      ...(input.firestore ? { firestore: input.firestore } : {}),
    })
    suppressed = result.phoneNumber
  }

  // The marker is stamped even when no number was recognizable, so a later
  // IdP assertion for this account is refused too. Someone who asks us to
  // stop holding their number has asked about the account, not only about the
  // digits we happened to have at the time.
  await ref.set(
    {
      phoneNumber: FieldValue.delete(),
      phoneNumberErasedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return { cleared: Boolean(onFile), suppressed }
}

export default seedUserProfile
