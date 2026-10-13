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

/**
 * Store setup an AI build changes (AGL-3749): what a change may say, and the
 * settings it leaves — the cards' own shapes, no amount or rate the change did
 * not carry, and a change the settings already hold writing nothing.
 */

import { resolveShippingRates } from './commerce-shipping'
import { resolveTaxRate } from './commerce-tax'
import { localDeliveryOffered } from './local-fulfillment-settings'
import {
  applyStoreSetupChange,
  readStoreSetupChange,
  sameSetting,
  type StoreSetupApplied,
  type StoreSetupChange,
  type StoreSetupState,
} from './store-setup-content'

const IDS = { zoneId: 'job-1-zone', rateId: 'job-1-rate' }

function change(content: Record<string, unknown>): StoreSetupChange {
  const read = readStoreSetupChange(content)
  if (read.ok === false) throw new Error(read.problems.join('; '))
  return read.value
}

function problems(content: Record<string, unknown>): string[] {
  const read = readStoreSetupChange(content)
  return read.ok === false ? read.problems : []
}

function apply(state: StoreSetupState, content: Record<string, unknown>): StoreSetupApplied {
  return applyStoreSetupChange(state, change(content), IDS)
}

function written(result: StoreSetupApplied): Record<string, unknown> {
  if (!result.ok || !result.write) throw new Error(`nothing written: ${JSON.stringify(result)}`)
  return result.write.value as Record<string, unknown>
}

const EMPTY: StoreSetupState = { settings: {}, locations: [] }

describe('reading a change', () => {
  it('refuses an unknown section and arguments another section owns', () => {
    expect(problems({ section: 'payments' })[0]).toMatch(/"section" must be one of/)
    expect(problems({ section: 'tax', zoneName: 'US' })).toContain('"zoneName" is not a tax setting')
  })

  it('needs every amount a shipping rate charges, never a default', () => {
    expect(problems({ section: 'shipping', zoneName: 'US', countries: ['US'], rateName: 'Standard', kind: 'flat' })).toContain(
      '"amountUsd" is required for a flat rate',
    )
    expect(
      problems({ section: 'shipping', zoneName: 'US', countries: ['US'], rateName: 'Standard', kind: 'free_over', amountUsd: 5 }),
    ).toContain('"freeOverUsd" is required for a free-over rate')
    expect(problems({ section: 'shipping', zoneName: 'US', countries: ['US'], kind: 'flat', amountUsd: 5 })[0]).toMatch(/rateName/)
    expect(problems({ section: 'shipping', zoneName: 'US', countries: ['USA'], rateName: 'S', kind: 'flat', amountUsd: 5 })[0]).toMatch(
      /two-letter country code/,
    )
  })

  it('reads tiers as the card stores them: subtotal in cents, weight in grams', () => {
    const price = change({ section: 'shipping', zoneName: 'US', rateName: 'Std', kind: 'price_tiers', tiers: ['100:8', '50:5'] })
    expect(price).toMatchObject({ tiers: [{ upTo: 5000, amountCents: 500 }, { upTo: 10000, amountCents: 800 }] })
    const weight = change({ section: 'shipping', zoneName: 'US', rateName: 'Std', kind: 'weight_tiers', tiers: ['500:4.5'] })
    expect(weight).toMatchObject({ tiers: [{ upTo: 500, amountCents: 450 }] })
    expect(problems({ section: 'shipping', zoneName: 'US', rateName: 'Std', kind: 'price_tiers', tiers: ['cheap'] })[0]).toMatch(
      /not "up to:price"/,
    )
  })

  it('never takes a tax rate without its percentage, or an empty tax change', () => {
    expect(problems({ section: 'tax', rateCountry: 'US', rateState: 'TX' })[0]).toMatch(/"ratePercent" is required/)
    expect(problems({ section: 'tax', ratePercent: 8.25 })[0]).toMatch(/"rateCountry" is required/)
    expect(problems({ section: 'tax' })[0]).toMatch(/Say how the store handles sales tax/)
    expect(problems({ section: 'tax', rateCountry: 'US', ratePercent: 0 })[0]).toMatch(/above 0/)
  })

  it('holds pickup hours to the opening-hours syntax, and to a location', () => {
    expect(problems({ section: 'pickup', location: 'Austin', hours: 'weekdays 9 to 5' })[0]).toMatch(/Mo-Fr 09:00-17:00/)
    expect(problems({ section: 'pickup', hours: 'Mo-Fr 09:00-17:00' })[0]).toMatch(/belong to a location/)
    expect(change({ section: 'pickup', location: 'Austin', hours: 'Mo-Fr 09:00-17:00; Sa 10:00-14:00' })).toMatchObject({
      hours: 'Mo-Fr 09:00-17:00\nSa 10:00-14:00',
    })
  })
})

