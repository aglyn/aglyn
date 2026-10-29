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

import { visitorUploadIsInline } from '@aglyn/aglyn/app-utils/visitor-upload'
import type { ProductType } from './commerce'
import {
  appendOrderEvent,
  formatOrderNumber,
  type HostOrder,
  type OrderAddress,
  type OrderLineItem,
  type OrderStatus,
} from './commerce-orders'
import {
  computeQuoteTotals,
  describeQuoteTax,
  formatQuoteNumber,
  quoteLineAmounts,
  quotePaymentBlockedByApproval,
  type OrderQuote,
  type QuoteDiscount,
  type QuoteTaxBasis,
  type QuoteUnmatchedPayment,
} from './commerce-quotes'
import { currentQuoteProofs, latestQuoteResponse, quoteRespondRefusal } from './commerce-quote-proofs'
import type { StorefrontTaxMode } from './commerce-tax-decision'
import { engineLineTaxPercentages } from './commerce-tax-engine'
import { withOrderListFields, type OrderListFields } from './order-list-fields'

/*==========================================
 * PAYING A QUOTE (AGL-4094).
 *
 * The customer opens the quote on the business's own site from a signed pay
 * link, sees it, and pays it. Everything here is pure, so the page's view,
 * the pay route's charge and the webhook's paid order all come from one
 * reading of the stored quote, and none of them from anything the browser
 * sends:
 *
 * - {@link buildQuotePageView}: the ONE projection of a quote that leaves the
 *   server for a visitor holding the link, allow-listed field by field.
 * - {@link quoteCheckoutCharge}: what a Checkout Session charges, priced from
 *   the stored lines, discount, shipping and tax basis.
 * - {@link quotePayRefusal}: why a quote cannot be paid now, if it cannot.
 * - {@link quotePaymentDisposition} and {@link paidQuoteOrder}: what a
 *   completed payment does to the quote, and the order it becomes.
 *
 * The customer side has no expiry and no open or closed states: a quote and
 * its link stay until the quote is paid or the business replaces the link.
 *=========================================*/

/** Stripe's smallest card charge; a quote that totals less cannot be paid by card. */
export const QUOTE_MIN_CHARGE_CENTS = 50

/** The pay link version a quote is on; absent reads as the first. */
export function quoteLinkVersion(quote: Pick<OrderQuote, 'linkVersion'> | null | undefined): number {
  const version = Math.floor(Number(quote?.linkVersion))
  return Number.isFinite(version) && version >= 1 ? version : 1
}

/*==========================================
 * THE CUSTOMER'S PAGE
 *=========================================*/

/** An address as the quote page prints it: no phone. */
export interface QuotePageAddress {
  name: string | null
  line1: string | null
  line2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
}

export interface QuotePageLine {
  name: string
  /** The option and add-ons chosen, as order lines print them. */
  variantLabel: string | null
  description: string | null
  sku: string | null
  quantity: number
  unitAmountCents: number
  /** What the line charges: 0 for an included line. */
  amountCents: number
  /** Included at no charge. */
  included: boolean
}

/** Where the quote stands, as its customer sees it. */
export type QuotePageStatus = 'unpaid' | 'paid' | 'canceled' | 'refunded'

/** A proof as the quote page lists it: no storage path, nothing about who attached it. */
export interface QuotePageProof {
  id: string
  name: string
  contentType: string
  size: number
  /** Shown in the page as a picture; everything else is a download. */
  inline: boolean
}

/** The customer's latest answer to the revision the page shows. */
export interface QuotePageResponse {
  action: 'approve' | 'changes'
  atMs: number
  /** With an approval: the name it was given under. */
  name: string | null
  comment: string | null
  /** How many files came with it. */
  files: number
}

/**
 * What the quote page shows. Allow-listed, never spread: the order document
 * carries the customer's email and phone, Stripe ids, the business's own
 * timeline and who wrote the quote, none of which a forwarded link may show.
 * New fields are added here deliberately, or not at all.
 */
