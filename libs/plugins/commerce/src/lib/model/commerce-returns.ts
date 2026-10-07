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

import type { ProductType } from './commerce'
import {
  formatOrderNumber,
  orderLineRefundCents,
  orderLineRefunded,
  type HostOrder,
} from './commerce-orders'
import { fulfilledQuantities, lineRequiresShipping } from './order-fulfillment'

/**
 * Returns (RMA, AGL-3611): `hosts/{hostId}/returns/{id}`.
 *
 * A buyer asks to send items back, from their account or the order-status
 * page; the merchant approves or declines, receives the parcel and decides
 * per line whether it goes back on the shelf, then refunds through the
 * order's own refund route. The return is the record of all of that, so the
 * order keeps meaning what it always meant and the money still moves through
 * the one door that guards it.
 *
 * Every rule here is pure and shared by the buyer's route, the merchant's
 * route and the console, so the three cannot disagree about what is
 * returnable.
 */

export type ReturnStatus = 'requested' | 'approved' | 'declined' | 'received' | 'refunded' | 'closed'

export const RETURN_STATUSES: readonly ReturnStatus[] = [
  'requested',
  'approved',
  'declined',
  'received',
  'refunded',
  'closed',
]

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  declined: 'Declined',
  received: 'Received',
  refunded: 'Refunded',
  closed: 'Closed',
}

export const RETURN_STATUS_COLOR: Record<ReturnStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  requested: 'warning',
  approved: 'info',
  declined: 'default',
  received: 'info',
  refunded: 'success',
  closed: 'default',
}

export type ReturnReason =
  | 'damaged'
  | 'wrong_item'
  | 'not_as_described'
  | 'size_or_fit'
  | 'no_longer_needed'
  | 'other'

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  damaged: 'Arrived damaged',
  wrong_item: 'Wrong item',
  not_as_described: 'Not as described',
  size_or_fit: 'Size or fit',
  no_longer_needed: 'No longer needed',
  other: 'Other',
}

export const RETURN_REASONS = Object.keys(RETURN_REASON_LABELS) as ReturnReason[]

export interface ReturnLine {
  lineItemId: number
  quantity: number
  reason: ReturnReason
}

/** A return label a shipping plugin bought for the buyer to send the parcel with. */
export interface ReturnLabel {
  carrier: string
  trackingNumber: string
  labelUrl: string
  trackingUrl?: string
  attachedAtMs: number
}

/** What went back on the shelf when the parcel arrived. */
export interface ReturnRestock {
  lines: Array<{ lineItemId: number; quantity: number }>
  /** The stock location the units went to, for a multi-location store. */
  locationId?: string
  atMs: number
}

export interface ReturnTimelineEvent {
  atMs: number
  event: string
  detail?: string
}

/** `hosts/{hostId}/returns/{id}`, written only by the server. */
export interface HostReturn {
  orderId: string
  /** The order's number, for the list, e.g. `#1042`. */
  orderNumber: string
  customerEmail: string | null
  customerName: string | null
  lines: ReturnLine[]
  status: ReturnStatus
  /** Who opened it: the buyer, or the merchant on their behalf. */
  requestedBy: 'buyer' | 'merchant'
  customerNote?: string
  merchantNote?: string
  returnLabel?: ReturnLabel
  restock?: ReturnRestock
  /** When the refund went through the order's refund route, and for how much. */
  refundedAtMs?: number
  refundCents?: number
  timeline: ReturnTimelineEvent[]
  createdAtMs: number
  updatedAtMs: number
}

/** The store's return policy, at `hosts/{hostId}/settings/store` `returns`. */
export interface StoreReturnSettings {
  /** Whether buyers may ask for a return themselves. */
  enabled: boolean
  /** Days after the order shipped (or was placed, if it never shipped). */
  windowDays: number
  /** The product types a buyer may return. */
  eligibleTypes: ProductType[]
}

