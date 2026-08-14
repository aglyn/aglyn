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
 * The do-not-contact list, `contactSuppressions/{nationalKey}` (AGL-1592).
 *
 * WHY THIS EXISTS
 *
 * Privacy Policy v4 §11 tells users they may opt out of marketing calls and
 * texts, and may ask us to delete the phone number we hold. Neither had a
 * mechanism. This is the first half — the durable record that makes "never
 * contact me again" survivable. The second half (`forgetUserPhoneNumber`)
 * lives in `user-profiles.ts`, next to the seed it has to defeat.
 *
 * THE TENSION, AND HOW IT IS RESOLVED
 *
 * "Delete my phone number" and "stop contacting me" are DIFFERENT REQUESTS
 * WITH OPPOSITE DATA OUTCOMES, and §11 currently offers both in one sentence.
 * A suppression list that forgets the identifier cannot suppress anything: the
 * only way to guarantee a number is never dialled is to keep the number and
 * check it before dialling. Forgetting it does not protect the person — it
 * removes the one artefact that could have protected them, and the next list
 * imported from a customer's CRM re-adds them silently.
 *
 * So the two requests are implemented as two operations:
 *
 *   - "stop contacting me"  → `suppressPhoneContact`. The number is RETAINED,
 *                             here and only here. Whatever copy the profile
 *                             holds is left alone; they did not ask us to
 *                             drop it.
 *   - "delete my number"    → `forgetUserPhoneNumber` (user-profiles.ts).
 *                             The profile copy is cleared, the account is
 *                             marked so an IdP cannot re-assert it, AND a
 *                             suppression record is written here with
 *                             `erasePhoneOnFile: true`.
 *
 * That last clause is the whole point: a number we no longer hold anywhere is
 * a number we cannot recognise, and therefore a number we will happily dial
 * the day it arrives from somewhere else. Deletion WITHOUT suppression is the
 * outcome that gets the person called. So the minimal retained record is not
 * a hedge against the deletion request — it is the only way to honour what the
 * person actually wanted.
 *
 * This carve-out is the standard one and is not optional: CCPA §1798.105(d)
 * lets a business keep what it needs to honour an opt-out, and the TSR's
 * entity-specific do-not-call duty is unmeetable without a retained list.
 * §11's current wording does not say so, and should — see the wording proposal
 * recorded on AGL-1592.
 *
 * WHY KEYED ON THE NUMBER AND NOT ON A `uid`
 *
 * The number is what gets dialled. At dial time an outbound programme holds a
 * phone number and often nothing else, so the check has to be answerable from
 * the number alone — one `get()` by document id, no query, no composite index
 * that could go missing and fail the lookup open.
 *
 * It is also the only key that spans accounts. One human can reach us as a
 * self-serve signup AND as an SSO account in their employer's GCIP tenant,
 * with a different `uid` in each and a third if they are ever reprovisioned.
 * A `uid`-keyed record would suppress one of those and leave the same person
 * reachable on the same handset through the others.
 *
 * WHY THE RECORD IS NOT HASHED
 *
 * A phone number is a low-entropy identifier — NANP is ~10^10 values, which a
 * laptop enumerates against SHA-256 in minutes. Hashing it would buy the
 * appearance of de-identification and none of the substance, while making the
 * record unauditable by the person who has to honour it. The collection is
 * Admin-SDK-only in rules (`read, write: if false`), which is strictly less
 * exposed than `users/{uid}.phoneNumber` already is — that one is readable by
 * its owner.
 *
 * WHY A REVOCATION IS A FIELD AND NOT A DELETE
 *
 * Same reasoning as the clickwrap acceptances: the record exists to be
 * evidence. Deleting it on opt-in destroys the proof that the opt-out was
 * honoured for the period it was in force. `revokedAt` is set instead, and
 * every read treats a revoked record as not suppressed.
 */

import { normalizePhone } from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'

const firestore = () => firebaseAdmin.app().firestore()

export const CONTACT_SUPPRESSIONS_COLLECTION = 'contactSuppressions'

/**
 * The channels §11 names. Kept as an explicit list rather than a boolean
 * because they are governed differently — a STOP text is a texting opt-out by
 * statute, and reading it as a calling opt-out too would be us inventing a
 * request the person did not make. Callers that mean both say both.
 */
export const CONTACT_CHANNELS = ['calls', 'texts'] as const
export type ContactChannel = (typeof CONTACT_CHANNELS)[number]

