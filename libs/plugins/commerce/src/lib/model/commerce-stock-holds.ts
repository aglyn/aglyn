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

import type { HostProduct } from './commerce'
import { canPurchase } from './commerce'

/**
 * RESERVED STOCK: the arithmetic half of the checkout hold (AGL-2356).
 *
 * ## The defect this closes
 *
 * AGL-2320 made every stock decrement atomic, so a decrement is never LOST and
 * the count never shows phantom stock. It could not make the storefront REFUSE
 * an oversell, and said so: the gate and the decrement are minutes apart with
 * money moving in between.
 *
 *   - `checkout.ts` / `cart-checkout.ts` called `canPurchase` against a plain
 *     `.get()` when the Stripe Checkout Session was created. Nothing was
 *     written, so there was no document to contend on — N concurrent shoppers
 *     all read `inventory: 1`, all passed, and no locking discipline anywhere
 *     could change that, because a read races nothing.
 *   - the decrement happened in `billing-webhook.ts` when the session
 *     completed. By then the shopper has paid, so refusing there would take
 *     money and withhold goods — worse than the oversell.
 *
 * The only correct place to refuse is session creation, and refusing there
 * requires WRITING. That is what a hold is: a unit spoken for by a live
 * checkout, subtracted from what the next shopper is offered.
 *
 * ## Why the hold does not touch `inventory`
 *
 * `inventory` means UNITS ON THE SHELF and half the product reads it that way —
 * the low-stock crossing alert, the restock queue, `reconcile-stock.ts`, the
 * ledger's `appliedDelta` cap, the console's own count. A hold is not a unit
 * leaving the shelf; it is a unit promised to someone who has not paid yet.
 * Decrementing at hold time and "converting" at settlement would make every one
 * of those readers wrong for the duration of a checkout, and would make a
 * released hold indistinguishable from a restock in the ledger.
 *
 * So the shelf count is untouched and AVAILABILITY becomes a derived figure:
 * `inventory` minus the live holds. `decrementVariantStock` is unchanged, which
 * is the point — settlement is still the same single atomic decrement it was
 * before this issue, and the hold is simply dropped afterwards.
 *
 * ## Why a lapsed hold is a release
 *
 * Every read prunes (`pruneStockHolds`), so a hold whose release never arrived
 * lapses on its own the next time anybody asks. That is what makes a leaked
 * hold a bounded inconvenience rather than the unbounded, invisible UNDER-sell
 * this issue was held back for: stock is never stranded waiting on a webhook.
 * The explicit release paths exist so the merchant and the shopper see the unit
 * come back promptly, not because correctness depends on them.
 */

/** One live reservation on a product, keyed by checkout attempt. */
export interface StockHold {
  /** Wall-clock ms after which this hold is void. */
  expiresAtMs: number
  /**
   * Variant id → units held. A map and not a single number because one cart
   * can hold two variants of one product, and a product document is the thing
   * the transaction contends on — collapsing them would make a two-variant
   * cart reserve the wrong shelf.
   */
  units?: Record<string, number>
}

/**
 * The product fields this file reads. Structural on purpose: `HostProduct`
 * carries forty fields and the hold arithmetic must not be able to depend on
 * any of them but these.
 */
export interface HeldStockProduct extends Pick<
  HostProduct,
  'variants' | 'oversellPolicy'
> {
  /** Hold key → hold. Absent on every product written before AGL-2356. */
  stockHolds?: Record<string, StockHold>
}

/**
 * HOW LONG A UNIT STAYS SPOKEN FOR.
 *
 * This number is not free to choose. A hold that lapses while its Checkout
 * Session can still be PAID reopens the exact window this file closes: the
 * shopper pays, the webhook decrements, and the unit was sold to someone else
 * in between. So the floor is the session's own lifetime.
 *
 * Stripe's default session lifetime is 24 HOURS, and a 24-hour stock hold is
 * precisely the trade this issue was blocked on — one abandoned cart standing
 * on a merchant's last unit for a day. The resolution is not to shorten the
 * hold below the session; it is to shorten the SESSION. `checkout.ts` and
 * `cart-checkout.ts` now send `expires_at` at `CHECKOUT_SESSION_TTL_MS`, which
 * is Stripe's own minimum and the same half-hour the bookings plugin has always
 * given a held room.
 *
 * The hold then outlives the session by `STOCK_HOLD_GRACE_MS`, so the ordering
 * is always: session dies → `checkout.session.expired` releases → the hold was
 * still standing when it did. The grace is what keeps clock skew between Stripe
 * and this process from lapsing a hold under a session that is still payable.
 */
