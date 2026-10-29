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

import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import type { PluginFulfillmentHold } from '@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers'
import type { OrderEventOrder, OrderEventPayload, OrderRefundedEventPayload } from '@aglyn/plugins-commerce/contracts'
import {
  NETWORK_PROVIDER_IDS,
  NETWORK_PROVIDERS,
  networkOrderId,
  type NetworkOrderLine,
  type NetworkProviderId,
} from '../model/networks'
import { routingHolds } from '../model/routing'
import type { NetworkStore, StoredRouting } from './store'

/**
 * Commerce's order events (AGL-3634). The payload's shape comes from
 * commerce's contracts (AGL-3980).
 *
 * These run where the event outbox is drained — the TENANT — so they only
 * write: a paid order is QUEUED for each network the site sends to
 * automatically, and a canceled or fully refunded one has its hand-offs
 * flagged for cancellation. Nothing here opens a grant or calls a network;
 * the console's job does, on its next tick. Every write is idempotent: the
 * outbox delivers at least once.
 */

/** The public order view's fields this plugin reads. */
export type OrderEventOrderView = Pick<OrderEventOrder, 'id' | 'number' | 'status' | 'shippingAddress' | 'lineItems'>

/** A line's fields this plugin reads: commerce's contract leaves `lineItems` untyped, so they are restated here. */
interface OrderLineFields {
  sku?: unknown
  quantity?: unknown
  name?: unknown
  variantLabel?: unknown
  /** A line typed on a quote, which no stocked product stands behind. */
  custom?: unknown
}

/** An envelope as the outbox hands it over. */
export type OrderEnvelope<Payload extends OrderEventPayload = OrderEventPayload> = Pick<
  PluginDomainEventEnvelope<Payload>,
  'id' | 'hostId' | 'orgId' | 'occurredAtMs' | 'payload'
>

export interface IntakeDeps {
  store: NetworkStore
  now(): number
}

const displayRefOf = (order: OrderEventOrderView): string =>
  typeof order.number === 'number' ? `#${order.number}` : `#${String(order.id).slice(0, 8)}`

/** The order's lines that carry a SKU, as a first guess at what a network will take. */
function estimatedLines(order: OrderEventOrderView, stock: Record<string, number>): NetworkOrderLine[] {
  const items = Array.isArray(order.lineItems) ? (order.lineItems as Array<OrderLineFields | null>) : []
  const known = Object.keys(stock ?? {}).length > 0
  const lines: NetworkOrderLine[] = []
  items.forEach((item, lineIndex) => {
    const sku = String(item?.sku ?? '').trim()
    const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0))
    // A typed line's SKU is the business's own reference, never stock a
    // network holds.
    if (!sku || !quantity || item?.custom === true) return
    // A network that has been counted holds only the SKUs it reported.
    if (known && !(sku in stock)) return
    lines.push({
      lineIndex,
      sku,
      name: [item?.name, item?.variantLabel].filter(Boolean).join(' — ') || 'Item',
      quantity,
      shippedQuantity: 0,
    })
  })
  return lines
}

/** Queues a paid order for every network this site sends to automatically. */
export async function onOrderPaid(deps: IntakeDeps, envelope: OrderEnvelope): Promise<void> {
  const order = envelope.payload?.order
  if (!order?.id || !envelope.hostId) return
  // Nothing ships without somewhere to ship it: an in-person sale, a
  // digital order, a booking.
  if (!order.shippingAddress || typeof order.shippingAddress !== 'object') return
  const nowMs = deps.now()
  for (const { id: connectionId, connection } of await deps.store.connectionsForHost(envelope.hostId)) {
    // A connection waiting to be connected again still queues: the order is
    // sent once it is. A paused one, or one never finished, does not.
    if (!connection.connectedAtMs || connection.status === 'paused' || connection.routing !== 'automatic') continue
    const lines = estimatedLines(order, connection.stock)
    if (!lines.length) continue
    const routing: StoredRouting = {
      orgId: connection.orgId,
      hostId: envelope.hostId,
      recordId: order.id,
      provider: connection.provider,
      connectionId,
      displayRef: displayRefOf(order),
      status: 'queued',
      attempt: 1,
      reference: null,
      providerOrderId: null,
      lines,
      shipments: {},
      note: null,
      cancelRequested: false,
      active: true,
      nextRunAtMs: nowMs,
      leaseUntilMs: 0,
      failures: 0,
      testMode: false,
      lastShippedAtMs: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    }
    // `create`: a redelivered event finds the hand-off already there.
    await deps.store.createRouting(networkOrderId(envelope.hostId, order.id, connection.provider), routing)
  }
}

/** Flags every hand-off of an order that still holds units for cancellation. */
async function requestCancel(deps: IntakeDeps, hostId: string, recordId: string): Promise<void> {
  for (const provider of NETWORK_PROVIDER_IDS) {
    const id = networkOrderId(hostId, recordId, provider)
    const routing = await deps.store.getRouting(id)
    if (!routing || !routingHolds(routing).length || routing.cancelRequested) continue
    await deps.store.patchRouting(id, { cancelRequested: true, active: true, nextRunAtMs: deps.now(), updatedAtMs: deps.now() })
  }
}

export async function onOrderCancelled(deps: IntakeDeps, envelope: OrderEnvelope): Promise<void> {
  const order = envelope.payload?.order
  if (order?.id && envelope.hostId) await requestCancel(deps, envelope.hostId, order.id)
}

export async function onOrderRefunded(
  deps: IntakeDeps,
  envelope: OrderEnvelope<OrderRefundedEventPayload>,
): Promise<void> {
  const order = envelope.payload?.order
  if (!order?.id || !envelope.hostId) return
  const refund = envelope.payload.refund
  if (refund?.full) {
    await requestCancel(deps, envelope.hostId, order.id)
    return
  }
  // A refund of some lines leaves the rest shipping: the merchant decides
  // whether the refunded units should still go, and the order says so.
  const refunded = new Set((refund?.lineItemIds ?? []).map(Number))
  if (!refunded.size) return
  for (const provider of NETWORK_PROVIDER_IDS) {
    const id = networkOrderId(envelope.hostId, order.id, provider)
    const routing = await deps.store.getRouting(id)
    if (!routing) continue
    const stillHeld = routingHolds(routing).filter((hold) => refunded.has(hold.lineIndex))
    if (!stillHeld.length) continue
    await deps.store.patchRouting(id, {
      note: `A refund covered items ${NETWORK_PROVIDERS[provider].label} may still ship. Cancel the order there if they should not go.`,
      updatedAtMs: deps.now(),
    })
  }
}

/** What this plugin's hand-offs hold of one order, for core's `core.fulfillment-providers`. */
export async function holdsFor(
  store: NetworkStore,
  provider: NetworkProviderId,
  hostId: string,
  recordId: string,
): Promise<PluginFulfillmentHold[]> {
  const routing = await store.getRouting(networkOrderId(hostId, recordId, provider))
  if (!routing) return []
  return routingHolds(routing).map((hold) => ({
    providerId: provider,
    providerLabel: NETWORK_PROVIDERS[provider].label,
    lineIndex: hold.lineIndex,
    quantity: hold.quantity,
    state: hold.state,
    ...(routing.reference ? { reference: routing.reference } : {}),
  }))
}