export interface QuotePageView {
  state: 'quote'
  storeName: string
  /** `Quote #1042`. */
  number: string
  /** When the quote was last written, which is the date it carries. */
  dateMs: number | null
  /**
   * The edit of the quote this view shows. Pay sends it back, and a quote
   * changed since is refused, so nobody pays for a version they have not seen.
   */
  version: number
  currency: string
  customerName: string | null
  company: string | null
  billTo: QuotePageAddress | null
  shipTo: QuotePageAddress | null
  lines: QuotePageLine[]
  totals: {
    itemsCents: number
    discountCents: number
    shippingCents: number
    taxCents: number
    totalCents: number
  }
  /** `10% off`, or null for an amount or no discount. */
  discountLabel: string | null
  /** The tax line's label, or `Tax is added at payment`. */
  taxLabel: string
  /** Stripe Tax works the tax out when the customer pays; `taxCents` is 0 until then. */
  taxAtPayment: boolean
  notes: string | null
  terms: string | null
  status: QuotePageStatus
  statusLabel: string
  paidAtMs: number | null
  /** The order's status page, once paid. */
  receiptUrl: string | null
  /** The business asks the customer to approve the proof before paying. */
  approvalRequired: boolean
  /** A Pay button belongs on the page. */
  payable: boolean
  /** The revision the page shows (AGL-4096). */
  revision: number
  /** That revision's proofs. */
  proofs: QuotePageProof[]
  /** The customer's latest answer to it, if any. */
  response: QuotePageResponse | null
  /** Approve and Request changes belong on the page. */
  respondable: boolean
}

/** What a signed link for an older version of the quote opens: nothing of the quote. */
export interface QuotePageReplacedView {
  state: 'replaced'
  storeName: string
}

const text = (value: unknown): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed : null
}

const cents = (value: unknown): number => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? number : 0
}

function pageAddress(address: OrderAddress | null | undefined): QuotePageAddress | null {
  if (!address) return null
  const view: QuotePageAddress = {
    name: text(address.name),
    line1: text(address.line1),
    line2: text(address.line2),
    city: text(address.city),
    state: text(address.state),
    postalCode: text(address.postalCode),
    country: text(address.country),
  }
  return Object.values(view).some(Boolean) ? view : null
}

function pageStatus(status: OrderStatus | string | undefined): { status: QuotePageStatus; label: string } {
  if (status === 'pending') return { status: 'unpaid', label: 'Unpaid' }
  if (status === 'cancelled') return { status: 'canceled', label: 'Canceled' }
  if (status === 'refunded') return { status: 'refunded', label: 'Refunded' }
  return { status: 'paid', label: 'Paid' }
}

function discountLabel(discount: QuoteDiscount | null | undefined): string | null {
  if (discount?.kind !== 'percent' || !(Number(discount.pct) > 0)) return null
  return `${Number(discount.pct)}% off`
}

/** When the quote was paid: its stamp, else the timeline's `paid` event. */
function paidAt(order: Pick<HostOrder, 'status' | 'quote' | 'timeline'>): number | null {
  if (order.status === 'pending') return null
  const stamped = Number(order.quote?.paidAtMs)
  if (Number.isFinite(stamped) && stamped > 0) return stamped
  const event = (order.timeline ?? []).find((entry) => entry?.event === 'paid')
  return event ? Number(event.atMs) || null : null
}

/**
 * The quote page's view of an order document on the `quote` channel. Totals
 * are the stored lines' through {@link computeQuoteTotals} until the quote is
 * paid, and the paid order's own totals (what Stripe charged) after.
 */
