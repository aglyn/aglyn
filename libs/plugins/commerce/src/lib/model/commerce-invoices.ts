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

import {
  appendOrderEvent,
  formatOrderNumber,
  orderCreatedAtMs,
  type HostOrder,
  type OrderStatus,
  type OrderTimelineEvent,
} from './commerce-orders'
import {
  QUOTE_MIN_CHARGE_CENTS,
  payLinkCheckoutCharge,
  quoteCheckoutCharge,
  quotePageAddress,
  quotePageLines,
  quotePageStatus,
  quotePayRefusal,
  quotePayRefusalMessage,
  type QuoteCheckoutCharge,
  type QuotePageView,
  type QuotePayRefusal,
} from './commerce-quote-pay'
import {
  isQuote,
  type OrderInvoiceSendRecord,
  type QuoteEmailThread,
  type QuoteTaxBasis,
} from './commerce-quotes'
import type { ResolvedShippingRate } from './commerce-shipping'
import { lineRequiresShipping } from './order-fulfillment'

/*==========================================
 * INVOICES FOR ORDERS AND QUOTES (AGL-4099).
 *
 * The business emails an invoice for an order or a quote: unpaid, it asks
 * for payment through ONE lasting pay link; paid, it is the record. The link
 * is slice 2's (`/pay-quote?q=&t=`, AGL-4094), generalized rather than made
 * twice:
 *
 * - THE TOKEN is unchanged: `<version>.<HMAC(quote-link:hostId:orderId:version)>`,
 *   no expiry. An order id names one document under `hosts/{hostId}/orders`
 *   whatever its channel, so the same signature serves any order.
 * - THE VERSION is the quote's `quote.linkVersion` for a quote, as before,
 *   so every link already sent keeps verifying; any other order keeps its own
 *   as `payLink.version` (`orderPayLinkVersion`). Absent reads as 1.
 * - WHICH ORDERS the link opens ({@link orderPayLinkKind}): a quote, and a
 *   draft order (`channel: 'draft'`), the two a business composes for a
 *   customer to pay online. A register sale still open takes its payment at
 *   the register, an online order was paid at checkout, and a marketplace
 *   order on its channel, so none of them is linked; their invoices go out
 *   paid, as the record.
 * - THE PAGE shows a non-quote order as "Invoice #N", with no proofs and no
 *   approval ({@link buildInvoicePageView}).
 * - THE CHARGE is priced from the stored lines and totals on every press
 *   ({@link invoiceCheckoutCharge}): the draft's discount, its frozen tax (or
 *   Stripe Tax at payment where the draft used it), and the shipping rates
 *   the draft offered when it was made (`draftShipping`).
 *
 * Pure: the console, the routes and the webhook read the same answers.
 *=========================================*/

/** Which page a pay link opens for an order: a quote, an invoice, or none. */
export type OrderPayLinkKind = 'quote' | 'invoice'

/** The most invoice sends an order keeps on record; the oldest go first. */
export const INVOICE_MAX_SENDS = 50

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const cents = (value: unknown): number => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? number : 0
}

const text = (value: unknown): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed : null
}

/**
 * Which page the lasting pay link opens for an order, or null when it opens
 * none: a quote (with its quote section), or a draft order as an invoice.
 */
export function orderPayLinkKind(
  order: Pick<HostOrder, 'channel'> & Partial<Pick<HostOrder, 'quote'>> | null | undefined,
): OrderPayLinkKind | null {
  if (!order) return null
  if (isQuote(order)) return order.quote ? 'quote' : null
  return order.channel === 'draft' ? 'invoice' : null
}

/** `Invoice #1042`: the order's own number, which a paid quote keeps too. */
export function formatInvoiceNumber(order: Pick<HostOrder, 'number'>, orderId?: string): string {
  return `Invoice ${formatOrderNumber(order, orderId)}`
}

const PAID_STATUSES: ReadonlySet<OrderStatus | string> = new Set([
  'paid',
  'partially_fulfilled',
  'fulfilled',
  'delivered',
])

