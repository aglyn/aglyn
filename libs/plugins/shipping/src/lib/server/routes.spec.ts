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
  type PluginShipmentWrite,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { randomBytes } from 'node:crypto'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { setShippingFetchForTests } from './config'
import { setShippingDbForTests } from './db'
import { setLabelBillingFetchForTests } from './label-billing'
import type { QuotedRate } from './labels'
import {
  accountRoute,
  addressValidateRoute,
  availabilityRoute,
  batchBuyRoute,
  batchRatesRoute,
  carrierAccountsActiveRoute,
  carrierAccountsConnectRoute,
  carrierAccountsRoute,
  labelsBuyRoute,
  labelsRoute,
  labelsVoidRoute,
  MAX_BATCH,
  pickBatchRate,
  ratesRoute,
  settingsRoute,
  spendRoute,
} from './routes'

/**
 * Every console route of the shipping plugin, through its HTTP surface:
 * the gate each one climbs (not configured, unauthenticated, unverified, no
 * site, a role too low, a workspace permission missing, a wrong method), and
 * each route's own work against an in-memory Firestore, a recording Shippo
 * and a recording Stripe. Nothing leaves the process.
 */

const TOKEN_KEY = randomBytes(32).toString('base64')
const ORG = 'org-candles'
const HOST = 'host-candles'

let db: MemoryFirestore

/** Who each bearer token is. */
const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-editor': { uid: 'uid-editor', email: 'rosa@example.com', email_verified: true },
  'tok-viewer': { uid: 'uid-viewer', email: 'vic@example.com', email_verified: true },
  'tok-admin': { uid: 'uid-admin', email: 'ada@example.com', email_verified: true },
  'tok-billing': { uid: 'uid-billing', email: 'bill@example.com', email_verified: true },
  'tok-unverified': { uid: 'uid-editor', email: 'rosa@example.com', email_verified: false },
  'tok-outsider': { uid: 'uid-outsider', email: 'out@example.com', email_verified: true },
}

/** Workspace permissions by member. */
const ORG_PERMISSIONS: Record<string, string[]> = {
  'uid-admin': ['billing.view'],
  'uid-billing': ['billing.view', 'billing.manage'],
  'uid-editor': [],
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => db,
      auth: () => ({
        verifyIdToken: async (token: string) => {
          const decoded = TOKENS[token]
          if (!decoded) throw new Error('auth/argument-error')
          return decoded
        },
      }),
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles'
      ? { orgId: 'org-candles', org: { name: 'Candles', ownerUid: 'owner-1', plan: 'pro' } }
      : null,
  getHostDocAdmin: async (hostId: string) =>
    hostId === 'host-candles'
      ? {
          memberRoles: {
            'uid-editor': 'editor',
            'uid-viewer': 'viewer',
            'uid-admin': 'admin',
            'uid-billing': 'admin',
          },
        }
      : null,
  readOrgBilling: async () => ({}),
  resolveOrgMembership: async (uid: string) => (uid in ORG_PERMISSIONS ? { member: { uid } } : null),
  memberHasOrgPermission: async (_orgId: string, member: { uid: string }, permission: string) =>
    (ORG_PERMISSIONS[member.uid] ?? []).includes(permission),
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  merchantAccountIsReady: (input: { accountId?: unknown }) => Boolean(input.accountId),
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: () => true,
}))

