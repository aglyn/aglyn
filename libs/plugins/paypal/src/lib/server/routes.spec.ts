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
  registerPluginPaymentCheckoutOwner,
  type PluginPaymentCheckoutOwner,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { createFakePayPal, type FakePayPal } from '../testing/fake-paypal'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import {
  PAYPAL_TEST_ENV,
  TEST_ORG,
  clearPayPalTestEnv,
  seedReadySeller,
  setPayPalTestEnv,
  testCheckoutRequest,
} from '../testing/paypal-env'
import { createPayPalCheckout, payPalCheckoutRecordId, readCheckout } from './checkouts'
import { readPayPalConfig } from './config'
import { setPayPalDbForTests } from './db'
import { setPayPalFetchForTests } from './paypal-api'
import {
  payAddressRoute,
  payCaptureRoute,
  payOrderRoute,
  payRoute,
  payShippingRoute,
  sellerDisconnectRoute,
  sellerOnboardRoute,
  sellerRefreshRoute,
  sellerRoute,
} from './routes'

/**
 * PayPal's routes (AGL-3630): the owner's seller routes, hidden (404) until
 * the deployment is configured and refused to anyone but a member — the
 * connecting ones to anyone but the owner; and the buyer's pay page and its
 * calls, which act only on the checkout their link names.
 */

let db: MemoryFirestore
let paypal: FakePayPal
let members: Record<string, boolean>
let staffToken = false

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => db,
      auth: () => ({
        verifyIdToken: async (token: string) => {
          if (token === 'bad') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' })
          return { uid: token, email_verified: true, ...(staffToken ? { staff: true } : {}) }
        },
      }),
    }),
  },
  resolveOrgMembership: async (uid: string, orgId: string) =>
    members[uid] ? { orgId, member: { $id: uid } } : null,
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: () => true,
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  isRefusedIdToken: (error: { code?: string }) => error?.code === 'auth/argument-error',
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  paymentProvider: () => ({ platformMode: () => 'test' }),
}))
jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: () => true,
}))

const owner: PluginPaymentCheckoutOwner = {
  approve: async () => ({ ok: true }),
  settle: async () => undefined,
  expire: async () => undefined,
}

const CONSOLE = 'https://app.aglyn.com'

function consoleRequest(route: string, token: string | null, body?: unknown): Request {
  return new Request(`${CONSOLE}/api/${route}?orgId=${TEST_ORG}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const recordId = () => payPalCheckoutRecordId('shop-cart', testCheckoutRequest().checkoutId)

function buyerRequest(route: string, body?: unknown, id = recordId()): Request {
  return new Request(`https://candles.example/api/${route}?c=${id}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(async () => {
  resetPluginServicesForTests()
  registerPluginPaymentCheckoutOwner('shop-cart', owner, { pluginId: 'shop' })
  setPayPalTestEnv()
  db = createMemoryFirestore()
  setPayPalDbForTests(db)
  paypal = createFakePayPal({ clientId: PAYPAL_TEST_ENV['PAYPAL_CLIENT_ID'], partnerMerchantId: PAYPAL_TEST_ENV['PAYPAL_PARTNER_MERCHANT_ID'] })
  setPayPalFetchForTests(paypal.fetch)
  members = { 'owner-1': true, 'editor-1': true }
  staffToken = false
  await db.collection('orgs').doc(TEST_ORG).set({ ownerUid: 'owner-1', plan: 'pro' })
})

afterEach(() => {
  setPayPalDbForTests(null)
  setPayPalFetchForTests(null)
  clearPayPalTestEnv()
})

