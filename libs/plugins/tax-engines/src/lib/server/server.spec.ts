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
  pluginTaxEngine,
  quotePluginTaxEngine,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { randomBytes } from 'node:crypto'
import { TAX_ENGINES_API_ROUTES } from '../constants/api-routes'
import { registerTaxEnginesServerDeclarations } from '../declarations.server'
import type { ProviderFetch } from '../providers/http'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { setTaxEnginesFetchForTests, TAX_ENGINES_ENV } from './config'
import { quoteTax } from './engine'
import {
  connectionRoute,
  connectRoute,
  disconnectRoute,
  exemptionsDeleteRoute,
  exemptionsRoute,
  orderTransactionRetryRoute,
  orderTransactionRoute,
  productTaxCodeRoute,
  settingsRoute,
  testRoute,
} from './routes'
import { exemptionId, sealApiToken, setTaxEnginesDbForTests, transactionId } from './store'
import { onOrderCancelled, onOrderPaid, onOrderRefunded, refundCode, saleCode } from './transactions'
import { parseSecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'

/**
 * The tax engines' server half against an in-memory Firestore and a
 * recorded vendor (AGL-3631): the quote commerce asks for, the recording of a
 * paid order and its reversal on a refund or a cancellation — each
 * idempotent — and every console route behind its gate.
 */

const TOKEN_KEY = randomBytes(32).toString('base64')
const ORG = 'org-candles'
const HOST = 'host-candles'
const OTHER_HOST = 'host-other'

let db: MemoryFirestore

const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-admin': { uid: 'uid-admin', email: 'ada@example.com', email_verified: true },
  'tok-editor': { uid: 'uid-editor', email: 'rosa@example.com', email_verified: true },
  'tok-viewer': { uid: 'uid-viewer', email: 'vic@example.com', email_verified: true },
  'tok-unverified': { uid: 'uid-admin', email: 'ada@example.com', email_verified: false },
  'tok-outsider': { uid: 'uid-outsider', email: 'out@example.com', email_verified: true },
}

const sites: Record<string, { org: Record<string, unknown>; host: Record<string, unknown> }> = {}

function resetSites() {
  sites[HOST] = {
    org: { name: 'Candles', plan: 'pro', enabledPlugins: ['commerce'] },
    host: { memberRoles: { 'uid-admin': 'admin', 'uid-editor': 'editor', 'uid-viewer': 'viewer' } },
  }
  sites[OTHER_HOST] = {
    org: { name: 'Other', plan: 'pro', enabledPlugins: [] },
    host: { memberRoles: { 'uid-admin': 'admin' } },
  }
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
  getOrgForHost: async (hostId: string) => (sites[hostId] ? { orgId: ORG, org: sites[hostId].org } : null),
  getHostDocAdmin: async (hostId: string) => sites[hostId]?.host ?? null,
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: (org: { plan?: string }) => org?.plan !== 'free',
}))

/* ---------------------------------------------------------------- vendor */

interface Call {
  method: string
  url: string
  path: string
  body: any
}

let calls: Call[] = []
let reply: (call: Call) => { status: number; body?: unknown } | Promise<never>

const vendorFetch: ProviderFetch = async (url, init = {}) => {
  const call: Call = {
    method: String(init.method ?? 'GET'),
    url: String(url),
    path: new URL(String(url)).pathname,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  }
  calls.push(call)
  const answer = await reply(call)
  return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), { status: answer.status })
}

/** A healthy AvaTax sandbox. */
function avalaraReply(call: Call): { status: number; body?: unknown } {
  if (call.path.endsWith('/utilities/ping')) return { status: 200, body: { authenticated: true } }
  if (call.path === '/api/v2/companies') return { status: 200, body: { value: [{ name: 'Candles', companyCode: 'DEFAULT' }] } }
  if (call.path === '/api/v2/addresses/resolve') {
    return {
      status: 200,
      body: { validatedAddresses: [{ ...call.body, line1: String(call.body.line1).toUpperCase(), addressType: 'StreetOrResidentialAddress' }], messages: [] },
    }
  }
  if (call.path === '/api/v2/transactions/create') {
    // 8.25% of every non-NT line, shipping untaxed.
    const lines = call.body.lines.map((line: any) => ({
      lineNumber: line.number,
      tax: line.taxCode === 'NT' || line.number === 'shipping' ? 0 : Math.round(line.amount * 8.25) / 100,
    }))
    return { status: 201, body: { totalTax: lines.reduce((sum: number, line: any) => sum + line.tax, 0), lines } }
  }
  if (call.method === 'GET' && call.path.includes('/transactions/')) return { status: 404, body: {} }
  return { status: 200, body: {} }
}

