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

import { stripeIdIsTestMode } from '@aglyn/aglyn/app-utils/stripe-deployment-mode'
import type { ProductType } from './commerce'
import type { StorefrontTaxMode } from './commerce-tax-decision'

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'delivered'
  | 'cancelled'
  | 'refunded'

/**
 * Where the sale came through. `subscription` is a recurring cycle of a
 * PHYSICAL subscription product (AGL-1750): each paid invoice mints one order
 * so fulfilment has something to pick, pack and label against, and so
 * recurring revenue reaches the surfaces that read `orders`. Digital and
 * service subscriptions still record on the subscription document alone —
 * there is nothing to ship, and AGL-1732's "a subscription is not an order"
 * stands for them.
 */
export type OrderChannel = 'online' | 'pos' | 'draft' | 'subscription'

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
  /**
   * Stripe transfer-reversal id (`trr_…`) that pulled the seller's share back
   * from the connected account (AGL-1794) — set only when a reversal was
   * actually created or found already sitting on the transfer.
   */
  transferReversalId?: string
  /**
   * Cents pulled back from the CONNECTED account for this lost dispute
   * (AGL-1794). Its presence — 0 included — is the settle marker for the
   * reversal step: 0 means the step ran and found nothing to reverse (no
   * transfer on the charge, or a transfer with nothing left), recorded so a
   * redelivery does not retry a failure no redelivery can fix.
   */
  reversedTransferCents?: number
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
  /**
   * Which `lineItems` entry this came from, matching `refundedLineItemIds`
   * (AGL-2325).
   *
   * The index rather than the product, because a cart can hold one product on
   * two lines and a line-scoped refund may name only one of them. It is what
   * lets a SECOND partial refund be told apart from a repeat of the first: a
   * reversal naming a line the open question already covers adds nothing, and
   * one naming a line it misses is a new question rather than noise.
   *
   * Absent on a check written before this shipped, and that absence is read as
   * "covers the whole order" — the assumption those checks were written under.
   */
  lineIndex?: number
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
 * And the quantities are not always knowable on a partial reversal: a refund
 * requested as an AMOUNT names no line at all, so "$17 of a $62 order" selects
 * nothing. `quantity` is an upper bound there and `fullyReversed` says whether
 * it is a tight one.
 *
 * A refund that DID name its lines is scoped to them (AGL-2325). `refund.ts`
 * records `refundedLineItemIds` with the money (AGL-2454), so the flag asks
 * about the lines that reversal withdrew rather than about the whole order —
 * and `lineIndex` on each line is what lets a second partial withdrawing a
 * DIFFERENT line re-ask, instead of being swallowed by the still-open question
 * about the first.
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

/**
 * A cart line a paid order could not record (AGL-2149). All that survives a
 * deleted product is what the shopper's cart asked for.
 */
export interface OrderUnresolvedLine {
  productId: string
  variantId?: string
  quantity: number
}

