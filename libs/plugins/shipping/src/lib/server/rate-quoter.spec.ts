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
  registerPluginShipmentRecords,
  type PluginShipmentRecords,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { randomBytes } from 'node:crypto'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { ensureShippingAccount } from './account-store'
import { readShippingConfig, setShippingFetchForTests } from './config'
import { setShippingDbForTests } from './db'
import { clearQuoteMemoryForTests } from './quote-cache'
import { packParcels, shippingRateQuoter } from './rate-quoter'

/**
 * The quoter commerce asks at checkout, through core's seam: available only
 * where a label could be bought (configured, a site that ships, the
 * workspace's account already open, an address to ship from); quotes in the
 * sale's currency only, cheapest first, kept ten minutes so a retried
 * checkout costs no second carrier call.
 */

let db: MemoryFirestore
const ORG = 'org-candles'
const HOST = 'host-candles'

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles' ? { orgId: 'org-candles', org: { name: 'Candles', plan: 'pro' } } : null,
  getHostDocAdmin: async (hostId: string) => (hostId === 'host-candles' ? { memberRoles: {} } : null),
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: () => true,
}))

const shipmentCalls: any[] = []
const validateCalls: string[] = []
const shippoFetch = (async (url: string, init: RequestInit = {}) => {
  const path = new URL(String(url)).pathname
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  if (path === '/shippo-accounts') return new Response(JSON.stringify({ object_id: 'acct_candles' }))
  if (path === '/shipments/') {
    shipmentCalls.push(body)
    return new Response(
      JSON.stringify({
        object_id: 'shp_1',
        rates: [
          { object_id: 'r_exp', amount: '24.10', currency: 'USD', provider: 'USPS', servicelevel: { name: 'Priority Express', token: 'usps_priority_express' }, estimated_days: 1 },
          { object_id: 'r_gnd', amount: '6.25', currency: 'USD', provider: 'USPS', servicelevel: { name: 'Ground Advantage', token: 'usps_ground_advantage' }, estimated_days: 4 },
          { object_id: 'r_cad', amount: '7.00', currency: 'CAD', provider: 'Canada Post', servicelevel: { name: 'Regular', token: 'canada_post_regular_parcel' } },
        ],
      }),
    )
  }
  if (path === '/v2/addresses/validate') {
    validateCalls.push(String(url))
    return new Response(JSON.stringify({ analysis: { validation_result: { value: 'invalid', reasons: [{ description: 'Unknown street' }] } } }))
  }
  return new Response('{}')
}) as typeof fetch

let shipFrom = true
const SELLER: PluginShipmentRecords = {
  read: async () => null,
  recordShipment: async () => ({ outcome: 'recorded', shipmentId: 'x' }),
  recordTracking: async () => ({ outcome: 'recorded' }),
  shipFromAddresses: async () =>
    shipFrom
      ? [{ id: 'loc-1', name: 'Studio', address: { line1: '1 A St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' } }]
      : [],
}

const REQUEST = {
  hostId: HOST,
  to: { country: 'US', postalCode: '02108' },
  parcels: [{ weightGrams: 800 }],
  currency: 'usd',
  valueCents: 4_000,
}

function config() {
  const configured = readShippingConfig()
  if (!configured.configured) throw new Error('not configured')
  return configured.config
}

beforeEach(() => {
  db = createMemoryFirestore()
  setShippingDbForTests(db)
  setShippingFetchForTests(shippoFetch)
  clearQuoteMemoryForTests()
  shipmentCalls.length = 0
  validateCalls.length = 0
  shipFrom = true
  process.env['SHIPPO_API_TOKEN'] = 'shippo_live_platform'
  process.env['SHIPPING_TOKEN_KEY'] = randomBytes(32).toString('base64')
  resetPluginServicesForTests()
  registerPluginShipmentRecords(SELLER, { pluginId: 'seller' })
})

afterAll(() => {
  setShippingDbForTests(null)
  setShippingFetchForTests(null)
})

const open = () => ensureShippingAccount(ORG, config(), { name: 'Rosa', email: 'r@example.com', company: 'Candles' })

