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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import {
  localFulfillmentOptionsHandler,
  orderLocalFulfillmentFromSession,
  placeDeliveryAddress,
  planLocalFulfillment,
  readLocalFulfillmentRequest,
  readLocalFulfillmentStore,
} from './local-fulfillment'

/**
 * The cart's declaration, the order it becomes, and the cart's question
 * (AGL-3624). The cart checkout wiring is `cart-checkout-local-fulfillment.spec.ts`;
 * what is pinned here is the module's own decisions over an in-memory
 * Firestore, with the shipping plugin's address check and the SMS seam
 * mocked at their core seams.
 */

const docs = new Map<string, Record<string, any>>()

function makeSnapshot(path: string): any {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    limit: () => ref,
    get: async () => ({
      docs: [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(makeSnapshot),
    }),
  }
  return ref
}

const fakeFirestore = { collection: (name: string) => makeCollectionRef(name) }
let mockQuoter: any = null
let mockSms: any = null
const mockRateLimit = jest.fn(async () => ({ allowed: true }))

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  getOrgForHost: async () => ({ org: { id: 'org-1', plan: 'business', subscriptionStatus: 'active', timeZone: 'America/Chicago' } }),
  consumeRateLimit: (...args: unknown[]) => mockRateLimit(...(args as [])),
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-shipping-rates', () => ({
  pluginShippingRateQuoter: () => mockQuoter,
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-sms-messaging', () => ({
  pluginSmsMessaging: () => mockSms,
}))

const hostRef = makeDocRef('hosts/host-1')

const delivery = {
  enabled: true,
  country: 'US',
  zones: [
    { id: 'near', name: 'Downtown', kind: 'postcode', postcodes: ['627*'], feeCents: 500 },
    { id: 'ring', name: 'Ring', kind: 'radius', radiusKm: 10, feeCents: 900 },
  ],
  origin: { lat: 39.8, lng: -89.65 },
  windows: 'Mo-Su 09:00-12:00',
  leadTimeMinutes: 0,
  instructions: 'We text when close.',
}

function seed() {
  docs.clear()
  docs.set('hosts/host-1', { timeZone: 'America/Chicago' })
  docs.set('hosts/host-1/settings/store', { localDelivery: delivery })
  docs.set('hosts/host-1/locations/main', {
    name: 'Main Street',
    isDefault: true,
    address: '1 Main St',
    pickup: { enabled: true, hours: 'Mo-Fr 09:00-17:00', instructions: 'Side door', readyWithinMinutes: 60 },
  })
  docs.set('hosts/host-1/locations/off', { name: 'Warehouse', pickup: { enabled: false } })
}

beforeEach(() => {
  seed()
  mockQuoter = null
  mockSms = null
  mockRateLimit.mockClear()
})

describe('readLocalFulfillmentRequest', () => {
  it('reads pickup and delivery, and nothing else', () => {
    expect(readLocalFulfillmentRequest({ method: 'pickup', locationId: 'main', feeCents: 0 })).toEqual({
      method: 'pickup',
      locationId: 'main',
    })
    expect(readLocalFulfillmentRequest({ method: 'shipping' })).toBeNull()
    expect(readLocalFulfillmentRequest('pickup')).toBeNull()
    expect(
      readLocalFulfillmentRequest({ method: 'local_delivery', postalCode: ' 62704 ', windowStartMs: '1700000000000', textPhone: '(217) 555-0100' }),
    ).toEqual({ method: 'local_delivery', postalCode: '62704', windowStartMs: 1_700_000_000_000, textPhone: '+12175550100' })
  })

  it('drops a mobile number that cannot be normalized', () => {
    expect(readLocalFulfillmentRequest({ method: 'pickup', locationId: 'main', textPhone: '555' })).toEqual({
      method: 'pickup',
      locationId: 'main',
    })
  })
})

