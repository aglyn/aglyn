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
  heldQuantitiesByLine,
  listPluginFulfillmentProviders,
  pluginFulfillmentHolds,
  registerPluginFulfillmentProvider,
  type PluginFulfillmentHold,
} from './plugin-fulfillment-providers'
import { resetPluginServicesForTests } from './plugin-services'
import { pluginStockLevels, registerPluginStockLevels } from './plugin-stock-levels'

const hold = (overrides: Partial<PluginFulfillmentHold> = {}): PluginFulfillmentHold => ({
  providerId: 'network',
  providerLabel: 'Network',
  lineIndex: 0,
  quantity: 1,
  state: 'accepted',
  ...overrides,
})

describe('core.fulfillment-providers (AGL-3634)', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('asks every provider and sums what each holds per line', async () => {
    registerPluginFulfillmentProvider(
      { id: 'network', label: 'Network', holds: async () => [hold({ lineIndex: 0, quantity: 2 })] },
      { pluginId: 'networks' },
    )
    registerPluginFulfillmentProvider(
      {
        id: 'printer',
        label: 'Printer',
        holds: async () => [hold({ providerId: 'printer', lineIndex: 0, quantity: 1 }), hold({ providerId: 'printer', lineIndex: 2 })],
      },
      { pluginId: 'print' },
    )
    const { holds, unanswered } = await pluginFulfillmentHolds('host-1', 'record-1')
    expect(unanswered).toEqual([])
    expect([...heldQuantitiesByLine(holds)]).toEqual(expect.arrayContaining([[0, 3], [2, 1]]))
    expect(listPluginFulfillmentProviders().map((entry) => entry.id).sort()).toEqual(['network', 'printer'])
  })

  it('leaves out the asking plugin’s own providers', async () => {
    registerPluginFulfillmentProvider(
      { id: 'a', label: 'A', holds: async () => [hold({ providerId: 'a' })] },
      { pluginId: 'one' },
    )
    registerPluginFulfillmentProvider(
      { id: 'b', label: 'B', holds: async () => [hold({ providerId: 'b' })] },
      { pluginId: 'two' },
    )
    const { holds } = await pluginFulfillmentHolds('h', 'r', { exceptPluginId: 'one' })
    expect(holds.map((entry) => entry.providerId)).toEqual(['b'])
  })

  it('names a provider that throws instead of reading it as holding nothing', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginFulfillmentProvider(
      {
        id: 'down',
        label: 'Down',
        holds: async () => {
          throw new Error('offline')
        },
      },
      { pluginId: 'down-plugin' },
    )
    registerPluginFulfillmentProvider(
      { id: 'up', label: 'Up', holds: async () => [hold({ providerId: 'up' })] },
      { pluginId: 'up-plugin' },
    )
    const result = await pluginFulfillmentHolds('h', 'r')
    expect(result.unanswered).toEqual([{ providerId: 'down', providerLabel: 'Down' }])
    expect(result.holds).toHaveLength(1)
  })

  it('drops a hold of no units or of no line', async () => {
    registerPluginFulfillmentProvider(
      {
        id: 'p',
        label: 'P',
        holds: async () => [hold({ quantity: 0 }), hold({ lineIndex: -1 }), hold({ quantity: 2.7 })],
      },
      { pluginId: 'p' },
    )
    const { holds } = await pluginFulfillmentHolds('h', 'r')
    expect(holds).toEqual([expect.objectContaining({ quantity: 2, lineIndex: 0 })])
  })

  it('lets one plugin register several providers, and the same id again replaces it', async () => {
    const plugin = { pluginId: 'networks' }
    registerPluginFulfillmentProvider({ id: 'a', label: 'A', holds: async () => [] }, plugin)
    registerPluginFulfillmentProvider({ id: 'b', label: 'B', holds: async () => [] }, plugin)
    registerPluginFulfillmentProvider({ id: 'a', label: 'A again', holds: async () => [] }, plugin)
    expect(listPluginFulfillmentProviders().map((entry) => entry.label).sort()).toEqual(['A again', 'B'])
  })

  it('refuses a provider with no id', () => {
    expect(() =>
      registerPluginFulfillmentProvider({ id: ' ', label: 'X', holds: async () => [] }, { pluginId: 'x' }),
    ).toThrow(/needs an id/)
  })
})

describe('core.stock-levels (AGL-3634)', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('is empty until a seller registers, then answers that seller', async () => {
    expect(pluginStockLevels()).toBeNull()
    registerPluginStockLevels(
      { setAvailable: async (request) => request.levels.map((level) => ({ sku: level.sku, outcome: 'updated' as const })) },
      { pluginId: 'seller' },
    )
    await expect(
      pluginStockLevels()?.setAvailable({ hostId: 'h', source: 'Warehouse', levels: [{ sku: 'A', quantity: 1 }] }),
    ).resolves.toEqual([{ sku: 'A', outcome: 'updated' }])
  })

  it('refuses a second seller, naming both', () => {
    registerPluginStockLevels({ setAvailable: async () => [] }, { pluginId: 'one' })
    expect(() => registerPluginStockLevels({ setAvailable: async () => [] }, { pluginId: 'two' })).toThrow(/one.*two/)
  })
})
