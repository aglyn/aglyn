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
 * Orders model v1 (AGL-283): line items snapshot the product/variant at
 * purchase time (renames and price changes never rewrite history), a
 * small status machine gates transitions, and totals are integer cents.
 * Docs live at `hosts/{hostId}/orders/{id}`; the Stripe webhook creates
 * them and the orders console (AGL-287) drives transitions. Pure — no
 * I/O here.
 */

import type { ProductType } from './commerce'

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'delivered'
  | 'cancelled'
  | 'refunded'

export type OrderChannel = 'online' | 'pos' | 'draft'

/** Snapshot of what was bought — self-contained for history. */
export interface OrderLineItem {
  productId: string
  variantId?: string
  /** Display snapshot at purchase time. */
  name: string
  variantLabel?: string
  sku?: string
  productType?: ProductType
  quantity: number
  /** Per-unit price in cents at purchase time. */
  unitAmountCents: number
  /** Supplier at purchase time (dropship routing, AGL-289). */
  supplierId?: string
  /** Fulfillment id once this line ships (AGL-288). */
  fulfillmentId?: string
}

export interface OrderTotals {
  itemsCents: number
  shippingCents: number
  taxCents: number
  /** Positive number subtracted from the total. */
  discountCents: number
  totalCents: number
  /** Aglyn platform fee (Connect application fee, AGL-278/307). */
  feeCents: number
}

export interface OrderAddress {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  phone?: string
}

export interface OrderTimelineEvent {
  atMs: number
  /** Machine event key, e.g. 'paid', 'fulfilled', 'refund', 'note'. */
  event: string
  /** Human-readable detail shown in the console timeline. */
  detail?: string
}

export interface OrderFulfillment {
  id: string
  lineItemIds: number[]
  carrier?: string
  trackingNumber?: string
  trackingUrl?: string
  atMs: number
}

/** `hosts/{hostId}/orders/{id}` doc. */
export interface HostOrder {
  /** Human order number, sequential per host (e.g. #1042). */
  number?: number
  status: OrderStatus
  channel?: OrderChannel
  lineItems?: OrderLineItem[]
  totals?: OrderTotals
  customerEmail?: string | null
  customerName?: string | null
  /** Storefront customer id once accounts exist (AGL-294). */
  customerId?: string
  shippingAddress?: OrderAddress
  billingAddress?: OrderAddress
  timeline?: OrderTimelineEvent[]
  fulfillments?: OrderFulfillment[]
  note?: string
  couponCode?: string
  /** Stripe references for refunds. */
  paymentIntentId?: string
  checkoutSessionId?: string
  /** Draft orders (AGL-287): the link sent to the buyer. */
  paymentLinkUrl?: string
  refundedCents?: number
  createdAtMs?: number
  // Legacy Commerce Starter fields (AGL-90) kept readable.
  productId?: string
  amountCents?: number
  feeCents?: number
}

/**
 * Legal status transitions. Refund/cancel policies: anything paid can
 * refund; only unfulfilled orders cancel (refund instead once shipped).
 */
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['partially_fulfilled', 'fulfilled', 'cancelled', 'refunded'],
  partially_fulfilled: ['fulfilled', 'refunded'],
  fulfilled: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
}

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to)
}

/** Sums line items and folds in shipping/tax/discount/fee, all cents. */
export function computeOrderTotals(
  lineItems: OrderLineItem[],
  parts?: Partial<Pick<OrderTotals, 'shippingCents' | 'taxCents' | 'discountCents' | 'feeCents'>>,
): OrderTotals {
  const itemsCents = lineItems.reduce(
    (sum, line) =>
      sum + Math.max(0, Math.round(line.unitAmountCents * line.quantity)),
    0,
  )
  const shippingCents = Math.max(0, Math.round(parts?.shippingCents ?? 0))
  const taxCents = Math.max(0, Math.round(parts?.taxCents ?? 0))
  const discountCents = Math.min(
    Math.max(0, Math.round(parts?.discountCents ?? 0)),
    itemsCents + shippingCents,
  )
  return {
    itemsCents,
    shippingCents,
    taxCents,
    discountCents,
    feeCents: Math.max(0, Math.round(parts?.feeCents ?? 0)),
    totalCents: itemsCents + shippingCents + taxCents - discountCents,
  }
}