describe('whether checkout may ask for carrier rates', () => {
  it('is false until the deployment is configured, the account is open and there is somewhere to ship from', async () => {
    delete process.env['SHIPPO_API_TOKEN']
    await expect(shippingRateQuoter.available(HOST)).resolves.toBe(false)
    process.env['SHIPPO_API_TOKEN'] = 'shippo_live_platform'
    // A shopper never opens the workspace's account.
    await expect(shippingRateQuoter.available(HOST)).resolves.toBe(false)
    await open()
    await expect(shippingRateQuoter.available('host-unknown')).resolves.toBe(false)
    shipFrom = false
    await expect(shippingRateQuoter.available(HOST)).resolves.toBe(false)
    shipFrom = true
    await expect(shippingRateQuoter.available(HOST)).resolves.toBe(true)
  })

  it('lists no services where the deployment names no provider', async () => {
    delete process.env['SHIPPO_API_TOKEN']
    await expect(shippingRateQuoter.listServices('host-candles')).resolves.toEqual([])
  })
})

describe('quoting', () => {
  it('refuses rather than guess when no account is open, so the seller falls back', async () => {
    await expect(shippingRateQuoter.quote(REQUEST)).rejects.toThrow()
    expect(shipmentCalls).toHaveLength(0)
  })

  it('quotes in the sale’s currency only, cheapest first, and serves a repeat from the cache', async () => {
    await open()
    const quotes = await shippingRateQuoter.quote(REQUEST)
    expect(quotes.map((quote) => [quote.amountCents, quote.currency])).toEqual([
      [625, 'usd'],
      [2410, 'usd'],
    ])
    expect(shipmentCalls).toHaveLength(1)
    // The parcel is rated in the site's default box when the seller gave no size.
    expect(shipmentCalls[0].parcels).toHaveLength(1)
    await expect(shippingRateQuoter.quote(REQUEST)).resolves.toEqual(quotes)
    expect(shipmentCalls).toHaveLength(1)
    // Another instance, with an empty memory, reads the stored quote.
    clearQuoteMemoryForTests()
    await expect(shippingRateQuoter.quote(REQUEST)).resolves.toEqual(quotes)
    expect(shipmentCalls).toHaveLength(1)
    // Another door is another price.
    await shippingRateQuoter.quote({ ...REQUEST, to: { country: 'US', postalCode: '10001' } })
    expect(shipmentCalls).toHaveLength(2)
  })

  it('offers only the services the caller names', async () => {
    await open()
    const all = await shippingRateQuoter.quote(REQUEST)
    const only = await shippingRateQuoter.quote({ ...REQUEST, services: [all[1].serviceKey] })
    expect(only.map((quote) => quote.serviceKey)).toEqual([all[1].serviceKey])
  })

  it('packs an unsized parcel into the default box with its empty weight', () => {
    const settings = { packages: [], defaultPackageId: null } as never
    const [packed] = packParcels([{ weightGrams: 500 }], settings)
    expect(packed.weightGrams).toBeGreaterThan(500)
    expect(packed.lengthCm).toBeGreaterThan(0)
    const [sized] = packParcels([{ weightGrams: 500, lengthCm: 10, widthCm: 10, heightCm: 10 }], settings)
    expect(sized).toEqual({ weightGrams: 500, lengthCm: 10, widthCm: 10, heightCm: 10 })
  })
})

describe('address validation through the seam', () => {
  it('is unknown, asking nobody, where nothing is configured or open', async () => {
    const address = { country: 'US', line1: '1 Nowhere', postalCode: '02108' }
    delete process.env['SHIPPO_API_TOKEN']
    await expect(shippingRateQuoter.validateAddress?.(HOST, address)).resolves.toEqual({ verdict: 'unknown', messages: [] })
    process.env['SHIPPO_API_TOKEN'] = 'shippo_live_platform'
    await expect(shippingRateQuoter.validateAddress?.(HOST, address)).resolves.toEqual({ verdict: 'unknown', messages: [] })
    expect(validateCalls).toHaveLength(0)
    await open()
    const check = await shippingRateQuoter.validateAddress?.(HOST, address)
    expect(check?.verdict).toBe('invalid')
    expect(validateCalls).toHaveLength(1)
  })
})
