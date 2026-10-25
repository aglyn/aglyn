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
  CHECK_IN_MAX_HEADCOUNT,
  normalizeProductCheckIn,
  productCheckInProblem,
  type ProductCheckIn,
} from './commerce-check-in-product'
import { emailSearchTokens } from '@aglyn/aglyn/app-utils/email-search'
import {
  nameSearchKey,
  nameSearchToken,
  nameSearchTokens,
} from '@aglyn/aglyn/app-utils/name-search'
import type { ProductVariant } from './commerce'
import {
  formatOrderNumber,
  type HostOrder,
  type OrderChannel,
} from './commerce-orders'
import type { HostReservation } from './commerce-reservations'
import { posCsvCell } from './commerce-pos-ops'
import { orderLabelTokens } from './order-list-fields'

// The product setting lives in a pure module the native contracts read (AGL-4043).
export {
  CHECK_IN_MAX_HEADCOUNT,
  normalizeProductCheckIn,
  productCheckInProblem,
  type ProductCheckIn,
} from './commerce-check-in-product'

/*==========================================
 * CHECK-IN AT THE WINDOW (AGL-4043).
 *
 * A rider who bought a day pass online walks up to the window, is looked up
 * by name, checked in and handed a wristband. So is somebody who bought a
 * pass at the register, and a guest whose stay covers today.
 *
 * WHAT IS DUE ON A DAY
 *  - An order's lines whose product (or variant) "Needs check-in", on the
 *    day the order was placed, in the site's time zone. Products have no
 *    service date of their own, so the purchase day is the day the pass is
 *    for. A paid order only: `paid`, `partially_fulfilled`, `fulfilled` or
 *    `delivered`. A line refunded by name is not due.
 *  - Each unit is a person: quantity × the product's "people per item"
 *    (`headcount`, default 1), so three passes are three check-ins.
 *  - A reservation that is `confirmed` or `checked_in` and whose stay
 *    covers the day: one check-in per day of the stay.
 *
 * Every due unit is a document, `hosts/{hostId}/checkIns/{id}`, written by
 * the server only. Its id is the unit's identity (order, line, unit; or
 * stay, day), so writing what is due twice writes it once, and a check-in
 * is a transaction on that one document.
 *
 *   POST /api/commerce/pos-check-in   { hostId, action, … }
 *   GET  /api/commerce/pos-check-in?hostId=…&day=YYYY-MM-DD[&format=csv]
 *
 * The native register mirrors these types.
 *=========================================*/

export const POS_CHECK_IN_ROUTE = '/api/commerce/pos-check-in'

/** The most check-ins one order line makes, whatever its quantity. */
export const CHECK_IN_MAX_UNITS_PER_LINE = 200

/** The most check-ins, orders or stays one day reads. */
export const CHECK_IN_DAY_CEILING = 3000

/** The most check-in rows one search reads. */
export const CHECK_IN_SEARCH_ROWS = 100

/** The most customers one search answers. */
export const CHECK_IN_SEARCH_CUSTOMERS = 20

/** The most check-ins one tap records. */
export const CHECK_IN_BATCH_MAX = 50

/** A wristband's number or color, at most this many characters. */
export const CHECK_IN_WRISTBAND_MAX = 24

/** Colors offered as quick picks for a wristband. Any word is accepted. */
export const CHECK_IN_WRISTBAND_COLORS = [
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Purple',
  'Pink',
  'White',
  'Black',
] as const

/** The order statuses whose check-in lines are due. */
export const CHECK_IN_ORDER_STATUSES = ['paid', 'partially_fulfilled', 'fulfilled', 'delivered'] as const

/** The stay statuses whose days are due. */
export const CHECK_IN_RESERVATION_STATUSES = ['confirmed', 'checked_in'] as const

export type CheckInStatus = 'expected' | 'checked_in'

export interface CheckInWristband {
  number: string | null
  color: string | null
}

