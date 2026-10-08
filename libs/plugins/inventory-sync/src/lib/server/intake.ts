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
  INVENTORY_PROVIDERS,
  inventoryConnectionId,
  inventoryOrderId,
  type InventoryOrderLine,
} from '../model/inventory-sync'
import { orderReference } from '../providers/ids'
import type { SystemAddress } from '../providers/provider'
import type { InventoryStore, StoredOrder } from './store'

/**
 * Commerce's order events, taken by name (AGL-3642) through core's plugin
 * event seam (AGL-3611). The plugin never imports commerce: each subscriber
 * restates the fields it reads of the public order view the events carry.
 *
 * These run where the event outbox is drained — the TENANT — so they only
 * write: a paid order is QUEUED for the site's connected system, and a
 * canceled or fully refunded one is canceled before it is sent, or flagged
 * for the console's job to cancel there. Nothing here opens a credential or
 * calls a system. Every write is idempotent: the outbox delivers at least
 * once, and a hand-off is created with `create`, so a second delivery finds
 * it there.
 */

/** The public order view's fields this plugin reads. */
export interface OrderEventOrderView {
  id: string
  number: number | null
  status?: string | null
  currency?: string | null
  customerName?: string | null
  customerEmail?: string | null
  shippingAddress?: Record<string, unknown> | null
  lineItems?: unknown
  totals?: {
    itemsCents?: number
    shippingCents?: number
    taxCents?: number
    discountCents?: number
    totalCents?: number | null
  } | null
  created?: string | null
}

export interface OrderEnvelope<Extra = Record<string, never>> {
  id: string
  hostId: string
  orgId: string | null
  occurredAtMs: number
  payload: { order: OrderEventOrderView } & Extra
}

export interface IntakeDeps {
  store: InventoryStore
  now(): number
}

const displayRefOf = (order: OrderEventOrderView): string =>
  typeof order.number === 'number' ? `#${order.number}` : `#${String(order.id).slice(0, 8)}`

const cents = (value: unknown): number => {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) ? parsed : 0
}

const text = (value: unknown): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed.slice(0, 200) : null
}

/** The order's address as the systems take it, or `null` when it has none. */
export function systemAddress(raw: unknown): SystemAddress | null {
  if (!raw || typeof raw !== 'object') return null
  const address = raw as Record<string, unknown>
  const shaped: SystemAddress = {
    name: text(address['name']),
    line1: text(address['line1']),
    line2: text(address['line2']),
    city: text(address['city']),
    state: text(address['state']),
    postalCode: text(address['postalCode']),
    country: text(address['country'])?.toUpperCase() ?? null,
    phone: text(address['phone']),
  }
  return shaped.line1 || shaped.city || shaped.postalCode ? shaped : null
}

/** The order's lines that carry a SKU, and the names of those that do not. */
export function orderLines(order: OrderEventOrderView): { lines: InventoryOrderLine[]; skipped: string[] } {
  const items = Array.isArray(order.lineItems) ? (order.lineItems as Array<Record<string, unknown>>) : []
  const lines: InventoryOrderLine[] = []
  const skipped: string[] = []
  items.forEach((item, lineIndex) => {
    const quantity = Math.max(0, Math.floor(Number(item?.['quantity']) || 0))
    if (!quantity) return
    const name = [item?.['name'], item?.['variantLabel']].filter(Boolean).join(' — ') || 'Item'
    const sku = String(item?.['sku'] ?? '').trim()
    if (!sku) {
      skipped.push(name)
      return
    }
    lines.push({ lineIndex, sku, name: name.slice(0, 200), quantity, unitAmountCents: Math.max(0, cents(item?.['unitAmountCents'])) })
  })
  return { lines, skipped }
}

