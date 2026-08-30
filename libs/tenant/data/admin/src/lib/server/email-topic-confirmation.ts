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
 * DOUBLE OPT-IN — the durable half.
 *
 * `email-topics.ts` in the framework states the policy and owns the three
 * states an entry can be in; this writes them, because writing them needs
 * Firestore.
 *
 * ## The record it writes is the one the send path already reads
 *
 * `hosts/{hostId}/topicOptOuts/{emailKey}` holds a map keyed by topic, and
 * `filterTopicSendable` reads it on every topic-filtered send. A pending
 * confirmation is therefore a THIRD state of a fact the send path already
 * consults rather than a new document nobody has a reason to look at — which
 * is the difference between ActiveCampaign's quarantine, where an unconfirmed
 * subscriber genuinely cannot be mailed, and Customer.io's recipe, whose own
 * documentation warns that it "doesn't automatically check this attribute
 * before sending messages".
 *
 * ## Nothing here is a deletion
 *
 * A confirmation stamps `confirmedAt` beside the `pendingAt` it answers,
 * rather than clearing the pending mark. The pair IS the evidence — when we
 * asked and when they answered — and it is the evidence a consent question
 * needs, which is the same argument `writeTopicOptOuts` makes for keeping an
 * opt-out entry after somebody rejoins.
 */

import { FieldValue } from 'firebase-admin/firestore'
import {
  doubleOptInExpired,
  readTopicSubscriptionState,
  TOPIC_OPT_OUTS_SUBCOLLECTION,
  type TopicSubscriptionEntry,
} from '@aglyn/aglyn/app-utils/email-topics'
import { isEmailTopicId } from '@aglyn/aglyn/app-utils/email-topics'
import firebaseAdmin from './firebase-admin'
import { emailSuppressionKey } from './email-suppression'

const defaultFirestore = () => firebaseAdmin.app().firestore()

function optOutDoc(hostId: string, key: string, firestore?: any) {
  return (firestore ?? defaultFirestore())
    .collection('hosts')
    .doc(hostId)
    .collection(TOPIC_OPT_OUTS_SUBCOLLECTION)
    .doc(key)
}

/** What asking for a confirmation did. */
export type PendingConfirmationResult =
  /** Recorded. The address is not mailable about this topic until confirmed. */
  | 'pending'
  /** Already confirmed, or never needed confirming. Nothing was written. */
  | 'already-subscribed'
  /**
   * They left this stream. Nothing was written and nothing may be sent.
   *
   * A signup form cannot re-arm mail to somebody who unsubscribed by asking
   * them again: the confirmation request is itself a message, and sending it
   * would be mailing somebody who told this site to stop.
   */
  | 'opted-out'
  /** Not an address, or not a topic id. */
  | 'unusable'

/**
 * Puts an address in the quarantine for one topic and returns the moment it
 * entered, which is what the confirmation link is signed and dated from.
 *
 * ## Re-asking does not restamp
 *
 * A second signup from the same address inside the window keeps the original
 * `pendingAt`, so the 72-hour expiry measures from when we first asked. The
 * alternative lets somebody — or a script — hold an address in a permanently
 * fresh pending state by resubmitting a form, which is a way to keep a
 * confirmation link alive indefinitely.
 */