/** `hosts/{hostId}/checkIns/{id}`: one person due on one day. Server-written only. */
export interface HostCheckIn {
  source: 'order' | 'reservation'
  orderId: string | null
  /** The order's number as the console shows it (`#1042`), or null for a stay. */
  orderLabel: string | null
  /** Where the order was sold, or `reservation`. */
  channel: OrderChannel | 'reservation'
  reservationId: string | null
  lineIndex: number | null
  /** This person's place among the line's or stay's check-ins, from 0. */
  unitIndex: number
  /** How many check-ins the line or stay makes that day. */
  unitCount: number
  productId: string | null
  variantId: string | null
  itemName: string
  variantLabel: string | null
  /** The day, `YYYY-MM-DD` in the site's time zone. */
  dayKey: string
  /** Who the check-in is for, as one key: the address, else the contact, else the name, else the order. */
  customerKey: string
  customerName: string | null
  customerEmail: string | null
  customerEmailLower: string | null
  customerPhone: string | null
  /** The contact the register attached to the sale, when it was one. */
  contactId: string | null
  /** The name's, the address's, the phone's and the order number's search prefixes. */
  searchTokens: string[]
  status: CheckInStatus
  checkedInAtMs: number | null
  checkedInBy: string | null
  checkedInByName: string | null
  wristband: CheckInWristband | null
  /** The attempt that checked this person in, so a retried tap is not "already checked in". */
  checkInAttempt: string | null
  /** The last undo, kept so a reversed check-in still says who reversed it. */
  undoneAtMs: number | null
  undoneBy: string | null
  createdAtMs: number
  updatedAtMs: number
}

/** One check-in as the routes answer it. */
export type CheckInRow = HostCheckIn & { id: string }

/** A customer with something due on a day, as the search lists them. */
export interface CheckInCustomer {
  customerKey: string
  name: string | null
  email: string | null
  phone: string | null
  contactId: string | null
  /** Every check-in the customer has on the day. */
  unitsDue: number
  unitsCheckedIn: number
  /** What the check-ins are for, item names once each. */
  items: string[]
}

/*==========================================
 * THE PRODUCT SETTING
 *=========================================*/

/**
 * Whether one variant of a product needs check-in, and for how many people
 * per item: the variant's own setting, else the product's; `null` when not.
 */
export function productCheckInFor(
  product: { checkIn?: unknown; variants?: ReadonlyArray<Pick<ProductVariant, 'id'> & { checkIn?: unknown }> } | null | undefined,
  variantId: string | null | undefined,
): { headcount: number } | null {
  if (!product) return null
  const variant = (product.variants ?? []).find((one) => one.id === (variantId || 'default'))
  const setting = normalizeProductCheckIn(variant?.checkIn) ?? normalizeProductCheckIn(product.checkIn)
  return setting?.enabled ? { headcount: setting.headcount ?? 1 } : null
}

/** Whether any variant of a product needs check-in. */
export function productNeedsCheckIn(
  product: Parameters<typeof productCheckInFor>[0],
): boolean {
  if (!product) return false
  const variants = product.variants?.length ? product.variants : [{ id: 'default' }]
  return variants.some((variant) => productCheckInFor(product, variant.id) !== null)
}