/**
 * 31 minutes, not 30. Stripe REJECTS an `expires_at` less than 30 minutes in
 * the future, and it measures against its own clock at the moment the request
 * lands — so a value computed here at exactly the floor fails whenever network
 * latency or clock skew eats a second. The extra minute is the margin; it is
 * not a product opinion, and the product opinion is "the shortest session
 * Stripe will sell us".
 */
export const CHECKOUT_SESSION_TTL_MS = 31 * 60 * 1000

/** Cushion between the session expiring and its hold lapsing. */
export const STOCK_HOLD_GRACE_MS = 10 * 60 * 1000

export const STOCK_HOLD_TTL_MS = CHECKOUT_SESSION_TTL_MS + STOCK_HOLD_GRACE_MS

/**
 * What a shopper is told when the units exist but are spoken for.
 *
 * Deliberately NOT the bare "Sold out" the empty-shelf refusal uses. The
 * merchant has stock; someone else is in checkout with it. Naming the wait is
 * what stops a shopper concluding the store is empty and leaving — the hold
 * lapses within the half hour and the unit comes back.
 */
export const STOCK_HELD_MESSAGE =
  'The last of these is in someone else’s checkout. ' +
  'Try again in a few minutes.'

/**
 * The product's holds with the lapsed ones dropped.
 *
 * Total, not a filter over a trusted shape: a hold whose `expiresAtMs` is
 * absent or non-numeric is treated as EXPIRED rather than eternal. A merchant
 * losing a unit forever to one corrupt map entry is the only direction with no
 * recovery inside the product, and it is exactly the failure mode that kept
 * this issue out of the launch build.
 */
export function pruneStockHolds(
  holds: Record<string, StockHold> | undefined,
  nowMs: number,
): Record<string, StockHold> {
  const live: Record<string, StockHold> = {}
  for (const [key, hold] of Object.entries(holds ?? {})) {
    const expiresAtMs = Number(hold?.expiresAtMs)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) continue
    const units: Record<string, number> = {}
    for (const [variantId, raw] of Object.entries(hold?.units ?? {})) {
      const count = Math.round(Number(raw))
      // A non-numeric or non-positive count holds nothing. Coerced rather than
      // trusted for the same reason as the expiry: a corrupt entry must not be
      // able to reserve `NaN` units and make every comparison below false.
      if (Number.isFinite(count) && count > 0) units[variantId] = count
    }
    live[key] = { expiresAtMs, units }
  }
  return live
}

/**
 * Units of one variant spoken for by live checkouts right now.
 *
 * `exceptHoldKey` is how a retry of one attempt does not stand in its own way:
 * the shopper presses the same button twice, the second press re-derives the
 * same hold key, and without this exclusion it would be refused the unit it is
 * already holding.
 */
export function heldVariantUnits(
  product: HeldStockProduct | undefined,
  variantId: string | undefined,
  nowMs: number,
  exceptHoldKey?: string,
): number {
  if (!variantId) return 0
  const live = pruneStockHolds(product?.stockHolds, nowMs)
  if (exceptHoldKey) delete live[exceptHoldKey]
  let held = 0
  for (const hold of Object.values(live)) {
    held += Number(hold.units?.[variantId] ?? 0)
  }
  return held
}

/** Units held across every variant of a product — the console's figure. */
export function heldProductUnits(
  product: HeldStockProduct | undefined,
  nowMs: number,
): number {
  let held = 0
  for (const hold of Object.values(
    pruneStockHolds(product?.stockHolds, nowMs),
  )) {
    for (const units of Object.values(hold.units ?? {})) held += Number(units)
  }
  return held
}