describe('shipping', () => {
  const freeOverFifty = {
    section: 'shipping',
    zoneName: 'United States',
    countries: ['US'],
    rateName: 'Standard',
    kind: 'free_over',
    amountUsd: 5,
    freeOverUsd: 50,
  }

  it('makes "free over $50, otherwise $5 flat in the US" as the card would, and checkout charges it', () => {
    const result = apply(EMPTY, freeOverFifty)
    const shipping = written(result)
    expect(shipping).toEqual({
      zones: [{ id: 'job-1-zone', name: 'United States', countries: ['US'] }],
      rates: [{ id: 'job-1-rate', zoneId: 'job-1-zone', name: 'Standard', kind: 'free_over', amountCents: 500, freeOverCents: 5000 }],
    })
    expect(resolveShippingRates(shipping, 'US', { subtotalCents: 2000 })).toEqual([{ rateId: 'job-1-rate', name: 'Standard', amountCents: 500 }])
    expect(resolveShippingRates(shipping, 'US', { subtotalCents: 6000 })[0]?.amountCents).toBe(0)
    expect(result.ok && result.summary).toBe('United States: "Standard" is free over $50, otherwise $5.')
  })

  it('writes nothing when the settings already hold the change', () => {
    const shipping = written(apply(EMPTY, freeOverFifty))
    const again = apply({ settings: { shipping }, locations: [] }, freeOverFifty)
    expect(again).toMatchObject({ ok: true, write: null })
  })

  it('finds an existing zone by name or countries, replaces a rate by name and keeps its id', () => {
    const settings = {
      shipping: {
        localPickup: true,
        zones: [{ id: 'z1', name: 'USA', countries: ['US'] }],
        rates: [{ id: 'r1', zoneId: 'z1', name: 'standard', kind: 'flat', amountCents: 900 }],
      },
    }
    const shipping = written(apply({ settings, locations: [] }, { ...freeOverFifty, zoneName: 'United States' }))
    expect(shipping['localPickup']).toBe(true)
    expect(shipping['zones']).toEqual([{ id: 'z1', name: 'USA', countries: ['US'] }])
    expect(shipping['rates']).toEqual([
      { id: 'r1', zoneId: 'z1', name: 'Standard', kind: 'free_over', amountCents: 500, freeOverCents: 5000 },
    ])
  })

  it('refuses a new zone with no countries, and leaves carrier rates to their card', () => {
    expect(apply(EMPTY, { ...freeOverFifty, countries: undefined })).toMatchObject({ ok: false, status: 400 })
    const settings = {
      shipping: {
        zones: [{ id: 'z1', name: 'US', countries: ['US'] }],
        rates: [{ id: 'r1', zoneId: 'z1', name: 'Standard', kind: 'carrier', carrier: {} }],
      },
    }
    expect(apply({ settings, locations: [] }, { ...freeOverFifty, zoneName: 'US' })).toMatchObject({ ok: false, status: 409 })
  })

  it('removes a rate, or a zone with its rates, and a second remove writes nothing', () => {
    const settings = {
      shipping: {
        zones: [
          { id: 'z1', name: 'US', countries: ['US'] },
          { id: 'z2', name: 'Canada', countries: ['CA'] },
        ],
        rates: [
          { id: 'r1', zoneId: 'z1', name: 'Standard', kind: 'flat', amountCents: 500 },
          { id: 'r2', zoneId: 'z1', name: 'Express', kind: 'flat', amountCents: 1500 },
          { id: 'r3', zoneId: 'z2', name: 'Standard', kind: 'flat', amountCents: 900 },
        ],
      },
    }
    const oneRate = written(apply({ settings, locations: [] }, { section: 'shipping', action: 'remove', zoneName: 'US', rateName: 'express' }))
    expect((oneRate['rates'] as unknown[]).length).toBe(2)
    const zone = written(apply({ settings, locations: [] }, { section: 'shipping', action: 'remove', zoneName: 'Canada' }))
    expect(zone['zones']).toEqual([{ id: 'z1', name: 'US', countries: ['US'] }])
    expect((zone['rates'] as Array<{ id: string }>).map((rate) => rate.id)).toEqual(['r1', 'r2'])
    expect(apply({ settings: { shipping: zone }, locations: [] }, { section: 'shipping', action: 'remove', zoneName: 'Canada' })).toMatchObject({
      ok: true,
      write: null,
    })
  })

  it('warns when a zone layout turns buyers away', () => {
    const result = apply(EMPTY, freeOverFifty)
    const withCanada = written(result)
    const second = apply({ settings: { shipping: withCanada }, locations: [] }, {
      ...freeOverFifty,
      zoneName: 'Canada',
      countries: ['CA'],
      kind: 'flat',
      freeOverUsd: undefined,
      amountUsd: 12,
    })
    expect(second.ok && second.warnings.join(' ')).toMatch(/turns away buyers in/)
  })
})

