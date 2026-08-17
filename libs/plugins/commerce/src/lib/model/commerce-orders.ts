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

/**
 * A card dispute against this order's charge (AGL-1787).
 *
 * The DISTINCTION a chargeback carries, kept off `status` on purpose. A lost
 * dispute leaves the order `refunded` — that is what every reader of the status
 * already means by it, and five entitlement gates (`gate.ts`, `download.ts`,
 * `reviews.ts`, `membership-account.ts` and the glance card) match on the
 * literal `'refunded'`, so a new terminal status would have left the shopper
 * their digital downloads and their verified-purchase review. That is AGL-1546
 * reproduced on the tenant side, and the reason this record sits BESIDE the
 * status rather than replacing it: the money question is answered by `status`
 * and `refundedCents`, the "by what door" question by this.
 *
 * Written whole rather than merged into, so a second dispute on the same charge
 * cannot inherit the previous one's `outcome` — see the handler.
 */
export interface OrderDispute {
  /** Stripe dispute id (`dp_…`). */
  id: string
  /** Stripe's dispute status verbatim, e.g. `needs_response`, `lost`. */
  status: string
  /** Stripe's reason code, e.g. `fraudulent`, `product_not_received`. */
  reason?: string
  /** Disputed cents — a partial dispute is less than the order total. */
  amountCents: number
  openedAtMs: number
  /** Evidence deadline, when Stripe supplied one. */
  evidenceDueByMs?: number
  closedAtMs?: number
  /** `won` | `lost` | `warning_closed`, set once the dispute closes. */
  outcome?: string
  /**
   * Cents this dispute actually reversed on the order — a LOST dispute only,
   * and capped against what was left, so it is not always `amountCents`.
   */
  reversedCents?: number
}

/**
 * One line whose stock a reversal MAY need to put back (AGL-1797).
 *
 * Only lines the sale actually DECREMENTED appear here — an untracked variant
 * (`inventory == null`) had nothing taken off it, so it has nothing to return,
 * and a digital line is untracked for that same reason rather than by a
 * type test of its own. A merchant who tracks license stock on a digital
 * product does get it back.
 */
export interface OrderRestockLine {
  productId: string
  variantId: string
  /**
   * Units this line sold. It is the MOST that can come back, never a claim
   * that they did: on a partial reversal the merchant reversed some of the
   * money and only they know which goods returned.
   */
  quantity: number
  /** Purchase-time snapshots, so a reader renders the prompt with no product read. */
  name?: string
  variantLabel?: string
}

/**
 * Stock left off the shelf by a reversed order, FLAGGED rather than released
 * (AGL-1797).
 *
 * The checkout webhook decrements variant inventory on a sale and nothing put
 * it back, so a fully reversed order read one unit light forever and the error
 * compounded with every return. The fix is not the obvious increment, because
 * an increment is wrong more often than it is right:
 *
 *  - a **returned** item genuinely comes back, and stock should rise — but only
 *    once it is RECEIVED, and there is no fulfilment event that records receipt
 *    (`OrderFulfillment` has no returned state);
 *  - a **refund with no return** — goodwill, damaged, lost in post — leaves the
 *    goods gone, so incrementing invents stock the merchant does not have and
 *    sells something that is not on the shelf. That is worse than the bug it
 *    replaces: under-counting refuses a sale, over-counting takes one it cannot
 *    fill;
 *  - a **chargeback** is the clearest do-not-restock case of all, since the
 *    shopper kept the item and took the money back.
 *
 * And the quantities are not even knowable on a partial reversal: a refund is
 * requested as an AMOUNT (`refund.ts` takes `amountCents`) and records no line
 * selection anywhere, so "$17 of a $62 order" names no line. `quantity` is
 * therefore an upper bound and `fullyReversed` says whether it is a tight one.
 *
 * So this records the question instead of guessing the answer, and the merchant
 * answers it from the stock adjustment they already have. The release action is
 * NOT rebuilt here: the products hub's "Adjust stock" already writes the
 * variant counts and an `InventoryAdjustment` row with a reason.
 */