/** Where the request came in. Every route §11 offers, plus staff-initiated. */
export type ContactSuppressionSource =
  /** Reply STOP (or another CTIA keyword) to a marketing text. */
  | 'sms-keyword'
  /** Emailed privacy@aglyn.com and a human recorded it. */
  | 'email'
  /** Said so on a call and a human recorded it. */
  | 'verbal'
  /** The user asked us to delete the number they had on file. */
  | 'erasure-request'
  /** Recorded by staff for any other reason (a complaint, a bounce, a court). */
  | 'staff'

export interface SuppressPhoneContactInput {
  /** Anything `normalizePhone` accepts; stored as E.164. */
  phoneNumber: string
  /** Defaults to BOTH channels — the conservative reading of an ambiguous ask. */
  channels?: ContactChannel[]
  source: ContactSuppressionSource
  /** The account the request was matched to, when it was matched to one. */
  uid?: string | null
  /** Staff member who took the email or the call. */
  recordedByUid?: string | null
  /** Free text: what they actually said, the ticket id, the case number. */
  note?: string | null
  /**
   * True only when the person also asked us to stop holding the number.
   * `seedUserProfile` reads this to refuse an IdP re-assertion, so it is the
   * difference between "do not call me" and "do not keep my number".
   */
  erasePhoneOnFile?: boolean
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
}

export interface ContactSuppressionRecord {
  phoneNumber: string
  channels: ContactChannel[]
  source: ContactSuppressionSource
  uid: string | null
  recordedByUid: string | null
  note: string | null
  erasePhoneOnFile: boolean
  /** Non-null once the person opted back in. A revoked record does not suppress. */
  revokedAt: unknown | null
}

/**
 * Document id for an E.164 number: the digits, with the `+` dropped.
 *
 * The `+` is a legal Firestore id character, but it is also the one character
 * that means "space" in a form-encoded query string, so a number carried
 * through a URL somewhere down the line would silently become a different
 * number. Dropping it here costs nothing — the full E.164 is stored in the
 * document — and removes the whole class of bug in advance.
 *
 * @returns the id, or `null` when the input is not a number we can be sure of.
 *          Never a best-guess id: suppressing the wrong subscriber and
 *          believing you suppressed the right one is worse than refusing.
 */
export function contactSuppressionKey(
  phoneNumber: string | null | undefined,
): string | null {
  const e164 = normalizePhone(phoneNumber)
  return e164 ? e164.slice(1) : null
}

/**
 * Record a do-not-contact request. Idempotent by document id, so a retried
 * request or a second STOP cannot produce a second record.
 *
 * Merging rather than replacing, and the channel list UNIONS with whatever is
 * already recorded: someone who opted out of texts in March and calls in June
 * is opted out of both in July. Narrowing a suppression is `releasePhoneContact`
 * and nothing else — no write on this path may ever make a person MORE
 * reachable than they already were.
 *
 * A previously revoked record is un-revoked, because a fresh request is a
 * fresh request.
 *
 * @throws when the number cannot be normalized. Deliberately NOT best-effort:
 *         a silently dropped opt-out is the exact failure this issue exists to
 *         fix, so the caller has to see it.
 */
