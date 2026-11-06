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
 * Card reader hardware bought ONLINE from the platform's own store (AGL-4038):
 * its product pages and cart. The store order the webhook writes becomes a
 * hardware order exactly as a register sale does, through the same recorder,
 * with Firestore, the sign-in pools, email and Stripe faked at their edges:
 *
 * - the order is pending on the selling workspace's To attach list, with the
 *   buyer's email and shipping address, the terms they ticked, and its
 *   readers waiting for serials; it waits to be prepared and shipped;
 * - a buyer with no account is invited once; one with an account is not;
 *   creating their workspace claims it;
 * - canceling it before it ships refunds the store's own charge, reversing
 *   the transfer into the store's account, never the platform's balance;
 * - on the tax return it is the store's own sale, counted once.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'

const mockSent: Array<Record<string, any>> = []
const mockAlerts: Array<{ key: string; context: Record<string, unknown> }> = []
/** Accounts by uid, across every pool. */
const mockUsers: Record<string, { uid: string; email: string; displayName?: string }> = {}

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: true, posSell: true } }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  const owners: Record<string, string> = { 'host-seller': 'org-seller', 'host-new': 'org-new' }
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token !== 'cashier') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
            return { uid: 'cashier-1', email_verified: true }
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async (hostId: string) => ({
      orgId: owners[hostId],
      org: { id: owners[hostId], plan: 'business', subscriptionStatus: 'active', ownerUid: 'owner-seller' },
    }),
    consumeRateLimit: async () => ({ allowed: true }),
    hostDisplayName: (host: Record<string, unknown>, id: string) => String(host['name'] ?? id),
    meterPlatformEmail: async () => undefined,
    raiseOperatorAlert: async (key: string, input: { context: Record<string, unknown> }) => {
      mockAlerts.push({ key, context: input.context })
      return { outcome: 'sent' }
    },
  }
})
jest.mock('@aglyn/tenant-data-admin/server/auth-pools', () => ({
  findUserByEmailAcrossPools: async (email: string) => {
    const user = Object.values(mockUsers).find((candidate) => candidate.email === email.trim().toLowerCase())
    return user ? { record: user, tenantId: null } : null
  },
  findUserByUidAcrossPools: async (uid: string) => (mockUsers[uid] ? { record: mockUsers[uid], tenantId: null } : null),
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit', () => ({
  maskEmailAddress: (address: string) => `${String(address).slice(0, 1)}***`,
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  addAdminAudit: async () => ({ id: 'audit' }),
}))
jest.mock('@aglyn/tenant-data-admin/server/host-console-link', () => ({
  hostConsoleUrl: async (hostId: string, link: string) => `https://console.example.com/acme/hosts/${hostId}${link}`,
}))
jest.mock('@aglyn/tenant-data-admin/server/email-suppression', () => ({
  filterSuppressedEmails: async (addresses: string[]) => addresses,
}))
jest.mock('@aglyn/tenant-data-admin/server/render-system-email', () => ({
  orgSystemEmailBrand: async () => ({ merge: {}, options: {}, fromName: '' }),
  renderSystemEmailContent: async (key: string, merge: Record<string, string>, _brand: unknown, fallback: { subject: string }) => ({
    subject: fallback.subject,
    html: `<p>${key}</p>`,
    text: JSON.stringify(merge),
  }),
}))
jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email/pos-hardware-emails'),
  sendEmail: async (message: Record<string, any>) => {
    mockSent.push(message)
    return { sent: true }
  },
}))
jest.mock('./pos-stripe', () => ({ ...jest.requireActual('./pos-stripe'), posStripeTestMode: () => false }))

import { POS_HARDWARE_ENV, type PosHardwareOrder, type PosHardwareSaleRecord } from '../model/pos-hardware'
import { posHardwareStorefrontParts, storefrontRowsWithoutInPersonHardware } from '../model/pos-hardware-tax-summary'
import { posHardwareInPersonOrderId } from './pos-hardware'
import { claimPosHardwareForNewWorkspace } from './pos-hardware-attach'
import { cancelAndRefundPosHardwareOrder } from './pos-hardware-cancel'
import { recordInPersonPosHardwareSale } from './pos-hardware-in-person'
import { posHardwareSaleHandler } from './pos-hardware-sale'
import {
  sellerStoreHardwareCheckout,
  storefrontHardwareSaleFields,
} from './pos-hardware-sale-fields'
import { posHardwareFoldedAs } from './pos-hardware-tax-return-source'

