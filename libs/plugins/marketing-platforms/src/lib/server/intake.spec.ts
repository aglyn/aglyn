/**
 * @jest-environment node
 */
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
import type { OrderEventFulfillment, OrderEventOrder } from '@aglyn/plugins-commerce/contracts'
import { MARKETING_PLATFORMS_SUBSCRIBED_EVENTS } from '../declarations.server'
import { createMemoryStore } from '../testing/memory-store'
import { intakeMarketingEvent, MARKETING_SUBSCRIBED_EVENTS, marketingEventFromEnvelope, type MarketingEnvelopePayload } from './intake'
import { emptyConnection } from './store'

const HOST = 'host-1'
const order: OrderEventOrder = {
  id: 'o1',
  object: 'order',
  number: 1042,
  status: 'paid',
  channel: 'online',
  currency: 'usd',
  customerEmail: 'Pat@Example.com',
  customerName: 'Pat Lee',
  lineItems: [{ productId: 'p1', variantId: 'v1', name: 'Mug', sku: 'MUG', quantity: 2, unitAmountCents: 1500 }],
  totals: { itemsCents: 3000, shippingCents: 400, taxCents: 0, discountCents: 0, totalCents: 3400, feeCents: 0 },
  refundedCents: 0,
  taxMode: null,
}
const envelope = (event: string, payload: MarketingEnvelopePayload): PluginDomainEventEnvelope<MarketingEnvelopePayload> => ({
  id: `env-${event}`,
  event,
  hostId: HOST,
  orgId: 'org-1',
  occurredAtMs: 1000,
  attempt: 1,
  payload,
})

describe('commerce’s events, in the plugin’s words', () => {
  it('subscribes to the same events the intake takes', () => {
    expect(MARKETING_PLATFORMS_SUBSCRIBED_EVENTS.map((event) => event.id)).toEqual(Object.keys(MARKETING_SUBSCRIBED_EVENTS))
  })

  it('reads a paid order: its total, currency, number and lines, the address normalized', () => {
    expect(marketingEventFromEnvelope(envelope('order.paid', { order }))).toEqual({
      id: 'env-order.paid',
      name: 'order.paid',
      email: 'pat@example.com',
      occurredAtMs: 1000,
      currency: 'USD',
      valueCents: 3400,
      orderId: 'o1',
      orderNumber: '#1042',
      checkoutUrl: null,
      items: [{ productId: 'p1', variantId: 'v1', name: 'Mug', sku: 'MUG', quantity: 2, unitCents: 1500 }],
      tracking: null,
    })
  })

  it('values a refund at what THAT refund moved, and carries a shipment’s tracking', () => {
    const refund = { id: 're_1', amountCents: 500, lineItemIds: [], full: false }
    expect(marketingEventFromEnvelope(envelope('order.refunded', { order, refund }))?.valueCents).toBe(500)
    const fulfillment: OrderEventFulfillment = {
      id: 'f1',
      lines: [{ lineItemId: 0, quantity: 2 }],
      carrier: 'UPS',
      trackingNumber: '1Z',
      trackingUrl: 'https://t.test/1Z',
      labelUrl: null,
      labelCostCents: null,
      at: '2026-10-07T12:00:00.000Z',
    }
    expect(marketingEventFromEnvelope(envelope('order.fulfilled', { order, fulfillment }))?.tracking).toEqual({
      carrier: 'UPS',
      number: '1Z',
      url: 'https://t.test/1Z',
    })
  })

  it('reads a started checkout with its link back', () => {
    const checkout = {
      id: 'cs_1',
      email: 'shopper@example.com',
      marketingOptIn: true,
      currency: 'usd',
      itemsCents: 2500,
      resumeUrl: 'https://shop.test/cart',
      items: [{ productId: 'p1', variantId: null, name: 'Tee', sku: null, quantity: 1, unitCents: 2500 }],
    }
    expect(marketingEventFromEnvelope(envelope('checkout.started', { checkout }))).toMatchObject({
      name: 'checkout.started',
      email: 'shopper@example.com',
      valueCents: 2500,
      checkoutUrl: 'https://shop.test/cart',
      orderId: null,
    })
  })

  it('takes nothing it does not subscribe to, nor an order with no address', () => {
    expect(marketingEventFromEnvelope(envelope('return.requested', { order }))).toBeNull()
    expect(marketingEventFromEnvelope(envelope('order.paid', { order: { ...order, customerEmail: null } }))).toBeNull()
  })
})

describe('owing an event to a site’s connections', () => {
  it('owes it once to each connection that takes events, however often the envelope comes', async () => {
    const memory = createMemoryStore()
    const base = { orgId: 'org-1', hostId: HOST, nowMs: 0 }
    memory.connections.set(`${HOST}_klaviyo`, emptyConnection({ ...base, provider: 'klaviyo' }))
    memory.connections.set(`${HOST}_omnisend`, { ...emptyConnection({ ...base, provider: 'omnisend' }), syncEvents: false })
    memory.connections.set(`${HOST}_mailchimp`, emptyConnection({ ...base, provider: 'mailchimp' }))
    const deps = { store: memory.store, orgOf: async () => 'org-1', now: () => 5 }
    expect(await intakeMarketingEvent(deps, envelope('order.paid', { order }))).toBe(1)
    expect(await intakeMarketingEvent(deps, envelope('order.paid', { order }))).toBe(1)
    expect([...memory.events.keys()]).toEqual([`${HOST}_klaviyo_env-order.paid`])
    expect([...memory.events.values()][0]).toMatchObject({ orgId: 'org-1', hostId: HOST, status: 'pending' })
  })
})
