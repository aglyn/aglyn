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
  formatOrderNumber,
  orderCreatedAtMs,
  type HostOrder,
  type OrderAddress,
} from '../model/commerce-orders'
import { escapeHtml } from './escape-html'

/**
 * The printable invoice (AGL-3611), beside the packing slip: the order as a
 * bill — who sold it, to whom, each line with its unit price, the totals,
 * what was refunded and what was paid in the end.
 *
 * A string of markup, because it is written into a print popup the way the
 * packing slip is, and the browser's print dialog saves it as a PDF. Every
 * value is escaped: the addresses are typed by the shopper, and the popup
 * inherits the console's origin (AGL-2283). No `<style>` and no `style`
 * attributes, because the popup inherits the console's content security
 * policy; the layout is the table attributes HTML still honors.
 */

export interface OrderInvoiceStore {
  /** The business's name, as its emails sign. */
  name: string
  /** The store's currency, for an order that does not carry its own. */
  currency: string
  /** The receipt footer the store set, printed at the foot. */
  footer?: string | null
  /** The store's terms address, printed at the foot. */
  termsUrl?: string | null
}

/**
 * The invoice's store from the site's document and its store settings, as
 * the order dialog's Invoice button and `commerce/order-print` read them.
 */
export function invoiceStoreFrom(
  host: Record<string, unknown> | undefined | null,
  store: Record<string, unknown> | undefined | null,
): OrderInvoiceStore {
  const hostData = host ?? {}
  const storeData = store ?? {}
  return {
    name: String(hostData['businessName'] ?? hostData['displayName'] ?? hostData['name'] ?? ''),
    currency: String(storeData['currency'] ?? 'USD'),
    footer: (storeData['receiptFooter'] as string | undefined) ?? null,
    termsUrl: (storeData['termsUrl'] as string | undefined) ?? null,
  }
}

export type InvoiceOrder = Pick<
  HostOrder,
  | 'number'
  | 'status'
  | 'lineItems'
  | 'totals'
  | 'refundedCents'
  | 'customerName'
  | 'customerEmail'
  | 'shippingAddress'
  | 'billingAddress'
> & { createdAtMs?: number; currency?: string; amountCents?: number }

