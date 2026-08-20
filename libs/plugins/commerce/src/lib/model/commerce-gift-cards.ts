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
 * Gift-card hold arithmetic (AGL-2449).
 *
 * A gift card is CASH, and until this module existed it was the one limited
 * resource in the order path with no reserve at all. `cart-checkout.ts` read
 * `balanceCents` with a plain `.get()`, minted a Stripe coupon for that much,
 * and the webhook decremented the card minutes later with a bare
 * `FieldValue.increment(-N)`. The increment is atomic, so nothing was ever
 * LOST — but nothing ever CHECKED either, so two checkouts entering the same
 * code both read $50, both got $50 off, and the card settled at `-$50`. The
 * merchant shipped $100 of goods against a $50 card, and the outstanding
 * liability total went negative — the exact corruption `redeemExistingOrRecord`
 * already reasons about for a DELETED card, arriving through a live one.
 *
 * The stock fix (AGL-2320) could not be copied here: stock is decremented after
 * the money has moved and therefore cannot refuse, so it locks and reports the
 * shortfall. A gift card is applied BEFORE Stripe is contacted, so this door can
 * still say no — and refusing is the only thing that actually keeps the money.
 *
 * So the balance is HELD at checkout and SETTLED at the webhook, both in one
 * transaction against one document. Holds live in a map on the card itself
 * keyed by Stripe session id, which is what keeps this to a single-document
 * transaction: no fan-out, no second collection, no index.
 *
 * ## Why holds expire rather than being swept
 *
 * An abandoned checkout must not stand a customer's money off indefinitely, and
 * a sweep job is the wrong instrument: `process-abandoned.ts` is the only
 * existing sweep and it returns 501 when SMTP is unconfigured, so a
 * release that depended on it would not run at all for a self-hosted store with
 * no mail transport. Instead every hold carries `expiresAtMs` and EVERY read
 * prunes, so the release is a consequence of the next read rather than of a job
 * that may never run. A card nobody touches again holds nothing that matters,
 * because nobody is reading it either.
 *
 * The TTL matches Stripe's Checkout Session lifetime rather than something
 * shorter. A hold that lapsed while its session was still payable would reopen
 * the very window this closes — the shopper pays a session whose hold has
 * evaporated and the balance is spent twice again.
 */

/** One in-flight claim on a card's balance, keyed by Stripe session id. */
export interface GiftCardHold {
  cents: number
  expiresAtMs: number
}

/** `hosts/{hostId}/giftCards/{code}` doc, as far as redemption cares. */
export interface HostGiftCard {
  balanceCents?: number
  /** Session id → hold. Absent on every card issued before AGL-2449. */
  holds?: Record<string, GiftCardHold>
  voidedAtMs?: number
}

/**
 * Stripe Checkout Sessions expire 24h after creation, so a hold outlives any
 * session that can still be paid. See the module docblock for why a shorter
 * TTL is not the safer choice it looks like.
 */
export const GIFT_CARD_HOLD_TTL_MS = 24 * 60 * 60 * 1000

/** One money figure off an untrusted document, as whole non-negative cents. */
function cents(value: unknown): number {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * The card's holds with the lapsed ones dropped.
 *
 * Total, not a filter over a trusted shape: a hold whose `expiresAtMs` is
 * absent or non-numeric is treated as EXPIRED rather than eternal, so a
 * malformed row releases the money instead of stranding it. The one direction
 * that cannot be wrong is the one that keeps a customer from spending their own
 * balance forever.
 */
export function pruneGiftCardHolds(
  holds: Record<string, GiftCardHold> | undefined,
  nowMs: number,
): Record<string, GiftCardHold> {
  const live: Record<string, GiftCardHold> = {}
  for (const [sessionId, hold] of Object.entries(holds ?? {})) {
    const expiresAtMs = Number(hold?.expiresAtMs)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) continue
    const amount = cents(hold?.cents)
    if (amount > 0) live[sessionId] = { cents: amount, expiresAtMs }
  }
  return live
}

/**
 * What a NEW checkout may apply: the balance less every hold still standing.
 *
 * Never negative. A card whose holds already exceed its balance (possible only
 * on a card voided mid-flight, where the console zeroes `balanceCents` while
 * holds stand) reads as empty rather than as a debt to be collected.
 */
export function giftCardAvailableCents(
  card: HostGiftCard | undefined,
  nowMs: number,
): number {
  const held = Object.values(pruneGiftCardHolds(card?.holds, nowMs)).reduce(
    (sum, hold) => sum + hold.cents,
    0,
  )
  return Math.max(0, cents(card?.balanceCents) - held)
}

/**
 * What settling `sessionId` should actually take off the card.
 *
 * Capped at the live balance, not at the hold, and that is the point of the
 * function. The hold is what this session RESERVED; the balance is what the
 * card can still give up. They diverge when the card was voided or hand-adjusted
 * between the hold and the payment, and in that window paying out the hold would
 * drive the balance negative — reintroducing the corrupted liability aggregate
 * from the other side.
 *
 * A session with no hold settles ZERO. That is the redelivery case (the first
 * delivery consumed it) and the pre-AGL-2449 case (a session that predates
 * holds), and both must be no-ops rather than a second decrement.
 */
export function giftCardSettlementCents(
  card: HostGiftCard | undefined,
  sessionId: string,
  // Deliberately unused, and kept so this reads as the sibling of
  // `giftCardAvailableCents` at every call site. The asymmetry IS the rule
  // below: availability is a question about now, settlement is not.
  _nowMs: number,
): number {
  // NOT pruned: a hold that lapsed while its session sat unpaid is still owed
  // once that session is paid. Expiry governs what a NEW checkout may claim,
  // never whether a completed payment is honoured — dropping it here would take
  // the discount from the shopper and give nothing back to the merchant.
  const hold = (card?.holds ?? {})[sessionId]
  return Math.min(cents(hold?.cents), cents(card?.balanceCents))
}
