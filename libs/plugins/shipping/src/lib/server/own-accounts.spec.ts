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
import { createHmac, randomBytes } from 'node:crypto'
import { EASYSHIP_API_BASE } from '../providers/easyship'
import { SENDCLOUD_API_BASE } from '../providers/sendcloud'
import { SHIPPERHQ_GRAPHQL_URL } from '../providers/shipperhq'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { setShippingFetchForTests } from './config'
import { setShippingDbForTests } from './db'
import { setLabelBillingFetchForTests } from './label-billing'
import { setShipperHqEngineForTests } from './own-accounts'
import { shippingRateQuoter } from './rate-quoter'
import {
  accountRoute,
  availabilityRoute,
  carrierAccountsRoute,
  labelFileRoute,
  labelsBuyRoute,
  labelsVoidRoute,
  ownAccountsConnectRoute,
  ownAccountsDisconnectRoute,
  ownAccountsRoute,
  ratesRoute,
} from './routes'
import { trackerDocId } from './trackers'
import { easyshipWebhookRoute, sendcloudWebhookRoute } from './webhook-routes'

/**
 * The merchant's own shipping accounts (AGL-3632), through the console
 * routes, checkout's quoter and the per-workspace webhooks: what a
 * deployment offers, who may connect, how credentials are kept, how a
 * connected Easyship or Sendcloud account replaces the platform's for
 * rates, labels and tracking with nothing billed here, how a label file is
 * served, and ShipperHQ pricing checkout. Every vendor answers from here.
 */

const TOKEN_KEY = randomBytes(32).toString('base64')
const ORG = 'org-candles'
const HOST = 'host-candles'

let db: MemoryFirestore

const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-editor': { uid: 'uid-editor', email: 'rosa@example.com', email_verified: true },
  'tok-admin': { uid: 'uid-admin', email: 'ada@example.com', email_verified: true },
  'tok-billing': { uid: 'uid-billing', email: 'bill@example.com', email_verified: true },
}
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
          if (!decoded) throw Object.assign(new Error('Decoding Firebase ID token failed.'), { code: 'auth/argument-error' })
          return decoded
        },
      }),
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles' || hostId === 'host-other'
      ? {
          orgId: hostId === 'host-other' ? 'org-other' : 'org-candles',
          org: { name: 'Candles', ownerUid: 'owner-1', plan: 'pro' },
        }
      : null,
  getHostDocAdmin: async (hostId: string) =>
    hostId === 'host-candles' || hostId === 'host-other'
      ? { memberRoles: { 'uid-editor': 'editor', 'uid-admin': 'admin', 'uid-billing': 'admin' } }
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

