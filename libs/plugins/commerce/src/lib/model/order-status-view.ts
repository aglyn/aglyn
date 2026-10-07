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
import { fulfillmentIsActive, fulfillmentLineQuantities } from './order-fulfillment'
import { carrierLabelFor, fulfillmentTrackingUrl } from './tracking-url'

/**
 * What the guest order-status page shows (AGL-3610): the ONE projection of an
 * order that leaves the server for a visitor holding a signed link.
 *
 * Allow-listed, never spread: an order document carries the buyer's email,
 * phone and addresses, Stripe ids, risk signals and the merchant's notes, and
 * a forwarded link must disclose no more than the email it arrived in. Every
 * field below is one the buyer's own receipt or shipping email already
 * states. New fields are added here deliberately, or not at all.
 */
export interface OrderStatusLine {
  name: string
  variantLabel: string | null
  quantity: number
  amountCents: number
  /** Units of this line in an active shipment. */
  shippedQuantity: number
  refunded: boolean
}

export interface OrderStatusShipment {
  id: string
  atMs: number
  carrier: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  lines: Array<{ name: string; quantity: number }>
}

export interface OrderStatusStep {
  key: 'placed' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
  label: string
  atMs: number | null
  done: boolean
}

/**
 * Something the buyer can do from the page — "Request a return" is the case
 * the order-processing lane (AGL-3611) adds through
 * `registerOrderStatusActions` on the server. The page renders each as a
 * button to `url`; it knows nothing of what the action is.
 */
export interface OrderStatusAction {
  id: string
  label: string
  url: string
}

export interface OrderStatusView {
  storeName: string
  number: string
  status: OrderStatus
  /** The status as a buyer reads it. */
  statusLabel: string
  createdAtMs: number | null
  currency: string
  lines: OrderStatusLine[]
  totals: {
    itemsCents: number
    shippingCents: number
    taxCents: number
    discountCents: number
    totalCents: number
    refundedCents: number
  }
  /**
   * Optional lines the buyer took at checkout (AGL-3635) — "Package
   * protection" — by the name and price their receipt states. Optional so
   * an answer from before this field reads as none.
   */
  extras?: Array<{ label: string; amountCents: number }>
  shipments: OrderStatusShipment[]
  steps: OrderStatusStep[]
  actions: OrderStatusAction[]
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Awaiting payment',
  paid: 'Confirmed',
  partially_fulfilled: 'Partly shipped',
  fulfilled: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Canceled',
  refunded: 'Refunded',
}

function eventAt(order: HostOrder, ...events: string[]): number | null {
  const found = (order.timeline ?? []).find((entry) =>
    events.includes(String(entry?.event ?? '')),
  )
  return found ? Number(found.atMs) || null : null
}

/** Builds the public projection. Pure; the caller has verified the link. */
export function buildOrderStatusView(input: {
  order: HostOrder
  orderId: string
  storeName: string
  currency?: string
  number: string
  actions?: OrderStatusAction[]
}): OrderStatusView {
  const { order } = input
  const lineItems = order.lineItems ?? []
  const active = (order.fulfillments ?? []).filter(fulfillmentIsActive)
  const shippedByLine = new Map<number, number>()
  const shipments: OrderStatusShipment[] = active
    .map((fulfillment) => {
      const quantities = fulfillmentLineQuantities(order, fulfillment)
      for (const entry of quantities) {
        shippedByLine.set(
          entry.lineItemId,
          (shippedByLine.get(entry.lineItemId) ?? 0) + entry.quantity,
        )
      }
      return {
        id: String(fulfillment.id ?? ''),
        atMs: Number(fulfillment.atMs) || 0,
        carrier: fulfillment.carrier ? carrierLabelFor(fulfillment.carrier) : null,
        trackingNumber: fulfillment.trackingNumber ?? null,
        trackingUrl: fulfillmentTrackingUrl(fulfillment),
        lines: quantities.map((entry) => ({
          name: String(lineItems[entry.lineItemId]?.name ?? 'Item'),
          quantity: entry.quantity,
        })),
      }
    })
    .sort((a, b) => a.atMs - b.atMs)
  const refundedLines = new Set(order.refundedLineItemIds ?? [])
  const lines: OrderStatusLine[] = lineItems.map((line, index) => ({
    name: String(line.name ?? 'Item'),
    variantLabel: line.variantLabel ?? null,
    quantity: Number(line.quantity) || 0,
    amountCents: (Number(line.unitAmountCents) || 0) * (Number(line.quantity) || 0),
    shippedQuantity: Math.min(Number(line.quantity) || 0, shippedByLine.get(index) ?? 0),
    refunded: refundedLines.has(index),
  }))
  const totals = order.totals
  const totalCents = totals?.totalCents ?? Number(order.amountCents ?? 0)
  const status = order.status
  const createdAtMs = Number(order.createdAtMs) || null
  const paidAtMs = eventAt(order, 'paid') ?? (status !== 'pending' ? createdAtMs : null)
  const firstShipAt = shipments[0]?.atMs ?? eventAt(order, 'fulfilled', 'partially_fulfilled')
  const deliveredAt = eventAt(order, 'delivered')
  const steps: OrderStatusStep[] = [
    { key: 'placed', label: 'Order placed', atMs: createdAtMs, done: true },
    {
      key: 'paid',
      label: 'Payment confirmed',
      atMs: paidAtMs,
      done: status !== 'pending' && paidAtMs !== null,
    },
  ]
  if (status === 'cancelled') {
    steps.push({ key: 'cancelled', label: 'Canceled', atMs: eventAt(order, 'cancelled'), done: true })
  } else {
    steps.push(
      {
        key: 'shipped',
        label: status === 'partially_fulfilled' ? 'Partly shipped' : 'Shipped',
        atMs: firstShipAt,
        done: ['partially_fulfilled', 'fulfilled', 'delivered'].includes(status) ||
          shipments.length > 0,
      },
      {
        key: 'delivered',
        label: 'Delivered',
        atMs: deliveredAt,
        done: status === 'delivered' || deliveredAt !== null,
      },
    )
  }
  if (status === 'refunded') {
    steps.push({ key: 'refunded', label: 'Refunded', atMs: eventAt(order, 'refund'), done: true })
  }
  return {
    storeName: input.storeName,
    number: input.number,
    status,
    statusLabel: STATUS_LABELS[status] ?? 'Confirmed',
    createdAtMs,
    currency: input.currency || 'USD',
    lines,
    totals: {
      itemsCents: totals?.itemsCents ?? lines.reduce((sum, line) => sum + line.amountCents, 0),
      shippingCents: totals?.shippingCents ?? 0,
      taxCents: totals?.taxCents ?? 0,
      discountCents: totals?.discountCents ?? 0,
      totalCents,
      refundedCents: Number(order.refundedCents ?? 0) || 0,
    },
    extras: (order.extras ?? [])
      .filter((extra) => extra && Number(extra.amountCents) > 0)
      .map((extra) => ({ label: String(extra.label || 'Extra'), amountCents: Number(extra.amountCents) })),
    shipments,
    steps,
    actions: input.actions ?? [],
  }
}
