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

import * as CommerceModel from '../model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { randomUUID } from 'crypto'

/**
 * Reserve-then-settle for promotion redemption slots (AGL-2453).
 *
 * The I/O half of `model/commerce-promotions.ts` — read that file first; it
 * carries the decision this one implements. Three call sites share it, and
 * sharing is the point: the typed coupon (`coupons/{code}`), the automatic
 * AGL-305 discount (`discounts/{id}`) and buy-now's coupon are three doors onto
 * the same counter, and a hold placed at one of them has to be visible at the
 * other two. Three copies of this transaction would be three chances for one of
 * them to drift back to a plain `.get()`.
 */

/** What a placed hold gives back to the caller. */
export interface PromotionSlotHold {
  /**
   * The key the hold was stored under, or `''` when the promotion is uncapped
   * and no hold was needed. Carried in the session metadata so the webhook can
   * settle exactly this reservation; its absence is what tells the webhook to
   * fall back to the unconditional increment.
   */
  holdKey: string
  /**
   * Drop the hold. Called by every refusal BELOW the checkout claim, and by
   * `checkout.session.expired`. Best-effort and never throws: the TTL is the
   * backstop, and tidying a reservation must not turn a clean 400 into a 500.
   */
  release: () => Promise<void>
}

/**
 * Why a slot could not be claimed.
 *
 * - `exhausted` — every slot is spoken for, by a settled redemption or a live
 *   hold. The one refusal a shopper is told about by name.
 * - `missing` — the promotion document is gone, deleted between the resolver's
 *   read and this transaction.
 * - `error` — Firestore refused. The discount is REFUSED rather than given
 *   away uncounted: a promotion applied against a counter that could not be
 *   reserved is the defect this file exists to close.
 */
export type PromotionSlotRefusal = 'exhausted' | 'missing' | 'error'

/**
 * Written as a two-member union with `reason` on BOTH members rather than a
 * `{ ok: true } & PromotionSlotHold` intersection. Discriminated-union
 * narrowing does not reach through the intersection under this repo's compiler
 * settings (`strictNullChecks` is off repo-wide), so the intersection form
 * compiled to `Property 'reason' does not exist` at every call site.
 */
export type PromotionSlotOutcome =
  | { ok: true; reason?: undefined; holdKey: string; release: () => Promise<void> }
  | { ok: false; reason: PromotionSlotRefusal }

/**
 * A stable per-attempt hold key.
 *
 * `claim.stripeKey` when the client sent an Idempotency-Key, so a retry of one
 * attempt re-claims its OWN slot rather than being refused by it. When it did
 * not, a fresh random key per request — NOT the literal string `'null'`, which
 * is what `String(claim.stripeKey)` yields and which would make every keyless
 * shopper on the site share one hold. Sharing a hold key is the defect: two
 * shoppers would each read the other's reservation as their own retry and both
 * pass a cap of one.
 *
 * A keyless retry therefore holds a second slot. That is the safe direction —
 * it over-reserves and releases on refusal or expiry — and the keyless path is
 * already recorded as a real hole in `api-idempotency.ts` (AGL-2163) rather
 * than something this fix can close.
 */
export function promotionHoldKey(stripeKey: string | null): string {
  return stripeKey || `anon-${randomUUID()}`
}

/**
 * Claim one redemption slot, or refuse.
 *
 * The re-check and the write are ONE transaction over the SAME document, which
 * is the whole fix: the old code read the counter with a plain `.get()` at
 * session creation and the webhook incremented it minutes later without ever
 * re-asking. Firestore aborts and re-runs this callback if the promotion
 * changed between the read and the commit, so two checkouts contending for the
 * last slot cannot both observe it free.
 *
 * An UNCAPPED promotion writes nothing at all and returns an empty `holdKey`.
 * There is no slot to reserve, and keeping the unlimited case off this write
 * path keeps the fix's blast radius on the capped case.
 */