/** Every vendor, recorded, answering by host and path. */
const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = []
let easyshipAccountAnswer: { status: number; body: unknown } = { status: 200, body: { account: { name: 'Candle Co' } } }
const SENDCLOUD_LINK = `${new URL(SENDCLOUD_API_BASE).origin}/api/v3/parcels/99/documents/label`
const vendorFetch = (async (url: string, init: RequestInit = {}) => {
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  calls.push({ url: String(url), method: String(init.method ?? 'GET'), headers: (init.headers ?? {}) as Record<string, string>, body })
  const href = String(url)
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
  if (href === `${EASYSHIP_API_BASE}/account`) return json(easyshipAccountAnswer.body, easyshipAccountAnswer.status)
  if (href === `${EASYSHIP_API_BASE}/shipments`) {
    return json({
      shipment: {
        easyship_shipment_id: 'ESUS1',
        rates: [
          { courier_service: { id: 'cs-1', name: 'USPS Ground Advantage', umbrella_name: 'USPS' }, total_charge: 7.4, currency: 'USD', max_delivery_time: 4, cost_rank: 1 },
          { courier_service: { id: 'cs-2', name: 'DHL Express Worldwide', umbrella_name: 'DHL' }, total_charge: 30, currency: 'EUR' },
        ],
      },
    })
  }
  if (href === `${EASYSHIP_API_BASE}/shipments/ESUS1/label`) {
    return json({
      shipment: {
        easyship_shipment_id: 'ESUS1',
        label_state: 'generated',
        courier_service: { id: 'cs-1', name: 'USPS Ground Advantage', umbrella_name: 'USPS' },
        rates: [{ courier_service: { id: 'cs-1' }, total_charge: 7.4, currency: 'USD' }],
        trackings: [{ tracking_number: 'ES-TRK-1', leg_number: 1 }],
        shipping_documents: [{ category: 'label', format: 'url', url: 'https://labels.easyship.com/1.pdf' }],
      },
    })
  }
  if (href === `${SENDCLOUD_API_BASE}/user/auth/metadata`) return json({ user_id: 7, integration_id: 4242 })
  if (href === `${SENDCLOUD_API_BASE}/shipping-options`) {
    return json({
      data: [
        { code: 'usps:ground', name: 'USPS Ground', carrier: { code: 'usps', name: 'USPS' }, quotes: [{ price: { total: { value: '6.10', currency: 'USD' } }, lead_time: 72 }] },
      ],
    })
  }
  if (href === `${SENDCLOUD_API_BASE}/shipments/announce`) {
    return json({
      data: {
        id: 'sc-shp-1',
        parcels: [{ id: 99, tracking_number: 'SC-TRK-1', tracking_url: 'https://tracking.sendcloud.sc/1', documents: [{ type: 'label', link: SENDCLOUD_LINK }] }],
      },
    })
  }
  if (href === SENDCLOUD_LINK) return new Response(new Uint8Array(Buffer.from('%PDF-sendcloud')), { status: 200, headers: { 'content-type': 'application/pdf' } })
  if (href === `${SENDCLOUD_API_BASE}/shipments/sc-shp-1/cancel`) return json({ data: { status: 'cancelled' } })
  if (href === SHIPPERHQ_GRAPHQL_URL) {
    if (String(body?.query ?? '').includes('createSecretToken')) {
      return body.variables.auth_code === 'bad'
        ? json({ data: { createSecretToken: null }, errors: [{ message: 'Invalid credentials' }] })
        : json({ data: { createSecretToken: { token: 'jwt' } } })
    }
    return json({
      data: {
        retrieveShippingQuote: {
          carriers: [{ carrierCode: 'ups', carrierTitle: 'UPS', shippingRates: [{ code: 'GND', title: 'Ground', totalCharges: 4.5 }] }],
        },
      },
    })
  }
  return json({ error: { message: `unexpected ${href}` } }, 404)
}) as typeof fetch

const stripeCalls: string[] = []
const stripeFetch = (async (url: string) => {
  stripeCalls.push(String(url))
  return new Response(JSON.stringify({ id: 'py_1' }), { status: 200 })
}) as typeof fetch

const writes: PluginShipmentWrite[] = []
const tracking: Array<{ trackingNumber: string; status: string }> = []
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
          lines: [{ lineIndex: 0, name: 'Candle', sku: 'CND-1', quantity: 2, quantityUnshipped: 2, unitValueCents: 1_500, weightGrams: 300 }],
          shipments: [],
        }
      : null,
  recordShipment: async (write) => {
    writes.push(write)
    return { outcome: 'recorded', shipmentId: `ful-${writes.length}` }
  },
  recordTracking: async (update) => {
    tracking.push({ trackingNumber: update.trackingNumber, status: update.status })
    return { outcome: 'recorded' }
  },
  shipFromAddresses: async () => [
    { id: 'loc-1', name: 'Studio', address: { line1: '1 A St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' } },
  ],
}

function call(
  route: (request: Request) => Promise<Response>,
  options: { token?: string | null; body?: Record<string, unknown>; query?: Record<string, string>; headers?: Record<string, string>; raw?: string } = {},
) {
  const method = options.body || options.raw !== undefined ? 'POST' : 'GET'
  const url = new URL('https://console.example.com/api/shipping/x')
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  const token = options.token === undefined ? 'tok-editor' : options.token
  if (token) headers['Authorization'] = `Bearer ${token}`
  return route(
    new Request(url, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(options.body ?? {}) }),
    }),
  )
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as any }
}

const connect = (kind: string, values: Record<string, string>, token = 'tok-billing') =>
  call(ownAccountsConnectRoute, { token, body: { hostId: HOST, kind, values } })