/** `hosts/{hostId}/orders/{id}` doc. */
export interface HostOrder {
  /** Human order number, sequential per host (e.g. #1042). */
  number?: number
  status: OrderStatus
  channel?: OrderChannel
  /**
   * Which location's stock this sale came off, for the multi-location counts
   * of AGL-286. Written by the POS register, the only sale path that decrements
   * a location bucket rather than the flat count — and read back when the order
   * is cancelled (AGL-1808), because putting the units on the flat total when
   * the sale took them out of a bucket leaves the two disagreeing, and the next
   * location-aware write recomputes the total from the buckets and silently
   * erases the restock.
   */
  locationId?: string
  /**
   * The register discount that was applied, and the member who applied it
   * (AGL-2161). Present only on a POS order that carries a discount.
   *
   * `totals.discountCents` records that money came off; these record who
   * decided it should. Without them a full comp read exactly like a
   * correctly-priced sale after the fact, on the one channel where a person is
   * standing in front of the goods and can ring whatever they like. The
   * ceiling that bounds `discountPct` is the org's `posMaxDiscountPct` plugin
   * setting, enforced server-side in `pos-order.ts`.
   */
  discountPct?: number
  discountBy?: string
  lineItems?: OrderLineItem[]
  totals?: OrderTotals
  /**
   * WHICH TAX REGIME this order carried (AGL-2451), resolved at the moment the
   * sale decided it and stamped here rather than re-derived later.
   *
   * `totals.taxCents` says how much tax was charged and nothing about who
   * computed it. Those are different facts about whose registration the money
   * is held under: a `stripe-automatic` storefront sale's tax is computed
   * against AGLYN's registrations and settles into Aglyn's balance (MEASURED —
   * see `server/storefront-tax.ts`), while a `manual` one is the merchant's own
   * rate on their own origin. An order that cannot say which one it carried
   * cannot be reconciled against the return, or corrected afterwards.
   *
   * AGL-2440's merchant report reads the authoritative
   * `storefrontTaxCollected` record; this is the same fact on the single order,
   * and both come from `storefrontTaxMode` so the two cannot drift.
   *
   * ## ABSENT MEANS "NOT RECORDED" — AND NOTHING MAY DEFAULT IT
   *
   * Every order written before AGL-2451 shipped genuinely has no stamp, and
   * that is the honest reading. `liftLegacyOrder` deliberately does NOT
   * synthesise one the way it synthesises `totals.taxCents: 0`: it runs on the
   * READ path, its result is spread into merge writes, and a defaulted `none`
   * would overwrite a real `stripe-automatic` — the converter-on-partial-writes
   * hazard, in a place where the destroyed value is a tax fact. The console
   * renders an absent mode as unknown, never as `none`
   * (`describeOrderTaxMode`).
   */
  taxMode?: StorefrontTaxMode
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
  /**
   * The recurring cycle this order fulfils (channel `subscription`,
   * AGL-1750). The order's own doc id is the invoice id — that identity is
   * the redelivery key — and these carry the join back to
   * `subscriptions/{subscriptionId}/invoices/{invoiceId}`.
   */
  subscriptionId?: string
  invoiceId?: string
  /** Draft orders (AGL-287): the link sent to the buyer. */
  paymentLinkUrl?: string
  refundedCents?: number
  /**
   * Line indexes an admin refunded BY NAME (AGL-2454), and therefore the lines
   * whose digital entitlements are withdrawn.
   *
   * A refund carries an AMOUNT, not lines — `refund.ts` takes `amountCents`
   * and Stripe knows nothing about what was in the basket — so a partial refund
   * cannot in general be attributed to anything. That is why five entitlement
   * gates matched the literal `'refunded'` on `status` and a 99%-refunded order
   * kept every download, licence key, gated page and verified review.
   *
   * This is the case where attribution IS possible: the console refund dialog
   * lets an admin pick the lines they are refunding, and when it does the
   * amount is computed FROM those lines rather than typed beside them. An
   * amount-only refund still revokes nothing per-line — deciding for the
   * merchant which lines a bare figure covers would be a guess about their
   * goods — but it is no longer silent: `orderRefundState` reports it, the
   * console shows it, and the order timeline records it.
   *
   * Indexes rather than product ids, because a cart can hold two lines of the
   * same product (different variants) and only one may be coming back.
   */
  refundedLineItemIds?: number[]
  /** The card dispute against this charge, open or settled (AGL-1787). */
  dispute?: OrderDispute
  /** Stock a reversal left off the shelf, awaiting the merchant (AGL-1797). */
  restockCheck?: OrderRestockCheck
  /**
   * Cart lines the webhook could not price because the product was deleted
   * between session creation and payment (AGL-2149). Present ONLY on an order
   * that is short of what the shopper was charged: `totals.itemsCents` is
   * missing these lines while `amountCents` still holds the full
   * `amount_total`, and this is the record of which lines the difference is.
   *
   * Deliberately NOT an `OrderLineItem[]`: the product doc is gone, so there is
   * no name, no price and no type to record — only what the cart asked for.
   */
  unresolvedLines?: OrderUnresolvedLine[]
  createdAtMs?: number
  // Legacy Commerce Starter fields (AGL-90) kept readable.
  productId?: string
  amountCents?: number
  feeCents?: number
}