/**
 * The completed Checkout Session fields an online order's totals are built
 * from. Typed structurally rather than against Stripe's SDK: the plugin talks
 * to Stripe over raw `fetch` and never installs the package.
 */
export interface CheckoutSessionTotalsSource {
  amount_total?: unknown
  total_details?: {
    amount_tax?: unknown
    amount_shipping?: unknown
    amount_discount?: unknown
  } | null
}

/**
 * Stored `OrderTotals` for an `online` order, from the completed session.
 *
 * AGL-1698: the webhook used to read `amount_tax` and `amount_discount` and
 * silently skip their third sibling, so `computeOrderTotals` defaulted
 * `shippingCents` to 0 on every online order while the shipping the shopper
 * paid sat inside `amount_total`. The stored parts then did not sum to the
 * stored total, and every merchant reconciling their own books against these
 * records understated shipping by exactly the amount charged. `amount_shipping`
 * is the figure to read — `shipping_cost.amount_total` carries the same number
 * but is null unless a rate was chosen, whereas `total_details.amount_shipping`
 * is always present and sits beside the two fields already read.
 *
 * `totalCents` still comes from Stripe's `amount_total` verbatim rather than
 * from our arithmetic: `itemsCents` is priced from the host's product docs, so
 * a price edit between session creation and webhook delivery would otherwise
 * make our sum, not Stripe's charge, the stored truth. With shipping passed the
 * two agree by construction — which is now an invariant a fixture can pin
 * rather than a discrepancy that papers over a missing part.
 *
 * Note this also unclamps the discount correctly: `computeOrderTotals` caps
 * `discountCents` at `itemsCents + shippingCents`, so a discount that reached
 * into shipping was previously clamped down as well.
 */
export function computeCheckoutSessionTotals(
  lineItems: OrderLineItem[],
  session: CheckoutSessionTotalsSource | null | undefined,
  parts?: Pick<OrderTotals, 'feeCents'> | { feeCents?: number },
): OrderTotals {
  const details = session?.total_details ?? {}
  const totals = computeOrderTotals(lineItems, {
    feeCents: Number(parts?.feeCents ?? 0),
    taxCents: Number(details?.amount_tax ?? 0),
    shippingCents: Number(details?.amount_shipping ?? 0),
    discountCents: Number(details?.amount_discount ?? 0),
  })
  const amountTotal = Number(session?.amount_total ?? NaN)
  return {
    ...totals,
    totalCents: Number.isFinite(amountTotal) ? amountTotal : totals.totalCents,
  }
}

/** Display form: `#1042`; falls back to a doc-id stub for legacy rows. */
export function formatOrderNumber(order: Pick<HostOrder, 'number'>, docId?: string): string {
  if (order.number != null) return `#${order.number}`
  return docId ? `#${docId.slice(-6).toUpperCase()}` : '#—'
}

/**
 * Lifts a legacy Commerce Starter order row (flat productId/amountCents)
 * into the v1 shape for display; already-shaped orders pass through.
 */
export function liftLegacyOrder(raw: Partial<HostOrder>): HostOrder {
  if (Array.isArray(raw.lineItems) && raw.lineItems.length > 0) {
    return { status: 'paid', ...raw } as HostOrder
  }
  const amountCents = Number(raw.amountCents ?? 0)
  return {
    ...raw,
    status: raw.status ?? 'paid',
    channel: raw.channel ?? 'online',
    lineItems: raw.productId
      ? [
          {
            productId: raw.productId,
            name: 'Product',
            quantity: 1,
            unitAmountCents: amountCents,
          },
        ]
      : [],
    totals: raw.totals ?? {
      itemsCents: amountCents,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      feeCents: Number(raw.feeCents ?? 0),
      totalCents: amountCents,
    },
  }
}

/** Appends a timeline event immutably (webhook + console share this). */
export function appendOrderEvent(
  order: Pick<HostOrder, 'timeline'>,
  event: string,
  detail?: string,
  atMs = Date.now(),
): OrderTimelineEvent[] {
  return [...(order.timeline ?? []), { atMs, event, ...(detail ? { detail } : {}) }]
}
