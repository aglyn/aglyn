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
 * Quantity-level fulfillment (AGL-3611).
 *
 * A fulfillment used to name whole lines (`lineItemIds`), so "ship 2 of the 5
 * mugs now, the rest next week" could not be said. A fulfillment now carries
 * `lines: [{ lineItemId, quantity }]`; one written before that reads as every
 * unit of each line it named, which is what it meant when it was written.
 *
 * Every figure here is computed from the order's own fulfillments, so the
 * server's transaction and the console's panel ask the same question of the
 * same record and cannot disagree about what is left to ship.
 */

import type {
  HostOrder,
  OrderFulfillment,
  OrderLineItem,
  OrderStatus,
} from './commerce-orders'

/** One line of a fulfillment: which order line, and how many of its units. */
export interface OrderFulfillmentLine {
  /** The line's index in `order.lineItems`. */
  lineItemId: number
  quantity: number
}

/** A fulfillment's lifecycle; absent reads as `active`. */
export type OrderFulfillmentStatus = 'active' | 'cancelled'

/**
 * Whether a line has to be shipped at all. Digital goods and services are
 * delivered by other means, so they never hold an order in
 * `partially_fulfilled`. A line with no recorded type predates types and is
 * treated as physical, the only reading that cannot close an order early.
 */
export function lineRequiresShipping(line: Pick<OrderLineItem, 'productType'>): boolean {
  return line.productType !== 'digital' && line.productType !== 'service'
}

const wholeUnits = (value: unknown): number => {
  const units = Math.floor(Number(value ?? 0))
  return Number.isFinite(units) && units > 0 ? units : 0
}

/** Whether a fulfillment still counts: a cancelled one ships nothing. */
export function fulfillmentIsActive(fulfillment: Partial<OrderFulfillment> | null | undefined): boolean {
  return Boolean(fulfillment) && fulfillment?.status !== 'cancelled'
}

/**
 * The units one fulfillment covers, per line. A legacy fulfillment (no
 * `lines`) covers every unit of each line it names.
 */
export function fulfillmentLineQuantities(
  order: Pick<HostOrder, 'lineItems'>,
  fulfillment: Partial<OrderFulfillment>,
): OrderFulfillmentLine[] {
  const lines = order.lineItems ?? []
  if (Array.isArray(fulfillment.lines) && fulfillment.lines.length > 0) {
    return fulfillment.lines
      .map((entry) => ({
        lineItemId: Math.round(Number(entry?.lineItemId)),
        quantity: wholeUnits(entry?.quantity),
      }))
      .filter(
        (entry) =>
          Number.isInteger(entry.lineItemId) &&
          entry.lineItemId >= 0 &&
          entry.lineItemId < lines.length &&
          entry.quantity > 0,
      )
  }
  return (fulfillment.lineItemIds ?? [])
    .map((index) => Math.round(Number(index)))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < lines.length)
    .map((index) => ({ lineItemId: index, quantity: wholeUnits(lines[index]?.quantity) }))
    .filter((entry) => entry.quantity > 0)
}

/** Units already fulfilled per line index, over every active fulfillment. */
export function fulfilledQuantities(order: Pick<HostOrder, 'lineItems' | 'fulfillments'>): Map<number, number> {
  const totals = new Map<number, number>()
  for (const fulfillment of order.fulfillments ?? []) {
    if (!fulfillmentIsActive(fulfillment)) continue
    for (const entry of fulfillmentLineQuantities(order, fulfillment)) {
      totals.set(entry.lineItemId, (totals.get(entry.lineItemId) ?? 0) + entry.quantity)
    }
  }
  return totals
}

/** A line as the fulfillment panel and the server both reason about it. */
export interface OrderLineFulfillmentState {
  lineItemId: number
  quantity: number
  fulfilledQuantity: number
  remainingQuantity: number
  requiresShipping: boolean
}

/** Every line's fulfilled and remaining units. */
export function orderLineFulfillmentStates(
  order: Pick<HostOrder, 'lineItems' | 'fulfillments'>,
): OrderLineFulfillmentState[] {
  const fulfilled = fulfilledQuantities(order)
  return (order.lineItems ?? []).map((line, index) => {
    const quantity = wholeUnits(line.quantity)
    const done = Math.min(quantity, fulfilled.get(index) ?? 0)
    return {
      lineItemId: index,
      quantity,
      fulfilledQuantity: done,
      remainingQuantity: quantity - done,
      requiresShipping: lineRequiresShipping(line),
    }
  })
}

