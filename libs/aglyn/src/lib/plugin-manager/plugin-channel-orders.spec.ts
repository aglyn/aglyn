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

import { pluginChannelOrders, registerPluginChannelOrders, type PluginChannelOrders } from './plugin-channel-orders'
import { resetPluginServicesForTests } from './plugin-services'

const seller = (): PluginChannelOrders => ({
  importOrder: async (order) => ({
    outcome: 'created',
    recordId: `${order.channel.id}-1`,
    displayRef: '#1',
    lines: order.lines.map((line, lineIndex) => ({ lineIndex, externalLineId: line.externalLineId })),
    shortfalls: [],
    unmatched: [],
  }),
  cancelOrder: async () => ({ outcome: 'already' }),
  recordFees: async () => 'recorded',
})

describe('core.channel-orders (AGL-3638)', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('is empty until a seller registers, then answers that seller', async () => {
    expect(pluginChannelOrders()).toBeNull()
    registerPluginChannelOrders(seller(), { pluginId: 'seller' })
    await expect(
      pluginChannelOrders()?.importOrder({
        hostId: 'h',
        channel: { id: 'market', label: 'Market' },
        externalOrderId: 'A-1',
        externalRef: 'A-1',
        placedAtMs: 1,
        currency: 'USD',
        lines: [{ externalLineId: 'l1', sku: 'S', name: 'Thing', quantity: 1, unitPriceCents: 100 }],
        shippingCents: 0,
        taxCents: 0,
        discountCents: 0,
        totalCents: 100,
        fees: null,
        customerName: null,
        shippingAddress: null,
        testMode: false,
      }),
    ).resolves.toMatchObject({ outcome: 'created', recordId: 'market-1', lines: [{ lineIndex: 0, externalLineId: 'l1' }] })
    await expect(pluginChannelOrders()?.cancelOrder({ hostId: 'h', recordId: 'r', reason: 'x' })).resolves.toEqual({
      outcome: 'already',
    })
  })

  it('passes a courier hand-off and a channel refund through to a seller that records them (AGL-3644)', async () => {
    const seen: unknown[] = []
    registerPluginChannelOrders(
      {
        ...seller(),
        completeOrder: async (request) => (seen.push(request), { outcome: 'completed' }),
        recordRefund: async (request) => (seen.push(request), { outcome: 'recorded', refundedCents: request.amountCents, restockedUnits: 1 }),
      },
      { pluginId: 'seller' },
    )
    const orders = pluginChannelOrders()
    await expect(orders?.completeOrder?.({ hostId: 'h', recordId: 'r', note: 'Picked up' })).resolves.toEqual({ outcome: 'completed' })
    await expect(
      orders?.recordRefund?.({ hostId: 'h', recordId: 'r', refundId: 'adj-1', amountCents: 450, reason: 'Item removed', restock: [{ lineIndex: 0, quantity: 1 }] }),
    ).resolves.toEqual({ outcome: 'recorded', refundedCents: 450, restockedUnits: 1 })
    expect(seen).toHaveLength(2)
  })

  it('leaves both optional: a seller without them still registers', () => {
    registerPluginChannelOrders(seller(), { pluginId: 'seller' })
    expect(pluginChannelOrders()?.completeOrder).toBeUndefined()
    expect(pluginChannelOrders()?.recordRefund).toBeUndefined()
  })

  it('refuses a second seller, naming both', () => {
    registerPluginChannelOrders(seller(), { pluginId: 'one' })
    expect(() => registerPluginChannelOrders(seller(), { pluginId: 'two' })).toThrow(/one.*two/)
  })
})