describe('pickup', () => {
  const locations = [
    { id: 'loc-a', name: 'Austin shop', city: 'Austin', address: '1 Congress Ave' },
    { id: 'loc-d', name: 'Dallas warehouse', city: 'Dallas' },
  ]

  it('turns the store-wide pickup choice on, keeping the zones and rates', () => {
    const settings = { shipping: { zones: [{ id: 'z1', name: 'US', countries: ['US'] }], rates: [] } }
    const shipping = written(apply({ settings, locations: [] }, { section: 'pickup' }))
    expect(shipping).toEqual({ ...settings.shipping, localPickup: true })
    expect(apply({ settings: { shipping }, locations: [] }, { section: 'pickup' })).toMatchObject({ ok: true, write: null })
  })

  it('offers pickup at the location a city names, with its hours', () => {
    const result = apply({ settings: {}, locations }, { section: 'pickup', location: 'Austin', hours: 'Mo-Fr 09:00-17:00', readyWithinMinutes: 120 })
    expect(result).toMatchObject({
      ok: true,
      write: { target: 'location', locationId: 'loc-a', value: { enabled: true, hours: 'Mo-Fr 09:00-17:00', readyWithinMinutes: 120 } },
      summary: 'Buyers can pick up orders at Austin shop.',
    })
  })

  it('never creates a location, and asks which when two match', () => {
    expect(apply({ settings: {}, locations }, { section: 'pickup', location: 'Houston' })).toMatchObject({ ok: false, status: 404 })
    const twins = [...locations, { id: 'loc-b', name: 'Austin market', city: 'Austin' }]
    expect(apply({ settings: {}, locations: twins }, { section: 'pickup', location: 'Austin' })).toMatchObject({ ok: false, status: 409 })
    expect(apply({ settings: {}, locations: twins }, { section: 'pickup', location: 'austin market' })).toMatchObject({
      ok: true,
      write: { locationId: 'loc-b' },
    })
  })
})

