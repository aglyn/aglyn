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

import type { HostOrder, OrderAddress, OrderFulfillment, OrderLineItem } from './commerce-orders'
import { fulfillmentIsActive, lineRequiresShipping, remainingFulfillmentLines } from './order-fulfillment'

/*
 * AN ORDER AS A SHIPPING TOOL READS IT (AGL-3613).
 *
 * ShipStation's Custom Store feed, Pirate Ship's spreadsheet upload and the
 * Shippo and EasyPost CSVs all want the same facts about an order: who it
 * goes to, what is still to be packed, and what that weighs. This module is
 * that one reading, pure, so the XML feed and the CSV export cannot disagree
 * about an order's weight or which units are still owed.
 *
 * WHAT IS STILL TO SHIP, NOT WHAT WAS BOUGHT. A partially fulfilled order
 * exports its remaining units (`remainingFulfillmentLines`), so a label tool
 * that imports it again after the first parcel left asks for the rest and
 * not the whole order a second time. Digital and service lines never ship.
 *
 * WHICH ORDERS SHIP AT ALL is stamped on the order as `requiresShipping`
 * when it is written (`withOrderListFields`), so the export and the
 * ShipStation feed ask it of their Firestore query instead of reading every
 * order and dropping the downloads afterwards.
 */

/** Grams in one avoirdupois ounce. */
export const GRAMS_PER_OUNCE = 28.349523125

/** Ounces in one pound. */
export const OUNCES_PER_POUND = 16

/** A weight in grams as ounces, to two places. */
export function gramsToOunces(grams: number): number {
  return Math.round((grams / GRAMS_PER_OUNCE) * 100) / 100
}

/** A weight in ounces as pounds, to two places. */
export function ouncesToPounds(ounces: number): number {
  return Math.round((ounces / OUNCES_PER_POUND) * 100) / 100
}

/**
 * Whether an order has anything to put in a box.
 *
 * A line with no recorded type predates types and counts as physical, the
 * reading that never hides an order a merchant has to ship. A register sale
 * left the shop in the buyer's hands, so a POS order ships only when it was
 * given a shipping address. A legacy Commerce Starter order with no lines
 * ships when it carries an address.
 */
export function orderRequiresShipping(order: Partial<HostOrder>): boolean {
  const lines = Array.isArray(order.lineItems) ? order.lineItems : []
  const address = hasShippingAddress(order.shippingAddress)
  if (!lines.length) return address
  if (!lines.some((line) => line && lineRequiresShipping(line))) return false
  return order.channel === 'pos' ? address : true
}

function hasShippingAddress(address: OrderAddress | undefined | null): boolean {
  return Boolean(address && String(address.line1 ?? '').trim())
}

/**
 * The fields a CREATOR of an order stamps beside its list fields: whether it
 * ships, and when it last changed — its creation, for a new order. Writers
 * that change an order afterwards stamp `updatedAtMs` themselves; nothing
 * else here moves after creation, because an order's lines never do.
 */
export function orderSyncFields(order: object): { requiresShipping: boolean; updatedAtMs?: number } {
  const source = order as Partial<HostOrder> & { updatedAtMs?: unknown; createdAtMs?: unknown }
  const at = Number(source.updatedAtMs ?? source.createdAtMs)
  return {
    requiresShipping: orderRequiresShipping(source),
    ...(Number.isFinite(at) && at > 0 ? { updatedAtMs: at } : {}),
  }
}

/** The number a shipping tool shows and sends back: `1042`, or the document id for an unnumbered order. */
export function shippingOrderNumber(order: Pick<HostOrder, 'number'>, docId: string): string {
  return typeof order.number === 'number' && Number.isFinite(order.number) ? String(order.number) : docId
}

/**
 * Every spelling of an order a file or a ShipNotice may name it by: `1042`,
 * `#1042` and the document id. What `parseShippingOrderRef` reads back.
 */
export function shippingOrderRefs(order: Pick<HostOrder, 'number'>, docId: string): string[] {
  const refs = [docId]
  if (typeof order.number === 'number' && Number.isFinite(order.number)) {
    refs.unshift(String(order.number), `#${order.number}`)
  }
  return refs
}