const SHIP_FROM = { line1: '1 Main St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' }

function connect(overrides: Record<string, unknown> = {}) {
  const keyring = parseSecretBoxKeyring(TOKEN_KEY)
  db.docs.set(`taxEngineConnections/${HOST}`, {
    orgId: ORG,
    hostId: HOST,
    provider: 'avalara',
    environment: 'sandbox',
    accountId: '2000123456',
    companyCode: null,
    ...sealApiToken('license-key', HOST, keyring),
    shipFrom: SHIP_FROM,
    shipFromValidated: true,
    defaultTaxCode: 'P0000000',
    recordTransactions: true,
    lastTestOk: true,
    lastTestAtMs: 1,
    lastError: null,
    connectedByUid: 'uid-admin',
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  })
}

beforeEach(() => {
  db = createMemoryFirestore()
  setTaxEnginesDbForTests(db)
  setTaxEnginesFetchForTests(vendorFetch)
  process.env[TAX_ENGINES_ENV.tokenKey] = TOKEN_KEY
  calls = []
  reply = avalaraReply
  resetSites()
  resetPluginServicesForTests()
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

afterAll(() => {
  setTaxEnginesDbForTests(null)
  setTaxEnginesFetchForTests(null)
  delete process.env[TAX_ENGINES_ENV.tokenKey]
})

/* ------------------------------------------------------------------ quote */

describe('the quote commerce asks for', () => {
  const REQUEST = {
    hostId: HOST,
    currency: 'usd',
    channel: 'online' as const,
    lines: [
      { id: '0', productId: 'prod-mug', quantity: 2, amountCents: 4_000 },
      { id: '1', productId: 'prod-card', quantity: 1, amountCents: 1_000, exempt: true },
    ],
    shipTo: { line1: '9 Elm', city: 'Dallas', region: 'TX', postalCode: '75201', country: 'US' },
    customer: { email: 'Buyer@Example.com' },
  }

  it('prices each line with its product’s tax code, then the site’s default; an exempt line is zero', async () => {
    connect()
    db.docs.set(`taxEngineProductCodes/${HOST}__prod-mug`, { orgId: ORG, hostId: HOST, taxCode: 'PC040100' })
    const quote = await quoteTax(REQUEST)
    expect(quote).toEqual({
      provider: 'avalara',
      providerLabel: 'Avalara AvaTax',
      taxCents: 330,
      lines: [
        { id: '0', taxCents: 330 },
        { id: '1', taxCents: 0 },
      ],
      shippingTaxCents: 0,
      sandbox: true,
    })
    const sent = calls.find((call) => call.path === '/api/v2/transactions/create')?.body
    expect(sent.lines.map((line: any) => line.taxCode)).toEqual(['PC040100', 'NT'])
    expect(sent.customerCode).toBe('buyer@example.com')
    expect(sent.addresses.shipTo.city).toBe('Dallas')
  })

  it('taxes an in-person sale at the store’s own address', async () => {
    connect()
    await quoteTax({ ...REQUEST, channel: 'pos' })
    const sent = calls.find((call) => call.path === '/api/v2/transactions/create')?.body
    expect(sent.addresses.shipTo).toEqual(SHIP_FROM)
  })

  it('applies an exemption the merchant recorded, where it covers the destination', async () => {
    connect()
    db.docs.set(`taxEngineExemptions/${exemptionId(HOST, 'buyer@example.com')}`, {
      orgId: ORG,
      hostId: HOST,
      email: 'buyer@example.com',
      type: 'nonprofit',
      certificateNumber: 'EX-9',
      regions: ['TX'],
    })
    await quoteTax(REQUEST)
    expect(calls.find((call) => call.path === '/api/v2/transactions/create')?.body).toMatchObject({
      entityUseCode: 'E',
      exemptionNo: 'EX-9',
    })
    calls = []
    await quoteTax({ ...REQUEST, shipTo: { ...REQUEST.shipTo, region: 'CA' } })
    expect(calls.find((call) => call.path === '/api/v2/transactions/create')?.body.entityUseCode).toBeUndefined()
  })

  it('refuses, for the caller to fall back, with no key, no connection, no ship-from or the plugin off', async () => {
    await expect(quoteTax(REQUEST)).rejects.toThrow('no tax service is connected')
    connect({ shipFrom: null })
    await expect(quoteTax(REQUEST)).rejects.toThrow('no complete ship-from address')
    connect()
    sites[HOST].host = { ...sites[HOST].host, disabledPlugins: ['tax-engines'] }
    await expect(quoteTax(REQUEST)).rejects.toThrow('switched off')
    resetSites()
    sites[HOST].org = { ...sites[HOST].org, enabledPlugins: [] }
    await expect(quoteTax(REQUEST)).rejects.toThrow('switched off')
    resetSites()
    delete process.env[TAX_ENGINES_ENV.tokenKey]
    await expect(quoteTax(REQUEST)).rejects.toThrow('no tax-engine key')
    expect(calls).toHaveLength(0)
  })

  it('answers core’s contract once declared, and core’s deadline turns a hung vendor into a fallback', async () => {
    registerTaxEnginesServerDeclarations()
    expect(pluginTaxEngine()).not.toBeNull()
    connect()
    await expect(pluginTaxEngine()!.status(HOST)).resolves.toEqual({
      connected: true,
      provider: 'avalara',
      providerLabel: 'Avalara AvaTax',
      sandbox: true,
    })
    const quoted = await quotePluginTaxEngine(REQUEST)
    expect(quoted).toMatchObject({ ok: true, quote: { taxCents: 330 } })
    reply = () => new Promise<never>(() => undefined)
    await expect(quotePluginTaxEngine(REQUEST, { timeoutMs: 30 })).resolves.toMatchObject({
      ok: false,
      reason: 'timeout',
    })
    reply = () => ({ status: 401, body: { error: { code: 'AuthenticationException', message: 'Bad key' } } })
    await expect(quotePluginTaxEngine(REQUEST)).resolves.toMatchObject({
      ok: false,
      reason: 'error',
      message: 'Avalara: Bad key',
    })
  })
})

/* ---------------------------------------------------------- order events */

const ORDER = {
  id: 'order-1',
  channel: 'online',
  currency: 'usd',
  customerEmail: 'buyer@example.com',
  lineItems: [{ productId: 'prod-mug', name: 'Mug', quantity: 2, unitAmountCents: 2_000 }],
  totals: { itemsCents: 4_000, shippingCents: 500, taxCents: 330, discountCents: 0, totalCents: 4_830 },
  shippingAddress: { line1: '9 Elm', city: 'Dallas', state: 'TX', postalCode: '75201', country: 'US' },
  taxEngine: { provider: 'avalara', status: 'quoted' },
}

function envelope<P>(payload: P, overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    event: 'order.paid',
    hostId: HOST,
    orgId: ORG,
    occurredAtMs: Date.UTC(2026, 9, 7),
    attempt: 1,
    payload,
    ...overrides,
  }
}

const record = () => db.docs.get(`taxEngineTransactions/${transactionId(HOST, 'order-1')}`)

describe('recording a paid order', () => {
  it('leaves alone an order no tax service priced', async () => {
    connect()
    await onOrderPaid(envelope({ order: { ...ORDER, taxEngine: null } }))
    expect(calls).toHaveLength(0)
    expect(record()).toBeUndefined()
  })

  it('records it once, at the tax collected, at the shopper’s address; a redelivery sends nothing', async () => {
    connect()
    await onOrderPaid(envelope({ order: ORDER }))
    const commit = calls.find((call) => call.path === '/api/v2/transactions/createoradjust')
    expect(commit?.body.createTransactionModel).toMatchObject({
      code: 'order-1',
      date: '2026-10-07',
      commit: true,
      addresses: { shipTo: { city: 'Dallas', region: 'TX' } },
      taxOverride: { taxAmount: 3.3 },
    })
    expect(record()).toMatchObject({ status: 'committed', orgId: ORG, provider: 'avalara', fallbackReason: null })
    calls = []
    await onOrderPaid(envelope({ order: ORDER }, { attempt: 2 }))
    expect(calls).toHaveLength(0)
  })

  it('records a fallback sale too, and says it fell back', async () => {
    connect()
    await onOrderPaid(envelope({ order: { ...ORDER, taxEngine: { provider: 'avalara', status: 'fallback', reason: 'timeout' } } }))
    expect(record()).toMatchObject({ status: 'committed', fallbackReason: 'timeout' })
  })

  it('throws a vendor outage back to the outbox, and gives up as failed on the last attempt', async () => {
    connect()
    reply = (call) => (call.path.endsWith('createoradjust') ? { status: 503, body: {} } : avalaraReply(call))
    await expect(onOrderPaid(envelope({ order: ORDER }))).rejects.toMatchObject({ status: 503 })
    expect(record()).toMatchObject({ status: 'pending' })
    await onOrderPaid(envelope({ order: ORDER }, { attempt: 8 }))
    expect(record()).toMatchObject({ status: 'failed', attempts: 8 })
  })

  it('records a refusal as failed at once, with the vendor’s sentence, and a person can retry it', async () => {
    connect()
    reply = (call) =>
      call.path.endsWith('createoradjust')
        ? { status: 400, body: { error: { code: 'InvalidAddress', message: 'Address not found' } } }
        : avalaraReply(call)
    await onOrderPaid(envelope({ order: ORDER }))
    expect(record()).toMatchObject({ status: 'failed', lastError: 'Avalara: Address not found' })
    reply = avalaraReply
    const response = await orderTransactionRetryRoute(post(TAX_ENGINES_API_ROUTES.orderTransactionRetry, { hostId: HOST, orderId: 'order-1' }, 'tok-editor'))
    expect(response.status).toBe(200)
    expect((await response.json()).transaction).toMatchObject({ status: 'committed', lastError: null })
  })

  it('records nothing where the merchant switched recording off', async () => {
    connect({ recordTransactions: false })
    await onOrderPaid(envelope({ order: ORDER }))
    expect(calls).toHaveLength(0)
    expect(record()).toBeUndefined()
  })

  it('files a long Checkout Session id under a code AvaTax takes, distinct per order', () => {
    const long = `cs_test_${'a'.repeat(60)}`
    expect(saleCode(long)).toHaveLength(50)
    expect(saleCode(long)).not.toBe(saleCode(`${long}b`))
    expect(refundCode('order-1', 're_1')).not.toBe(refundCode('order-1', 're_2'))
  })
})

describe('reversing a recorded order', () => {
  beforeEach(async () => {
    connect()
    await onOrderPaid(envelope({ order: ORDER }))
    calls = []
  })

  it('reverses a partial refund by its share, once, and a full refund after it by what is left', async () => {
    await onOrderRefunded(
      envelope({ order: ORDER, refund: { id: 're_1', amountCents: 1_200, full: false } }, { id: 'evt-2', event: 'order.refunded' }),
    )
    const first = calls.find((call) => call.path.endsWith('/refund'))
    expect(first?.body).toMatchObject({
      refundType: 'Percentage',
      refundPercentage: Math.round((1_200 / 4_830) * 1_000_000) / 10_000,
      refundTransactionCode: refundCode('order-1', 're_1'),
    })
    calls = []
    await onOrderRefunded(
      envelope({ order: ORDER, refund: { id: 're_1', amountCents: 1_200, full: false } }, { id: 'evt-2', event: 'order.refunded', attempt: 2 }),
    )
    expect(calls).toHaveLength(0)
    await onOrderRefunded(
      envelope({ order: ORDER, refund: { id: 're_2', amountCents: 3_630, full: true } }, { id: 'evt-3', event: 'order.refunded' }),
    )
    const rest = calls.find((call) => call.path.endsWith('/refund'))
    expect(rest?.body.refundType).toBe('Percentage')
    expect(rest?.body.refundPercentage).toBeCloseTo((3_630 / 4_830) * 100, 3)
    expect(record()?.refunds).toEqual({
      re_1: expect.objectContaining({ amountCents: 1_200, full: false }),
      re_2: expect.objectContaining({ amountCents: 3_630, full: true }),
    })
  })

  it('reverses a register return with no Stripe refund id under the event’s own id', async () => {
    await onOrderRefunded(
      envelope({ order: ORDER, refund: { id: null, amountCents: 4_830, full: true } }, { id: 'evt-cash', event: 'order.refunded' }),
    )
    expect(calls.find((call) => call.path.endsWith('/refund'))?.body.refundType).toBe('Full')
    expect(Object.keys(record()?.refunds ?? {})).toEqual(['evt-cash'])
  })

  it('waits for a sale still on its way before reversing it', async () => {
    db.docs.set(`taxEngineTransactions/${transactionId(HOST, 'order-1')}`, { ...record(), status: 'pending' })
    await expect(
      onOrderRefunded(envelope({ order: ORDER, refund: { id: 're_1', amountCents: 100 } }, { event: 'order.refunded' })),
    ).rejects.toThrow('not yet recorded')
  })

  it('voids a canceled order nothing was refunded on, and leaves one a refund already reversed', async () => {
    await onOrderCancelled(envelope({ order: ORDER }, { event: 'order.cancelled' }))
    expect(calls.find((call) => call.path.endsWith('/void'))).toBeDefined()
    expect(record()).toMatchObject({ status: 'voided' })

    db.docs.set(`taxEngineTransactions/${transactionId(HOST, 'order-1')}`, {
      ...record(),
      status: 'committed',
      refunds: { re_1: { amountCents: 4_830, full: true, atMs: 1 } },
    })
    calls = []
    await onOrderCancelled(envelope({ order: ORDER }, { event: 'order.cancelled' }))
    expect(calls).toHaveLength(0)
  })
})

/* ----------------------------------------------------------------- routes */

function get(route: string, query: Record<string, string>, token?: string): Request {
  const url = new URL(`https://console.test/api/${route}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })
}

function post(route: string, body: unknown, token?: string): Request {
  return new Request(`https://console.test/api/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

describe('the console routes', () => {
  const CONNECT = {
    hostId: HOST,
    provider: 'avalara',
    environment: 'sandbox',
    accountId: '2000123456',
    secret: 'license-key-123',
  }

  it('do not exist on a deployment without the sealing key', async () => {
    delete process.env[TAX_ENGINES_ENV.tokenKey]
    const response = await connectionRoute(get(TAX_ENGINES_API_ROUTES.connection, { hostId: HOST }, 'tok-admin'))
    expect(response.status).toBe(404)
  })

  it('refuse a missing token, an unverified address, another site and a role too low', async () => {
    expect((await connectionRoute(get(TAX_ENGINES_API_ROUTES.connection, { hostId: HOST }))).status).toBe(401)
    expect((await connectionRoute(get(TAX_ENGINES_API_ROUTES.connection, { hostId: HOST }, 'tok-unverified'))).status).toBe(403)
    expect((await connectionRoute(get(TAX_ENGINES_API_ROUTES.connection, { hostId: OTHER_HOST }, 'tok-admin'))).status).toBe(404)
    expect((await connectionRoute(get(TAX_ENGINES_API_ROUTES.connection, { hostId: HOST }, 'tok-outsider'))).status).toBe(403)
    expect((await connectRoute(post(TAX_ENGINES_API_ROUTES.connect, CONNECT, 'tok-editor'))).status).toBe(403)
    expect((await exemptionsRoute(get(TAX_ENGINES_API_ROUTES.exemptions, { hostId: HOST }, 'tok-viewer'))).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('store nothing for credentials the vendor refused', async () => {
    reply = () => ({ status: 200, body: { authenticated: false } })
    const response = await connectRoute(post(TAX_ENGINES_API_ROUTES.connect, CONNECT, 'tok-admin'))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('did not accept')
    expect(db.docs.get(`taxEngineConnections/${HOST}`)).toBeUndefined()
  })

  it('seal accepted credentials, and never hand the secret back', async () => {
    const response = await connectRoute(post(TAX_ENGINES_API_ROUTES.connect, CONNECT, 'tok-admin'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.detail).toBe('Connected to Candles (DEFAULT)')
    const stored = db.docs.get(`taxEngineConnections/${HOST}`)!
    expect(JSON.stringify(stored)).not.toContain('license-key-123')
    expect(stored).toMatchObject({ orgId: ORG, hostId: HOST, provider: 'avalara', lastTestOk: true, connectedByUid: 'uid-admin' })
    const read = await connectionRoute(get(TAX_ENGINES_API_ROUTES.connection, { hostId: HOST }, 'tok-viewer'))
    const text = await read.text()
    expect(text).not.toContain('license-key-123')
    expect(text).not.toContain('sealedApiToken')
    expect(JSON.parse(text).connection).toMatchObject({ provider: 'avalara', environment: 'sandbox' })
  })

  it('refuse an AvaTax connection without an account id, before calling anyone', async () => {
    const response = await connectRoute(post(TAX_ENGINES_API_ROUTES.connect, { ...CONNECT, accountId: 'abc' }, 'tok-admin'))
    expect(response.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('test the stored credentials again and record the verdict', async () => {
    connect()
    reply = () => ({ status: 401, body: { error: { message: 'The license key is invalid' } } })
    const response = await testRoute(post(TAX_ENGINES_API_ROUTES.test, { hostId: HOST }, 'tok-admin'))
    expect(await response.json()).toMatchObject({ ok: false, connection: { lastTestOk: false } })
    expect(db.docs.get(`taxEngineConnections/${HOST}`)).toMatchObject({ lastError: 'Avalara: The license key is invalid' })
  })

  it('save a ship-from address as the vendor confirmed it, and refuse an incomplete one', async () => {
    connect({ shipFrom: null, shipFromValidated: false })
    const incomplete = await settingsRoute(post(TAX_ENGINES_API_ROUTES.settings, { hostId: HOST, shipFrom: { country: 'US', region: 'TX' } }, 'tok-admin'))
    expect(incomplete.status).toBe(400)
    const saved = await settingsRoute(post(TAX_ENGINES_API_ROUTES.settings, { hostId: HOST, shipFrom: SHIP_FROM, defaultTaxCode: 'p0000000' }, 'tok-admin'))
    expect((await saved.json()).connection).toMatchObject({
      shipFrom: { line1: '1 MAIN ST' },
      shipFromValidated: true,
      defaultTaxCode: 'P0000000',
    })
  })

  it('keep a product’s tax code, and clear it', async () => {
    connect()
    const set = await productTaxCodeRoute(post(TAX_ENGINES_API_ROUTES.productTaxCode, { hostId: HOST, productId: 'prod-mug', taxCode: 'pc040100' }, 'tok-editor'))
    expect(await set.json()).toEqual({ taxCode: 'PC040100' })
    const read = await productTaxCodeRoute(get(TAX_ENGINES_API_ROUTES.productTaxCode, { hostId: HOST, productId: 'prod-mug' }, 'tok-viewer'))
    expect(await read.json()).toEqual({ taxCode: 'PC040100' })
    const bad = await productTaxCodeRoute(post(TAX_ENGINES_API_ROUTES.productTaxCode, { hostId: HOST, productId: 'prod-mug', taxCode: 'no spaces!' }, 'tok-editor'))
    expect(bad.status).toBe(400)
    await productTaxCodeRoute(post(TAX_ENGINES_API_ROUTES.productTaxCode, { hostId: HOST, productId: 'prod-mug', taxCode: '' }, 'tok-editor'))
    expect(db.docs.get(`taxEngineProductCodes/${HOST}__prod-mug`)).toBeUndefined()
  })

  it('record, list and remove exempt customers, and never another site’s', async () => {
    connect()
    const saved = await exemptionsRoute(
      post(TAX_ENGINES_API_ROUTES.exemptions, { hostId: HOST, email: 'Church@Example.org ', type: 'religious', certificateNumber: 'R-1', regions: ['tx', 'bad region'] }, 'tok-editor'),
    )
    const { exemption } = await saved.json()
    expect(exemption).toMatchObject({ email: 'church@example.org', type: 'religious', regions: ['TX'] })
    const listed = await exemptionsRoute(get(TAX_ENGINES_API_ROUTES.exemptions, { hostId: HOST }, 'tok-editor'))
    expect((await listed.json()).exemptions).toHaveLength(1)
    const foreign = await exemptionsDeleteRoute(post(TAX_ENGINES_API_ROUTES.exemptionsDelete, { hostId: HOST, id: `${OTHER_HOST}__x` }, 'tok-editor'))
    expect(foreign.status).toBe(400)
    await exemptionsDeleteRoute(post(TAX_ENGINES_API_ROUTES.exemptionsDelete, { hostId: HOST, id: exemption.id }, 'tok-editor'))
    expect(db.docs.get(`taxEngineExemptions/${exemption.id}`)).toBeUndefined()
  })

  it('show an order’s record, and forget the credentials on disconnect but keep the records', async () => {
    connect()
    await onOrderPaid(envelope({ order: ORDER }))
    const shown = await orderTransactionRoute(get(TAX_ENGINES_API_ROUTES.orderTransaction, { hostId: HOST, orderId: 'order-1' }, 'tok-editor'))
    expect((await shown.json()).transaction).toMatchObject({ status: 'committed', taxCents: 330, code: 'order-1' })
    await disconnectRoute(post(TAX_ENGINES_API_ROUTES.disconnect, { hostId: HOST }, 'tok-admin'))
    expect(db.docs.get(`taxEngineConnections/${HOST}`)).toBeUndefined()
    expect(record()).toBeDefined()
  })
})
