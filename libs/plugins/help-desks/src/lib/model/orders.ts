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
 * An order as a help desk agent reads it beside a ticket (AGL-3824), and
 * how it is read out of commerce's public order view.
 *
 * Commerce's order events and its order history both carry the order in the
 * public API's shape (`GET /v1/sites/{siteId}/orders/{orderId}`); the shape
 * comes from commerce's contracts (AGL-3980). It is still read defensively,
 * so an order stored before a field existed reads as well as a new one.
 */

import type { OrderEventOrder } from '@aglyn/plugins-commerce/contracts'

export interface HelpDeskOrderItem {
  /** The product's id at the site, when the line names one. */
  productId: string | null
  name: string
  sku: string | null
  quantity: number
  /** Integer cents in the order's currency. */
  unitCents: number
}

export interface HelpDeskOrder {
  /** The order's id at the site. */
  id: string
  /** `#1042`, or `null` for an order with no number. */
  number: string | null
  createdAtMs: number
  /** ISO 4217, upper case. */
  currency: string
  /** Integer cents. */
  totalCents: number
  refundedCents: number
  /** The order's status in commerce's words: `paid`, `fulfilled`, `cancelled`… */
  status: string
  items: HelpDeskOrderItem[]
  /** The order in the console, for an agent with a seat there; `null` when no page shows orders. */
  url: string | null
}

/** A buyer as an order names them. */
export interface HelpDeskOrderBuyer {
  email: string
  name: string | null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

const cents = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : 0
}

function readTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const at = Date.parse(value)
    return Number.isFinite(at) ? at : null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const seconds = Number(record['_seconds'] ?? record['seconds'])
    if (Number.isFinite(seconds)) return seconds * 1000
  }
  return null
}

/**
 * The order in a public order view, and its buyer, or `null` for one a help
 * desk is not told about: a test-mode order, or one with no buyer's address
 * to file it under.
 */
export function helpDeskOrderFromView(
  order: OrderEventOrder | null | undefined,
  fallbackAtMs: number,
): { order: HelpDeskOrder; buyer: HelpDeskOrderBuyer } | null {
  if (!order || typeof order !== 'object') return null
  const id = text(order.id)
  if (!id) return null
  if (order.livemode === false) return null
  const email = String(order.customerEmail ?? '').trim().toLowerCase()
  if (!EMAIL.test(email)) return null
  const totals: Partial<OrderEventOrder['totals']> = order.totals ?? {}
  const lines = Array.isArray(order.lineItems) ? (order.lineItems as unknown[]) : []
  const items: HelpDeskOrderItem[] = lines.slice(0, 50).flatMap((line) => {
    // Commerce types `lineItems` as `unknown`; the line fields read here are this plugin's own reading.
    const record = (line ?? {}) as Record<string, unknown>
    const quantity = Math.max(0, Math.floor(Number(record['quantity'] ?? 0)))
    if (!quantity) return []
    return [
      {
        productId: text(record['productId']),
        name: text(record['name']) ?? 'Item',
        sku: text(record['sku']),
        quantity,
        unitCents: cents(record['unitAmountCents'] ?? record['unitCents']),
      },
    ]
  })
  return {
    buyer: { email, name: text(order.customerName) },
    order: {
      id,
      number: typeof order.number === 'number' ? `#${order.number}` : null,
      createdAtMs: readTime(order.created) ?? fallbackAtMs,
      currency: (text(order.currency) ?? 'usd').toUpperCase(),
      totalCents: cents(totals.totalCents ?? totals.itemsCents),
      refundedCents: cents(order.refundedCents),
      status: text(order.status) ?? 'open',
      items,
      url: null,
    },
  }
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  cancelled: 'Canceled',
  canceled: 'Canceled',
  partially_refunded: 'Partially refunded',
  partially_fulfilled: 'Partially fulfilled',
}

/** The status as an agent reads it: `Paid`, `Fulfilled`, `Canceled`. */
export function orderStatusLabel(status: string): string {
  const known = STATUS_LABELS[status]
  if (known) return known
  const words = status.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Open'
}

/** Money as an agent reads it: `$42.00`, `€9.50`, `42.00 SEK`. */
export function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountCents / 100)
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`
  }
}

/** A date as an agent reads it, in UTC so every help desk shows the same day: `Oct 7, 2026`. */
export function formatOrderDate(atMs: number): string {
  return new Date(atMs).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** `2 × Mug, 1 × Tee`, cut short past a few lines. */
export function orderItemsLine(order: HelpDeskOrder, max = 5): string {
  const shown = order.items.slice(0, max).map((item) => `${item.quantity} × ${item.name}`)
  const more = order.items.length - shown.length
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ')
}

/** The order on one line: `#1042 · Oct 7, 2026 · $42.00 · Paid`. */
export function orderOneLine(order: HelpDeskOrder): string {
  return [
    order.number ?? order.id,
    formatOrderDate(order.createdAtMs),
    formatMoney(order.totalCents, order.currency),
    orderStatusLabel(order.status),
  ].join(' · ')
}

/**
 * A buyer's recent orders with one more folded in: the same order replaced
 * by its newer state, newest first, at most `keep`.
 */
export function mergeRecentOrders(recent: readonly HelpDeskOrder[], order: HelpDeskOrder, keep: number): HelpDeskOrder[] {
  return [order, ...recent.filter((entry) => entry.id !== order.id)]
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, keep)
}
