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
 * Promotion redemption-slot arithmetic (AGL-2453).
 *
 * A redemption cap was CHECKED at checkout-session creation and COUNTED at the
 * webhook, and nothing re-asked the question in between. The increments were
 * atomic and no tick was ever lost — the cap was simply never re-read. The
 * window between the two is the whole Stripe Checkout Session lifetime, up to
 * 24 hours, so this was never bounded by simultaneity: every shopper who loaded
 * checkout while a `maxRedemptions: 100` promotion sat at 99 passed the gate,
 * got the discount, and the counter finished at 99+N. Two browser tabs
 * reproduce it.
 *
 * This is the AGL-2449 gift-card shape, reused rather than re-invented: the
 * slot is HELD in a transaction at checkout and SETTLED in a transaction at the
 * webhook, against a `holds` map on the promotion document itself. One
 * document, no fan-out, no index. The differences from a gift card are only in
 * the units — a slot is one whole redemption rather than a number of cents, so
 * a hold carries no amount.
 *
 * ## Both redemption paths, or neither
 *
 * Two DIFFERENT objects carry `maxRedemptions` and both increment through the
 * same webhook helper: the typed coupon at `coupons/{code}` (AGL-96 semantics)
 * and the AGL-305 discount at `discounts/{id}`, which is evaluated over every
 * enabled promotion and applies with nothing typed at all. Holding only the
 * typed one would leave the identical silent over-redemption on the path a
 * shopper does not even opt into — a "first 50 customers" promotion enforced
 * only against whoever is not currently mid-checkout. So the arithmetic lives
 * here, in one place, shaped to fit both documents: `HeldPromotion` is the
 * three fields they have in common and nothing else.
 *
 * ## A held slot COUNTS while the session is live
 *
 * This was the owner's call, and it is recorded here because it is the thing a
 * reader will want to argue with. A held-but-unpaid slot reads as REDEEMED for
 * as long as its session can still be paid, and is released when that session
 * expires or is cancelled.
 *
 * The alternative — showing held slots separately and letting a new shopper
 * claim one — reopens the defect for exactly the duration of a live checkout.
 * The two costs are not symmetric: a promotion that oversells is money the
 * merchant did not agree to spend and cannot claw back, while a shopper who
 * sees "code unavailable" during someone else's live checkout tries again and
 * succeeds. Over-holding fails safe; under-holding fails expensive.
 *
 * ## Uncapped promotions hold NOTHING
 *
 * `maxRedemptions == null` means there is no slot to reserve, so no hold is
 * placed, no document is written at checkout, and the webhook keeps the plain
 * `increment(1)`. That is not an optimization for its own sake: it keeps the
 * common promotion — the one with no limit — on exactly the write path it had
 * before this issue, so the blast radius of the fix is the capped case only.
 *
 * ## Expiry is a backstop, not the mechanism
 *
 * Every hold carries `expiresAtMs` and every read prunes, so a crashed process
 * cannot strand a merchant's slot forever. But the release is EXPLICIT: each
 * refusal below the checkout claim drops the hold it placed, and
 * `checkout.session.expired` drops the hold of a session that will never be
 * paid. Relying on the TTL alone would mean a merchant watching a cap of 100
 * sit at 100 for a day after an abandoned cart, with nothing in the product
 * able to explain why.
 */

/**
 * One in-flight claim on a promotion slot.
 *
 * No `count`: a checkout redeems a promotion exactly once however many lines
 * it discounts, which is what the webhook's `increment(1)` has always meant.
 * A shape that could express two would invite a caller to write it.
 */
export interface PromotionHold {
  expiresAtMs: number
}

/**
 * The redemption-cap fields shared by `coupons/{code}` and `discounts/{id}`.
 *
 * Deliberately NOT a union of the two document types. The hold arithmetic must
 * behave identically on both or the fix covers one path and not the other, and
 * the cheapest way to guarantee that is to give it no way to tell them apart.
 */
export interface HeldPromotion {
  maxRedemptions?: number
  redemptions?: number
  /** Hold key → hold. Absent on every promotion written before AGL-2453. */
  holds?: Record<string, PromotionHold>
}

/**
 * Stripe Checkout Sessions expire 24h after creation, so a hold outlives any
 * session that can still be paid. A shorter TTL is not the safer choice it
 * looks like: a hold that lapsed while its session was still payable would
 * reopen the very window this closes.
 */
export const PROMOTION_HOLD_TTL_MS = 24 * 60 * 60 * 1000

/** What a shopper is told when every slot is spoken for. */
export const PROMOTION_EXHAUSTED_MESSAGE =
  'This discount has been fully redeemed'

/**
 * What a shopper is told when an AUTOMATIC promotion ran out mid-checkout.
 *
 * A separate sentence because the shopper never typed anything: "this discount
 * has been fully redeemed" reads as an accusation against a code they did not
 * enter. Naming the refresh is the recovery — the resolver counts holds too, so
 * the reloaded cart simply prices without the promotion and checks out.
 */
export const PROMOTION_UNAVAILABLE_MESSAGE =
  'A promotion on your cart has just been fully redeemed. ' +
  'Refresh your cart to see the current price.'

