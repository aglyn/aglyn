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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type { HostOrder, OrderLineItem, OrderStatus } from './commerce-orders'
import { lineRequiresShipping } from './order-fulfillment'
import {
  gramsToOunces,
  shippingLines,
  shippingOrderNumber,
  type ProductWeights,
} from './order-shipping-export'

/*
 * SHIPSTATION'S CUSTOM STORE, AS PURE DATA (AGL-3613).
 *
 * ShipStation pulls a store's orders from one URL the merchant pastes into
 * its Custom Store connection, and posts each shipment back to the same URL
 * (Custom Store Development Guide, help.shipstation.com, read 2026-10-06):
 *
 * - `GET ?action=export&start_date=&end_date=&page=` answers an `<Orders
 *   pages="n">` document of every order MODIFIED in the window, whatever its
 *   status. Dates are UTC, `MM/dd/yyyy HH:mm`. Free text sits in CDATA.
 * - `POST ?action=shipnotify&order_number=&carrier=&service=&tracking_number=`
 *   carries a `<ShipNotice>` body naming the shipped items; any 2xx is
 *   success.
 *
 * This module writes the feed and reads the notice. The route that serves
 * them, its credentials and its query live in `server/shipstation.ts`.
 *
 * ## The status names a merchant types into ShipStation
 *
 * ShipStation maps a store's own status names onto its five, and the mapping
 * is case-sensitive. These are the names this feed writes; the connection
 * card and the guide print them for the merchant to copy.
 */

export const SHIPSTATION_STATUS_NAMES = {
  unpaid: 'unpaid',
  paid: 'paid',
  shipped: 'shipped',
  canceled: 'canceled',
  onHold: 'on_hold',
} as const

/** An Aglyn order status as the feed names it to ShipStation. */
export function shipStationOrderStatus(status: OrderStatus): string {
  switch (status) {
    case 'pending':
      return SHIPSTATION_STATUS_NAMES.unpaid
    case 'paid':
    case 'partially_fulfilled':
      return SHIPSTATION_STATUS_NAMES.paid
    case 'fulfilled':
    case 'delivered':
      return SHIPSTATION_STATUS_NAMES.shipped
    case 'cancelled':
    case 'refunded':
      return SHIPSTATION_STATUS_NAMES.canceled
  }
}

/** Orders per page of the feed. ShipStation follows `pages` until it has them all. */
export const SHIPSTATION_PAGE_SIZE = 100

/** The widest window one request may ask for: a year, which no import needs. */
export const SHIPSTATION_MAX_WINDOW_MS = 366 * 24 * 60 * 60 * 1000

const pad = (value: number): string => String(value).padStart(2, '0')