/** The order is paid (and not refunded or canceled): its invoice is the record. */
export function invoiceIsPaid(order: Pick<HostOrder, 'status'> | null | undefined): boolean {
  return PAID_STATUSES.has(String(order?.status ?? ''))
}

/**
 * When the order was paid: a quote's stamp, else the timeline's `paid`
 * event, else (an order created paid, as checkout's are) when it was made.
 * Null for an order not paid.
 */
export function orderPaidAtMs(
  order: Pick<HostOrder, 'status' | 'quote' | 'timeline'> & { createdAtMs?: number } | null | undefined,
): number | null {
  if (!order || order.status === 'pending') return null
  const stamped = Number(order.quote?.paidAtMs)
  if (Number.isFinite(stamped) && stamped > 0) return stamped
  const event = (order.timeline ?? []).find((entry) => entry?.event === 'paid')
  if (event && Number(event.atMs) > 0) return Number(event.atMs)
  const created = orderCreatedAtMs(order as never)
  return created > 0 ? created : null
}

/*==========================================
 * WHAT AN INVOICE'S PAY LINK CHARGES
 *=========================================*/

/** What an invoice's Checkout Session charges, with the rates a draft lets the buyer pick from. */
export interface InvoiceCheckoutCharge extends QuoteCheckoutCharge {
  /** The draft's shipping rates, picked at payment; empty when shipping is fixed or there is none. */
  shippingOptions: ResolvedShippingRate[]
  /** Where those rates ship; empty with none. */
  shippingCountries: string[]
}

/**
 * The tax basis an order's stored figures give its invoice: Stripe Tax at
 * payment where the order was composed under it, its frozen tax as a fixed
 * figure (charged as the rate that yields it on the taxed line, the way a tax
 * service's quote is), else none.
 */
export function invoiceTaxBasis(order: Pick<HostOrder, 'taxMode' | 'totals'>): QuoteTaxBasis {
  if (order.taxMode === 'stripe-automatic') return { kind: 'at-payment' }
  const taxCents = Math.max(0, cents(order.totals?.taxCents))
  if (taxCents > 0) return { kind: 'service', taxCents }
  return { kind: 'none', reason: 'not-collected' }
}

/** A stored draft rate, as Stripe is given it, or null for one that is not a rate. */
function draftRate(option: unknown): ResolvedShippingRate | null {
  if (!option || typeof option !== 'object') return null
  const source = option as Record<string, unknown>
  const name = text(source['name'])
  const amountCents = cents(source['amountCents'])
  if (!name || amountCents < 0) return null
  return { rateId: String(source['rateId'] ?? '') || name, name, amountCents }
}

/**
 * What an invoice's pay link charges, from the stored order alone. A quote is
 * charged as slice 2 charges it; any other order from its lines, its
 * discount, its tax ({@link invoiceTaxBasis}) and, for a draft, the shipping
 * rates it offered when it was made (Stripe asks for the address and the
 * buyer picks one, as on the draft's first link).
 */
export function invoiceCheckoutCharge(
  order: Pick<HostOrder, 'number' | 'lineItems' | 'quote' | 'totals' | 'taxMode'> &
    Partial<Pick<HostOrder, 'draftShipping'>>,
  orderId: string,
): InvoiceCheckoutCharge {
  if (order.quote) return { ...quoteCheckoutCharge(order, orderId), shippingOptions: [], shippingCountries: [] }
  const discountCents = Math.max(0, cents(order.totals?.discountCents))
  const charge = payLinkCheckoutCharge({
    lineItems: order.lineItems ?? [],
    tax: invoiceTaxBasis(order),
    discount: discountCents > 0 ? { kind: 'amount', amountCents: discountCents } : null,
    shippingCents: 0,
    label: formatInvoiceNumber(order, orderId),
  })
  const options = (order.draftShipping?.options ?? [])
    .map(draftRate)
    .filter((rate): rate is ResolvedShippingRate => rate !== null)
    .slice(0, 5)
  const countries = (order.draftShipping?.countries ?? [])
    .map((country) => String(country ?? '').trim().toUpperCase())
    .filter((country) => /^[A-Z]{2}$/.test(country))
  return { ...charge, shippingOptions: options, shippingCountries: options.length ? countries : [] }
}

