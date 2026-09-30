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

import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'

/**
 * The one "New account" staff notice per account (AGL-3225).
 *
 * Whether an account is NEW is read from its auth record's creation time,
 * never from whether `users/{uid}` happens to exist yet. That document has
 * several writers that can reach it first — the sign-up page's own writes
 * (profile, plan intent, campaign, consent), the acquisition record, the
 * /signin consent bounce's acquisition record, the SSO JIT seed — so "the
 * session mint's seed created it" was true only for whichever sign-up won a
 * race, and never for a password account, whose first mint waits on email
 * verification while the page writes the document on the spot.
 *
 * Exactly once is the marker's job: `accountAnnouncements/{uid}` is created
 * with `create()`, which Firestore refuses when the document exists, so two
 * mints racing each other — a second tab, a retry — cannot both win. It is a
 * collection of its own rather than a field on `users/{uid}` because the
 * owner may delete that document, and a marker its subject can erase is a
 * notice its subject can replay. No rule matches the collection, so every
 * client is denied it and the Admin SDK is the only writer.
 */

/** The server-only collection that remembers which accounts were announced. */
export const NEW_ACCOUNT_ANNOUNCEMENTS_COLLECTION = 'accountAnnouncements'

/**
 * How long after its creation an account's first session may still announce
 * it. A password account mints its first session only once the address is
 * verified, and a Google account bounced from /signin for consent only when
 * the person comes back to /signup — both can be days. Seven matches how long
 * the sign-up workspace hold waits for the same first session. Every account
 * older than this predates the marker, so without the window each one's next
 * sign-in would be announced as new.
 */
export const NEW_ACCOUNT_ANNOUNCEMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface ClaimNewAccountAnnouncementInput {
  uid: string
  /** The auth record's creation time; null or unparseable claims nothing. */
  accountCreatedAtMs: number | null
  nowMs?: number
  firestore?: FirebaseFirestore.Firestore
}

/**
 * True exactly once per account, and only while the account is new: the
 * caller that gets `true` sends the notice. Throws when the marker cannot be
 * written for any reason but "already announced", so a caller's catch — not a
 * silent `false` — is what a Firestore outage reaches.
 */
export async function claimNewAccountAnnouncement(
  input: ClaimNewAccountAnnouncementInput,
): Promise<boolean> {
  const createdAtMs = input.accountCreatedAtMs
  if (!input.uid || createdAtMs === null || !Number.isFinite(createdAtMs)) {
    return false
  }
  const nowMs = input.nowMs ?? Date.now()
  if (nowMs - createdAtMs > NEW_ACCOUNT_ANNOUNCEMENT_WINDOW_MS) return false
  const firestore = input.firestore ?? firebaseAdmin.app().firestore()
  try {
    await firestore
      .collection(NEW_ACCOUNT_ANNOUNCEMENTS_COLLECTION)
      .doc(input.uid)
      .create({
        announcedAt: FieldValue.serverTimestamp(),
        accountCreatedAtMs: createdAtMs,
      })
    return true
  } catch (error) {
    if (isAlreadyExists(error)) return false
    throw error
  }
}

/** Firestore's ALREADY_EXISTS, as the Admin SDK reports it (gRPC code 6). */
function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS'
}