describe('local delivery', () => {
  const downtown = {
    section: 'local-delivery',
    country: 'US',
    zoneName: 'Downtown',
    postcodes: ['78701', '787*'],
    feeUsd: 5,
    freeOverUsd: 75,
    windows: 'Mo-Fr 09:00-12:00',
  }

  it('sets up postal-code delivery that checkout offers', () => {
    const value = written(apply(EMPTY, downtown))
    expect(value).toMatchObject({
      enabled: true,
      country: 'US',
      windows: 'Mo-Fr 09:00-12:00',
      zones: [{ id: 'job-1-zone', name: 'Downtown', kind: 'postcode', postcodes: ['78701', '787*'], feeCents: 500, freeOverCents: 7500 }],
    })
    expect(localDeliveryOffered(value)).toBe(true)
    expect(apply({ settings: { localDelivery: value }, locations: [] }, downtown)).toMatchObject({ ok: true, write: null })
  })

  it('refuses to switch on delivery checkout would not offer, and a zone with no fee', () => {
    const noWindows = apply(EMPTY, { ...downtown, windows: undefined })
    expect(noWindows).toMatchObject({ ok: false, status: 400 })
    expect(noWindows.ok === false && noWindows.error).toMatch(/Add at least one delivery window/)
    expect(apply(EMPTY, { ...downtown, feeUsd: undefined })).toMatchObject({ ok: false, error: expect.stringMatching(/costs/) })
  })

  it('switches delivery off and keeps its zones', () => {
    const value = written(apply(EMPTY, downtown))
    const off = written(apply({ settings: { localDelivery: value }, locations: [] }, { section: 'local-delivery', enabled: false }))
    expect(off['enabled']).toBeUndefined()
    expect((off['zones'] as unknown[]).length).toBe(1)
  })
})

describe('tax', () => {
  it('collects a stated state rate in manual mode, from the stated origin', () => {
    const tax = written(
      apply(EMPTY, { section: 'tax', originCountry: 'US', originState: 'TX', rateCountry: 'US', rateState: 'TX', ratePercent: 8.25 }),
    )
    expect(tax).toEqual({ mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', state: 'TX', pct: 8.25 }] })
    expect(resolveTaxRate(tax, { country: 'US', state: 'TX' })?.pct).toBe(8.25)
  })

  it('never leaves manual tax without an origin, which refuses every sale', () => {
    expect(apply(EMPTY, { section: 'tax', rateCountry: 'US', ratePercent: 7 })).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a manual rate on a store that calculates automatically, unless the change switches', () => {
    const settings = { tax: { mode: 'stripe' } }
    expect(apply({ settings, locations: [] }, { section: 'tax', rateCountry: 'US', ratePercent: 7, originCountry: 'US' })).toMatchObject({
      ok: false,
      status: 409,
    })
    expect(
      apply({ settings, locations: [] }, { section: 'tax', mode: 'manual', rateCountry: 'US', ratePercent: 7, originCountry: 'US' }),
    ).toMatchObject({ ok: true, write: { field: 'tax', value: { mode: 'manual' } } })
  })

  it('keeps lodging and service rates, replaces a rate by region, and removes one', () => {
    const settings = {
      tax: {
        mode: 'manual',
        origin: { country: 'US', state: 'TX' },
        rates: [{ country: 'US', state: 'TX', pct: 6.25, label: 'TX sales tax' }],
        lodging: { pct: 6 },
      },
    }
    const raised = written(apply({ settings, locations: [] }, { section: 'tax', rateCountry: 'US', rateState: 'TX', ratePercent: 8.25 }))
    expect(raised['lodging']).toEqual({ pct: 6 })
    expect(raised['rates']).toEqual([{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }])
    const removed = written(apply({ settings, locations: [] }, { section: 'tax', rateCountry: 'US', rateState: 'TX', removeRate: true }))
    expect(removed['rates']).toEqual([])
  })

  it('records "don’t collect" and automatic as the decisions they are, and repeats write nothing', () => {
    const none = written(apply(EMPTY, { section: 'tax', mode: 'none' }))
    expect(none).toEqual({ mode: 'none' })
    expect(apply({ settings: { tax: none }, locations: [] }, { section: 'tax', mode: 'none' })).toMatchObject({ ok: true, write: null })
    const automatic = apply(EMPTY, { section: 'tax', mode: 'stripe' })
    expect(automatic.ok && automatic.warnings.join(' ')).toMatch(/register cannot calculate/)
  })
})

describe('sameSetting', () => {
  it('ignores key order and undefined fields, not array order', () => {
    expect(sameSetting({ a: 1, b: undefined, c: [1, 2] }, { c: [1, 2], a: 1 })).toBe(true)
    expect(sameSetting([1, 2], [2, 1])).toBe(false)
  })
})