export const DEFAULT_RETURN_SETTINGS: StoreReturnSettings = {
  enabled: true,
  windowDays: 30,
  eligibleTypes: ['physical'],
}

/** The most days a window may be set to, and the most a note may hold. */
export const RETURN_WINDOW_MAX_DAYS = 365
export const RETURN_NOTE_MAX = 1000

/** The stored settings, read defensively: the document is admin-writable. */
export function readReturnSettings(raw: unknown): StoreReturnSettings {
  const value = (raw ?? {}) as Partial<Record<keyof StoreReturnSettings, unknown>>
  const days = Math.round(Number(value.windowDays))
  const types = Array.isArray(value.eligibleTypes)
    ? (value.eligibleTypes as unknown[]).filter(
        (type): type is ProductType => type === 'physical' || type === 'digital' || type === 'service',
      )
    : DEFAULT_RETURN_SETTINGS.eligibleTypes
  return {
    enabled: value.enabled !== false,
    windowDays:
      Number.isFinite(days) && days >= 0 ? Math.min(days, RETURN_WINDOW_MAX_DAYS) : DEFAULT_RETURN_SETTINGS.windowDays,
    eligibleTypes: types,
  }
}

const TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'declined', 'closed'],
  approved: ['received', 'refunded', 'closed'],
  declined: ['closed'],
  received: ['refunded', 'closed'],
  refunded: ['closed'],
  closed: [],
}

/** The return state machine. */
export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

/** Whether a return still holds units against the order. */
export function returnIsOpen(entry: Pick<HostReturn, 'status'>): boolean {
  return entry.status !== 'declined' && entry.status !== 'closed'
}

/** Whether a return is still holding units, or took them: anything not declined. */
function returnHoldsUnits(entry: Pick<HostReturn, 'status' | 'refundedAtMs'>): boolean {
  if (entry.status === 'declined') return false
  // A return closed without a refund gave its units back to the order.
  if (entry.status === 'closed') return Boolean(entry.refundedAtMs)
  return true
}

/** Units each line could be sent back, and why not where none can. */
export interface ReturnableLine {
  lineItemId: number
  name: string
  variantLabel: string | null
  productType: ProductType | null
  /** Units the buyer has and may send back. */
  returnable: number
  /** Why `returnable` is 0, in the buyer's words; `null` when it is not. */
  blocked: string | null
}

/**
 * What can come back on an order: each line's shipped units (every unit, for
 * a line with nothing to ship), less units already in a return that has not
 * been declined, less everything on a line already refunded by name.
 */
export function returnableLines(
  order: Pick<HostOrder, 'lineItems' | 'fulfillments' | 'refundedLineItemIds'>,
  existing: ReadonlyArray<Pick<HostReturn, 'status' | 'lines' | 'refundedAtMs'>>,
  settings: Pick<StoreReturnSettings, 'eligibleTypes'> | null,
): ReturnableLine[] {
  const shipped = fulfilledQuantities(order)
  const held = new Map<number, number>()
  for (const entry of existing) {
    if (!returnHoldsUnits(entry)) continue
    for (const line of entry.lines ?? []) {
      held.set(line.lineItemId, (held.get(line.lineItemId) ?? 0) + Math.max(0, Math.floor(Number(line.quantity) || 0)))
    }
  }
  return (order.lineItems ?? []).map((line, index) => {
    const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0))
    const delivered = lineRequiresShipping(line) ? Math.min(quantity, shipped.get(index) ?? 0) : quantity
    const type = (line.productType ?? null) as ProductType | null
    let blocked: string | null = null
    if (orderLineRefunded(order, index)) blocked = 'Already refunded'
    else if (settings && !settings.eligibleTypes.includes(type ?? 'physical')) blocked = 'Not returnable'
    else if (delivered === 0) blocked = 'Not shipped yet'
    const returnable = blocked ? 0 : Math.max(0, delivered - (held.get(index) ?? 0))
    return {
      lineItemId: index,
      name: line.name,
      variantLabel: line.variantLabel ?? null,
      productType: type,
      returnable,
      blocked: blocked ?? (returnable === 0 ? 'Already being returned' : null),
    }
  })
}