export async function recordPendingTopicConfirmation(
  hostId: string,
  email: string,
  topicId: string,
  options?: { nowMs?: number; firestore?: any },
): Promise<{ result: PendingConfirmationResult; pendingAtMs: number | null }> {
  const key = emailSuppressionKey(email)
  if (!key || !hostId || !isEmailTopicId(topicId)) {
    return { result: 'unusable', pendingAtMs: null }
  }
  const nowMs = options?.nowMs ?? Date.now()
  const ref = optOutDoc(hostId, key, options?.firestore)
  const address = String(email).trim().toLowerCase()
  let result: PendingConfirmationResult = 'pending'
  let pendingAtMs: number | null = nowMs
  await (options?.firestore ?? defaultFirestore()).runTransaction(
    async (transaction: any) => {
      const snapshot = await transaction.get(ref)
      const stored = ((snapshot.exists ? snapshot.get('topics') : null) ??
        {}) as Record<string, TopicSubscriptionEntry>
      const existing = stored[topicId]
      const state = readTopicSubscriptionState(existing)
      if (state === 'opted-out') {
        result = 'opted-out'
        pendingAtMs = null
        return
      }
      if (state === 'pending') {
        // Already in the quarantine. Keep the original moment — see above.
        result = 'pending'
        pendingAtMs = Number(existing?.pendingAt) || nowMs
        return
      }
      if (existing?.confirmedAt) {
        result = 'already-subscribed'
        pendingAtMs = null
        return
      }
      transaction.set(
        ref,
        {
          email: address,
          topics: {
            ...stored,
            [topicId]: {
              ...(existing ?? {}),
              pendingAt: nowMs,
              confirmedAt: null,
            },
          },
          updatedAt: FieldValue.serverTimestamp(),
          ...(snapshot.exists
            ? {}
            : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      )
    },
  )
  return { result, pendingAtMs }
}

/** What a click on a confirmation link did. */
export type ConfirmTopicResult =
  /** They are now a subscriber to this topic. */
  | 'confirmed'
  /** They already were, and a second click changes nothing. */
  | 'already-confirmed'
  /** The request is older than the window, so the link no longer acts. */
  | 'expired'
  /** They left this stream. A confirmation link may not undo that. */
  | 'opted-out'
  /** Nothing was pending for this address and topic. */
  | 'not-pending'
  /** Not an address, or not a topic id. */
  | 'unusable'

/**
 * Honors a confirmation click.
 *
 * ## An expired link does not admit anybody, and does not clear anything
 *
 * `expired` leaves the record exactly as it was: still pending, still
 * unmailable. Expiry is a property of the LINK, and a lapse that quietly
 * admitted the address, or quietly cleared the request, would make the window
 * a delay somebody could wait out rather than a gate.
 *
 * ## A confirmation cannot reverse an unsubscribe
 *
 * Same rule as `releaseSiteSuppression`: the recipient's later, more explicit
 * act stands, and a link minted before it must not undo it.
 */
export async function confirmTopicSubscription(
  hostId: string,
  email: string,
  topicId: string,
  options?: { nowMs?: number; firestore?: any },
): Promise<ConfirmTopicResult> {
  const key = emailSuppressionKey(email)
  if (!key || !hostId || !isEmailTopicId(topicId)) return 'unusable'
  const nowMs = options?.nowMs ?? Date.now()
  const ref = optOutDoc(hostId, key, options?.firestore)
  let result: ConfirmTopicResult = 'not-pending'
  await (options?.firestore ?? defaultFirestore()).runTransaction(
    async (transaction: any) => {
      const snapshot = await transaction.get(ref)
      const stored = ((snapshot.exists ? snapshot.get('topics') : null) ??
        {}) as Record<string, TopicSubscriptionEntry>
      const existing = stored[topicId]
      const state = readTopicSubscriptionState(existing)
      if (state === 'opted-out') {
        result = 'opted-out'
        return
      }
      if (state === 'subscribed') {
        result = existing?.confirmedAt ? 'already-confirmed' : 'not-pending'
        return
      }
      if (doubleOptInExpired(Number(existing?.pendingAt), nowMs)) {
        result = 'expired'
        return
      }
      result = 'confirmed'
      transaction.set(
        ref,
        {
          email: String(email).trim().toLowerCase(),
          topics: {
            ...stored,
            [topicId]: { ...(existing ?? {}), confirmedAt: nowMs },
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    },
  )
  return result
}

/**
 * Whether this site confirms new subscriptions by default.
 *
 * One host-document field, read at the moment somebody signs up and nowhere
 * else — the send path never asks, because by then the answer is already on
 * the person's own record as a pending mark or its absence. A read on every
 * send would be a read per recipient to re-derive a decision that was made
 * once.
 *
 * Fails to `false`, which is off. A default that a failed read could switch
 * ON would quarantine every new signup on a site whose owner never asked for
 * confirmations, and they would have no way to tell why their list stopped
 * growing.
 */
export async function siteRequiresDoubleOptIn(
  hostId: string,
  firestore?: any,
): Promise<boolean> {
  if (!hostId) return false
  try {
    const snapshot = await (firestore ?? defaultFirestore())
      .collection('hosts')
      .doc(hostId)
      .get()
    return snapshot.exists && snapshot.get('emailDoubleOptIn') === true
  } catch (error) {
    console.error('[email-topics] double opt-in setting read failed', error)
    return false
  }
}
