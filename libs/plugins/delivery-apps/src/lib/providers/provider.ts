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
import { timingSafeEqual } from 'node:crypto'
import type { DeliveryServiceId } from '../model/delivery-apps'

/**
 * What every delivery service's adapter answers (AGL-3644), in the plugin's
 * own words, so the engine never reads a service's payload.
 *
 * An adapter verifies a webhook by the service's own signature, turns its
 * body into {@link DeliveryEvent}s, and sends the store's answers back:
 * accept, reject, ready, and the menu. Money is integer minor units in the
 * order's currency throughout, as each service sends it.
 *
 * The payload shapes are the ones each service documents for its
 * point-of-sale integrations; `testing/fixtures` holds a recorded example of
 * each event an adapter reads.
 */

export interface IncomingOrderLine {
  /** The service's id for the line on this order. */
  externalLineId: string
  /** The id the menu gave the item (ours, `aglyn:…`, when this plugin sent the menu); `null` when none. */
  externalItemId: string | null
  name: string
  quantity: number
  /** Per unit, the chosen options' prices included. */
  unitPriceCents: number
  /** The chosen options, as the service names them, e.g. `Extra cheese`. */
  options: string[]
  instructions: string | null
}

export interface IncomingOrder {
  externalOrderId: string
  /** The short code the courier and the service show. */
  externalRef: string
  /** Every id the service gives the store on the order; a connection matches any one. */
  storeIds: string[]
  placedAtMs: number
  pickupAtMs: number | null
  /** ISO 4217, upper case. */
  currency: string
  lines: IncomingOrderLine[]
  subtotalCents: number
  /** Tax the service collected on the food; the service remits it. */
  taxCents: number
  /** Discounts the merchant funded. */
  discountCents: number
  /** What the store is owed for the order before the service's fees: subtotal less discounts, plus tax. */
  totalCents: number
  /** First name and last initial only: the register needs no more to call the courier's order. */
  customerName: string | null
  instructions: string | null
  /** `courier`: the service's courier collects it; `customer`: the buyer does. */
  handoff: 'courier' | 'customer'
}

export type DeliveryEvent =
  | { kind: 'created'; order: IncomingOrder }
  /** The service changed the order (an item removed, a quantity lowered): the order as it stands now. */
  | { kind: 'updated'; eventId: string; order: IncomingOrder }
  | { kind: 'cancelled'; externalOrderId: string; storeIds: string[]; reason: string }
  /** The service refunded its buyer, and takes it from the merchant's payout. */
  | { kind: 'refunded'; externalOrderId: string; storeIds: string[]; refundId: string; amountCents: number; reason: string }
  /** Read and understood, with nothing for the store to do. */
  | { kind: 'ignored'; reason: string }

/** A webhook as it arrived: the raw body, for the signature, and the request around it. */
export interface WebhookRequest {
  rawBody: string
  headers: Headers
  url: string
  method: string
}

/** The order an answer is about. */
export interface OrderRef {
  externalOrderId: string
  externalStoreId: string
  /** The store order it became, when it has one: some services keep it as the order's POS reference. */
  recordId: string | null
}

export interface MenuItem {
  /** `aglyn:{productId}:{variantId}`, so an order names the configuration it sold. */
  externalItemId: string
  name: string
  description: string
  priceCents: number
  imageUrl: string | null
  available: boolean
}

export interface Menu {
  name: string
  currency: string
  categories: Array<{ id: string; name: string; items: MenuItem[] }>
}

export interface DeliveryProvider {
  id: DeliveryServiceId
  /** Whether the request carries the service's valid signature. Never throws. */
  verify(request: WebhookRequest, nowMs: number): boolean
  /** The events a verified body carries. May read the order from the service when the webhook only names it. */
  parse(request: WebhookRequest): Promise<DeliveryEvent[]>
  accept(order: OrderRef, prepMinutes: number, nowMs: number): Promise<void>
  reject(order: OrderRef, reason: string): Promise<void>
  /** Absent for a service that takes no "ready" signal from the store. */
  ready?(order: OrderRef): Promise<void>
  /** Replaces the store's menu on the service. */
  publishMenu(externalStoreId: string, menu: Menu): Promise<void>
}

/** A menu item's id for one configuration. */
export const menuItemId = (productId: string, variantId: string) => `aglyn:${productId}:${variantId}`

const ITEM_ID = /^aglyn:([A-Za-z0-9_-]{1,200}):([A-Za-z0-9_-]{1,200})$/

/** The configuration a menu item id of ours names; `null` for any other id. */
export function readMenuItemId(value: string | null | undefined): { productId: string; variantId: string } | null {
  const match = ITEM_ID.exec(String(value ?? ''))
  if (!match || /^__.*__$/.test(match[1])) return null
  return { productId: match[1], variantId: match[2] }
}

/** Equal strings, compared in constant time. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right)
}

/** A whole, non-negative number of minor units; `null` for anything else. */
export function cents(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) && number >= 0 && number <= 100_000_000_00 ? number : null
}

/** Epoch ms of an ISO time or epoch seconds; `null` when unreadable. */
export function timeMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

export const text = (value: unknown, max = 200): string => String(value ?? '').trim().slice(0, max)

/** `Pat Q.` from a first and a last name, or from one full name. */
export function shortName(first: unknown, last?: unknown): string | null {
  let given = text(first, 60)
  let family = text(last, 60)
  if (!family && given.includes(' ')) {
    const parts = given.split(/\s+/)
    given = parts[0]
    family = parts.slice(1).join(' ')
  }
  if (!given) return null
  return family ? `${given} ${family[0].toUpperCase()}.` : given
}

/** The JSON a body carries; `null` when it is not an object. */
export function readJson(rawBody: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(rawBody)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Why an order is not well formed, or `null`: a line with no quantity or price is not an order anyone can make. */
export function incomingOrderProblem(order: IncomingOrder): string | null {
  if (!order.externalOrderId) return 'no order id'
  if (!order.storeIds.length) return 'no store'
  if (!/^[A-Z]{3}$/.test(order.currency)) return 'no currency'
  if (!order.lines.length) return 'no items'
  for (const line of order.lines) {
    if (!(line.quantity >= 1) || !Number.isInteger(line.quantity)) return 'an item has no quantity'
    if (cents(line.unitPriceCents) === null) return 'an item has no price'
  }
  for (const amount of [order.subtotalCents, order.taxCents, order.discountCents, order.totalCents]) {
    if (cents(amount) === null) return 'the totals are not whole amounts'
  }
  return null
}
