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
 * The POS hardware shop's server (AGL-4038), driven through the real
 * handlers with Stripe and Firestore faked at their boundaries:
 *
 * - the shop route is hidden without config, prices on the server, and makes
 *   a PLATFORM Checkout Session (no connected account, no transfer) under one
 *   idempotency key per attempt;
 * - the webhook writes one order per paid session, and a replay writes no
 *   second order, sends no second email and raises no second alert;
 * - the staff route admits staff only, writes only for super or billing,
 *   moves an order one step at a time, emails at shipped and delivered, and
 *   refunds in full only before the order ships;
 * - every write to an order rewrites its retained sale record
 *   (`posHardwareSales/{orderId}`), which holds the amounts, the tax and the
 *   tax region and nothing about the buyer, and an account erasure takes the
 *   buyer off the order and keeps the rest (AGL-4038 retention).
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'

let mockManagePos = true
/** The finer "Buy point of sale hardware" key (AGL-4047); undefined follows `managePos`. */
let mockBuyHardware: boolean | undefined
let mockPlan = 'business'
const mockSendEmail = jest.fn<Promise<{ sent: boolean }>, [Record<string, unknown>]>(async () => ({ sent: true }))
const mockRaiseAlert = jest.fn<Promise<{ outcome: string }>, unknown[]>(async () => ({ outcome: 'sent' }))
const mockAudit = jest.fn<Promise<{ id: string }>, unknown[]>(async () => ({ id: 'audit-1' }))

/** Token → decoded claims, so each test names who is calling. */
const TOKENS: Record<string, Record<string, unknown>> = {
  manager: { uid: 'manager-1', email_verified: true },
  stranger: { uid: 'stranger', email_verified: true },
  'staff-super': { uid: 'staff-1', email: 'ops@example.com', email_verified: true, staff: true, staffRole: 'super' },
  'staff-billing': { uid: 'staff-2', email_verified: true, staff: true, staffRole: 'billing' },
  'staff-support': { uid: 'staff-3', email_verified: true, staff: true, staffRole: 'support' },
  'staff-norole': { uid: 'staff-4', email_verified: true, staff: true },
}

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    permissions: {
      managePos: mockManagePos,
      ...(mockBuyHardware === undefined ? {} : { posBuyHardware: mockBuyHardware }),
    },
  }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            const decoded = TOKENS[token]
            if (!decoded) throw Object.assign(new Error('Firebase ID token has expired.'), { code: 'auth/id-token-expired' })
            return decoded
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async () => ({
      orgId: 'org-1',
      org: { id: 'org-1', plan: mockPlan, subscriptionStatus: 'active', ownerUid: 'owner-1', slug: 'acme' },
    }),
    readOrgBilling: async () => ({ stripeCustomerId: 'cus_platform_1' }),
    hostDisplayName: (host: Record<string, unknown>, id: string) => String(host['name'] ?? id),
    meterPlatformEmail: async () => undefined,
    raiseOperatorAlert: (...args: unknown[]) => mockRaiseAlert(...args),
    emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
  }
})
jest.mock('@aglyn/tenant-data-admin/server/host-console-link', () => ({
  hostConsoleUrl: async (hostId: string, link: string) =>
    `https://console.example.com/acme/hosts/${hostId}${link.replace(`/${hostId}`, '')}`,
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  addAdminAudit: (...args: unknown[]) => mockAudit(...args),
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
  sendEmail: (message: Record<string, unknown>) => mockSendEmail(message),
}))

import { posHardwareHandler, posHardwareOrderId } from './pos-hardware'
import { posHardwareBillingWebhookHandler } from './pos-hardware-webhook'
import { posHardwareAdminOrders } from './pos-hardware-admin'
import { posHardwareEmailMerge } from './pos-hardware-notify'
import { createPosHardwareUserEraser } from './pos-hardware-user-eraser'
import { createPosHardwareOrgEraser } from './pos-hardware-closure'
import { fakeFirestore } from '../testing/fake-firestore'
import {
  POS_HARDWARE_ENV,
  posHardwareSaleRecord,
  type PosHardwareOrder,
  type PosHardwareSaleRecord,
} from '../model/pos-hardware'
import {
  COMMERCE_POS_HARDWARE_CANCELED_AFTER_ORDERING,
  COMMERCE_POS_HARDWARE_REFUND_FAILED,
} from '../constants/operator-alerts'
import { readFileSync } from 'fs'
import { join } from 'path'
import { POS_HARDWARE_EMAIL_KEYS, posHardwareSystemEmailTemplates } from '@aglyn/shared-util-email/pos-hardware-emails'

interface StripeCall {
  method: string
  path: string
  key: string | null
  headers: Record<string, string>
  params: URLSearchParams
}
const stripeCalls: StripeCall[] = []
let refundOk = true
/** A refund Stripe already made on the payment: a new ask is refused as already refunded. */
let refundAlready: { id: string; amount: number } | null = null
/** The expanded Checkout Session Stripe answers with its tax breakdown. */
let expandedSession: Record<string, unknown> | null = null

const fetchMock = jest.fn(async (url: any, init: any) => {
  const target = new URL(String(url))
  const path = target.pathname.replace(/^\/v1\//, '')
  // A GET carries its parameters on the URL, a POST in its body.
  const params = init?.method === 'GET' ? target.searchParams : new URLSearchParams(String(init?.body ?? ''))
  const headers = (init?.headers ?? {}) as Record<string, string>
  stripeCalls.push({ method: String(init?.method ?? 'GET'), path, key: headers['Idempotency-Key'] ?? null, headers, params })
  if (path === 'checkout/sessions') {
    return { ok: true, status: 200, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) }
  }
  if (path.startsWith('checkout/sessions/') && init?.method === 'GET') {
    return expandedSession
      ? { ok: true, status: 200, json: async () => expandedSession }
      : { ok: false, status: 404, json: async () => ({ error: { message: 'No such session' } }) }
  }
  if (path === 'refunds' && init?.method === 'GET') {
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: refundAlready ? [{ ...refundAlready, status: 'succeeded' }] : [] }),
    }
  }
  if (path === 'refunds' && refundAlready) {
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Charge already refunded', code: 'charge_already_refunded' } }),
    }
  }
  if (path === 'refunds') {
    return refundOk
      ? { ok: true, status: 200, json: async () => ({ id: 're_1', amount: Number(23_120) }) }
      : { ok: false, status: 400, json: async () => ({ error: { message: 'Charge already refunded', code: 'charge_already_refunded' } }) }
  }
  return { ok: false, status: 404, json: async () => ({ error: { message: 'nope' } }) }
})

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
    send(body: unknown) {
      result.body = body
    },
    setHeader() {},
    redirect() {},
    end() {},
  } as unknown as PluginApiResponse
  return { res, result }
}