/*==========================================
 * WHAT IS DUE
 *=========================================*/

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The digits of a phone number, without a leading US/Canada 1 when it has eleven. */
export function checkInPhoneDigits(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D+/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

/** The search prefixes of a phone number: its digits from three on, and its last four. */
function phoneTokens(phone: string | null | undefined): string[] {
  const digits = checkInPhoneDigits(phone).slice(0, 15)
  const tokens: string[] = []
  for (let at = 3; at <= digits.length; at += 1) tokens.push(digits.slice(0, at))
  // The last four, which is what a rider reads out at the window.
  if (digits.length >= 7) tokens.push(digits.slice(-4))
  return tokens
}

/** The tokens a check-in is found by. */
export function checkInSearchTokens(input: {
  name?: string | null
  email?: string | null
  phone?: string | null
  orderNumber?: number | null
  orderId?: string | null
}): string[] {
  return [
    ...new Set([
      ...nameSearchTokens(input.name ?? ''),
      ...emailSearchTokens(input.email ?? ''),
      ...phoneTokens(input.phone),
      ...(input.orderId ? orderLabelTokens({ number: input.orderNumber ?? undefined }, input.orderId) : []),
    ]),
  ].slice(0, 200)
}

/**
 * What a typed search asks the index for: the phone's digits when it is a
 * number, else the first word's prefix (a name, an address, `#1042`).
 */
export function checkInSearchToken(typed: string): string {
  const value = String(typed ?? '').trim()
  if (!value) return ''
  if (/^[\d\s()+.-]+$/.test(value) && !value.startsWith('#')) {
    const digits = checkInPhoneDigits(value)
    return digits.length >= 3 ? digits.slice(0, 15) : ''
  }
  return nameSearchToken(value)
}

/** One key per customer: the address, else the contact, else the name, else the source. */
export function checkInCustomerKey(input: {
  email?: string | null
  contactId?: string | null
  name?: string | null
  fallback: string
}): string {
  const email = text(input.email).toLowerCase()
  if (email) return `email:${email}`
  if (input.contactId) return `contact:${input.contactId}`
  const name = nameSearchKey(input.name ?? '')
  if (name) return `name:${name}`
  return input.fallback
}

/** A check-in's document id, from its unit's identity. */
export function orderCheckInId(orderId: string, lineIndex: number, unitIndex: number): string {
  return `o_${orderId}_${lineIndex}_${unitIndex}`
}

export function reservationCheckInId(reservationId: string, dayKey: string, unitIndex = 0): string {
  return `r_${reservationId}_${dayKey}_${unitIndex}`
}

/** A due check-in before the server stamps its times and status. */
export type DueCheckIn = Omit<
  HostCheckIn,
  | 'status'
  | 'checkedInAtMs'
  | 'checkedInBy'
  | 'checkedInByName'
  | 'wristband'
  | 'checkInAttempt'
  | 'undoneAtMs'
  | 'undoneBy'
  | 'createdAtMs'
  | 'updatedAtMs'
>

/** The customer fields a due check-in copies from its source, which a later read may refresh. */
export const CHECK_IN_CUSTOMER_FIELDS = [
  'customerKey',
  'customerName',
  'customerEmail',
  'customerEmailLower',
  'customerPhone',
  'contactId',
  'searchTokens',
] as const

/** Whether an order's lines are due at all. */
export function orderIsDueForCheckIn(order: Pick<HostOrder, 'status'> | null | undefined): boolean {
  return Boolean(order && (CHECK_IN_ORDER_STATUSES as readonly string[]).includes(String(order.status ?? '')))
}

/**
 * The check-ins an order makes on its day, keyed by document id. `products`
 * holds the products its lines name, as stored now: the setting is read at
 * the window, so turning it on covers passes already sold today.
 */
export function dueCheckInsForOrder(input: {
  orderId: string
  order: Partial<HostOrder>
  products: ReadonlyMap<string, Parameters<typeof productCheckInFor>[0]>
  dayKey: string
}): Map<string, DueCheckIn> {
  const { orderId, order, dayKey } = input
  const due = new Map<string, DueCheckIn>()
  if (!orderIsDueForCheckIn(order as HostOrder)) return due
  const refunded = new Set(Array.isArray(order.refundedLineItemIds) ? order.refundedLineItemIds : [])
  const contactId =
    order.customerRecord?.kind === 'contact' && order.customerRecord.id ? order.customerRecord.id : null
  const name = text(order.customerName) || null
  const email = text(order.customerEmail) || null
  const phone = text(order.customerPhone) || null
  const customerKey = checkInCustomerKey({ email, contactId, name, fallback: `order:${orderId}` })
  const searchTokens = checkInSearchTokens({ name, email, phone, orderNumber: order.number ?? null, orderId })
  const lines = Array.isArray(order.lineItems) ? order.lineItems : []
  lines.forEach((line, lineIndex) => {
    if (!line || refunded.has(lineIndex)) return
    const setting = productCheckInFor(input.products.get(line.productId) ?? null, line.variantId)
    if (!setting) return
    const quantity = Math.max(0, Math.round(Number(line.quantity) || 0))
    const unitCount = Math.min(quantity * setting.headcount, CHECK_IN_MAX_UNITS_PER_LINE)
    for (let unitIndex = 0; unitIndex < unitCount; unitIndex += 1) {
      due.set(orderCheckInId(orderId, lineIndex, unitIndex), {
        source: 'order',
        orderId,
        orderLabel: formatOrderNumber({ number: order.number }, orderId),
        channel: (order.channel ?? 'online') as OrderChannel,
        reservationId: null,
        lineIndex,
        unitIndex,
        unitCount,
        productId: line.productId ?? null,
        variantId: line.variantId ?? null,
        itemName: text(line.name) || 'Item',
        variantLabel: text(line.variantLabel) || null,
        dayKey,
        customerKey,
        customerName: name,
        customerEmail: email,
        customerEmailLower: email ? email.toLowerCase() : null,
        customerPhone: phone,
        contactId,
        searchTokens,
      })
    }
  })
  return due
}

/** UTC midnight of a `YYYY-MM-DD` day, as a stay's days are stored. */
export function checkInDayMs(dayKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (!match) return null
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const check = new Date(ms)
  return check.getUTCDate() === Number(match[3]) && check.getUTCMonth() === Number(match[2]) - 1 ? ms : null
}

/** The check-in a stay makes on a day it covers; empty on any other day. */
export function dueCheckInsForReservation(input: {
  reservationId: string
  reservation: Partial<HostReservation>
  resourceName: string | null
  dayKey: string
}): Map<string, DueCheckIn> {
  const { reservationId, reservation, dayKey } = input
  const due = new Map<string, DueCheckIn>()
  const dayMs = checkInDayMs(dayKey)
  if (
    dayMs === null ||
    !(CHECK_IN_RESERVATION_STATUSES as readonly string[]).includes(String(reservation.status ?? '')) ||
    !(Number(reservation.checkInDayMs) <= dayMs && dayMs < Number(reservation.checkOutDayMs))
  ) {
    return due
  }
  const name = text(reservation.guestName) || null
  const email = text(reservation.guestEmail) || null
  due.set(reservationCheckInId(reservationId, dayKey), {
    source: 'reservation',
    orderId: null,
    orderLabel: null,
    channel: 'reservation',
    reservationId,
    lineIndex: null,
    unitIndex: 0,
    unitCount: 1,
    productId: null,
    variantId: null,
    itemName: text(input.resourceName) || 'Stay',
    variantLabel: null,
    dayKey,
    customerKey: checkInCustomerKey({ email, name, fallback: `reservation:${reservationId}` }),
    customerName: name,
    customerEmail: email,
    customerEmailLower: email ? email.toLowerCase() : null,
    customerPhone: null,
    contactId: null,
    searchTokens: checkInSearchTokens({ name, email }),
  })
  return due
}

/** A due check-in as first written. */
export function newCheckInDocument(due: DueCheckIn, nowMs: number): HostCheckIn {
  return {
    ...due,
    status: 'expected',
    checkedInAtMs: null,
    checkedInBy: null,
    checkedInByName: null,
    wristband: null,
    checkInAttempt: null,
    undoneAtMs: null,
    undoneBy: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
}

/** The customer fields of a stored check-in that its source now says otherwise. */
export function changedCheckInCustomerFields(
  stored: Partial<HostCheckIn>,
  due: DueCheckIn,
): Partial<DueCheckIn> | null {
  const patch: Record<string, unknown> = {}
  for (const field of CHECK_IN_CUSTOMER_FIELDS) {
    if (JSON.stringify(stored[field] ?? null) !== JSON.stringify(due[field] ?? null)) patch[field] = due[field]
  }
  return Object.keys(patch).length ? (patch as Partial<DueCheckIn>) : null
}

/*==========================================
 * WRISTBANDS, CUSTOMERS AND THE DAY
 *=========================================*/

/**
 * A wristband as typed, made safe: a number (letters, digits, a dash) and a
 * color word, each optional. `null` with neither; an error for junk.
 */
export function normalizeWristband(
  value: unknown,
): { ok: true; wristband: CheckInWristband | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, wristband: null }
  if (typeof value !== 'object') return { ok: false, error: 'That is not a wristband.' }
  const raw = value as Record<string, unknown>
  const number = String(raw['number'] ?? '').trim()
  const color = String(raw['color'] ?? '').trim()
  if (number.length > CHECK_IN_WRISTBAND_MAX || color.length > CHECK_IN_WRISTBAND_MAX) {
    return { ok: false, error: `A wristband number or color is ${CHECK_IN_WRISTBAND_MAX} characters at most.` }
  }
  if (number && !/^[A-Za-z0-9#-]+$/.test(number)) {
    return { ok: false, error: 'A wristband number is letters, digits and dashes.' }
  }
  if (color && !/^[\p{L} -]+$/u.test(color)) {
    return { ok: false, error: 'A wristband color is a word, such as Blue.' }
  }
  if (!number && !color) return { ok: true, wristband: null }
  return { ok: true, wristband: { number: number || null, color: color || null } }
}

/** A wristband as one line: "Blue #214". */
export function describeWristband(wristband: CheckInWristband | null | undefined): string {
  if (!wristband) return ''
  return [wristband.color, wristband.number ? `#${wristband.number.replace(/^#/, '')}` : null]
    .filter(Boolean)
    .join(' ')
}

/** The customers a set of check-ins is for, most due first, then by name. */
export function checkInCustomers(rows: ReadonlyArray<CheckInRow>): CheckInCustomer[] {
  const byKey = new Map<string, CheckInCustomer>()
  for (const row of rows) {
    const found = byKey.get(row.customerKey)
    const customer: CheckInCustomer = found ?? {
      customerKey: row.customerKey,
      name: row.customerName,
      email: row.customerEmail,
      phone: row.customerPhone,
      contactId: row.contactId,
      unitsDue: 0,
      unitsCheckedIn: 0,
      items: [],
    }
    customer.unitsDue += 1
    if (row.status === 'checked_in') customer.unitsCheckedIn += 1
    customer.name ||= row.customerName
    customer.email ||= row.customerEmail
    customer.phone ||= row.customerPhone
    customer.contactId ||= row.contactId
    if (!customer.items.includes(row.itemName)) customer.items.push(row.itemName)
    byKey.set(row.customerKey, customer)
  }
  return [...byKey.values()].sort(
    (a, b) =>
      b.unitsDue - b.unitsCheckedIn - (a.unitsDue - a.unitsCheckedIn) ||
      String(a.name ?? a.email ?? '').localeCompare(String(b.name ?? b.email ?? '')),
  )
}

/** A day's check-ins in the order the window reads them: by name, then item, then unit. */
export function sortCheckInRows<T extends Pick<CheckInRow, 'customerName' | 'customerEmail' | 'itemName' | 'unitIndex' | 'id'>>(
  rows: ReadonlyArray<T>,
): T[] {
  return [...rows].sort(
    (a, b) =>
      String(a.customerName ?? a.customerEmail ?? '').localeCompare(String(b.customerName ?? b.customerEmail ?? '')) ||
      a.itemName.localeCompare(b.itemName) ||
      a.unitIndex - b.unitIndex ||
      a.id.localeCompare(b.id),
  )
}

export interface CheckInDayTotals {
  expected: number
  checkedIn: number
}

export function checkInDayTotals(rows: ReadonlyArray<Pick<CheckInRow, 'status'>>): CheckInDayTotals {
  return {
    expected: rows.length,
    checkedIn: rows.filter((row) => row.status === 'checked_in').length,
  }
}

/** A time on the site's clock: "9:14 AM". */
export function checkInTimeLabel(ms: number | null | undefined, timeZone: string): string {
  if (!ms) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(ms))
  } catch {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
  }
}