/**
 * Resolve the variant a purchase refers to, EXACTLY as `canPurchase` does.
 *
 * Shared rather than re-derived, because the pre-filter and the in-transaction
 * re-check disagreeing about which variant they are talking about is a defect
 * with no visible symptom until the wrong shelf goes negative.
 */
function resolveVariant(
  product: HeldStockProduct | undefined,
  variantId: string | undefined,
) {
  return variantId
    ? product?.variants?.find((item) => item.id === variantId)
    : product?.variants?.[0]
}

/**
 * Units a NEW checkout could take: the shelf minus the live holds.
 *
 * `null` when there is no number to answer with — an untracked variant, a
 * backorder product (whose merchant chose to sell past zero, so availability is
 * unbounded by construction), or a variant that does not exist. `null` rather
 * than `Infinity` so a caller cannot do arithmetic on "no limit" and get a
 * number, and never negative: a shelf that went short under a `backorder`
 * policy reads as zero available, not as a debt.
 *
 * NOTE FOR THIS REPO: `strictNullChecks` is off, so `if (!available)` does NOT
 * distinguish `null` from `0` here — and `0` is a legitimate, load-bearing
 * answer meaning "tracked, and none left". Every caller must test `== null`.
 */
export function availableVariantUnits(
  product: HeldStockProduct | undefined,
  variantId: string | undefined,
  nowMs: number,
  exceptHoldKey?: string,
): number | null {
  const variant = resolveVariant(product, variantId)
  if (!variant) return null
  if (variant.inventory == null) return null
  if (product?.oversellPolicy === 'backorder') return null
  const onShelf = Math.round(Number(variant.inventory))
  if (!Number.isFinite(onShelf)) return null
  return Math.max(
    0,
    onShelf - heldVariantUnits(product, variant.id, nowMs, exceptHoldKey),
  )
}

/**
 * Is there a hold to take at all?
 *
 * False for the cases `availableVariantUnits` answers `null` for — an untracked
 * or backorder variant has no finite shelf to reserve against, and writing a
 * hold for one would put a growing map on a document whose availability it can
 * never change. The same shape as `holdPromotionSlot` skipping an UNCAPPED
 * promotion: the unlimited case stays off the write path entirely.
 */
export function stockIsReservable(
  product: HeldStockProduct | undefined,
  variantId: string | undefined,
  nowMs: number,
): boolean {
  return availableVariantUnits(product, variantId, nowMs) != null
}

/**
 * Can this attempt reserve `quantity` units?
 *
 * The hold-aware twin of `canPurchase`, and it must agree with it everywhere
 * `canPurchase` says NO: an untracked variant is always purchasable, a
 * backorder product always is, a missing variant never is. The single
 * difference is that a tracked deny-policy variant is measured against the
 * shelf MINUS what live checkouts are already holding.
 *
 * `canPurchase` is still the first test rather than re-derived arithmetic, so
 * the two cannot drift on the cases they share.
 */
export function canReserveStock(
  product: HeldStockProduct | undefined,
  variantId: string | undefined,
  quantity = 1,
  nowMs: number = Date.now(),
  exceptHoldKey?: string,
): boolean {
  if (!product) return false
  if (!canPurchase(product as HostProduct, variantId, quantity)) return false
  const available = availableVariantUnits(
    product,
    variantId,
    nowMs,
    exceptHoldKey,
  )
  // `== null`, never `!available` — see the note on `availableVariantUnits`.
  if (available == null) return true
  return available >= Math.max(1, Math.round(Number(quantity) || 1))
}

/**
 * What the console prints beside a stock count (AGL-2356).
 *
 * The merchant-facing half of the decision, and the reason a hold is not just
 * an internal optimisation. `inventory` deliberately does not move while a unit
 * is held, so a merchant looking at "3 in stock" while the storefront refuses
 * the third sale has no way to reason about it — the number is right and the
 * behaviour looks wrong. This is what names the gap.
 *
 * Empty string when nothing is held, so the row stays exactly as it reads today
 * on the overwhelming majority of products.
 */
export function stockHoldLabel(
  product: HeldStockProduct | undefined,
  nowMs: number = Date.now(),
): string {
  const held = heldProductUnits(product, nowMs)
  if (held <= 0) return ''
  return `${held} reserved in checkout`
}
