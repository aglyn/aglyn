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
import {
  isBlankAddress,
  normalizeAddress,
  normalizePhone,
  type AglynPostalAddress,
} from '@aglyn/aglyn/server'
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
  /**
   * Postal address from the same assertion (AGL-1963). Callers pass this
   * through `resolveIdpAddress`, whose loose `IdpAddressParts` is structurally
   * an `AglynPostalAddress` — it is `normalizeAddress` below, not the caller,
   * that decides whether the parts amount to an address at all.
   */
  address?: AglynPostalAddress | null
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
  //
  // THE REMOVAL MARKER (AGL-2486). Absent-only is what protects an avatar
  // somebody SET; it does nothing for one they REMOVED, because removing it
  // is precisely what makes the field absent again. So this seed runs on the
  // next sign-in, finds a blank field and a directory thumbnail, and puts
  // back the picture the person just deleted — from the customer's own IdP,
  // on every sign-in, forever.
  //
  // `propagateMemberPhoto` already refuses this on the roster row, and says
  // why: it clears with `FieldValue.delete()` rather than `''` so the
  // backfill's identical `blank()` cannot read the clear as "never set". The
  // roster half got that treatment and this half did not, and no deletion
  // sentinel can fix it here — an absent field is exactly the state a
  // removal produces, so the two are indistinguishable without a marker.
  //
  // Hence `photoUrlErasedAt`, the same shape as `phoneNumberErasedAt` and
  // `addressErasedAt` above and below, and owner-writable for the same
  // reason: the only party who can clear it is the person it protects, and a
  // person clearing their own marker is a person asking for IdP prefill
  // again. Manage Account drops it on any save that stores a photo, so
  // opting back in is just setting an avatar.
  //
  // Not a privacy control, unlike those two — an avatar is a picture the
  // directory published, not a contact channel. It is a "stop overruling me"
  // control, which is the whole of what "set AND CHANGE your own avatar"
  // requires when a directory is asserting one on every sign-in.
  if (input.photoUrl?.trim() && blank(snapshot.get('photoUrl'))) {
    if (!snapshot.get('photoUrlErasedAt')) seed['photoUrl'] = input.photoUrl.trim()
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

  // The address (AGL-1963), the last of AGL-1133's six and the only one that
  // did not ship — it was written as blocked on AGL-1131 mapping attributes,
  // which completed 2026-08-01, and nothing picked it back up.
  //
  // NORMALIZE BEFORE DECIDING. `normalizeAddress` returns null for an address
  // with nothing usable in it, which is what stops a sparse assertion — a
  // country the IdP spells "United States", and no other field — from storing
  // an object that every `if (address)` in the codebase reads as an address.
  // Checking the raw parts first and normalizing after would write exactly
  // that object.
  //
  // Absent-only, like the rest, but `isBlankAddress` rather than `blank()`:
  // the stored value is a MAP, so the string check the other fields use would
  // call every populated address blank and overwrite it on every sign-in.
  //
  // THE ERASURE GUARD, following the phone's precedent (Privacy Policy v4 §11,
  // AGL-1592). An address is squarely personal data, and `/api/auth/sso-jit`
  // and `/api/auth/session` both run this seed on EVERY sign-in — so "absent
  // field" is the condition that makes it write, and a deletion would undo
  // itself at the next SSO sign-in from the customer's own IdP, leaving the
  // honoured request and the resurrected address identical in the data.
  //
  // ONE key, where the phone needs two, and the asymmetry is the point rather
  // than an omission. `phoneNumberErasedAt` is paired with a NUMBER-KEYED
  // suppression record because a phone number is a routing address: the same
  // person arriving as a different account must not have it re-stored, and
  // the number is the only thing that can recognise them. A postal address is
  // not a channel we contact anyone on and there is no do-not-mail list for it
  // to join, so the per-account marker is the whole of the mechanism here.
  // Adding a second, address-keyed store would retain MORE personal data in
  // the name of erasing it, which is the opposite of what §11 asks for.
  const address = normalizeAddress(input.address)
  if (address && isBlankAddress(snapshot.get('address'))) {
    if (!snapshot.get('addressErasedAt')) seed['address'] = address
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

/**
 * "Delete the address you hold for me" (AGL-1963) — the address half of the
 * same §11 invariant `forgetUserPhoneNumber` implements for the phone, and
 * deliberately adjacent to both for the same reason: this sets the marker
 * that `seedUserProfile` reads, and changing either without the other
 * silently restores the defect.
 *
 * A guard whose marker nothing ever writes is decorative, so this exists
 * before anything needs it. Two callers do:
 *
 *  - Manage Account, when someone clears their own address. That is the
 *    common case by a wide margin — nobody files a support ticket to remove
 *    a street address, they empty the field — and without a marker their
 *    next SSO sign-in puts it straight back.
 *  - Staff, handling an erasure request against an account the person can no
 *    longer sign in to.
 *
 * `FieldValue.delete()`, not `null`, on the same reasoning as the phone: the
 * request was to stop holding it, and a nulled field still reads as "we have
 * an address slot for this person".
 *
 * REVERSIBLE BY THE PERSON IT PROTECTS, and only by them. `users/{uid}` is
 * writable by its owner (and by staff) under the Firestore rules, so this
 * marker is not tamper-proof and does not need to be — the adversary it
 * guards against is our own seeding path, which is server-side and honours
 * it. Someone who types an address back in has a non-blank field, which the
 * seed skips anyway — and Manage Account drops the marker on that same save,
 * so opting back into IdP prefill is just filling the field in again.
 */
export async function forgetUserAddress(input: {
  uid: string
  firestore?: any
}): Promise<{ cleared: boolean }> {
  const db = input.firestore ?? firestore()
  const ref = db.collection('users').doc(input.uid)
  const snapshot = await ref.get()
  const onFile = snapshot.exists && !isBlankAddress(snapshot.get('address'))
  await ref.set(
    {
      address: FieldValue.delete(),
      addressErasedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return { cleared: Boolean(onFile) }
}

export default seedUserProfile