describe('the seller routes', () => {
  it('are hidden while the deployment is not configured', async () => {
    clearPayPalTestEnv()
    expect((await sellerRoute(consoleRequest('paypal/seller', 'owner-1'))).status).toBe(404)
    expect((await sellerOnboardRoute(consoleRequest('paypal/seller/onboard', 'owner-1', {}))).status).toBe(404)
  })

  it('refuse a request with no token, a bad one, and someone outside the workspace', async () => {
    expect((await sellerRoute(consoleRequest('paypal/seller', null))).status).toBe(401)
    expect((await sellerRoute(consoleRequest('paypal/seller', 'bad'))).status).toBe(401)
    expect((await sellerRoute(consoleRequest('paypal/seller', 'stranger'))).status).toBe(403)
  })

  it('show any member the account, and say who may manage it', async () => {
    const response = await sellerRoute(consoleRequest('paypal/seller', 'editor-1'))
    expect(await response.json()).toEqual({
      offered: true,
      seller: { status: 'not-connected', merchantId: null, actions: [], livemode: false },
      canManage: false,
    })
  })

  it('let only the owner connect, back to a page on this console', async () => {
    expect((await sellerOnboardRoute(consoleRequest('paypal/seller/onboard', 'editor-1', { returnUrl: `${CONSOLE}/x` }))).status).toBe(403)
    expect((await sellerOnboardRoute(consoleRequest('paypal/seller/onboard', 'owner-1', { returnUrl: 'https://evil.example/x' }))).status).toBe(400)
    const response = await sellerOnboardRoute(consoleRequest('paypal/seller/onboard', 'owner-1', { returnUrl: `${CONSOLE}/acme/settings` }))
    expect(await response.json()).toEqual({ actionUrl: expect.stringMatching(/^https:\/\/www\.sandbox\.paypal\.com\//) })
    const [referral] = paypal.callsTo('POST', '/v2/customer/partner-referrals')
    expect(referral.body.partner_config_override.return_url).toBe(`${CONSOLE}/acme/settings?paypal=returned`)
  })

  it('re-read the account for any member, and let only the owner disconnect', async () => {
    await sellerOnboardRoute(consoleRequest('paypal/seller/onboard', 'owner-1', { returnUrl: `${CONSOLE}/acme/settings` }))
    const refreshed = await (await sellerRefreshRoute(consoleRequest('paypal/seller/refresh', 'editor-1', {}))).json()
    expect(refreshed.seller.status).toBe('ready')
    expect((await sellerDisconnectRoute(consoleRequest('paypal/seller/disconnect', 'editor-1', {}))).status).toBe(403)
    const disconnected = await (await sellerDisconnectRoute(consoleRequest('paypal/seller/disconnect', 'owner-1', {}))).json()
    expect(disconnected.seller.status).toBe('not-connected')
  })
})

describe('the buyer’s pay page', () => {
  beforeEach(async () => {
    await seedReadySeller(db)
    const read = readPayPalConfig()
    if (!read.configured) throw new Error('env')
    await createPayPalCheckout(read.config, testCheckoutRequest({ merchantName: 'Candle <&> Co' }))
  })

  it('serves PayPal’s buttons for this seller under a strict policy of its own', async () => {
    const response = await payRoute(buyerRequest('paypal/pay'))
    expect(response.status).toBe(200)
    const policy = String(response.headers.get('content-security-policy'))
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1]
    expect(nonce).toBeTruthy()
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(response.headers.get('cache-control')).toBe('no-store')
    const html = await response.text()
    expect(html).toContain(`<script nonce="${nonce}" src="https://www.paypal.com/sdk/js?client-id=${PAYPAL_TEST_ENV['PAYPAL_CLIENT_ID']}&amp;merchant-id=SELLER7RXQG3L&amp;currency=USD`)
    expect(html).toContain('data-partner-attribution-id="Aglyn_SP_PPCP"')
    expect(html).toContain('enable-funding=venmo')
    expect(html).toContain('Pay Candle &lt;&amp;&gt; Co')
    expect(html).not.toContain('Candle <&> Co')
    expect(html).toContain('$56.97')
    // No inline script without the nonce.
    expect(html.match(/<script(?![^>]*nonce=)/g)).toBeNull()
  })

  it('says a link is not valid, and an expired checkout cannot be paid', async () => {
    expect(await (await payRoute(buyerRequest('paypal/pay', undefined, 'ppc_nope'))).text()).toContain('not valid')
    await db.collection('paypalCheckouts').doc(recordId()).set({ expiresAtMs: 1 }, { merge: true })
    const html = await (await payRoute(buyerRequest('paypal/pay'))).text()
    expect(html).toContain('expired before it was paid')
    expect(html).not.toContain('sdk/js')
  })

  it('opens the order, re-prices the delivery option, checks the country and captures', async () => {
    const { orderId } = await (await payOrderRoute(buyerRequest('paypal/pay/order', { source: 'paypal' }))).json()
    expect(orderId).toMatch(/^5O19/)
    const shipping = await payShippingRoute(buyerRequest('paypal/pay/shipping', { orderId, optionId: 'express' }))
    expect(await shipping.json()).toEqual({ ok: true, total: '$69.97' })
    expect(await (await payAddressRoute(buyerRequest('paypal/pay/address', { country: 'CA' }))).json()).toEqual({ delivers: true })
    expect(await (await payAddressRoute(buyerRequest('paypal/pay/address', { country: 'FR' }))).json()).toEqual({ delivers: false })
    paypal.approve(orderId, { optionId: 'express' })
    const capture = await payCaptureRoute(buyerRequest('paypal/pay/capture', { orderId }))
    expect(await capture.json()).toEqual({ redirectUrl: testCheckoutRequest().returnUrl })
    expect((await readCheckout(recordId()))?.status).toBe('captured')
  })

  it('answers a declined payment with a restart and an unapproved one with a refusal', async () => {
    const { orderId } = await (await payOrderRoute(buyerRequest('paypal/pay/order', { source: 'paypal' }))).json()
    expect((await payCaptureRoute(buyerRequest('paypal/pay/capture', { orderId }))).status).toBe(409)
    paypal.approve(orderId)
    paypal.nextCapture = 'INSTRUMENT_DECLINED'
    const declined = await payCaptureRoute(buyerRequest('paypal/pay/capture', { orderId }))
    expect(declined.status).toBe(409)
    expect(await declined.json()).toMatchObject({ restart: true })
  })

  it('refuses an order id that is not this checkout’s', async () => {
    expect((await payCaptureRoute(buyerRequest('paypal/pay/capture', { orderId: 'SOMEONE-ELSES' }))).status).toBe(404)
  })
})
