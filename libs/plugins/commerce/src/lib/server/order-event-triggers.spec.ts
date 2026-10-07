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
  deliverPluginDomainEvent,
  listPluginDomainEvents,
  listPluginDomainEventSubscribers,
  resetPluginDomainEventsForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hostEventPayloadFor, registerCommerceEventTriggers } from './order-event-triggers'

/** Commerce's order and return events, as workflow triggers (AGL-3611). */

const mockEmit = jest.fn(async () => ({ alerts: [] }))
jest.mock('@aglyn/tenant-runtime', () => ({ emitHostEvent: (...args: unknown[]) => mockEmit(...(args as [])) }))

const order = {
  id: 'o1',
  object: 'order',
  number: 1042,
  status: 'partially_fulfilled',
  channel: 'online',
  currency: 'usd',
  customerEmail: 'ada@example.com',
  customerName: 'Ada',
  totals: { totalCents: 4200 },
}

beforeEach(() => {
  resetPluginDomainEventsForTests()
  mockEmit.mockClear()
})

it('declares every event and subscribes one named bridge to each', () => {
  registerCommerceEventTriggers()
  expect(listPluginDomainEvents().map((entry) => entry.event)).toEqual([
    'order.cancelled',
    'order.delivered',
    'order.fulfilled',
    'order.paid',
    'order.refunded',
    'return.refunded',
    'return.requested',
  ])
  expect(listPluginDomainEventSubscribers('order.paid')).toEqual(['commerce:workflow-triggers'])
})

it('raises the host event its declaration names, with a flat scope', async () => {
  registerCommerceEventTriggers()
  await deliverPluginDomainEvent({
    id: 'e1',
    event: 'order.fulfilled',
    hostId: 'h1',
    orgId: null,
    occurredAtMs: 1,
    payload: { order, fulfillment: { id: 'f1', carrier: 'UPS', trackingNumber: '1Z', trackingUrl: null } },
  })
  expect(mockEmit).toHaveBeenCalledWith(
    'h1',
    'orderFulfilled',
    {
      orderId: 'o1',
      orderNumber: '#1042',
      status: 'partially_fulfilled',
      channel: 'online',
      email: 'ada@example.com',
      name: 'Ada',
      totalCents: 4200,
      currency: 'usd',
      fulfillmentId: 'f1',
      carrier: 'UPS',
      trackingNumber: '1Z',
    },
    { actor: { kind: 'platform' } },
  )
})

it('flattens a refund and a return', () => {
  expect(
    hostEventPayloadFor({ event: 'order.refunded', payload: { order, refund: { amountCents: 500, full: false } } }),
  ).toMatchObject({ refundCents: 500, fullRefund: false })
  expect(
    hostEventPayloadFor({ event: 'return.requested', payload: { order, return: { id: 'r1', status: 'requested', refundCents: null } } }),
  ).toMatchObject({ returnId: 'r1', returnStatus: 'requested' })
})

it('every host event it raises is declared in plugins.config.json', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '../../../../../../plugins.config.json'), 'utf8'))
  const commerce = config.plugins.find((entry: { id: string }) => entry.id === 'commerce')
  const declared = new Set((commerce.hostEvents ?? []).map((entry: { type: string }) => entry.type))
  for (const type of ['orderPaid', 'orderFulfilled', 'orderDelivered', 'orderRefunded', 'orderCancelled', 'returnRequested', 'returnRefunded']) {
    expect(declared.has(type)).toBe(true)
  }
})