/** Shippo, recorded. */
const shippoCalls: Array<{ url: string; method: string; body: any }> = []
const shippoFetch = (async (url: string, init: RequestInit = {}) => {
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  shippoCalls.push({ url: String(url), method: String(init.method ?? 'GET'), body })
  const path = new URL(String(url)).pathname
  const answer =
    path === '/shippo-accounts'
      ? { object_id: 'acct_candles' }
      : path === '/shipments/'
        ? {
            object_id: `shp_${shippoCalls.length}`,
            rates: [
              { object_id: 'rate_cheap', amount: '6.25', currency: 'USD', provider: 'USPS', servicelevel: { name: 'Ground Advantage', token: 'usps_ground_advantage' }, estimated_days: 4, attributes: [], carrier_account: 'ca_shippo' },
              { object_id: 'rate_fast', amount: '24.10', currency: 'USD', provider: 'USPS', servicelevel: { name: 'Priority Express', token: 'usps_priority_express' }, estimated_days: 1, attributes: [], carrier_account: 'ca_shippo' },
            ],
          }
        : path === '/transactions'
          ? {
              object_id: `txn_${body.rate}_${shippoCalls.length}`,
              status: 'SUCCESS',
              tracking_number: `TRK_${shippoCalls.length}`,
              tracking_url_provider: 'https://tools.usps.com/t',
              label_url: 'https://shippo-delivery.s3.amazonaws.com/l.pdf',
              rate: { object_id: body.rate, amount: body.rate === 'rate_fast' ? '24.10' : '6.25', currency: 'USD', provider: 'USPS', servicelevel: { name: 'Ground', token: 'g' } },
            }
          : path === '/refunds'
            ? { status: 'SUCCESS' }
            : path === '/v2/addresses/validate'
              ? {
                  recommended_address: { address_line_1: '2 B ST', city_locality: 'BOSTON', state_province: 'MA', postal_code: '02108-1234', country_code: 'US' },
                  analysis: { validation_result: { value: 'valid' }, address_type: 'residential' },
                }
              : path === '/carrier_accounts' || path === '/carrier_accounts/'
                ? init.method === 'POST'
                  ? { object_id: 'ca_fedex', carrier: 'fedex', carrier_name: 'FedEx', active: true }
                  : { results: [{ object_id: 'ca_shippo', carrier: 'usps', carrier_name: 'USPS', is_shippo_account: true, active: true }] }
                : {}
  return new Response(JSON.stringify(answer), { status: 200 })
}) as typeof fetch

const stripeCalls: Array<{ path: string; key: string }> = []
const stripeFetch = (async (url: string, init: RequestInit = {}) => {
  const path = new URL(String(url)).pathname
  stripeCalls.push({ path, key: (init.headers as Record<string, string>)['Idempotency-Key'] })
  return new Response(JSON.stringify({ id: path === '/v1/charges' ? `py_${stripeCalls.length}` : 're_1' }), { status: 200 })
}) as typeof fetch

const ORDER_LINES = [
  { lineIndex: 0, name: 'Candle', sku: 'CND-1', quantity: 2, quantityUnshipped: 2, unitValueCents: 1_500, weightGrams: 300 },
]
const writes: PluginShipmentWrite[] = []
const SELLER: PluginShipmentRecords = {
  read: async (hostId, recordId) =>
    recordId.startsWith('order-')
      ? {
          hostId,
          recordId,
          displayRef: `#${recordId.slice('order-'.length)}`,
          status: 'paid',
          shippable: true,
          currency: 'usd',
          shipTo: { name: 'Ann', line1: '2 B St', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US' },
          customerEmail: 'ann@example.com',
          lines: ORDER_LINES,
          shipments: [],
        }
      : null,
  recordShipment: async (write) => {
    writes.push(write)
    return { outcome: 'recorded', shipmentId: `ful-${writes.length}` }
  },
  recordTracking: async () => ({ outcome: 'recorded' }),
  shipFromAddresses: async () => [
    { id: 'loc-1', name: 'Studio', address: { line1: '1 A St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' } },
  ],
}

function call(
  route: (request: Request) => Promise<Response>,
  options: { method?: string; token?: string | null; body?: Record<string, unknown>; query?: Record<string, string> } = {},
) {
  const method = options.method ?? (options.body ? 'POST' : 'GET')
  const url = new URL('https://console.example.com/api/shipping/x')
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = options.token === undefined ? 'tok-editor' : options.token
  if (token) headers['Authorization'] = `Bearer ${token}`
  return route(
    new Request(url, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: JSON.stringify(options.body ?? {}) }),
    }),
  )
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as any }
}

async function consent() {
  const response = await call(accountRoute, { token: 'tok-billing', body: { hostId: HOST, accepted: true } })
  expect(response.status).toBe(200)
}

