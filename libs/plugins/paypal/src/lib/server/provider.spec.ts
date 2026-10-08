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
  TEST_HOST,
  TEST_ORG,
  TEST_SELLER,
  clearPayPalTestEnv,
  seedReadySeller,
  setPayPalTestEnv,
  testCheckoutRequest,
} from '../testing/paypal-env'
import { capturePayPalCheckout, createPayPalCheckout, openPayPalOrder, payPalCheckoutRecordId, readCheckout } from './checkouts'
import { readPayPalConfig } from './config'
import { setPayPalDbForTests } from './db'
import { setPayPalFetchForTests } from './paypal-api'
import { payPalProvider } from './provider'

/**
 * PayPal behind core's payment-provider seam (AGL-3630): offered only where
 * it can take the money — configured, the same world as the card account, a
 * plan that sells, a currency PayPal takes, a seller PayPal says is ready —
 * and refunding with the platform's fee returned in proportion.
 */

let db: MemoryFirestore
let paypal: FakePayPal
let cardMode: 'live' | 'test' | undefined = 'test'
let sells = true

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles' ? { orgId: 'org-candles', org: { name: 'Candles', plan: 'pro' } } : null,
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  paymentProvider: () => ({ platformMode: () => cardMode }),
}))
jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: () => sells,
}))

const owner: PluginPaymentCheckoutOwner = {
  approve: async () => ({ ok: true }),
  settle: async () => undefined,
  expire: async () => undefined,
}

const ASK = { orgId: TEST_ORG, hostId: TEST_HOST, currency: 'usd', channel: 'online' as const }

beforeEach(async () => {
  resetPluginServicesForTests()
  registerPluginPaymentCheckoutOwner('shop-cart', owner, { pluginId: 'shop' })
  setPayPalTestEnv()
  cardMode = 'test'
  sells = true
  db = createMemoryFirestore()
  setPayPalDbForTests(db)
  paypal = createFakePayPal({ clientId: PAYPAL_TEST_ENV['PAYPAL_CLIENT_ID'], partnerMerchantId: PAYPAL_TEST_ENV['PAYPAL_PARTNER_MERCHANT_ID'] })
  setPayPalFetchForTests(paypal.fetch)
  await seedReadySeller(db)
})

afterEach(() => {
  setPayPalDbForTests(null)
  setPayPalFetchForTests(null)
  clearPayPalTestEnv()
})

describe('whether PayPal is offered', () => {
  it('offers PayPal and Venmo for US dollars to a ready seller', async () => {
    expect(await payPalProvider.available(ASK)).toEqual({
      providerId: 'paypal',
      label: 'PayPal',
      methods: [
        { id: 'paypal', label: 'PayPal' },
        { id: 'venmo', label: 'Venmo' },
      ],
      livemode: false,
    })
    // A caller that has not resolved the workspace is answered too.
    expect(await payPalProvider.available({ ...ASK, orgId: '' })).not.toBeNull()
  })

  it('offers PayPal alone in another currency PayPal takes, and nothing in one it does not', async () => {
    expect((await payPalProvider.available({ ...ASK, currency: 'eur' }))?.methods.map((one) => one.id)).toEqual(['paypal'])
    expect(await payPalProvider.available({ ...ASK, currency: 'inr' })).toBeNull()
  })

  it.each([
    ['a variable is missing', () => delete process.env['PAYPAL_WEBHOOK_ID']],
    ['the environment is neither sandbox nor live', () => (process.env['PAYPAL_ENVIRONMENT'] = 'staging')],
    ['the card account is live and PayPal is sandbox', () => (cardMode = 'live')],
    ['the plan does not sell', () => (sells = false)],
  ])('offers nothing when %s', async (_label, arrange) => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    arrange()
    expect(await payPalProvider.available(ASK)).toBeNull()
    error.mockRestore()
  })

  it('reads nothing when the deployment is not configured', async () => {
    clearPayPalTestEnv()
    const reads = jest.spyOn(db, 'collection')
    expect(await payPalProvider.available(ASK)).toBeNull()
    expect(reads).not.toHaveBeenCalled()
  })

  it.each([
    ['still onboarding', { status: 'onboarding' }],
    ['waiting on the seller', { status: 'action-needed' }],
    ['disconnected', { status: 'disconnected' }],
    ['connected in the other environment', { environment: 'live' }],
  ])('offers nothing to a seller %s', async (_label, patch) => {
    await seedReadySeller(db, patch)
    expect(await payPalProvider.available(ASK)).toBeNull()
  })

  it('offers nothing for a site of another workspace', async () => {
    expect(await payPalProvider.available({ ...ASK, orgId: 'org-other' })).toBeNull()
  })
})

