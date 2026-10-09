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
  distanceKm,
  findLocalDeliveryWindow,
  formatLocalDeliveryWindow,
  localDeliveryFeeCents,
  localDeliveryHasRadiusZones,
  localDeliveryMinimumShortfall,
  localDeliveryOffered,
  localDeliveryProblems,
  matchLocalDeliveryZone,
  normalizeLocalDeliverySettings,
  normalizePickupSettings,
  normalizePostcode,
  pickupLocationOptions,
  pickupReadyWithinLabel,
  postcodePatternMatches,
  upcomingLocalDeliveryWindows,
  type LocalDeliverySettings,
} from './local-fulfillment-settings'

/**
 * Pickup and local delivery settings (AGL-3624): the pure decisions checkout
 * takes from what a merchant saved. Every one of them is a money or a promise
 * question — which zone's fee, whether an order meets a minimum, which windows
 * are bookable — so each is pinned here rather than inferred from a route.
 */

const delivery: LocalDeliverySettings = normalizeLocalDeliverySettings({
  enabled: true,
  country: 'us',
  zones: [
    { id: 'downtown', name: 'Downtown', kind: 'postcode', postcodes: ['10001', ' 10002 '], feeCents: 300 },
    {
      id: 'city',
      name: 'City',
      kind: 'postcode',
      postcodes: ['100*', '11201-11210'],
      feeCents: 800,
      minimumCents: 2500,
      freeOverCents: 10_000,
    },
  ],
  windows: 'Mo-Fr 09:00-12:00\nSa 10:00-14:00',
  leadTimeMinutes: 120,
  daysAhead: 7,
})

describe('postal codes', () => {
  it('normalizes a US ZIP+4 to its five digits and drops spaces elsewhere', () => {
    expect(normalizePostcode('10001-1234', 'US')).toBe('10001')
    expect(normalizePostcode(' sw1a 1aa ', 'GB')).toBe('SW1A1AA')
  })

  it('matches exact codes, prefixes and same-length numeric ranges', () => {
    expect(postcodePatternMatches('10001', '10001')).toBe(true)
    expect(postcodePatternMatches('10001', '10002')).toBe(false)
    expect(postcodePatternMatches('100*', '10099')).toBe(true)
    expect(postcodePatternMatches('SW1A*', 'SW1A1AA')).toBe(true)
    expect(postcodePatternMatches('11201-11210', '11205')).toBe(true)
    expect(postcodePatternMatches('11201-11210', '11211')).toBe(false)
    // A range never matches a code of another length.
    expect(postcodePatternMatches('11201-11210', '112050')).toBe(false)
    // A bare `*` is not "everywhere": it names no prefix.
    expect(postcodePatternMatches('*', '10001')).toBe(false)
  })
})

describe('matchLocalDeliveryZone', () => {
  it('takes the first listed zone that names the code, so a cheaper neighbourhood can be carved out', () => {
    expect(matchLocalDeliveryZone(delivery, { postalCode: '10001' })?.id).toBe('downtown')
    expect(matchLocalDeliveryZone(delivery, { postalCode: '10005' })?.id).toBe('city')
    expect(matchLocalDeliveryZone(delivery, { postalCode: '11203' })?.id).toBe('city')
  })

  it('refuses a code no zone names, and a destination in another country', () => {
    expect(matchLocalDeliveryZone(delivery, { postalCode: '94105' })).toBeNull()
    expect(matchLocalDeliveryZone(delivery, { country: 'CA', postalCode: '10001' })).toBeNull()
  })

  it('measures a distance zone only with both ends on a map, tightest radius first', () => {
    const radius = normalizeLocalDeliverySettings({
      enabled: true,
      country: 'US',
      origin: { lat: 40.75, lng: -73.99 },
      zones: [
        { id: 'far', name: 'Far', kind: 'radius', radiusKm: 30, feeCents: 1500 },
        { id: 'near', name: 'Near', kind: 'radius', radiusKm: 5, feeCents: 500 },
      ],
      windows: 'Mo 09:00-12:00',
    })
    expect(localDeliveryHasRadiusZones(radius)).toBe(true)
    // About 2 km away.
    expect(matchLocalDeliveryZone(radius, { postalCode: '10001', coordinates: { lat: 40.768, lng: -73.99 } })?.id).toBe('near')
    // About 20 km away.
    expect(matchLocalDeliveryZone(radius, { postalCode: '10001', coordinates: { lat: 40.93, lng: -73.99 } })?.id).toBe('far')
    // No position for the buyer: no distance, so no zone — never "zero km".
    expect(matchLocalDeliveryZone(radius, { postalCode: '10001' })).toBeNull()
    // No position for the store either.
    const unplaced = { ...radius, origin: undefined }
    expect(matchLocalDeliveryZone(unplaced, { postalCode: '1', coordinates: { lat: 40.75, lng: -73.99 } })).toBeNull()
    expect(localDeliveryHasRadiusZones(unplaced)).toBe(false)
  })

  it('computes great-circle distance', () => {
    // New York to Los Angeles is about 3,936 km.
    expect(Math.round(distanceKm({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 }))).toBeGreaterThan(3900)
    expect(distanceKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0)
  })
})

