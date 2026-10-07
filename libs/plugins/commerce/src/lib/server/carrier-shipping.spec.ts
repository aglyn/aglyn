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

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  registerPluginShippingRateQuoter,
  type PluginShippingQuoteRequest,
  type PluginShippingRateQuoter,
} from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import * as CommerceModel from '../model'
import { normalizeCheckoutPostalCode, planCheckoutShippingWithCarriers } from './carrier-shipping'

/**
 * Live carrier rates at checkout (AGL-3612), against a stand-in quoter: the
 * seam is all commerce knows. What is held: a store with no carrier rate
 * plans exactly as before and never asks; a carrier rate asks for a postal
 * code; quotes are priced with the markup and the handling fee, replace
 * their fallback and narrow the session to the destination; and every way a
 * quote can fail — no quoter, unavailable, a throw, a slow one — offers the
 * merchant's fallback instead.
 */

const US = { id: 'zone-us', name: 'United States', countries: ['US'] }
const WORLD = { id: 'zone-world', name: 'Rest of world', countries: ['*'] }

const SETTINGS: CommerceModel.ShippingSettings = {
  zones: [US, WORLD],
  rates: [
    { id: 'flat-us', zoneId: 'zone-us', name: 'Standard', kind: 'flat', amountCents: 900 },
    { id: 'pickup-ish', zoneId: 'zone-us', name: 'Courier in town', kind: 'flat', amountCents: 1500 },
    {
      id: 'live-us',
      zoneId: 'zone-us',
      name: 'Carrier rates',
      kind: 'carrier',
      carrier: { services: ['usps:priority', 'ups:ground'], markupPct: 10, handlingCents: 150, fallbackRateId: 'flat-us' },
    },
    { id: 'flat-world', zoneId: 'zone-world', name: 'International', kind: 'flat', amountCents: 2500 },
  ],
}

const CART = { subtotalCents: 4_000, totalGrams: 800 }

let asked: PluginShippingQuoteRequest[] = []

function quoter(overrides: Partial<PluginShippingRateQuoter> = {}): PluginShippingRateQuoter {
  return {
    available: async () => true,
    quote: async (request) => {
      asked.push(request)
      return [
        { serviceKey: 'usps:priority', carrier: 'USPS', service: 'priority', label: 'USPS Priority Mail', amountCents: 800, currency: 'usd', estimatedDays: 2 },
        { serviceKey: 'ups:ground', carrier: 'UPS', service: 'ground', label: 'UPS Ground', amountCents: 1_000, currency: 'usd' },
        { serviceKey: 'fedex:2day', carrier: 'FedEx', service: '2day', label: 'FedEx 2Day', amountCents: 2_000, currency: 'usd' },
      ]
    },
    listServices: async () => [],
    ...overrides,
  }
}

beforeEach(() => {
  resetPluginServicesForTests()
  asked = []
})

const plan = (destination: { country?: unknown; postalCode?: unknown }, settings = SETTINGS) =>
  planCheckoutShippingWithCarriers({ hostId: 'host-1', settings, cart: CART, destination })

describe('a store with no carrier rate', () => {
  it('plans exactly as the table does, and never asks a quoter', async () => {
    registerPluginShippingRateQuoter(quoter(), { pluginId: 'courier' })
    const table: CommerceModel.ShippingSettings = {
      zones: [US],
      rates: [{ id: 'flat-us', zoneId: 'zone-us', name: 'Standard', kind: 'flat', amountCents: 900 }],
    }
    await expect(plan({ country: 'US' }, table)).resolves.toEqual(
      CommerceModel.planCheckoutShipping(table, CART, 'US'),
    )
    await expect(
      planCheckoutShippingWithCarriers({ hostId: 'host-1', settings: undefined, cart: CART, destination: {} }),
    ).resolves.toEqual(CommerceModel.planCheckoutShipping(undefined, CART, undefined))
    expect(asked).toHaveLength(0)
  })
})