export function buildQuotePageView(input: {
  order: Pick<HostOrder, 'number' | 'status' | 'lineItems' | 'totals' | 'quote' | 'timeline'>
  orderId: string
  storeName: string
  currency: string
  /** The order's status page, for a paid quote. */
  receiptUrl?: string | null
}): QuotePageView {
  const { order } = input
  const quote = order.quote
  const lines = order.lineItems ?? []
  const status = pageStatus(order.status)
  const unpaid = status.status === 'unpaid'
  const charge = quoteCheckoutCharge(order, input.orderId)
  const stored = order.totals
  const totals = unpaid || !stored
    ? {
        itemsCents: charge.itemsCents,
        discountCents: charge.discountCents,
        shippingCents: charge.shippingCents,
        taxCents: charge.taxCents,
        totalCents: charge.totalCents,
      }
    : {
        itemsCents: cents(stored.itemsCents),
        discountCents: cents(stored.discountCents),
        shippingCents: cents(stored.shippingCents),
        taxCents: cents(stored.taxCents),
        totalCents: cents(stored.totalCents),
      }
  const approvalRequired = unpaid && quotePaymentBlockedByApproval(quote)
  const taxAtPayment = unpaid && quote?.tax?.kind === 'at-payment'
  return {
    state: 'quote',
    storeName: input.storeName,
    number: formatQuoteNumber(order, input.orderId),
    dateMs: Number(quote?.updatedAtMs ?? quote?.createdAtMs) || null,
    version: Number(quote?.updatedAtMs) || 0,
    currency: input.currency || 'USD',
    customerName: text(quote?.customer?.name) ?? text(quote?.customer?.company),
    company: text(quote?.customer?.name) ? text(quote?.customer?.company) : null,
    billTo: pageAddress(quote?.billTo),
    shipTo: pageAddress(quote?.shipTo),
    lines: lines.map((line) => {
      const included = line.included === true
      const quantity = Math.max(0, cents(line.quantity))
      const unitAmountCents = included ? 0 : Math.max(0, cents(line.unitAmountCents))
      return {
        name: String(line.name ?? ''),
        variantLabel: text(line.variantLabel),
        description: text(line.description),
        sku: text(line.sku),
        quantity,
        unitAmountCents,
        amountCents: unitAmountCents * quantity,
        included,
      }
    }),
    totals,
    discountLabel: discountLabel(quote?.discount),
    // Once paid, the tax is what was charged: Stripe's figure under Stripe Tax.
    taxLabel: unpaid || quote?.tax?.kind !== 'at-payment' ? describeQuoteTax(quote?.tax) : 'Tax',
    taxAtPayment,
    notes: text(quote?.notes),
    terms: text(quote?.terms),
    status: status.status,
    statusLabel: status.label,
    paidAtMs: paidAt(order),
    receiptUrl: unpaid ? null : (input.receiptUrl ?? null),
    approvalRequired,
    payable: unpaid && !approvalRequired && quotePayRefusal(order, input.orderId) === null,
    revision: Math.max(1, Number(quote?.revision ?? 1) || 1),
    proofs: currentQuoteProofs(quote).map((proof) => ({
      id: String(proof.id),
      name: String(proof.name ?? 'Proof'),
      contentType: String(proof.contentType ?? ''),
      size: Math.max(0, cents(proof.size)),
      inline: visitorUploadIsInline(String(proof.contentType ?? '')),
    })),
    response: pageResponse(quote),
    // The page is only ever a quote's, whatever the caller picked off the order.
    respondable: quoteRespondRefusal({ channel: 'quote', status: order.status, quote }) === null,
  }
}

/** The latest answer, as the page may show it back to the link's holder: never the address or browser. */
function pageResponse(quote: OrderQuote | null | undefined): QuotePageResponse | null {
  const latest = latestQuoteResponse(quote)
  if (!latest) return null
  return {
    action: latest.action === 'approve' ? 'approve' : 'changes',
    atMs: Number(latest.atMs) || 0,
    name: latest.action === 'approve' ? text(latest.name) : null,
    comment: latest.action === 'changes' ? text(latest.comment) : null,
    files: latest.files?.length ?? 0,
  }
}

/*==========================================
 * WHAT A PAYMENT CHARGES
 *=========================================*/

/** One line of a quote's Checkout Session. */
export interface QuoteCheckoutLine {
  name: string
  /** The quote's lines this one charges for, as the hosted page lists them. */
  description: string
  amountCents: number
  /** False for tax-exempt products: no rate is applied and Stripe Tax is told it is nontaxable. */
  taxable: boolean
}

/** What a quote's Checkout Session charges, priced from the stored quote alone. */
export interface QuoteCheckoutCharge {
  /** The goods grouped by whether they are taxed, so one rate taxes exactly the quote's taxable amount. */
  lines: QuoteCheckoutLine[]
  itemsCents: number
  discountCents: number
  /** The goods after the discount: what the business is paid for them. */
  goodsCents: number
  taxableCents: number
  shippingCents: number
  /** The quote's tax; 0 when Stripe Tax works it out at payment. */
  taxCents: number
  /**
   * The percentage applied to the taxed line as a Stripe tax rate, or null
   * when no rate is applied (no tax, Stripe Tax, or tax charged as its own line).
   */
  taxPct: number | null
  taxAtPayment: boolean
  /** Goods, shipping and the quote's tax. Stripe Tax adds to it at payment. */
  totalCents: number
  /** What the platform fee prices the goods as. */
  feeProductType: ProductType
}

const LINE_DESCRIPTION_MAX = 500

