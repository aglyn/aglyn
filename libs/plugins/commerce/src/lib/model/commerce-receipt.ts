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

import type { HostOrder } from './commerce-orders'

/**
 * A receipt as DATA (AGL-3619), shared by every surface that prints one: the
 * cloud printer renderers (Star bytes, Epson ePOS-Print XML, plain text) and
 * the 80mm thermal receipt the register shows and prints from the browser
 * (AGL-3609). One model, so a reprint from the console, an auto-print on a
 * sale and the on-screen receipt cannot disagree about what was sold.
 *
 * Amounts are integer minor units in `currency`, and every label is already
 * the words to print: the renderers lay text out, they do not decide it.
 */
export interface ReceiptLine {
  name: string
  /** A variant label or SKU, printed under the name. */
  detail?: string
  quantity: number
  unitCents: number
  totalCents: number
}

export interface ReceiptTender {
  /** e.g. `Cash`, `Visa •••• 4242`, `Gift card`. */
  label: string
  amountCents: number
}

export interface ReceiptData {
  storeName: string
  /** Address, phone or website lines under the store name. */
  storeLines?: string[]
  /** The printable order number, e.g. `1042`. */
  orderNumber: string
  orderId?: string
  createdAtMs: number
  /** IANA zone the timestamp is printed in; UTC when absent. */
  timeZone?: string
  registerName?: string
  cashierName?: string
  /** ISO 4217, any case. */
  currency: string
  lines: ReceiptLine[]
  subtotalCents: number
  discountCents?: number
  shippingCents?: number
  taxCents?: number
  tipCents?: number
  totalCents: number
  tenders?: ReceiptTender[]
  changeCents?: number
  refundedCents?: number
  /** Printed small at the bottom: a returns policy, a thank-you. */
  footer?: string
  /** Code128 under the totals so a return can scan the order back up. Defaults to the order number. */
  barcode?: string
  /** `REPRINT` / `COPY` banner. */
  banner?: string
}

/** A money amount for print: `$12.50`, `-€3.00`. Locale is fixed so receipts read the same everywhere. */
export function formatReceiptMoney(cents: number, currency: string): string {
  const code = String(currency || 'usd').toUpperCase()
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0
  try {
    const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
      .resolvedOptions().maximumFractionDigits ?? 2
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(safe / 10 ** digits)
  } catch {
    return `${(safe / 100).toFixed(2)} ${code}`
  }
}

/** The receipt timestamp, e.g. `Oct 6, 2026, 3:04 PM`. */
export function formatReceiptTime(atMs: number, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone || 'UTC' }).format(
      new Date(atMs),
    )
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(atMs))
  }
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card_present: 'Card',
  card_keyed: 'Card',
  card_link: 'Card',
  gift_card: 'Gift card',
  folio: 'Charged to room',
}

const whole = (value: unknown): number => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * The tenders an order was paid with: the register's payment ledger
 * (`payments[]`, AGL-3607) when the order has one, otherwise a single tender
 * read from the order itself (a cash sale's `changeCents`, a QR card sale).
 */
export function receiptTendersFromOrder(order: HostOrder & Record<string, any>): {
  tenders: ReceiptTender[]
  changeCents: number
  tipCents: number
} {
  const payments: any[] = Array.isArray(order['payments']) ? order['payments'] : []
  if (payments.length) {
    let changeCents = 0
    let tipCents = 0
    const tenders = payments
      .filter((payment) => payment && payment.status === 'succeeded')
      .map((payment) => {
        changeCents += whole(payment.changeCents)
        tipCents += whole(payment.tipCents)
        const card = [payment.cardBrand, payment.last4 ? `**** ${payment.last4}` : '']
          .filter(Boolean)
          .join(' ')
        const label = card || PAYMENT_METHOD_LABELS[String(payment.method)] || 'Payment'
        const tendered = whole(payment.cashTenderedCents)
        return {
          label,
          amountCents: tendered || whole(payment.amountCents) + whole(payment.tipCents),
        }
      })
    return { tenders, changeCents, tipCents }
  }
  const totalCents = whole(order.totals?.totalCents)
  const changeCents = whole(order['changeCents'])
  if (!totalCents) return { tenders: [], changeCents: 0, tipCents: 0 }
  const isCash = order.channel === 'pos' && !order.checkoutSessionId && !order.paymentIntentId
  return {
    tenders: [
      {
        label: order['reservationId'] ? 'Charged to room' : isCash ? 'Cash' : 'Card',
        amountCents: totalCents + (isCash ? changeCents : 0),
      },
    ],
    changeCents: isCash ? changeCents : 0,
    tipCents: 0,
  }
}

export interface ReceiptContext {
  storeName: string
  storeLines?: string[]
  registerName?: string
  cashierName?: string
  timeZone?: string
  currency?: string
  footer?: string
  banner?: string
}

/** The receipt an order prints, from the order as stored. */
export function receiptDataFromOrder(
  orderId: string,
  order: HostOrder & Record<string, any>,
  context: ReceiptContext,
): ReceiptData {
  const lines: ReceiptLine[] = (order.lineItems ?? []).map((line) => {
    const quantity = Math.max(1, Math.round(Number(line.quantity) || 1))
    const unitCents = Math.round(Number(line.unitAmountCents) || 0)
    return {
      name: String(line.name ?? 'Item'),
      ...(line.variantLabel ? { detail: String(line.variantLabel) } : {}),
      quantity,
      unitCents,
      totalCents: unitCents * quantity,
    }
  })
  const totals = order.totals
  const subtotalCents = totals?.itemsCents ?? lines.reduce((sum, line) => sum + line.totalCents, 0)
  const { tenders, changeCents, tipCents } = receiptTendersFromOrder(order)
  const tip = whole((totals as any)?.tipCents) || tipCents
  const orderNumber = order.number ? String(order.number) : orderId.slice(0, 8).toUpperCase()
  return {
    storeName: context.storeName,
    ...(context.storeLines?.length ? { storeLines: context.storeLines } : {}),
    orderNumber,
    orderId,
    createdAtMs: Number(order['createdAtMs']) || Date.now(),
    ...(context.timeZone ? { timeZone: context.timeZone } : {}),
    ...(context.registerName ? { registerName: context.registerName } : {}),
    ...(context.cashierName ? { cashierName: context.cashierName } : {}),
    currency: String(order['currency'] ?? context.currency ?? 'usd'),
    lines,
    subtotalCents,
    ...(totals?.discountCents ? { discountCents: totals.discountCents } : {}),
    ...(totals?.shippingCents ? { shippingCents: totals.shippingCents } : {}),
    ...(totals?.taxCents ? { taxCents: totals.taxCents } : {}),
    ...(tip ? { tipCents: tip } : {}),
    totalCents: totals?.totalCents ?? subtotalCents,
    ...(tenders.length ? { tenders } : {}),
    ...(changeCents ? { changeCents } : {}),
    ...(whole(order.refundedCents) ? { refundedCents: whole(order.refundedCents) } : {}),
    ...(context.footer ? { footer: context.footer } : {}),
    barcode: orderNumber,
    ...(context.banner ? { banner: context.banner } : {}),
  }
}
