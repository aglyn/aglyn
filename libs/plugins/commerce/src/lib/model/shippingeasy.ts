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

import type { HostOrder, OrderStatus } from './commerce-orders'
import { orderIsTestMode } from './commerce-orders'
import { shippingLines, shippingOrderNumber, gramsToOunces } from './order-shipping-export'
import {
  shipStationCanImport,
  weightsOfProducts,
  type ShipNotice,
  type ShipNoticeItem,
  type ShipStationOrderSource,
  type ShipStationProductFacts,
  type ShipStationProducts,
} from './shipstation'

/*
 * SHIPPINGEASY'S ORDER API, AS PURE DATA (AGL-3633).
 *
 * ShippingEasy is the opposite direction of ShipStation's Custom Store: it
 * does not pull. The store PUSHES each order into the merchant's own
 * ShippingEasy account with the merchant's API key and secret, and
 * ShippingEasy POSTs a shipment notification to the store's callback URL when
 * a label is bought (ShippingEasy API reference v1.1 and the official Ruby
 * client, read 2026-10-07):
 *
 * - `POST /api/stores/{store_api_key}/orders` with `{ order: { … } }` creates
 *   an order; `POST /api/stores/{store_api_key}/orders/{external_order_identifier}/cancellations`
 *   cancels one; `GET /api/stores/{store_api_key}/orders/{external_order_identifier}` finds one.
 * - Every request carries `api_key`, `api_timestamp` (Unix seconds) and
 *   `api_signature` in its query string: the hex HMAC-SHA256, under the API
 *   secret, of `METHOD&path&query&body` — the query being every other
 *   parameter sorted by name and form-encoded, the body left off when empty.
 * - The shipment callback is signed the same way, over the callback's own
 *   path, query and raw body.
 *
 * This module builds the order, the canonical query and the callback reading.
 * The HMAC, the HTTP and the route live in `server/shippingeasy.ts`.
 */

/** Where ShippingEasy's API answers. A deployment may point elsewhere with `SHIPPINGEASY_API_BASE_URL`. */
export const SHIPPINGEASY_DEFAULT_BASE_URL = 'https://app.shippingeasy.com'

/** How far a signed callback's `api_timestamp` may be from now: the Ruby client's own hour. */
export const SHIPPINGEASY_TIMESTAMP_TOLERANCE_MS = 60 * 60 * 1000

/** The status an order arrives in ShippingEasy with. */
export const SHIPPINGEASY_AWAITING_SHIPMENT = 'awaiting_shipment'

/**
 * A value form-encoded as Ruby's `URI.encode_www_form_component` writes it,
 * which is what ShippingEasy's signature was computed over: letters, digits
 * and `*-._` as they are, a space as `+`, every other byte as `%XX` upper-case.
 */
export function shippingEasyFormComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+')
}

/** The parameters sorted by name and joined `a=1&b=2`, as the signature reads them. `api_signature` is never part of it. */
export function shippingEasyCanonicalQuery(params: Readonly<Record<string, string>>): string {
  return Object.keys(params)
    .filter((name) => name !== 'api_signature')
    .sort()
    .map((name) => `${shippingEasyFormComponent(name)}=${shippingEasyFormComponent(params[name])}`)
    .join('&')
}

/** The plaintext a request's signature is the HMAC of: `METHOD&path&query&body`, the body left off when empty. */
export function shippingEasySignaturePlaintext(input: {
  method: string
  path: string
  params: Readonly<Record<string, string>>
  body?: string | null
}): string {
  const parts = [input.method.toUpperCase(), input.path, shippingEasyCanonicalQuery(input.params)]
  if (input.body) parts.push(input.body)
  return parts.join('&')
}

/*==========================================
 * WHAT TO DO WITH AN ORDER
 *=========================================*/

/** What a changed order asks of ShippingEasy. */
export type ShippingEasyIntent = 'create' | 'cancel' | null

/**
 * Whether an order goes to ShippingEasy, comes back out of it, or neither.
 *
 * - A paid or partly shipped order with something to ship and a full
 *   ship-to address is CREATED. A test-mode order never is: ShippingEasy is
 *   the merchant's real label account, and a label bought for a test order
 *   is real postage.
 * - A canceled or fully refunded order is CANCELED there, which the caller
 *   does only when it once sent the order.
 * - Anything else (pending, shipped, delivered) asks nothing.
 */