beforeEach(async () => {
  db = createMemoryFirestore()
  setShippingDbForTests(db)
  setShippingFetchForTests(vendorFetch)
  setLabelBillingFetchForTests(stripeFetch)
  setShipperHqEngineForTests(null)
  calls.length = 0
  stripeCalls.length = 0
  writes.length = 0
  tracking.length = 0
  easyshipAccountAnswer = { status: 200, body: { account: { name: 'Candle Co' } } }
  delete process.env['SHIPPO_API_TOKEN']
  delete process.env['EASYPOST_API_KEY']
  process.env['SHIPPING_TOKEN_KEY'] = TOKEN_KEY
  process.env['SHIPPING_OWN_ACCOUNT_PROVIDERS'] = 'easyship, sendcloud,shipperhq'
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_never_used'
  process.env['NEXT_PUBLIC_CONSOLE_URL'] = 'https://console.example.com'
  resetPluginServicesForTests()
  registerPluginShipmentRecords(SELLER, { pluginId: 'seller' })
})

afterAll(() => {
  setShippingDbForTests(null)
  setShippingFetchForTests(null)
  setLabelBillingFetchForTests(null)
  delete process.env['SHIPPING_OWN_ACCOUNT_PROVIDERS']
})

describe('what the deployment offers', () => {
  it('offers nothing until the variable names a service, and nothing without the sealing key', async () => {
    delete process.env['SHIPPING_OWN_ACCOUNT_PROVIDERS']
    expect((await read(await call(availabilityRoute, { query: { hostId: HOST } }))).body).toEqual({ available: false })
    expect((await call(ownAccountsRoute, { token: 'tok-admin', query: { hostId: HOST } })).status).toBe(404)
    process.env['SHIPPING_OWN_ACCOUNT_PROVIDERS'] = 'easyship'
    delete process.env['SHIPPING_TOKEN_KEY']
    expect((await call(ownAccountsRoute, { token: 'tok-admin', query: { hostId: HOST } })).status).toBe(404)
  })

  it('offers only the services named, before any platform exists', async () => {
    process.env['SHIPPING_OWN_ACCOUNT_PROVIDERS'] = 'sendcloud,unknown'
    expect((await read(await call(availabilityRoute, { query: { hostId: HOST } }))).body).toEqual({
      available: false,
      ownAccounts: true,
      platform: false,
    })
    const { status, body } = await read(await call(ownAccountsRoute, { token: 'tok-admin', query: { hostId: HOST } }))
    expect(status).toBe(200)
    expect(body.services.map((service: { kind: string }) => service.kind)).toEqual(['sendcloud'])
    expect(body.connections).toEqual([])
    // Nothing to ship through yet: the platform routes say so.
    expect((await call(ratesRoute, { body: { hostId: HOST, recordId: 'order-1' } })).status).toBe(409)
  })

  it('reads the connections to a site admin only', async () => {
    expect((await call(ownAccountsRoute, { token: 'tok-editor', query: { hostId: HOST } })).status).toBe(403)
  })
})

