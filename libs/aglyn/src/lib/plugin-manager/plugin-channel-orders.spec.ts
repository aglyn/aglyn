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

  it('refuses a second seller, naming both', () => {
    registerPluginChannelOrders(seller(), { pluginId: 'one' })
    expect(() => registerPluginChannelOrders(seller(), { pluginId: 'two' })).toThrow(/one.*two/)
  })
})