/** Money in the order's currency, integer cents in. */
export function invoiceMoney(cents: number, currency: string): string {
  const amount = (Number(cents) || 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${String(currency || '').toUpperCase()}`.trim()
  }
}

/** The United States, however an address names it: left off, as a US envelope does. */
const US_COUNTRY = /^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i

/**
 * An address as lines, the American way: name, street, `City, ST 12345`,
 * the country unless it is the United States, then the phone when the
 * address carries one and it is wanted.
 */
export function invoiceAddressLines(
  address: Partial<OrderAddress> | undefined | null,
  options: { phone?: boolean } = {},
): string[] {
  if (!address) return []
  const clean = (part: unknown) => String(part ?? '').trim()
  const region = [clean(address.state), clean(address.postalCode)].filter(Boolean).join(' ')
  return [
    clean(address.name),
    clean(address.line1),
    clean(address.line2),
    [clean(address.city), region].filter(Boolean).join(', '),
    US_COUNTRY.test(clean(address.country)) ? '' : clean(address.country),
    options.phone === false ? '' : clean(address.phone),
  ].filter(Boolean)
}

const addressLines = (address: OrderAddress | undefined | null) => invoiceAddressLines(address)

/** What the payment line says. */
export function invoicePaymentStatus(order: Pick<InvoiceOrder, 'status' | 'refundedCents' | 'totals' | 'amountCents'>): string {
  const total = Number(order.totals?.totalCents ?? order.amountCents ?? 0)
  const refunded = Math.max(0, Number(order.refundedCents ?? 0))
  const status = String(order.status ?? '')
  if (status === 'pending' || status === 'draft') return 'Awaiting payment'
  if (status === 'cancelled') return 'Canceled'
  if (refunded > 0 && refunded >= total) return 'Refunded'
  if (refunded > 0) return 'Paid, partially refunded'
  return 'Paid'
}

/** One line of an invoice, as both the printed page and the PDF set it. */
export interface InvoiceLine {
  name: string
  /** The option chosen and the SKU, as one line under the name. */
  detail: string
  /** A typed line's own description. */
  description: string
  quantity: number
  unitCents: number
  amountCents: number
  /** Included at no charge. */
  included: boolean
}

/** One row of an invoice's summary: a figure, or a deduction printed with a minus. */
export interface InvoiceSummaryRow {
  label: string
  cents: number
  minus?: boolean
  /** The row the summary leads to: the total, or what was paid after refunds. */
  emphasis?: boolean
}

/** An invoice's content, worked out once for the printed page and the PDF. */
export interface OrderInvoiceData {
  /** `#1042`. */
  number: string
  /** When the order was placed; 0 when it does not say. */
  dateMs: number
  currency: string
  paymentStatus: string
  billTo: string[]
  shipTo: string[]
  lines: InvoiceLine[]
  summary: InvoiceSummaryRow[]
  footer: string
  termsUrl: string
}

/** What an invoice says, from the order and its store. */
export function buildOrderInvoiceData(input: {
  order: InvoiceOrder
  orderId: string
  store: OrderInvoiceStore
}): OrderInvoiceData {
  const { order, orderId, store } = input
  const currency = String(order.currency || store.currency || 'USD').toUpperCase()
  const totals = order.totals
  const itemsCents =
    totals?.itemsCents ??
    (order.lineItems ?? []).reduce((sum, line) => sum + Number(line.unitAmountCents || 0) * Number(line.quantity || 0), 0)
  const totalCents = Number(totals?.totalCents ?? order.amountCents ?? itemsCents)
  const refundedCents = Math.max(0, Number(order.refundedCents ?? 0))

  const lines = (order.lineItems ?? []).map((line): InvoiceLine => {
    const quantity = Number(line.quantity) || 0
    const unit = Number(line.unitAmountCents) || 0
    return {
      name: String(line.name ?? ''),
      detail: [line.variantLabel ? String(line.variantLabel) : '', line.sku ? `SKU ${line.sku}` : ''].filter(Boolean).join(' · '),
      description: String(line.description ?? '').trim(),
      quantity,
      unitCents: unit,
      amountCents: unit * quantity,
      included: line.included === true,
    }
  })

  const summary: InvoiceSummaryRow[] = [{ label: 'Subtotal', cents: itemsCents }]
  if (Number(totals?.discountCents ?? 0) > 0) summary.push({ label: 'Discount', cents: Number(totals?.discountCents), minus: true })
  if (Number(totals?.shippingCents ?? 0) > 0) summary.push({ label: 'Shipping', cents: Number(totals?.shippingCents) })
  if (Number(totals?.taxCents ?? 0) > 0) summary.push({ label: 'Tax', cents: Number(totals?.taxCents) })
  summary.push({ label: 'Total', cents: totalCents, emphasis: true })
  if (Number(totals?.tipCents ?? 0) > 0) summary.push({ label: 'Tip', cents: Number(totals?.tipCents) })
  if (refundedCents > 0) {
    summary.push({ label: 'Refunded', cents: refundedCents, minus: true })
    summary.push({ label: 'Net paid', cents: Math.max(0, totalCents - refundedCents), emphasis: true })
  }

  return {
    number: formatOrderNumber(order, orderId),
    dateMs: orderCreatedAtMs(order as never),
    currency,
    paymentStatus: invoicePaymentStatus(order),
    billTo: [
      ...(order.billingAddress ? addressLines(order.billingAddress) : [order.customerName ?? ''].filter(Boolean)),
      order.customerEmail ?? '',
    ].filter(Boolean),
    shipTo: addressLines(order.shippingAddress),
    lines,
    summary,
    footer: String(store.footer ?? '').trim(),
    termsUrl: String(store.termsUrl ?? '').trim(),
  }
}

/** The invoice's markup: a full document body, every value escaped. */
export function buildOrderInvoiceHtml(input: {
  order: InvoiceOrder
  orderId: string
  store: OrderInvoiceStore
}): string {
  const data = buildOrderInvoiceData(input)
  const { store } = input
  const money = (cents: number) => escapeHtml(invoiceMoney(cents, data.currency))
  const number = data.number

  const rows = data.lines
    .map((line) => {
      const detail = [line.detail, line.description].filter(Boolean).map((part) => escapeHtml(part)).join('<br/>')
      return (
        `<tr><td>${escapeHtml(line.name)}${detail ? `<br/><small>${detail}</small>` : ''}</td>` +
        `<td align="right">${escapeHtml(line.quantity)}</td>` +
        `<td align="right">${line.included ? '' : money(line.unitCents)}</td>` +
        `<td align="right">${line.included ? 'Included' : money(line.amountCents)}</td></tr>`
      )
    })
    .join('')

  const summary = data.summary.map(({ label, cents, minus, emphasis }): [string, string] => {
    const figure = `${minus ? '−' : ''}${money(cents)}`
    return emphasis ? [`<b>${label}</b>`, `<b>${figure}</b>`] : [label, figure]
  })

  const block = (title: string, lines: string[]) =>
    lines.length ? `<td valign="top"><b>${title}</b><br/>${lines.map((line) => escapeHtml(line)).join('<br/>')}</td>` : ''

  return (
    `<title>${escapeHtml(`Invoice ${number}`)}</title>` +
    `<h2>${escapeHtml(store.name || 'Invoice')}</h2>` +
    `<h3>${escapeHtml(`Invoice ${number}`)}</h3>` +
    `<p>${data.dateMs ? `Date: ${escapeHtml(new Date(data.dateMs).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}<br/>` : ''}` +
    `Payment: ${escapeHtml(data.paymentStatus)}<br/>Currency: ${escapeHtml(data.currency)}</p>` +
    `<table width="100%" cellpadding="6"><tr>${block('Bill to', data.billTo)}${block('Ship to', data.shipTo)}</tr></table>` +
    `<table width="100%" cellpadding="6" border="1" cellspacing="0">` +
    `<tr><th align="left">Item</th><th align="right">Qty</th><th align="right">Unit price</th><th align="right">Amount</th></tr>` +
    rows +
    `</table>` +
    `<table width="100%" cellpadding="4">${summary
      .map(([label, value]) => `<tr><td align="right" width="80%">${label}</td><td align="right">${value}</td></tr>`)
      .join('')}</table>` +
    (store.footer ? `<p>${escapeHtml(store.footer)}</p>` : '') +
    (store.termsUrl ? `<p><small>Terms: ${escapeHtml(store.termsUrl)}</small></p>` : '')
  )
}
