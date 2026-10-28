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
 *
 * @jest-environment node
 */

/**
 * A card reader sold in person, onto the buyer's store (AGL-4038), through
 * the real routes with Firestore and Stripe faked:
 *
 * - serial numbers taken at the sale, before or after it is recorded, each
 *   once across every sale;
 * - a reader registered by its code with a serial on a sale: its unit is
 *   matched, the order moves to Set up once every reader is, and a sale
 *   nobody attached joins the workspace that registered it; a sale attached
 *   to another workspace is left alone;
 * - registering at the booth, with every prerequisite said;
 * - the buyer's waiting readers, read without the point of sale plan, the
 *   store chosen at setup, and Mark set up.
 */

import type { PluginApiHandler, PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { resetFakeFirestore } from '../testing/fake-firestore'

/** The plan of each workspace. */
const mockPlans: Record<string, string> = { 'org-seller': 'business', 'org-pat': 'business', 'org-other': 'business' }
const mockOwners: Record<string, string> = {
  'host-seller': 'org-seller',
  'host-pat-1': 'org-pat',
  'host-pat-2': 'org-pat',
  'host-other': 'org-other',
}
let mockSerial = 'STRE710-001'
const mockStripe: Array<{ method: string; path: string; params?: Record<string, unknown> }> = []
const mockAudits: Array<Record<string, any>> = []

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: true } }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (!['cashier', 'pat'].includes(token)) throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
            return { uid: token === 'pat' ? 'uid-pat' : 'cashier-1', email_verified: true }
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async (hostId: string) => ({
      orgId: mockOwners[hostId],
      org: { id: mockOwners[hostId], plan: mockPlans[mockOwners[hostId]], subscriptionStatus: 'active', ownerUid: 'owner' },
    }),
    readOrgBilling: async () => ({}),
    consumeRateLimit: async () => ({ allowed: true }),
    hostDisplayName: (host: Record<string, unknown>, id: string) => String(host['name'] ?? id),
  }
})
jest.mock('@aglyn/tenant-data-admin/server/host-console-link', () => ({
  hostConsoleUrl: async (hostId: string, link: string) => `https://console.example.com/ws/hosts/${hostId}${link.replace(`/${hostId}`, '')}`,
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit', () => ({ maskEmailAddress: () => '***' }))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  addAdminAudit: async (_firestore: unknown, entry: Record<string, any>) => {
    mockAudits.push(entry)
    return { id: 'audit' }
  },
}))
// A new Location applies the store's start-up screen; not this spec's subject.
jest.mock('./pos-reader-splash', () => ({ applyPosReaderSplash: async () => undefined }))
jest.mock('./pos-stripe', () => ({
  posTerminalAvailable: () => true,
  posStripeTestMode: () => false,
  posStripeErrorMessage: (_body: unknown, fallback: string) => fallback,
  posStripe: async (method: string, path: string, options?: { params?: Record<string, unknown> }) => {
    mockStripe.push({ method, path, ...(options?.params ? { params: options.params } : {}) })
    if (path === 'terminal/locations') {
      return { ok: true, status: 200, body: { id: 'tml_new', livemode: true } }
    }
    if (path === 'terminal/readers') {
      return {
        ok: true,
        status: 200,
        body: { id: `tmr_${mockStripe.length}`, serial_number: mockSerial, device_type: 'stripe_s700', status: 'online', livemode: true },
      }
    }
    if (method === 'GET' && path === 'terminal/locations/tml_pat') {
      return {
        ok: true,
        status: 200,
        body: { id: 'tml_pat', address: { line1: '1 Market Sq', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } },
      }
    }
    return { ok: false, status: 404, body: {} }
  },
}))

import { fakeDocs } from '../testing/fake-firestore'
import { POS_HARDWARE_ENV, posHardwareSaleRecord } from '../model/pos-hardware'
import { inPersonPosHardwareOrder, posHardwareRegisterShare } from '../model/pos-hardware-in-person'
import { posHardwareSaleHandler } from './pos-hardware-sale'
import { posHardwareHandler, posHardwareInPersonOrderId } from './pos-hardware'
import { recordInPersonPosHardwareSale } from './pos-hardware-in-person'
import { registerPosTerminalReader } from './pos-readers'