describe('a carrier rate', () => {
  it('offers the fallback from the table when nobody quotes carriers', async () => {
    const result = await plan({ country: 'US', postalCode: '02108' })
    expect(result).toEqual(CommerceModel.planCheckoutShipping(SETTINGS, CART, 'US'))
    expect(result.options.map((option) => option.rateId)).toEqual(['flat-us', 'pickup-ish'])
  })

  it('asks for a postal code when the destination prices by carrier', async () => {
    registerPluginShippingRateQuoter(quoter(), { pluginId: 'courier' })
    await expect(plan({ country: 'US' })).resolves.toMatchObject({
      refusal: 'destination-required',
      needsPostalCode: true,
    })
    await expect(plan({})).resolves.toMatchObject({ refusal: 'destination-required' })
    expect(asked).toHaveLength(0)
  })

  it('prices the quotes with markup and handling, hides the fallback, keeps the other rates, and narrows to the country', async () => {
    registerPluginShippingRateQuoter(quoter(), { pluginId: 'courier' })
    const result = await plan({ country: 'us', postalCode: ' 02108 ' })
    expect(asked[0]).toMatchObject({
      hostId: 'host-1',
      to: { country: 'US', postalCode: '02108' },
      parcels: [{ weightGrams: 800 }],
      currency: 'usd',
      valueCents: 4_000,
    })
    expect(result.countries).toEqual(['US'])
    expect(result.quotedPostalCode).toBe('02108')
    // 800 + 10% + 150 = 1030; 1000 + 10% + 150 = 1250; FedEx is not offered.
    expect(result.options).toEqual([
      { rateId: 'carrier:live-us:usps:priority', name: 'USPS Priority Mail (2 business days)', amountCents: 1_030 },
      { rateId: 'carrier:live-us:ups:ground', name: 'UPS Ground', amountCents: 1_250 },
      { rateId: 'pickup-ish', name: 'Courier in town', amountCents: 1_500 },
    ])
  })

  it('leaves a destination without a carrier rate to the table', async () => {
    registerPluginShippingRateQuoter(quoter(), { pluginId: 'courier' })
    await expect(plan({ country: 'GB', postalCode: 'SW1A 1AA' })).resolves.toEqual(
      CommerceModel.planCheckoutShipping(SETTINGS, CART, 'GB'),
    )
    expect(asked).toHaveLength(0)
  })

  it.each([
    ['unavailable for the site', { available: async () => false }],
    [
      'failing',
      {
        quote: async () => {
          throw new Error('503')
        },
      },
    ],
    ['quoting nothing', { quote: async () => [] }],
  ])('falls back to the table when the quoter is %s', async (_name, overrides) => {
    registerPluginShippingRateQuoter(quoter(overrides as Partial<PluginShippingRateQuoter>), { pluginId: 'courier' })
    await expect(plan({ country: 'US', postalCode: '02108' })).resolves.toEqual(
      CommerceModel.planCheckoutShipping(SETTINGS, CART, 'US'),
    )
  })

  it('falls back when the quote is slower than the wait', async () => {
    registerPluginShippingRateQuoter(quoter({ quote: () => new Promise(() => undefined) }), { pluginId: 'courier' })
    const started = Date.now()
    const result = await planCheckoutShippingWithCarriers({
      hostId: 'host-1',
      settings: SETTINGS,
      cart: CART,
      destination: { country: 'US', postalCode: '02108' },
      timeoutMs: 40,
    })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(result).toEqual(CommerceModel.planCheckoutShipping(SETTINGS, CART, 'US'))
  })
})

describe('the model', () => {
  it('prices a carrier option with markup then handling, in whole cents', () => {
    expect(CommerceModel.carrierOptionAmountCents(1_234, { markupPct: 12.5, handlingCents: 99 })).toBe(1_234 + 154 + 99)
    expect(CommerceModel.carrierOptionAmountCents(1_000, undefined)).toBe(1_000)
    expect(CommerceModel.carrierOptionAmountCents(1_000, { markupPct: -5, handlingCents: -1 })).toBe(1_000)
  })

  it('resolves no table price for a carrier rate, and counts it as a shipping decision', () => {
    const only: CommerceModel.ShippingSettings = {
      zones: [US],
      rates: [{ id: 'live', zoneId: 'zone-us', name: 'Carrier', kind: 'carrier' }],
    }
    expect(CommerceModel.resolveShippingRates(only, 'US', CART)).toEqual([])
    expect(CommerceModel.merchantPricesShipping(only)).toBe(true)
    expect(CommerceModel.carrierRatesFor(only, 'US').map((rate) => rate.id)).toEqual(['live'])
    expect(CommerceModel.carrierRatesFor(only, 'GB')).toEqual([])
  })

  it('reads a postal code a shopper typed, or nothing', () => {
    expect(normalizeCheckoutPostalCode(' sw1a 1aa ')).toBe('SW1A 1AA')
    expect(normalizeCheckoutPostalCode('02108-1234')).toBe('02108-1234')
    expect(normalizeCheckoutPostalCode(['02108'])).toBeUndefined()
    expect(normalizeCheckoutPostalCode('<x>')).toBeUndefined()
  })

  it('stages a product’s shipping facts merged and made safe', () => {
    const product = { options: [], variants: [], seo: {}, shipping: { lengthCm: 20, hsCode: '3406' } }
    expect(
      CommerceModel.productCopyPatch(product as never, { shipping: { widthCm: 10, heightCm: null, originCountry: 'us' } }),
    ).toEqual({ shipping: { lengthCm: 20, widthCm: 10, hsCode: '3406', originCountry: 'US' } })
    expect(CommerceModel.productParcelDimensions({ shipping: { lengthCm: 20, widthCm: 10, heightCm: 5 } })).toEqual({
      lengthCm: 20,
      widthCm: 10,
      heightCm: 5,
    })
    expect(CommerceModel.productParcelDimensions({ shipping: { lengthCm: 20 } })).toBeUndefined()
    expect(CommerceModel.normalizePostalAddress({ line1: ' 1 A St ', country: 'us', bogus: 1 })).toEqual({
      line1: '1 A St',
      country: 'US',
    })
  })
})