/**
 * Legal status transitions. Refund/cancel policies: anything paid can
 * refund; only unfulfilled orders cancel (refund instead once shipped).
 *
 * `cancelled` IS NOT TERMINAL, and treating it as one trapped money (AGL-2149).
 * `cancel-order.ts` accepts a **paid** order — `paid: [… 'cancelled' …]` above
 * — and moves no money when it does: it flips the status and returns the stock.
 * `refund.ts` gates on `canTransitionOrder(order.status, 'refunded')`, so with
 * `cancelled: []` the refund door closed behind the cancel and answered "orders
 * in cancelled cannot refund" forever. An admin who cancelled a paid order
 * instead of refunding it — the two buttons sit next to each other in the order
 * dialog — had permanently locked the shopper's money out of every refund route
 * this product has. The shopper's only remaining recourse was a chargeback,
 * which costs the merchant the goods, the money AND the dispute fee.
 *
 * Whether cancelling a PAID order should refuse, or refund on the merchant's
 * behalf, is a real product question and is deliberately NOT answered here:
 * either would change what an existing console button does to money. Making the
 * money reachable is the part that must not wait for that answer.
 *
 * A cancelled order that never took money simply has nothing to refund —
 * `refund.ts` resolves no payment intent and answers "No payment to refund" —
 * so the widened edge costs a lapsed `pending` order nothing.
 */
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['partially_fulfilled', 'fulfilled', 'cancelled', 'refunded'],
  partially_fulfilled: ['fulfilled', 'refunded'],
  fulfilled: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded: [],
}

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * One money part, coerced to a whole non-negative number of cents (AGL-2224).
 *
 * `Math.max(0, Math.round(x))` is NOT this guard, and the difference is the
 * whole defect: `Math.max` and `Math.min` PROPAGATE `NaN` rather than
 * discarding it, so a single non-finite input made every field below `NaN` and
 * `totalCents` with them. That is not a cosmetic wrong number — it is a number
 * that defeats comparison. `cashReceivedCents < NaN` is `false`, so the POS
 * "cash received is short" guard passed a sale that had taken no money; and a
 * `NaN` written to Firestore (a legal double there) poisons every downstream
 * sum, so ONE bad order renders a merchant's whole revenue figure `NaN`
 * forever after.
 *
 * The inputs that can be non-finite are real, not theoretical: a POS
 * `discountPct` that is not a number, a product whose `priceUsd` is a string
 * or absent (`Number(undefined) * 100`), a `taxCents` derived from either. So
 * this coerces at the boundary every order in the product passes through,
 * rather than at each of the five callers, and answers 0 — the only value that
 * cannot silently overstate what the shopper owes.
 */
const wholeCents = (value: unknown): number => {
  const cents = Math.round(Number(value ?? 0))
  return Number.isFinite(cents) && cents > 0 ? cents : 0
}

/**
 * Split `totalCents` across `weights` so the parts sum to it EXACTLY (AGL-2509).
 *
 * Largest-remainder (Hamilton) apportionment. Each weight takes its exact
 * share, the shares are floored, and the cents left over by flooring are handed
 * one each to the largest fractional parts, ties going to the lower index so
 * the answer is deterministic for a given input.
 *
 * The exactness is the whole point and it is a money property, not a
 * neatness one: `Math.round` per line loses or invents cents against the total
 * — three lines splitting a 10¢ discount round to 3+3+3=9 and the missing cent
 * has to come from somewhere. A refund built on a split that does not close is
 * a reconciliation defect that surfaces months later against Stripe's numbers.
 *
 * Pure and total. A non-positive total, an empty weight list, or weights that
 * sum to nothing all answer zeros — never a division by zero, never a NaN
 * propagated into an amount someone is charged.
 */
export function apportionCents(
  weights: readonly number[],
  totalCents: number,
): number[] {
  const safe = (weights ?? []).map((weight) =>
    Math.max(0, Math.round(Number(weight ?? 0))),
  )
  const basis = safe.reduce((sum, weight) => sum + weight, 0)
  const total = Math.max(0, Math.round(Number(totalCents ?? 0)))
  if (safe.length === 0 || basis <= 0 || total <= 0) return safe.map(() => 0)
  // Never hand back more than there is to split. A discount larger than the
  // items it came off is a data fault, and apportioning it in full would
  // credit lines with money the order never carried.
  const pot = Math.min(total, basis)
  const exact = safe.map((weight) => (weight * pot) / basis)
  const shares = exact.map((value) => Math.floor(value))
  let remainder = pot - shares.reduce((sum, share) => sum + share, 0)
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const entry of order) {
    if (remainder <= 0) break
    shares[entry.index] += 1
    remainder -= 1
  }
  return shares
}