/**
 * The promotion's holds with the lapsed ones dropped.
 *
 * Total, not a filter over a trusted shape: a hold whose `expiresAtMs` is
 * absent or non-numeric is treated as EXPIRED rather than eternal, so a
 * malformed row releases the slot instead of stranding it. A merchant losing a
 * configured slot forever to a corrupt map entry is the one direction that has
 * no recovery inside the product.
 */
export function prunePromotionHolds(
  holds: Record<string, PromotionHold> | undefined,
  nowMs: number,
): Record<string, PromotionHold> {
  const live: Record<string, PromotionHold> = {}
  for (const [key, hold] of Object.entries(holds ?? {})) {
    const expiresAtMs = Number(hold?.expiresAtMs)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) continue
    live[key] = { expiresAtMs }
  }
  return live
}

/** Settled redemptions, coerced — a corrupt counter must not read as `-1`. */
function settledCount(promotion: HeldPromotion | undefined): number {
  const count = Math.round(Number(promotion?.redemptions ?? 0))
  return Number.isFinite(count) && count > 0 ? count : 0
}

/**
 * Slots spoken for right now: settled redemptions plus every live hold.
 *
 * `exceptHoldKey` is how a retry of one attempt does not stand in its own way.
 * The shopper presses the same button twice, the second press re-derives the
 * same hold key, and without this exclusion it would be refused its own slot.
 */
export function promotionClaimedCount(
  promotion: HeldPromotion | undefined,
  nowMs: number,
  exceptHoldKey?: string,
): number {
  const live = prunePromotionHolds(promotion?.holds, nowMs)
  if (exceptHoldKey) delete live[exceptHoldKey]
  return settledCount(promotion) + Object.keys(live).length
}

/**
 * Slots left, or `null` when the promotion is uncapped.
 *
 * `null` rather than `Infinity` so a caller cannot accidentally do arithmetic
 * on "no limit" and get a number. Never negative: a cap lowered below the
 * redemptions already taken reads as zero left, not as a debt.
 */
export function promotionRemainingSlots(
  promotion: HeldPromotion | undefined,
  nowMs: number,
  exceptHoldKey?: string,
): number | null {
  const max = Number(promotion?.maxRedemptions)
  if (promotion?.maxRedemptions == null || !Number.isFinite(max)) return null
  return Math.max(
    0,
    Math.round(max) - promotionClaimedCount(promotion, nowMs, exceptHoldKey),
  )
}

/**
 * Is there no slot left for a NEW claim?
 *
 * The one question both the pre-read (which filters a promotion out of the
 * resolver) and the in-transaction re-read (which refuses the checkout) ask, so
 * the two cannot drift apart — the drift is what AGL-2450 had to extract a
 * shared filter to prevent.
 */
export function promotionExhausted(
  promotion: HeldPromotion | undefined,
  nowMs: number,
  exceptHoldKey?: string,
): boolean {
  const remaining = promotionRemainingSlots(promotion, nowMs, exceptHoldKey)
  return remaining != null && remaining <= 0
}

/**
 * How many live checkouts are currently holding a slot.
 *
 * The merchant-facing half of the decision (AGL-2453). The console's promotion
 * and coupon cards read `redemptions / maxRedemptions`, and once a hold counts
 * as spent that figure alone would show a cap of 100 sitting at 100 with no
 * explanation for a merchant looking at 97 orders. This is what the cards name
 * separately, so "held" is a state the merchant can SEE rather than a
 * discrepancy they have to reason about.
 */
export function promotionHeldCount(
  promotion: HeldPromotion | undefined,
  nowMs: number,
): number {
  return Object.keys(prunePromotionHolds(promotion?.holds, nowMs)).length
}

/**
 * The usage line both console cards print, so the two cannot word it
 * differently. Empty string when the promotion is uncapped and nothing is held
 * — there is no cap to report against.
 */
export function promotionUsageLabel(
  promotion: HeldPromotion | undefined,
  nowMs: number,
): string {
  const held = promotionHeldCount(promotion, nowMs)
  const settled = settledCount(promotion)
  const cap =
    promotion?.maxRedemptions != null ? `/${promotion.maxRedemptions}` : ''
  if (!cap && !held) return `${settled} used`
  const heldPart = held > 0 ? ` · ${held} held in checkout` : ''
  return `${settled}${cap} used${heldPart}`
}

/**
 * Does settling `holdKey` owe the promotion a redemption?
 *
 * NOT pruned, deliberately, and this is the asymmetry that matters: a hold that
 * lapsed while its session sat unpaid is still owed once that session IS paid.
 * Expiry governs what a NEW checkout may claim, never whether a completed
 * payment is counted — dropping it here would give the shopper a discount the
 * merchant's cap never recorded, which is the original defect arriving through
 * the release path.
 *
 * A hold that is not there settles NOTHING. That is the webhook-redelivery case
 * — the first delivery consumed it — and it is what makes the settlement
 * idempotent under the at-least-once delivery `reconcile-stock.ts:52-58`
 * records this file's callers as living with.
 */
export function promotionSettles(
  promotion: HeldPromotion | undefined,
  holdKey: string,
): boolean {
  return Boolean(holdKey) && (promotion?.holds ?? {})[holdKey] != null
}