export function shippingEasyIntent(
  order: Partial<HostOrder> & { livemode?: unknown; requiresShipping?: unknown },
  docId: string,
): ShippingEasyIntent {
  if (order.requiresShipping === false) return null
  const status = (order.status ?? 'pending') as OrderStatus
  if (status === 'cancelled' || status === 'refunded') return 'cancel'
  if (status !== 'paid' && status !== 'partially_fulfilled') return null
  if (orderIsTestMode({ ...order, $id: docId })) return null
  if (!shipStationCanImport(order)) return null
  return shippingLines({ lineItems: order.lineItems ?? [], fulfillments: order.fulfillments ?? [] }).length ? 'create' : null
}

/*==========================================
 * THE ORDER
 *=========================================*/

/** Cents as ShippingEasy's decimal dollars, `"12.50"`. */
function money(cents: unknown): string {
  const value = Math.round(Number(cents ?? 0))
  return (Number.isFinite(value) ? value / 100 : 0).toFixed(2)
}

/** Text trimmed and bounded, or `undefined` when there is none. */
function bounded(value: unknown, max: number): string | undefined {
  const text = value === null || value === undefined ? '' : String(value).trim()
  return text ? text.slice(0, max) : undefined
}

/** A full name as ShippingEasy's first and last name: the last word is the last name. */
export function splitPersonName(name: unknown): { first_name?: string; last_name?: string } {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return {}
  if (words.length === 1) return { first_name: words[0].slice(0, 100) }
  return { first_name: words.slice(0, -1).join(' ').slice(0, 100), last_name: words[words.length - 1].slice(0, 100) }
}

/** The order identifier ShippingEasy keeps: the order number the merchant sees, else the document id. */
export function shippingEasyExternalId(order: Pick<HostOrder, 'number'>, docId: string): string {
  return shippingOrderNumber(order, docId)
}

function facts(products: ShipStationProducts, productId: string, variantId?: string): ShipStationProductFacts {
  const variants = products[productId] ?? {}
  return { ...(variants[''] ?? {}), ...((variantId && variants[variantId]) || {}) }
}

/** Drops the keys whose value is `undefined`, so the JSON names only what is known. */
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

/**
 * The `{ order }` body that creates an order in ShippingEasy. The items are
 * what is LEFT to ship, so a partly shipped order sent after its first parcel
 * asks for the rest; each carries its line's index as `ext_line_item_id`,
 * which the shipment callback hands back to name the line.
 */
