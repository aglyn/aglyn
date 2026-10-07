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
import type { MarketingEvent, MarketingEventItem, MarketingEventName } from '../providers/provider'
import type { ConnectionStore } from './store'

/**
 * COMMERCE'S EVENTS, OWED TO A SITE'S CONNECTIONS (AGL-3639).
 *
 * The subscriber half: it holds no credential and calls no provider. Each
 * order event commerce raises through core's domain-event outbox (AGL-3611)
 * is turned into the plugin's own {@link MarketingEvent} and written once per
 * active connection on the site that takes events; the console job delivers
 * them. It reads only the payload's public order view — never commerce's
 * code — so the shapes below are the outbox's words, read defensively.
 *
 * The event id is the outbox envelope's, so a redelivered envelope is the
 * same owed event (the store's create is the dedupe) and the same event at
 * the provider (its unique id).
 */

/** The domain events this plugin takes, and what each is called in its own words. */
export const MARKETING_SUBSCRIBED_EVENTS: Readonly<Record<string, MarketingEventName>> = {
  'checkout.started': 'checkout.started',
  'order.paid': 'order.paid',
  'order.fulfilled': 'order.fulfilled',
  'order.refunded': 'order.refunded',
  'order.cancelled': 'order.cancelled',
}

const cents = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : 0
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function items(lines: unknown, unitKey: 'unitAmountCents' | 'unitCents'): MarketingEventItem[] {
  if (!Array.isArray(lines)) return []
  return lines.slice(0, 100).flatMap((line: any) => {
    const quantity = Math.max(0, Math.floor(Number(line?.quantity ?? 0)))
    if (!quantity) return []
    return [
      {
        productId: text(line?.productId),
        variantId: text(line?.variantId),
        name: text(line?.name) ?? 'Item',
        sku: text(line?.sku),
        quantity,
        unitCents: cents(line?.[unitKey]),
      },
    ]
  })
}

/**
 * One envelope in the plugin's words, or `null` for one it does not take: an
 * event it does not subscribe to, or one with no address to attach it to.
 */
export function marketingEventFromEnvelope(envelope: PluginDomainEventEnvelope<unknown>): MarketingEvent | null {
  const name = MARKETING_SUBSCRIBED_EVENTS[envelope.event]
  if (!name) return null
  const payload = (envelope.payload ?? {}) as Record<string, any>

  if (name === 'checkout.started') {
    const checkout = (payload['checkout'] ?? {}) as Record<string, any>
    const email = String(checkout['email'] ?? '').trim().toLowerCase()
    if (!EMAIL.test(email)) return null
    return {
      id: envelope.id,
      name,
      email,
      occurredAtMs: envelope.occurredAtMs,
      currency: (text(checkout['currency']) ?? 'usd').toUpperCase(),
      valueCents: cents(checkout['itemsCents']),
      orderId: null,
      orderNumber: null,
      checkoutUrl: text(checkout['resumeUrl']),
      items: items(checkout['items'], 'unitCents'),
      tracking: null,
    }
  }

  const order = (payload['order'] ?? {}) as Record<string, any>
  const email = String(order['customerEmail'] ?? '').trim().toLowerCase()
  if (!EMAIL.test(email)) return null
  const totals = (order['totals'] ?? {}) as Record<string, unknown>
  const refund = payload['refund'] as Record<string, unknown> | undefined
  const fulfillment = payload['fulfillment'] as Record<string, unknown> | undefined
  const valueCents =
    name === 'order.refunded' ? cents(refund?.['amountCents']) : cents(totals['totalCents'] ?? totals['itemsCents'])
  return {
    id: envelope.id,
    name,
    email,
    occurredAtMs: envelope.occurredAtMs,
    currency: (text(order['currency']) ?? 'usd').toUpperCase(),
    valueCents,
    orderId: text(order['id']),
    orderNumber: typeof order['number'] === 'number' ? `#${order['number']}` : null,
    checkoutUrl: null,
    items: items(order['lineItems'], 'unitAmountCents'),
    tracking: fulfillment
      ? {
          carrier: text(fulfillment['carrier']),
          number: text(fulfillment['trackingNumber']),
          url: text(fulfillment['trackingUrl']),
        }
      : null,
  }
}

export interface IntakeDeps {
  store: Pick<ConnectionStore, 'eventConnectionsForHost' | 'enqueueEvent'>
  /** The org a site belongs to, or `null` for a site that has none. */
  orgOf(hostId: string): Promise<string | null>
  now(): number
}

/**
 * Owes one envelope's event to every active connection on its site that
 * takes events. A failure throws, so the outbox retries the envelope; the
 * store's create makes the retry owe nothing twice.
 *
 * @returns how many connections it was owed to.
 */
export async function intakeMarketingEvent(
  deps: IntakeDeps,
  envelope: PluginDomainEventEnvelope<unknown>,
): Promise<number> {
  const event = marketingEventFromEnvelope(envelope)
  if (!event || !envelope.hostId) return 0
  const connections = await deps.store.eventConnectionsForHost(envelope.hostId)
  if (!connections.length) return 0
  const orgId = envelope.orgId || (await deps.orgOf(envelope.hostId))
  if (!orgId) return 0
  for (const connectionId of connections) {
    await deps.store.enqueueEvent(connectionId, { orgId, hostId: envelope.hostId }, event, deps.now())
  }
  return connections.length
}