/** Queues a paid order for the site's connected system. */
export async function onOrderPaid(deps: IntakeDeps, envelope: OrderEnvelope): Promise<void> {
  const order = envelope.payload?.order
  if (!order?.id || !envelope.hostId) return
  const connectionId = inventoryConnectionId(envelope.hostId)
  const connection = await deps.store.getConnection(connectionId)
  // A connection waiting to be connected again still queues: the order is
  // sent once it is. A paused one, one never finished, or one not sending
  // orders does not.
  if (!connection?.connectedAtMs || connection.status === 'paused' || connection.sendOrders !== true) return
  const nowMs = deps.now()
  const { lines, skipped } = orderLines(order)
  const label = INVENTORY_PROVIDERS[connection.provider].label
  const totals = order.totals ?? {}
  const orderedAtMs = Date.parse(String(order.created ?? '')) || envelope.occurredAtMs || nowMs
  const handOff: StoredOrder = {
    orgId: connection.orgId,
    hostId: envelope.hostId,
    recordId: order.id,
    provider: connection.provider,
    connectionId,
    displayRef: displayRefOf(order),
    reference: orderReference(envelope.hostId, order.id, typeof order.number === 'number' ? order.number : null),
    status: lines.length ? 'queued' : 'skipped',
    lines,
    skippedLines: skipped,
    snapshot: {
      orderedAtMs,
      currency: String(order.currency ?? 'usd').toUpperCase(),
      buyerName: text(order.customerName),
      buyerEmail: text(order.customerEmail),
      shippingAddress: systemAddress(order.shippingAddress),
      shippingCents: Math.max(0, cents(totals.shippingCents)),
      discountCents: Math.max(0, cents(totals.discountCents)),
      taxCents: Math.max(0, cents(totals.taxCents)),
      totalCents: Math.max(0, cents(totals.totalCents)),
    },
    externalId: null,
    externalNumber: null,
    note: lines.length
      ? skipped.length
        ? `Not sent to ${label}, having no SKU: ${skipped.join(', ')}.`
        : null
      : `Not sent: no item on the order has a SKU for ${label} to match.`,
    cancelRequested: false,
    active: lines.length > 0,
    nextRunAtMs: nowMs,
    leaseUntilMs: 0,
    attempts: 0,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
  await deps.store.createOrder(inventoryOrderId(envelope.hostId, order.id), handOff)
}

/** Cancels an order's hand-off: here when it was never sent, in the system on the next run when it was. */
async function requestCancel(deps: IntakeDeps, hostId: string, recordId: string, why: string): Promise<void> {
  const id = inventoryOrderId(hostId, recordId)
  const handOff = await deps.store.getOrder(id)
  if (!handOff || handOff.cancelRequested || handOff.status === 'canceled' || handOff.status === 'skipped') return
  const nowMs = deps.now()
  if (handOff.status === 'queued' || handOff.status === 'failed') {
    // Nothing reached the system unless an attempt that timed out did; the
    // job looks it up by its reference before it gives up on it.
    await deps.store.patchOrder(id, {
      cancelRequested: true,
      active: true,
      nextRunAtMs: nowMs,
      note: why,
      updatedAtMs: nowMs,
    })
    return
  }
  await deps.store.patchOrder(id, { cancelRequested: true, active: true, nextRunAtMs: nowMs, updatedAtMs: nowMs })
}

export async function onOrderCancelled(deps: IntakeDeps, envelope: OrderEnvelope): Promise<void> {
  const order = envelope.payload?.order
  if (order?.id && envelope.hostId) await requestCancel(deps, envelope.hostId, order.id, 'The order was canceled.')
}

export async function onOrderRefunded(
  deps: IntakeDeps,
  envelope: OrderEnvelope<{ refund?: { full?: boolean; lineItemIds?: number[] } }>,
): Promise<void> {
  const order = envelope.payload?.order
  if (!order?.id || !envelope.hostId) return
  const refund = envelope.payload.refund
  if (refund?.full) {
    await requestCancel(deps, envelope.hostId, order.id, 'The order was refunded in full.')
    return
  }
  // A refund of some lines leaves the rest standing: the merchant decides
  // what changes in the system, and the hand-off says so.
  const id = inventoryOrderId(envelope.hostId, order.id)
  const handOff = await deps.store.getOrder(id)
  if (!handOff || handOff.status !== 'sent') return
  await deps.store.patchOrder(id, {
    note: `A partial refund was given after the order reached ${INVENTORY_PROVIDERS[handOff.provider].label}. Change the order there if it should not ship in full.`,
    updatedAtMs: deps.now(),
  })
}