describe('refunds', () => {
  async function captured(): Promise<string> {
    const read = readPayPalConfig()
    if (!read.configured) throw new Error('env')
    await createPayPalCheckout(read.config, testCheckoutRequest())
    const recordId = payPalCheckoutRecordId('shop-cart', testCheckoutRequest().checkoutId)
    const orderId = await openPayPalOrder(read.config, recordId, 'paypal')
    paypal.approve(orderId)
    await capturePayPalCheckout(read.config, recordId, orderId)
    return String((await readCheckout(recordId))?.captureId)
  }

  const refund = (paymentId: string, amountCents: number, key: string) =>
    payPalProvider.refund({ orgId: TEST_ORG, hostId: TEST_HOST, paymentId, amountCents, currency: 'usd', idempotencyKey: key })

  it('refunds for the seller, returning the platform fee in proportion and the rest on the last refund', async () => {
    const captureId = await captured()
    // 5,697 captured with a 102 fee.
    expect(await refund(captureId, 2_000, 'r1')).toMatchObject({ ok: true, status: 'completed' })
    expect(await refund(captureId, 3_697, 'r2')).toMatchObject({ ok: true })
    const calls = paypal.callsTo('POST', `/v2/payments/captures/${captureId}/refund`)
    expect(calls.map((call) => call.body.amount.value)).toEqual(['20.00', '36.97'])
    expect(calls.map((call) => call.body.payment_instruction?.platform_fees?.[0]?.amount.value)).toEqual(['0.35', '0.67'])
    expect(calls[0].headers['paypal-request-id']).toBe('refund-r1')
    const assertion = calls[0].headers['paypal-auth-assertion'].split('.')[1]
    expect(JSON.parse(Buffer.from(assertion, 'base64url').toString()).payer_id).toBe(TEST_SELLER)
    const record = await readCheckout(payPalCheckoutRecordId('shop-cart', testCheckoutRequest().checkoutId))
    expect(record).toMatchObject({ refundedCents: 5_697, refundedFeeCents: 102 })
  })

  it('counts a retried refund once', async () => {
    const captureId = await captured()
    const first = await refund(captureId, 1_000, 'same')
    const again = await refund(captureId, 1_000, 'same')
    expect(again).toEqual(first)
    expect((await readCheckout(payPalCheckoutRecordId('shop-cart', testCheckoutRequest().checkoutId)))?.refundedCents).toBe(1_000)
  })

  it('refuses more than is left without asking PayPal', async () => {
    const captureId = await captured()
    await refund(captureId, 5_000, 'r1')
    expect(await refund(captureId, 700, 'r2')).toMatchObject({ ok: false, status: 409 })
    expect(paypal.callsTo('POST', `/v2/payments/captures/${captureId}/refund`)).toHaveLength(1)
  })

  it('refuses a payment of another site, and one it does not know', async () => {
    const captureId = await captured()
    expect(await payPalProvider.refund({ orgId: TEST_ORG, hostId: 'host-other', paymentId: captureId, amountCents: 100, currency: 'usd', idempotencyKey: 'k' })).toMatchObject({ ok: false, status: 404 })
    expect(await refund('NOT-A-CAPTURE', 100, 'k')).toMatchObject({ ok: false, status: 404 })
  })

  it('names what PayPal refused in words a merchant can act on', async () => {
    const captureId = await captured()
    setPayPalFetchForTests(async (url, init) =>
      url.includes('/refund')
        ? new Response(JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'PERMISSION_DENIED' }] }), { status: 403 })
        : paypal.fetch(url, init),
    )
    jest.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    const answer = await refund(captureId, 100, 'k')
    expect(answer).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/permission/i) })
  })
})