beforeEach(async () => {
  db = createMemoryFirestore()
  setShippingDbForTests(db)
  setShippingFetchForTests(shippoFetch)
  setLabelBillingFetchForTests(stripeFetch)
  shippoCalls.length = 0
  stripeCalls.length = 0
  writes.length = 0
  process.env['SHIPPO_API_TOKEN'] = 'shippo_live_platform'
  process.env['SHIPPING_TOKEN_KEY'] = TOKEN_KEY
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_never_used'
  delete process.env['EASYPOST_API_KEY']
  resetPluginServicesForTests()
  registerPluginShipmentRecords(SELLER, { pluginId: 'seller' })
  await db.collection('profiles').doc('owner-1').set({ stripeAccountId: 'acct_merchant', stripeChargesEnabled: true })
})

afterAll(() => {
  setShippingDbForTests(null)
  setShippingFetchForTests(null)
  setLabelBillingFetchForTests(null)
})

describe('the gate every console route climbs', () => {
  it('hides every surface while the deployment names no provider', async () => {
    delete process.env['SHIPPO_API_TOKEN']
    expect(await read(await call(availabilityRoute, { query: { hostId: HOST } }))).toEqual({
      status: 200,
      body: { available: false },
    })
    expect(await read(await call(spendRoute, { query: { orgId: ORG } }))).toEqual({
      status: 200,
      body: { available: false },
    })
    for (const route of [settingsRoute, ratesRoute, labelsBuyRoute, labelsVoidRoute, addressValidateRoute, batchBuyRoute]) {
      expect((await call(route, { body: { hostId: HOST } })).status).toBe(404)
    }
    expect(shippoCalls).toHaveLength(0)
  })

  it('also hides when the token key is missing, however the provider is set', async () => {
    delete process.env['SHIPPING_TOKEN_KEY']
    expect((await call(settingsRoute, { query: { hostId: HOST } })).status).toBe(404)
  })

  it('says which provider serves a site that can ship', async () => {
    expect(await read(await call(availabilityRoute, { query: { hostId: HOST } }))).toEqual({
      status: 200,
      body: { available: true, provider: 'Shippo', testMode: false },
    })
    expect((await read(await call(availabilityRoute, { query: { hostId: 'host-unknown' } }))).body).toEqual({
      available: false,
    })
  })

  it('refuses the caller before any work: token, address, site, role, method', async () => {
    expect((await call(settingsRoute, { token: null, query: { hostId: HOST } })).status).toBe(401)
    expect((await call(settingsRoute, { token: 'tok-forged', query: { hostId: HOST } })).status).toBe(401)
    expect((await call(settingsRoute, { token: 'tok-unverified', query: { hostId: HOST } })).status).toBe(403)
    expect((await call(settingsRoute, { query: {} })).status).toBe(400)
    expect((await call(settingsRoute, { query: { hostId: 'a/b' } })).status).toBe(400)
    expect((await call(settingsRoute, { query: { hostId: 'host-unknown' } })).status).toBe(404)
    expect((await call(settingsRoute, { token: 'tok-outsider', query: { hostId: HOST } })).status).toBe(403)
    // A viewer reads nothing here; an editor reads settings but only an admin saves them.
    expect((await call(ratesRoute, { token: 'tok-viewer', body: { hostId: HOST, recordId: 'order-1' } })).status).toBe(403)
    expect((await call(settingsRoute, { query: { hostId: HOST } })).status).toBe(200)
    expect((await call(settingsRoute, { body: { hostId: HOST, settings: {} } })).status).toBe(403)
    expect((await call(ratesRoute, { method: 'PUT', body: { hostId: HOST } })).status).toBe(405)
    expect((await call(labelsRoute, { method: 'POST', body: { hostId: HOST } })).status).toBe(405)
    expect(shippoCalls).toHaveLength(0)
  })
})