describe('connecting an account', () => {
  it('takes a workspace billing manager, the fields the service asks for, and a service on offer', async () => {
    expect((await connect('easyship', { apiKey: 'prod_x' }, 'tok-admin')).status).toBe(403)
    expect((await connect('fedex', { apiKey: 'x' })).status).toBe(400)
    expect((await connect('sendcloud', { apiKey: 'pub' })).status).toBe(400)
    expect((await connect('shipperhq', { apiKey: 'k', apiSecret: 'c', scope: 'NOPE', weightUnit: 'lb' })).status).toBe(400)
    process.env['SHIPPING_OWN_ACCOUNT_PROVIDERS'] = 'sendcloud'
    expect((await connect('easyship', { apiKey: 'prod_x' })).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('checks the credentials with the service, keeps them sealed and answers no secret', async () => {
    const { status, body } = await read(await connect('easyship', { apiKey: 'prod_secret_token', webhookSecret: 'webh_abc' }))
    expect(status).toBe(200)
    expect(body.connection).toMatchObject({
      kind: 'easyship',
      accountName: 'Candle Co',
      role: 'labels',
      testMode: false,
      followsParcels: true,
      webhookUrl: `https://console.example.com/api/shipping/webhooks/easyship?org=${ORG}`,
    })
    expect(JSON.stringify(body)).not.toContain('prod_secret_token')
    expect(calls[0].headers['Authorization']).toBe('Bearer prod_secret_token')
    const stored = db.docs.get(`orgs/${ORG}/shippingConnections/easyship`) as Record<string, unknown>
    expect(stored['sealedApiKey']).toEqual(expect.any(String))
    expect(JSON.stringify(stored)).not.toContain('prod_secret_token')
    expect(JSON.stringify(stored)).not.toContain('webh_abc')
    const listed = await read(await call(ownAccountsRoute, { token: 'tok-admin', query: { hostId: HOST } }))
    expect(listed.body.connections).toEqual([expect.objectContaining({ kind: 'easyship', accountName: 'Candle Co' })])
  })

  it('refuses credentials the service refused, in its words, keeping nothing', async () => {
    easyshipAccountAnswer = { status: 401, body: { error: { message: 'Invalid access token' } } }
    expect(await read(await connect('easyship', { apiKey: 'prod_bad' }))).toEqual({
      status: 400,
      body: { error: 'Invalid access token' },
    })
    expect(db.docs.has(`orgs/${ORG}/shippingConnections/easyship`)).toBe(false)
  })

  it('ships through one label platform at a time', async () => {
    expect((await connect('sendcloud', { apiKey: 'pub', apiSecret: 'sec' })).status).toBe(200)
    const refused = await read(await connect('easyship', { apiKey: 'prod_x' }))
    expect(refused).toEqual({ status: 409, body: { error: 'This workspace ships through Sendcloud. Disconnect it first.' } })
    // ShipperHQ only prices checkout, so it sits beside either.
    expect((await connect('shipperhq', { apiKey: 'k', apiSecret: 'c', scope: 'TEST', weightUnit: 'kg' })).status).toBe(200)
    expect((await connect('shipperhq', { apiKey: 'k', apiSecret: 'bad', scope: 'LIVE', weightUnit: 'lb' })).status).toBe(400)
  })

  it('marks an Easyship sandbox token as test', async () => {
    const { body } = await read(await connect('easyship', { apiKey: 'sand_abc' }))
    expect(body.connection).toMatchObject({ testMode: true, followsParcels: false })
  })
})

describe('shipping on the merchant’s own Easyship account', () => {
  it('replaces the platform for rates and labels, bills nothing here and hides consent and carriers', async () => {
    process.env['SHIPPO_API_TOKEN'] = 'shippo_live_platform'
    expect((await connect('easyship', { apiKey: 'prod_x', webhookSecret: 'webh_secret' })).status).toBe(200)
    expect((await read(await call(availabilityRoute, { query: { hostId: HOST } }))).body).toMatchObject({
      available: true,
      provider: 'Easyship',
      ownAccount: true,
      ownAccounts: true,
      platform: true,
    })
    const account = await read(await call(accountRoute, { token: 'tok-admin', query: { hostId: HOST } }))
    expect(account.body).toMatchObject({ ownAccount: true, provider: 'Easyship' })
    const carriers = await read(await call(carrierAccountsRoute, { token: 'tok-admin', query: { hostId: HOST } }))
    expect(carriers.body).toMatchObject({ accounts: [], canConnect: false, canToggle: false })

    const quote = await read(await call(ratesRoute, { body: { hostId: HOST, recordId: 'order-1' } }))
    expect(quote.status).toBe(200)
    expect(quote.body.shipmentId).toBe('ESUS1')
    expect(quote.body.rates.map((rate: { rateId: string }) => rate.rateId)).toEqual(['cs-1', 'cs-2'])
    const bought = await read(
      await call(labelsBuyRoute, {
        body: { hostId: HOST, recordId: 'order-1', shipmentId: 'ESUS1', rateId: 'cs-1', attemptKey: 'attempt-easyship-1' },
      }),
    )
    expect(bought.status).toBe(200)
    expect(bought.body.label).toMatchObject({
      status: 'purchased',
      carrier: 'USPS',
      trackingNumber: 'ES-TRK-1',
      labelUrl: 'https://labels.easyship.com/1.pdf',
      costCents: 740,
      chargeCents: 0,
      billingMethod: 'own_account',
      billingState: 'not_billed',
    })
    expect(stripeCalls).toHaveLength(0)
    expect(calls.some((one) => one.url.includes('goshippo'))).toBe(false)
    expect(writes).toEqual([expect.objectContaining({ trackingNumber: 'ES-TRK-1', carrier: 'USPS' })])
    expect(db.docs.get(`shippingTrackers/${trackerDocId('easyship', 'ES-TRK-1')}`)).toMatchObject({ orgId: ORG, providerId: 'easyship' })
  })

  it('follows its parcels by a webhook signed with the workspace’s secret', async () => {
    await connect('easyship', { apiKey: 'prod_x', webhookSecret: 'webh_secret' })
    await read(await call(ratesRoute, { body: { hostId: HOST, recordId: 'order-1' } }))
    await call(labelsBuyRoute, { body: { hostId: HOST, recordId: 'order-1', shipmentId: 'ESUS1', rateId: 'cs-1', attemptKey: 'attempt-easyship-2' } })
    const rawBody = JSON.stringify({
      event_type: 'shipment.tracking.status.changed',
      tracking_status_changed: { easyship_shipment_id: 'ESUS1', tracking_number: 'ES-TRK-1', status: 'Delivered' },
    })
    const jwt = (secret: string) => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000) })).toString('base64url')
      const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
      return `${header}.${payload}.${signature}`
    }
    const forged = await call(easyshipWebhookRoute, { token: null, query: { org: ORG }, raw: rawBody, headers: { 'x-easyship-signature': jwt('webh_wrong') } })
    expect(forged.status).toBe(401)
    const elsewhere = await call(easyshipWebhookRoute, { token: null, query: { org: 'org-other' }, raw: rawBody, headers: { 'x-easyship-signature': jwt('webh_secret') } })
    expect(elsewhere.status).toBe(404)
    const applied = await read(
      await call(easyshipWebhookRoute, { token: null, query: { org: ORG }, raw: rawBody, headers: { 'x-easyship-signature': jwt('webh_secret') } }),
    )
    expect(applied).toEqual({ status: 200, body: { ok: true, applied: { recorded: 1 } } })
    expect(tracking).toEqual([{ trackingNumber: 'ES-TRK-1', status: 'delivered' }])
  })
})

