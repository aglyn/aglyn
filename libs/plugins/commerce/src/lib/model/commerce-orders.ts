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
export interface CheckoutSessionTotalsParts {
  /** Aglyn's cut, from the session metadata rather than from Stripe. */
  feeCents?: number
  /**
   * Tax we charged as an ordinary Stripe line item (AGL-1711). It is inside
   * `amount_total` but Stripe was never told it was tax, so it is absent from
   * `total_details.amount_tax` and has to be supplied by the caller that built
   * the session. Added to Stripe's figure, not substituted for it: the two are
   * mutually exclusive by construction — `checkout.ts` adds the manual line
   * only in `manual` tax mode and sets `automatic_tax` only in `stripe` mode —
   * so summing is right in every reachable case and correct in principle if
   * both were ever charged at once.
   */
  lineItemTaxCents?: number
  /**
   * A discount applied by lowering the unit price we sent to Stripe rather
   * than as a Stripe discount (AGL-1711). Same shape as `lineItemTaxCents`:
   * invisible to `total_details.amount_discount`, so it is added to it.
   */
  pricedInDiscountCents?: number
}

export function computeCheckoutSessionTotals(
  lineItems: OrderLineItem[],
  session: CheckoutSessionTotalsSource | null | undefined,
  parts?: CheckoutSessionTotalsParts,
): OrderTotals {
  const details = session?.total_details ?? {}
  const totals = computeOrderTotals(lineItems, {
    feeCents: Number(parts?.feeCents ?? 0),
    taxCents:
      Number(details?.amount_tax ?? 0) + Number(parts?.lineItemTaxCents ?? 0),
    shippingCents: Number(details?.amount_shipping ?? 0),
    discountCents:
      Number(details?.amount_discount ?? 0) +
      Number(parts?.pricedInDiscountCents ?? 0),
  })
  const amountTotal = Number(session?.amount_total ?? NaN)
  return {
    ...totals,
    totalCents: Number.isFinite(amountTotal) ? amountTotal : totals.totalCents,
  }
}

/** Non-negative integer cents from an untyped metadata value; 0 otherwise. */
function metadataCents(value: unknown): number {
  const cents = Math.round(Number(value ?? 0))
  return Number.isFinite(cents) && cents > 0 ? cents : 0
}

/** The buy-now Checkout Session as the webhook sees it — metadata included. */
export interface BuyNowSessionSource extends CheckoutSessionTotalsSource {
  metadata?: Record<string, unknown> | null
}

/** What the host's product doc contributes to the line-item snapshot. */
export interface BuyNowProductSnapshot {
  /** Product name at purchase time. */
  name: string
  /** Joined variant options, e.g. `Large / Blue`. */
  variantLabel?: string
  sku?: string
  productType?: ProductType
  supplierId?: string
}

