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

import type { MarketplaceStore, StoredShipment } from './store'

/**
 * What this plugin hears of the store's orders (AGL-3638), through
 * commerce's order events by the names commerce raises them under; never
 * commerce's types, which are restated here as far as they are read.
 *
 * Both subscribers only QUEUE: no grant is opened and no marketplace is
 * called from an event, because the outbox drains in the tenant, which
 * holds no key to open a grant with. The console job does the calling.
 *
 * - Any sale, cancellation, refund or return received moves stock, so every
 *   marketplace connection of the site is marked due for a listing sync now.
 * - A shipment recorded on an order a marketplace sold is queued on that
 *   order, to confirm back with its tracking.
 */

/** An order as commerce's events carry it, as far as this plugin reads it. */
export interface OrderEventOrder {
  id: string
  channel?: string
}

export interface OrderEventFulfillment {
  id: string
  lines: Array<{ lineItemId: number; quantity: number }>
  carrier: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  at: string
}

export interface OrderEventEnvelope<Payload> {
  id: string
  event: string
  hostId: string
  payload: Payload
}

export interface IntakeDeps {
  store: MarketplaceStore
  now(): number
}

/** A sale, cancellation, refund or received return on any channel: the listings follow the shelf. */
export async function onStockMoved(deps: IntakeDeps, envelope: OrderEventEnvelope<unknown>): Promise<void> {
  if (!envelope?.hostId) return
  await deps.store.markListingsDue(envelope.hostId, deps.now())
}

/** A shipment recorded on an order: queued to confirm when a marketplace sold the order. */
export async function onOrderFulfilled(
  deps: IntakeDeps,
  envelope: OrderEventEnvelope<{ order?: OrderEventOrder; fulfillment?: OrderEventFulfillment }>,
): Promise<'queued' | 'already' | 'ignored'> {
  const order = envelope?.payload?.order
  const fulfillment = envelope?.payload?.fulfillment
  if (!envelope?.hostId || !order?.id || !fulfillment?.id) return 'ignored'
  if (order.channel !== 'marketplace') return 'ignored'
  const found = await deps.store.orderByRecord(envelope.hostId, order.id)
  if (!found || found.order.status !== 'imported') return 'ignored'
  if (found.order.shipments?.[fulfillment.id]) return 'already'
  const atMs = Date.parse(String(fulfillment.at ?? ''))
  const shipment: StoredShipment = {
    lines: (Array.isArray(fulfillment.lines) ? fulfillment.lines : [])
      .map((line) => ({ lineIndex: Math.floor(Number(line?.lineItemId)), quantity: Math.floor(Number(line?.quantity)) }))
      .filter((line) => line.lineIndex >= 0 && line.quantity > 0),
    carrier: typeof fulfillment.carrier === 'string' && fulfillment.carrier.trim() ? fulfillment.carrier.trim() : null,
    trackingNumber:
      typeof fulfillment.trackingNumber === 'string' && fulfillment.trackingNumber.trim() ? fulfillment.trackingNumber.trim() : null,
    trackingUrl: typeof fulfillment.trackingUrl === 'string' && fulfillment.trackingUrl.trim() ? fulfillment.trackingUrl.trim() : null,
    atMs: Number.isFinite(atMs) ? atMs : deps.now(),
    state: 'pending',
    message: null,
    attempts: 0,
  }
  // Only this shipment's key: a merge leaves every other shipment as the job last wrote it.
  await deps.store.patchOrder(found.id, {
    shipments: { [fulfillment.id]: shipment },
    active: true,
    nextRunAtMs: deps.now(),
    updatedAtMs: deps.now(),
  })
  return 'queued'
}