export async function holdPromotionSlot(options: {
  firestore: FirebaseFirestore.Firestore
  ref: FirebaseFirestore.DocumentReference
  holdKey: string
  nowMs?: number
  /** Label for the failure log; never shown to a shopper. */
  label: string
}): Promise<PromotionSlotOutcome> {
  const { firestore, ref, holdKey, label } = options
  const nowMs = options.nowMs ?? Date.now()
  const outcome = await firestore
    .runTransaction(async (transaction) => {
      const fresh = await transaction.get(ref)
      if (!fresh.exists) return 'missing' as const
      const promotion = (fresh.data() ?? {}) as CommerceModel.HeldPromotion
      // Uncapped: nothing to reserve, and nothing written. The webhook keeps
      // the plain `increment(1)` for these, exactly as before this issue.
      if (
        CommerceModel.promotionRemainingSlots(promotion, nowMs, holdKey) == null
      ) {
        return 'uncapped' as const
      }
      // This attempt's own prior hold does not stand in its way — a retry must
      // be able to re-claim what it already reserved, or the second press of
      // the same button refuses the shopper a slot they are already holding.
      if (CommerceModel.promotionExhausted(promotion, nowMs, holdKey)) {
        return 'exhausted' as const
      }
      // Lapsed holds are removed by SENTINEL, never by writing back a locally
      // pruned copy of the map: `set(…, { merge: true })` DEEP-merges nested
      // maps, so an object with the key removed leaves the stored key exactly
      // where it was. Correctness does not depend on the sweep — every read
      // prunes again — but without it the document grows one dead key per
      // abandoned checkout, forever. The same sentinel is load-bearing at
      // SETTLEMENT below, where writing back a pruned map would leave the hold
      // standing and let a webhook redelivery count the redemption twice.
      const live = CommerceModel.prunePromotionHolds(promotion.holds, nowMs)
      const swept: Record<string, unknown> = {}
      for (const stale of Object.keys(promotion.holds ?? {})) {
        if (stale !== holdKey && !live[stale]) {
          swept[stale] = firebaseAdmin.firestore.FieldValue.delete()
        }
      }
      transaction.set(
        ref,
        {
          holds: {
            ...swept,
            [holdKey]: {
              expiresAtMs: nowMs + CommerceModel.PROMOTION_HOLD_TTL_MS,
            },
          },
        },
        { merge: true },
      )
      return 'held' as const
    })
    .catch((error: unknown) => {
      console.error('Promotion hold failed', label, error)
      return 'error' as const
    })
  if (outcome === 'uncapped') {
    return { ok: true, holdKey: '', release: async () => undefined }
  }
  if (outcome === 'held') {
    return { ok: true, holdKey, release: () => releasePromotionHold(ref, holdKey) }
  }
  return { ok: false, reason: outcome }
}

/**
 * Give a slot back.
 *
 * A bare merge-set with the delete sentinel rather than a transaction: removing
 * one key is not a read-modify-write, and a release must not be able to fail
 * the response it is tidying up after. Swallows its own error for the same
 * reason — the TTL still releases the slot.
 */
export async function releasePromotionHold(
  ref: FirebaseFirestore.DocumentReference,
  holdKey: string,
): Promise<void> {
  if (!holdKey) return
  await ref
    .set(
      { holds: { [holdKey]: firebaseAdmin.firestore.FieldValue.delete() } },
      { merge: true },
    )
    .catch((error: unknown) => {
      console.error('Promotion hold release failed', ref.path, error)
    })
}

/** What a settlement did, for the caller's orphan reporting. */
export type PromotionSettlement =
  /** The hold was found and converted into a redemption. */
  | 'settled'
  /** No hold under this key: a redelivery, already counted. Do nothing. */
  | 'already-settled'
  /** The promotion document is gone; the redemption cannot be recorded. */
  | 'missing'
  /** Firestore refused; the hold stands and lapses on its own. */
  | 'error'

/**
 * Convert a held slot into a counted redemption.
 *
 * Idempotent under Stripe's at-least-once delivery, which is the property
 * `reconcile-stock.ts:52-58` asks any webhook-side guard on these counters to
 * have: the redemption is owed only by the presence of the HOLD, so a second
 * delivery finds none and takes nothing. The increment and the removal are one
 * write, so there is no window in which the slot is both counted and held.
 */
export async function settlePromotionSlot(options: {
  firestore: FirebaseFirestore.Firestore
  ref: FirebaseFirestore.DocumentReference
  holdKey: string
  label: string
}): Promise<PromotionSettlement> {
  const { firestore, ref, holdKey, label } = options
  return await firestore
    .runTransaction(async (transaction) => {
      const fresh = await transaction.get(ref)
      if (!fresh.exists) return 'missing' as const
      const promotion = (fresh.data() ?? {}) as CommerceModel.HeldPromotion
      if (!CommerceModel.promotionSettles(promotion, holdKey)) {
        return 'already-settled' as const
      }
      transaction.set(
        ref,
        {
          redemptions: firebaseAdmin.firestore.FieldValue.increment(1),
          // `FieldValue.delete()`, NOT a pruned copy of the map — see the note
          // in `holdPromotionSlot`. A merged-back object would leave the hold
          // standing and a redelivery would increment a SECOND time.
          holds: {
            [holdKey]: firebaseAdmin.firestore.FieldValue.delete(),
          },
        },
        { merge: true },
      )
      return 'settled' as const
    })
    .catch((error: unknown) => {
      console.error('Promotion settlement failed', label, error)
      return 'error' as const
    })
}