describe('planLocalFulfillment with distance zones', () => {
  it('places the address through the shipping plugin and prices the ring it falls in', async () => {
    mockQuoter = {
      available: async () => true,
      validateAddress: jest.fn(async () => ({ verdict: 'valid', messages: [], coordinates: { lat: 39.82, lng: -89.65 } })),
    }
    const store = await readLocalFulfillmentStore({ hostRef })
    const nowMs = Date.UTC(2026, 9, 12, 12, 0)
    const plan = await planLocalFulfillment({
      hostId: 'host-1',
      request: {
        method: 'local_delivery',
        postalCode: '62999',
        windowStartMs: Date.UTC(2026, 9, 12, 14, 0),
        address: { line1: '9 Elm St', postalCode: '62999' },
      },
      itemsCents: 1000,
      hasPhysicalLine: true,
      store,
      nowMs,
    })
    expect(plan.kind).toBe('local_delivery')
    expect(plan.kind === 'local_delivery' && plan.zone.id).toBe('ring')
    expect(mockQuoter.validateAddress).toHaveBeenCalledWith('host-1', expect.objectContaining({ line1: '9 Elm St', country: 'US' }))
  })

  it('asks for the street before it can measure', async () => {
    const store = await readLocalFulfillmentStore({ hostRef })
    const plan = await planLocalFulfillment({
      hostId: 'host-1',
      request: { method: 'local_delivery', postalCode: '62999' },
      itemsCents: 1000,
      hasPhysicalLine: true,
      store,
    })
    expect(plan).toEqual({ kind: 'refusal', status: 400, error: 'Enter your street address for delivery.' })
  })

  it('refuses when no position comes back, rather than measuring zero', async () => {
    mockQuoter = { available: async () => true, validateAddress: async () => ({ verdict: 'valid', messages: [] }) }
    const store = await readLocalFulfillmentStore({ hostRef })
    const plan = await planLocalFulfillment({
      hostId: 'host-1',
      request: { method: 'local_delivery', postalCode: '62999', address: { line1: '9 Elm St' } },
      itemsCents: 1000,
      hasPhysicalLine: true,
      store,
    })
    expect(plan.kind).toBe('refusal')
  })

  it('gives up on a slow address check', async () => {
    jest.useFakeTimers()
    try {
      mockQuoter = { available: async () => true, validateAddress: () => new Promise(() => undefined) }
      const placed = placeDeliveryAddress('host-1', { line1: '1 A St', postalCode: '1', country: 'US' })
      await jest.advanceTimersByTimeAsync(3_100)
      await expect(placed).resolves.toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('orderLocalFulfillmentFromSession', () => {
  it('records a pickup under the location’s name, with its facts and the buyer’s text number', async () => {
    const result = await orderLocalFulfillmentFromSession({
      hostId: 'host-1',
      hostRef,
      metadata: { fulfillment: 'pickup', pickupLocationId: 'main', orderTextPhone: '+12175550100' },
      createdAtMs: 1000,
    })
    expect(result?.fields).toEqual({
      fulfillmentMethod: 'pickup',
      pickup: {
        locationId: 'main',
        locationName: 'Main Street',
        address: '1 Main St',
        instructions: 'Side door',
        hours: 'Mo-Fr 09:00-17:00',
        status: 'preparing',
        updatedAtMs: 1000,
      },
      locationId: 'main',
      customerPhone: '+12175550100',
      fulfillmentKey: 'pickup_preparing',
      fulfillmentLocationId: 'main',
      fulfillmentDueMs: 1000,
    })
    expect(result?.summary).toBe(
      'Pickup at Main Street, 1 Main St. We’ll let you know when it’s ready (usually ready in 1 hour). Side door',
    )
  })

  it('still routes to a location switched off after the buyer paid', async () => {
    docs.set('hosts/host-1/locations/main', { name: 'Main Street', pickup: { enabled: false } })
    const result = await orderLocalFulfillmentFromSession({
      hostId: 'host-1',
      hostRef,
      metadata: { fulfillment: 'pickup', pickupLocationId: 'main' },
      createdAtMs: 1000,
    })
    expect(result?.fields.pickup?.locationName).toBe('Main Street')
    expect(result?.fields.locationId).toBe('main')
  })

  it('records a delivery with its window and flags an address outside every zone', async () => {
    const inside = await orderLocalFulfillmentFromSession({
      hostId: 'host-1',
      hostRef,
      metadata: {
        fulfillment: 'local_delivery',
        deliveryZoneId: 'near',
        deliveryWindowStartMs: String(Date.UTC(2026, 9, 13, 14, 0)),
        deliveryWindowEndMs: String(Date.UTC(2026, 9, 13, 17, 0)),
        deliveryPostalCode: '62704',
        deliveryFeeCents: '500',
      },
      shippingAddress: { postalCode: '62704-1234', country: 'US' },
      createdAtMs: 1000,
    })
    expect(inside?.outsideZone).toBe(false)
    expect(inside?.fields.localDelivery).toMatchObject({
      zoneId: 'near',
      zoneName: 'Downtown',
      feeCents: 500,
      status: 'scheduled',
      windowLabel: 'Tue, Oct 13, 9:00 AM – 12:00 PM',
    })
    expect(inside?.fields.fulfillmentDueMs).toBe(Date.UTC(2026, 9, 13, 14, 0))
    expect(inside?.summary).toBe('Local delivery: Tue, Oct 13, 9:00 AM – 12:00 PM. We text when close.')

    const outside = await orderLocalFulfillmentFromSession({
      hostId: 'host-1',
      hostRef,
      metadata: { fulfillment: 'local_delivery', deliveryZoneId: 'near', deliveryPostalCode: '62704' },
      shippingAddress: { postalCode: '90210', country: 'US' },
      createdAtMs: 1000,
    })
    expect(outside?.outsideZone).toBe(true)
    expect(outside?.fields.localDelivery?.addressOutsideZone).toBe(true)
  })

  it('reads a shipped session as nothing', async () => {
    expect(
      await orderLocalFulfillmentFromSession({ hostId: 'host-1', hostRef, metadata: { type: 'commerce-cart' }, createdAtMs: 1 }),
    ).toBeNull()
  })
})

describe('the cart’s question', () => {
  function respond() {
    const result = { status: 0, body: undefined as any }
    const res = {
      status(code: number) {
        result.status = code
        return res
      },
      json(body: unknown) {
        result.body = body
      },
    } as unknown as PluginApiResponse
    return { res, result }
  }

  async function ask(body: Record<string, unknown>) {
    const { res, result } = respond()
    await localFulfillmentOptionsHandler(
      {
        method: 'POST',
        body: { hostId: 'host-1', ...body },
        cookies: { 'aglyn_cart_host-1': 'cart-1' },
        headers: {},
        query: {},
        socket: { remoteAddress: '203.0.113.9' },
      } as unknown as PluginApiRequest,
      res,
    )
    return result
  }

  beforeEach(() => {
    docs.set('hosts/host-1/carts/cart-1', { lines: [{ productId: 'p1', quantity: 2 }] })
    docs.set('hosts/host-1/products/p1', {
      name: 'Bread',
      status: 'active',
      type: 'physical',
      variants: [{ id: 'v1', priceUsd: 6 }],
    })
  })

  it('offers the pickup locations and the delivery windows for a physical basket', async () => {
    const result = await ask({})
    expect(result.status).toBe(200)
    expect(result.body.pickup.map((location: any) => location.id)).toEqual(['main'])
    expect(result.body.delivery).toMatchObject({ country: 'US', needsAddress: true, instructions: 'We text when close.' })
    expect(result.body.delivery.windows.length).toBeGreaterThan(0)
    expect(result.body.delivery.windows[0]).toEqual({
      id: expect.any(String),
      startMs: expect.any(Number),
      endMs: expect.any(Number),
      label: expect.stringMatching(/9:00 AM – 12:00 PM$/),
    })
    expect(result.body.texts).toBe(false)
  })

  it('quotes a postal code: the fee, or why not', async () => {
    expect((await ask({ postalCode: '62704' })).body.delivery.quote).toEqual({
      zoneId: 'near',
      zoneName: 'Downtown',
      feeCents: 500,
      shortfallCents: 0,
    })
    expect((await ask({ postalCode: '10001' })).body.delivery.quote).toEqual({ unavailable: 'We don’t deliver to 10001.' })
    // A distance check is rate limited per visitor.
    mockQuoter = {
      available: async () => true,
      validateAddress: async () => ({ verdict: 'valid', messages: [], coordinates: { lat: 39.81, lng: -89.65 } }),
    }
    expect((await ask({ postalCode: '62999', address: { line1: '9 Elm St' } })).body.delivery.quote.zoneId).toBe('ring')
    expect(mockRateLimit).toHaveBeenCalledWith('local-delivery:place:host-1:203.0.113.9', expect.any(Object))
  })

  it('says texts are possible only when the platform sends them and the store has not turned them off', async () => {
    mockSms = { isConfigured: () => true }
    expect((await ask({})).body.texts).toBe(true)
    docs.set('hosts/host-1/settings/store', { localDelivery: delivery, buyerNotifications: { texts: false } })
    expect((await ask({})).body.texts).toBe(false)
  })

  it('offers nothing for a basket of downloads, or an empty one', async () => {
    docs.set('hosts/host-1/products/p1', { name: 'PDF', status: 'active', type: 'digital', variants: [{ id: 'v1', priceUsd: 6 }] })
    expect((await ask({})).body).toEqual({ pickup: [], delivery: null })
    docs.delete('hosts/host-1/carts/cart-1')
    expect((await ask({})).body).toEqual({ pickup: [], delivery: null })
  })

  it('refuses a host id that is a path', async () => {
    expect((await ask({ hostId: 'a/b' })).status).toBe(400)
  })
})
