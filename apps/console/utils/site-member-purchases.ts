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
 * Lifetime purchase math for site members (AGL-546). Pure — operates on
 * raw `hosts/{hostId}/orders` doc shapes (both the v1 `totals.totalCents`
 * form and the legacy flat `amountCents` form) so the member drawer can
 * compute the total from the docs it already loaded. The stale
 * `siteMembers.purchaseCents` field this replaces was never written.
 */

/** The slice of an order doc the lifetime total needs. */
export interface PurchaseTotalOrder {
  status?: string
  /** Legacy Commerce Starter flat total (cents). */
  amountCents?: number
  /** Orders v1 totals block. */
  totals?: { totalCents?: number }
  /** Cents refunded so far (partial or full). */
  refundedCents?: number
}

/**
 * Money off one order, split by the door it left through (AGL-1810).
 *
 * `refundedCents` carries a lost chargeback as well as a refund — AGL-1787
 * puts both there deliberately, and `computeLifetimePurchaseCents` below is
 * right to net the whole thing off. Only the LABEL needs the split: "refunded"
 * on money a bank took back reads as a decision the merchant made.
 *
 * This deliberately DUPLICATES `CommerceModel.splitOrderReversal`
 * (`libs/plugins/commerce/src/lib/model/commerce-dispute.ts`) rather than
 * importing it, for the same reason this file re-declares its order slice
 * instead of importing the commerce model: apps must not depend on feature
 * plugins (`scope:app` → `aglyn:addons` is a forbidden nx edge, AGL-417/419 —
 * plugins reach the apps only through the generated loader manifests). The
 * semantics mirror the model exactly, clamp included: a `reversedCents`
 * larger than `refundedCents` means the two fields disagree, and yields a
 * zero refund share rather than a negative one.
 */
export interface ReversalSplitOrder {
  refundedCents?: number
  /** The card dispute against this order's charge, when one exists. */
  dispute?: { reversedCents?: number }
}

/** `{refundedCents, chargedBackCents}` — the merchant's choice vs the bank's. */
export function splitReversalCents(order: ReversalSplitOrder): {
  refundedCents: number
  chargedBackCents: number
} {
  const total = Math.max(0, Number(order?.refundedCents ?? 0) || 0)
  const chargedBackCents = Math.min(
    total,
    Math.max(0, Number(order?.dispute?.reversedCents ?? 0) || 0),
  )
  return { refundedCents: total - chargedBackCents, chargedBackCents }
}

/** Orders that never charged the customer don't count toward lifetime. */
const UNCHARGED_STATUSES = new Set(['pending', 'cancelled'])

/** Charged cents for one order: v1 total, else legacy amount. */
export function orderChargedCents(order: PurchaseTotalOrder): number {
  return Number(order.totals?.totalCents ?? order.amountCents ?? 0) || 0
}

/**
 * Sum of what the member actually paid: charged totals minus refunds,
 * skipping never-charged (pending/cancelled) orders. Each order clamps
 * at zero so an over-recorded refund cannot drag the lifetime negative.
 */
export function computeLifetimePurchaseCents(
  orders: readonly PurchaseTotalOrder[],
): number {
  return orders.reduce((sum, order) => {
    if (UNCHARGED_STATUSES.has(String(order.status ?? ''))) return sum
    const charged = orderChargedCents(order)
    const refunded = Math.max(0, Number(order.refundedCents ?? 0) || 0)
    return sum + Math.max(0, charged - refunded)
  }, 0)
}
