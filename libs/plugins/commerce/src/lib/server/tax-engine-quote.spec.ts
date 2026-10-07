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

import {
  registerPluginTaxEngine,
  type PluginTaxEngine,
  type PluginTaxEngineQuoteRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  allocateCentsByWeight,
  engineLineTaxPercentages,
  orderTaxEngineView,
  storeTaxAllowsEngine,
  taxEngineSessionMetadata,
  taxEngineStampFromMetadata,
} from '../model/commerce-tax-engine'
import { orderViewFromData } from './api-v1/order-view'
import { quoteSaleTaxWithEngine } from './tax-engine-quote'

/**
 * Commerce's half of an outside tax service (AGL-3631): when it asks, what
 * it does with the answer, what it does when no answer comes, and what the
 * order says afterwards — through core's contract, with a fake engine.
 */

const OWNER = { pluginId: 'tax-service' }

const SETTINGS = { mode: 'manual' as const }

const REQUEST = {
  hostId: 'host-1',
  settings: SETTINGS,
  channel: 'online' as const,
  lines: [{ id: '0', productId: 'prod-1', quantity: 1, amountCents: 10_000 }],
  customerEmail: 'ada@example.com',
}

function engine(overrides: Partial<PluginTaxEngine> = {}): PluginTaxEngine & { asked: PluginTaxEngineQuoteRequest[] } {
  const asked: PluginTaxEngineQuoteRequest[] = []
  return {
    asked,
    status: async () => ({ connected: true, provider: 'avalara', providerLabel: 'Avalara AvaTax', sandbox: true }),
    quote: async (request) => {
      asked.push(request)
      return {
        provider: 'avalara',
        providerLabel: 'Avalara AvaTax',
        taxCents: 825,
        lines: [{ id: '0', taxCents: 825 }],
        shippingTaxCents: 0,
        sandbox: true,
      }
    },
    validateAddress: async () => ({ valid: true, normalized: null, messages: [] }),
    ...overrides,
  }
}