export async function suppressPhoneContact(
  input: SuppressPhoneContactInput,
): Promise<{ phoneNumber: string; channels: ContactChannel[]; created: boolean }> {
  const e164 = normalizePhone(input.phoneNumber)
  const key = e164 ? e164.slice(1) : null
  if (!e164 || !key) {
    throw new Error(
      `[contact-suppression] cannot normalize phone number for suppression`,
    )
  }
  const db = input.firestore ?? firestore()
  const ref = db.collection(CONTACT_SUPPRESSIONS_COLLECTION).doc(key)
  const snapshot = await ref.get()

  const requested = (input.channels?.length ? input.channels : CONTACT_CHANNELS)
    .filter((channel): channel is ContactChannel =>
      (CONTACT_CHANNELS as readonly string[]).includes(channel),
    )
  const existing: ContactChannel[] = Array.isArray(snapshot.get('channels'))
    ? snapshot.get('channels')
    : []
  const channels = CONTACT_CHANNELS.filter(
    (channel) => requested.includes(channel) || existing.includes(channel),
  )

  await ref.set(
    {
      phoneNumber: e164,
      channels,
      source: input.source,
      uid: input.uid ?? snapshot.get('uid') ?? null,
      recordedByUid: input.recordedByUid ?? null,
      note: input.note ?? null,
      // Sticky: an erasure request recorded in March is still an erasure
      // request after a plain "stop texting me" arrives in June. Only an
      // explicit re-supply of the number clears it, and that happens on the
      // profile, not here.
      erasePhoneOnFile:
        input.erasePhoneOnFile === true || snapshot.get('erasePhoneOnFile') === true,
      revokedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
      ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  )
  return { phoneNumber: e164, channels, created: !snapshot.exists }
}

/**
 * Opt back in (a START/UNSTOP reply, or a staff correction of a mis-recorded
 * opt-out). The record is kept and marked revoked, never deleted.
 *
 * IMPORTANT — this does NOT create consent. Clearing a suppression only
 * removes a prohibition; it does not manufacture the prior express written
 * consent that TCPA requires before a marketing call or text may be placed at
 * all. That mechanism does not exist yet (AGL-1564, and the privacy benchmark
 * items 9–10), so after this call the correct number of marketing messages to
 * send is still zero.
 *
 * @returns false when there was no record to revoke.
 */
export async function releasePhoneContact(input: {
  phoneNumber: string
  releasedByUid?: string | null
  note?: string | null
  firestore?: any
}): Promise<boolean> {
  const key = contactSuppressionKey(input.phoneNumber)
  if (!key) return false
  const db = input.firestore ?? firestore()
  const ref = db.collection(CONTACT_SUPPRESSIONS_COLLECTION).doc(key)
  const snapshot = await ref.get()
  if (!snapshot.exists || snapshot.get('revokedAt')) return false
  await ref.set(
    {
      revokedAt: FieldValue.serverTimestamp(),
      revokedByUid: input.releasedByUid ?? null,
      revokedNote: input.note ?? null,
    },
    { merge: true },
  )
  return true
}

/**
 * The dial-time gate. Every outbound marketing call or text MUST pass through
 * this before the number reaches a provider.
 *
 * FAILS CLOSED. A read that throws — rules, quota, a cold Firestore — answers
 * `true`, meaning "treat as suppressed". The alternative is a list outage that
 * silently turns into a round of calls to people who asked us never to call
 * again, which is a statutory violation per call rather than a delayed
 * campaign. Never "fix" a flaky read here by returning false.
 */
export async function isPhoneContactSuppressed(
  phoneNumber: string | null | undefined,
  channel?: ContactChannel,
  injectedFirestore?: any,
): Promise<boolean> {
  const key = contactSuppressionKey(phoneNumber)
  // An unrecognizable number is one we cannot check against the list, so it is
  // one we must not dial. Same fail-closed rule.
  if (!key) return true
  try {
    const db = injectedFirestore ?? firestore()
    const snapshot = await db
      .collection(CONTACT_SUPPRESSIONS_COLLECTION)
      .doc(key)
      .get()
    if (!snapshot.exists) return false
    if (snapshot.get('revokedAt')) return false
    if (!channel) return true
    const channels = snapshot.get('channels')
    return Array.isArray(channels) ? channels.includes(channel) : true
  } catch (error) {
    console.error('[contact-suppression] lookup failed; failing closed', error)
    return true
  }
}

/**
 * Read one record, for the staff surface and for `seedUserProfile`'s
 * re-assertion guard.
 */
export async function getContactSuppression(
  phoneNumber: string | null | undefined,
  injectedFirestore?: any,
): Promise<(ContactSuppressionRecord & { $id: string }) | null> {
  const key = contactSuppressionKey(phoneNumber)
  if (!key) return null
  const db = injectedFirestore ?? firestore()
  const snapshot = await db
    .collection(CONTACT_SUPPRESSIONS_COLLECTION)
    .doc(key)
    .get()
  if (!snapshot.exists) return null
  return { $id: snapshot.id, ...(snapshot.data() as ContactSuppressionRecord) }
}

/**
 * The staff queue, newest first. Ordered by `updatedAt` so a re-recorded or
 * revoked entry surfaces again — the operator's question is "what changed",
 * not "what was first written".
 */
export async function listContactSuppressions(options?: {
  limit?: number
  firestore?: any
}): Promise<Array<ContactSuppressionRecord & { $id: string }>> {
  const db = options?.firestore ?? firestore()
  const snapshot = await db
    .collection(CONTACT_SUPPRESSIONS_COLLECTION)
    .orderBy('updatedAt', 'desc')
    .limit(Math.min(Math.max(options?.limit ?? 100, 1), 500))
    .get()
  return snapshot.docs.map((doc: any) => ({
    $id: doc.id,
    ...(doc.data() as ContactSuppressionRecord),
  }))
}
