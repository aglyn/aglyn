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

import { firebaseAdmin } from './firebase-admin'
import { updateExisting } from './update-existing'

/**
 * A PAYOUT THAT NEVER LANDED, RECORDED.
 *
 * ## What was invisible, and to whom
 *
 * Nothing in this codebase handled `payout.failed` or `transfer.failed`. The
 * consequences ran in opposite directions on the two sides of the same money:
 *
 *   - **The merchant** saw a storefront that looked healthy — orders settling,
 *     the payments card reporting enabled — while the funds accumulated in a
 *     Connect account that could not release them. Aglyn stored no balance and
 *     no payout schedule, so nothing in the console could contradict that.
 *   - **The publisher** saw a seller ledger whose payout figure is derived from
 *     `transferCents`, which is what Stripe was ASKED to move. A failed payout
 *     leaves that number untouched, so the ledger actively asserted money had
 *     arrived when it had not.
 *
 * And Aglyn held no record at all, so there was nothing to reconcile against,
 * no history, and no way to answer "has this happened to this account before".
 *
 * ## Recorded, surfaced — never retried
 *
 * This module only writes things down. It does NOT re-issue a payout or a
 * transfer, deliberately: Stripe runs its own retry schedule, and a second
 * transfer against an account that has just refused one is how a duplicate
 * lands. A human decides what happens next, which is the same posture the
 * refund-reversal recovery queue takes for the money Stripe refuses to pull
 * back — the sibling family of problem.
 *
 * ## Two records, because they answer different questions
 *
 * `connectPayoutFailures/{stripeId}` is the durable HISTORY, keyed by the
 * Stripe id so a redelivery converges rather than duplicating. It is written
 * even when no profile in the named collection binds the account, because
 * "money did not arrive and we cannot say whose" is precisely the state that
 * must not be silent.
 *
 * The profile documents get a MIRROR of the latest failure, because that is
 * the document the merchant and publisher surfaces already read. A card that
 * had to open a second collection would be a second, disagreeing read of the
 * same fact.
 */

/** Which leg of the money movement failed. */
export type ConnectPayoutFailureKind = 'payout' | 'transfer'

export interface ConnectPayoutFailureInput {
  /**
   * `payout` is the connected account's balance reaching its bank, and its
   * account id comes from `event.account` — the Payout object's own
   * `destination` is the BANK, not the Connect account. `transfer` is the
   * platform's balance reaching the connected account, a platform event whose
   * `destination` IS the account.
   */
  kind: ConnectPayoutFailureKind
  /** `event.data.object` — the Payout or Transfer. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  object: any
  /** The connected account the money was headed for. */
  accountId: string
  /** `event.livemode`. */
  livemode?: unknown
}

function cents(value: unknown): number {
  const amount = Math.round(Number(value ?? 0))
  return Number.isFinite(amount) ? amount : 0
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * The sentence a merchant reads. Stripe's `failure_message` is written for a
 * developer and is often absent, so the code is kept beside it and a missing
 * pair still produces something a human can act on rather than an empty
 * warning that looks like a rendering fault.
 */
export function payoutFailureReason(object: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const source = object as any
  return (
    text(source?.failure_message) ??
    text(source?.failure_code) ??
    'Stripe did not say why'
  )
}

/**
 * Records one failed payout or transfer, and mirrors it onto the profiles in
 * `collection` that bind the account.
 *
 * @returns how many profile documents were mirrored onto. `0` is an ordinary
 *   answer — the other plugin's collection binds this account, or nothing
 *   does — and never means the failure went unrecorded.
 */
export async function recordConnectPayoutFailure(
  collection: string,
  input: ConnectPayoutFailureInput,
): Promise<number> {
  const accountId = String(input?.accountId ?? '').trim()
  const stripeId = text(input?.object?.id)
  if (!accountId || !stripeId) return 0
  const firestore = firebaseAdmin.app().firestore()
  const amountCents = cents(input.object?.amount)
  const reason = payoutFailureReason(input.object)
  const failedAtMs = Date.now()

  const matches = await firestore
    .collection(collection)
    .where('stripeAccountId', '==', accountId)
    .get()

  // The durable record FIRST, and unconditionally. An account no profile binds
  // is the case with the least visibility and the most need of a written
  // trace; making the history conditional on a successful join would lose
  // exactly the failures nobody could otherwise explain.
  await firestore
    .collection('connectPayoutFailures')
    .doc(stripeId)
    .set(
      {
        kind: input.kind,
        accountId,
        amountCents,
        currency: text(input.object?.currency) ?? 'usd',
        failureCode: text(input.object?.failure_code),
        failureMessage: text(input.object?.failure_message),
        reason,
        failedAtMs,
        ...(typeof input.livemode === 'boolean'
          ? { livemode: input.livemode }
          : {}),
        // A lead a human can search, accumulated across both plugins: the same
        // account can be bound by a storefront profile and a publisher profile,
        // and each plugin records only its own.
        ...(matches.docs.length
          ? {
              boundProfiles: firebaseAdmin.firestore.FieldValue.arrayUnion(
                ...matches.docs.map((doc) => `${collection}/${doc.id}`),
              ),
            }
          : {}),
        recordedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

  // `updateExisting` rather than a merge-set, for the reason its sibling
  // states: the refs come from a query, and a merge-set would resurrect a
  // profile erased in between as a stub holding nothing but a payout warning.
  let mirrored = 0
  for (const doc of matches.docs) {
    if (
      await updateExisting(doc.ref, {
        lastPayoutFailureId: stripeId,
        lastPayoutFailureKind: input.kind,
        lastPayoutFailureAtMs: failedAtMs,
        lastPayoutFailureCents: amountCents,
        lastPayoutFailureReason: reason,
      })
    ) {
      mirrored += 1
    }
  }
  return mirrored
}

/**
 * Clears the mirrored warning when a later payout to the same account
 * succeeds.
 *
 * NOT a retry and not a correction of the history: `connectPayoutFailures`
 * keeps every failure, because "has this account failed before" is a question
 * the record exists to answer. This only stops the merchant's card asserting a
 * problem that has since resolved — a stale warning trains people to ignore
 * the surface, which costs more than it saves.
 */
export async function clearConnectPayoutFailure(
  collection: string,
  accountId: string,
): Promise<number> {
  const id = String(accountId ?? '').trim()
  if (!id) return 0
  const firestore = firebaseAdmin.app().firestore()
  const matches = await firestore
    .collection(collection)
    .where('stripeAccountId', '==', id)
    .get()
  let cleared = 0
  for (const doc of matches.docs) {
    // Only touch a profile that actually carries a warning, so an ordinary
    // successful payout does not write to every profile on every event.
    if (doc.get('lastPayoutFailureAtMs') == null) continue
    const remove = firebaseAdmin.firestore.FieldValue.delete()
    if (
      await updateExisting(doc.ref, {
        lastPayoutFailureId: remove,
        lastPayoutFailureKind: remove,
        lastPayoutFailureAtMs: remove,
        lastPayoutFailureCents: remove,
        lastPayoutFailureReason: remove,
      })
    ) {
      cleared += 1
    }
  }
  return cleared
}