describe('settings and the workspace account', () => {
  it('reads a site’s settings with its ship-from places and the services it can offer', async () => {
    const { status, body } = await read(await call(settingsRoute, { query: { hostId: HOST } }))
    expect(status).toBe(200)
    expect(body.places).toEqual([expect.objectContaining({ id: 'loc-1', name: 'Studio' })])
    expect(body.provider).toBe('Shippo')
    expect(Array.isArray(body.services)).toBe(true)
  })

  it('lets an admin save settings', async () => {
    const response = await call(settingsRoute, { token: 'tok-admin', body: { hostId: HOST, settings: { labelFormat: 'zpl' } } })
    expect(response.status).toBe(200)
  })

  it('records the balance-debit consent only from a member who manages billing', async () => {
    const refused = await call(accountRoute, { token: 'tok-admin', body: { hostId: HOST, accepted: true } })
    expect(refused.status).toBe(403)
    const { status, body } = await read(await call(accountRoute, { token: 'tok-billing', body: { hostId: HOST, accepted: true } }))
    expect(status).toBe(200)
    expect(body.consent).toEqual({ acceptedAtMs: expect.any(Number) })
    expect(body.markupPct).toBe(0)
    expect(typeof body.consentText).toBe('string')
    // Reading it needs an admin, not billing.
    expect((await read(await call(accountRoute, { token: 'tok-admin', query: { hostId: HOST } }))).body.consent).not.toBeNull()
  })
})

describe('carrier accounts', () => {
  it('lists the workspace’s carriers to an admin only', async () => {
    expect((await call(carrierAccountsRoute, { query: { hostId: HOST } })).status).toBe(403)
    const { status, body } = await read(await call(carrierAccountsRoute, { token: 'tok-admin', query: { hostId: HOST } }))
    expect(status).toBe(200)
    expect(body.accounts).toEqual([expect.objectContaining({ id: 'ca_shippo', platformOwned: true })])
    expect(body.canConnect).toBe(true)
  })

  it('connects only UPS or FedEx with an account number and address, as a billing manager', async () => {
    const address = { line1: '1 A St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' }
    expect((await call(carrierAccountsConnectRoute, { token: 'tok-admin', body: { hostId: HOST, carrier: 'fedex', accountNumber: '1', address } })).status).toBe(403)
    expect((await call(carrierAccountsConnectRoute, { token: 'tok-billing', body: { hostId: HOST, carrier: 'dhl', accountNumber: '1', address } })).status).toBe(400)
    expect((await call(carrierAccountsConnectRoute, { token: 'tok-billing', body: { hostId: HOST, carrier: 'fedex', address } })).status).toBe(400)
    const { status, body } = await read(
      await call(carrierAccountsConnectRoute, {
        token: 'tok-billing',
        body: { hostId: HOST, carrier: 'fedex', accountNumber: '510087', address, contact: { name: 'Rosa' } },
      }),
    )
    expect(status).toBe(200)
    expect(body.carrierAccount).toMatchObject({ id: 'ca_fedex', platformOwned: false })
  })

  it('switches a carrier account on or off, as a billing manager', async () => {
    expect((await call(carrierAccountsActiveRoute, { token: 'tok-billing', body: { hostId: HOST } })).status).toBe(400)
    const response = await call(carrierAccountsActiveRoute, {
      token: 'tok-billing',
      body: { hostId: HOST, carrierAccountId: 'ca_fedex', active: false },
    })
    expect(response.status).toBe(200)
    expect(shippoCalls.at(-1)).toMatchObject({ method: 'PUT', body: { active: false } })
  })
})