/**
 * The stored line items and totals for a `commerce-order` (buy-now) session
 * (AGL-1711).
 *
 * ## What was wrong
 *
 * The webhook built the whole order from one number — it read
 * `object.amount_total` into `amountCents`, wrote a single line item with
 * `quantity` literal 1 and `unitAmountCents` set to that `amountCents`, and
 * passed `computeOrderTotals` nothing but `feeCents`.
 *
 * `amount_total` is the ENTIRE charge, so the merchant's record said the
 * product's unit price was the whole session total, that one unit was sold, and
 * that tax and discount were zero. A 3 × $100 purchase recorded as 1 × $300.
 *
 * The dangerous property, and why this outlived AGL-1698: it is not internally
 * inconsistent. `itemsCents` equalled `totalCents`, so the parts summed and any
 * arithmetic check passed while every individual component was wrong. The
 * useful test is not "do the parts sum" but "does each part match what Stripe
 * actually charged", which is what the fixtures assert component by component.
 *
 * ## Why metadata, when AGL-1698's lesson was to read Stripe's own fields
 *
 * Two of the four parts are genuinely absent from Stripe's decomposition, and
 * `checkout.ts` is what hid them:
 *
 * - **Tax.** In `manual` mode the tax is appended as `line_items[1]`, a normal
 *   product line labelled e.g. "Tax (8.25%)". Stripe does not know it is tax,
 *   so `total_details.amount_tax` is 0 while the money sits in `amount_total`.
 *   (In `stripe` mode `automatic_tax` makes `amount_tax` real — and it was not
 *   read either, so that tax was lost as well.)
 * - **Discount.** A host coupon is applied by lowering the unit price we send,
 *   not as a Stripe discount, so `total_details.amount_discount` is 0.
 *
 * So `checkout.ts` now records both figures, plus the list unit price, in the
 * session metadata as it computes them. This is NOT the reconstruction AGL-1698
 * warned against: the guard there is against pricing from the host's product
 * docs at webhook time, where an edit between session creation and delivery
 * makes our sum disagree with the actual charge. Metadata is a snapshot of the
 * numbers we handed Stripe, frozen at session creation, so it cannot drift.
 * Everything Stripe does know — `amount_total`, `amount_tax`, `amount_shipping`,
 * `amount_discount` — still comes from Stripe, via the shared
 * `computeCheckoutSessionTotals` rather than a parallel decomposition.
 *
 * Shipping is read even though `checkout.ts` declares no `shipping_options`
 * today (AGL-1720): the read is not conditioned on that, so the figure lands on
 * its own the moment buy-now starts charging shipping.
 *
 * ## Sessions created before this change
 *
 * They carry `quantity` (always sent) but none of the three new keys, so the
 * unit price falls back to what Stripe charged per unit, derived from
 * `amount_total` with tax, shipping and discount taken back out. Those orders
 * still reconcile against `amount_total` and their quantity is now right; what
 * cannot be recovered is a priced-in coupon, which stays folded into the unit
 * price exactly as it is today. Deriving from the product doc instead would
 * make `itemsCents` gross with no matching `discountCents`, breaking the sum.
 *
 * ## Worked example — the spec fixture
 *
 * Three $100 units, a 10% host coupon, manual destination tax at 8.25%:
 *
 *   listUnit              10000   metadata `unitAmountCents`
 *   × quantity                3   metadata `quantity`
 *   = itemsCents          30000
 *   - discountCents        3000   metadata `discountCents` (priced into the
 *                                 9000 unit price sent to Stripe)
 *   + taxCents             2228   metadata `taxCents` (Stripe `line_items[1]`;
 *                                 `total_details.amount_tax` is 0)
 *   + shippingCents           0   Stripe `total_details.amount_shipping`
 *   = totalCents          29228   Stripe `amount_total`, verbatim
 *
 * The pre-fix record for the same purchase: `1 × 29228`, tax 0, discount 0 —
 * which also sums to 29228.
 *
 * ## Also the subscription sale record (AGL-1732)
 *
 * `checkout.ts` builds a subscription session with the same function and the
 * same metadata snapshot — only `mode` differs — so the initial charge of a
 * storefront subscription decomposes identically. The webhook's
 * `commerce-subscription` branch stores the result on the subscription
 * document rather than as an order; the arithmetic is the same either way,
 * which is why it lives here and is not duplicated there.
 */
export function computeBuyNowOrder(
  session: BuyNowSessionSource | null | undefined,
  snapshot: BuyNowProductSnapshot,
): { lineItems: OrderLineItem[]; totals: OrderTotals } {
  const metadata = (session?.metadata ?? {}) as Record<string, unknown>
  const details = session?.total_details ?? {}
  const rawQuantity = Math.round(Number(metadata.quantity ?? 1))
  const quantity =
    Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1
  const lineItemTaxCents = metadataCents(metadata.taxCents)
  const pricedInDiscountCents = metadataCents(metadata.discountCents)
  // What Stripe charged for the goods themselves, used only when the session
  // predates the `unitAmountCents` metadata: strip every non-goods component
  // back out of the total and add the discount back in.
  const goodsCents =
    Number(session?.amount_total ?? 0) -
    Number(details?.amount_tax ?? 0) -
    Number(details?.amount_shipping ?? 0) -
    lineItemTaxCents +
    Number(details?.amount_discount ?? 0) +
    pricedInDiscountCents
  const unitAmountCents =
    metadataCents(metadata.unitAmountCents) ||
    Math.max(0, Math.round(goodsCents / quantity))
  const variantId = String(metadata.variantId ?? '')
  const lineItems: OrderLineItem[] = [
    {
      productId: String(metadata.productId ?? ''),
      ...(variantId ? { variantId } : {}),
      name: snapshot.name,
      ...(snapshot.variantLabel ? { variantLabel: snapshot.variantLabel } : {}),
      ...(snapshot.sku ? { sku: snapshot.sku } : {}),
      ...(snapshot.productType ? { productType: snapshot.productType } : {}),
      ...(snapshot.supplierId ? { supplierId: snapshot.supplierId } : {}),
      quantity,
      unitAmountCents,
    },
  ]
  return {
    lineItems,
    totals: computeCheckoutSessionTotals(lineItems, session, {
      feeCents: metadataCents(metadata.feeCents),
      lineItemTaxCents,
      pricedInDiscountCents,
    }),
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