/*==========================================
 * WHETHER AN INVOICE CAN BE PAID NOW
 *=========================================*/

/**
 * Why an order cannot be paid through its pay link now: a quote's reasons,
 * and two of an invoice's own. `not-payable` is an order the link does not
 * open (a register sale still open, say); `shipping-unknown` is a draft made
 * before drafts kept their shipping rates, whose shipping cannot be charged.
 */
export type InvoicePayRefusal = QuotePayRefusal | 'not-payable' | 'shipping-unknown'

export function invoicePayRefusal(
  order: Pick<HostOrder, 'number' | 'status' | 'lineItems' | 'quote' | 'totals' | 'taxMode' | 'channel'> &
    Partial<Pick<HostOrder, 'draftShipping'>>,
  orderId: string,
): InvoicePayRefusal | null {
  const kind = orderPayLinkKind(order)
  if (kind === 'quote') return quotePayRefusal(order, orderId)
  if (order.status === 'cancelled' || order.status === 'refunded') return 'closed'
  if (order.status !== 'pending') return 'paid'
  if (kind !== 'invoice') return 'not-payable'
  const ships = (order.lineItems ?? []).some((line) => line && !line.included && lineRequiresShipping(line))
  if (ships && !order.draftShipping) return 'shipping-unknown'
  if (invoiceCheckoutCharge(order, orderId).totalCents < QUOTE_MIN_CHARGE_CENTS) return 'nothing-to-pay'
  return null
}

/** What the customer is told for a refusal, in the page's words: "quote" or "invoice". */
export function invoicePayRefusalMessage(
  reason: InvoicePayRefusal,
  storeName: string,
  kind: OrderPayLinkKind,
): string {
  const business = storeName.trim() || 'the business'
  if (kind === 'quote' && reason !== 'not-payable' && reason !== 'shipping-unknown') {
    return quotePayRefusalMessage(reason, storeName)
  }
  switch (reason) {
    case 'paid':
      return 'This invoice has been paid.'
    case 'closed':
      return `This invoice is closed. Contact ${business} with any questions.`
    case 'approval-required':
      return `${business} asks you to approve the proof before you pay.`
    case 'tax-undecided':
      return `${business} has not finished setting up payments. Contact them to pay this invoice.`
    case 'nothing-to-pay':
      return `This invoice has nothing to pay by card. Contact ${business} with any questions.`
    case 'not-payable':
    case 'shipping-unknown':
      return `This invoice can’t be paid online. Contact ${business} to pay it.`
  }
}

/*==========================================
 * THE CUSTOMER'S PAGE FOR AN INVOICE
 *=========================================*/

/**
 * The pay link's page for an order that is not a quote: "Invoice #N", its
 * lines and totals, the customer's addresses, and Pay while it is unpaid. No
 * proofs, no approval, no notes or terms (an order carries none). Allow-listed
 * as the quote's view is: the order's email, phone, Stripe ids and timeline
 * never leave the server.
 */