export interface OrderRestockCheck {
  /** Which door the money left by; the two deserve different default wording. */
  kind: 'refund' | 'chargeback'
  /** Inventory-tracked lines only — exactly what the sale decremented. */
  lines: OrderRestockLine[]
  /** Sum of `lines[].quantity`, denormalized so a badge needs no arithmetic. */
  units: number
  /**
   * False when only part of the money came back, which is what makes
   * `quantity` an upper bound rather than a proposal.
   */
  fullyReversed: boolean
  flaggedAtMs: number
  /**
   * Set once a merchant answers. Absent means the question is still open, and
   * it is the only state a fresh reversal will overwrite.
   */
  resolution?: 'restocked' | 'dismissed'
  resolvedAtMs?: number
  /** Console uid that answered. */
  resolvedBy?: string
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
  /** The card dispute against this charge, open or settled (AGL-1787). */
  dispute?: OrderDispute
  /** Stock a reversal left off the shelf, awaiting the merchant (AGL-1797). */
  restockCheck?: OrderRestockCheck
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

/** One line on a Stripe invoice, structurally typed like the session above. */
export interface SubscriptionInvoiceLine {
  /** The line total in cents, after any line-level discount, excluding tax. */
  amount?: unknown
  quantity?: unknown
  description?: unknown
  /** True on the credit/charge pair a mid-cycle plan switch generates. */
  proration?: unknown
  price?: {
    unit_amount?: unknown
    recurring?: { interval?: unknown } | null
  } | null
}

/**
 * The paid-invoice fields a renewal's totals are built from (AGL-1743).
 *
 * ## An invoice is not a Checkout Session
 *
 * This was checked field by field rather than assumed, and the two objects
 * agree on almost nothing:
 *
 * - **There is no `total_details` on an invoice at all.** That object is a
 *   Checkout Session field. `computeCheckoutSessionTotals` cannot be handed an
 *   invoice — every part would read 0 and the whole renewal would decompose to
 *   `amount_total` with nothing in it, which is exactly the AGL-1711 failure
 *   shape (internally consistent, individually wrong).
 * - **Tax** is `tax` (a scalar) on the API versions this repo pins, and
 *   `total_taxes[]` on newer ones, where the scalar was removed. Both are read,
 *   the scalar preferred, because a webhook endpoint's version is dashboard
 *   configuration this repo cannot see.
 * - **Discount** is `total_discount_amounts[]`, an array of per-discount
 *   amounts, not a single `amount_discount`.
 * - **Shipping** is `shipping_cost.amount_total` — note AGL-1698 preferred
 *   `total_details.amount_shipping` over exactly this field ON A SESSION,
 *   because there it is null unless a rate was chosen. On an invoice it is the
 *   only form there is.
 * - **The fee** is a real field here: a subscription carries
 *   `application_fee_percent`, so every invoice reports the resulting
 *   `application_fee_amount`. The session path has to read it out of metadata.
 * - **What was bought** is `lines.data[]` rather than the session's metadata
 *   snapshot — `checkout.ts` puts only `type`, `hostId` and `productId` on
 *   `subscription_data[metadata]`, so the quantity and unit price of a renewal
 *   have to come from the invoice itself.
 *
 * The arithmetic is still the shared one: the fields above are mapped onto the
 * session shape and handed to `computeCheckoutSessionTotals`, so a renewal and
 * a sale clamp, sum and reconcile identically.
 */
export interface SubscriptionInvoiceSource {
  /** What actually arrived — the figure this records as collected. */
  amount_paid?: unknown
  total?: unknown
  subtotal?: unknown
  /** Total tax; removed in favor of `total_taxes` on newer API versions. */
  tax?: unknown
  total_taxes?: readonly { amount?: unknown }[] | null
  total_tax_amounts?: readonly { amount?: unknown }[] | null
  total_discount_amounts?: readonly { amount?: unknown }[] | null
  shipping_cost?: { amount_total?: unknown } | null
  application_fee_amount?: unknown
  lines?: { data?: readonly SubscriptionInvoiceLine[] | null } | null
}

/** Sum of an `[{ amount }]` list, ignoring anything unreadable. */
function sumAmounts(list: readonly { amount?: unknown }[] | null | undefined) {
  return (list ?? []).reduce((sum, entry) => {
    const amount = Number(entry?.amount ?? 0)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)
}

/** `price.recurring.interval` when it is one we sell, else undefined. */
function lineInterval(
  line: SubscriptionInvoiceLine | null | undefined,
): 'month' | 'year' | undefined {
  const interval = line?.price?.recurring?.interval
  return interval === 'month' || interval === 'year' ? interval : undefined
}

/**
 * The line that describes the SUBSCRIPTION being billed.
 *
 * `lines.data[0]` is not it, for the AGL-1640 reason: a mid-cycle plan switch
 * invoices the proration against the OLD price ahead of the new plan, and an
 * invoice also carries one-off items and credits, any of which can sort first.
 * Prefer a non-proration line stating a cadence; fall back to a proration one,
 * since Stripe requires every recurring item on one subscription to share a
 * cadence; fall back to the first line so a renewal still records a name.
 */
export function selectSubscriptionInvoiceLine(
  invoice: SubscriptionInvoiceSource | null | undefined,
): SubscriptionInvoiceLine | undefined {
  const lines = invoice?.lines?.data ?? []
  return (
    lines.find((line) => !line?.proration && lineInterval(line)) ??
    lines.find((line) => lineInterval(line)) ??
    lines[0]
  )
}

/**
 * The cadence a paid invoice was billed on, or undefined when it does not say.
 *
 * Never guessed — the same three-state discipline as `billingIntervalFromInvoice`
 * (AGL-1640). Storing `month` for an invoice that did not state one would make
 * the merchant's own record of what a subscriber pays wrong in the one way that
 * cannot be spotted by looking at it.
 */
export function subscriptionInvoiceInterval(
  invoice: SubscriptionInvoiceSource | null | undefined,
): 'month' | 'year' | undefined {
  return lineInterval(selectSubscriptionInvoiceLine(invoice))
}

/**
 * The stored line items and totals for one paid subscription invoice
 * (AGL-1743) — a renewal, or the opening cycle.
 *
 * `snapshot` supplies the product identity, taken from what the sale already
 * recorded rather than re-derived: an invoice line knows a description and a
 * price, not a productId, a variant or a SKU. It is applied to the
 * subscription's own line only; a proration or one-off line on the same invoice
 * keeps Stripe's description and carries no product identity, because it is not
 * a sale of that product.
 *
 * `totalCents` is Stripe's `amount_paid` verbatim, for the AGL-1698 reason —
 * our sum is priced from lines we did not authorize and must never become the
 * stored truth. Where a customer credit balance covers part of an invoice the
 * parts will therefore exceed the collected total; the collected figure is the
 * one that matters and the invoice's own `total` is stored beside it.
 */
export function computeSubscriptionInvoiceOrder(
  invoice: SubscriptionInvoiceSource | null | undefined,
  snapshot: BuyNowProductSnapshot & { productId: string; variantId?: string },
): { lineItems: OrderLineItem[]; totals: OrderTotals } {
  const subscriptionLine = selectSubscriptionInvoiceLine(invoice)
  const lineItems: OrderLineItem[] = []
  for (const line of invoice?.lines?.data ?? []) {
    const amount = Math.round(Number(line?.amount ?? 0))
    // A credit line (negative proration) is not a sale of anything, and
    // `computeOrderTotals` floors a line at 0 rather than subtracting it.
    // Stripe's own collected total still carries its effect.
    if (!Number.isFinite(amount) || amount <= 0) continue
    const rawQuantity = Math.round(Number(line?.quantity ?? 1))
    const quantity =
      Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1
    // The list unit price, except on a proration line, where `unit_amount` is
    // the full price and `amount` is only the fraction being billed.
    const listUnit = Math.round(Number(line?.price?.unit_amount ?? 0))
    const unitAmountCents =
      !line?.proration && Number.isFinite(listUnit) && listUnit > 0
        ? listUnit
        : Math.max(0, Math.round(amount / quantity))
    const isSubscriptionLine = line === subscriptionLine
    lineItems.push({
      productId: isSubscriptionLine ? snapshot.productId : '',
      ...(isSubscriptionLine && snapshot.variantId
        ? { variantId: snapshot.variantId }
        : {}),
      name: isSubscriptionLine
        ? snapshot.name
        : String(line?.description ?? 'Adjustment').slice(0, 200),
      ...(isSubscriptionLine && snapshot.variantLabel
        ? { variantLabel: snapshot.variantLabel }
        : {}),
      ...(isSubscriptionLine && snapshot.sku ? { sku: snapshot.sku } : {}),
      ...(isSubscriptionLine && snapshot.productType
        ? { productType: snapshot.productType }
        : {}),
      ...(isSubscriptionLine && snapshot.supplierId
        ? { supplierId: snapshot.supplierId }
        : {}),
      quantity,
      unitAmountCents,
    })
  }
  const scalarTax = Number(invoice?.tax ?? NaN)
  const taxCents =
    Number.isFinite(scalarTax) && scalarTax > 0
      ? scalarTax
      : // `total_taxes` replaced `total_tax_amounts`, which replaced the
        // scalar; they do not coexist, so this cannot double-count.
        sumAmounts(invoice?.total_taxes ?? invoice?.total_tax_amounts)
  return {
    lineItems,
    totals: computeCheckoutSessionTotals(
      lineItems,
      {
        amount_total: invoice?.amount_paid,
        total_details: {
          amount_tax: taxCents,
          amount_shipping: metadataCents(invoice?.shipping_cost?.amount_total),
          amount_discount: sumAmounts(invoice?.total_discount_amounts),
        },
      },
      { feeCents: metadataCents(invoice?.application_fee_amount) },
    ),
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

/**
 * An orders-console row: the stored doc plus the Firestore id the collection
 * hook attaches. `createdAt` is typed structurally rather than against the
 * Firestore SDK — this module is pure and installs no client.
 */
export interface OrderExportRow extends Partial<HostOrder> {
  $id?: string
  createdAt?: { toDate?: () => Date } | null
}

/**
 * Does this order contain `productId`?
 *
 * Line items first, legacy flat `productId` as the fallback — the same test
 * `gate.ts`, `download.ts` and `reviews.ts` already apply. Only the two
 * buy-now-shaped Stripe paths ever write the flat field, so a legacy-only
 * check silently excludes every cart, POS and draft order.
 */
export function orderContainsProduct(
  order: Partial<HostOrder>,
  productId: string,
): boolean {
  return (
    (order.lineItems ?? []).some((line) => line.productId === productId) ||
    order.productId === productId
  )
}

/** `12345` -> `123.45`, the CSV's money format. */
function usd(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Header for {@link buildOrdersCsv}. The original seven columns (AGL-96) keep
 * their names AND their positions, so a saved import mapping — by name or by
 * index — still resolves; the four reconciliation columns are appended.
 */
export const ORDERS_CSV_HEADER =
  'date,product,amountUsd,feeUsd,customerEmail,coupon,orderId,' +
  'status,channel,refundedUsd,netUsd'

/**
 * The orders console's `orders.csv` (AGL-1747).
 *
 * ## What was wrong
 *
 * The export read `amountCents`, `feeCents` and `productId` — the legacy
 * Commerce Starter flat fields (AGL-90) — and nothing else. Checked writer by
 * writer, only the two buy-now-shaped Stripe paths write them:
 *
 * | Order path | `amountCents` | `productId` |
 * | -- | -- | -- |
 * | buy-now (`commerce-order`, `billing-webhook.ts`) | yes | yes |
 * | cart (`commerce-cart`, `billing-webhook.ts`) | yes | **no** |
 * | POS cash and POS card (`pos-order.ts`) | **no** | **no** |
 * | draft (`draft-order.ts`, paid by `commerce-draft`) | **no** | **no** |
 *
 * So every POS and draft order exported as `$0.00` and every cart order
 * exported with a blank product, each beside a plausible date, email and order
 * id — nothing in the file signals that the number is missing rather than
 * genuinely zero. The console screen was right the whole time: the table row
 * beside the export button, the detail dialog, the analytics card and lifetime
 * purchases all read `totals` with the flat field only as a fallback. The
 * export was the sole reader that had the precedence backwards, and a CSV is
 * the artefact that reaches a bookkeeper.
 *
 * ## What "correct" means
 *
 * Per AGL-1711's lesson, the useful test is not "do the parts sum" but "does
 * each column match what was actually charged" — a total-only assertion passes
 * against a row whose every component is wrong. The spec therefore pins each
 * cell of a worked example individually.
 *
 * ## Refunds
 *
 * `amountUsd` stays gross, which is what it has always meant, and the appended
 * `refundedUsd`/`netUsd` carry the rest. A refunded order previously exported
 * at its gross with nothing beside it to say so — the same class of error, in
 * that the file understated nothing but overstated revenue.
 */
export function buildOrdersCsv(
  orders: OrderExportRow[],
  productNames: Record<string, string> = {},
): string {
  const escape = (cell: string) =>
    /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
  return [
    ORDERS_CSV_HEADER,
    ...orders.map((order) => {
      const lifted = liftLegacyOrder(order)
      // The STORED line items, not the lifted ones: `liftLegacyOrder` gives a
      // legacy flat row a synthetic line named "Product", which would shadow
      // the real name the `productNames` lookup still recovers for those rows.
      const lineItems = order.lineItems ?? []
      // A cart order has several lines and no single product; name the first
      // and count the rest, the way the table row renders it. `serverTimestamp`
      // reads back null until the write lands, so `createdAtMs` — which every
      // modern writer sets alongside it — covers the local snapshot.
      const date =
        order.createdAt?.toDate?.() ??
        (order.createdAtMs ? new Date(order.createdAtMs) : null)
      const product =
        lineItems[0]?.name ??
        productNames[order.productId ?? ''] ??
        order.productId ??
        ''
      const totalCents = Number(
        lifted.totals?.totalCents ?? order.amountCents ?? 0,
      )
      const feeCents = Number(lifted.totals?.feeCents ?? order.feeCents ?? 0)
      const refundedCents = Number(order.refundedCents ?? 0)
      return [
        date ? date.toISOString() : '',
        lineItems.length > 1
          ? `${product} +${lineItems.length - 1} more`
          : product,
        usd(totalCents),
        usd(feeCents),
        order.customerEmail ?? '',
        order.couponCode ?? '',
        order.$id ?? '',
        lifted.status,
        lifted.channel ?? 'online',
        usd(refundedCents),
        usd(totalCents - refundedCents),
      ]
        .map((cell) => escape(String(cell)))
        .join(',')
    }),
  ].join('\n')
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