describe('fees and minimums', () => {
  const city = delivery.zones?.[1] as NonNullable<LocalDeliverySettings['zones']>[number]

  it('charges the fee until the free-over threshold', () => {
    expect(localDeliveryFeeCents(city, 5_000)).toBe(800)
    expect(localDeliveryFeeCents(city, 10_000)).toBe(0)
  })

  it('reports how far an order is below the minimum', () => {
    expect(localDeliveryMinimumShortfall(city, 2_000)).toBe(500)
    expect(localDeliveryMinimumShortfall(city, 2_500)).toBe(0)
  })

  it('never stores a negative or fractional fee', () => {
    const settings = normalizeLocalDeliverySettings({
      enabled: true,
      country: 'US',
      zones: [{ id: 'z', name: 'Z', kind: 'postcode', postcodes: ['1'], feeCents: -50, minimumCents: 'abc' }],
    })
    expect(settings.zones?.[0]).toEqual({ id: 'z', name: 'Z', kind: 'postcode', postcodes: ['1'], feeCents: 0 })
  })
})

describe('delivery windows', () => {
  // Monday 2026-10-12, 08:00 in New York (12:00 UTC).
  const mondayMorning = Date.UTC(2026, 9, 12, 12, 0)
  const timeZone = 'America/New_York'

  it('offers each line on each of its days, in the store zone, past the lead time', () => {
    const windows = upcomingLocalDeliveryWindows(delivery, { nowMs: mondayMorning, timeZone })
    // 08:00 + 2h lead time = 10:00 > 09:00, so Monday's window is gone.
    expect(windows[0]?.startMs).toBe(Date.UTC(2026, 9, 13, 13, 0))
    expect(formatLocalDeliveryWindow(windows[0], timeZone)).toBe('Tue, Oct 13, 9:00 AM – 12:00 PM')
    const saturday = windows.find((window) => new Date(window.startMs).getUTCDay() === 6)
    expect(saturday?.endMs).toBe(Date.UTC(2026, 9, 17, 18, 0))
    // Seven days ahead, Sundays never offered.
    expect(windows.every((window) => new Date(window.startMs - 4 * 3_600_000).getUTCDay() !== 0)).toBe(true)
  })

  it('finds only a window that is bookable now', () => {
    const tuesday = Date.UTC(2026, 9, 13, 13, 0)
    expect(findLocalDeliveryWindow(delivery, tuesday, { nowMs: mondayMorning, timeZone })?.endMs).toBe(
      Date.UTC(2026, 9, 13, 16, 0),
    )
    // Monday's window opened inside the lead time.
    expect(findLocalDeliveryWindow(delivery, Date.UTC(2026, 9, 12, 13, 0), { nowMs: mondayMorning, timeZone })).toBeNull()
    // A start the store never offered.
    expect(findLocalDeliveryWindow(delivery, tuesday + 60_000, { nowMs: mondayMorning, timeZone })).toBeNull()
    expect(findLocalDeliveryWindow(delivery, 'soon', { nowMs: mondayMorning, timeZone })).toBeNull()
  })

  it('keeps wall-clock times across a daylight-saving change', () => {
    // Saturday 2026-10-31 noon in New York; clocks fall back on Sunday 11-01.
    const windows = upcomingLocalDeliveryWindows(
      { ...delivery, windows: 'Mo 09:00-12:00' },
      { nowMs: Date.UTC(2026, 9, 31, 16, 0), timeZone },
    )
    // Monday 11-02 09:00 is EST (UTC-5) now.
    expect(windows[0]?.startMs).toBe(Date.UTC(2026, 10, 2, 14, 0))
  })

  it('runs an overnight window into the next morning', () => {
    const windows = upcomingLocalDeliveryWindows(
      { ...delivery, windows: 'Fr 22:00-02:00', leadTimeMinutes: 0 },
      { nowMs: mondayMorning, timeZone: 'UTC' },
    )
    expect(windows[0]?.endMs - windows[0]?.startMs).toBe(4 * 3_600_000)
  })
})