/** Epoch milliseconds as ShipStation's `MM/dd/yyyy HH:mm`, in UTC. */
export function formatShipStationDate(ms: number): string {
  const date = new Date(ms)
  return (
    `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  )
}

/**
 * ShipStation's `MM/dd/yyyy HH:mm` (UTC; seconds and AM/PM tolerated) as
 * epoch milliseconds, or `null` when the text is not a date. An ISO date is
 * read too, for a merchant testing the URL by hand.
 */
export function parseShipStationDate(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(text)
  if (match) {
    const [, month, day, year, hourText, minute, second, meridiem] = match
    let hour = Number(hourText ?? 0)
    if (meridiem) {
      const pm = meridiem.toLowerCase() === 'pm'
      if (hour === 12) hour = pm ? 12 : 0
      else if (pm) hour += 12
    }
    const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute ?? 0), Number(second ?? 0))
    const check = new Date(ms)
    if (check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day) || hour > 23) return null
    return ms
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const ms = Date.parse(text)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

/*==========================================
 * THE ORDERS FEED
 *=========================================*/

/** What the feed knows about one variant of a product, read once per page. */
export interface ShipStationProductFacts {
  grams?: number
  imageUrl?: string
  /** The variant's option choices: `{ Size: 'L', Color: 'Blue' }`. */
  options?: Readonly<Record<string, string>>
}

/** Product id → variant id (`''` for the product itself) → its facts. */
export type ShipStationProducts = Readonly<Record<string, Readonly<Record<string, ShipStationProductFacts>>>>

/** The weights the shared shipping reading takes, from the products' facts. */
export function weightsOfProducts(products: ShipStationProducts): ProductWeights {
  const weights: Record<string, Record<string, number>> = {}
  for (const [productId, variants] of Object.entries(products)) {
    for (const [variantId, facts] of Object.entries(variants)) {
      if (typeof facts.grams === 'number' && facts.grams > 0) {
        ;(weights[productId] ??= {})[variantId] = facts.grams
      }
    }
  }
  return weights
}

function factsFor(line: Pick<OrderLineItem, 'productId' | 'variantId'>, products: ShipStationProducts): ShipStationProductFacts {
  const variants = products[line.productId] ?? {}
  const own = line.variantId ? variants[line.variantId] : undefined
  const base = variants[''] ?? {}
  return { ...base, ...(own ?? {}) }
}

/** Characters XML 1.0 cannot carry at all, dropped before anything is written. */
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

/** Text bounded to `max` characters with every character XML refuses dropped. */
function bounded(value: unknown, max: number): string {
  const text = value === null || value === undefined ? '' : String(value)
  return text.replace(XML_INVALID, '').trim().slice(0, max)
}

/**
 * Free text as a CDATA section, as the guide asks. A `]]>` inside the text
 * would end the section early, so it is split across two sections — the
 * standard escape, which reads back as the same characters.
 */
export function xmlCdata(value: unknown, max: number): string {
  const text = bounded(value, max)
  return text ? `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>` : ''
}

/** A plain value (a number, a date, a code) with the five XML entities escaped. */
export function xmlText(value: unknown, max = 100): string {
  return bounded(value, max)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Cents as the feed's decimal dollars, `12.50`. */
function money(cents: unknown): string {
  const value = Math.round(Number(cents ?? 0))
  return (Number.isFinite(value) ? value / 100 : 0).toFixed(2)
}

const element = (name: string, inner: string): string => `<${name}>${inner}</${name}>`

/** One order as the feed needs it: the stored order and its document id. */
export interface ShipStationOrderSource {
  docId: string
  order: Partial<HostOrder> & { createdAtMs?: number; updatedAtMs?: number }
}

/**
 * Whether ShipStation can take this order at all: it insists on a ship-to
 * name, street, city, postal code and two-letter country. An order without
 * them could never become a label, and one invalid `<Order>` fails the whole
 * import, so it is left out of the feed rather than sent with a guess.
 */
export function shipStationCanImport(order: Partial<HostOrder>): boolean {
  const address = order.shippingAddress
  if (!address) return false
  const country = String(address.country ?? '').trim()
  return Boolean(
    String(address.line1 ?? '').trim() &&
      String(address.city ?? '').trim() &&
      String(address.postalCode ?? '').trim() &&
      /^[A-Za-z]{2}$/.test(country) &&
      String(address.name ?? order.customerName ?? '').trim(),
  )
}

/**
 * The items an order sends ShipStation. An order still to be shipped sends
 * what is LEFT — a partially fulfilled order asks for the rest, never the
 * whole order twice. A shipped or canceled order sends its shippable lines
 * whole, which ShipStation only reads to show the order it is moving.
 */
function feedItems(source: ShipStationOrderSource, products: ShipStationProducts): string[] {
  const { order } = source
  const status = (order.status ?? 'paid') as OrderStatus
  const lineItems = order.lineItems ?? []
  const open = status === 'paid' || status === 'partially_fulfilled' || status === 'pending'
  const entries = open
    ? shippingLines({ lineItems, fulfillments: order.fulfillments ?? [] }, weightsOfProducts(products)).map((entry) => ({
        lineItemId: entry.lineItemId,
        line: entry.line,
        quantity: entry.quantity,
      }))
    : lineItems
        .map((line, lineItemId) => ({ lineItemId, line, quantity: Math.max(0, Math.floor(Number(line?.quantity ?? 0))) }))
        .filter((entry) => entry.line && lineRequiresShipping(entry.line) && entry.quantity > 0)
  const items = entries.map(({ lineItemId, line, quantity }) => {
    const facts = factsFor(line, products)
    const ounces = typeof facts.grams === 'number' && facts.grams > 0 ? gramsToOunces(facts.grams) : null
    const options = Object.entries(facts.options ?? {})
      .filter(([name, value]) => String(name).trim() && String(value).trim())
      .slice(0, 10)
    return element(
      'Item',
      [
        element('LineItemID', xmlText(String(lineItemId), 50)),
        element('SKU', xmlCdata(line.sku || (line.variantId ? `${line.productId}-${line.variantId}` : line.productId), 100)),
        element('Name', xmlCdata(`${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ''}`, 200)),
        facts.imageUrl && /^https:\/\//.test(facts.imageUrl) ? element('ImageUrl', xmlCdata(facts.imageUrl, 500)) : '',
        ounces !== null ? element('Weight', ounces.toFixed(2)) + element('WeightUnits', 'Ounces') : '',
        element('Quantity', String(quantity)),
        element('UnitPrice', money(line.unitAmountCents)),
        options.length
          ? element(
              'Options',
              options
                .map(([name, value]) => element('Option', element('Name', xmlCdata(name, 100)) + element('Value', xmlCdata(value, 100))))
                .join(''),
            )
          : '',
      ].join(''),
    )
  })
  // The order's discount, as the guide's adjustment line: negative and
  // flagged, so ShipStation's totals agree with what the buyer paid.
  const discountCents = Math.round(Number(order.totals?.discountCents ?? 0))
  if (discountCents > 0) {
    items.push(
      element(
        'Item',
        element('SKU', '') +
          element('Name', xmlCdata(order.couponCode ? `Discount (${order.couponCode})` : 'Discount', 200)) +
          element('Quantity', '1') +
          element('UnitPrice', `-${money(discountCents)}`) +
          element('Adjustment', 'true'),
      ),
    )
  }
  return items
}

/** One `<Order>` element of the feed. */
export function shipStationOrderXml(source: ShipStationOrderSource, products: ShipStationProducts = {}): string {
  const { docId, order } = source
  const status = (order.status ?? 'paid') as OrderStatus
  const created = Number(order.createdAtMs ?? 0) || Date.now()
  const modified = Number(order.updatedAtMs ?? created) || created
  const ship = order.shippingAddress ?? {}
  const bill = order.billingAddress ?? {}
  const email = bounded(order.customerEmail, 100)
  const recipient = ship.name || order.customerName || ''
  const totals = order.totals
  return element(
    'Order',
    [
      element('OrderID', xmlCdata(docId, 50)),
      element('OrderNumber', xmlCdata(shippingOrderNumber(order, docId), 50)),
      element('OrderDate', formatShipStationDate(created)),
      element('OrderStatus', xmlCdata(shipStationOrderStatus(status), 50)),
      element('LastModified', formatShipStationDate(modified)),
      element('CurrencyCode', 'USD'),
      element('OrderTotal', money(totals?.totalCents ?? order.amountCents)),
      element('TaxAmount', money(totals?.taxCents)),
      element('ShippingAmount', money(totals?.shippingCents)),
      order.note ? element('InternalNotes', xmlCdata(order.note, 1000)) : '',
      element('Source', xmlCdata(order.channel === 'pos' ? `${PLATFORM_BRAND_NAME} POS` : PLATFORM_BRAND_NAME, 50)),
      element(
        'Customer',
        [
          element('CustomerCode', xmlCdata(email || docId, 100)),
          element(
            'BillTo',
            [
              element('Name', xmlCdata(bill.name || order.customerName || recipient, 100)),
              bill.phone || order.customerPhone ? element('Phone', xmlCdata(bill.phone || order.customerPhone, 50)) : '',
              email ? element('Email', xmlCdata(email, 100)) : '',
            ].join(''),
          ),
          element(
            'ShipTo',
            [
              element('Name', xmlCdata(recipient, 100)),
              element('Address1', xmlCdata(ship.line1, 200)),
              ship.line2 ? element('Address2', xmlCdata(ship.line2, 200)) : '',
              element('City', xmlCdata(ship.city, 100)),
              ship.state ? element('State', xmlCdata(ship.state, 100)) : '',
              element('PostalCode', xmlCdata(ship.postalCode, 50)),
              element('Country', xmlCdata(String(ship.country ?? '').toUpperCase(), 2)),
              ship.phone ? element('Phone', xmlCdata(ship.phone, 50)) : '',
            ].join(''),
          ),
        ].join(''),
      ),
      element('Items', feedItems(source, products).join('')),
    ].join(''),
  )
}

/** The whole `<Orders>` document for one page. */
export function shipStationOrdersXml(orders: readonly string[], pages: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<Orders pages="${Math.max(1, Math.floor(pages))}">${orders.join('')}</Orders>`
}