export function buildInvoicePageView(input: {
  order: Pick<
    HostOrder,
    | 'number'
    | 'status'
    | 'channel'
    | 'lineItems'
    | 'totals'
    | 'quote'
    | 'timeline'
    | 'taxMode'
    | 'customerName'
    | 'billingAddress'
    | 'shippingAddress'
  > &
    Partial<Pick<HostOrder, 'draftShipping'>> & { createdAtMs?: number }
  orderId: string
  storeName: string
  currency: string
  /** The order's status page, once paid. */
  receiptUrl?: string | null
}): QuotePageView {
  const { order } = input
  const status = quotePageStatus(order.status)
  const unpaid = status.status === 'unpaid'
  const charge = invoiceCheckoutCharge(order, input.orderId)
  const stored = order.totals
  const totals =
    unpaid || !stored
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
  const taxAtPayment = unpaid && charge.taxAtPayment
  const created = orderCreatedAtMs(order as never)
  return {
    state: 'quote',
    kind: 'invoice',
    storeName: input.storeName,
    number: formatInvoiceNumber(order, input.orderId),
    dateMs: created > 0 ? created : null,
    // An invoice is not edited; the page has no version to send back.
    version: 0,
    currency: input.currency || 'USD',
    customerName: text(order.customerName),
    company: null,
    billTo: quotePageAddress(order.billingAddress),
    shipTo: quotePageAddress(order.shippingAddress),
    lines: quotePageLines(order.lineItems ?? []),
    totals,
    discountLabel: null,
    taxLabel: taxAtPayment ? 'Tax is added at payment' : 'Tax',
    taxAtPayment,
    shippingAtPayment: unpaid && charge.shippingOptions.length > 0,
    notes: null,
    terms: null,
    status: status.status,
    statusLabel: status.label,
    paidAtMs: orderPaidAtMs(order),
    receiptUrl: unpaid ? null : (input.receiptUrl ?? null),
    approvalRequired: false,
    payable: unpaid && invoicePayRefusal(order, input.orderId) === null,
    revision: 1,
    proofs: [],
    response: null,
    respondable: false,
  }
}

/*==========================================
 * EMAILING AN INVOICE
 *=========================================*/

/** The order's invoice sends on record, oldest first. */
export function invoiceSends(order: Pick<HostOrder, 'invoiceSends'> | null | undefined): OrderInvoiceSendRecord[] {
  return Array.isArray(order?.invoiceSends)
    ? order.invoiceSends.filter((send) => send && typeof send === 'object')
    : []
}

/** The last time the order's invoice was emailed, or null. */
export function lastInvoiceSend(order: Pick<HostOrder, 'invoiceSends'> | null | undefined): OrderInvoiceSendRecord | null {
  const sends = invoiceSends(order)
  return sends.length ? sends[sends.length - 1] : null
}

/** Where the invoice goes: what was typed, else the order's customer, else a quote's. */
export function invoiceSendRecipient(
  order: Pick<HostOrder, 'customerEmail' | 'quote'> | null | undefined,
  typed: string | null | undefined,
): string {
  return (
    String(typed ?? '').trim() ||
    String(order?.customerEmail ?? '').trim() ||
    String(order?.quote?.customer?.email ?? '').trim()
  )
}

/**
 * The conversation an invoice replies into: a quote's own (its emails, and a
 * request's confirmation before them), else the order's, which the first
 * invoice starts.
 */
export function invoiceEmailThread(
  order: Pick<HostOrder, 'quote' | 'emailThread'> | null | undefined,
): QuoteEmailThread | null {
  if (order?.quote) return order.quote.emailThread ?? null
  return order?.emailThread ?? null
}

/**
 * The subject an invoice defaults to: the conversation's, so it stays one
 * conversation in the customer's mailbox, else `Invoice #1042 from Acme Signs`.
 */
export function invoiceEmailDefaultSubject(
  order: Pick<HostOrder, 'number' | 'quote' | 'emailThread'>,
  businessName: string,
  orderId?: string,
): string {
  const thread = String(invoiceEmailThread(order)?.subject ?? '').trim()
  if (thread) return thread
  const name = String(businessName ?? '').trim()
  const number = formatInvoiceNumber(order, orderId)
  return name ? `${number} from ${name}` : number
}

/** Why an invoice cannot be emailed now, and what the console says. */
export type InvoiceSendRefusal =
  | 'unknown'
  | 'closed'
  | 'empty'
  | 'not-payable'
  | 'approval-required'
  | 'tax-undecided'
  | 'nothing-to-pay'
  | 'shipping-unknown'
  | 'no-address'
  | 'bad-address'