function lineSummary(lines: readonly OrderLineItem[]): string {
  const parts = lines.map((line) => {
    const label = line.variantLabel ? `${line.name} (${line.variantLabel})` : line.name
    return `${Math.max(1, cents(line.quantity))} × ${label}`
  })
  const summary = parts.join(', ')
  return summary.length > LINE_DESCRIPTION_MAX ? `${summary.slice(0, LINE_DESCRIPTION_MAX - 1)}…` : summary
}

/** What the fee ladder prices the quote's charged goods as: physical when any line ships. */
function feeProductTypeOf(lines: readonly OrderLineItem[]): ProductType {
  const charged = lines.filter((line) => !line.included)
  const types = new Set(charged.map((line) => line.productType ?? 'physical'))
  if (types.has('physical') || types.size === 0) return 'physical'
  return types.has('service') ? 'service' : 'digital'
}

/**
 * The charge for a quote, from its stored lines, discount, shipping and tax
 * basis through {@link computeQuoteTotals} — the same function that priced it
 * when it was saved, so the page, the session and the stored quote agree.
 *
 * The goods are charged as at most two lines, the taxed and the tax-exempt,
 * each after its share of the discount. A store rate is applied to the taxed
 * line as one Stripe tax rate, so Stripe's tax is the rate on exactly the
 * amount the quote taxed, and the quote's figure is what is collected. A tax
 * service's figure is carried the same way, as the percentage of the taxed
 * line it amounts to. Included lines charge nothing and are not sent.
 */
export function quoteCheckoutCharge(
  order: Pick<HostOrder, 'number' | 'lineItems' | 'quote'>,
  orderId: string,
): QuoteCheckoutCharge {
  const lineItems = order.lineItems ?? []
  const tax: QuoteTaxBasis = order.quote?.tax ?? { kind: 'none', reason: 'not-collected' }
  const discount = order.quote?.discount ?? null
  const shippingCents = Math.max(0, cents(order.quote?.shipping?.amountCents))
  const totals = computeQuoteTotals({ lines: lineItems, discount, shippingCents, tax })
  const amounts = quoteLineAmounts(lineItems, discount)
  const label = formatQuoteNumber(order, orderId)
  const groups = [true, false].map((taxable) => {
    const members = lineItems
      .map((line, index) => ({ line, net: amounts.netCents[index] }))
      .filter(({ line, net }) => net > 0 && (line.taxExempt !== true) === taxable)
    return {
      taxable,
      amountCents: members.reduce((sum, { net }) => sum + net, 0),
      description: lineSummary(members.map(({ line }) => line)),
    }
  })
  const charged = groups.filter((group) => group.amountCents > 0)
  const lines: QuoteCheckoutLine[] = charged.map((group) => ({
    name: charged.length > 1 && !group.taxable ? `${label} (tax-exempt items)` : label,
    description: group.description,
    amountCents: group.amountCents,
    taxable: group.taxable,
  }))
  const taxableCents = groups[0].amountCents
  const taxPct =
    totals.taxCents > 0 && taxableCents > 0
      ? tax.kind === 'rate'
        ? Number(tax.pct)
        : engineLineTaxPercentages([{ amountCents: taxableCents, taxCents: totals.taxCents }], 0)[0]
      : null
  // A tax service can tax a quote whose goods are all exempt (on its
  // shipping, say): with no taxed line to carry a rate, its figure is
  // charged as a line of its own, so the customer still pays what the quote says.
  if (totals.taxCents > 0 && taxPct === null) {
    lines.push({
      name: tax.providerLabel ? `Sales tax (${tax.providerLabel})` : 'Sales tax',
      description: label,
      amountCents: totals.taxCents,
      taxable: false,
    })
  }
  return {
    lines,
    itemsCents: totals.itemsCents,
    discountCents: totals.discountCents,
    goodsCents: totals.itemsCents - totals.discountCents,
    taxableCents,
    shippingCents,
    taxCents: totals.taxCents,
    taxPct,
    taxAtPayment: totals.taxAtPayment,
    totalCents: totals.totalCents,
    feeProductType: feeProductTypeOf(lineItems),
  }
}

/*==========================================
 * WHETHER IT CAN BE PAID NOW
 *=========================================*/

export type QuotePayRefusal =
  | 'paid'
  | 'closed'
  | 'approval-required'
  | 'tax-undecided'
  | 'nothing-to-pay'