/** "Already checked in at 9:14 AM by Sam". */
export function alreadyCheckedInLabel(row: Pick<CheckInRow, 'checkedInAtMs' | 'checkedInByName'>, timeZone: string): string {
  const at = checkInTimeLabel(row.checkedInAtMs, timeZone)
  return `Already checked in${at ? ` at ${at}` : ''}${row.checkedInByName ? ` by ${row.checkedInByName}` : ''}`
}

/** One person's line, as the list and the spreadsheet name it: "Day pass · Adult (2 of 3)". */
export function checkInItemLabel(row: Pick<CheckInRow, 'itemName' | 'variantLabel' | 'unitIndex' | 'unitCount'>): string {
  const item = row.variantLabel ? `${row.itemName} · ${row.variantLabel}` : row.itemName
  return row.unitCount > 1 ? `${item} (${row.unitIndex + 1} of ${row.unitCount})` : item
}

/** The day's check-ins as a spreadsheet, one row per person. */
export function checkInDayCsv(rows: ReadonlyArray<CheckInRow>, timeZone: string): string {
  const header = [
    'Day',
    'Name',
    'Email',
    'Phone',
    'Item',
    'Order',
    'Status',
    'Checked in at',
    'Checked in by',
    'Wristband number',
    'Wristband color',
  ]
  const lines = sortCheckInRows(rows).map((row) =>
    [
      row.dayKey,
      row.customerName ?? '',
      row.customerEmail ?? '',
      row.customerPhone ?? '',
      checkInItemLabel(row),
      row.orderLabel ?? (row.source === 'reservation' ? 'Stay' : ''),
      row.status === 'checked_in' ? 'Checked in' : 'Expected',
      checkInTimeLabel(row.checkedInAtMs, timeZone),
      row.checkedInByName ?? '',
      row.wristband?.number ?? '',
      row.wristband?.color ?? '',
    ]
      .map(posCsvCell)
      .join(','),
  )
  return [header.map(posCsvCell).join(','), ...lines].join('\n') + '\n'
}