/**
 * When the return window closes: `windowDays` after the latest shipment, or
 * after the order was placed when nothing shipped (a digital order). `null`
 * when the order carries no date at all, which reads as open.
 */
export function returnWindowEndsAtMs(
  order: Pick<HostOrder, 'fulfillments' | 'createdAtMs'>,
  settings: Pick<StoreReturnSettings, 'windowDays'>,
): number | null {
  const shippedAt = Math.max(0, ...(order.fulfillments ?? []).filter((entry) => entry.status !== 'cancelled').map((entry) => Number(entry.atMs) || 0))
  const from = shippedAt || Number(order.createdAtMs) || 0
  if (!from) return null
  return from + settings.windowDays * 86_400_000
}

/** Why a requested return was refused. */
export type ReturnRequestProblem =
  | { problem: 'disabled' }
  | { problem: 'window_closed'; endedAtMs: number }
  | { problem: 'order_status'; status: string }
  | { problem: 'empty' }
  | { problem: 'bad_line'; lineItemId: number }
  | { problem: 'bad_reason'; lineItemId: number }
  | { problem: 'too_many'; lineItemId: number; returnable: number }

/** Order statuses a return may be opened against. */
const RETURNABLE_ORDER_STATUSES = ['paid', 'partially_fulfilled', 'fulfilled', 'delivered']

/**
 * Checks a return request against the order and the returns already open on
 * it, merging duplicate lines first. `merchant` skips the buyer-only rules —
 * the switch and the window — since a merchant may take anything back.
 */
export function validateReturnRequest(input: {
  order: Pick<HostOrder, 'status' | 'lineItems' | 'fulfillments' | 'refundedLineItemIds' | 'createdAtMs'>
  existing: ReadonlyArray<Pick<HostReturn, 'status' | 'lines' | 'refundedAtMs'>>
  settings: StoreReturnSettings
  lines: ReadonlyArray<{ lineItemId: unknown; quantity: unknown; reason: unknown }>
  by: 'buyer' | 'merchant'
  now: number
}): { lines: ReturnLine[] } | ReturnRequestProblem {
  const { order, existing, settings, by, now } = input
  if (by === 'buyer' && !settings.enabled) return { problem: 'disabled' }
  if (!RETURNABLE_ORDER_STATUSES.includes(order.status)) return { problem: 'order_status', status: order.status }
  if (by === 'buyer') {
    const endsAt = returnWindowEndsAtMs(order, settings)
    if (endsAt !== null && now > endsAt) return { problem: 'window_closed', endedAtMs: endsAt }
  }
  const returnable = returnableLines(order, existing, by === 'buyer' ? settings : null)
  const merged = new Map<number, ReturnLine>()
  for (const entry of input.lines) {
    const lineItemId = Number(entry?.lineItemId)
    const quantity = Number(entry?.quantity)
    if (!Number.isInteger(lineItemId) || lineItemId < 0 || lineItemId >= returnable.length) {
      return { problem: 'bad_line', lineItemId: Number.isFinite(lineItemId) ? lineItemId : -1 }
    }
    if (!Number.isInteger(quantity) || quantity <= 0) return { problem: 'bad_line', lineItemId }
    const reason = String(entry?.reason ?? '') as ReturnReason
    if (!RETURN_REASONS.includes(reason)) return { problem: 'bad_reason', lineItemId }
    const prior = merged.get(lineItemId)
    merged.set(lineItemId, { lineItemId, quantity: (prior?.quantity ?? 0) + quantity, reason: prior?.reason ?? reason })
  }
  if (merged.size === 0) return { problem: 'empty' }
  for (const line of merged.values()) {
    const allowed = returnable[line.lineItemId].returnable
    if (line.quantity > allowed) return { problem: 'too_many', lineItemId: line.lineItemId, returnable: allowed }
  }
  return { lines: [...merged.values()].sort((a, b) => a.lineItemId - b.lineItemId) }
}