/**
 * What refunding the named lines is actually worth (AGL-2509).
 *
 * A line's LIST value is `unitAmountCents x quantity`, and that is what the
 * refund route used to hand back. It is the wrong number on any order that
 * carried an order-level discount, because the buyer never paid it: a $10
 * coupon on two $50 lines means each line cost $45, and refunding one at $50
 * pays back $5 the buyer never spent. The order then has less left than its
 * remaining line is worth, so the SECOND line refund is refused outright and
 * the merchant cannot finish the job they started.
 *
 * So each line carries its share of the discount, apportioned by list value
 * through {@link apportionCents} — which guarantees the shares sum to the whole
 * discount, so refunding every line returns exactly `itemsCents - discountCents`
 * and no cent is stranded or invented.
 *
 * SHIPPING AND TAX ARE DELIBERATELY NOT IN THIS FIGURE. Refunding a line
 * returns what the goods cost. Shipping is charged for the consignment rather
 * than the line, so no split of it is defensible without knowing whether the
 * parcel still ships; tax follows the goods but is Stripe's to recompute, and
 * an order whose tax was collected under Aglyn's own registration
 * (`taxMode: 'stripe-automatic'`) is not one this function may quietly decide
 * to hand back. Both remain whole-order concerns, refundable by amount.
 *
 * Pure: unknown indexes contribute nothing rather than throwing.
 */
export function orderLineRefundCents(
  order: Pick<Partial<HostOrder>, 'lineItems' | 'totals'>,
  lineIndexes: readonly number[],
): number {
  const lines = order?.lineItems ?? []
  const gross = lines.map((line) =>
    Math.max(
      0,
      Math.round(Number(line?.unitAmountCents ?? 0)) *
        Math.max(1, Math.round(Number(line?.quantity ?? 1))),
    ),
  )
  const shares = apportionCents(
    gross,
    Math.max(0, Math.round(Number(order?.totals?.discountCents ?? 0))),
  )
  const wanted = new Set(
    (lineIndexes ?? []).filter(
      (index) => Number.isInteger(index) && index >= 0 && index < lines.length,
    ),
  )
  let cents = 0
  for (const index of wanted) cents += gross[index] - shares[index]
  return Math.max(0, cents)
}

/**
 * A REHEARSAL IS NOT REVENUE (AGL-2520).
 *
 * A smoke-test checkout writes a real order document. Stripe never moved money
 * for it — the session id is `cs_test_…` — but every surface that sums paid
 * orders counted it, so a storefront with one test order and no sales reported
 * revenue it had never earned. Found in production: a single $18.00 order from
 * an end-to-end run, standing as the whole platform's storefront revenue.
 *
 * ## Two signals, in order of trust
 *
 * `livemode` is a RECORDED FACT and wins whenever it is present: the webhook
 * knows which Stripe environment an event came from and now writes it onto the
 * order. Only a literal boolean counts, the same three-valued reading every
 * other money gate in this codebase uses.
 *
 * The session id prefix is the FALLBACK, for the orders written before
 * anything recorded the fact. It is Stripe's convention rather than our data,
 * so it lives behind `stripeIdIsTestMode` and is not spelled out here.
 *
 * ## An unknowable order is LIVE
 *
 * An order with no `livemode` and no Stripe session id — a POS cash sale, a
 * folio charge, a draft order paid offline — is real money and is counted.
 * Answering "test" for anything we cannot identify would zero genuine sales,
 * which is the one direction this must never fail in: a merchant under-reporting
 * their own revenue has no way to tell it is happening.
 */
export function orderIsTestMode(
  order: Pick<Partial<HostOrder>, 'checkoutSessionId'> & {
    livemode?: unknown
    /** The Firestore doc id, which for a storefront order IS the session id. */
    $id?: unknown
  },
): boolean {
  if (typeof order?.livemode === 'boolean') return !order.livemode
  // `$id` as well as the field: every storefront order is keyed BY its session
  // id, so the doc id carries the same signal and is present on rows read
  // straight out of Firestore even where the field was never written. A POS or
  // draft order has an auto-generated id, which matches no Stripe prefix and
  // correctly reads as live.
  return (
    stripeIdIsTestMode(order?.checkoutSessionId) || stripeIdIsTestMode(order?.$id)
  )
}

