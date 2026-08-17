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

// Pure transform + planning logic for the four commerce backfills
// (AGL-1727 buy-now orders, AGL-1745 subscription sales, AGL-1752
// subscription invoices, AGL-1753 contact LTV). Everything here is pure so
// the arithmetic is unit-testable without Firestore or Stripe; the scripts
// in the parent directory do the I/O and hand the docs in.
//
// The order/totals arithmetic is a deliberate duplicate of
// `libs/plugins/commerce/src/lib/model/commerce-orders.ts` — a .mjs script
// cannot import the TS module (the backfill-org-billing.mjs precedent).
// KEEP IN SYNC with that file; the spec pins the worked example from the
// AGL-1711 docstring so drift shows up as a red test.

/** Finite number or 0. */
export const num = (value) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Non-negative integer cents from an untyped value; 0 otherwise. */
export const metadataCents = (value) => {
  const cents = Math.round(Number(value ?? 0))
  return Number.isFinite(cents) && cents > 0 ? cents : 0
}

// KEEP IN SYNC with `computeOrderTotals` (commerce-orders.ts).
export function computeOrderTotals(lineItems, parts) {
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

// KEEP IN SYNC with `computeCheckoutSessionTotals` (commerce-orders.ts).
export function computeCheckoutSessionTotals(lineItems, session, parts) {
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

// KEEP IN SYNC with `normalizeContactEmail` (libs/aglyn contacts.ts).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function normalizeContactEmail(input) {
  const email = String(input ?? '')
    .trim()
    .toLowerCase()
  return EMAIL_PATTERN.test(email) && email.length <= 320 ? email : null
}

// ---------------------------------------------------------------------------
// AGL-1727 — buy-now orders: quantity 1 / tax 0 / discount 0 reconstruction
// ---------------------------------------------------------------------------

/**
 * Is this order doc a buy-now (`commerce-order` branch) online order?
 * Cart orders never carry the legacy flat `productId`; POS and draft carry
 * their own `channel`. Legacy AGL-90 rows (no lineItems at all) qualify too.
 */
export function isBuyNowOrder(order, orderId) {
  const channel = order?.channel ?? 'online'
  if (channel !== 'online') return false
  if (!order?.productId) return false
  const sessionId = String(order?.checkoutSessionId ?? orderId ?? '')
  return sessionId.startsWith('cs_')
}

/**
 * Rebuild the true line item + totals for a buy-now order from its retrieved
 * Checkout Session (`line_items` expanded), the order doc, and the coupon's
 * `percentOff` when the order carries a `couponCode`.
 *
 * Mirrors the live `computeBuyNowOrder` (AGL-1711) with one addition it does
 * not need: a pre-fix session carries no `unitAmountCents` / `taxCents` /
 * `discountCents` metadata, so the manual tax line is read off the session's
 * REAL `line_items` (checkout.ts appends it as the only line past [0]) and
 * the priced-in coupon is reversed from `percentOff` — both per AGL-1727's
 * reconstruction argument.
 *
 * Returns `{ lineItems, totals, notes }` or `{ error }`.
 */
export function reconstructBuyNowOrder({ order, session, couponPercentOff }) {
  const notes = []
  const metadata = session?.metadata ?? {}
  const lines = session?.line_items?.data ?? []
  if (!lines.length) return { error: 'session has no line_items' }
  const productLine = lines[0]
  const rawQuantity = Math.round(
    num(metadata.quantity ?? productLine?.quantity ?? 1),
  )
  const quantity =
    Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1
  // A buy-now session carries exactly ONE product line; any line past [0] is
  // the manual tax line checkout.ts appends (quantity 1, host tax label).
  const taxLineCents = lines
    .slice(1)
    .reduce((sum, line) => sum + num(line?.amount_total), 0)
  const metadataTax = metadataCents(metadata.taxCents)
  const lineItemTaxCents = metadataTax || taxLineCents
  if (metadataTax > 0 && taxLineCents > 0 && metadataTax !== taxLineCents) {
    notes.push(
      `metadata taxCents ${metadataTax} disagrees with the session tax line ` +
        `${taxLineCents}; using the metadata snapshot`,
    )
  }
  // What Stripe charged per unit — the post-coupon price checkout.ts sent.
  const chargedUnitCents = Math.round(num(productLine?.price?.unit_amount))
  let unitAmountCents
  let pricedInDiscountCents
  const percentOff = num(couponPercentOff)
  if (metadataCents(metadata.unitAmountCents)) {
    // Post-AGL-1711 session: the frozen snapshot is authoritative.
    unitAmountCents = metadataCents(metadata.unitAmountCents)
    pricedInDiscountCents = metadataCents(metadata.discountCents)
  } else if (percentOff > 0 && percentOff <= 100 && chargedUnitCents > 0) {
    // Reverse checkout.ts's rounding: charged = round(list*(100-p)/100).
    // The reconstruction can drift the list unit by one cent.
    unitAmountCents = Math.round((chargedUnitCents * 100) / (100 - percentOff))
    pricedInDiscountCents = (unitAmountCents - chargedUnitCents) * quantity
    notes.push(
      `list price reconstructed from the ${percentOff}% coupon — ` +
        `rounding can drift the list unit by 1c`,
    )
  } else {
    unitAmountCents = chargedUnitCents
    pricedInDiscountCents = 0
    if (order?.couponCode && !(percentOff > 0)) {
      notes.push(
        `couponCode "${order.couponCode}" has no resolvable percentOff — ` +
          `the discount CANNOT be reconstructed and stays folded into the ` +
          `unit price`,
      )
    }
  }
  const identity = order?.lineItems?.[0] ?? {}
  const variantId = String(identity.variantId ?? metadata.variantId ?? '')
  const lineItem = {
    productId: String(
      identity.productId ?? order?.productId ?? metadata.productId ?? '',
    ),
    ...(variantId ? { variantId } : {}),
    name: String(identity.name ?? 'Product'),
    ...(identity.variantLabel ? { variantLabel: identity.variantLabel } : {}),
    ...(identity.sku ? { sku: identity.sku } : {}),
    ...(identity.productType ? { productType: identity.productType } : {}),
    ...(identity.supplierId ? { supplierId: identity.supplierId } : {}),
    quantity,
    unitAmountCents,
  }
  const totals = computeCheckoutSessionTotals([lineItem], session, {
    feeCents: num(order?.feeCents ?? metadata.feeCents),
    lineItemTaxCents,
    pricedInDiscountCents,
  })
  return { lineItems: [lineItem], totals, notes }
}

const TOTALS_KEYS = [
  'itemsCents',
  'shippingCents',
  'taxCents',
  'discountCents',
  'feeCents',
  'totalCents',
]

/**
 * Field-by-field diff between the stored order and the reconstruction.
 * Empty array = the stored record is already correct (single-unit,
 * no-coupon, no-tax purchases are ACCIDENTALLY right — AGL-1727).
 */
export function diffBuyNowOrder(order, rebuilt) {
  const diffs = []
  const stored = order?.lineItems?.[0] ?? {}
  const next = rebuilt.lineItems[0]
  if (num(stored.quantity) !== next.quantity) {
    diffs.push({
      field: 'lineItems[0].quantity',
      from: stored.quantity ?? null,
      to: next.quantity,
    })
  }
  if (num(stored.unitAmountCents) !== next.unitAmountCents) {
    diffs.push({
      field: 'lineItems[0].unitAmountCents',
      from: stored.unitAmountCents ?? null,
      to: next.unitAmountCents,
    })
  }
  for (const key of TOTALS_KEYS) {
    const from = num(order?.totals?.[key])
    const to = rebuilt.totals[key]
    if (from !== to) diffs.push({ field: `totals.${key}`, from, to })
  }
  return diffs
}

/**
 * Inventory drift a wrong buy-now quantity caused (AGL-1727 consequence 1):
 * the webhook decremented ONE unit however many were sold, so stock is
 * overstated by quantity-1 per affected order. REPORTED only — this backfill
 * does not touch inventory; that reconciliation is its own decision.
 */
export function inventoryDriftForOrder(order, rebuilt) {
  const storedQuantity = num(order?.lineItems?.[0]?.quantity ?? 1) || 1
  const trueQuantity = rebuilt.lineItems[0].quantity
  if (trueQuantity <= storedQuantity) return null
  return {
    productId: rebuilt.lineItems[0].productId,
    ...(rebuilt.lineItems[0].variantId
      ? { variantId: rebuilt.lineItems[0].variantId }
      : {}),
    overstatedUnits: trueQuantity - storedQuantity,
  }
}

// ---------------------------------------------------------------------------
// AGL-1743/1745/1752 — subscription invoice decomposition (ports)
// ---------------------------------------------------------------------------

function sumAmounts(list) {
  return (list ?? []).reduce((sum, entry) => {
    const amount = Number(entry?.amount ?? 0)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)
}

function lineInterval(line) {
  const interval = line?.price?.recurring?.interval
  return interval === 'month' || interval === 'year' ? interval : undefined
}

// KEEP IN SYNC with `selectSubscriptionInvoiceLine` (commerce-orders.ts).
export function selectSubscriptionInvoiceLine(invoice) {
  const lines = invoice?.lines?.data ?? []
  return (
    lines.find((line) => !line?.proration && lineInterval(line)) ??
    lines.find((line) => lineInterval(line)) ??
    lines[0]
  )
}

// KEEP IN SYNC with `subscriptionInvoiceInterval` (commerce-orders.ts).
export function subscriptionInvoiceInterval(invoice) {
  return lineInterval(selectSubscriptionInvoiceLine(invoice))
}

// KEEP IN SYNC with `computeSubscriptionInvoiceOrder` (commerce-orders.ts).
export function computeSubscriptionInvoiceOrder(invoice, snapshot) {
  const subscriptionLine = selectSubscriptionInvoiceLine(invoice)
  const lineItems = []
  for (const line of invoice?.lines?.data ?? []) {
    const amount = Math.round(Number(line?.amount ?? 0))
    if (!Number.isFinite(amount) || amount <= 0) continue
    const rawQuantity = Math.round(Number(line?.quantity ?? 1))
    const quantity =
      Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1
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
      : sumAmounts(invoice?.total_taxes ?? invoice?.total_tax_amounts)
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

/**
 * The invoice document the live AGL-1743 branch writes, built from a Stripe
 * invoice — the exact live shape plus a `backfilledAtMs` provenance stamp so
 * a reconstruction is never mistaken for a live-recorded cycle.
 */
export function invoiceDocFromStripeInvoice(invoice, { snapshot, nowMs }) {
  const invoiceId = String(invoice?.id ?? '')
  const subscriptionId = String(
    invoice?.subscription ??
      invoice?.parent?.subscription_details?.subscription ??
      '',
  )
  const { lineItems, totals } = computeSubscriptionInvoiceOrder(
    invoice,
    snapshot,
  )
  const paidCents = Math.max(0, Math.round(Number(invoice?.amount_paid ?? 0)))
  const interval = subscriptionInvoiceInterval(invoice)
  const paidAtMs = invoice?.status_transitions?.paid_at
    ? Number(invoice.status_transitions.paid_at) * 1000
    : (nowMs ?? Date.now())
  return {
    invoiceId,
    subscriptionId,
    billingReason: String(invoice?.billing_reason ?? ''),
    ...(invoice?.number ? { number: String(invoice.number) } : {}),
    currency: String(invoice?.currency ?? 'usd'),
    paidCents,
    invoiceTotalCents: Math.max(
      0,
      Math.round(Number(invoice?.total ?? paidCents)),
    ),
    lineItems,
    totals,
    ...(interval ? { interval } : {}),
    paidAtMs,
    periodStartMs: invoice?.period_start
      ? Number(invoice.period_start) * 1000
      : null,
    periodEndMs: invoice?.period_end ? Number(invoice.period_end) * 1000 : null,
    customerEmail: invoice?.customer_email ?? null,
    ...(invoice?.hosted_invoice_url
      ? { hostedInvoiceUrl: String(invoice.hosted_invoice_url) }
      : {}),
    backfilledAtMs: nowMs ?? Date.now(),
  }
}

/**
 * Deterministic roll-up over the FULL invoice-doc set (existing + planned),
 * replacing the live path's read-and-accumulate — re-running it always
 * lands on the same numbers, which is the idempotency AGL-1752 demands.
 * `totals`/`interval` replacement follows the live rule: latest non-opening
 * invoice with money (never a trial's $0, never the opening charge).
 */
export function subscriptionRollup(invoiceDocs) {
  const paid = [...invoiceDocs].sort((a, b) => a.paidAtMs - b.paidAtMs)
  if (!paid.length) return null
  const last = paid[paid.length - 1]
  const rollup = {
    lastInvoiceId: last.invoiceId,
    lastPaymentCents: last.paidCents,
    lastPaymentAtMs: last.paidAtMs,
    paidCents: paid.reduce((sum, doc) => sum + num(doc.paidCents), 0),
    invoicesCount: paid.length,
  }
  const paidThroughMs = paid.reduce(
    (max, doc) => Math.max(max, num(doc.periodEndMs)),
    0,
  )
  if (paidThroughMs > 0) rollup.paidThroughMs = paidThroughMs
  const latestRenewal = [...paid]
    .reverse()
    .find(
      (doc) => doc.billingReason !== 'subscription_create' && doc.paidCents > 0,
    )
  if (latestRenewal) {
    rollup.totals = latestRenewal.totals
    if (latestRenewal.interval) rollup.interval = latestRenewal.interval
  }
  return rollup
}

// ---------------------------------------------------------------------------
// AGL-1753 — contact LTV rebuild (SET, never increment)
// ---------------------------------------------------------------------------

/** Order statuses under which the money moved and stayed (gross basis). */
export const COUNTED_ORDER_STATUSES = new Set([
  'paid',
  'partially_fulfilled',
  'fulfilled',
  'delivered',
  // Gross-of-refunds by definition (AGL-1748/1754): the charge happened;
  // the refund is recorded BESIDE it, never netted out of ltvCents.
  'refunded',
])

/**
 * Aggregates every purchase event for one ORG into per-email RFM fields.
 * Input rows are pre-extracted by the script:
 *   orders:        { id, hostId, status, email, totalCents, refundedCents, atMs, channel }
 *   subscriptions: { id, hostId, email, openingCents (null = unknown), atMs,
 *                    invoices: [{ billingReason, paidCents, atMs, email }] }
 *   reservations:  { id, hostId, email, paidCents, atMs, status }
 *   bookings:      { id, hostId, email, paidCents, atMs, name }
 *
 * SET semantics: the result is the whole truth for each email, replacing
 * whatever increments accumulated — re-running can never compound (the
 * AGL-1745/1752 `FieldValue.increment` hazard).
 *
 * Everything that CANNOT be reconstructed is returned, not skipped:
 * `anonymousMoney` (no usable email anywhere), `unknownOpenings`
 * (subscription predates AGL-1732 and has no totals — run AGL-1745 first),
 * and `cancelledOrders` / `pendingReservations` (excluded, listed).
 */
export function aggregateContactPurchases({
  orders = [],
  subscriptions = [],
  reservations = [],
  bookings = [],
}) {
  const byEmail = new Map()
  const anonymousMoney = []
  const cancelledOrders = []
  const unknownOpenings = []
  const record = (emailRaw, cents, atMs, kind, refId) => {
    const email = normalizeContactEmail(emailRaw)
    if (!email) {
      if (cents > 0) anonymousMoney.push({ kind, refId, cents })
      return
    }
    const entry = byEmail.get(email) ?? {
      ltvCents: 0,
      ordersCount: 0,
      firstPurchaseAtMs: null,
      lastPurchaseAtMs: null,
      refundedCents: 0,
      refundedOrdersCount: 0,
      lastRefundAtMs: null,
      events: [],
    }
    if (cents > 0) {
      entry.ltvCents += cents
      entry.ordersCount += 1
      const at = num(atMs) || null
      if (at) {
        entry.firstPurchaseAtMs = Math.min(entry.firstPurchaseAtMs ?? at, at)
        entry.lastPurchaseAtMs = Math.max(entry.lastPurchaseAtMs ?? at, at)
      }
      entry.events.push({ kind, refId, cents, atMs: at })
    }
    byEmail.set(email, entry)
    return entry
  }

  for (const order of orders) {
    if (!COUNTED_ORDER_STATUSES.has(order.status)) {
      if (num(order.totalCents) > 0 && order.status === 'cancelled') {
        cancelledOrders.push(order)
      }
      continue
    }
    const entry = record(
      order.email,
      num(order.totalCents),
      order.atMs,
      'order',
      order.id,
    )
    if (entry && num(order.refundedCents) > 0) {
      entry.refundedCents += num(order.refundedCents)
      entry.refundedOrdersCount += 1
      const at = num(order.atMs) || null
      if (at) entry.lastRefundAtMs = Math.max(entry.lastRefundAtMs ?? at, at)
    }
  }
  for (const subscription of subscriptions) {
    if (subscription.openingCents === null) {
      unknownOpenings.push(subscription.id)
    } else {
      record(
        subscription.email,
        num(subscription.openingCents),
        subscription.atMs,
        'subscription',
        subscription.id,
      )
    }
    for (const invoice of subscription.invoices ?? []) {
      // The opening invoice's money is the subscription's opening charge —
      // counting both is the double-count the live path guards against.
      if (invoice.billingReason === 'subscription_create') continue
      record(
        invoice.email ?? subscription.email,
        num(invoice.paidCents),
        invoice.atMs,
        'renewal',
        subscription.id,
      )
    }
  }
  for (const reservation of reservations) {
    // `paidCents` only — the folio and stay balance settle as their own POS
    // orders, already counted above (AGL-1755's double-count finding).
    record(
      reservation.email,
      num(reservation.paidCents),
      reservation.atMs,
      'reservation',
      reservation.id,
    )
  }
  for (const booking of bookings) {
    record(booking.email, num(booking.paidCents), booking.atMs, 'booking', booking.id)
  }
  return { byEmail, anonymousMoney, cancelledOrders, unknownOpenings }
}

/** RFM keys the rebuild owns; everything else on a contact is untouched. */
const CONTACT_SET_KEYS = [
  'ltvCents',
  'ordersCount',
  'firstPurchaseAtMs',
  'lastPurchaseAtMs',
]
const CONTACT_REFUND_KEYS = [
  'refundedCents',
  'refundedOrdersCount',
  'lastRefundAtMs',
]

/**
 * The update() payload for one existing contact, or null when the stored
 * fields already match. Refund fields ride along only when there is refund
 * money to record (the AGL-1754 beside-not-netted shape).
 */
export function planContactUpdate(contact, aggregate, nowMs) {
  const wanted = {
    ltvCents: aggregate.ltvCents,
    ordersCount: aggregate.ordersCount,
    firstPurchaseAtMs: aggregate.firstPurchaseAtMs,
    lastPurchaseAtMs: aggregate.lastPurchaseAtMs,
  }
  if (aggregate.refundedCents > 0) {
    wanted.refundedCents = aggregate.refundedCents
    wanted.refundedOrdersCount = aggregate.refundedOrdersCount
    wanted.lastRefundAtMs = aggregate.lastRefundAtMs
  }
  const keys = [
    ...CONTACT_SET_KEYS,
    ...(aggregate.refundedCents > 0 ? CONTACT_REFUND_KEYS : []),
  ]
  const changed = keys.filter(
    (key) => num(contact?.[key]) !== num(wanted[key]),
  )
  if (!changed.length) return null
  return {
    ...wanted,
    'backfills.agl1753AtMs': nowMs ?? Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Write-plan execution — update()/create() ONLY, never set(merge)
// ---------------------------------------------------------------------------

/**
 * Executes a plan of `{ type: 'update'|'create', path, data }` operations.
 * `update` fails on a missing doc and `create` fails on an existing one —
 * exactly the semantics that make a phantom doc impossible (the
 * `set(merge)` conjuring AGL-1763 documented). Any other op type throws.
 */
export async function applyPlan(db, operations) {
  let applied = 0
  for (const operation of operations) {
    const ref = db.doc(operation.path)
    if (operation.type === 'update') {
      await ref.update(operation.data)
    } else if (operation.type === 'create') {
      await ref.create(operation.data)
    } else {
      throw new Error(`refusing unknown write op "${operation.type}"`)
    }
    applied += 1
  }
  return applied
}