/** Words for a refused request, for the buyer and the merchant alike. */
export function describeReturnRequestProblem(problem: ReturnRequestProblem): string {
  switch (problem.problem) {
    case 'disabled':
      return 'This store does not take return requests online. Contact the store instead.'
    case 'window_closed':
      return `The return window for this order closed on ${new Date(problem.endedAtMs).toLocaleDateString('en-US')}.`
    case 'order_status':
      return `An order that is ${problem.status.replace('_', ' ')} cannot be returned.`
    case 'empty':
      return 'Choose at least one item to return.'
    case 'bad_line':
      return 'One of the items is not on this order.'
    case 'bad_reason':
      return 'Choose a reason for each item.'
    case 'too_many':
      return problem.returnable === 0
        ? 'One of the items cannot be returned.'
        : `Only ${problem.returnable} of one item can be returned.`
  }
}

/**
 * What refunding a return's units is worth: each line's paid share
 * (`orderLineRefundCents`, discount apportioned) in proportion to the units
 * coming back, never more than is left to refund on the order. Shipping and
 * tax stay out, as they do for a line refund; the merchant may add them by
 * amount.
 */
export function returnRefundCents(
  order: Pick<HostOrder, 'lineItems' | 'totals' | 'refundedCents' | 'amountCents'>,
  lines: ReadonlyArray<Pick<ReturnLine, 'lineItemId' | 'quantity'>>,
): number {
  let cents = 0
  for (const line of lines) {
    const orderLine = order.lineItems?.[line.lineItemId]
    if (!orderLine) continue
    const lineQuantity = Math.max(1, Math.floor(Number(orderLine.quantity) || 1))
    const paid = orderLineRefundCents(order, [line.lineItemId])
    cents += Math.round((paid * Math.min(lineQuantity, line.quantity)) / lineQuantity)
  }
  const total = Number(order.totals?.totalCents ?? order.amountCents ?? 0)
  const left = Math.max(0, total - Math.max(0, Number(order.refundedCents ?? 0)))
  return Math.max(0, Math.min(cents, left))
}

/**
 * The lines a return can refund BY NAME: those it takes back in full, which
 * the refund route then withdraws entitlements for. A partial-quantity line is
 * refunded by amount alone.
 */
export function returnWholeLineIds(
  order: Pick<HostOrder, 'lineItems'>,
  lines: ReadonlyArray<Pick<ReturnLine, 'lineItemId' | 'quantity'>>,
): number[] {
  return lines
    .filter((line) => line.quantity >= Math.floor(Number(order.lineItems?.[line.lineItemId]?.quantity) || 0))
    .map((line) => line.lineItemId)
}

/** A short "2× Mug, 1× Shirt" for a return's lines. */
export function describeReturnLines(
  order: Pick<HostOrder, 'lineItems'>,
  lines: ReadonlyArray<Pick<ReturnLine, 'lineItemId' | 'quantity'>>,
): string {
  return lines.map((line) => `${line.quantity}× ${order.lineItems?.[line.lineItemId]?.name ?? `line ${line.lineItemId}`}`).join(', ')
}

/** The order number a return lists by. */
export function returnOrderNumber(order: Pick<HostOrder, 'number'>, orderId: string): string {
  return formatOrderNumber(order, orderId)
}

/** Appends a return timeline event immutably. */
export function appendReturnEvent(
  entry: Pick<HostReturn, 'timeline'>,
  event: string,
  detail?: string,
  atMs = Date.now(),
): ReturnTimelineEvent[] {
  return [...(entry.timeline ?? []), { atMs, event, ...(detail ? { detail } : {}) }]
}
