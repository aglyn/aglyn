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
  nowMs?: number
}

export interface ResolvedDiscount {
  discount: HostDiscount
  discountId: string
  discountCents: number
  freeShipping: boolean
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

function valueCents(
  discount: HostDiscount,
  subtotalCents: number,
): number {
  if (discount.kind === 'percent') {
    const pct = Math.min(100, Math.max(0, discount.valuePct ?? 0))
    return Math.round((subtotalCents * pct) / 100)
  }
  if (discount.kind === 'fixed') {
    return Math.min(subtotalCents, Math.max(0, discount.valueCents ?? 0))
  }
  return 0
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
        codeProblem: problem,
      }
    }
    return {
      discount: coded,
      discountId: coded.$id,
      discountCents: valueCents(coded, context.subtotalCents),
      freeShipping: coded.kind === 'free_shipping',
    }
  }
  let best: ResolvedDiscount | null = null
  for (const discount of discounts) {
    if (discount.code) continue
    if (applies(discount, context)) continue
    const cents = valueCents(discount, context.subtotalCents)
    const candidate: ResolvedDiscount = {
      discount,
      discountId: discount.$id,
      discountCents: cents,
      freeShipping: discount.kind === 'free_shipping',
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