describe('one order: rate, buy, list, void', () => {
  it('quotes, buys once per attempt, lists the label without provider ids, and voids it', async () => {
    await consent()
    expect((await call(ratesRoute, { body: { hostId: HOST } })).status).toBe(400)
    const quote = await read(await call(ratesRoute, { body: { hostId: HOST, recordId: 'order-1', package: { weightGrams: 900 } } }))
    expect(quote.status).toBe(200)
    expect(quote.body.rates.map((rate: { rateId: string }) => rate.rateId)).toEqual(['rate_cheap', 'rate_fast'])

    const buy = { hostId: HOST, recordId: 'order-1', shipmentId: quote.body.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-route-1' }
    expect((await call(labelsBuyRoute, { body: { ...buy, rateId: '' } })).status).toBe(400)
    const first = await read(await call(labelsBuyRoute, { body: buy }))
    expect(first.status).toBe(200)
    expect(first.body.replayed).toBe(false)
    expect(first.body.label).toMatchObject({ status: 'purchased', costCents: 625, chargeCents: 625, billingMethod: 'account_debit' })
    expect(JSON.stringify(first.body)).not.toMatch(/txn_|acct_candles/)
    const again = await read(await call(labelsBuyRoute, { body: buy }))
    expect(again.body.replayed).toBe(true)
    expect(shippoCalls.filter((one) => one.url.endsWith('/transactions'))).toHaveLength(1)
    expect(stripeCalls.filter((one) => one.path === '/v1/charges')).toHaveLength(1)

    const listed = await read(await call(labelsRoute, { query: { hostId: HOST, recordId: 'order-1' } }))
    expect(listed.body.labels).toHaveLength(1)
    expect((await call(labelsRoute, { query: { hostId: HOST } })).status).toBe(400)

    const voided = await read(await call(labelsVoidRoute, { body: { hostId: HOST, labelId: first.body.label.labelId } }))
    expect(voided.status).toBe(200)
    expect(voided.body.label.status).toBe('voided')
    expect(voided.body.label.billingState).toBe('credited')
    expect((await call(labelsVoidRoute, { body: { hostId: HOST } })).status).toBe(400)
  })

  it('answers a label that cannot be paid for with the flow’s refusal, buying nothing', async () => {
    const quote = await read(await call(ratesRoute, { body: { hostId: HOST, recordId: 'order-1' } }))
    const refused = await call(labelsBuyRoute, {
      body: { hostId: HOST, recordId: 'order-1', shipmentId: quote.body.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-route-2' },
    })
    expect(refused.status).toBe(402)
    expect(shippoCalls.filter((one) => one.url.endsWith('/transactions'))).toHaveLength(0)
  })
})

describe('address validation', () => {
  it('checks an address given, or the order’s own when none is', async () => {
    expect((await call(addressValidateRoute, { body: { hostId: HOST } })).status).toBe(400)
    const byOrder = await read(await call(addressValidateRoute, { body: { hostId: HOST, recordId: 'order-1' } }))
    expect(byOrder.status).toBe(200)
    expect(byOrder.body.address).toMatchObject({ line1: '2 B St', postalCode: '02108' })
    expect(byOrder.body.check).toMatchObject({ verdict: 'corrected', suggested: { postalCode: '02108-1234', residential: true } })
    const given = await read(
      await call(addressValidateRoute, {
        body: { hostId: HOST, address: { line1: '2 B St', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US' } },
      }),
    )
    expect(given.status).toBe(200)
    expect(shippoCalls.filter((one) => one.url.includes('/v2/addresses/validate'))).toHaveLength(2)
  })
})

describe('batch labels', () => {
  it('rates many orders by the rule, with a packing slip each', async () => {
    const tooMany = Array.from({ length: MAX_BATCH + 1 }, (_, index) => `order-${index}`)
    expect((await call(batchRatesRoute, { body: { hostId: HOST, recordIds: tooMany } })).status).toBe(400)
    expect((await call(batchRatesRoute, { body: { hostId: HOST, recordIds: [] } })).status).toBe(400)
    const cheapest = await read(await call(batchRatesRoute, { body: { hostId: HOST, recordIds: ['order-1', 'order-2', 'nope'] } }))
    expect(cheapest.status).toBe(200)
    expect(cheapest.body.results.map((one: any) => [one.recordId, one.rate?.rateId ?? null])).toEqual([
      ['order-1', 'rate_cheap'],
      ['order-2', 'rate_cheap'],
      ['nope', null],
    ])
    expect(cheapest.body.results[0].slip).toEqual({
      shipTo: expect.objectContaining({ line1: '2 B St' }),
      lines: [{ name: 'Candle', sku: 'CND-1', quantity: 2 }],
    })
    expect(cheapest.body.results[2].error).toEqual(expect.any(String))
    const fastest = await read(await call(batchRatesRoute, { body: { hostId: HOST, recordIds: ['order-1'], policy: 'fastest' } }))
    expect(fastest.body.results[0].rate.rateId).toBe('rate_fast')
  })

  it('buys each order once under the batch key, so a retried batch buys only what is left', async () => {
    await consent()
    const rated = await read(await call(batchRatesRoute, { body: { hostId: HOST, recordIds: ['order-1', 'order-2'] } }))
    const items = rated.body.results.map((one: any) => ({ recordId: one.recordId, shipmentId: one.shipmentId, rateId: one.rate.rateId }))
    expect((await call(batchBuyRoute, { body: { hostId: HOST, batchKey: 'short', items } })).status).toBe(400)
    expect((await call(batchBuyRoute, { body: { hostId: HOST, batchKey: 'batch-0001', items: [] } })).status).toBe(400)
    const first = await read(await call(batchBuyRoute, { body: { hostId: HOST, batchKey: 'batch-0001', items: items.slice(0, 1) } }))
    expect(first.body.results).toEqual([expect.objectContaining({ recordId: 'order-1', error: null })])
    const retried = await read(await call(batchBuyRoute, { body: { hostId: HOST, batchKey: 'batch-0001', items } }))
    expect(retried.body.results.map((one: any) => [one.recordId, one.label?.status, one.error])).toEqual([
      ['order-1', 'purchased', null],
      ['order-2', 'purchased', null],
    ])
    expect(shippoCalls.filter((one) => one.url.endsWith('/transactions'))).toHaveLength(2)
    expect(stripeCalls.filter((one) => one.path === '/v1/charges')).toHaveLength(2)
    expect(writes).toHaveLength(2)
  })

  it('stops the batch at the first label that cannot be paid for', async () => {
    const rated = await read(await call(batchRatesRoute, { body: { hostId: HOST, recordIds: ['order-1', 'order-2'] } }))
    const items = rated.body.results.map((one: any) => ({ recordId: one.recordId, shipmentId: one.shipmentId, rateId: one.rate.rateId }))
    const { body } = await read(await call(batchBuyRoute, { body: { hostId: HOST, batchKey: 'batch-0002', items } }))
    expect(body.results).toHaveLength(1)
    expect(body.results[0]).toMatchObject({ recordId: 'order-1', label: null, error: expect.any(String) })
    expect(shippoCalls.filter((one) => one.url.endsWith('/transactions'))).toHaveLength(0)
  })

  it('picks the cheapest, the fastest or a named service', () => {
    const rate = (rateId: string, serviceKey: string, amountCents: number, estimatedDays?: number) =>
      ({ rateId, serviceKey, amountCents, ...(estimatedDays ? { estimatedDays } : {}) }) as QuotedRate
    const rates = [rate('a', 'usps_ground', 600, 5), rate('b', 'usps_priority', 900, 2), rate('c', 'ups_ground', 700)]
    expect(pickBatchRate([], 'cheapest')).toBeNull()
    expect(pickBatchRate(rates, 'cheapest')?.rateId).toBe('a')
    expect(pickBatchRate(rates, 'fastest')?.rateId).toBe('b')
    expect(pickBatchRate(rates, 'UPS_GROUND')?.rateId).toBe('c')
    expect(pickBatchRate(rates, 'fedex_ground')).toBeNull()
  })
})

describe('label spend', () => {
  it('shows six months to a member who can see billing, and no one else', async () => {
    expect((await call(spendRoute, { token: null, query: { orgId: ORG } })).status).toBe(401)
    expect((await call(spendRoute, { query: {} })).status).toBe(400)
    expect((await call(spendRoute, { token: 'tok-editor', query: { orgId: ORG } })).status).toBe(403)
    expect((await call(spendRoute, { token: 'tok-outsider', query: { orgId: ORG } })).status).toBe(403)

    await consent()
    const quote = await read(await call(ratesRoute, { body: { hostId: HOST, recordId: 'order-1' } }))
    await call(labelsBuyRoute, {
      body: { hostId: HOST, recordId: 'order-1', shipmentId: quote.body.shipmentId, rateId: 'rate_cheap', attemptKey: 'attempt-spend' },
    })
    const { status, body } = await read(await call(spendRoute, { token: 'tok-admin', query: { orgId: ORG } }))
    expect(status).toBe(200)
    expect(body.months).toHaveLength(6)
    expect(body.months[0]).toMatchObject({ labels: 1, chargedCents: 625, debitedCents: 625, invoicedCents: 0 })
    expect(body.markupPct).toBe(0)
  })
})
