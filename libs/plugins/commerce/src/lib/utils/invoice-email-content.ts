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
  formatOrderMoney,
  formatOrderNumber,
  invoiceCheckoutCharge,
  invoiceIsPaid,
  orderCreatedAtMs,
  orderPaidAtMs,
  type HostOrder,
} from '../model'

/*==========================================
 * WHAT THE INVOICE EMAIL SAYS (AGL-4099).
 *
 * The `order-invoice` catalog email's tokens, composed per send, curated for
 * the two things an invoice can be:
 *
 * - UNPAID: "Invoice #1042 from Acme Signs", what it is for, the business's
 *   own message, the number, date, total and what is due, how to pay, and
 *   one button, "Pay $1,250.00", to the order's lasting pay link on the
 *   business's site.
 * - PAID: the same heading and details with the date it was paid, "This
 *   invoice is paid; keep it for your records", and no button.
 *
 * The invoice itself is attached as a PDF by the sender. The figures are the
 * ones the pay link charges (`invoiceCheckoutCharge`) while it is unpaid, and
 * the order's own once paid, so the email, the page and the PDF agree.
 *
 * Pure: the send route and the sample renders call the same function.
 *=========================================*/

/** The catalog key the invoice email is sent and designed under. */
export const INVOICE_EMAIL_KEY = 'order-invoice'

export interface InvoiceEmailContentInput {
  order: HostOrder
  orderId: string
  businessName: string
  currency: string
  /** The subject the email goes under. */
  subject: string
  /** The business's message, as typed; may be empty. */
  message: string
  /** The order's pay link, for an invoice still to be paid; null for a paid one. */
  payUrl: string | null
  /** The site's time zone, for the dates. */
  timeZone?: string | null
}

export interface InvoiceEmailContent {
  /** The catalog email's merge tokens. */
  tokens: Record<string, string>
  /** The same email as plain text, for a send whose design cannot be rendered. */
  text: string
  /** The invoice says it is paid: no button. */
  paid: boolean
  /** The total it shows. */
  totalCents: number
}

/** A date the American way, in the site's time zone: `October 28, 2026`. */
function longDate(ms: number | null | undefined, timeZone?: string | null): string {
  if (!ms || !Number.isFinite(ms)) return ''
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, ...(timeZone ? { timeZone } : {}) }).format(new Date(ms))
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(ms))
  }
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

/** `before tax`, `before shipping`, `before shipping and tax`, or nothing. */
function laterParts(shipping: boolean, tax: boolean): string {
  if (shipping && tax) return 'shipping and tax'
  if (shipping) return 'shipping'
  if (tax) return 'tax'
  return ''
}

/** The invoice email's tokens and its plain-text twin. */
export function invoiceEmailContent(input: InvoiceEmailContentInput): InvoiceEmailContent {
  const { order, orderId, timeZone } = input
  const name = input.businessName.trim()
  const business = name || 'the business'
  const number = formatOrderNumber(order, orderId)
  const paid = invoiceIsPaid(order)
  const payUrl = paid ? '' : String(input.payUrl ?? '').trim()
  const forWhat = order.quote ? 'your quote' : 'your order'
  const quoteSection = order.quote
  const dateMs =
    orderCreatedAtMs(order as never) || Number(quoteSection?.updatedAtMs ?? quoteSection?.createdAtMs) || 0
  const date = longDate(dateMs, timeZone)

  // What it shows: what the link charges while it is unpaid, the order's own figures once paid.
  const charge = paid ? null : invoiceCheckoutCharge(order, orderId)
  const totalCents = charge ? charge.totalCents : Math.max(0, Math.round(Number(order.totals?.totalCents ?? 0)))
  const money = formatOrderMoney(totalCents, input.currency)
  const later = charge ? laterParts(charge.shippingOptions.length > 0, charge.taxAtPayment) : ''
  const total = later ? `${money} before ${later}` : money
  const refundedCents = Math.max(0, Math.round(Number(order.refundedCents ?? 0)))
  const paidOn = longDate(orderPaidAtMs(order), timeZone)
  const status = paid
    ? `${paidOn ? `Paid on ${paidOn}` : 'Paid'}` +
      (refundedCents > 0 ? `, ${formatOrderMoney(refundedCents, input.currency)} refunded` : '')
    : `Unpaid, ${money}${later ? ` plus ${later}` : ''} due`

  const heading = name ? `Invoice ${number} from ${name}` : `Invoice ${number}`
  const intro = paid
    ? `Here is the invoice for ${forWhat} with ${business}` +
      (paidOn ? `, paid on ${paidOn}` : ', which is paid') +
      '. It is attached as a PDF for your records.'
    : `${capitalize(business)} sent you an invoice for ${forWhat}. The details are below, and the invoice is attached as a PDF.`
  const nextStep = paid
    ? 'This invoice is paid; keep it for your records.'
    : payUrl
      ? 'Use the button below to pay it securely by card.' +
        (later ? ` ${capitalize(later)} ${later === 'shipping and tax' ? 'are' : 'is'} added when you pay.` : '') +
        ' The button keeps working until the invoice is paid.'
      : `Reply to this email to arrange payment with ${business}.`
  const buttonLabel = payUrl ? `Pay ${money}${later ? ` plus ${later}` : ''}` : ''
  const message = input.message.trim()
  const details = [`Invoice: ${number}`, date ? `Date: ${date}` : '', `Total: ${total}`, `Status: ${status}`]
    .filter(Boolean)
    .join('\n')

  const tokens: Record<string, string> = {
    'invoice.subject': input.subject,
    'invoice.number': number,
    'invoice.date': date,
    'invoice.total': total,
    'invoice.status': status,
    'invoice.heading': heading,
    'invoice.intro': intro,
    'invoice.message': message,
    'invoice.nextStep': nextStep,
    'invoice.buttonLabel': buttonLabel,
    'invoice.url': payUrl,
  }

  const text = [
    heading,
    intro,
    message,
    details,
    nextStep,
    buttonLabel ? `${buttonLabel}: ${payUrl}` : '',
    `Reply to this email to reach ${business}.`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return { tokens, text, paid, totalCents }
}