describe('whether delivery is offered', () => {
  it('needs a country, a zone and a window', () => {
    expect(localDeliveryOffered(delivery)).toBe(true)
    expect(localDeliveryOffered({ ...delivery, enabled: false })).toBe(false)
    expect(localDeliveryOffered({ ...delivery, windows: 'every day' })).toBe(false)
    expect(localDeliveryProblems({ ...delivery, windows: '', zones: [] })).toEqual([
      'Add at least one delivery zone.',
      'Add at least one delivery window.',
    ])
    expect(localDeliveryProblems({ enabled: false })).toEqual([])
  })

  it('names a zone with no postal codes and a distance zone with no map position', () => {
    const problems = localDeliveryProblems(
      normalizeLocalDeliverySettings({
        enabled: true,
        country: 'US',
        windows: 'Mo 09:00-10:00',
        zones: [
          { id: 'a', name: 'Empty', kind: 'postcode', postcodes: [] },
          { id: 'b', name: 'Ring', kind: 'radius', radiusKm: 5 },
        ],
      }),
    )
    expect(problems).toEqual([
      '"Empty" lists no postal codes.',
      '"Ring" measures distance, but your store has no map position yet.',
    ])
  })
})

describe('pickup locations', () => {
  it('offers only locations with pickup on, default first, with their public facts', () => {
    const options = pickupLocationOptions([
      { id: 'b', name: 'Bakery', pickup: { enabled: true, hours: 'Mo-Fr 09:00-17:00' }, address: '2 High St' },
      { id: 'w', name: 'Warehouse', pickup: { enabled: false } },
      {
        id: 'm',
        name: 'Main',
        isDefault: true,
        pickup: { enabled: true, instructions: 'Side door', readyWithinMinutes: 120 },
        postalAddress: { line1: '1 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' },
      },
      null,
    ])
    expect(options).toEqual([
      {
        id: 'm',
        name: 'Main',
        address: '1 Main St, Springfield, IL, 62701',
        instructions: 'Side door',
        readyWithinMinutes: 120,
      },
      { id: 'b', name: 'Bakery', address: '2 High St', hours: 'Mo-Fr 09:00-17:00' },
    ])
  })

  it('makes a stored pickup block safe', () => {
    expect(normalizePickupSettings({ enabled: 'yes', hours: 7, readyWithinMinutes: -3 })).toEqual({})
    expect(normalizePickupSettings({ enabled: true, instructions: '  Knock  ' })).toEqual({
      enabled: true,
      instructions: 'Knock',
    })
  })

  it('says how long an order usually takes', () => {
    expect(pickupReadyWithinLabel(30)).toBe('Usually ready in 30 minutes')
    expect(pickupReadyWithinLabel(60)).toBe('Usually ready in 1 hour')
    expect(pickupReadyWithinLabel(2880)).toBe('Usually ready in 2 days')
    expect(pickupReadyWithinLabel(undefined)).toBe('')
  })
})
