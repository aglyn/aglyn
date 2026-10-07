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

type InvoiceOrder = Pick<
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

function addressLines(address: OrderAddress | undefined | null): string[] {
  if (!address) return []
  return [
    address.name,
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(' '),
    address.country,
    address.phone,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
}

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

/** The invoice's markup: a full document body, every value escaped. */
export function buildOrderInvoiceHtml(input: {
  order: InvoiceOrder
  orderId: string
  store: OrderInvoiceStore
}): string {
  const { order, orderId, store } = input
  const currency = String(order.currency || store.currency || 'USD').toUpperCase()
  const money = (cents: number) => escapeHtml(invoiceMoney(cents, currency))
  const number = formatOrderNumber(order, orderId)
  const createdAt = orderCreatedAtMs(order as never)
  const totals = order.totals
  const itemsCents =
    totals?.itemsCents ??
    (order.lineItems ?? []).reduce((sum, line) => sum + Number(line.unitAmountCents || 0) * Number(line.quantity || 0), 0)
  const totalCents = Number(totals?.totalCents ?? order.amountCents ?? itemsCents)
  const refundedCents = Math.max(0, Number(order.refundedCents ?? 0))

  const billTo = [
    ...(order.billingAddress ? addressLines(order.billingAddress) : [order.customerName ?? ''].filter(Boolean)),
    order.customerEmail ?? '',
  ].filter(Boolean)
  const shipTo = addressLines(order.shippingAddress)

  const rows = (order.lineItems ?? [])
    .map((line) => {
      const quantity = Number(line.quantity) || 0
      const unit = Number(line.unitAmountCents) || 0
      const detail = [line.variantLabel ? escapeHtml(line.variantLabel) : '', line.sku ? `SKU ${escapeHtml(line.sku)}` : '']
        .filter(Boolean)
        .join(' · ')
      return (
        `<tr><td>${escapeHtml(line.name)}${detail ? `<br/><small>${detail}</small>` : ''}</td>` +
        `<td align="right">${escapeHtml(quantity)}</td>` +
        `<td align="right">${money(unit)}</td>` +
        `<td align="right">${money(unit * quantity)}</td></tr>`
      )
    })
    .join('')

  const summary: Array<[string, string]> = [['Subtotal', money(itemsCents)]]
  if (Number(totals?.discountCents ?? 0) > 0) summary.push(['Discount', `−${money(Number(totals?.discountCents))}`])
  if (Number(totals?.shippingCents ?? 0) > 0) summary.push(['Shipping', money(Number(totals?.shippingCents))])
  if (Number(totals?.taxCents ?? 0) > 0) summary.push(['Tax', money(Number(totals?.taxCents))])
  summary.push(['<b>Total</b>', `<b>${money(totalCents)}</b>`])
  if (Number(totals?.tipCents ?? 0) > 0) summary.push(['Tip', money(Number(totals?.tipCents))])
  if (refundedCents > 0) {
    summary.push(['Refunded', `−${money(refundedCents)}`])
    summary.push(['<b>Net paid</b>', `<b>${money(Math.max(0, totalCents - refundedCents))}</b>`])
  }

  const block = (title: string, lines: string[]) =>
    lines.length ? `<td valign="top"><b>${title}</b><br/>${lines.map((line) => escapeHtml(line)).join('<br/>')}</td>` : ''

  return (
    `<title>${escapeHtml(`Invoice ${number}`)}</title>` +
    `<h2>${escapeHtml(store.name || 'Invoice')}</h2>` +
    `<h3>${escapeHtml(`Invoice ${number}`)}</h3>` +
    `<p>${createdAt ? `Date: ${escapeHtml(new Date(createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}<br/>` : ''}` +
    `Payment: ${escapeHtml(invoicePaymentStatus(order))}<br/>Currency: ${escapeHtml(currency)}</p>` +
    `<table width="100%" cellpadding="6"><tr>${block('Bill to', billTo)}${block('Ship to', shipTo)}</tr></table>` +
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