/** Sums line items and folds in shipping/tax/discount/fee, all cents. */
export function computeOrderTotals(
  lineItems: OrderLineItem[],
  parts?: Partial<Pick<OrderTotals, 'shippingCents' | 'taxCents' | 'discountCents' | 'feeCents'>>,
): OrderTotals {
  const itemsCents = (lineItems ?? []).reduce(
    (sum, line) => sum + wholeCents(line?.unitAmountCents * line?.quantity),
    0,
  )
  const shippingCents = wholeCents(parts?.shippingCents)
  const taxCents = wholeCents(parts?.taxCents)
  const discountCents = Math.min(
    wholeCents(parts?.discountCents),
    itemsCents + shippingCents,
  )
  return {
    itemsCents,
    shippingCents,
    taxCents,
    discountCents,
    feeCents: wholeCents(parts?.feeCents),
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
   *
   * A manual-tax SUBSCRIPTION session is the third construction (AGL-1751):
   * there the tax is a real Stripe Tax Rate (a one-time line would bill on
   * the first invoice only), `amount_tax` carries it, and `checkout.ts`
   * writes `metadata[taxCents]` as 0 — the exclusivity this sum rests on,
   * kept from the other side.
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

/**
 * The base a subscription invoice's platform fee SHOULD be taken on
 * (AGL-2317): post-discount items, with tax and shipping removed.
 *
 * Every one-time door — `checkout.ts`, `cart-checkout.ts`, `draft-order.ts`,
 * `pos-order.ts` and (since AGL-2315) bookings — sends a cents amount computed
 * on items alone. The recurring door sent `application_fee_percent`, which
 * Stripe applies to the WHOLE invoice, so Aglyn took a cut of sales tax — money
 * that is the state's — and of shipping. On the issue's worked example ($30/mo
 * digital, Business 2%, an 8.25% TX rate) the one-time base is $30.00 → 60¢ and
 * the invoice total is $32.48 → 65¢.
 *
 * `total` and not a re-summed `lines.data[]`, deliberately. Stripe's own total
 * is already net of every invoice-level discount and of any proration CREDIT,
 * both of which `computeSubscriptionInvoiceOrder` drops (it floors a line at 0,
 * which is right for a stored line item and wrong for a fee base — a mid-cycle
 * downgrade credit reduces what the merchant is actually paid). Subtracting the
 * two parts Stripe reports separately leaves exactly what was charged for goods.
 *
 * Tax is read on both spellings for the reason stated on `SubscriptionInvoiceSource`
 * — the scalar was removed on newer API versions and the endpoint's version is
 * dashboard configuration this repo cannot see. Reading only one of them would
 * silently value tax at 0 and hand back the whole invoice total as the base,
 * which is the very bug this closes.
 */
export function subscriptionInvoiceFeeBasisCents(
  invoice: SubscriptionInvoiceSource | null | undefined,
): number {
  const totalCents = metadataCents(invoice?.total)
  if (totalCents <= 0) return 0
  const scalarTax = Number(invoice?.tax ?? NaN)
  const taxCents =
    Number.isFinite(scalarTax) && scalarTax > 0
      ? scalarTax
      : sumAmounts(invoice?.total_taxes ?? invoice?.total_tax_amounts)
  const shippingCents = metadataCents(invoice?.shipping_cost?.amount_total)
  return Math.max(0, totalCents - Math.max(0, taxCents) - shippingCents)
}

/**
 * What the platform fee on a paid subscription invoice WOULD have been on the
 * items-only base, at the rate Stripe actually applied (AGL-2317).
 *
 * ## The rate is never named here, on purpose
 *
 * Pricing is locked for Sept 1, so this is a BASE correction and must not be
 * able to become a rate change. It therefore takes no plan, no entitlement and
 * no `resolveTransactionFeePct` call: it scales the fee Stripe already charged
 * by `base / total`. Whatever rate produced `application_fee_amount` — the
 * sale-time one, a rate AGL-2289 has since re-priced, or a staff override —
 * comes through untouched, and the only thing removed is the portion that was
 * taken on tax and shipping. A test that changed a rate could not make this
 * function agree with it.
 *
 * `Math.max(1, …)` matches `checkout.ts`: where a rate applies at all, the
 * floor is a cent, never zero. An invoice with no fee, no total, or nothing but
 * tax answers 0 and asks for no correction it cannot justify.
 */
export function subscriptionInvoiceItemsOnlyFeeCents(
  invoice: SubscriptionInvoiceSource | null | undefined,
): number {
  const chargedCents = metadataCents(invoice?.application_fee_amount)
  if (chargedCents <= 0) return 0
  const totalCents = metadataCents(invoice?.total)
  // Nothing to scale against — leave what Stripe took rather than inventing a
  // reduction from a total we cannot read.
  if (totalCents <= 0) return chargedCents
  const basisCents = subscriptionInvoiceFeeBasisCents(invoice)
  if (basisCents <= 0) return 0
  // Tax-free and shipping-free invoices — the majority — land here and are
  // byte-identical to today, which is what makes this safe inside the freeze.
  if (basisCents >= totalCents) return chargedCents
  return Math.max(1, Math.round((chargedCents * basisCents) / totalCents))
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

/**
 * Line indexes already covered by a recorded fulfillment (AGL-2455).
 *
 * The set the supplier callback and the console's own fulfil both have to
 * reason about, and the reason `status` alone could not: `supplier-update.ts`
 * wrote `status: 'fulfilled'` as a LITERAL, so the first supplier to post
 * tracking on a two-supplier order marked every line shipped — including lines
 * they have never seen — and the second supplier's POST met a 409 because
 * `fulfilled` cannot transition to `fulfilled`. The buyer was told their whole
 * order shipped with one carrier and one tracking number.
 */
export function coveredLineItemIds(order: Partial<HostOrder>): Set<number> {
  const covered = new Set<number>()
  for (const fulfillment of order.fulfillments ?? []) {
    for (const index of fulfillment?.lineItemIds ?? []) {
      const line = Math.round(Number(index))
      if (Number.isFinite(line) && line >= 0) covered.add(line)
    }
  }
  return covered
}

/** Distinct suppliers with at least one line on this order (AGL-2455). */
export function orderSupplierIds(order: Partial<HostOrder>): string[] {
  return [
    ...new Set(
      (order.lineItems ?? [])
        .map((line) => String(line.supplierId ?? ''))
        .filter(Boolean),
    ),
  ]
}

/** Line indexes belonging to one supplier (AGL-2455). */
export function supplierLineItemIds(
  order: Partial<HostOrder>,
  supplierId: string,
): number[] {
  return (order.lineItems ?? [])
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => String(line.supplierId ?? '') === supplierId)
    .map(({ index }) => index)
}

/**
 * The status an order reaches once `covered` lines are shipped (AGL-2455).
 *
 * COMPUTED from the fulfillment set rather than written as a literal, which is
 * the whole of this issue's third requirement. `partially_fulfilled` has existed
 * in `ORDER_TRANSITIONS` since orders shipped and nothing ever wrote it.
 *
 * An order with no lines at all reads as fulfilled — there is nothing left to
 * ship, and answering `partially_fulfilled` would strand it forever.
 */
export function statusAfterFulfilling(
  order: Partial<HostOrder>,
  covered: Set<number>,
): OrderStatus {
  const lines = order.lineItems ?? []
  if (lines.length === 0) return 'fulfilled'
  return lines.every((_line, index) => covered.has(index))
    ? 'fulfilled'
    : 'partially_fulfilled'
}

/**
 * Statuses under which an order grants NO entitlement at all (AGL-2454).
 *
 * `pending` has not paid, `cancelled` was undone, `refunded` was given back.
 * The literal list was copied into `download.ts`, `gate.ts`,
 * `membership-account.ts` and `reviews.ts`; it lives here now so a change to
 * what "withdrawn" means reaches all of them at once.
 */
const WITHDRAWN_ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'cancelled',
  'refunded',
]

/**
 * How much of this order has been given back (AGL-2454).
 *
 * `full` follows `status` OR the money, because the two can legitimately
 * disagree for a moment: `refund.ts` reserves `refundedCents` before it calls
 * Stripe and flips `status` after, and a lost dispute reverses money on an
 * order whose status is still `paid` until it closes. Reading only the status
 * would treat that window as "nothing refunded".
 */
export function orderRefundState(
  order: Partial<HostOrder>,
): 'none' | 'partial' | 'full' {
  const refundedCents = Math.max(0, Number(order.refundedCents ?? 0))
  const totalCents =
    order.totals?.totalCents ?? Number(order.amountCents ?? 0)
  if (order.status === 'refunded') return 'full'
  if (!(refundedCents > 0)) return 'none'
  return totalCents > 0 && refundedCents >= totalCents ? 'full' : 'partial'
}

/**
 * Is this line's entitlement withdrawn?
 *
 * By INDEX, matching `refundedLineItemIds`. A cart can hold the same product on
 * two lines and only one may be coming back, so a product-keyed test would
 * revoke goods the buyer still owns.
 */
export function orderLineRefunded(
  order: Partial<HostOrder>,
  lineIndex: number,
): boolean {
  return (order.refundedLineItemIds ?? []).includes(lineIndex)
}

/**
 * THE ONE ENTITLEMENT TEST (AGL-2454). Does this order still entitle the buyer
 * to `productId`?
 *
 * Five gates asked this question and all five asked it as
 * `!['pending','cancelled','refunded'].includes(status) && orderContainsProduct(…)`.
 * That reading is why a partial refund revoked NOTHING: `refund.ts` writes
 * `status: 'refunded'` only when the order is FULLY refunded, so a 99%-refunded
 * order stayed `paid` and every gate said yes — downloads, licence keys, gated
 * content and the right to post a verified review, all still live.
 *
 * Withdrawn now means either of two things, and both had to be expressible in
 * one place or the five gates would drift again:
 *
 *  - the whole order is withdrawn by `status`, as before; or
 *  - every line carrying this product was refunded BY NAME, which is the case a
 *    line-scoped refund creates and the only case where an amount can honestly
 *    be attributed to goods.
 *
 * `'any'` asks whether the order still entitles ANYTHING, which is what the
 * membership paywall's subscription-shaped probe needs.
 *
 * The legacy flat `productId` order (one line, no `lineItems`) is lifted by
 * `liftLegacyOrder` before it gets here, so index 0 is its only line and a
 * line-scoped refund of it behaves like a full one.
 */
export function orderEntitlesProduct(
  order: Partial<HostOrder>,
  productId: string | 'any',
): boolean {
  if (WITHDRAWN_ORDER_STATUSES.includes(order.status as OrderStatus)) {
    return false
  }
  const lines = order.lineItems ?? []
  if (productId === 'any') {
    if (lines.length === 0) return true
    return lines.some((_line, index) => !orderLineRefunded(order, index))
  }
  const matching = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.productId === productId)
  if (matching.length === 0) {
    // The legacy flat shape, which `liftLegacyOrder` normally converts. Kept so
    // an unlifted row is not silently un-entitled — a false negative here locks
    // a paying buyer out of goods they bought.
    return order.productId === productId
  }
  return matching.some(({ index }) => !orderLineRefunded(order, index))
}