beforeEach(() => {
  resetPluginServicesForTests()
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('asking the merchant’s tax service', () => {
  it('asks only a store on its own rates, exclusive of tax — never a Stripe Tax store', async () => {
    expect(storeTaxAllowsEngine({ mode: 'manual' })).toBe(true)
    expect(storeTaxAllowsEngine({ mode: 'manual', pricesIncludeTax: true })).toBe(false)
    expect(storeTaxAllowsEngine({ mode: 'stripe' })).toBe(false)
    expect(storeTaxAllowsEngine({ mode: 'none' })).toBe(false)
    expect(storeTaxAllowsEngine(undefined)).toBe(false)
    const fake = engine()
    registerPluginTaxEngine(fake, OWNER)
    await expect(quoteSaleTaxWithEngine({ ...REQUEST, settings: { mode: 'stripe' } })).resolves.toEqual({
      quote: null,
      stamp: null,
    })
    expect(fake.asked).toHaveLength(0)
  })

  it('prices nothing differently where no plugin offers an engine, or the site connected none', async () => {
    await expect(quoteSaleTaxWithEngine(REQUEST)).resolves.toEqual({ quote: null, stamp: null })
    const fake = engine({ status: async () => ({ connected: false }) })
    registerPluginTaxEngine(fake, OWNER)
    await expect(quoteSaleTaxWithEngine(REQUEST)).resolves.toEqual({ quote: null, stamp: null })
    expect(fake.asked).toHaveLength(0)
  })

  it('hands back the service’s quote and a stamp naming it', async () => {
    const fake = engine()
    registerPluginTaxEngine(fake, OWNER)
    const result = await quoteSaleTaxWithEngine({ ...REQUEST, channel: 'pos', discountCents: 500 })
    expect(result.quote?.taxCents).toBe(825)
    expect(result.stamp).toEqual({
      provider: 'avalara',
      providerLabel: 'Avalara AvaTax',
      status: 'quoted',
      reason: null,
      sandbox: true,
    })
    expect(fake.asked[0]).toMatchObject({
      hostId: 'host-1',
      channel: 'pos',
      discountCents: 500,
      customer: { email: 'ada@example.com' },
    })
  })

  it('falls back, stamped, when the service refuses', async () => {
    registerPluginTaxEngine(
      engine({
        quote: async () => {
          throw new Error('Avalara: Bad key')
        },
      }),
      OWNER,
    )
    await expect(quoteSaleTaxWithEngine(REQUEST)).resolves.toEqual({
      quote: null,
      stamp: { provider: 'avalara', providerLabel: 'Avalara AvaTax', status: 'fallback', reason: 'error', sandbox: true },
    })
  })

  it('does not wait on a status read that hangs', async () => {
    jest.useFakeTimers()
    try {
      registerPluginTaxEngine(engine({ status: () => new Promise(() => undefined) }), OWNER)
      const pending = quoteSaleTaxWithEngine(REQUEST)
      await jest.advanceTimersByTimeAsync(2_000)
      await expect(pending).resolves.toEqual({ quote: null, stamp: null })
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('the stamp, from session to order', () => {
  const STAMP = { provider: 'taxjar', providerLabel: 'TaxJar', status: 'fallback' as const, reason: 'timeout', sandbox: false }

  it('rides the Checkout Session metadata and comes back whole', () => {
    const params = taxEngineSessionMetadata(STAMP)
    expect(params).toEqual({
      'metadata[taxEngine]': 'taxjar',
      'metadata[taxEngineLabel]': 'TaxJar',
      'metadata[taxEngineStatus]': 'fallback',
      'metadata[taxEngineReason]': 'timeout',
    })
    const metadata = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key.slice('metadata['.length, -1), value]),
    )
    expect(taxEngineStampFromMetadata(metadata)).toEqual({ taxEngine: STAMP })
    expect(taxEngineStampFromMetadata({ taxCents: '100' })).toEqual({})
    expect(taxEngineSessionMetadata(null)).toEqual({})
  })

  it('is on the public order view beside a `manual` tax mode, which accounting books as the merchant’s', () => {
    const view = orderViewFromData('order-1', { taxMode: 'manual', taxEngine: STAMP, totals: { taxCents: 412 } })
    expect(view.taxMode).toBe('manual')
    expect(view.taxEngine).toEqual(STAMP)
    expect(orderViewFromData('order-2', {}).taxEngine).toBeNull()
    expect(orderTaxEngineView({ provider: 'avalara', status: 'quoted', reason: 'stale' })).toEqual({
      provider: 'avalara',
      providerLabel: 'avalara',
      status: 'quoted',
      reason: null,
      sandbox: false,
    })
  })
})

describe('a quote as per-line rates for the hosted cart', () => {
  it('splits a coupon exactly, in proportion', () => {
    expect(allocateCentsByWeight(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocateCentsByWeight(0, [5, 5])).toEqual([0, 0])
    expect(allocateCentsByWeight(10, [0, 0])).toEqual([0, 0])
  })

  it('gives each taxed line the rate that yields its cents on what Stripe will tax', () => {
    const lines = [
      { amountCents: 7_000, taxCents: 578 },
      { amountCents: 1_999, taxCents: 0 },
      { amountCents: 2_500, taxCents: 156 },
    ]
    const percentages = engineLineTaxPercentages(lines, 0)
    expect(percentages).toEqual([8.2571, null, 6.24])
    // Stripe rounds rate × amount; four decimals reproduce every cent.
    lines.forEach((line, index) => {
      const pct = percentages[index]
      if (pct !== null) expect(Math.round((line.amountCents * pct) / 100)).toBe(line.taxCents)
    })
  })

  it('carries no rate for a line a coupon covered entirely', () => {
    expect(engineLineTaxPercentages([{ amountCents: 1_000, taxCents: 80 }], 1_000)).toEqual([null])
  })
})
