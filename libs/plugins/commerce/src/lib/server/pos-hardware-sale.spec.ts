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
 * Selling a card reader in person at the platform's own store's register
 * (AGL-4038), driven through the real route with Firestore faked:
 *
 * - `status` says whether a store is the configured hardware seller, and on
 *   every other store says no and nothing else.
 * - a paid register sale of hardware on the seller store becomes ONE
 *   hardware order and one retained sale record, pending on the To attach
 *   list unless a buyer was attached, however often its completion is told
 *   and wherever the order has since moved;
 * - a sale whose recording was missed stays marked and the sweep records it;
 * - the To attach list on the register and on the staff page.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { resetFakeFirestore } from '../testing/fake-firestore'

let mockManagePos = true
/** The finer "Sell at the register" key; undefined follows `managePos`. */
let mockPosSell: boolean | undefined
/** Which workspace owns each store. */
const mockOwners: Record<string, string> = { 'host-seller': 'org-seller', 'host-other': 'org-other' }

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    permissions: { managePos: mockManagePos, ...(mockPosSell === undefined ? {} : { posSell: mockPosSell }) },
  }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token === 'staff-super') return { uid: 'staff-1', email_verified: true, staff: true, staffRole: 'super' }
            if (token !== 'cashier') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
            return { uid: 'cashier-1', email_verified: true }
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async (hostId: string) => ({
      orgId: mockOwners[hostId],
      org: { id: mockOwners[hostId], plan: 'business', subscriptionStatus: 'active', ownerUid: `owner-${hostId}` },
    }),
    emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
  }
})
jest.mock('./pos-stripe', () => ({
  ...jest.requireActual('./pos-stripe'),
  posStripeTestMode: () => false,
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({ addAdminAudit: async () => ({ id: 'audit-1' }) }))

import { fakeDocs } from '../testing/fake-firestore'
import { POS_HARDWARE_ENV, POS_HARDWARE_SKUS } from '../model/pos-hardware'
import { posHardwareSaleHandler } from './pos-hardware-sale'
import { posHardwareInPersonOrderId } from './pos-hardware'
import { posHardwareAdminOrders } from './pos-hardware-admin'
import { posHardwareSaleFields } from './pos-hardware-sale-fields'
import {
  recordCompletedSaleHardware,
  recordInPersonPosHardwareSale,
  sweepInPersonPosHardwareSales,
} from './pos-hardware-in-person'

const ENV_KEYS = [POS_HARDWARE_ENV.inPersonEnabled, POS_HARDWARE_ENV.sellerHostId, POS_HARDWARE_ENV.sellerOrgId]

function turnOn(overrides: Partial<Record<string, string>> = {}) {
  process.env[POS_HARDWARE_ENV.inPersonEnabled] = 'true'
  process.env[POS_HARDWARE_ENV.sellerHostId] = 'host-seller'
  process.env[POS_HARDWARE_ENV.sellerOrgId] = 'org-seller'
  Object.assign(process.env, overrides)
}

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

async function sale(body: Record<string, unknown>, options: { token?: string; key?: string } = {}) {
  const { res, result } = response()
  const req = {
    method: 'POST',
    query: {},
    body: { hostId: 'host-seller', ...body },
    headers: {
      authorization: `Bearer ${options.token ?? 'cashier'}`,
      ...(options.key ? { 'idempotency-key': options.key } : {}),
    },
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
  await posHardwareSaleHandler(req, res)
  return result
}

beforeEach(() => {
  resetFakeFirestore()
  mockManagePos = true
  mockPosSell = undefined
  for (const key of ENV_KEYS) delete process.env[key]
  fakeDocs.set('hosts/host-seller', { name: 'Aglyn store' })
  fakeDocs.set('hosts/host-other', { name: 'Another store' })
})

afterAll(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('status: is this store the platform’s hardware seller', () => {
  it('answers yes, with every hardware item, only on the configured store of the configured workspace', async () => {
    turnOn()
    const result = await sale({ action: 'status' })
    expect(result.status).toBe(200)
    expect(result.body.seller).toBe(true)
    expect(result.body.items.map((item: any) => item.sku)).toEqual(POS_HARDWARE_SKUS.map((sku) => sku.id))
    expect(result.body.items[0]).toEqual({ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', kind: 'reader' })
  })

  it('says no, and nothing else, on any other store or while the sale is off', async () => {
    turnOn()
    expect((await sale({ action: 'status', hostId: 'host-other' })).body).toEqual({ seller: false })
    // The store named, but now in another workspace: not the seller.
    turnOn({ [POS_HARDWARE_ENV.sellerOrgId]: 'org-elsewhere' })
    expect((await sale({ action: 'status' })).body).toEqual({ seller: false })
    for (const key of ENV_KEYS) delete process.env[key]
    expect((await sale({ action: 'status' })).body).toEqual({ seller: false })
  })

  it('is gated like the register', async () => {
    turnOn()
    expect((await sale({ action: 'status' }, { token: 'nobody' })).status).toBe(401)
    mockManagePos = false
    expect((await sale({ action: 'status' })).status).toBe(403)
    expect((await sale({ action: 'bogus' })).status).toBe(403)
    mockManagePos = true
    expect((await sale({ action: 'bogus' })).status).toBe(400)
  })
})

/*==========================================
 * Recording the sale.
 *=========================================*/

const S710 = 'stripe-reader-s710'

function seedSellerStore() {
  fakeDocs.set('hosts/host-seller/products/reader', { name: 'Stripe Reader S710', hardwareSku: S710 })
  fakeDocs.set('hosts/host-seller/products/shirt', { name: 'T-shirt' })
  fakeDocs.set('hosts/host-seller/settings/store', {
    tax: { mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', state: 'TX', pct: 8.25 }] },
  })
  fakeDocs.set('profiles/owner-host-seller', { stripeAccountId: 'acct_seller' })
}

function paidSale(id: string, fields: Record<string, unknown> = {}) {
  fakeDocs.set(`hosts/host-seller/orders/${id}`, {
    status: 'paid',
    channel: 'pos',
    number: 41,
    registerId: 'register-1',
    lineItems: [{ productId: 'reader', name: 'Stripe Reader S710', quantity: 1, unitAmountCents: 30_000 }],
    totals: { itemsCents: 30_000, shippingCents: 0, discountCents: 0, taxCents: 2_475, totalCents: 32_475, feeCents: 0 },
    payments: [{ id: 'pay_cash', method: 'cash', amountCents: 32_475, status: 'succeeded', atMs: 900 }],
    customerEmail: 'receipt@example.com',
    hardwareSalePending: true,
    paidAtMs: 1_000,
    createdAtMs: 900,
    ...fields,
  })
}

const hardwareDocs = () => [...fakeDocs.keys()].filter((key) => /\/hardwareOrders\//.test(key))

describe('a paid register sale of hardware becomes one order', () => {
  beforeEach(() => {
    turnOn()
    seedSellerStore()
  })

  it('records a pending order on the selling workspace, with its sale record, and clears the mark', async () => {
    paidSale('order-1')
    const outcome = await recordInPersonPosHardwareSale('host-seller', 'order-1')
    const id = posHardwareInPersonOrderId('host-seller', 'order-1')
    expect(outcome).toEqual({ outcome: 'recorded', orderId: id, orgId: 'org-seller', pending: true })
    const order = fakeDocs.get(`orgs/org-seller/hardwareOrders/${id}`)
    expect(order).toMatchObject({
      source: 'in_person',
      status: 'delivered',
      hostId: '',
      totalCents: 32_475,
      taxCents: 2_475,
      contactEmail: 'receipt@example.com',
      attachment: { state: 'pending', uid: null, email: null },
      paidTo: { account: 'seller_store', tenders: ['cash'], stripeAccountId: 'acct_seller' },
      posSale: { hostId: 'host-seller', orderId: 'order-1', number: 41, kiosk: false, offline: false },
      livemode: true,
    })
    expect(fakeDocs.get(`posHardwareSales/${id}`)).toMatchObject({
      source: 'in_person',
      posOrderId: 'order-1',
      paidTo: { account: 'seller_store' },
      shipTo: { country: 'US', state: 'TX' },
      totalCents: 32_475,
    })
    const register = fakeDocs.get('hosts/host-seller/orders/order-1')!
    expect(register['hardwareOrderId']).toBe(id)
    expect(register).not.toHaveProperty('hardwareSalePending')
  })

  it('writes nothing a second time, even after the order moved to the buyer’s workspace', async () => {
    paidSale('order-1')
    await recordInPersonPosHardwareSale('host-seller', 'order-1')
    expect((await recordInPersonPosHardwareSale('host-seller', 'order-1')).outcome).toBe('already')
    const id = posHardwareInPersonOrderId('host-seller', 'order-1')
    // Attached since: the order lives in the buyer's workspace now.
    const moved = fakeDocs.get(`orgs/org-seller/hardwareOrders/${id}`)!
    fakeDocs.delete(`orgs/org-seller/hardwareOrders/${id}`)
    fakeDocs.set(`orgs/org-buyer/hardwareOrders/${id}`, { ...moved, orgId: 'org-buyer' })
    fakeDocs.set('hosts/host-seller/orders/order-1', { ...fakeDocs.get('hosts/host-seller/orders/order-1'), hardwareSalePending: true })
    expect((await recordInPersonPosHardwareSale('host-seller', 'order-1')).outcome).toBe('already')
    expect(hardwareDocs()).toEqual([`orgs/org-buyer/hardwareOrders/${id}`])
  })

  it("is the attached buyer's workspace's order when a register user attached one", async () => {
    paidSale('order-2', {
      hardwareBuyer: { uid: 'uid-buyer', orgId: 'org-buyer', hostId: 'host-buyer', email: 'pat@example.com', attachedBy: 'cashier-1', attachedAtMs: 950 },
    })
    const outcome = await recordInPersonPosHardwareSale('host-seller', 'order-2')
    expect(outcome).toMatchObject({ outcome: 'recorded', orgId: 'org-buyer', pending: false })
    const id = posHardwareInPersonOrderId('host-seller', 'order-2')
    expect(fakeDocs.get(`orgs/org-buyer/hardwareOrders/${id}`)).toMatchObject({
      hostId: 'host-buyer',
      createdBy: 'uid-buyer',
      contactEmail: 'pat@example.com',
      attachment: { state: 'attached', orgId: 'org-buyer', attachedBy: 'cashier-1' },
    })
  })

  it('takes only the hardware lines of a mixed sale, with their share of the discount and tax', async () => {
    paidSale('order-3', {
      lineItems: [
        { productId: 'reader', name: 'Stripe Reader S710', quantity: 1, unitAmountCents: 30_000 },
        { productId: 'shirt', name: 'T-shirt', quantity: 1, unitAmountCents: 2_500 },
      ],
      totals: { itemsCents: 32_500, shippingCents: 0, discountCents: 3_250, taxCents: 2_413, totalCents: 31_663, feeCents: 0 },
    })
    await recordInPersonPosHardwareSale('host-seller', 'order-3')
    const order = fakeDocs.get(`orgs/org-seller/hardwareOrders/${posHardwareInPersonOrderId('host-seller', 'order-3')}`)
    expect(order).toMatchObject({ subtotalCents: 30_000, discountCents: 3_000, taxCents: 2_227, totalCents: 29_227 })
    expect(order?.['lines']).toHaveLength(1)
  })

  it('records a kiosk or offline sale unattached, and a card sale with its tenders, mode and link session', async () => {
    paidSale('order-4', { posSource: 'kiosk', customerEmail: null })
    await recordInPersonPosHardwareSale('host-seller', 'order-4', { offline: false })
    expect(fakeDocs.get(`orgs/org-seller/hardwareOrders/${posHardwareInPersonOrderId('host-seller', 'order-4')}`)).toMatchObject({
      posSale: { kiosk: true },
      attachment: { state: 'pending' },
      contactEmail: null,
    })
    paidSale('order-5', {
      payments: [{ id: 'pay_link', method: 'card_link', amountCents: 32_475, status: 'succeeded', atMs: 900, checkoutSessionId: 'cs_booth', livemode: false }],
    })
    await recordInPersonPosHardwareSale('host-seller', 'order-5', { offline: true })
    const id = posHardwareInPersonOrderId('host-seller', 'order-5')
    expect(fakeDocs.get(`orgs/org-seller/hardwareOrders/${id}`)).toMatchObject({
      posSale: { offline: true, paymentLinkSessionId: 'cs_booth' },
      paidTo: { tenders: ['card_link'] },
      livemode: false,
    })
    expect(fakeDocs.get(`posHardwareSales/${id}`)).toMatchObject({ storefrontTaxRowId: 'cs_booth' })
  })

  it('does nothing for another store, while off, before payment, or without hardware', async () => {
    paidSale('order-6')
    expect((await recordInPersonPosHardwareSale('host-other', 'order-6')).outcome).toBe('not-seller')
    expect((await recordInPersonPosHardwareSale('host-seller', 'missing')).outcome).toBe('missing')
    paidSale('order-7', { status: 'pending' })
    expect((await recordInPersonPosHardwareSale('host-seller', 'order-7')).outcome).toBe('not-paid')
    paidSale('order-8', { lineItems: [{ productId: 'shirt', name: 'T-shirt', quantity: 1, unitAmountCents: 2_500 }] })
    expect((await recordInPersonPosHardwareSale('host-seller', 'order-8')).outcome).toBe('no-hardware')
    expect(fakeDocs.get('hosts/host-seller/orders/order-8')).not.toHaveProperty('hardwareSalePending')
    for (const key of ENV_KEYS) delete process.env[key]
    expect((await recordInPersonPosHardwareSale('host-seller', 'order-6')).outcome).toBe('off')
    expect(hardwareDocs()).toEqual([])
  })

  it('never throws into a completed sale', async () => {
    paidSale('order-9')
    fakeDocs.set('hosts/host-seller/orders/order-9', { ...fakeDocs.get('hosts/host-seller/orders/order-9'), lineItems: 'not lines' })
    await expect(recordCompletedSaleHardware({ hostId: 'host-seller', orderId: 'order-9' })).resolves.toBeUndefined()
  })
})

describe('a sale whose recording was missed is swept up', () => {
  beforeEach(() => {
    turnOn()
    seedSellerStore()
  })

  it('records a paid marked sale, leaves an open one marked and unmarks one that can never be paid', async () => {
    paidSale('missed')
    paidSale('open', { status: 'pending' })
    paidSale('voided', { status: 'voided' })
    expect(await sweepInPersonPosHardwareSales()).toEqual({ recorded: 1, failed: 0 })
    expect(hardwareDocs()).toEqual([`orgs/org-seller/hardwareOrders/${posHardwareInPersonOrderId('host-seller', 'missed')}`])
    expect(fakeDocs.get('hosts/host-seller/orders/open')?.['hardwareSalePending']).toBe(true)
    expect(fakeDocs.get('hosts/host-seller/orders/voided')).not.toHaveProperty('hardwareSalePending')
    expect(await sweepInPersonPosHardwareSales()).toEqual({ recorded: 0, failed: 0 })
  })
})

describe('the mark a register sale carries', () => {
  const env = {
    [POS_HARDWARE_ENV.inPersonEnabled]: 'true',
    [POS_HARDWARE_ENV.sellerHostId]: 'host-seller',
    [POS_HARDWARE_ENV.sellerOrgId]: 'org-seller',
  }
  const products = new Map<string, { hardwareSku?: unknown } | null>([
    ['reader', { hardwareSku: S710 }],
    ['shirt', {}],
    ['fake', { hardwareSku: 'not-an-item' }],
  ])

  it('marks a sale with a hardware line on the seller store only', () => {
    const lineItems = [{ productId: 'shirt' }, { productId: 'reader' }]
    expect(posHardwareSaleFields({ hostId: 'host-seller', orgId: 'org-seller', lineItems, products }, env)).toEqual({ hardwareSalePending: true })
    expect(posHardwareSaleFields({ hostId: 'host-other', orgId: 'org-other', lineItems, products }, env)).toEqual({})
    expect(posHardwareSaleFields({ hostId: 'host-seller', orgId: 'org-moved', lineItems, products }, env)).toEqual({})
    expect(posHardwareSaleFields({ hostId: 'host-seller', orgId: 'org-seller', lineItems, products }, {})).toEqual({})
    expect(
      posHardwareSaleFields({ hostId: 'host-seller', orgId: 'org-seller', lineItems: [{ productId: 'shirt' }, { productId: 'fake' }], products }, env),
    ).toEqual({})
  })
})

describe('the To attach list', () => {
  beforeEach(() => {
    turnOn()
    seedSellerStore()
  })

  it('records missed sales, then lists the pending ones for a register user on the seller store', async () => {
    paidSale('order-1', { posSource: 'kiosk' })
    paidSale('order-2', {
      hardwareBuyer: { uid: 'uid-buyer', orgId: 'org-buyer', hostId: null, email: null, attachedBy: 'cashier-1', attachedAtMs: 950 },
    })
    const result = await sale({ action: 'pending' })
    expect(result.status).toBe(200)
    expect(result.body.orders).toEqual([
      expect.objectContaining({
        id: posHardwareInPersonOrderId('host-seller', 'order-1'),
        registerOrderId: 'order-1',
        registerNumber: 41,
        kiosk: true,
        offline: false,
        totalCents: 32_475,
        contactEmail: 'receipt@example.com',
        lines: [{ sku: S710, name: 'Stripe Reader S710', quantity: 1 }],
      }),
    ])
  })

  it('is the seller store’s, for whoever may sell there', async () => {
    expect((await sale({ action: 'pending', hostId: 'host-other' })).status).toBe(404)
    mockPosSell = false
    expect((await sale({ action: 'pending' })).status).toBe(403)
  })

  it('is a filter on the staff page across every workspace', async () => {
    paidSale('order-1')
    const request = new Request('https://console.example.com/api/commerce/admin/hardware-orders?attach=pending', {
      headers: { authorization: 'Bearer staff-super' },
    })
    const answer = await posHardwareAdminOrders(request)
    expect(answer.status).toBe(200)
    const body = await answer.json()
    expect(body.orders.map((order: any) => [order.id, order.source, order.attachment.state])).toEqual([
      [posHardwareInPersonOrderId('host-seller', 'order-1'), 'in_person', 'pending'],
    ])
    const bad = await posHardwareAdminOrders(
      new Request('https://console.example.com/api/commerce/admin/hardware-orders?attach=everything', {
        headers: { authorization: 'Bearer staff-super' },
      }),
    )
    expect(bad.status).toBe(400)
  })
})

describe("removing a buyer who never made an account (privacy request)", () => {
  beforeEach(() => {
    turnOn()
    seedSellerStore()
  })

  const staffPost = (body: Record<string, unknown>) =>
    posHardwareAdminOrders(
      new Request('https://console.example.com/api/commerce/admin/hardware-orders', {
        method: 'POST',
        headers: { authorization: 'Bearer staff-super', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )

  it('takes the address off an in-person order and its record, keeping the amounts', async () => {
    paidSale('order-1', {
      hardwareBuyer: { uid: null, orgId: null, hostId: null, email: 'new@example.com', attachedBy: 'cashier-1', attachedAtMs: 950 },
    })
    await recordInPersonPosHardwareSale('host-seller', 'order-1')
    const id = posHardwareInPersonOrderId('host-seller', 'order-1')
    const answer = await staffPost({ action: 'forget-buyer', orgId: 'org-seller', orderId: id })
    expect(answer.status).toBe(200)
    const order = fakeDocs.get(`orgs/org-seller/hardwareOrders/${id}`)!
    expect(order).toMatchObject({ contactEmail: null, createdBy: null, totalCents: 32_475, attachment: { state: 'pending', email: null } })
    expect(order['shipping']).toMatchObject({ taxRegion: { country: 'US', state: 'TX' } })
    expect(JSON.stringify(fakeDocs.get(`posHardwareSales/${id}`))).not.toContain('example.com')
  })

  it('refuses an order sold online', async () => {
    fakeDocs.set('orgs/org-1/hardwareOrders/hw_bbbbbbbbbbbbbbbbbbbb', { orgId: 'org-1', status: 'paid', shipping: { method: 'standard' } })
    const answer = await staffPost({ action: 'forget-buyer', orgId: 'org-1', orderId: 'hw_bbbbbbbbbbbbbbbbbbbb' })
    expect(answer.status).toBe(409)
  })
})