/**
 * Product ids whose entitlement this order has withdrawn line by line
 * (AGL-2454) — every line for the product refunded, none left standing.
 *
 * What `refund.ts` uses to decide which licence keys to RETIRE. Not "any line
 * refunded": a buyer who returned one of two copies still holds the product.
 */
export function refundedProductIds(order: Partial<HostOrder>): string[] {
  const lines = order.lineItems ?? []
  const ids = new Set<string>()
  for (const line of lines) {
    if (!ids.has(line.productId) && !orderEntitlesProduct(order, line.productId)) {
      ids.add(line.productId)
    }
  }
  return [...ids]
}

/**
 * The refund line the console and the merchant read (AGL-2454).
 *
 * Kept in the model because three surfaces show it and "partially refunded"
 * must not mean different things on two of them. Empty for an order with
 * nothing refunded — there is nothing to say.
 */
export function orderRefundSummary(order: Partial<HostOrder>): string {
  const state = orderRefundState(order)
  if (state === 'none') return ''
  const refundedCents = Math.max(0, Number(order.refundedCents ?? 0))
  const totalCents = order.totals?.totalCents ?? Number(order.amountCents ?? 0)
  if (state === 'full') return `Refunded in full ($${usd(refundedCents)})`
  const revoked = (order.refundedLineItemIds ?? []).length
  const lines = (order.lineItems ?? []).length
  const scope =
    revoked > 0
      ? `${revoked} of ${lines} line${lines === 1 ? '' : 's'} withdrawn`
      : 'no lines withdrawn — refunded by amount'
  return `Partially refunded ($${usd(refundedCents)} of $${usd(
    totalCents,
  )}) — ${scope}`
}

