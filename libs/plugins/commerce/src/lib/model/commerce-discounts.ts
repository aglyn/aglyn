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
 * Discounts engine v2 (AGL-305): code-based AND automatic promotions
 * with scoping, schedules, and usage limits, superseding the AGL-96
 * percent-only coupons (which keep working through the legacy path).
 * One resolver serves cart, checkout, and POS. Docs live at
 * `hosts/{hostId}/discounts`. Pure — callers own I/O and redemption
 * increments.
 */

import {
  PROMOTION_EXHAUSTED_MESSAGE,
  type PromotionHold,
  promotionExhausted,
} from './commerce-promotions'

export type DiscountKind = 'percent' | 'fixed' | 'free_shipping'

/** `hosts/{hostId}/discounts/{id}` doc. */
export interface HostDiscount {
  /** Uppercase entry code; absent = automatic (applies to every cart). */
  code?: string
  /** Display name for automatic promotions ("Summer sale"). */
  name?: string
  kind: DiscountKind
  /** percent kind: 1-100. */
  valuePct?: number
  /** fixed kind: cents off the items subtotal. */
  valueCents?: number
  /** Only carts at/above this subtotal qualify. */
  minSubtotalCents?: number
  /** Scope: at least one cart line must be one of these products. */
  productIds?: string[]
  maxRedemptions?: number
  redemptions?: number
  /**
   * In-flight claims on the remaining slots (AGL-2453), keyed by checkout
   * attempt. Counted as redeemed by {@link applies} for as long as they stand,
   * which is what stops N concurrent checkouts all passing a cap of one.
   */
  holds?: Record<string, PromotionHold>
  startAtMs?: number
  endAtMs?: number
  enabled?: boolean
}

export interface DiscountContext {
  /** Entered code, if any (case-insensitive). */
  code?: string
  subtotalCents: number
  /** Product ids present in the cart (scope checks). */
  productIds: string[]
  /**
   * What each cart line is worth, for pricing a SCOPED discount (AGL-2517).
   *
   * Required whenever a discount carries `productIds`, and the reason is that
   * `subtotalCents` alone cannot price one: a scope names some of the cart, so
   * the discount is worth some of the cart. A caller that omits these gets a
   * refusal rather than a whole-cart discount — see `discountBenefit`.
   */
  lines?: readonly { productId: string; amountCents: number }[]
  nowMs?: number
}

export interface ResolvedDiscount {
  discount: HostDiscount
  discountId: string
  discountCents: number
  freeShipping: boolean
  /**
   * What this discount confers, as one value. `discountCents` and
   * `freeShipping` are projections of it and are kept because callers read
   * them; the benefit is what a caller should GATE on, because it is the only
   * one of the three that can say "nothing, and here is why".
   */
  benefit: DiscountBenefit
  /** Why a specifically-entered code failed; unset when one applied. */
  codeProblem?: string
}

function applies(
  discount: HostDiscount,
  context: DiscountContext,
): string | null {
  const now = context.nowMs ?? Date.now()
  if (discount.enabled === false) return 'This discount is disabled'
  if (discount.startAtMs != null && now < discount.startAtMs) {
    return 'This discount has not started yet'
  }
  if (discount.endAtMs != null && now > discount.endAtMs) {
    return 'This discount has expired'
  }
  // Holds count (AGL-2453). This read used to be `redemptions` alone, which is
  // a figure that only moves once the webhook lands — minutes after this
  // question is asked and answered. Every shopper who reached checkout while
  // the counter sat one below the cap passed, so the cap bounded nothing but
  // the paperwork. `promotionExhausted` counts the slots currently held by live
  // checkouts as taken, which is the same question the in-transaction re-read
  // asks below in `promotion-hold.ts` — deliberately the same function, so the
  // pre-filter and the enforcement cannot drift.
  if (promotionExhausted(discount, now)) {
    return PROMOTION_EXHAUSTED_MESSAGE
  }
  if (
    discount.minSubtotalCents != null &&
    context.subtotalCents < discount.minSubtotalCents
  ) {
    return `Spend $${(discount.minSubtotalCents / 100).toFixed(2)} to use this`
  }
  if (
    discount.productIds?.length &&
    !context.productIds.some((id) => discount.productIds!.includes(id))
  ) {
    return 'This discount does not apply to your items'
  }
  return null
}

/**
 * WHAT A DISCOUNT ACTUALLY CONFERS, named rather than implied (AGL-2508).
 *
 * The whole point of this type is that "nothing" is a STATED outcome with a
 * reason, not the number zero. `valueCents` used to answer a bare `number`,
 * and every kind it did not understand — `free_shipping` included — answered
 * `0`. The cart's apply-block gates on `discountCents > 0`, and the
 * invalid-code 400 beside it only fires when NO discount resolved at all, so a
 * free-shipping code took neither branch: it resolved successfully, conferred
 * nothing, raised no error, and the shopper paid full shipping. A silent zero
 * cannot be told from "this discount is worth nothing", which is exactly the
 * distinction a money path has to make.
 *
 * So a caller cannot read a benefit without also seeing the `none` case, and a
 * kind this build does not recognise reports itself instead of underpaying.
 */
export type DiscountBenefit =
  /** Cents off the items subtotal. Always > 0 — a zero lands on `none`. */
  | { kind: 'amount'; centsOff: number }
  /** The shopper pays no shipping, whichever rate they pick. */
  | { kind: 'free-shipping' }
  /** Resolvable, but worth nothing. The caller must refuse, never proceed. */
  | { kind: 'none'; reason: string }