/** What a reference a tool sent back names: an order number, or a document id. */
export function parseShippingOrderRef(value: unknown): { number?: number; id?: string } | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const numbered = /^#?\s*(\d{1,12})$/.exec(text)
  if (numbered) return { number: Number(numbered[1]), id: text.replace(/^#\s*/, '') }
  // Document ids are what Firestore accepts: no slash, not reserved.
  if (/[/]/.test(text) || /^__.*__$/.test(text) || text.length > 200) return null
  return { id: text }
}

/** A product's weights, keyed by variant id (`''` for a product with no variant named). */
export type ProductWeights = Readonly<Record<string, Readonly<Record<string, number>>>>

/** One unit of a line's weight in grams, or `null` when the product records none. */
export function lineUnitGrams(line: Pick<OrderLineItem, 'productId' | 'variantId'>, weights: ProductWeights): number | null {
  const byVariant = weights[line.productId]
  if (!byVariant) return null
  const grams = line.variantId ? byVariant[line.variantId] : undefined
  const value = grams ?? byVariant['']
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** One line still to ship: which line, how many units, and what one weighs. */
export interface ShippingLine {
  lineItemId: number
  line: OrderLineItem
  quantity: number
  unitGrams: number | null
}

/** The lines still to ship, with their remaining units. */
export function shippingLines(order: Pick<HostOrder, 'lineItems' | 'fulfillments'>, weights: ProductWeights = {}): ShippingLine[] {
  const lines = order.lineItems ?? []
  return remainingFulfillmentLines(order)
    .map((entry) => ({ entry, line: lines[entry.lineItemId] }))
    .filter((pair): pair is { entry: { lineItemId: number; quantity: number }; line: OrderLineItem } => Boolean(pair.line))
    .map(({ entry, line }) => ({
      lineItemId: entry.lineItemId,
      line,
      quantity: entry.quantity,
      unitGrams: lineUnitGrams(line, weights),
    }))
}

/**
 * The parcel's weight in ounces: every remaining unit's recorded weight.
 * `null` when no line records one, so a tool falls back to the default
 * package the merchant set there rather than a weight of zero.
 */
export function shippingWeightOunces(lines: readonly ShippingLine[]): number | null {
  let grams = 0
  let known = false
  for (const entry of lines) {
    if (entry.unitGrams === null) continue
    known = true
    grams += entry.unitGrams * entry.quantity
  }
  return known ? gramsToOunces(grams) : null
}

/** A line as a packing list names it: `2 × Mug (Blue), SKU MUG-B`. */
export function describeShippingLine(entry: Pick<ShippingLine, 'line' | 'quantity'>): string {
  const { line } = entry
  return `${entry.quantity} × ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ''}${line.sku ? `, SKU ${line.sku}` : ''}`
}

const text = (value: unknown): string | null => {
  const trimmed = value === null || value === undefined ? '' : String(value).trim()
  return trimmed || null
}

/**
 * The shipping columns of one order, as the orders export writes them
 * (`ORDER_SHIPPING_FIELDS`). Every value is what the order holds; nothing is
 * invented — an order with no phone exports no phone.
 */
export function orderShippingRecord(
  docId: string,
  order: Partial<HostOrder>,
  weights: ProductWeights = {},
): Record<string, unknown> {
  const address = order.shippingAddress ?? {}
  const lines = shippingLines({ lineItems: order.lineItems ?? [], fulfillments: order.fulfillments ?? [] }, weights)
  const ounces = shippingWeightOunces(lines)
  return {
    orderRef: shippingOrderNumber(order, docId),
    shipName: text(address.name) ?? text(order.customerName),
    shipLine1: text(address.line1),
    shipLine2: text(address.line2),
    shipCity: text(address.city),
    shipState: text(address.state),
    shipPostalCode: text(address.postalCode),
    shipCountry: text(address.country),
    shipPhone: text(address.phone) ?? text(order.customerPhone),
    shipEmail: text(order.customerEmail),
    itemsToShip: lines.length ? lines.map(describeShippingLine).join('; ') : null,
    unitsToShip: lines.reduce((sum, entry) => sum + entry.quantity, 0),
    weightOz: ounces,
    weightLb: ounces === null ? null : ouncesToPounds(ounces),
    weightUnit: ounces === null ? null : 'oz',
  }
}

/**
 * A tracking number as a parcel's identity: spaces and dashes dropped,
 * upper-cased. `9400 1000 0000` and `94001000000` are one parcel.
 */
export function normalizeTrackingNumber(value: unknown): string {
  return String(value ?? '')
    .replace(/[\s-]+/g, '')
    .toUpperCase()
}

/** The active fulfillment already carrying this tracking number, if any. */
export function fulfillmentWithTracking(
  order: Pick<HostOrder, 'fulfillments'>,
  trackingNumber: unknown,
): OrderFulfillment | undefined {
  const wanted = normalizeTrackingNumber(trackingNumber)
  if (!wanted) return undefined
  return (order.fulfillments ?? []).find(
    (entry) => fulfillmentIsActive(entry) && normalizeTrackingNumber(entry.trackingNumber) === wanted,
  )
}
