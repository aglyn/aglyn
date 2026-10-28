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
 * Returning a card reader sold in person (AGL-4038), all three ways, each
 * paid back from the selling store's takings and written once:
 *
 * - a return at the selling store's register takes the hardware's share of
 *   what it refunded onto the hardware order and its sale record;
 * - a refund from the staff page goes back through the register sale's own
 *   card refund, recorded on the register sale as any refund is; a cash
 *   sale is refused there;
 * - the buyer asks from their own purchase history, staff are alerted, and
 *   staff refund it or decline it.
 */

import type { PluginApiHandler, PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { resetFakeFirestore } from '../testing/fake-firestore'

const mockAlerts: Array<{ type: string; options: Record<string, any> }> = []
const mockRefunds: Array<Record<string, any>> = []
let mockRefundAnswer: { ok: true; refundId: string } | { ok: false; status: number; error: string; code: string } = {
  ok: true,
  refundId: 're_1',
}

const mockSendEmail = jest.fn<Promise<{ sent: boolean }>, [Record<string, unknown>]>(async () => ({ sent: true }))

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
  sendEmail: (message: Record<string, unknown>) => mockSendEmail(message),
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: true } }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  const owners: Record<string, string> = { 'host-seller': 'org-seller', 'host-pat': 'org-pat' }
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token === 'staff-super') return { uid: 'staff-1', email_verified: true, staff: true, staffRole: 'super' }
            if (token === 'pat') return { uid: 'uid-pat', email_verified: true }
            throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async (hostId: string) => ({
      orgId: owners[hostId],
      org: { id: owners[hostId], plan: 'free', subscriptionStatus: 'active' },
    }),
    readOrgBilling: async () => ({}),
    raiseOperatorAlert: async (definition: { type: string }, options: Record<string, any>) => {
      mockAlerts.push({ type: definition.type, options })
      return { outcome: 'sent' }
    },
    emailUnverifiedResponse: () => Response.json({ error: 'Verify' }, { status: 403 }),
    isImpersonationSession: () => false,
    hostDisplayName: (data: Record<string, unknown> | undefined, hostId: string) => String(data?.['name'] ?? hostId),
    meterPlatformEmail: async () => undefined,
  }
})
jest.mock('@aglyn/tenant-data-admin/server/host-console-link', () => ({
  hostConsoleUrl: async (hostId: string) => `https://console.example.com/${hostId}`,
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({ addAdminAudit: async () => ({ id: 'audit' }) }))
jest.mock('./stripe-refund', () => ({
  createStripeRefund: async (input: Record<string, any>) => {
    mockRefunds.push(input)
    return mockRefundAnswer
  },
}))

import { fakeDocs } from '../testing/fake-firestore'
import { POS_HARDWARE_ENV, posHardwareBuyerErasedPatch, posHardwareSaleRecord, type PosHardwareOrder } from '../model/pos-hardware'
import { inPersonPosHardwareOrder, posHardwareRegisterShare } from '../model/pos-hardware-in-person'
import { posHardwareHandler } from './pos-hardware'
import { posHardwareAdminOrders } from './pos-hardware-admin'
import { recordRegisterHardwareReturn, withPosHardwareRefund } from './pos-hardware-returns'

const CONFIG = { sellerHostId: 'host-seller', sellerOrgId: 'org-seller' }
const ENV_KEYS = [POS_HARDWARE_ENV.inPersonEnabled, POS_HARDWARE_ENV.sellerHostId, POS_HARDWARE_ENV.sellerOrgId]
const ID = 'hw_aaaaaaaaaaaaaaaaaaaa'

/** A register sale of two readers and a T-shirt, and the hardware order it became. */
function seed(payments: unknown[] = [{ id: 'pay-card', method: 'card_present', amountCents: 67_662, status: 'succeeded', atMs: 900, paymentIntentId: 'pi_booth' }]) {
  fakeDocs.set('hosts/host-pat', { name: 'Main Street', orgId: 'org-pat' })
  fakeDocs.set('hosts/host-seller/products/reader', { hardwareSku: 'stripe-reader-s710' })
  fakeDocs.set('hosts/host-seller/products/shirt', {})
  fakeDocs.set('hosts/host-seller/orders/order-1', {
    status: 'paid',
    channel: 'pos',
    registerId: 'register-1',
    lineItems: [
      { productId: 'reader', name: 'Stripe Reader S710', quantity: 2, unitAmountCents: 30_000 },
      { productId: 'shirt', name: 'T-shirt', quantity: 1, unitAmountCents: 2_500 },
    ],
    totals: { itemsCents: 62_500, shippingCents: 0, discountCents: 0, taxCents: 5_162, totalCents: 67_662, feeCents: 0 },
    payments,
    hardwareOrderId: ID,
  })
  const order = inPersonPosHardwareOrder({
    ...CONFIG,
    registerOrderId: 'order-1',
    number: 9,
    registerId: 'register-1',
    kiosk: false,
    offline: false,
    share: posHardwareRegisterShare({
      lines: [
        { sku: 'stripe-reader-s710', quantity: 2, unitAmountCents: 30_000 },
        { sku: null, quantity: 1, unitAmountCents: 2_500 },
      ],
      discountCents: 0,
      taxCents: 5_162,
    })!,
    paidAtMs: 1_000,
    tenders: ['card_present'],
    paymentLinkSessionId: null,
    receiptEmail: null,
    buyer: { uid: 'uid-pat', orgId: 'org-pat', hostId: 'host-pat', email: 'pat@example.com', attachedBy: 'cashier', attachedAtMs: 1_000 },
    taxRegion: { country: 'US', state: 'TX', postalCode: null },
    ratePct: 8.25,
    stripeAccountId: 'acct_seller',
    livemode: true,
  })
  fakeDocs.set(`orgs/org-pat/hardwareOrders/${ID}`, order as any)
  fakeDocs.set(`posHardwareSales/${ID}`, posHardwareSaleRecord(ID, order) as any)
  return order
}

const hardware = () => fakeDocs.get(`orgs/org-pat/hardwareOrders/${ID}`) as PosHardwareOrder

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
async function merchant(handler: PluginApiHandler, body: Record<string, unknown>) {
  const { res, result } = response()
  await handler(
    { method: 'POST', query: {}, body, headers: { authorization: 'Bearer pat' }, cookies: {}, socket: {} } as unknown as PluginApiRequest,
    res,
  )
  return result
}
async function staff(init: { method?: string; query?: string; body?: unknown } = {}) {
  const answer = await posHardwareAdminOrders(
    new Request(`https://console.example.com/api/commerce/admin/hardware-orders${init.query ?? ''}`, {
      method: init.method ?? 'GET',
      headers: { authorization: 'Bearer staff-super', 'content-type': 'application/json' },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    }),
  )
  return { status: answer.status, body: await answer.json() }
}

beforeEach(() => {
  resetFakeFirestore()
  mockSendEmail.mockClear()
  mockAlerts.length = 0
  mockRefunds.length = 0
  mockRefundAnswer = { ok: true, refundId: 're_1' }
  process.env[POS_HARDWARE_ENV.inPersonEnabled] = 'true'
  process.env[POS_HARDWARE_ENV.sellerHostId] = 'host-seller'
  process.env[POS_HARDWARE_ENV.sellerOrgId] = 'org-seller'
})
afterAll(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('a refund on an in-person order', () => {
  it('is written once by its key, and the order is Refunded once every item is back', () => {
    const order = seed()
    const one = withPosHardwareRefund(order, { key: 'register:r1', via: 'register', cents: 32_475, quantity: 1, atMs: 5, stripeRefundId: null })
    expect(one).toMatchObject({ status: 'delivered', refundedCents: 32_475, refundedAtMs: 5 })
    expect(withPosHardwareRefund(one, { key: 'register:r1', via: 'register', cents: 32_475, quantity: 1, atMs: 6, stripeRefundId: null })).toBe(one)
    const both = withPosHardwareRefund(one, { key: 'register:r2', via: 'register', cents: 32_475, quantity: 1, atMs: 7, stripeRefundId: null })
    expect(both).toMatchObject({ status: 'refunded', refundedCents: 64_950, refundedAtMs: 7 })
  })
})

describe('a return at the selling store’s register', () => {
  it('takes the hardware’s share of what it refunded onto the order and its sale record, once', async () => {
    seed()
    const lines = [
      { index: 0, quantity: 1, refundCents: 32_475 },
      { index: 1, quantity: 1, refundCents: 2_706 },
    ]
    await recordRegisterHardwareReturn({ config: CONFIG, hostId: 'host-seller', registerOrderId: 'order-1', returnId: 'r1', refundCents: 35_181, lines, now: 50 })
    expect(hardware()).toMatchObject({ refundedCents: 32_475, refundedAtMs: 50, status: 'delivered' })
    expect(hardware().refunds).toEqual([{ key: 'register:r1', via: 'register', cents: 32_475, quantity: 1, atMs: 50, stripeRefundId: null }])
    expect(fakeDocs.get(`posHardwareSales/${ID}`)).toMatchObject({ refundedCents: 32_475, refundedAtMs: 50 })
    await recordRegisterHardwareReturn({ config: CONFIG, hostId: 'host-seller', registerOrderId: 'order-1', returnId: 'r1', refundCents: 35_181, lines, now: 60 })
    expect(hardware().refunds).toHaveLength(1)
  })

  it('takes a part-return in the lines’ own proportion, and nothing for another store or no reader', async () => {
    seed()
    await recordRegisterHardwareReturn({
      config: CONFIG,
      hostId: 'host-seller',
      registerOrderId: 'order-1',
      returnId: 'r2',
      // A card refused after the cash part went back: half of it moved.
      refundCents: 17_591,
      lines: [
        { index: 0, quantity: 1, refundCents: 32_475 },
        { index: 1, quantity: 1, refundCents: 2_706 },
      ],
    })
    expect(hardware().refundedCents).toBe(16_238)
    await recordRegisterHardwareReturn({ config: CONFIG, hostId: 'host-seller', registerOrderId: 'order-1', returnId: 'r3', refundCents: 2_706, lines: [{ index: 1, quantity: 1, refundCents: 2_706 }] })
    expect(await recordRegisterHardwareReturn({ config: CONFIG, hostId: 'host-other', registerOrderId: 'order-1', returnId: 'r4', refundCents: 1, lines: [{ index: 0, quantity: 1, refundCents: 1 }] })).toBeNull()
    expect(hardware().refunds).toHaveLength(1)
  })
})

describe('a refund from the staff page', () => {
  it("goes back through the register sale's own card refund, on the store's account, and is recorded there", async () => {
    const seeded = seed()
    // The readers' share: 60,000 plus their share of the tax, 4,956.
    expect(seeded.totalCents).toBe(64_956)
    const answer = await staff({ method: 'POST', body: { action: 'refund', orgId: 'org-pat', orderId: ID } })
    expect(answer.status).toBe(200)
    expect(mockRefunds).toEqual([
      expect.objectContaining({ paymentIntentId: 'pi_booth', amountCents: 64_956, idempotencyKey: `pos-hw-refund-${ID}-1` }),
    ])
    expect(hardware()).toMatchObject({ status: 'refunded', refundedCents: 64_956, refundId: 're_1' })
    expect(hardware().refunds?.[0]).toMatchObject({ via: 'staff', quantity: 2 })
    const register = fakeDocs.get('hosts/host-seller/orders/order-1')!
    expect(register['refundedCents']).toBe(64_956)
    expect(register['status']).toBe('paid')
    expect(fakeDocs.get('hosts/host-seller/registers/register-1/orderRefunds/re_1')).toMatchObject({
      orderId: 'order-1',
      refundedCents: 64_956,
      source: 'staff',
      stripeRefundId: 're_1',
    })
    expect(fakeDocs.get(`posHardwareSales/${ID}`)).toMatchObject({ status: 'refunded', refundedCents: 64_956 })
    // Cancel says the same for a reader handed over at the sale.
    expect((await staff({ method: 'POST', body: { action: 'cancel', orgId: 'org-pat', orderId: ID } })).status).toBe(200)
    expect(mockRefunds).toHaveLength(1)
  })

  it('refuses a cash sale, which goes back at the register, and hands a refused card refund back', async () => {
    seed([{ id: 'pay-cash', method: 'cash', amountCents: 67_662, status: 'succeeded', atMs: 900 }])
    const cash = await staff({ method: 'POST', body: { action: 'refund', orgId: 'org-pat', orderId: ID } })
    expect(cash.status).toBe(409)
    expect(cash.body.error).toMatch(/return at the selling store/)
    resetFakeFirestore()
    seed()
    mockRefundAnswer = { ok: false, status: 400, error: 'No', code: 'x' }
    expect((await staff({ method: 'POST', body: { action: 'refund', orgId: 'org-pat', orderId: ID } })).status).toBe(502)
    expect(fakeDocs.get('hosts/host-seller/orders/order-1')?.['refundedCents']).toBe(0)
    expect(hardware().status).toBe('delivered')
  })
})

/*==========================================
 * EMAIL THE BUYER (AGL-4038): a staff refund of a reader sold in person
 * sends the curated refund email when staff leave "Email the buyer" on,
 * once per refund, and nothing when they turn it off.
 *=========================================*/
describe('emailing the buyer about a refund from the staff page', () => {
  it('sends the refund email, once, to the buyer the order names, when asked', async () => {
    seed()
    const answer = await staff({ method: 'POST', body: { action: 'refund', orgId: 'org-pat', orderId: ID, notifyBuyer: true } })
    expect(answer.status).toBe(200)
    expect(answer.body.buyerEmail).toBe('sent')
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const sent = mockSendEmail.mock.calls[0][0] as { to: string; context: string; subject: string; text: string }
    expect(sent).toMatchObject({ to: 'pat@example.com', context: 'pos-hardware-order-refunded' })
    expect(sent.subject).toBe('Your refund for card reader order HW-AAAAAA')
    expect(JSON.parse(sent.text)).toMatchObject({ 'order.refundedNow': '$649.56', 'order.refunded': '$649.56' })
    const key = `refunded:${hardware().refunds?.[0]?.key}`
    expect(hardware().buyerEmails?.[key]?.state).toBe('sent')
    // Refunded in full already: a second press refunds nothing and tells nobody again.
    await staff({ method: 'POST', body: { action: 'refund', orgId: 'org-pat', orderId: ID, notifyBuyer: true } })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when staff turn it off', async () => {
    seed()
    const answer = await staff({ method: 'POST', body: { action: 'cancel', orgId: 'org-pat', orderId: ID, notifyBuyer: false } })
    expect(answer.status).toBe(200)
    expect(answer.body.buyerEmail).toBe('off')
    expect(hardware()).toMatchObject({ status: 'refunded' })
    expect(hardware().buyerEmails).toBeUndefined()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe("the buyer's return request", () => {
  it('is asked once with a reason, alerts staff, and staff decline it with a note', async () => {
    seed()
    const asked = await merchant(posHardwareHandler, { action: 'request-return', hostId: 'host-pat', orderId: ID, reason: 'Not needed' })
    expect(asked.status).toBe(200)
    expect(asked.body.order.returnRequest).toMatchObject({ state: 'requested' })
    expect(mockAlerts).toEqual([
      expect.objectContaining({
        type: 'commerce.posHardwareReturnRequested',
        options: expect.objectContaining({ orgId: 'org-pat', context: expect.objectContaining({ reason: 'Not needed' }) }),
      }),
    ])
    await merchant(posHardwareHandler, { action: 'request-return', hostId: 'host-pat', orderId: ID, reason: 'Again' })
    expect(mockAlerts).toHaveLength(1)
    const listed = await staff({ query: '?returns=requested' })
    expect(listed.body.orders.map((order: any) => [order.id, order.returnRequest.reason])).toEqual([[ID, 'Not needed']])
    const declined = await staff({ method: 'POST', body: { action: 'decline-return', orgId: 'org-pat', orderId: ID, note: 'Used and damaged' } })
    expect(declined.body.order.returnRequest).toMatchObject({ state: 'declined', note: 'Used and damaged', decidedBy: 'staff-1' })
    expect((await staff({ method: 'POST', body: { action: 'decline-return', orgId: 'org-pat', orderId: ID } })).status).toBe(409)
  })

  it('is refunded by the staff refund, and the buyer’s words go with their account', async () => {
    seed()
    await merchant(posHardwareHandler, { action: 'request-return', hostId: 'host-pat', orderId: ID, reason: 'Not needed' })
    await staff({ method: 'POST', body: { action: 'refund', orgId: 'org-pat', orderId: ID } })
    expect(hardware().returnRequest).toMatchObject({ state: 'refunded' })
    expect(posHardwareBuyerErasedPatch(hardware(), 9)['returnRequest']).toMatchObject({ state: 'refunded', reason: null, requestedBy: null })
  })

  it('needs a reason, and is refused for an order already refunded or one shipped to them that has not shipped yet', async () => {
    seed()
    expect((await merchant(posHardwareHandler, { action: 'request-return', hostId: 'host-pat', orderId: ID, reason: '' })).status).toBe(400)
    fakeDocs.set('orgs/org-pat/hardwareOrders/hw_bbbbbbbbbbbbbbbbbbbb', { orgId: 'org-pat', status: 'ordered', lines: [] })
    const unshipped = await merchant(posHardwareHandler, { action: 'request-return', hostId: 'host-pat', orderId: 'hw_bbbbbbbbbbbbbbbbbbbb', reason: 'Broken' })
    expect(unshipped).toMatchObject({ status: 409, body: { error: expect.stringMatching(/contact support/) } })
    fakeDocs.set(`orgs/org-pat/hardwareOrders/${ID}`, { ...hardware(), status: 'refunded' } as any)
    expect((await merchant(posHardwareHandler, { action: 'request-return', hostId: 'host-pat', orderId: ID, reason: 'Broken' })).status).toBe(409)
  })
})

describe('returning an order shipped to the buyer (AGL-4038)', () => {
  const ONLINE = 'hw_cccccccccccccccccccc'
  const online = () => fakeDocs.get(`orgs/org-pat/hardwareOrders/${ONLINE}`) as PosHardwareOrder
  const stripeCalls: Array<{ path: string; key: string | null; params: URLSearchParams }> = []
  let refuse = false

  beforeEach(() => {
    stripeCalls.length = 0
    refuse = false
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_returns'
    ;(global as any).fetch = jest.fn(async (url: any, init: any) => {
      const path = new URL(String(url)).pathname.replace(/^\/v1\//, '')
      const headers = (init?.headers ?? {}) as Record<string, string>
      stripeCalls.push({ path, key: headers['Idempotency-Key'] ?? null, params: new URLSearchParams(String(init?.body ?? '')) })
      if (refuse) return { ok: false, status: 400, json: async () => ({ error: { message: 'Charge already refunded' } }) }
      return { ok: true, status: 200, json: async () => ({ id: `re_ret${stripeCalls.length}`, amount: Number(new URLSearchParams(String(init?.body ?? '')).get('amount')) }) }
    })
    fakeDocs.set('hosts/host-pat', { name: 'Main Street', orgId: 'org-pat' })
    const order = {
      orgId: 'org-pat',
      hostId: 'host-pat',
      createdBy: 'uid-pat',
      contactEmail: 'pat@example.com',
      lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 13_000, lineCents: 13_000 }],
      subtotalCents: 13_000,
      shipping: { method: 'standard', label: 'Standard', cents: 1_000, name: 'Pat Lee', phone: null, address: null },
      taxCents: 1_073,
      totalCents: 15_073,
      currency: 'usd',
      stripeCheckoutSessionId: 'cs_1',
      stripePaymentIntentId: 'pi_online',
      stripeHardwareOrderId: 'thor_1',
      tracking: null,
      status: 'delivered',
      livemode: false,
      createdAtMs: 1,
      updatedAtMs: 1,
      paidAtMs: 1,
    } as unknown as PosHardwareOrder
    fakeDocs.set(`orgs/org-pat/hardwareOrders/${ONLINE}`, order as any)
    fakeDocs.set(`posHardwareSales/${ONLINE}`, posHardwareSaleRecord(ONLINE, order) as any)
  })
  afterAll(() => {
    delete process.env['STRIPE_SECRET_KEY']
  })

  it('may be asked back once it has shipped, and staff are alerted', async () => {
    const asked = await merchant(posHardwareHandler, { action: 'request-return', hostId: 'host-pat', orderId: ONLINE, reason: 'Wrong model' })
    expect(asked.status).toBe(200)
    expect(online().returnRequest).toMatchObject({ state: 'requested', reason: 'Wrong model' })
    expect(mockAlerts.map((alert) => alert.type)).toEqual(['commerce.posHardwareReturnRequested'])
  })

  it('is refunded as a return: the items and their tax, less the restocking fee, once, and the buyer is told once', async () => {
    await merchant(posHardwareHandler, { action: 'request-return', hostId: 'host-pat', orderId: ONLINE, reason: 'Wrong model' })
    const refunded = await staff({
      method: 'POST',
      body: { action: 'refund-return', orgId: 'org-pat', orderId: ONLINE, restockingFeeCents: 1_500 },
    })
    expect(refunded.status).toBe(200)
    // 15,073 paid − 1,000 original shipping − 1,500 restocking fee.
    expect(stripeCalls.map((call) => [call.path, call.params.get('payment_intent'), call.params.get('amount'), call.key])).toEqual([
      ['refunds', 'pi_online', '12573', `pos-hw-return-${ONLINE}-12573`],
    ])
    expect(online()).toMatchObject({
      status: 'refunded',
      refundedCents: 12_573,
      returnRequest: { state: 'refunded', decidedBy: 'staff-1' },
      refunds: [{ via: 'staff', cents: 12_573, quantity: 1, stripeRefundId: 're_ret1' }],
    })
    expect(online()).not.toHaveProperty('refundRequestedAtMs')
    expect(fakeDocs.get(`posHardwareSales/${ONLINE}`)).toMatchObject({ status: 'refunded', refundedCents: 12_573 })
    expect(refunded.body.buyerEmail).toBe('sent')
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const sent = mockSendEmail.mock.calls[0][0] as Record<string, any>
    expect(sent).toMatchObject({ to: 'pat@example.com', context: 'pos-hardware-return-refunded' })
    expect(JSON.parse(String(sent['text']))).toMatchObject({ 'order.refundedNow': '$125.73', 'order.kept': '$25.00' })
    // Pressed again: nothing more is refunded or sent.
    expect((await staff({ method: 'POST', body: { action: 'refund-return', orgId: 'org-pat', orderId: ONLINE } })).status).toBe(409)
    expect(stripeCalls).toHaveLength(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('needs an open request, a fee that leaves something, and hands a Stripe refusal back with nothing recorded', async () => {
    expect((await staff({ method: 'POST', body: { action: 'refund-return', orgId: 'org-pat', orderId: ONLINE } })).status).toBe(409)
    await merchant(posHardwareHandler, { action: 'request-return', hostId: 'host-pat', orderId: ONLINE, reason: 'Wrong model' })
    expect((await staff({ method: 'POST', body: { action: 'refund-return', orgId: 'org-pat', orderId: ONLINE, restockingFeeCents: -5 } })).status).toBe(400)
    expect((await staff({ method: 'POST', body: { action: 'refund-return', orgId: 'org-pat', orderId: ONLINE, restockingFeeCents: 14_073 } })).status).toBe(400)
    refuse = true
    const refused = await staff({ method: 'POST', body: { action: 'refund-return', orgId: 'org-pat', orderId: ONLINE } })
    expect(refused.status).toBe(409)
    expect(online()).toMatchObject({ status: 'delivered', returnRequest: { state: 'requested' } })
    expect(online()).not.toHaveProperty('refundRequestedAtMs')
    // Staff decline it instead, as for a reader sold in person.
    const declined = await staff({ method: 'POST', body: { action: 'decline-return', orgId: 'org-pat', orderId: ONLINE, note: 'Outside 30 days' } })
    expect(declined.body.order.returnRequest).toMatchObject({ state: 'declined', note: 'Outside 30 days' })
  })
})