/** `12345` -> `123.45`, the CSV's money format. */
function usd(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Display labels for {@link OrderStatus}, and the MUI chip colour each one
 * carries (AGL-2136). The orders screen advertised on `/product/commerce`
 * shows the status as a COLOURED pill — `Paid`, `Fulfilled`, `Refunded` in
 * three different colours — where the console rendered every status as the
 * same default outlined chip, so the one column a merchant scans first
 * carried no signal at all.
 *
 * Kept in the model rather than in the card because three surfaces render a
 * status (the orders list, the detail dialog and the dashboard glance
 * widget) and a colour that means "refunded" on one of them must not mean
 * something else on the next.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
  partially_fulfilled: 'Partly fulfilled',
  fulfilled: 'Fulfilled',
  delivered: 'Delivered',
  cancelled: 'Canceled',
  refunded: 'Refunded',
}

/**
 * Chip colour per status. `pending` is deliberately `default` rather than
 * `warning`: an unpaid order is not a problem, it is simply not money yet,
 * and reserving the alarming colours for `cancelled`/`refunded` is what
 * makes them readable at a glance.
 */
export const ORDER_STATUS_COLOR: Record<
  OrderStatus,
  'default' | 'success' | 'info' | 'warning' | 'error'
> = {
  pending: 'default',
  paid: 'success',
  partially_fulfilled: 'warning',
  fulfilled: 'info',
  delivered: 'info',
  cancelled: 'default',
  refunded: 'error',
}