/**
 * What is left to ship: every shippable line's remaining units. This is what
 * a "fulfill everything" request covers.
 */
export function remainingFulfillmentLines(
  order: Pick<HostOrder, 'lineItems' | 'fulfillments'>,
): OrderFulfillmentLine[] {
  return orderLineFulfillmentStates(order)
    .filter((state) => state.requiresShipping && state.remainingQuantity > 0)
    .map((state) => ({ lineItemId: state.lineItemId, quantity: state.remainingQuantity }))
}

/** Why a requested set of fulfillment lines was refused. */
export type FulfillmentLinesProblem =
  | { problem: 'empty' }
  | { problem: 'unknown_line'; lineItemId: number }
  | { problem: 'bad_quantity'; lineItemId: number }
  | { problem: 'over_fulfilled'; lineItemId: number; remaining: number; requested: number }

/**
 * Validates and merges a requested set of lines against what is left.
 *
 * Duplicate entries for one line are summed before the check, so a request
 * cannot slip past the remaining count by naming the line twice. A digital
 * or service line may be fulfilled (a merchant marking a service done), but
 * never beyond its quantity.
 */
export function resolveFulfillmentLines(
  order: Pick<HostOrder, 'lineItems' | 'fulfillments'>,
  requested: ReadonlyArray<{ lineItemId: unknown; quantity: unknown }>,
): { lines: OrderFulfillmentLine[] } | FulfillmentLinesProblem {
  const states = orderLineFulfillmentStates(order)
  const merged = new Map<number, number>()
  for (const entry of requested) {
    const lineItemId = Number(entry?.lineItemId)
    if (!Number.isInteger(lineItemId) || lineItemId < 0 || lineItemId >= states.length) {
      return { problem: 'unknown_line', lineItemId: Number.isFinite(lineItemId) ? lineItemId : -1 }
    }
    const quantity = Number(entry?.quantity)
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return { problem: 'bad_quantity', lineItemId }
    }
    merged.set(lineItemId, (merged.get(lineItemId) ?? 0) + quantity)
  }
  if (merged.size === 0) return { problem: 'empty' }
  const lines: OrderFulfillmentLine[] = []
  for (const [lineItemId, quantity] of [...merged.entries()].sort((a, b) => a[0] - b[0])) {
    const remaining = states[lineItemId].remainingQuantity
    if (quantity > remaining) {
      return { problem: 'over_fulfilled', lineItemId, remaining, requested: quantity }
    }
    lines.push({ lineItemId, quantity })
  }
  return { lines }
}

/** Words for a refused request, for the console and the API. */
export function describeFulfillmentLinesProblem(problem: FulfillmentLinesProblem): string {
  switch (problem.problem) {
    case 'empty':
      return 'Choose at least one item to fulfill'
    case 'unknown_line':
      return `Line ${problem.lineItemId} is not on this order`
    case 'bad_quantity':
      return `The quantity for line ${problem.lineItemId} must be a whole number above zero`
    case 'over_fulfilled':
      return problem.remaining === 0
        ? `Line ${problem.lineItemId} is already fully fulfilled`
        : `Line ${problem.lineItemId} has only ${problem.remaining} left to fulfill, not ${problem.requested}`
  }
}

/**
 * The status an order's fulfillments put it in: `fulfilled` once every
 * shippable unit is covered, `partially_fulfilled` while some are, and
 * `paid` when none are. An order with nothing to ship reads as `fulfilled`
 * once anything at all was recorded against it, and as `paid` before.
 */
export function statusFromFulfillments(
  order: Pick<HostOrder, 'lineItems' | 'fulfillments'>,
): Extract<OrderStatus, 'paid' | 'partially_fulfilled' | 'fulfilled'> {
  const states = orderLineFulfillmentStates(order)
  const shippable = states.filter((state) => state.requiresShipping)
  const anything = states.some((state) => state.fulfilledQuantity > 0)
  if (shippable.length === 0) return anything ? 'fulfilled' : 'paid'
  if (shippable.every((state) => state.remainingQuantity === 0)) return 'fulfilled'
  return shippable.some((state) => state.fulfilledQuantity > 0) || anything
    ? 'partially_fulfilled'
    : 'paid'
}