/** Why a quote cannot be paid now, or null when it can. */
export function quotePayRefusal(
  order: Pick<HostOrder, 'number' | 'status' | 'lineItems' | 'quote'>,
  orderId: string,
): QuotePayRefusal | null {
  if (order.status === 'cancelled' || order.status === 'refunded') return 'closed'
  if (order.status !== 'pending') return 'paid'
  if (quotePaymentBlockedByApproval(order.quote)) return 'approval-required'
  if (order.quote?.tax?.kind === 'none' && order.quote.tax.reason === 'undecided') return 'tax-undecided'
  if (quoteCheckoutCharge(order, orderId).totalCents < QUOTE_MIN_CHARGE_CENTS) return 'nothing-to-pay'
  return null
}

/** What the customer is told for a {@link QuotePayRefusal}, naming the business. */
export function quotePayRefusalMessage(reason: QuotePayRefusal, storeName: string): string {
  const business = storeName.trim() || 'the business'
  switch (reason) {
    case 'paid':
      return 'This quote has been paid.'
    case 'closed':
      return `This quote is closed. Contact ${business} with any questions.`
    case 'approval-required':
      return `${business} asks you to approve the proof before you pay.`
    case 'tax-undecided':
      return `${business} has not finished setting up payments. Contact them to pay this quote.`
    case 'nothing-to-pay':
      return `This quote has nothing to pay by card. Contact ${business} with any questions.`
  }
}

/*==========================================
 * WHEN A PAYMENT COMPLETES
 *=========================================*/

/** What a completed Checkout Session says about the quote it paid. */
export interface QuotePaymentFacts {
  sessionId: string
  paymentIntentId: string | null
  /** The link version and quote edit the session was minted for, from its metadata. */
  linkVersion?: string | number | null
  quoteUpdatedAtMs?: string | number | null
  paidAtMs: number
  /** The payer, as Stripe collected them. */
  email: string | null
  name: string | null
  /** What Stripe charged in all, and its shipping and tax parts. */
  amountTotalCents: number | null
  shippingCents: number
  taxCents: number
  /** The platform fee the session was minted with. */
  feeCents: number
  taxMode: StorefrontTaxMode
  /** The address Stripe collected, when the session asked for one. */
  shippingAddress: OrderAddress | null
}

/**
 * What a completed payment does to a quote:
 *
 * - `pay`: the quote is unpaid and the payment is for it as it stands, so it
 *   becomes the order.
 * - `superseded`: the quote is unpaid, but the payment was made through a pay
 *   link the business replaced, or for a version of the quote it has since
 *   changed. Taking it would record a sale at a price or for a link the
 *   business withdrew.
 * - `already-paid`: another payment paid the quote first.
 * - `redelivery`: Stripe sending this same payment again; nothing to do.
 *
 * The two refusals keep the money visible: they are recorded on the quote and
 * the business is told, so a payment is never fulfilled twice and never lost.
 */
export type QuotePaymentDisposition = 'pay' | 'superseded' | 'already-paid' | 'redelivery'

export function quotePaymentDisposition(
  order: Pick<HostOrder, 'status' | 'quote' | 'checkoutSessionId' | 'paymentIntentId'>,
  payment: Pick<QuotePaymentFacts, 'sessionId' | 'paymentIntentId' | 'linkVersion' | 'quoteUpdatedAtMs'>,
): QuotePaymentDisposition {
  const recorded = (order.quote?.unmatchedPayments ?? []).some(
    (entry) => entry?.sessionId === payment.sessionId,
  )
  if (recorded) return 'redelivery'
  if (order.status !== 'pending') {
    const same =
      (order.checkoutSessionId && order.checkoutSessionId === payment.sessionId) ||
      (payment.paymentIntentId && order.paymentIntentId === payment.paymentIntentId)
    return same ? 'redelivery' : 'already-paid'
  }
  const sentVersion = payment.linkVersion
  if (sentVersion != null && sentVersion !== '' && Number(sentVersion) !== quoteLinkVersion(order.quote)) {
    return 'superseded'
  }
  const sentEdit = payment.quoteUpdatedAtMs
  if (sentEdit != null && sentEdit !== '' && Number(sentEdit) !== Number(order.quote?.updatedAtMs)) {
    return 'superseded'
  }
  return 'pay'
}