export function shippingEasyOrderPayload(
  source: ShipStationOrderSource,
  products: ShipStationProducts = {},
): { order: Record<string, unknown> } {
  const { docId, order } = source
  const created = Number(order.createdAtMs ?? 0) || Date.now()
  const ship = order.shippingAddress ?? {}
  const bill = order.billingAddress ?? {}
  const totals = order.totals
  const email = bounded(order.customerEmail, 100)
  const weights = weightsOfProducts(products)
  const lineItems = shippingLines({ lineItems: order.lineItems ?? [], fulfillments: order.fulfillments ?? [] }, weights).map(
    ({ lineItemId, line, quantity, unitGrams }) => {
      const known = facts(products, line.productId, line.variantId)
      const options = Object.entries(known.options ?? {})
        .filter(([name, value]) => String(name).trim() && String(value).trim())
        .slice(0, 10)
      return compact({
        item_name: bounded(`${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ''}`, 200) ?? 'Item',
        sku: bounded(line.sku || (line.variantId ? `${line.productId}-${line.variantId}` : line.productId), 100),
        ext_line_item_id: String(lineItemId),
        ext_product_id: bounded(line.productId, 100),
        unit_price: money(line.unitAmountCents),
        total_excluding_tax: money(Math.round(Number(line.unitAmountCents ?? 0)) * quantity),
        weight_in_ounces: unitGrams !== null ? gramsToOunces(unitGrams).toFixed(2) : undefined,
        quantity: String(quantity),
        product_options: options.length ? Object.fromEntries(options) : undefined,
      })
    },
  )
  const recipient = compact({
    ...splitPersonName(ship.name || order.customerName),
    email,
    phone_number: bounded(ship.phone || order.customerPhone, 50),
    address: bounded(ship.line1, 200),
    address2: bounded(ship.line2, 200),
    city: bounded(ship.city, 100),
    state: bounded(ship.state, 100),
    postal_code: bounded(ship.postalCode, 50),
    country: bounded(String(ship.country ?? '').toUpperCase(), 2),
    base_cost: money(totals?.shippingCents),
    cost_excluding_tax: money(totals?.shippingCents),
    items_total: String(lineItems.reduce((sum, item) => sum + Number(item['quantity']), 0)),
    items_shipped: '0',
    line_items: lineItems,
  })
  const billName = splitPersonName(bill.name || order.customerName)
  return {
    order: compact({
      external_order_identifier: shippingEasyExternalId(order, docId),
      ordered_at: new Date(created).toISOString(),
      order_status: SHIPPINGEASY_AWAITING_SHIPMENT,
      total_including_tax: money(totals?.totalCents ?? order.amountCents),
      total_tax: money(totals?.taxCents),
      subtotal_including_tax: money(totals?.itemsCents),
      discount_amount: money(totals?.discountCents),
      base_shipping_cost: money(totals?.shippingCents),
      shipping_cost_excluding_tax: money(totals?.shippingCents),
      notes: bounded(order.note, 1000),
      billing_first_name: billName.first_name,
      billing_last_name: billName.last_name,
      billing_address: bounded(bill.line1, 200),
      billing_address2: bounded(bill.line2, 200),
      billing_city: bounded(bill.city, 100),
      billing_state: bounded(bill.state, 100),
      billing_postal_code: bounded(bill.postalCode, 50),
      billing_country: bounded(String(bill.country ?? '').toUpperCase(), 2),
      billing_phone_number: bounded(bill.phone || order.customerPhone, 50),
      billing_email: email,
      recipients: [recipient],
    }),
  }
}

/*==========================================
 * THE SHIPMENT CALLBACK
 *=========================================*/

/**
 * The label states that mean a parcel is on its way. `label_pending` is not
 * bought yet and `cancelled` was voided, so neither ships anything.
 */
export const SHIPPINGEASY_SHIPPED_STATES: ReadonlySet<string> = new Set(['label_ready', 'label_printed', 'drop_shipped'])

/** What one callback says. */
export interface ShippingEasyCallback {
  /** ShippingEasy's own shipment id, for the log. */
  shipmentId: string | null
  workflowState: string
  /** One notice per order the shipment carries, in the shape every connector records. */
  notices: ShipNotice[]
}

type Json = Record<string, unknown>
const asObject = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {})
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const asText = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim())

/**
 * A shipment callback's JSON read into notices, or the reason it cannot be.
 * Each order of the shipment is one notice under the shipment's tracking
 * number; its items are the recipients' line items, named back by the
 * `ext_line_item_id` the order was sent with, else by SKU.
 */
export function readShippingEasyCallback(body: string): ShippingEasyCallback | { problem: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { problem: 'The callback is not JSON.' }
  }
  const shipment = asObject(asObject(parsed)['shipment'])
  if (!Object.keys(shipment).length) return { problem: 'The callback names no shipment.' }
  const carrier = asText(shipment['carrier_key'])
  const service = asText(shipment['carrier_service_key'])
  const trackingNumber = asText(shipment['tracking_number']).slice(0, 100)
  const notices: ShipNotice[] = []
  for (const entry of asArray(shipment['orders'])) {
    const order = asObject(entry)
    const external = asText(order['external_order_identifier']).slice(0, 200)
    if (!external) continue
    const items: ShipNoticeItem[] = []
    for (const recipient of asArray(order['recipients'])) {
      for (const raw of asArray(asObject(recipient)['line_items'])) {
        const line = asObject(raw)
        const quantity = Math.floor(Number(line['quantity']))
        if (!Number.isFinite(quantity) || quantity <= 0) continue
        items.push({
          lineItemId: asText(line['ext_line_item_id']) || null,
          sku: asText(line['sku']) || null,
          name: asText(line['item_name']) || null,
          quantity,
        })
      }
    }
    notices.push({ orderNumber: external, orderId: null, carrier, service, trackingNumber, items })
  }
  return {
    shipmentId: asText(shipment['id']) || null,
    workflowState: asText(shipment['workflow_state']).toLowerCase(),
    notices,
  }
}
