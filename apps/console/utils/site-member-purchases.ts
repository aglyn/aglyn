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