describe('shipping on the merchant’s own Sendcloud account', () => {
  async function buySendcloudLabel(attemptKey: string) {
    await connect('sendcloud', { apiKey: 'pub', apiSecret: 'sec' })
    const quote = await read(await call(ratesRoute, { body: { hostId: HOST, recordId: 'order-1' } }))
    expect(quote.body.rates).toEqual([expect.objectContaining({ rateId: 'usps:ground', amountCents: 610, estimatedDays: 3 })])
    const bought = await read(
      await call(labelsBuyRoute, {
        body: { hostId: HOST, recordId: 'order-1', shipmentId: quote.body.shipmentId, rateId: 'usps:ground', attemptKey },
      }),
    )
    expect(bought.status).toBe(200)
    return bought.body.label
  }

  it('announces from the quoted shipment and serves the label at an address only that label opens', async () => {
    const label = await buySendcloudLabel('attempt-sendcloud-1')
    const announce = calls.find((one) => one.url === `${SENDCLOUD_API_BASE}/shipments/announce`)
    expect(announce?.body).toMatchObject({
      to_address: { name: 'Ann', postal_code: '02108', email: 'ann@example.com' },
      from_address: { postal_code: '78701' },
      ship_with: { properties: { shipping_option_code: 'usps:ground' } },
    })
    expect(label).toMatchObject({ costCents: 610, billingMethod: 'own_account', trackingNumber: 'SC-TRK-1' })
    const url = new URL(label.labelUrl)
    expect(`${url.origin}${url.pathname}`).toBe('https://console.example.com/api/shipping/labels/file')
    expect(writes.at(-1)?.labelUrl).toBe(label.labelUrl)
    const query = Object.fromEntries(url.searchParams)

    const file = await call(labelFileRoute, { token: null, query })
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/pdf')
    expect(file.headers.get('cache-control')).toBe('private, no-store')
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('%PDF-sendcloud')
    expect((await call(labelFileRoute, { token: null, query: { ...query, t: `${query.t}x` } })).status).toBe(404)
    expect((await call(labelFileRoute, { token: null, query: { ...query, o: 'org-other' } })).status).toBe(404)

    // Once the account is gone the file cannot be fetched, and the label is
    // voided where it was bought, not on whatever ships next.
    expect((await call(ownAccountsDisconnectRoute, { token: 'tok-billing', body: { hostId: HOST, kind: 'sendcloud' } })).status).toBe(200)
    expect((await call(labelFileRoute, { token: null, query })).status).toBe(410)
    process.env['SHIPPO_API_TOKEN'] = 'shippo_live_platform'
    const refused = await read(await call(labelsVoidRoute, { body: { hostId: HOST, labelId: label.labelId } }))
    expect(refused).toEqual({ status: 409, body: { error: 'This label was bought through another shipping account. Void it there.' } })
  })

  it('voids through Sendcloud while connected', async () => {
    const label = await buySendcloudLabel('attempt-sendcloud-2')
    const voided = await read(await call(labelsVoidRoute, { body: { hostId: HOST, labelId: label.labelId } }))
    expect(voided.body.label).toMatchObject({ status: 'voided' })
    expect(calls.at(-1)).toMatchObject({ url: `${SENDCLOUD_API_BASE}/shipments/sc-shp-1/cancel`, method: 'POST' })
  })

  it('refuses a quote held from another platform', async () => {
    await connect('sendcloud', { apiKey: 'pub', apiSecret: 'sec' })
    const quote = await read(await call(ratesRoute, { body: { hostId: HOST, recordId: 'order-1' } }))
    await call(ownAccountsDisconnectRoute, { token: 'tok-billing', body: { hostId: HOST, kind: 'sendcloud' } })
    await connect('easyship', { apiKey: 'prod_x' })
    const refused = await call(labelsBuyRoute, {
      body: { hostId: HOST, recordId: 'order-1', shipmentId: quote.body.shipmentId, rateId: 'usps:ground', attemptKey: 'attempt-sendcloud-3' },
    })
    expect(refused.status).toBe(409)
  })

  it('follows its parcels by Sendcloud’s webhook, signed with the secret key, for this workspace only', async () => {
    await buySendcloudLabel('attempt-sendcloud-4')
    const rawBody = JSON.stringify({
      action: 'parcel_status_changed',
      timestamp: Date.now(),
      parcel: { id: 99, tracking_number: 'SC-TRK-1', status: { id: 11, message: 'Delivered' } },
    })
    const sign = (secret: string) => createHmac('sha256', secret).update(rawBody).digest('hex')
    expect((await call(sendcloudWebhookRoute, { token: null, query: { org: ORG }, raw: rawBody, headers: { 'sendcloud-signature': sign('nope') } })).status).toBe(401)
    expect((await call(sendcloudWebhookRoute, { token: null, query: { org: 'a/b' }, raw: rawBody, headers: { 'sendcloud-signature': sign('sec') } })).status).toBe(404)
    const applied = await read(
      await call(sendcloudWebhookRoute, { token: null, query: { org: ORG }, raw: rawBody, headers: { 'sendcloud-signature': sign('sec') } }),
    )
    expect(applied.body.applied).toEqual({ recorded: 1 })
    expect(tracking).toEqual([{ trackingNumber: 'SC-TRK-1', status: 'delivered' }])
  })
})