const ENV_KEYS = [POS_HARDWARE_ENV.inPersonEnabled, POS_HARDWARE_ENV.sellerHostId, POS_HARDWARE_ENV.sellerOrgId]

function response() {
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

let keys = 0
async function call(
  handler: PluginApiHandler,
  body: Record<string, unknown>,
  token = 'cashier',
) {
  const { res, result } = response()
  await handler(
    {
      method: 'POST',
      query: {},
      body,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': `key-${++keys}` },
      cookies: {},
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}
const sale = (body: Record<string, unknown>) => call(posHardwareSaleHandler, { hostId: 'host-seller', ...body })
const merchant = (body: Record<string, unknown>) => call(posHardwareHandler, body, 'pat')

function paidSale(id: string, fields: Record<string, unknown> = {}) {
  fakeDocs.set(`hosts/host-seller/orders/${id}`, {
    status: 'paid',
    channel: 'pos',
    number: 3,
    lineItems: [{ productId: 'reader', name: 'Stripe Reader S710', quantity: 2, unitAmountCents: 30_000 }],
    totals: { itemsCents: 60_000, shippingCents: 0, discountCents: 0, taxCents: 4_950, totalCents: 64_950, feeCents: 0 },
    payments: [{ id: 'pay_cash', method: 'cash', amountCents: 64_950, status: 'succeeded', atMs: 900 }],
    paidAtMs: 1_000,
    ...fields,
  })
}

/** An in-person order already in a workspace, with its sale record. */
function seedOrder(id: string, orgId: string, fields: Record<string, unknown> = {}) {
  const order = {
    ...inPersonPosHardwareOrder({
      sellerHostId: 'host-seller',
      sellerOrgId: 'org-seller',
      registerOrderId: `register-${id}`,
      number: 1,
      registerId: null,
      kiosk: false,
      offline: false,
      share: posHardwareRegisterShare({ lines: [{ sku: 'stripe-reader-s710', quantity: 1, unitAmountCents: 30_000 }], discountCents: 0, taxCents: 0 })!,
      paidAtMs: 1_000,
      tenders: ['cash'],
      paymentLinkSessionId: null,
      receiptEmail: null,
      buyer:
        orgId === 'org-seller'
          ? null
          : { uid: 'uid-pat', orgId, hostId: null, email: 'pat@example.com', attachedBy: 'cashier-1', attachedAtMs: 1_000 },
      serials: ['STRE710-001'],
      taxRegion: { country: 'US', state: 'TX', postalCode: null },
      ratePct: null,
      stripeAccountId: null,
      livemode: true,
    }),
    ...fields,
  } as any
  fakeDocs.set(`orgs/${order.orgId}/hardwareOrders/${id}`, order)
  fakeDocs.set(`posHardwareSales/${id}`, posHardwareSaleRecord(id, order) as any)
  return order
}

beforeEach(() => {
  resetFakeFirestore()
  mockStripe.length = 0
  mockAudits.length = 0
  mockSerial = 'STRE710-001'
  mockPlans['org-pat'] = 'business'
  process.env[POS_HARDWARE_ENV.inPersonEnabled] = 'true'
  process.env[POS_HARDWARE_ENV.sellerHostId] = 'host-seller'
  process.env[POS_HARDWARE_ENV.sellerOrgId] = 'org-seller'
  fakeDocs.set('hosts/host-seller', { name: 'Booth', orgId: 'org-seller' })
  fakeDocs.set('hosts/host-seller/products/reader', { name: 'Stripe Reader S710', hardwareSku: 'stripe-reader-s710' })
  fakeDocs.set('hosts/host-pat-1', { name: 'Main Street', orgId: 'org-pat' })
  fakeDocs.set('hosts/host-pat-1/terminal/config', { stripeLocationId: 'tml_pat' })
  fakeDocs.set('hosts/host-pat-2', { name: 'Pop-up', orgId: 'org-pat' })
  fakeDocs.set('hosts/host-other', { name: 'Elsewhere', orgId: 'org-other' })
  fakeDocs.set('hosts/host-other/terminal/config', { stripeLocationId: 'tml_other' })
  fakeDocs.set('orgs/org-pat', { name: 'Acme Builders', plan: 'business', subscriptionStatus: 'active' })
})

afterAll(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('serial numbers taken at the sale', () => {
  it('ride an open sale and land on its readers when it is recorded', async () => {
    paidSale('open-1', { status: 'pending' })
    const saved = await sale({ action: 'serials', registerOrderId: 'open-1', serials: ['stre710-001', ' stre710 002 '] })
    expect(saved.body).toEqual({ ok: true, serials: ['STRE710-001', 'STRE710002'], recorded: false })
    fakeDocs.set('hosts/host-seller/orders/open-1', { ...fakeDocs.get('hosts/host-seller/orders/open-1'), status: 'paid' })
    await recordInPersonPosHardwareSale('host-seller', 'open-1')
    const order = fakeDocs.get(`orgs/org-seller/hardwareOrders/${posHardwareInPersonOrderId('host-seller', 'open-1')}`)!
    expect(order['serialNumbers']).toEqual(['STRE710-001', 'STRE710002'])
    expect(order['units'].map((unit: any) => unit.serialNumber)).toEqual(['STRE710-001', 'STRE710002'])
  })

  it('fill the readers of a recorded sale, once across every sale', async () => {
    paidSale('paid-1')
    await recordInPersonPosHardwareSale('host-seller', 'paid-1')
    const id = posHardwareInPersonOrderId('host-seller', 'paid-1')
    expect((await sale({ action: 'serials', orderId: id, serials: ['A-1'] })).body.recorded).toBe(true)
    expect(fakeDocs.get(`orgs/org-seller/hardwareOrders/${id}`)?.['serialNumbers']).toEqual(['A-1'])
    expect((await sale({ action: 'serials', orderId: id, serials: ['A-1', 'A-1'] })).status).toBe(400)
    expect((await sale({ action: 'serials', orderId: id, serials: ['A-1', 'A-2', 'A-3'] })).status).toBe(400)
    paidSale('paid-2')
    await recordInPersonPosHardwareSale('host-seller', 'paid-2')
    const other = await sale({ action: 'serials', orderId: posHardwareInPersonOrderId('host-seller', 'paid-2'), serials: ['A-1'] })
    expect(other.status).toBe(409)
  })
})

describe('a reader registered with a serial from a sale', () => {
  it("sets up its unit, and the order once every reader is, on the buyer's workspace", async () => {
    seedOrder('hw_aaaaaaaaaaaaaaaaaaaa', 'org-pat')
    const registered = await registerPosTerminalReader({ hostId: 'host-pat-1', orgId: 'org-pat', uid: 'uid-pat', registrationCode: 'abc-123' })
    expect(registered.ok).toBe(true)
    const order = fakeDocs.get('orgs/org-pat/hardwareOrders/hw_aaaaaaaaaaaaaaaaaaaa')!
    expect(order).toMatchObject({ status: 'registered', hostId: 'host-pat-1', registeredAtMs: expect.any(Number) })
    expect(order['units'][0]).toMatchObject({ serialNumber: 'STRE710-001', readerId: 'tmr_1', hostId: 'host-pat-1' })
    expect(fakeDocs.get('posHardwareSales/hw_aaaaaaaaaaaaaaaaaaaa')).toMatchObject({ status: 'registered' })
  })

  it('attaches a sale nobody attached to the workspace that registered its reader', async () => {
    seedOrder('hw_bbbbbbbbbbbbbbbbbbbb', 'org-seller')
    await registerPosTerminalReader({ hostId: 'host-pat-1', orgId: 'org-pat', uid: 'uid-pat', registrationCode: 'abc-123' })
    expect(fakeDocs.has('orgs/org-seller/hardwareOrders/hw_bbbbbbbbbbbbbbbbbbbb')).toBe(false)
    expect(fakeDocs.get('orgs/org-pat/hardwareOrders/hw_bbbbbbbbbbbbbbbbbbbb')).toMatchObject({
      status: 'registered',
      createdBy: 'uid-pat',
      attachment: { state: 'attached', orgId: 'org-pat', hostId: 'host-pat-1' },
    })
    expect(fakeDocs.get('posHardwareSales/hw_bbbbbbbbbbbbbbbbbbbb')?.['orgId']).toBe('org-pat')
    // The reseller's records take the address of the store it was set up on (AGL-4038).
    expect(fakeDocs.get('posHardwareSales/hw_bbbbbbbbbbbbbbbbbbbb')?.['buyer']).toMatchObject({
      address: { line1: '1 Market Sq', city: 'Austin', postalCode: '78701', country: 'US' },
    })
  })

  it("leaves a sale attached to another workspace alone, and a reader with no serial on a sale changes nothing", async () => {
    seedOrder('hw_cccccccccccccccccccc', 'org-pat')
    await registerPosTerminalReader({ hostId: 'host-other', orgId: 'org-other', uid: 'uid-other', registrationCode: 'abc-123' })
    expect(fakeDocs.get('orgs/org-pat/hardwareOrders/hw_cccccccccccccccccccc')?.['status']).toBe('delivered')
    mockSerial = 'UNKNOWN-9'
    await registerPosTerminalReader({ hostId: 'host-pat-1', orgId: 'org-pat', uid: 'uid-pat', registrationCode: 'abc-124' })
    expect(fakeDocs.get('orgs/org-pat/hardwareOrders/hw_cccccccccccccccccccc')?.['status']).toBe('delivered')
  })
})

describe('registering at the booth', () => {
  it("registers the reader to the buyer's chosen store and sets the sale up", async () => {
    paidSale('paid-3', {
      lineItems: [{ productId: 'reader', name: 'Stripe Reader S710', quantity: 1, unitAmountCents: 30_000 }],
      hardwareBuyer: { uid: 'uid-pat', orgId: 'org-pat', hostId: 'host-pat-1', email: 'pat@example.com', attachedBy: 'cashier-1', attachedAtMs: 950 },
    })
    await recordInPersonPosHardwareSale('host-seller', 'paid-3')
    mockSerial = 'NOT-TAKEN-1'
    const result = await sale({ action: 'register-at-booth', registerOrderId: 'paid-3', registrationCode: 'abc-125' })
    expect(result.status).toBe(200)
    expect(mockStripe.find((entry) => entry.path === 'terminal/readers')?.params).toMatchObject({
      registration_code: 'abc-125',
      location: 'tml_pat',
      'metadata[hostId]': 'host-pat-1',
    })
    expect(fakeDocs.has(`hosts/host-pat-1/terminalReaders/${result.body.readerId}`)).toBe(true)
    const order = fakeDocs.get(`orgs/org-pat/hardwareOrders/${posHardwareInPersonOrderId('host-seller', 'paid-3')}`)!
    expect(order).toMatchObject({ status: 'registered' })
    expect(order['units'][0]).toMatchObject({ readerId: result.body.readerId, serialNumber: 'NOT-TAKEN-1' })
  })

  it('says what is missing: payment, the buyer, their store, their plan, their store’s address', async () => {
    paidSale('open-2', { status: 'pending' })
    expect((await sale({ action: 'register-at-booth', registerOrderId: 'open-2', registrationCode: 'abc' })).body.error).toMatch(/Take payment/)
    paidSale('paid-4')
    await recordInPersonPosHardwareSale('host-seller', 'paid-4')
    expect((await sale({ action: 'register-at-booth', registerOrderId: 'paid-4', registrationCode: 'abc' })).body.error).toMatch(/Attach the sale/)
    paidSale('paid-5', {
      hardwareBuyer: { uid: 'uid-pat', orgId: 'org-pat', hostId: null, email: null, attachedBy: 'c', attachedAtMs: 1 },
    })
    await recordInPersonPosHardwareSale('host-seller', 'paid-5')
    expect((await sale({ action: 'register-at-booth', registerOrderId: 'paid-5', registrationCode: 'abc' })).body.error).toMatch(/Choose the buyer/)
    paidSale('paid-6', {
      hardwareBuyer: { uid: 'uid-pat', orgId: 'org-pat', hostId: 'host-pat-2', email: null, attachedBy: 'c', attachedAtMs: 1 },
    })
    await recordInPersonPosHardwareSale('host-seller', 'paid-6')
    const noAddress = await sale({ action: 'register-at-booth', registerOrderId: 'paid-6', registrationCode: 'abc' })
    expect(noAddress.status).toBe(409)
    expect(noAddress.body).toEqual({ error: expect.stringMatching(/no address for card readers/), reason: 'needs-address' })
    mockPlans['org-pat'] = 'free'
    expect((await sale({ action: 'register-at-booth', registerOrderId: 'paid-6', registrationCode: 'abc' })).body.error).toMatch(/plan with the point of sale/)
    expect(mockStripe).toHaveLength(0)
  })

  /** A sale attached to Pat's pop-up store, which has no card reader location yet. */
  async function popUpSale(id: string) {
    paidSale(id, {
      lineItems: [{ productId: 'reader', name: 'Stripe Reader S710', quantity: 1, unitAmountCents: 30_000 }],
      hardwareBuyer: { uid: 'uid-pat', orgId: 'org-pat', hostId: 'host-pat-2', email: null, attachedBy: 'c', attachedAtMs: 1 },
    })
    await recordInPersonPosHardwareSale('host-seller', id)
  }
  const ADDRESS = { line1: ' 100 Main St ', city: 'Austin', state: 'TX', postalCode: '78701', country: 'us' }

  it("takes the store's address at the booth: makes its location where the POS devices card would, registers, audits", async () => {
    await popUpSale('paid-7')
    const result = await sale({ action: 'register-at-booth', registerOrderId: 'paid-7', registrationCode: 'abc-126', address: ADDRESS })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, storeAddressSaved: true })
    // The store's Location, from the address as typed, trimmed and in capitals.
    expect(mockStripe.find((entry) => entry.path === 'terminal/locations')?.params).toMatchObject({
      'address[line1]': '100 Main St',
      'address[city]': 'Austin',
      'address[state]': 'TX',
      'address[postal_code]': '78701',
      'address[country]': 'US',
      'metadata[hostId]': 'host-pat-2',
      'metadata[orgId]': 'org-pat',
    })
    // Recorded on the store's terminal settings, exactly as the POS devices card's registration records it.
    expect(fakeDocs.get('hosts/host-pat-2/terminal/config')).toMatchObject({ stripeLocationId: 'tml_new' })
    expect(mockStripe.find((entry) => entry.path === 'terminal/readers')?.params).toMatchObject({ location: 'tml_new' })
    const audit = mockAudits.find((entry) => entry.action === 'pos-hardware-register-at-booth')
    expect(audit?.after).toMatchObject({
      hostId: 'host-pat-2',
      storeAddressEntered: { city: 'Austin', state: 'TX', country: 'US' },
    })
    // The street stays with the store.
    expect(JSON.stringify(audit)).not.toMatch(/Main St/)
  })

  it('refuses an address that is missing a field, before anything is made', async () => {
    await popUpSale('paid-8')
    const result = await sale({
      action: 'register-at-booth',
      registerOrderId: 'paid-8',
      registrationCode: 'abc',
      address: { ...ADDRESS, city: ' ' },
    })
    expect(result.status).toBe(400)
    expect(result.body).toEqual({ error: expect.stringMatching(/street, city, postal code and country/), reason: 'needs-address' })
    const badCountry = await sale({
      action: 'register-at-booth',
      registerOrderId: 'paid-8',
      registrationCode: 'abc',
      address: { ...ADDRESS, country: '1' },
    })
    expect(badCountry.status).toBe(400)
    expect(mockStripe).toHaveLength(0)
    expect(fakeDocs.has('hosts/host-pat-2/terminal/config')).toBe(false)
  })

  it("never overwrites a store's existing address: one sent for a store with a location is not used", async () => {
    paidSale('paid-9', {
      lineItems: [{ productId: 'reader', name: 'Stripe Reader S710', quantity: 1, unitAmountCents: 30_000 }],
      hardwareBuyer: { uid: 'uid-pat', orgId: 'org-pat', hostId: 'host-pat-1', email: null, attachedBy: 'c', attachedAtMs: 1 },
    })
    await recordInPersonPosHardwareSale('host-seller', 'paid-9')
    const result = await sale({ action: 'register-at-booth', registerOrderId: 'paid-9', registrationCode: 'abc-127', address: ADDRESS })
    expect(result.status).toBe(200)
    expect(result.body.storeAddressSaved).toBe(false)
    expect(mockStripe.some((entry) => entry.path === 'terminal/locations')).toBe(false)
    expect(fakeDocs.get('hosts/host-pat-1/terminal/config')).toEqual({ stripeLocationId: 'tml_pat' })
    expect(mockAudits.find((entry) => entry.action === 'pos-hardware-register-at-booth')?.after).not.toHaveProperty(
      'storeAddressEntered',
    )
  })
})

describe("the buyer's readers waiting to be set up", () => {
  it('are told even without the point of sale plan, with what each needs', async () => {
    seedOrder('hw_dddddddddddddddddddd', 'org-pat')
    mockPlans['org-pat'] = 'free'
    fakeDocs.set('orgs/org-pat', { name: 'Acme Builders', plan: 'free' })
    const result = await merchant({ action: 'waiting', hostId: 'host-pat-1' })
    expect(result.status).toBe(200)
    expect(result.body.posPlan).toBe(false)
    expect(result.body.stores).toEqual([
      { hostId: 'host-pat-1', name: 'Main Street', hasLocation: true, setupUrl: 'https://console.example.com/ws/hosts/host-pat-1/products/pos#pos-devices' },
      { hostId: 'host-pat-2', name: 'Pop-up', hasLocation: false, setupUrl: 'https://console.example.com/ws/hosts/host-pat-2/products/pos#pos-devices' },
    ])
    expect(result.body.orders).toEqual([expect.objectContaining({ id: 'hw_dddddddddddddddddddd', hostId: '', serialsTaken: 1, source: 'in_person' })])
    // Choosing a store sets a reader up, which needs the plan.
    expect((await merchant({ action: 'choose-store', hostId: 'host-pat-1', orderId: 'hw_dddddddddddddddddddd' })).status).toBe(403)
  })

  it('choose the store, then mark set up', async () => {
    seedOrder('hw_eeeeeeeeeeeeeeeeeeee', 'org-pat')
    const chosen = await merchant({ action: 'choose-store', hostId: 'host-pat-2', orderId: 'hw_eeeeeeeeeeeeeeeeeeee' })
    expect(chosen.status).toBe(200)
    expect(fakeDocs.get('orgs/org-pat/hardwareOrders/hw_eeeeeeeeeeeeeeeeeeee')).toMatchObject({
      hostId: 'host-pat-2',
      attachment: { hostId: 'host-pat-2' },
    })
    const marked = await merchant({ action: 'mark-set-up', hostId: 'host-pat-2', orderId: 'hw_eeeeeeeeeeeeeeeeeeee' })
    expect(marked.body.order.status).toBe('registered')
    expect(fakeDocs.get('posHardwareSales/hw_eeeeeeeeeeeeeeeeeeee')?.['status']).toBe('registered')
    // Another workspace's store cannot take it.
    seedOrder('hw_ffffffffffffffffffff', 'org-pat')
    expect((await merchant({ action: 'choose-store', hostId: 'host-other', orderId: 'hw_ffffffffffffffffffff' })).status).toBe(404)
  })

  it('is nothing while the in-person sale is off', async () => {
    seedOrder('hw_gggggggggggggggggggg', 'org-pat')
    for (const key of ENV_KEYS) delete process.env[key]
    expect((await merchant({ action: 'waiting', hostId: 'host-pat-1' })).body).toEqual({ posPlan: false, stores: [], orders: [] })
  })
})