async function shop(body: Record<string, unknown>, options: { token?: string; attemptKey?: string } = {}) {
  const { res, result } = response()
  const req: PluginApiRequest = {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', ...body },
    headers: {
      authorization: `Bearer ${options.token ?? 'manager'}`,
      ...(options.attemptKey ? { 'idempotency-key': options.attemptKey } : {}),
    },
    cookies: {},
    socket: {},
  }
  await posHardwareHandler(req, res)
  return result
}

async function staff(token: string, init: { method?: string; query?: string; body?: unknown } = {}) {
  const request = new Request(`https://console.example.com/api/commerce/admin/hardware-orders${init.query ?? ''}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  })
  const answer = await posHardwareAdminOrders(request)
  return { status: answer.status, body: (await answer.json()) as any }
}

const SHOP_ENV = {
  [POS_HARDWARE_ENV.enabled]: 'true',
  [POS_HARDWARE_ENV.prices]: JSON.stringify({ 'stripe-reader-s710': 10_000, 'stripe-reader-m2': 5_900 }),
  [POS_HARDWARE_ENV.markupBps]: '3000',
  [POS_HARDWARE_ENV.shipping]: JSON.stringify({ standard: 1_000, express: 2_500 }),
}

function setShopEnv(env: Record<string, string> | null) {
  for (const name of Object.values(POS_HARDWARE_ENV)) delete process.env[name]
  if (env) Object.assign(process.env, env)
}

/** A paid Checkout Session as the platform webhook delivers it. */
function paidSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_1',
    object: 'checkout.session',
    mode: 'payment',
    payment_status: 'paid',
    livemode: false,
    currency: 'usd',
    amount_total: 23_120,
    shipping_cost: { amount_total: 1_000 },
    total_details: { amount_tax: 0 },
    payment_intent: 'pi_test_1',
    customer_details: { email: 'buyer@example.com', name: 'Jordan Lee', phone: '+15555550100' },
    collected_information: {
      shipping_details: {
        name: 'Jordan Lee',
        address: { line1: '12 Main St', city: 'Springfield', state: 'IL', postal_code: '62701', country: 'US' },
      },
    },
    metadata: {
      type: 'pos-hardware-order',
      orderId: ORDER_ID,
      orgId: 'org-1',
      hostId: 'host-1',
      uid: 'manager-1',
      lines: 'stripe-reader-s710*1*13000;stripe-reader-m2*1*7670',
      shippingMethod: 'standard',
      shippingCents: '1000',
    },
    ...overrides,
  }
}

const ORDER_ID = 'hw_0123456789abcdef0123'
const ORDER_PATH = `orgs/org-1/hardwareOrders/${ORDER_ID}`
const SALE_PATH = `posHardwareSales/${ORDER_ID}`

/**
 * Every personal detail the fixtures carry, none of which a sale record may
 * hold. The tracking number is matched as a word: a record's ISO expiry ends
 * in a digit and `Z` (`…701Z`), which is not a tracking number.
 */
const PERSONAL = /Jordan|Pat Lee|Main St|Elm St|buyer@example|5555550100|manager-1|\b1Z\b/

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  resetFakeFirestore()
  stripeCalls.length = 0
  mockSendEmail.mockClear()
  mockRaiseAlert.mockClear()
  mockAudit.mockClear()
  mockManagePos = true
  mockBuyHardware = undefined
  mockPlan = 'business'
  refundOk = true
  refundAlready = null
  expandedSession = null
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
  delete process.env.STRIPE_TERMINAL_LIVE_ENABLED
  setShopEnv(SHOP_ENV)
  fakeDocs.set('hosts/host-1', { name: 'Corner Cafe', memberRoles: { 'manager-1': 'editor' } })
  fakeDocs.set('orgs/org-1', { name: 'Acme', slug: 'acme' })
})

afterAll(() => setShopEnv(null))

describe('the shop route', () => {
  it('answers not available, and starts no checkout, without config', async () => {
    setShopEnv(null)
    expect((await shop({ action: 'catalog' })).body).toEqual({ available: false })
    const checkout = await shop(
      { action: 'checkout', lines: [{ sku: 'stripe-reader-s710', quantity: 1 }], shippingMethod: 'standard' },
      { attemptKey: 'attempt-1' },
    )
    expect(checkout.status).toBe(404)
    expect(stripeCalls).toHaveLength(0)
  })

  it('stays hidden in live mode until card readers are live', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake'
    expect((await shop({ action: 'catalog' })).body).toEqual({ available: false })
    process.env.STRIPE_TERMINAL_LIVE_ENABLED = 'true'
    expect((await shop({ action: 'catalog' })).body.available).toBe(true)
  })

  it('lists the offers at the marked-up price, never Stripe’s', async () => {
    const answer = await shop({ action: 'catalog' })
    expect(answer.body.offers.map((offer: any) => [offer.sku, offer.unitCents])).toEqual([
      ['stripe-reader-s710', 13_000],
      ['stripe-reader-m2', 7_670],
    ])
    expect(JSON.stringify(answer.body)).not.toContain('10000')
  })

  it('refuses a viewer who may not run the register', async () => {
    mockManagePos = false
    expect((await shop({ action: 'catalog' })).status).toBe(403)
    expect((await shop({ action: 'catalog' }, { token: 'stranger' })).status).toBe(403)
  })

  it('lets only a member holding the buy key check out, and still shows them the shop (AGL-4047)', async () => {
    mockBuyHardware = false
    expect((await shop({ action: 'catalog' })).status).toBe(200)
    expect((await shop({ action: 'orders' })).status).toBe(200)
    const refused = await shop(
      { action: 'checkout', lines: [{ sku: 'stripe-reader-m2', quantity: 1 }], shippingMethod: 'standard' },
      { attemptKey: 'attempt-1' },
    )
    expect(refused.status).toBe(403)
    expect(refused.body.error).toContain('Buy point of sale hardware')
    expect(stripeCalls).toHaveLength(0)
    // Granted outright, it checks out.
    mockBuyHardware = true
    const bought = await shop(
      { action: 'checkout', lines: [{ sku: 'stripe-reader-m2', quantity: 1 }], shippingMethod: 'standard' },
      { attemptKey: 'attempt-2' },
    )
    expect(bought.status).toBe(200)
  })

  it('lets a member who may buy hardware without the register see the shop, their orders and check out (AGL-4047)', async () => {
    mockManagePos = false
    mockBuyHardware = true
    expect((await shop({ action: 'catalog' })).status).toBe(200)
    expect((await shop({ action: 'orders' })).status).toBe(200)
    const bought = await shop(
      { action: 'checkout', lines: [{ sku: 'stripe-reader-m2', quantity: 1 }], shippingMethod: 'standard' },
      { attemptKey: 'attempt-hw-only' },
    )
    expect(bought.status).toBe(200)
    expect(stripeCalls.filter((call) => call.path === 'checkout/sessions')).toHaveLength(1)
    // With neither the register nor the key, the shop is shut.
    mockBuyHardware = undefined
    expect((await shop({ action: 'catalog' })).status).toBe(403)
    mockBuyHardware = false
    expect((await shop({ action: 'orders' })).status).toBe(403)
  })

  it('refuses a checkout to a member who works the register with buying hardware denied (AGL-4047)', async () => {
    mockManagePos = true
    mockBuyHardware = false
    const refused = await shop(
      { action: 'checkout', lines: [{ sku: 'stripe-reader-m2', quantity: 1 }], shippingMethod: 'standard' },
      { attemptKey: 'attempt-denied' },
    )
    expect(refused.status).toBe(403)
    expect(refused.body.error).toContain('Buy point of sale hardware')
    expect(stripeCalls).toHaveLength(0)
  })

  it('asks the permissions, not the site role: a site viewer granted the register is admitted (AGL-4047)', async () => {
    fakeDocs.set('hosts/host-1', { name: 'Corner Cafe', memberRoles: { 'manager-1': 'viewer' } })
    expect((await shop({ action: 'catalog' })).status).toBe(200)
    mockManagePos = false
    expect((await shop({ action: 'catalog' })).status).toBe(403)
  })

  it('makes a PLATFORM checkout session priced on the server, under one key per attempt', async () => {
    const answer = await shop(
      {
        action: 'checkout',
        lines: [
          { sku: 'stripe-reader-s710', quantity: 1, unitCents: 1 },
          { sku: 'stripe-reader-m2', quantity: 1 },
        ],
        shippingMethod: 'standard',
      },
      { attemptKey: 'attempt-1' },
    )
    expect(answer.status).toBe(200)
    expect(answer.body.url).toBe('https://checkout.stripe.com/c/pay/cs_test_1')
    const orderId = posHardwareOrderId('org-1', 'host-1', 'attempt-1')
    expect(answer.body.orderId).toBe(orderId)
    expect(stripeCalls).toHaveLength(1)
    const [call] = stripeCalls
    expect(call.path).toBe('checkout/sessions')
    expect(call.key).toBe(`pos-hw-checkout-${orderId}`)
    // The platform's own sale: no connected account in any shape.
    expect(call.headers['Stripe-Account']).toBeUndefined()
    expect([...call.params.keys()].filter((key) => /transfer_data|application_fee|on_behalf_of/.test(key))).toEqual([])
    expect(call.params.get('mode')).toBe('payment')
    expect(call.params.get('customer')).toBe('cus_platform_1')
    expect(call.params.get('line_items[0][price_data][unit_amount]')).toBe('13000')
    expect(call.params.get('line_items[1][price_data][unit_amount]')).toBe('7670')
    expect(call.params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('1000')
    expect(call.params.get('shipping_address_collection[allowed_countries][0]')).toBe('US')
    expect(call.params.get('automatic_tax[enabled]')).toBeNull()
    expect(call.params.get('metadata[type]')).toBe('pos-hardware-order')
    expect(call.params.get('metadata[lines]')).toBe('stripe-reader-s710*1*13000;stripe-reader-m2*1*7670')
    expect(call.params.get('success_url')).toBe(
      'https://console.example.com/acme/hosts/host-1/products/pos?hardwareOrder=placed#pos-hardware',
    )
  })

  it('turns automatic tax on only when the config says so', async () => {
    setShopEnv({ ...SHOP_ENV, [POS_HARDWARE_ENV.automaticTax]: 'true' })
    await shop(
      { action: 'checkout', lines: [{ sku: 'stripe-reader-s710', quantity: 1 }], shippingMethod: 'express' },
      { attemptKey: 'attempt-2' },
    )
    const [call] = stripeCalls
    expect(call.params.get('automatic_tax[enabled]')).toBe('true')
    expect(call.params.get('line_items[0][price_data][tax_behavior]')).toBe('exclusive')
    expect(call.params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('2500')
  })

  it.each([
    ['no attempt key', { lines: [{ sku: 'stripe-reader-s710', quantity: 1 }], shippingMethod: 'standard' }, ''],
    ['an unpriced item', { lines: [{ sku: 'bbpos-wisepos-e', quantity: 1 }], shippingMethod: 'standard' }, 'k'],
    ['a speed that is not offered', { lines: [{ sku: 'stripe-reader-s710', quantity: 1 }], shippingMethod: 'priority' }, 'k'],
    ['too many of one item', { lines: [{ sku: 'stripe-reader-s710', quantity: 11 }], shippingMethod: 'standard' }, 'k'],
  ])('refuses a checkout with %s, before Stripe', async (_label, body, attemptKey) => {
    const answer = await shop({ action: 'checkout', ...body }, attemptKey ? { attemptKey } : {})
    expect(answer.status).toBe(400)
    expect(stripeCalls).toHaveLength(0)
  })

  it('lists this site’s orders without Stripe ids', async () => {
    fakeDocs.set(ORDER_PATH, { hostId: 'host-1', status: 'shipped', totalCents: 100, stripePaymentIntentId: 'pi_secret', lines: [] })
    fakeDocs.set('orgs/org-1/hardwareOrders/hw_ffffffffffffffffffff', { hostId: 'host-2', status: 'paid', lines: [] })
    const answer = await shop({ action: 'orders' })
    expect(answer.body.orders.map((order: any) => order.id)).toEqual([ORDER_ID])
    expect(JSON.stringify(answer.body)).not.toContain('pi_secret')
  })
})

describe('the webhook', () => {
  const deliver = (object: Record<string, unknown>, type = 'checkout.session.completed') =>
    posHardwareBillingWebhookHandler({ type, object, event: { type, data: { object } } })

  it('records a paid session as one order, and tells the buyer and staff', async () => {
    const result = await deliver(paidSession())
    expect(result).toEqual({ claimed: true, hostId: 'host-1' })
    const order = fakeDocs.get(ORDER_PATH) as PosHardwareOrder
    expect(order).toMatchObject({
      orgId: 'org-1',
      hostId: 'host-1',
      status: 'paid',
      subtotalCents: 20_670,
      totalCents: 23_120,
      taxCents: 0,
      contactEmail: 'buyer@example.com',
      stripeCheckoutSessionId: 'cs_test_1',
      stripePaymentIntentId: 'pi_test_1',
      stripeHardwareOrderId: null,
      tracking: null,
    })
    expect(order.shipping).toMatchObject({
      method: 'standard',
      cents: 1_000,
      address: { line1: '12 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' },
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      to: 'buyer@example.com',
      context: POS_HARDWARE_EMAIL_KEYS.received,
    })
    expect(mockRaiseAlert).toHaveBeenCalledTimes(1)
    expect(mockRaiseAlert.mock.calls[0][1]).toMatchObject({ dedupeKey: ORDER_ID })
  })

  it('makes no second order, email or alert when Stripe redelivers', async () => {
    await deliver(paidSession())
    const first = JSON.stringify(fakeDocs.get(ORDER_PATH))
    await deliver(paidSession())
    await deliver(paidSession())
    expect(JSON.stringify(fakeDocs.get(ORDER_PATH))).toBe(first)
    expect([...fakeDocs.keys()].filter((key) => key.includes('/hardwareOrders/'))).toHaveLength(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockRaiseAlert).toHaveBeenCalledTimes(1)
  })

  it('keeps Stripe’s tax base from the session’s breakdown where Stripe Tax ran', async () => {
    const taxed = paidSession({
      automatic_tax: { enabled: true },
      total_details: { amount_tax: 1_907 },
      amount_total: 25_027,
    })
    expandedSession = {
      ...taxed,
      total_details: {
        amount_tax: 1_907,
        breakdown: {
          taxes: [
            {
              amount: 1_907,
              taxable_amount: 23_120,
              taxability_reason: 'standard_rated',
              rate: { id: 'txr_tx', jurisdiction: 'Texas', state: 'TX', percentage: 8.25 },
            },
          ],
        },
      },
    }
    await deliver(taxed)
    expect(stripeCalls.map((call) => [call.method, call.path, call.params.get('expand[]')])).toEqual([
      ['GET', 'checkout/sessions/cs_test_1', 'total_details.breakdown'],
    ])
    const order = fakeDocs.get(ORDER_PATH) as PosHardwareOrder
    expect(order).toMatchObject({ automaticTax: true, taxCents: 1_907 })
    expect(order.taxLines).toEqual([
      {
        amountCents: 1_907,
        taxabilityReason: 'standard_rated',
        taxRateId: 'txr_tx',
        taxableAmountCents: 23_120,
        jurisdiction: 'Texas',
        rateState: 'TX',
        percentage: 8.25,
      },
    ])
    expect((fakeDocs.get(SALE_PATH) as PosHardwareSaleRecord).taxLines[0].taxableAmountCents).toBe(23_120)
  })

  it('still records the order, with no stated base, when the breakdown cannot be read', async () => {
    await deliver(paidSession({ automatic_tax: { enabled: true }, total_details: { amount_tax: 1_907 } }))
    expect(fakeDocs.get(ORDER_PATH)).toMatchObject({ automaticTax: true, taxCents: 1_907, taxLines: [] })
  })

  it('reads the older API’s shipping_details too', async () => {
    await deliver(
      paidSession({
        collected_information: undefined,
        shipping_details: {
          name: 'Pat Lee',
          address: { line1: '1 Elm St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
        },
      }),
    )
    expect((fakeDocs.get(ORDER_PATH) as PosHardwareOrder).shipping.name).toBe('Pat Lee')
  })

  it.each([
    ['an unpaid session', paidSession({ payment_status: 'unpaid' })],
    ['a subscription session', paidSession({ mode: 'subscription' })],
    ['a session whose lines do not read', paidSession({ metadata: { ...paidSession().metadata, lines: 'nope*1*1' } })],
    ['a malformed order id', paidSession({ metadata: { ...paidSession().metadata, orderId: 'hw_../../x' } })],
  ])('claims but records nothing for %s', async (_label, object) => {
    expect(await deliver(object)).toMatchObject({ claimed: true })
    expect([...fakeDocs.keys()].filter((key) => key.includes('/hardwareOrders/'))).toHaveLength(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('ignores every other session and event', async () => {
    expect(await deliver(paidSession({ metadata: { type: 'commerce-cart' } }))).toBeUndefined()
    expect(await deliver(paidSession(), 'checkout.session.expired')).toBeUndefined()
    expect([...fakeDocs.keys()].filter((key) => key.includes('/hardwareOrders/'))).toHaveLength(0)
  })
})

describe('the staff route', () => {
  const seedOrder = (fields: Partial<PosHardwareOrder> = {}) =>
    fakeDocs.set(ORDER_PATH, {
      orgId: 'org-1',
      hostId: 'host-1',
      status: 'paid',
      contactEmail: 'buyer@example.com',
      lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 13_000, lineCents: 13_000 }],
      subtotalCents: 13_000,
      shipping: { method: 'standard', label: 'Standard shipping', cents: 1_000, name: 'Jordan Lee', phone: null, address: null },
      taxCents: 0,
      totalCents: 14_000,
      stripePaymentIntentId: 'pi_test_1',
      stripeHardwareOrderId: null,
      tracking: null,
      createdAtMs: 1,
      updatedAtMs: 1,
      ...fields,
    })

  it('admits staff only', async () => {
    expect((await staff('manager')).status).toBe(403)
    expect((await staff('nobody')).status).toBe(401)
  })

  it('pages the staff list newest first, 25 at a time, by a cursor', async () => {
    for (let index = 0; index < 27; index += 1) {
      const id = `hw_${String(index).padStart(20, '0')}`
      fakeDocs.set(`orgs/org-${index % 3}/hardwareOrders/${id}`, {
        orgId: `org-${index % 3}`,
        status: 'paid',
        lines: [],
        createdAtMs: 1_000 + index,
      })
    }
    const first = await staff('staff-support')
    expect(first.status).toBe(200)
    expect(first.body.pageSize).toBe(25)
    expect(first.body.orders).toHaveLength(25)
    expect(first.body.orders[0].createdAtMs).toBe(1_026)
    expect(first.body.next).toMatch(/^orgs\/org-\d\/hardwareOrders\/hw_/)
    const second = await staff('staff-support', { query: `?after=${encodeURIComponent(first.body.next)}` })
    expect(second.body.orders.map((order: any) => order.createdAtMs)).toEqual([1_001, 1_000])
    expect(second.body.next).toBeNull()
    expect((await staff('staff-support', { query: '?after=hosts%2Fx%2Forders%2Fy' })).status).toBe(400)
  })

  it('lists every workspace’s orders, filtered by status on the query', async () => {
    seedOrder()
    fakeDocs.set('orgs/org-2/hardwareOrders/hw_ffffffffffffffffffff', { orgId: 'org-2', status: 'shipped', lines: [] })
    const all = await staff('staff-support')
    expect(all.status).toBe(200)
    expect(all.body.orders).toHaveLength(2)
    expect(all.body.canWrite).toBe(false)
    const shipped = await staff('staff-super', { query: '?status=shipped' })
    expect(shipped.body.orders.map((order: any) => order.orgId)).toEqual(['org-2'])
    expect(shipped.body.canWrite).toBe(true)
  })

  it.each(['staff-support', 'staff-norole'])('refuses every write to %s', async (token) => {
    seedOrder()
    const answer = await staff(token, { method: 'POST', body: { action: 'refund', orgId: 'org-1', orderId: ORDER_ID } })
    expect(answer.status).toBe(403)
    expect(stripeCalls).toHaveLength(0)
  })

  it('records Stripe’s order id and moves the order one step at a time', async () => {
    seedOrder()
    const ordered = await staff('staff-billing', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, stripeHardwareOrderId: 'thor_1', status: 'ordered' },
    })
    expect(ordered.status).toBe(200)
    expect(fakeDocs.get(ORDER_PATH)).toMatchObject({ status: 'ordered', stripeHardwareOrderId: 'thor_1' })
    expect(mockAudit).toHaveBeenCalledTimes(1)
    const skipped = await staff('staff-billing', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, status: 'delivered' },
    })
    expect(skipped.status).toBe(409)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('needs a tracking number to mark an order shipped, then emails the buyer once', async () => {
    seedOrder({ status: 'ordered' })
    const bare = await staff('staff-super', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, status: 'shipped' },
    })
    expect(bare.status).toBe(400)
    const shipped = await staff('staff-super', {
      method: 'POST',
      body: {
        action: 'update',
        orgId: 'org-1',
        orderId: ORDER_ID,
        status: 'shipped',
        tracking: { carrier: 'UPS', number: '1Z 999 AA1 01 2345 6784' },
      },
    })
    expect(shipped.status).toBe(200)
    expect((fakeDocs.get(ORDER_PATH) as PosHardwareOrder).tracking).toEqual({
      carrier: 'UPS',
      number: '1Z 999 AA1 01 2345 6784',
      url: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ context: POS_HARDWARE_EMAIL_KEYS.shipped })
    // Saying it again changes nothing and sends nothing.
    await staff('staff-super', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, status: 'shipped' },
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const delivered = await staff('staff-super', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, status: 'delivered' },
    })
    expect(delivered.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
    expect(mockSendEmail.mock.calls[1][0]).toMatchObject({ context: POS_HARDWARE_EMAIL_KEYS.delivered })
  })

  it('refunds in full before the order ships, once, under one key', async () => {
    seedOrder({ status: 'ordered' })
    const answer = await staff('staff-super', {
      method: 'POST',
      body: { action: 'cancel', orgId: 'org-1', orderId: ORDER_ID },
    })
    expect(answer.status).toBe(200)
    expect(stripeCalls.map((call) => [call.path, call.key, call.params.get('payment_intent')])).toEqual([
      ['refunds', `pos-hw-refund-${ORDER_ID}`, 'pi_test_1'],
    ])
    expect(stripeCalls[0].params.get('amount')).toBeNull()
    const order = fakeDocs.get(ORDER_PATH) as PosHardwareOrder & { refundRequestedAtMs?: number }
    expect(order).toMatchObject({ status: 'canceled', refundId: 're_1' })
    expect(order.refundRequestedAtMs).toBeUndefined()
    expect(answer.body.order.refundPending).toBe(false)
    // A second press finds it canceled and calls Stripe no more.
    await staff('staff-super', { method: 'POST', body: { action: 'cancel', orgId: 'org-1', orderId: ORDER_ID } })
    expect(stripeCalls).toHaveLength(1)
  })

  it.each(['shipped', 'delivered', 'registered'] as const)('refuses a refund once the order is %s', async (status) => {
    seedOrder({ status, tracking: { carrier: 'UPS', number: '1Z', url: null } })
    for (const action of ['cancel', 'refund']) {
      const answer = await staff('staff-super', { method: 'POST', body: { action, orgId: 'org-1', orderId: ORDER_ID } })
      expect(answer.status).toBe(409)
    }
    expect(stripeCalls).toHaveLength(0)
    expect((fakeDocs.get(ORDER_PATH) as PosHardwareOrder).status).toBe(status)
  })

  it('releases the claim when Stripe refuses the refund, so the order can still ship', async () => {
    seedOrder()
    refundOk = false
    const answer = await staff('staff-super', { method: 'POST', body: { action: 'refund', orgId: 'org-1', orderId: ORDER_ID } })
    expect(answer.status).toBe(502)
    const order = fakeDocs.get(ORDER_PATH) as PosHardwareOrder & { refundRequestedAtMs?: number }
    expect(order.status).toBe('paid')
    expect(order.refundRequestedAtMs).toBeUndefined()
  })

  it('blocks shipping while a refund is in progress', async () => {
    seedOrder({ status: 'ordered', ...({ refundRequestedAtMs: 5 } as object) })
    const answer = await staff('staff-super', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, status: 'shipped', tracking: { carrier: 'UPS', number: '1Z' } },
    })
    expect(answer.status).toBe(409)
  })
})

describe('the emails', () => {
  it('fills every token each hardware email declares', async () => {
    const order = {
      orgId: 'org-1',
      hostId: 'host-1',
      lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 13_000, lineCents: 13_000 }],
      shipping: { method: 'standard', label: 'Standard shipping', cents: 1_000, name: 'Jordan Lee', phone: null, address: { line1: '12 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' } },
      totalCents: 14_000,
      tracking: { carrier: 'ups', number: '1Z', url: 'https://www.ups.com/track?tracknum=1Z' },
    } as unknown as PosHardwareOrder
    const merge = await posHardwareEmailMerge(ORDER_ID, order, { site: 'Corner Cafe', org: 'Acme' })
    for (const template of posHardwareSystemEmailTemplates('https://console.example.com')) {
      for (const token of template.mergeTokens) {
        expect([template.key, token.name, merge[token.name] !== undefined]).toEqual([template.key, token.name, true])
      }
    }
    expect(merge['order.total']).toBe('$140.00')
    expect(merge['order.carrier']).toBe('UPS')
    expect(merge['order.shipTo']).toBe('Jordan Lee\n12 Main St\nSpringfield, IL 62701')
    expect(merge['order.setupUrl']).toBe('https://console.example.com/acme/hosts/host-1/products/pos#pos-devices')
  })
})

describe('the retained sale record (AGL-4038)', () => {
  const deliver = (object: Record<string, unknown>) =>
    posHardwareBillingWebhookHandler({
      type: 'checkout.session.completed',
      object,
      event: { type: 'checkout.session.completed', data: { object } },
    })
  const sale = () => fakeDocs.get(SALE_PATH) as PosHardwareSaleRecord | undefined

  it('is written with the order, with the amounts and the tax region and nothing about the buyer', async () => {
    await deliver(paidSession({ total_details: { amount_tax: 1_705 }, amount_total: 24_825 }))
    expect(sale()).toMatchObject({
      orderId: ORDER_ID,
      orgId: 'org-1',
      subtotalCents: 20_670,
      shippingMethod: 'standard',
      shippingCents: 1_000,
      taxCents: 1_705,
      totalCents: 24_825,
      currency: 'usd',
      shipTo: { country: 'US', state: 'IL', postalCode: '62701' },
      stripeCheckoutSessionId: 'cs_test_1',
      stripePaymentIntentId: 'pi_test_1',
      status: 'paid',
    })
    expect(sale()?.lines.map((line) => [line.sku, line.quantity, line.unitCents])).toEqual([
      ['stripe-reader-s710', 1, 13_000],
      ['stripe-reader-m2', 1, 7_670],
    ])
    expect(sale()?.paidAtMs).toEqual(expect.any(Number))
    expect(JSON.stringify(sale())).not.toMatch(PERSONAL)
    for (const field of ['hostId', 'createdBy', 'contactEmail', 'shipping', 'tracking']) {
      expect([field, field in (sale() ?? {})]).toEqual([field, false])
    }
  })

  it('is written once when Stripe redelivers, and not at all for an unreadable session', async () => {
    await deliver(paidSession())
    const first = JSON.stringify(sale())
    await deliver(paidSession())
    expect(JSON.stringify(sale())).toBe(first)
    expect([...fakeDocs.keys()].filter((key) => key.startsWith('posHardwareSales/'))).toHaveLength(1)
    resetFakeFirestore()
    await deliver(paidSession({ metadata: { ...paidSession().metadata, lines: 'nope*1*1' } }))
    expect([...fakeDocs.keys()].filter((key) => key.startsWith('posHardwareSales/'))).toHaveLength(0)
  })

  it('follows every staff step, tracking excluded, and the refund', async () => {
    await deliver(paidSession())
    await staff('staff-billing', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, stripeHardwareOrderId: 'thor_1', status: 'ordered' },
    })
    expect(sale()).toMatchObject({ status: 'ordered', stripeHardwareOrderId: 'thor_1', orderedAtMs: expect.any(Number) })
    await staff('staff-billing', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, tracking: { carrier: 'UPS', number: '1Z 999' } },
    })
    expect(JSON.stringify(sale())).not.toMatch(/\b1Z\b/)
    await staff('staff-super', { method: 'POST', body: { action: 'refund', orgId: 'org-1', orderId: ORDER_ID } })
    expect(sale()).toMatchObject({
      status: 'refunded',
      refundId: 're_1',
      refundedCents: 23_120,
      refundedAtMs: expect.any(Number),
      totalCents: 23_120,
    })
    // The record says what the order says, field by field.
    expect(sale()).toEqual(posHardwareSaleRecord(ORDER_ID, fakeDocs.get(ORDER_PATH) as PosHardwareOrder))
  })

  it('heals a missing record on the next staff write', async () => {
    await deliver(paidSession())
    fakeDocs.delete(SALE_PATH)
    await staff('staff-billing', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, status: 'ordered' },
    })
    expect(sale()).toMatchObject({ status: 'ordered', totalCents: 23_120 })
  })

  it('is never something a staff route refusal half-writes', async () => {
    await deliver(paidSession())
    const before = JSON.stringify(sale())
    const skipped = await staff('staff-billing', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, status: 'delivered' },
    })
    expect(skipped.status).toBe(409)
    expect(JSON.stringify(sale())).toBe(before)
  })
})

describe('an account erasure of the buyer (AGL-4038)', () => {
  const eraser = createPosHardwareUserEraser({ firestore: () => fakeFirestore, now: () => 9_999 })
  const deliver = (object: Record<string, unknown>) =>
    posHardwareBillingWebhookHandler({
      type: 'checkout.session.completed',
      object,
      event: { type: 'checkout.session.completed', data: { object } },
    })
  const OTHER_ORDER = 'hw_ffffffffffffffffffff'
  const OTHER_PATH = `orgs/org-1/hardwareOrders/${OTHER_ORDER}`

  beforeEach(async () => {
    await deliver(paidSession())
    // A colleague's order in the same workspace, which is not theirs to lose.
    await deliver(
      paidSession({
        id: 'cs_test_2',
        metadata: { ...paidSession().metadata, orderId: OTHER_ORDER, uid: 'colleague-1' },
        customer_details: { email: 'colleague@example.com', name: 'Sam Roe', phone: null },
      }),
    )
    await staff('staff-super', {
      method: 'POST',
      body: {
        action: 'update',
        orgId: 'org-1',
        orderId: ORDER_ID,
        status: 'ordered',
      },
    })
    await staff('staff-super', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, tracking: { carrier: 'UPS', number: '1Z 999' } },
    })
    // Shipped, so the closure cancels nothing and only the redaction is left.
    await staff('staff-super', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, status: 'shipped' },
    })
    stripeCalls.length = 0
    mockSendEmail.mockClear()
    mockRaiseAlert.mockClear()
  })

  const NOTHING_CANCELED = { hardwareOrdersCanceled: 0, hardwareOrdersPlacedWithStripe: 0, hardwareRefundsFailed: 0 }

  it('takes the buyer off the order and keeps every amount, the status dates and the tax region', async () => {
    const before = fakeDocs.get(ORDER_PATH) as PosHardwareOrder
    const report = await eraser({ uid: 'manager-1', orgIds: ['org-1'] })
    expect(report).toEqual({ hardwareOrdersRedacted: 1, formerWorkspacesReached: true, ...NOTHING_CANCELED })
    // A shipped order is never refunded by a closure.
    expect(stripeCalls).toHaveLength(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
    const after = fakeDocs.get(ORDER_PATH) as PosHardwareOrder
    expect(after).toMatchObject({
      createdBy: null,
      contactEmail: null,
      tracking: null,
      buyerErasedAtMs: 9_999,
      // A field the erasure did NOT write: the order is the same order.
      lines: before.lines,
      subtotalCents: before.subtotalCents,
      taxCents: before.taxCents,
      totalCents: before.totalCents,
      stripeCheckoutSessionId: 'cs_test_1',
      stripePaymentIntentId: 'pi_test_1',
      status: 'shipped',
      paidAtMs: before.paidAtMs,
      orderedAtMs: before.orderedAtMs,
      shippedAtMs: before.shippedAtMs,
      createdAtMs: before.createdAtMs,
    })
    expect(after.shipping).toEqual({
      method: 'standard',
      label: before.shipping.label,
      cents: 1_000,
      name: null,
      phone: null,
      address: null,
      taxRegion: { country: 'US', state: 'IL', postalCode: '62701' },
    })
    expect(JSON.stringify(after)).not.toMatch(PERSONAL)
    // The sale record still names the region, and still holds no one.
    const record = fakeDocs.get(SALE_PATH) as PosHardwareSaleRecord
    expect(record).toMatchObject({ shipTo: { country: 'US', state: 'IL', postalCode: '62701' }, status: 'shipped' })
    expect(JSON.stringify(record)).not.toMatch(PERSONAL)
  })

  it('leaves a colleague’s order alone', async () => {
    const before = JSON.stringify(fakeDocs.get(OTHER_PATH))
    await eraser({ uid: 'manager-1', orgIds: ['org-1'] })
    expect(JSON.stringify(fakeDocs.get(OTHER_PATH))).toBe(before)
    expect((fakeDocs.get(OTHER_PATH) as PosHardwareOrder).contactEmail).toBe('colleague@example.com')
  })

  it('reaches a workspace the person has left', async () => {
    const report = await eraser({ uid: 'manager-1', orgIds: [] })
    expect(report.hardwareOrdersRedacted).toBe(1)
  })

  it('does nothing the second time', async () => {
    await eraser({ uid: 'manager-1', orgIds: ['org-1'] })
    const once = JSON.stringify([...fakeDocs.entries()])
    const again = await eraser({ uid: 'manager-1', orgIds: ['org-1'] })
    expect(again).toEqual({ hardwareOrdersRedacted: 0, formerWorkspacesReached: true, ...NOTHING_CANCELED })
    expect(JSON.stringify([...fakeDocs.entries()])).toBe(once)
  })

  it('still works, and says it could not look further, where the collection-group index is not deployed', async () => {
    const refusing = {
      ...fakeFirestore,
      collectionGroup: () => ({
        where: () => ({
          get: async () => {
            throw Object.assign(new Error('FAILED_PRECONDITION: The query requires an index.'), { code: 9 })
          },
        }),
      }),
    }
    const fallback = createPosHardwareUserEraser({ firestore: () => refusing, now: () => 1 })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const report = await fallback({ uid: 'manager-1', orgIds: ['org-1'] })
      expect(report).toEqual({ hardwareOrdersRedacted: 1, formerWorkspacesReached: false, ...NOTHING_CANCELED })
    } finally {
      spy.mockRestore()
    }
    expect((fakeDocs.get(ORDER_PATH) as PosHardwareOrder).contactEmail).toBeNull()
  })

  it('a staff step after the erasure keeps the tax region on the record', async () => {
    await eraser({ uid: 'manager-1', orgIds: ['org-1'] })
    await staff('staff-super', {
      method: 'POST',
      body: { action: 'update', orgId: 'org-1', orderId: ORDER_ID, tracking: { carrier: 'UPS', number: '1Z 777' } },
    })
    expect((fakeDocs.get(SALE_PATH) as PosHardwareSaleRecord).shipTo).toEqual({
      country: 'US',
      state: 'IL',
      postalCode: '62701',
    })
  })

  it('has the collection-group index it asks for declared', () => {
    const indexes = JSON.parse(
      readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
    ) as { fieldOverrides: Array<{ collectionGroup: string; fieldPath: string; indexes: Array<{ queryScope: string }> }> }
    const override = indexes.fieldOverrides.find(
      (entry) => entry.collectionGroup === 'hardwareOrders' && entry.fieldPath === 'createdBy',
    )
    expect(override?.indexes.map((index) => index.queryScope)).toContain('COLLECTION_GROUP')
  })
})

describe('closing a workspace or the buying account with an unshipped order (AGL-4038)', () => {
  const orgEraser = createPosHardwareOrgEraser({ firestore: () => fakeFirestore })
  const userEraser = createPosHardwareUserEraser({ firestore: () => fakeFirestore, now: () => 9_999 })
  const deliver = (object: Record<string, unknown>) =>
    posHardwareBillingWebhookHandler({
      type: 'checkout.session.completed',
      object,
      event: { type: 'checkout.session.completed', data: { object } },
    })
  const refundPosts = () => stripeCalls.filter((call) => call.method === 'POST' && call.path === 'refunds')
  const alertsOf = (type: string) =>
    mockRaiseAlert.mock.calls.filter((call) => (call[0] as { type: string }).type === type)
  const audits = () => mockAudit.mock.calls.map((call) => call[1] as Record<string, any>)
  const order = () => fakeDocs.get(ORDER_PATH) as PosHardwareOrder & { refundRequestedAtMs?: number }
  const sale = () => fakeDocs.get(SALE_PATH) as PosHardwareSaleRecord

  /** Paid, and, for `ordered`, placed with Stripe by staff. */
  async function placeOrder(status: 'paid' | 'ordered' | 'shipped' | 'delivered' | 'registered') {
    await deliver(paidSession())
    const steps = ['ordered', 'shipped', 'delivered', 'registered']
    for (const step of steps.slice(0, steps.indexOf(status) + 1)) {
      await staff('staff-super', {
        method: 'POST',
        body: {
          action: 'update',
          orgId: 'org-1',
          orderId: ORDER_ID,
          status: step,
          ...(step === 'ordered' ? { stripeHardwareOrderId: 'thor_1' } : {}),
          ...(step === 'shipped' ? { tracking: { carrier: 'UPS', number: '1Z 999' } } : {}),
        },
      })
    }
    stripeCalls.length = 0
    mockSendEmail.mockClear()
    mockRaiseAlert.mockClear()
    mockAudit.mockClear()
  }

  it('deleting the workspace cancels and refunds a paid order in full, once, under the staff page’s key', async () => {
    await placeOrder('paid')
    const report = await orgEraser({ orgId: 'org-1', dryRun: false })
    expect(report).toEqual({ hardwareOrdersCanceled: 1, hardwareOrdersPlacedWithStripe: 0, hardwareRefundsFailed: 0 })
    expect(refundPosts().map((call) => [call.key, call.params.get('payment_intent'), call.params.get('amount')])).toEqual([
      [`pos-hw-refund-${ORDER_ID}`, 'pi_test_1', null],
    ])
    expect(order()).toMatchObject({
      status: 'canceled',
      refundId: 're_1',
      refundedCents: 23_120,
      cancelReason: 'workspace-closed',
      canceledAtMs: expect.any(Number),
    })
    expect(order().refundRequestedAtMs).toBeUndefined()
    // The retained record says so, and it is the one the workspace erasure leaves.
    expect(sale()).toMatchObject({ status: 'canceled', refundId: 're_1', refundedCents: 23_120, canceledAtMs: expect.any(Number) })
    expect(JSON.stringify(sale())).not.toMatch(PERSONAL)
    // The buyer is told; staff are not, because it was never placed with Stripe.
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      to: 'buyer@example.com',
      context: POS_HARDWARE_EMAIL_KEYS.canceled,
    })
    expect(alertsOf(COMMERCE_POS_HARDWARE_CANCELED_AFTER_ORDERING.type)).toHaveLength(0)
    expect(audits()).toEqual([
      expect.objectContaining({
        action: 'pos-hardware-order-cancel',
        actorUid: 'system:workspace-closed',
        actorEmail: null,
        before: { status: 'paid' },
        after: { status: 'canceled', refundId: 're_1', refundedCents: 23_120, reason: 'workspace-closed' },
      }),
    ])
  })

  it('alerts staff when the order was already placed with Stripe', async () => {
    await placeOrder('ordered')
    const report = await orgEraser({ orgId: 'org-1', dryRun: false })
    expect(report).toEqual({ hardwareOrdersCanceled: 1, hardwareOrdersPlacedWithStripe: 1, hardwareRefundsFailed: 0 })
    expect(order()).toMatchObject({ status: 'canceled', refundId: 're_1' })
    const [alert] = alertsOf(COMMERCE_POS_HARDWARE_CANCELED_AFTER_ORDERING.type)
    expect(COMMERCE_POS_HARDWARE_CANCELED_AFTER_ORDERING.tier).toBe('must')
    expect(alert[1]).toMatchObject({
      dedupeKey: ORDER_ID,
      orgId: 'org-1',
      context: {
        orderNumber: 'HW-012345',
        amount: expect.stringContaining('231.20'),
        items: '1 × Stripe Reader S710, 1 × Stripe Reader M2',
        reason: 'its workspace org-1 was deleted',
        stripeOrder: ' (Stripe order thor_1)',
      },
    })
    // Staff text names the order and the closure, never the buyer.
    expect(JSON.stringify(alert[1])).not.toMatch(PERSONAL)
  })

  it.each(['shipped', 'delivered', 'registered'] as const)('leaves an order that is %s alone', async (status) => {
    await placeOrder(status)
    const before = JSON.stringify(order())
    const report = await orgEraser({ orgId: 'org-1', dryRun: false })
    expect(report).toEqual({ hardwareOrdersCanceled: 0, hardwareOrdersPlacedWithStripe: 0, hardwareRefundsFailed: 0 })
    expect(JSON.stringify(order())).toBe(before)
    expect(stripeCalls).toHaveLength(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('a replay refunds nothing twice, emails nothing twice', async () => {
    await placeOrder('paid')
    await orgEraser({ orgId: 'org-1', dryRun: false })
    const settled = JSON.stringify(order())
    const again = await orgEraser({ orgId: 'org-1', dryRun: false })
    expect(again).toEqual({ hardwareOrdersCanceled: 0, hardwareOrdersPlacedWithStripe: 0, hardwareRefundsFailed: 0 })
    expect(refundPosts()).toHaveLength(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(order())).toBe(settled)
  })

  it('a run that died after Stripe refunded reads that refund back rather than making a second', async () => {
    await placeOrder('paid')
    // The earlier run's claim is still on the order, and Stripe already refunded.
    fakeDocs.set(ORDER_PATH, { ...order(), refundRequestedAtMs: 5 })
    refundAlready = { id: 're_earlier', amount: 23_120 }
    const report = await orgEraser({ orgId: 'org-1', dryRun: false })
    expect(report.hardwareOrdersCanceled).toBe(1)
    expect(order()).toMatchObject({ status: 'canceled', refundId: 're_earlier', refundedCents: 23_120 })
    expect(stripeCalls.map((call) => [call.method, call.path])).toEqual([
      ['POST', 'refunds'],
      ['GET', 'refunds'],
    ])
    expect(stripeCalls[1].params.get('payment_intent')).toBe('pi_test_1')
  })

  it('goes ahead when Stripe refuses, and asks staff to refund by hand', async () => {
    await placeOrder('ordered')
    refundOk = false
    const report = await orgEraser({ orgId: 'org-1', dryRun: false })
    expect(report).toEqual({ hardwareOrdersCanceled: 0, hardwareOrdersPlacedWithStripe: 0, hardwareRefundsFailed: 1 })
    // Released, never half-written: the order is as it was.
    expect(order()).toMatchObject({ status: 'ordered' })
    expect(order().refundRequestedAtMs).toBeUndefined()
    expect(mockSendEmail).not.toHaveBeenCalled()
    const [alert] = alertsOf(COMMERCE_POS_HARDWARE_REFUND_FAILED.type)
    expect(alert[1]).toMatchObject({
      dedupeKey: ORDER_ID,
      context: {
        paymentIntentId: 'pi_test_1',
        error: 'Charge already refunded',
        orderedNote: '. It had already been placed with Stripe as thor_1, so cancel it there too before it ships',
      },
    })
  })

  it('a plan counts what it would cancel and touches neither Stripe nor the order', async () => {
    await placeOrder('ordered')
    const before = JSON.stringify([...fakeDocs.entries()])
    const plan = await orgEraser({ orgId: 'org-1', dryRun: true })
    expect(plan).toEqual({ hardwareOrdersCanceled: 1, hardwareOrdersPlacedWithStripe: 1, hardwareRefundsFailed: 0 })
    expect(stripeCalls).toHaveLength(0)
    expect(JSON.stringify([...fakeDocs.entries()])).toBe(before)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('closing the buying account cancels and refunds their unshipped order, emails them, then takes them off it', async () => {
    await placeOrder('paid')
    const OTHER_ORDER = 'hw_ffffffffffffffffffff'
    await deliver(
      paidSession({
        id: 'cs_test_2',
        metadata: { ...paidSession().metadata, orderId: OTHER_ORDER, uid: 'colleague-1' },
        customer_details: { email: 'colleague@example.com', name: 'Sam Roe', phone: null },
      }),
    )
    mockSendEmail.mockClear()
    const report = await userEraser({ uid: 'manager-1', orgIds: ['org-1'] })
    expect(report).toEqual({
      hardwareOrdersRedacted: 1,
      formerWorkspacesReached: true,
      hardwareOrdersCanceled: 1,
      hardwareOrdersPlacedWithStripe: 0,
      hardwareRefundsFailed: 0,
    })
    // Emailed at the address on the order before it came off.
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ to: 'buyer@example.com', context: POS_HARDWARE_EMAIL_KEYS.canceled })
    expect(order()).toMatchObject({
      status: 'canceled',
      cancelReason: 'account-closed',
      refundId: 're_1',
      createdBy: null,
      contactEmail: null,
    })
    expect(sale()).toMatchObject({ status: 'canceled', refundedCents: 23_120 })
    expect(audits()[0]).toMatchObject({ actorUid: 'system:account-closed', after: { reason: 'account-closed' } })
    // A colleague's order in the same workspace is theirs, and stays paid.
    expect(fakeDocs.get(`orgs/org-1/hardwareOrders/${OTHER_ORDER}`)).toMatchObject({ status: 'paid' })
    expect(refundPosts()).toHaveLength(1)
  })

  it('the canceled email says why, what was refunded, and what happens next', async () => {
    await placeOrder('paid')
    await orgEraser({ orgId: 'org-1', dryRun: false })
    const merge = await posHardwareEmailMerge(ORDER_ID, order(), { site: 'Corner Cafe', org: 'Acme' })
    expect(merge['order.cancelReason']).toBe('the Acme workspace was deleted')
    expect(merge['order.refunded']).toBe('$231.20')
    const sent = mockSendEmail.mock.calls[0][0] as { subject: string; text: string }
    expect(sent.subject).toBe('Your card reader order HW-012345 was canceled and refunded')
    const template = posHardwareSystemEmailTemplates('https://console.example.com').find(
      (entry) => entry.key === POS_HARDWARE_EMAIL_KEYS.canceled,
    )
    const words = JSON.stringify(template?.defaultBody)
    for (const part of ['heading', 'details', 'subheading', 'button', '{{order.cancelReason}}', '{{order.refunded}}', '{{brand.supportUrl}}']) {
      expect([part, words.includes(part)]).toEqual([part, true])
    }
    const account = await posHardwareEmailMerge(ORDER_ID, { ...order(), cancelReason: 'account-closed' }, { site: 'Corner Cafe', org: 'Acme' })
    expect(account['order.cancelReason']).toBe('the account that placed it was closed')
  })
})