/** A payment the quote could not take, as {@link QuoteUnmatchedPayment} records it. */
export function quoteUnmatchedPayment(
  facts: Pick<QuotePaymentFacts, 'sessionId' | 'paymentIntentId' | 'amountTotalCents' | 'paidAtMs'>,
  reason: QuoteUnmatchedPayment['reason'],
): QuoteUnmatchedPayment {
  return {
    sessionId: facts.sessionId,
    paymentIntentId: facts.paymentIntentId,
    amountCents: Math.max(0, cents(facts.amountTotalCents)),
    atMs: facts.paidAtMs,
    reason,
  }
}

/** The timeline line for a payment the quote could not take. */
export function quoteUnmatchedPaymentDetail(entry: QuoteUnmatchedPayment): string {
  const amount = `$${(entry.amountCents / 100).toFixed(2)}`
  return entry.reason === 'superseded'
    ? `A payment of ${amount} came through a pay link that was replaced, or for an earlier ` +
        'version of this quote. The money is in Stripe and this quote records no sale for it; ' +
        'refund it in Stripe, or reconcile it by hand.'
    : `A second payment of ${amount} came in after this quote was paid. The money is in Stripe ` +
        'and no second sale was recorded; refund it in Stripe, or reconcile it by hand.'
}

/**
 * The order a paid quote becomes, the whole document as it will stand. A
 * quote carries none of the fields order lists read (`commerce-quotes.ts`);
 * paying it writes them:
 *
 * - `createdAtMs` is the time it was paid, the moment it became an order, so
 *   it lists and counts on the day the money came in.
 * - The customer moves to the top-level fields every order reader asks
 *   (`customerEmail`, `customerName`, `customerPhone`, `customerRecord`), the
 *   payer's own email first, as a paid draft takes it.
 * - The address Stripe collected ships it, else the quote's ship-to; the
 *   quote's bill-to bills it.
 * - The totals are what Stripe charged: its shipping and tax where it charged
 *   any, the platform fee the session was minted with, and its total.
 * - The list fields (`withOrderListFields`) are stamped from all of that.
 */
export function paidQuoteOrder(
  order: HostOrder,
  orderId: string,
  facts: QuotePaymentFacts,
): HostOrder & OrderListFields & { updatedAtMs: number; requiresShipping: boolean } {
  const quote = order.quote as OrderQuote
  const customer = quote?.customer ?? {}
  const stored = order.totals ?? { itemsCents: 0, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 0 }
  const shippingCents = facts.shippingCents > 0 ? facts.shippingCents : cents(stored.shippingCents)
  const taxCents = facts.taxCents > 0 ? facts.taxCents : cents(stored.taxCents)
  const totalCents =
    facts.amountTotalCents != null && Number.isFinite(facts.amountTotalCents)
      ? facts.amountTotalCents
      : cents(stored.itemsCents) - cents(stored.discountCents) + shippingCents + taxCents
  const shippingAddress = facts.shippingAddress ?? quote?.shipTo ?? null
  const label = formatOrderNumber(order, orderId)
  const paid: HostOrder & { updatedAtMs: number } = {
    ...order,
    status: 'paid',
    createdAtMs: facts.paidAtMs,
    customerEmail: text(facts.email) ?? text(customer.email),
    customerName: text(customer.name) ?? text(facts.name) ?? text(customer.company),
    ...(text(customer.phone) ? { customerPhone: text(customer.phone) } : {}),
    ...(customer.record?.kind && customer.record?.id ? { customerRecord: { ...customer.record } } : {}),
    ...(shippingAddress ? { shippingAddress: { ...shippingAddress } } : {}),
    ...(quote?.billTo ? { billingAddress: { ...quote.billTo } } : {}),
    totals: {
      itemsCents: cents(stored.itemsCents),
      discountCents: cents(stored.discountCents),
      shippingCents,
      taxCents,
      feeCents: Math.max(0, cents(facts.feeCents)),
      totalCents,
    },
    taxMode: facts.taxMode,
    paymentIntentId: facts.paymentIntentId ?? undefined,
    checkoutSessionId: facts.sessionId,
    timeline: appendOrderEvent(order, 'paid', `${label} paid through its pay link`, facts.paidAtMs),
    quote: { ...quote, paidAtMs: facts.paidAtMs },
    // New to a shipping tool's feed from the moment it is paid.
    updatedAtMs: facts.paidAtMs,
  }
  if (!paid.paymentIntentId) delete paid.paymentIntentId
  return withOrderListFields(orderId, paid)
}
