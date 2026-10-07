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

import { resetPluginServicesForTests } from './plugin-services'
import {
  pluginShippingRateQuoter,
  quotePluginShippingRates,
  registerPluginShippingRateQuoter,
  type PluginShippingRateQuoter,
} from './plugin-shipping-rates'
import {
  announcePluginShipment,
  pluginShipmentRecords,
  registerPluginShipmentListener,
  registerPluginShipmentRecords,
  type PluginShipmentRecords,
} from './plugin-shipment-records'

/** A courier plugin and a rentals plugin: no catalog anywhere in the seam. */
const REQUEST = {
  hostId: 'host-1',
  to: { country: 'US', postalCode: '94103' },
  parcels: [{ weightGrams: 900 }],
  currency: 'usd',
  valueCents: 4_000,
}

function courier(overrides: Partial<PluginShippingRateQuoter> = {}): PluginShippingRateQuoter {
  return {
    available: async () => true,
    quote: async () => [
      {
        serviceKey: 'post:ground',
        carrier: 'Post',
        service: 'ground',
        label: 'Post Ground',
        amountCents: 725,
        currency: 'usd',
        estimatedDays: 4,
      },
    ],
    listServices: async () => [],
    ...overrides,
  }
}

beforeEach(() => {
  resetPluginServicesForTests()
  jest.useRealTimers()
})

describe('carrier rates, asked of whoever quotes them', () => {
  it('answers null with nobody registered, so the seller keeps its own rates', async () => {
    expect(pluginShippingRateQuoter()).toBeNull()
    await expect(quotePluginShippingRates(REQUEST, { timeoutMs: 50 })).resolves.toBeNull()
  })

  it('returns the quoter’s rates', async () => {
    registerPluginShippingRateQuoter(courier(), { pluginId: 'courier' })
    const quotes = await quotePluginShippingRates(REQUEST, { timeoutMs: 1_000 })
    expect(quotes?.[0]).toMatchObject({ serviceKey: 'post:ground', amountCents: 725 })
  })

  it('answers null for a site the quoter is not available on', async () => {
    const quote = jest.fn()
    registerPluginShippingRateQuoter(courier({ available: async () => false, quote }), {
      pluginId: 'courier',
    })
    await expect(quotePluginShippingRates(REQUEST, { timeoutMs: 1_000 })).resolves.toBeNull()
    expect(quote).not.toHaveBeenCalled()
  })

  it('answers null when the provider throws', async () => {
    registerPluginShippingRateQuoter(
      courier({
        quote: async () => {
          throw new Error('503')
        },
      }),
      { pluginId: 'courier' },
    )
    await expect(quotePluginShippingRates(REQUEST, { timeoutMs: 1_000 })).resolves.toBeNull()
  })

  it('gives up at the deadline and aborts the quoter’s signal', async () => {
    let aborted = false
    registerPluginShippingRateQuoter(
      courier({
        quote: (request) =>
          new Promise((resolve) => {
            request.signal?.addEventListener('abort', () => {
              aborted = true
              resolve([])
            })
          }),
      }),
      { pluginId: 'courier' },
    )
    const started = Date.now()
    await expect(quotePluginShippingRates(REQUEST, { timeoutMs: 30 })).resolves.toBeNull()
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(aborted).toBe(true)
  })

  it('is a slot: a second quoter is refused naming both', () => {
    registerPluginShippingRateQuoter(courier(), { pluginId: 'courier' })
    expect(() => registerPluginShippingRateQuoter(courier(), { pluginId: 'other' })).toThrow(
      /already registered by "courier"/,
    )
  })
})

describe('shipment records, kept by the seller', () => {
  const RENTALS: PluginShipmentRecords = {
    read: async () => null,
    recordShipment: async () => ({ outcome: 'recorded', shipmentId: 's1' }),
    recordTracking: async () => ({ outcome: 'recorded' }),
    shipFromAddresses: async () => [],
  }

  it('resolves the seller, or null', () => {
    expect(pluginShipmentRecords()).toBeNull()
    registerPluginShipmentRecords(RENTALS, { pluginId: 'rentals' })
    expect(pluginShipmentRecords()).toBe(RENTALS)
  })

  it('announces a shipment to every listener, isolating one that throws', async () => {
    const heard: string[] = []
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginShipmentListener(
      () => {
        throw new Error('boom')
      },
      { pluginId: 'first' },
    )
    registerPluginShipmentListener((event) => void heard.push(event.shipmentId), {
      pluginId: 'second',
    })
    await announcePluginShipment({ hostId: 'h', recordId: 'r', shipmentId: 's9' })
    expect(heard).toEqual(['s9'])
    expect(errors).toHaveBeenCalledTimes(1)
    errors.mockRestore()
  })
})