/**
 * Why the order's invoice cannot be emailed to `to` now, if it cannot:
 * a canceled or refunded order, one with nothing on it, an unpaid order its
 * pay link cannot take payment for (and why), and the address.
 */
export function invoiceSendRefusal(
  order:
    | (Pick<HostOrder, 'number' | 'status' | 'channel' | 'lineItems' | 'totals' | 'quote' | 'taxMode'> &
        Partial<Pick<HostOrder, 'draftShipping'>>)
    | null
    | undefined,
  orderId: string,
  to: string,
): InvoiceSendRefusal | null {
  if (!order) return 'unknown'
  if (order.status === 'cancelled' || order.status === 'refunded') return 'closed'
  const lines = (order.lineItems ?? []).filter(Boolean)
  if (!lines.length && cents(order.totals?.totalCents) <= 0) return 'empty'
  if (!invoiceIsPaid(order)) {
    const refused = invoicePayRefusal(order, orderId)
    if (refused === 'closed') return 'closed'
    if (refused && refused !== 'paid') return refused
  }
  if (!to) return 'no-address'
  if (to.length > 320 || !EMAIL.test(to)) return 'bad-address'
  return null
}

/** What the console says for a refused invoice send. */
export function invoiceSendRefusalMessage(reason: InvoiceSendRefusal): string {
  switch (reason) {
    case 'unknown':
      return 'Unknown order'
    case 'closed':
      return 'This order was canceled or refunded, so it has no invoice to send.'
    case 'empty':
      return 'This order has no items and no total, so there is nothing to put on an invoice.'
    case 'not-payable':
      return 'This order isn’t paid yet, and it can’t be paid online from an invoice. Take its payment where the sale was made, then send the invoice.'
    case 'approval-required':
      return 'This quote asks your customer to approve the proof before they pay, and they haven’t yet. Send the quote so they can approve it, then send the invoice.'
    case 'tax-undecided':
      return 'Sales tax isn’t set up for this store yet, so the invoice can’t be paid online. Finish the tax settings, then send it.'
    case 'nothing-to-pay':
      return 'This invoice totals less than $0.50, so it can’t be paid by card.'
    case 'shipping-unknown':
      return 'This draft order was made before invoices could charge its shipping, so its invoice can’t be paid online. Make a new draft order and send its invoice.'
    case 'no-address':
      return 'This order has no email for the customer. Type where to send the invoice.'
    case 'bad-address':
      return 'Enter a valid email address to send the invoice to.'
  }
}

/** The HTTP status a refused send answers with. */
export function invoiceSendRefusalStatus(reason: InvoiceSendRefusal): number {
  if (reason === 'unknown') return 404
  if (reason === 'no-address' || reason === 'bad-address') return 400
  return 409
}

/**
 * What an invoice email changes on the order, as a merge: the send on
 * record, a line on the timeline, and the conversation moved on, on the
 * quote for a quote and on the order otherwise.
 */
export function invoiceSendPatch(
  order: Pick<HostOrder, 'timeline' | 'invoiceSends' | 'quote'>,
  send: OrderInvoiceSendRecord,
  thread: QuoteEmailThread,
): {
  timeline: OrderTimelineEvent[]
  invoiceSends: OrderInvoiceSendRecord[]
  emailThread?: QuoteEmailThread
  quote?: { emailThread: QuoteEmailThread }
} {
  return {
    timeline: appendOrderEvent(
      order,
      'invoice-sent',
      // The address is on the send record, which erasure clears; the timeline keeps none.
      `${send.paid ? 'Paid invoice' : 'Invoice'} emailed to the customer by ${send.by}`,
      send.atMs,
    ),
    invoiceSends: [...invoiceSends(order), send].slice(-INVOICE_MAX_SENDS),
    ...(order.quote ? { quote: { emailThread: thread } } : { emailThread: thread }),
  }
}