/** Statuses whose fulfillments may still be added to, edited or cancelled. */
const FULFILLMENT_OPEN_STATUSES: readonly OrderStatus[] = ['paid', 'partially_fulfilled', 'fulfilled']

/**
 * Whether a fulfillment on this order may be edited or cancelled. A delivered,
 * refunded or cancelled order is history: its fulfillments are what happened.
 */
export function orderFulfillmentsEditable(order: Pick<HostOrder, 'status'>): boolean {
  return FULFILLMENT_OPEN_STATUSES.includes(order.status)
}

/** A short "2× Mug, 1× Shirt" for a fulfillment, for timelines and emails. */
export function describeFulfillmentLines(
  order: Pick<HostOrder, 'lineItems'>,
  lines: readonly OrderFulfillmentLine[],
): string {
  return lines
    .map((entry) => `${entry.quantity}× ${order.lineItems?.[entry.lineItemId]?.name ?? `line ${entry.lineItemId}`}`)
    .join(', ')
}

/** The carriers the console offers by name; anything else is typed under Other. */
export const FULFILLMENT_CARRIER_CHOICES: readonly string[] = [
  'USPS',
  'UPS',
  'FedEx',
  'DHL',
  'Canada Post',
  'Royal Mail',
  'Australia Post',
]

/** What a merchant reads for a carrier's tracking status (AGL-3612). */
const TRACKING_STATUS_LABELS: Readonly<Record<string, string>> = {
  pre_transit: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Delivery problem',
  returned: 'Returned to sender',
}

/** The words for a fulfillment's `trackingStatus`, or the status itself. */
export function trackingStatusLabel(status: string | undefined | null): string {
  return status ? TRACKING_STATUS_LABELS[status] ?? status : ''
}

/**
 * The most a shipment's hand-entered shipping cost may be, in minor units of
 * the store's currency (AGL-3705): $10,000.00, or ¥1,000,000. A typo guard,
 * not a policy — a parcel that costs more is freight, not a shipment.
 */
export const SHIPPING_COST_MAX_CENTS = 1_000_000

/**
 * How many minor units a currency has (2 for USD, 0 for JPY), from the
 * platform's own currency data; 2 for a code it does not know.
 */
export function currencyMinorDigits(currency: string | null | undefined): number {
  try {
    const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'USD').toUpperCase() })
    return format.resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/**
 * Why a shipping cost a door was handed cannot be stored (AGL-3705), or null
 * when it can. Absent (`undefined`, `null`, `''`) is fine — it means "not
 * known", which is not zero. A present cost is whole minor units, from zero
 * (free shipping, which is said) to {@link SHIPPING_COST_MAX_CENTS}.
 */
export function shippingCostCentsProblem(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return 'Shipping cost must be a whole number of cents'
  }
  if (value < 0) return 'Shipping cost cannot be negative'
  if (value > SHIPPING_COST_MAX_CENTS) return 'Shipping cost is too large'
  return null
}

/**
 * What a merchant typed in the fulfill dialog's Shipping cost field, read in
 * the store's currency (AGL-3705): `12`, `12.5`, `$12.50` and `1,250.00` are
 * amounts; an empty field is no cost at all (`cents: null`), which is not 0.
 * More decimals than the currency has, a negative or a word is an error.
 */
export function parseShippingCostInput(
  input: string,
  currency: string | null | undefined,
): { cents: number | null } | { error: string } {
  const digits = currencyMinorDigits(currency)
  const cleaned = String(input ?? '')
    .trim()
    .replace(/^[^\d.-]+/, '')
    .replace(/,/g, '')
  if (!String(input ?? '').trim()) return { cents: null }
  if (cleaned.startsWith('-')) return { error: 'Shipping cost cannot be negative' }
  const pattern = digits > 0 ? new RegExp(`^\\d*(\\.\\d{0,${digits}})?$`) : /^\d+$/
  if (!cleaned || cleaned === '.' || !pattern.test(cleaned)) {
    return {
      error: digits > 0 ? `Enter an amount like 8.45` : 'Enter a whole amount, like 850',
    }
  }
  const [whole, fraction = ''] = cleaned.split('.')
  const cents = Number(whole || '0') * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0')
  const problem = shippingCostCentsProblem(cents)
  return problem ? { error: problem } : { cents }
}