describe('checkout priced by the merchant’s ShipperHQ rules', () => {
  it('is available with no platform and no ship-from, quotes ShipperHQ’s methods and lists no fixed services', async () => {
    expect(await shippingRateQuoter.available(HOST)).toBe(false)
    expect((await connect('shipperhq', { apiKey: 'k', apiSecret: 'c', scope: 'LIVE', weightUnit: 'lb' })).status).toBe(200)
    expect(await shippingRateQuoter.available(HOST)).toBe(true)
    expect(await shippingRateQuoter.listServices(HOST)).toEqual([])
    const quotes = await shippingRateQuoter.quote({
      hostId: HOST,
      to: { country: 'US', postalCode: '02108' },
      parcels: [{ weightGrams: 900 }],
      currency: 'usd',
      valueCents: 4_000,
    })
    expect(quotes).toEqual([
      { serviceKey: 'ups:gnd', carrier: 'UPS', service: 'Ground', label: 'UPS Ground', amountCents: 450, currency: 'usd' },
    ])
    // A seller offering only other services is offered none of these.
    const narrowed = await shippingRateQuoter.quote({
      hostId: HOST,
      to: { country: 'US', postalCode: '10001' },
      parcels: [{ weightGrams: 900 }],
      currency: 'usd',
      valueCents: 4_000,
      services: ['usps:priority'],
    })
    expect(narrowed).toEqual([])
  })

  it('stops pricing checkout once the deployment stops offering it', async () => {
    await connect('shipperhq', { apiKey: 'k', apiSecret: 'c', scope: 'LIVE', weightUnit: 'lb' })
    process.env['SHIPPING_OWN_ACCOUNT_PROVIDERS'] = 'easyship'
    expect(await shippingRateQuoter.available(HOST)).toBe(false)
  })
})