const SESSION = 'cs_live_online_1'
const ORDER_ID = posHardwareInPersonOrderId('host-seller', SESSION)
const PENDING_PATH = `orgs/org-seller/hardwareOrders/${ORDER_ID}`
const SALE_PATH = `posHardwareSales/${ORDER_ID}`
const ACCEPTANCE = {
  version: 'v21',
  sections: '4.26–4.32',
  method: 'online',
  atMs: 900,
  staffUid: null,
  ip: '203.0.113.9',
  userAgent: 'Mozilla/5.0',
  businessUse: true,
}

/** Refunds Stripe was asked for, with their form bodies. */
const refunds: URLSearchParams[] = []

/** A paid online order on the seller store, exactly as the webhook writes it. */
function onlineOrder(fields: Record<string, unknown> = {}) {
  fakeDocs.set(`hosts/host-seller/orders/${SESSION}`, {
    number: 41,
    status: 'paid',
    channel: 'online',
    lineItems: [
      { productId: 'reader', name: 'Touchscreen reader (S700)', quantity: 2, unitAmountCents: 30_000 },
      { productId: 'dock', name: 'Charging dock', quantity: 1, unitAmountCents: 5_000 },
    ],
    totals: { itemsCents: 65_000, shippingCents: 2_000, discountCents: 0, taxCents: 5_528, totalCents: 72_528, feeCents: 0 },
    paymentIntentId: 'pi_store_1',
    checkoutSessionId: SESSION,
    livemode: true,
    customerName: 'Jordan Lee',
    customerEmail: 'Jordan@Example.com',
    shippingAddress: { name: 'Jordan Lee', line1: '12 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' },
    hardwareSalePending: true,
    hardwareTermsAcceptance: ACCEPTANCE,
    createdAtMs: 1_000,
    ...fields,
  })
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

beforeEach(() => {
  resetFakeFirestore()
  mockSent.length = 0
  mockAlerts.length = 0
  refunds.length = 0
  for (const uid of Object.keys(mockUsers)) delete mockUsers[uid]
  process.env[POS_HARDWARE_ENV.inPersonEnabled] = 'true'
  process.env[POS_HARDWARE_ENV.sellerHostId] = 'host-seller'
  process.env[POS_HARDWARE_ENV.sellerOrgId] = 'org-seller'
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake'
  global.fetch = jest.fn(async (url: string, init: { body?: string }) => {
    if (String(url).endsWith('/v1/refunds')) {
      refunds.push(new URLSearchParams(String(init?.body ?? '')))
      return { ok: true, status: 200, json: async () => ({ id: `re_${refunds.length}` }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
  fakeDocs.set('hosts/host-seller', { name: 'Our store', orgId: 'org-seller' })
  fakeDocs.set('hosts/host-seller/products/reader', { name: 'Touchscreen reader (S700)', hardwareSku: 'stripe-reader-s700' })
  fakeDocs.set('hosts/host-seller/products/dock', { name: 'Charging dock', hardwareSku: 'stripe-reader-s700-dock' })
  fakeDocs.set('hosts/host-seller/products/shirt', { name: 'T-shirt' })
  fakeDocs.set('orgs/org-seller', { name: 'Seller', ownerUid: 'owner-seller' })
})

afterAll(() => {
  for (const key of [POS_HARDWARE_ENV.inPersonEnabled, POS_HARDWARE_ENV.sellerHostId, POS_HARDWARE_ENV.sellerOrgId]) {
    delete process.env[key]
  }
})

describe('reading a checkout for hardware on the platform’s own store', () => {
  const products = new Map([
    ['reader', { hardwareSku: 'stripe-reader-s700' }],
    ['shirt', {}],
  ])
  const base = { hostId: 'host-seller', orgId: 'org-seller', products }

  it('asks nothing of any other store, or of a store whose workspace is not the seller’s', () => {
    expect(
      sellerStoreHardwareCheckout({ ...base, hostId: 'host-other', lines: [{ productId: 'reader', quantity: 1 }], hardwareTerms: null }),
    ).toEqual({ hardware: false, skus: [null], refusal: null })
    expect(
      sellerStoreHardwareCheckout({ ...base, orgId: 'org-moved', lines: [{ productId: 'reader', quantity: 1 }], hardwareTerms: null }).hardware,
    ).toBe(false)
    expect(sellerStoreHardwareCheckout({ ...base, lines: [{ productId: 'shirt', quantity: 1 }], hardwareTerms: null }).refusal).toBeNull()
  })

  it('names the hardware lines once both boxes are ticked, and refuses otherwise', () => {
    const lines = [
      { productId: 'shirt', quantity: 1 },
      { productId: 'reader', quantity: 2 },
    ]
    expect(sellerStoreHardwareCheckout({ ...base, lines, hardwareTerms: { accepted: true, businessUse: true } })).toEqual({
      hardware: true,
      skus: [null, 'stripe-reader-s700'],
      refusal: null,
    })
    expect(sellerStoreHardwareCheckout({ ...base, lines, hardwareTerms: { accepted: true } }).refusal).toMatchObject({
      status: 400,
      needsHardwareTerms: true,
    })
  })

  it('holds the online limits across lines of one item, and refuses a subscription', () => {
    const ticked = { accepted: true, businessUse: true }
    const split = [
      { productId: 'reader', quantity: 6 },
      { productId: 'reader', quantity: 5 },
    ]
    expect(sellerStoreHardwareCheckout({ ...base, lines: split, hardwareTerms: ticked }).refusal?.status).toBe(400)
    expect(
      sellerStoreHardwareCheckout({ ...base, lines: [{ productId: 'reader', quantity: 1 }], hardwareTerms: ticked, subscription: true })
        .refusal?.error,
    ).toBe('Card reader hardware is bought once, not by subscription.')
  })

  it('marks a paid order with the terms the session carried, dated when it was made', () => {
    const fields = storefrontHardwareSaleFields({
      hostId: 'host-seller',
      orgId: 'org-seller',
      lineItems: [{ productId: 'reader' }],
      products,
      metadata: { hardwareTermsVersion: 'v21', hardwareTermsBusinessUse: 'true' },
      createdSeconds: 1_762_300_000,
    })
    expect(fields).toEqual({
      hardwareSalePending: true,
      hardwareTermsAcceptance: expect.objectContaining({ method: 'online', atMs: 1_762_300_000_000, businessUse: true }),
    })
    expect(
      storefrontHardwareSaleFields({
        hostId: 'host-seller',
        orgId: 'org-seller',
        lineItems: [{ productId: 'shirt' }],
        products,
        metadata: {},
        createdSeconds: 1,
      }),
    ).toEqual({})
  })
})

describe('a stranger’s online order becomes a hardware order', () => {
  it('pending on To attach, with their email, address and the terms they ticked, waiting to be prepared', async () => {
    onlineOrder()
    const outcome = await recordInPersonPosHardwareSale('host-seller', SESSION)
    expect(outcome).toEqual({ outcome: 'recorded', orderId: ORDER_ID, orgId: 'org-seller', pending: true })
    const order = fakeDocs.get(PENDING_PATH) as PosHardwareOrder
    expect(order).toMatchObject({
      source: 'storefront',
      status: 'paid',
      orgId: 'org-seller',
      hostId: '',
      contactEmail: 'jordan@example.com',
      subtotalCents: 65_000,
      discountCents: 0,
      taxCents: 5_528,
      totalCents: 72_528,
      shipping: {
        method: 'standard',
        cents: 2_000,
        name: 'Jordan Lee',
        address: { line1: '12 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' },
      },
      termsAcceptance: ACCEPTANCE,
      attachment: { state: 'pending', email: 'jordan@example.com', uid: null, orgId: null, name: 'Jordan Lee' },
      posSale: { hostId: 'host-seller', orderId: SESSION, number: 41, registerId: null, kiosk: false, paymentLinkSessionId: SESSION },
      paidTo: { account: 'seller_store', hostId: 'host-seller', orgId: 'org-seller', tenders: ['card_link'] },
      livemode: true,
    })
    // Not handed over: nothing is delivered yet, and each reader waits for its serial.
    expect(order.deliveredAtMs).toBeUndefined()
    expect(order.units).toEqual([
      { sku: 'stripe-reader-s700', serialNumber: null, readerId: null, hostId: null, registeredAtMs: null },
      { sku: 'stripe-reader-s700', serialNumber: null, readerId: null, hostId: null, registeredAtMs: null },
    ])
    // Taxed where it ships: the items, and the shipping, as the order was.
    expect(order.taxLines).toEqual([
      expect.objectContaining({ amountCents: 5_528, taxableAmountCents: 67_000, jurisdiction: 'IL', rateState: 'IL' }),
    ])
    // The store order is unmarked and names its hardware order.
    expect(fakeDocs.get(`hosts/host-seller/orders/${SESSION}`)).toMatchObject({ hardwareOrderId: ORDER_ID })
    expect(fakeDocs.get(`hosts/host-seller/orders/${SESSION}`)?.['hardwareSalePending']).toBeUndefined()
  })

  it('keeps the 7-year record as the store’s own sale, with the buyer’s name and address', async () => {
    onlineOrder()
    await recordInPersonPosHardwareSale('host-seller', SESSION)
    const record = fakeDocs.get(SALE_PATH) as PosHardwareSaleRecord
    expect(record).toMatchObject({
      source: 'storefront',
      orgId: 'org-seller',
      totalCents: 72_528,
      shippingCents: 2_000,
      shipTo: { country: 'US', state: 'IL', postalCode: '62701' },
      paidTo: { account: 'seller_store', hostId: 'host-seller' },
      posHostId: 'host-seller',
      posOrderId: SESSION,
      storefrontTaxRowId: SESSION,
      buyer: { name: 'Jordan Lee', address: { line1: '12 Main St', city: 'Springfield', country: 'US' } },
    })
    expect(record.expiresAt).toEqual(new Date(Date.UTC(1977, 0, 1, 0, 0, 1)))
  })

  it('invites a buyer with no account once, and tells staff there is an order to prepare', async () => {
    onlineOrder()
    await recordInPersonPosHardwareSale('host-seller', SESSION)
    await recordInPersonPosHardwareSale('host-seller', SESSION)
    expect(mockSent.map((message) => message.to)).toEqual(['jordan@example.com'])
    expect(mockSent[0].context).toBe('pos-hardware-sign-up-invite')
    expect(mockAlerts).toHaveLength(1)
    expect(mockAlerts[0].context).toMatchObject({ amount: expect.stringContaining('725.28') })
  })

  it('sends no sign-up invitation to an address that already has an account', async () => {
    mockUsers['uid-jordan'] = { uid: 'uid-jordan', email: 'jordan@example.com' }
    onlineOrder()
    await recordInPersonPosHardwareSale('host-seller', SESSION)
    expect(mockSent).toEqual([])
    expect(fakeDocs.get(PENDING_PATH)).toMatchObject({ attachment: { state: 'pending', email: 'jordan@example.com' } })
  })

  it('records an order the store already marked fulfilled, and nothing for a canceled one', async () => {
    onlineOrder({ status: 'fulfilled' })
    expect((await recordInPersonPosHardwareSale('host-seller', SESSION)).outcome).toBe('recorded')
    resetFakeFirestore()
    onlineOrder({ status: 'cancelled' })
    expect((await recordInPersonPosHardwareSale('host-seller', SESSION)).outcome).toBe('not-paid')
  })

  it('takes the hardware’s share of an order that also sold something else, shipping included', async () => {
    onlineOrder({
      lineItems: [
        { productId: 'reader', name: 'Touchscreen reader (S700)', quantity: 1, unitAmountCents: 30_000 },
        { productId: 'shirt', name: 'T-shirt', quantity: 1, unitAmountCents: 10_000 },
      ],
      totals: { itemsCents: 40_000, shippingCents: 2_000, discountCents: 4_000, taxCents: 3_135, totalCents: 41_135, feeCents: 0 },
    })
    await recordInPersonPosHardwareSale('host-seller', SESSION)
    const order = fakeDocs.get(PENDING_PATH) as PosHardwareOrder
    // 3/4 of the items: 3/4 of the discount and of the shipping, and the tax
    // on what that leaves, in proportion.
    expect(order).toMatchObject({ subtotalCents: 30_000, discountCents: 3_000, taxCents: 2_351, totalCents: 30_851 })
    expect(order.shipping.cents).toBe(1_500)
  })

  it('is on the selling store’s To attach list as an online order', async () => {
    onlineOrder()
    await recordInPersonPosHardwareSale('host-seller', SESSION)
    const { res, result } = response()
    await posHardwareSaleHandler(
      {
        method: 'POST',
        query: {},
        body: { hostId: 'host-seller', action: 'pending' },
        headers: { authorization: 'Bearer cashier' },
        cookies: {},
        socket: {},
      } as unknown as PluginApiRequest,
      res,
    )
    expect(result.status).toBe(200)
    expect(result.body.orders).toEqual([
      expect.objectContaining({ id: ORDER_ID, online: true, registerNumber: 41, invited: true, readers: 2 }),
    ])
  })

  it('moves into the workspace the buyer creates, attached to them', async () => {
    onlineOrder()
    await recordInPersonPosHardwareSale('host-seller', SESSION)
    mockUsers['uid-new'] = { uid: 'uid-new', email: 'jordan@example.com', displayName: 'Jordan Lee' }
    fakeDocs.set('orgs/org-new/members/uid-new', { uid: 'uid-new', role: 'owner' })
    const claimed = await claimPosHardwareForNewWorkspace({
      config: { sellerHostId: 'host-seller', sellerOrgId: 'org-seller' },
      orgId: 'org-new',
      ownerUid: 'uid-new',
      ownerEmail: 'jordan@example.com',
      emailVerified: true,
    })
    expect(claimed).toEqual({ claimed: 1 })
    expect(fakeDocs.get(PENDING_PATH)).toBeUndefined()
    expect(fakeDocs.get(`orgs/org-new/hardwareOrders/${ORDER_ID}`)).toMatchObject({
      source: 'storefront',
      status: 'paid',
      orgId: 'org-new',
      attachment: { state: 'attached', uid: 'uid-new', orgId: 'org-new' },
    })
    expect(fakeDocs.get(SALE_PATH)).toMatchObject({ orgId: 'org-new', source: 'storefront' })
  })
})

describe('canceling an online order before it ships', () => {
  it('refunds the store’s own charge, reversing its transfer, and says canceled', async () => {
    onlineOrder()
    await recordInPersonPosHardwareSale('host-seller', SESSION)
    const result = await cancelAndRefundPosHardwareOrder({
      orgId: 'org-seller',
      orderId: ORDER_ID,
      finalStatus: 'canceled',
      reason: 'staff',
    })
    expect(result.outcome).toBe('settled')
    expect(refunds).toHaveLength(1)
    expect(refunds[0].get('payment_intent')).toBe('pi_store_1')
    expect(refunds[0].get('amount')).toBe('72528')
    expect(refunds[0].get('reverse_transfer')).toBe('true')
    expect(fakeDocs.get(PENDING_PATH)).toMatchObject({
      status: 'canceled',
      cancelReason: 'staff',
      refundedCents: 72_528,
    })
    expect(fakeDocs.get(SALE_PATH)).toMatchObject({ status: 'canceled', refundedCents: 72_528 })
    expect(fakeDocs.get(`hosts/host-seller/orders/${SESSION}`)).toMatchObject({ refundedCents: 72_528, status: 'refunded' })
    // Pressed again, nothing more is refunded.
    expect(
      (await cancelAndRefundPosHardwareOrder({ orgId: 'org-seller', orderId: ORDER_ID, finalStatus: 'canceled', reason: 'staff' }))
        .outcome,
    ).toBe('already')
    expect(refunds).toHaveLength(1)
  })

  it('is refused once it has shipped', async () => {
    onlineOrder()
    await recordInPersonPosHardwareSale('host-seller', SESSION)
    fakeDocs.set(PENDING_PATH, { ...fakeDocs.get(PENDING_PATH), status: 'shipped' })
    const result = await cancelAndRefundPosHardwareOrder({
      orgId: 'org-seller',
      orderId: ORDER_ID,
      finalStatus: 'canceled',
      reason: 'workspace-closed',
    })
    expect(result.outcome).toBe('not-refundable')
    expect(refunds).toHaveLength(0)
  })
})

describe('on the tax return, once (AGL-4038)', () => {
  it('is in its store’s own sale where the store is the operator’s, and taken out of the storefront row', async () => {
    onlineOrder()
    await recordInPersonPosHardwareSale('host-seller', SESSION)
    const record = fakeDocs.get(SALE_PATH) as PosHardwareSaleRecord
    expect(posHardwareFoldedAs(record, { ownHostIds: new Set(['host-seller']) })).toBe('store register sale')
    expect(posHardwareFoldedAs(record, {})).toBe('in-person record')
    const parts = posHardwareStorefrontParts([record])
    expect(parts).toEqual([{ storefrontTaxRowId: SESSION, totalCents: 72_528, taxCents: 5_528 }])
    // The store's row for the session was the hardware alone: nothing is left.
    expect(storefrontRowsWithoutInPersonHardware([{ id: SESSION, grossCents: 72_528, taxCents: 5_528 }], parts)).toEqual([])
  })
})