/*==========================================
 * THE SHIP NOTICE
 *=========================================*/

/** One shipped line of a notice. */
export interface ShipNoticeItem {
  lineItemId: string | null
  sku: string | null
  name: string | null
  quantity: number
}

/** What a ShipNotice says, from its query string and its body together. */
export interface ShipNotice {
  orderNumber: string | null
  orderId: string | null
  carrier: string
  service: string
  trackingNumber: string
  items: ShipNoticeItem[]
}

const XML_ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** XML character data with its five entities and numeric references decoded. Nothing else expands. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|lt|gt|amp|quot|apos);/g, (whole, code: string) => {
    if (code[0] !== '#') return XML_ENTITIES[code] ?? whole
    const point = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
  })
}

/** An element's content as text: CDATA sections taken as written, the rest entity-decoded. */
function contentText(raw: string): string {
  let out = ''
  let at = 0
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/g
  for (let match = cdata.exec(raw); match; match = cdata.exec(raw)) {
    out += decodeEntities(raw.slice(at, match.index).replace(/<[^>]*>/g, ''))
    out += match[1]
    at = match.index + match[0].length
  }
  out += decodeEntities(raw.slice(at).replace(/<[^>]*>/g, ''))
  return out.trim()
}

/** The text of the first `<name>` element in `xml`, or `''`. */
function elementText(xml: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`).exec(xml)
  return match ? contentText(match[1]) : ''
}

/** The inner XML of every `<name>` element in `xml`. */
function elementBodies(xml: string, name: string): string[] {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'g')
  const bodies: string[] = []
  for (let match = pattern.exec(xml); match; match = pattern.exec(xml)) bodies.push(match[1])
  return bodies
}

/**
 * A `<ShipNotice>` body read into a notice, or the reason it cannot be.
 *
 * Read by name, not by a general parser: the notice is a fixed, flat set of
 * elements, and a document type declaration is refused outright, so no
 * entity is ever defined or expanded beyond XML's five. The query string's
 * `order_number`, `carrier`, `service` and `tracking_number` win when
 * present — the guide names them first — and the body fills the rest.
 */
export function readShipNotice(
  xml: string,
  query: Readonly<Record<string, string | undefined>>,
): ShipNotice | { problem: string } {
  const body = String(xml ?? '')
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) return { problem: `The notice declares a document type, which ${PLATFORM_BRAND_NAME} does not read.` }
  const root = elementBodies(body, 'ShipNotice')[0] ?? ''
  if (body.trim() && !root) return { problem: 'The notice is not a ShipNotice.' }
  const itemsBlock = elementBodies(root, 'Items')[0] ?? ''
  const items: ShipNoticeItem[] = elementBodies(itemsBlock, 'Item')
    .map((entry) => ({
      lineItemId: elementText(entry, 'LineItemID') || null,
      sku: elementText(entry, 'SKU') || null,
      name: elementText(entry, 'Name') || null,
      quantity: Math.floor(Number(elementText(entry, 'Quantity'))),
    }))
    .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0)
  // The order-level fields, read from the notice with its Items and
  // Recipient taken out, so a recipient's or an item's element never
  // answers for the order's.
  const top = root.replace(/<Items(?:\s[^>]*)?>[\s\S]*?<\/Items\s*>/g, '').replace(/<Recipient(?:\s[^>]*)?>[\s\S]*?<\/Recipient\s*>/g, '')
  return {
    orderNumber: String(query['order_number'] ?? '').trim() || elementText(top, 'OrderNumber') || null,
    orderId: elementText(top, 'OrderID') || null,
    carrier: String(query['carrier'] ?? '').trim() || elementText(top, 'Carrier'),
    service: String(query['service'] ?? '').trim() || elementText(top, 'Service'),
    trackingNumber: String(query['tracking_number'] ?? '').trim() || elementText(top, 'TrackingNumber'),
    items,
  }
}

/**
 * ShipStation's carrier code as a name a buyer reads and `trackingUrlFor`
 * knows — `usps` → `USPS`, `fedex` → `FedEx`. An unknown code is passed on
 * as sent, upper-cased at the first letter.
 */
export function shipStationCarrierName(code: string): string {
  const key = code.trim().toLowerCase()
  const known: Record<string, string> = {
    usps: 'USPS',
    stamps_com: 'USPS',
    endicia: 'USPS',
    express_1: 'USPS',
    ups: 'UPS',
    ups_walleted: 'UPS',
    ups_mail_innovations: 'UPS',
    fedex: 'FedEx',
    fedex_uk: 'FedEx',
    fedex_walleted: 'FedEx',
    dhl_express: 'DHL',
    dhl_express_uk: 'DHL',
    dhl_express_canada: 'DHL',
    dhl_express_australia: 'DHL',
    dhl_ecommerce: 'DHL eCommerce',
    dhl_global_mail: 'DHL eCommerce',
    canada_post: 'Canada Post',
    canada_post_walleted: 'Canada Post',
    royal_mail: 'Royal Mail',
    australia_post: 'Australia Post',
    ontrac: 'OnTrac',
    lasership: 'LaserShip',
  }
  if (known[key]) return known[key]
  if (!key) return ''
  return code.trim().charAt(0).toUpperCase() + code.trim().slice(1)
}

/**
 * Which order lines and how many units a notice ships, against the order.
 * An item is found by the `LineItemID` the feed sent (the line's index),
 * then by SKU among the lines still to ship. `null` lines means the notice
 * named no items: everything still to ship went in this parcel. An item that
 * names no line of this order is reported, not guessed at.
 */
export function shipNoticeLines(
  order: Pick<HostOrder, 'lineItems' | 'fulfillments'>,
  items: readonly ShipNoticeItem[],
): { lines: Array<{ lineItemId: number; quantity: number }> | null; unknown: string[] } {
  if (!items.length) return { lines: null, unknown: [] }
  const lineItems = order.lineItems ?? []
  const lines: Array<{ lineItemId: number; quantity: number }> = []
  const unknown: string[] = []
  for (const item of items) {
    const index = item.lineItemId !== null && /^\d+$/.test(item.lineItemId) ? Number(item.lineItemId) : NaN
    let lineItemId = Number.isInteger(index) && index < lineItems.length ? index : -1
    if (lineItemId < 0 && item.sku) {
      const wanted = item.sku.trim().toLowerCase()
      lineItemId = lineItems.findIndex(
        (line) =>
          (line.sku ?? '').trim().toLowerCase() === wanted ||
          (line.variantId ? `${line.productId}-${line.variantId}` : line.productId).toLowerCase() === wanted,
      )
    }
    if (lineItemId < 0) {
      unknown.push(item.sku || item.name || item.lineItemId || '?')
      continue
    }
    lines.push({ lineItemId, quantity: item.quantity })
  }
  return { lines, unknown }
}