/** Display labels for {@link OrderChannel}. */
export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  online: 'Online',
  pos: 'POS',
  draft: 'Draft',
  subscription: 'Subscription',
}

/** Human label for a channel, tolerating a legacy/unknown value. */
export function orderChannelLabel(channel: string | undefined): string {
  return ORDER_CHANNEL_LABELS[(channel ?? 'online') as OrderChannel] ?? channel ?? 'Online'
}

/**
 * Net cents an order actually earned: the charged total less anything
 * refunded. The three commerce surfaces each had their own inline copy of
 * this expression; a refunded order counted as revenue on whichever one
 * was written first.
 */
export function orderNetCents(order: Partial<HostOrder>): number {
  const gross = Number(
    (order as { totals?: { totalCents?: number } }).totals?.totalCents ??
      (order as { amountCents?: number }).amountCents ??
      0,
  )
  return gross - Number((order as { refundedCents?: number }).refundedCents ?? 0)
}

/** Milliseconds an order was created at, across every writer's field shape. */
export function orderCreatedAtMs(order: Partial<HostOrder> & {
  createdAtMs?: number
  createdAt?: { seconds?: number; toDate?: () => Date }
}): number {
  if (typeof order.createdAtMs === 'number') return order.createdAtMs
  const seconds = order.createdAt?.seconds
  if (typeof seconds === 'number') return seconds * 1000
  const date = order.createdAt?.toDate?.()
  return date ? date.getTime() : 0
}

/** One window's totals, plus how it moved against the window before it. */
export interface OrderWindowSummary {
  /** Net revenue in cents over the window. */
  revenueCents: number
  /** Orders counted in the window. */
  orders: number
  /** Average order value in cents, 0 when the window is empty. */
  aovCents: number
  /**
   * Percentage change vs the immediately preceding window of the same
   * length, rounded to one decimal. `null` when the prior window is EMPTY —
   * "+100%" against zero is not a growth rate, it is a first sale, and the
   * tile must say nothing rather than say something false.
   */
  revenueDeltaPct: number | null
  ordersDeltaPct: number | null
  aovDeltaPct: number | null
}

const ORDER_WINDOW_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Percentage change from `previous` to `current`, or `null` when there is
 * no baseline to divide by.
 */
function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

/**
 * Summarises a window of orders and the window before it (AGL-2136).
 *
 * Every commerce mockup we advertise shows the money tiles carrying a
 * period-over-period delta — `Revenue $26,540 +8.1%` — and the product had
 * no prior-window computation anywhere in the repo, so no surface could
 * have rendered one.
 *
 * `pending` and `cancelled` orders are excluded, matching the analytics
 * card: neither is money. Refunds are subtracted rather than dropped, so a
 * refund inside the window pushes the delta DOWN, which is the whole point
 * of showing it.
 */
export function summarizeOrderWindow(
  orders: readonly (Partial<HostOrder> & {
    createdAtMs?: number
    createdAt?: { seconds?: number; toDate?: () => Date }
  })[],
  options: { nowMs: number; days?: number } ,
): OrderWindowSummary {
  const days = options.days ?? 30
  const spanMs = days * ORDER_WINDOW_DAY_MS
  const { nowMs } = options
  let revenueCents = 0
  let count = 0
  let priorRevenueCents = 0
  let priorCount = 0
  for (const order of orders) {
    const lifted = liftLegacyOrder(order)
    if (lifted.status === 'pending' || lifted.status === 'cancelled') continue
    const age = nowMs - orderCreatedAtMs(order)
    if (age < 0) continue
    if (age < spanMs) {
      revenueCents += orderNetCents(order)
      count += 1
    } else if (age < spanMs * 2) {
      priorRevenueCents += orderNetCents(order)
      priorCount += 1
    }
  }
  const aovCents = count ? Math.round(revenueCents / count) : 0
  const priorAovCents = priorCount
    ? Math.round(priorRevenueCents / priorCount)
    : 0
  return {
    revenueCents,
    orders: count,
    aovCents,
    revenueDeltaPct: deltaPct(revenueCents, priorRevenueCents),
    ordersDeltaPct: deltaPct(count, priorCount),
    aovDeltaPct: deltaPct(aovCents, priorAovCents),
  }
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
