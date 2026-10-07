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
 * WHAT THE SYNC POSTS FROM (AGL-3614): an order, a refund and a payout, in
 * the plugin's own words.
 *
 * The accounting plugin never imports commerce. A sale reaches it as a
 * platform event — `order.paid`, `order.refunded`, `order.cancelled` — whose
 * payload the event declaration types, and a payout reaches it from the
 * merchant's own Stripe account. Each arrives here as one of these
 * snapshots, and everything downstream (the transforms, the sync log, the
 * daily summary) reads only these. A snapshot is stored on its sync item, so
 * a retry posts exactly what the first attempt tried to, even after the
 * order itself has moved on.
 *
 * Money is integer cents in the order's currency, as everywhere else.
 */

/** One line of an order. */
export interface AccountingOrderLine {
  name: string
  variantLabel?: string | null
  sku?: string | null
  quantity: number
  unitAmountCents: number
}

/** The figures an order settled at. */
export interface AccountingOrderTotals {
  itemsCents: number
  shippingCents: number
  taxCents: number
  /** Positive: money taken off. */
  discountCents: number
  totalCents: number
  /** Aglyn's platform fee on the sale: the Connect application fee. */
  feeCents: number
}

/** A paid order, as the sync posts it. */
export interface AccountingOrderSnapshot {
  orgId: string
  hostId: string
  orderId: string
  /** The human order number, per site. */
  number: number | null
  /** ISO 4217, lower or upper case. */
  currency: string
  /** When it was paid, epoch ms. */
  paidAtMs: number
  channel: string | null
  customerName: string | null
  customerEmail: string | null
  lines: AccountingOrderLine[]
  totals: AccountingOrderTotals
  /** Whether the line prices already include the tax. */
  taxInclusive: boolean
  /**
   * A finer tax key than taxed/untaxed — a manual tax rate's id — when the
   * order carried one. Mapped to a ledger tax code like the base keys.
   */
  taxKey: string | null
  /**
   * Tax the buyer paid that is NOT the merchant's: on a Stripe Tax sale Aglyn
   * is the marketplace facilitator, the tax settles into Aglyn's balance and
   * Aglyn remits it, so it never reaches the merchant's Stripe account. It is
   * already taken out of `totals` (whose `taxCents` is then 0); this records
   * how much, for the memo and for scaling a refund to the merchant's share.
   */
  marketplaceTaxCents?: number
}

/** A refund against a paid order. */
export interface AccountingRefundSnapshot {
  order: AccountingOrderSnapshot
  /** Stripe's refund id, or the order's own refund record id. */
  refundId: string
  amountCents: number
  refundedAtMs: number
  /** The platform fee given back with the refund, when it was. */
  feeRefundedCents: number
}

/** A payout from the merchant's Stripe balance to their bank. */
export interface AccountingPayoutSnapshot {
  orgId: string
  payoutId: string
  amountCents: number
  currency: string
  /** When the bank received it, epoch ms. */
  arrivedAtMs: number
  /** The bank's description of the payout, when Stripe gives one. */
  statementDescriptor: string | null
}