/**
 * The single derivation of what one discount is worth against one subtotal.
 *
 * Exhaustive over {@link DiscountKind} by construction: the `never` binding
 * below fails the BUILD when a kind is added to the union and not handled
 * here, so the next `free_shipping` cannot reach production as a silent zero.
 * The runtime arm underneath it is not redundant — Firestore documents are not
 * typechecked, and a `kind` written by a newer build than the one reading it
 * arrives as an ordinary unrecognised string.
 */
export function discountBenefit(
  discount: HostDiscount,
  subtotalCents: number,
  lines?: readonly { productId: string; amountCents: number }[],
): DiscountBenefit {
  const kind = discount.kind
  if (kind === 'percent' || kind === 'fixed') {
    // WHAT A SCOPE IS WORTH (AGL-2517).
    //
    // `applies` already refuses a cart containing NONE of the scoped products,
    // so the scope was never entirely dead — but the amount was still computed
    // against the whole subtotal. A discount scoped to three products
    // therefore discounted the entire basket the moment one of the three was
    // in it: the merchant chose a scope, we charged as though they had not,
    // and the margin went with it.
    //
    // A scoped discount with no line detail REFUSES rather than falling back
    // to the whole subtotal. The fallback is the defect restated, and it would
    // be a second pricing path for one feature split by what the caller
    // happened to pass.
    const scope = discount.productIds
    let base = subtotalCents
    if (scope?.length) {
      if (!lines) {
        return {
          kind: 'none',
          reason:
            'this discount covers only some products, and the cart did not ' +
            'say what each item costs',
        }
      }
      base = lines
        .filter((line) => scope.includes(line.productId))
        .reduce(
          (sum, line) => sum + Math.max(0, Math.round(Number(line.amountCents ?? 0))),
          0,
        )
    }
    const centsOff =
      kind === 'percent'
        ? Math.round(
            (base * Math.min(100, Math.max(0, discount.valuePct ?? 0))) / 100,
          )
        : Math.min(base, Math.max(0, discount.valueCents ?? 0))
    // A discount configured to take nothing off — 0%, or a zero amount — is
    // worth nothing, and saying so is what stops it being applied as a
    // successful reduction of zero.
    return centsOff > 0
      ? { kind: 'amount', centsOff }
      : {
          kind: 'none',
          reason: 'this discount takes nothing off the items in the cart',
        }
  }
  if (kind === 'free_shipping') return { kind: 'free-shipping' }
  // Unreachable while `DiscountKind` is fully handled above; the annotation is
  // what makes adding a kind a compile error rather than a quiet no-op.
  const unhandled: never = kind
  return {
    kind: 'none',
    reason: `this store has a discount of a kind this site cannot apply (${String(
      unhandled,
    )})`,
  }
}

/**
 * Best applicable discount: an entered code wins when valid (its
 * failure reason is surfaced); otherwise the largest automatic
 * promotion applies. Discounts never stack — Squarespace/Shopify
 * baseline semantics.
 */
export function resolveDiscount(
  discounts: Array<HostDiscount & { $id: string }>,
  context: DiscountContext,
): ResolvedDiscount | null {
  const entered = context.code?.trim().toUpperCase()
  if (entered) {
    const coded = discounts.find(
      (discount) => discount.code?.toUpperCase() === entered,
    )
    if (!coded) return null
    const problem = applies(coded, context)
    if (problem) {
      return {
        discount: coded,
        discountId: coded.$id,
        discountCents: 0,
        freeShipping: false,
        benefit: { kind: 'none', reason: problem },
        codeProblem: problem,
      }
    }
    const benefit = discountBenefit(coded, context.subtotalCents, context.lines)
    // A code the shopper TYPED that turns out to be worth nothing is reported
    // as a code problem, so it leaves through the caller's existing refusal
    // rather than as a successful discount of zero. This is the free-shipping
    // defect's actual exit: the caller's apply-block tests `discountCents > 0`
    // and its invalid-code branch only fires when nothing resolved, so a
    // benefit of `none` used to satisfy neither and the shopper was charged in
    // full without a word.
    if (benefit.kind === 'none') {
      return {
        discount: coded,
        discountId: coded.$id,
        discountCents: 0,
        freeShipping: false,
        benefit,
        codeProblem: benefit.reason,
      }
    }
    return {
      discount: coded,
      discountId: coded.$id,
      discountCents: benefit.kind === 'amount' ? benefit.centsOff : 0,
      freeShipping: benefit.kind === 'free-shipping',
      benefit,
    }
  }
  let best: ResolvedDiscount | null = null
  for (const discount of discounts) {
    if (discount.code) continue
    if (applies(discount, context)) continue
    const benefit = discountBenefit(discount, context.subtotalCents, context.lines)
    // An automatic promotion worth nothing is passed over rather than reported:
    // nobody asked for it, so there is no shopper to answer and a better one
    // may still be in the list. An entered CODE is the opposite case and
    // refuses above — the shopper made a request and is owed the reason.
    if (benefit.kind === 'none') continue
    const cents = benefit.kind === 'amount' ? benefit.centsOff : 0
    const candidate: ResolvedDiscount = {
      discount,
      discountId: discount.$id,
      discountCents: cents,
      freeShipping: benefit.kind === 'free-shipping',
      benefit,
    }
    if (
      !best ||
      cents > best.discountCents ||
      (candidate.freeShipping && !best.freeShipping && cents === best.discountCents)
    ) {
      best = candidate
    }
  }
  return best
}
