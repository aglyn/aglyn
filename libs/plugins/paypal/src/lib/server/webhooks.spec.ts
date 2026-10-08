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
  type PluginPaymentCheckoutRef,
  type PluginPaymentEvent,
  type PluginPaymentSettlement,
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
import { capturePayPalCheckout, createPayPalCheckout, openPayPalOrder, payPalCheckoutRecordId, readCheckout } from './checkouts'
import { readPayPalConfig, type PayPalConfig } from './config'
import { setPayPalDbForTests } from './db'
import { setPayPalFetchForTests } from './paypal-api'
import { readSeller } from './sellers'
import { applyPayPalWebhook, captureIdOfRefund, verifyPayPalWebhook } from './webhooks'
import { webhookRoute } from './routes'

/**
 * PayPal's webhook (AGL-3630): nothing is read until PayPal vouches for the
 * delivery; each event is applied once; a capture the browser never
 * finished is finished here; refunds, reversals and disputes reach the
 * owner; the seller's account follows PayPal's word.
 */

let db: MemoryFirestore
let paypal: FakePayPal
let config: PayPalConfig
const settlements: PluginPaymentSettlement[] = []
const expired: PluginPaymentCheckoutRef[] = []
const events: PluginPaymentEvent[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  paymentProvider: () => ({ platformMode: () => 'test' }),
}))

const owner: PluginPaymentCheckoutOwner = {
  approve: async () => ({ ok: true }),
  settle: async (settlement) => {
    settlements.push(settlement)
  },
  expire: async (checkout) => {
    expired.push(checkout)
  },
  onPaymentEvent: async (event) => {
    events.push(event)
  },
}

const HEADERS = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270',
  'paypal-transmission-id': '69cd13f0-d67a-11e5-baa3-778b53f4ae55',
  'paypal-transmission-sig': 'lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==',
  'paypal-transmission-time': '2026-10-07T23:30:01Z',
}

const request = (event: unknown, headers: Record<string, string> = HEADERS) =>
  new Request('https://app.aglyn.com/api/paypal/webhook', { method: 'POST', headers, body: JSON.stringify(event) })

beforeEach(async () => {
  resetPluginServicesForTests()
  registerPluginPaymentCheckoutOwner('shop-cart', owner, { pluginId: 'shop' })
  setPayPalTestEnv()
  db = createMemoryFirestore()
  setPayPalDbForTests(db)
  paypal = createFakePayPal({ clientId: PAYPAL_TEST_ENV['PAYPAL_CLIENT_ID'], partnerMerchantId: PAYPAL_TEST_ENV['PAYPAL_PARTNER_MERCHANT_ID'] })
  setPayPalFetchForTests(paypal.fetch)
  const read = readPayPalConfig()
  if (!read.configured) throw new Error('env')
  config = read.config
  await seedReadySeller(db)
  settlements.length = 0
  expired.length = 0
  events.length = 0
})

afterEach(() => {
  setPayPalDbForTests(null)
  setPayPalFetchForTests(null)
  clearPayPalTestEnv()
})

const recordId = () => payPalCheckoutRecordId('shop-cart', testCheckoutRequest().checkoutId)

async function approvedOrder(): Promise<string> {
  await createPayPalCheckout(config, testCheckoutRequest())
  const orderId = await openPayPalOrder(config, recordId(), 'paypal')
  paypal.approve(orderId)
  return orderId
}

describe('verification', () => {
  it('asks PayPal with the five transmission headers and this deployment’s webhook id', async () => {
    const event = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }
    expect(await verifyPayPalWebhook(config, new Headers(HEADERS), event)).toBe(true)
    const [verify] = paypal.callsTo('POST', '/v1/notifications/verify-webhook-signature')
    expect(verify.body).toEqual({
      auth_algo: 'SHA256withRSA',
      cert_url: HEADERS['paypal-cert-url'],
      transmission_id: HEADERS['paypal-transmission-id'],
      transmission_sig: HEADERS['paypal-transmission-sig'],
      transmission_time: HEADERS['paypal-transmission-time'],
      webhook_id: PAYPAL_TEST_ENV['PAYPAL_WEBHOOK_ID'],
      webhook_event: event,
    })
  })

  it('refuses a missing header, a certificate off PayPal’s hosts and a FAILURE', async () => {
    const event = { id: 'WH-1', event_type: 'X', resource: {} }
    const partial = new Headers(HEADERS)
    partial.delete('paypal-transmission-sig')
    expect(await verifyPayPalWebhook(config, partial, event)).toBe(false)
    expect(await verifyPayPalWebhook(config, new Headers({ ...HEADERS, 'paypal-cert-url': 'https://paypal.com.evil.example/cert' }), event)).toBe(false)
    paypal.verifies = false
    expect(await verifyPayPalWebhook(config, new Headers(HEADERS), event)).toBe(false)
  })

  it('reads nothing of an unverified delivery', async () => {
    paypal.verifies = false
    const orderId = await approvedOrder()
    const response = await webhookRoute(request({ id: 'WH-2', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: orderId } }))
    expect(response.status).toBe(400)
    expect(paypal.callsTo('POST', `/v2/checkout/orders/${orderId}/capture`)).toHaveLength(0)
    expect(db.docs.has('paypalWebhookEvents/WH-2')).toBe(false)
  })
})

describe('applying events', () => {
  it('captures an approved order the buyer’s browser never returned from, once', async () => {
    const orderId = await approvedOrder()
    const event = { id: 'WH-APPROVED', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: orderId, status: 'APPROVED' } }
    const response = await webhookRoute(request(event))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ result: 'applied' })
    expect(settlements).toHaveLength(1)
    // PayPal redelivers: recognized, nothing moves.
    expect(await (await webhookRoute(request(event))).json()).toEqual({ result: 'duplicate' })
    expect(paypal.callsTo('POST', `/v2/checkout/orders/${orderId}/capture`)).toHaveLength(1)
    expect(settlements).toHaveLength(1)
  })

  it('tells the owner when a pending capture completes, with the payer and address the order holds', async () => {
    const orderId = await approvedOrder()
    paypal.nextCapture = 'PENDING'
    await capturePayPalCheckout(config, recordId(), orderId)
    expect(settlements).toHaveLength(0)
    paypal.orders.get(orderId)!.captures[0].status = 'COMPLETED'
    const captureId = paypal.orders.get(orderId)!.captures[0].id
    await applyPayPalWebhook(config, {
      id: 'WH-COMPLETED',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: captureId, status: 'COMPLETED', amount: { currency_code: 'USD', value: '56.97' }, supplementary_data: { related_ids: { order_id: orderId } } },
    })
    expect(settlements).toHaveLength(1)
    expect(settlements[0]).toMatchObject({ paymentId: captureId, payer: { email: 'buyer@example.com' }, shippingAddress: { postalCode: '95131' } })
  })

  it('hands back what a checkout held when PayPal denies its pending capture', async () => {
    const orderId = await approvedOrder()
    paypal.nextCapture = 'PENDING'
    await capturePayPalCheckout(config, recordId(), orderId)
    const captureId = paypal.orders.get(orderId)!.captures[0].id
    await applyPayPalWebhook(config, {
      id: 'WH-DENIED',
      event_type: 'PAYMENT.CAPTURE.DENIED',
      resource: { id: captureId, status: 'DECLINED', supplementary_data: { related_ids: { order_id: orderId } } },
    })
    expect(expired).toHaveLength(1)
    expect((await readCheckout(recordId()))?.status).toBe('declined')
  })

  it('tallies a refund made in PayPal and tells the owner the total', async () => {
    const orderId = await approvedOrder()
    await capturePayPalCheckout(config, recordId(), orderId)
    const captureId = String((await readCheckout(recordId()))?.captureId)
    await applyPayPalWebhook(config, {
      id: 'WH-REFUNDED',
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: {
        id: '1JU08902781691411',
        status: 'COMPLETED',
        amount: { currency_code: 'USD', value: '10.00' },
        links: [{ href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}`, rel: 'up', method: 'GET' }],
      },
    })
    expect(events).toEqual([
      expect.objectContaining({ kind: 'refunded', paymentId: captureId, refundedCents: 1_000, amountCents: 1_000, eventId: 'WH-REFUNDED', providerLabel: 'PayPal' }),
    ])
  })

  it('tells the owner of a dispute and of a reversal', async () => {
    const orderId = await approvedOrder()
    await capturePayPalCheckout(config, recordId(), orderId)
    const captureId = String((await readCheckout(recordId()))?.captureId)
    await applyPayPalWebhook(config, {
      id: 'WH-DISPUTE',
      event_type: 'CUSTOMER.DISPUTE.CREATED',
      resource: { dispute_id: 'PP-D-27803', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', dispute_amount: { currency_code: 'USD', value: '56.97' }, disputed_transactions: [{ seller_transaction_id: captureId }] },
    })
    await applyPayPalWebhook(config, {
      id: 'WH-REVERSED',
      event_type: 'PAYMENT.CAPTURE.REVERSED',
      resource: { id: '8MC585209K746392H', amount: { currency_code: 'USD', value: '56.97' }, links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }] },
    })
    expect(events.map((one) => [one.kind, one.amountCents])).toEqual([
      ['disputed', 5_697],
      ['reversed', 5_697],
    ])
    expect(events[0].detail).toBe('merchandise or service not received')
  })

  it('follows the seller’s account as PayPal reports it', async () => {
    await seedReadySeller(db, { status: 'onboarding', merchantId: undefined, trackingId: 'aglyn-org-candles-aaaaaaaaaaaa' })
    await applyPayPalWebhook(config, {
      id: 'WH-ONBOARDED',
      event_type: 'MERCHANT.ONBOARDING.COMPLETED',
      resource: { partner_client_id: PAYPAL_TEST_ENV['PAYPAL_CLIENT_ID'], tracking_id: 'aglyn-org-candles-aaaaaaaaaaaa', merchant_id: 'SELLER7RXQG3L' },
    })
    expect((await readSeller(TEST_ORG))?.status).toBe('ready')
    await applyPayPalWebhook(config, {
      id: 'WH-REVOKED',
      event_type: 'MERCHANT.PARTNER-CONSENT.REVOKED',
      resource: { merchant_id: 'SELLER7RXQG3L', tracking_id: 'aglyn-org-candles-aaaaaaaaaaaa' },
    })
    expect((await readSeller(TEST_ORG))?.status).toBe('revoked')
  })

  it('records an event it has nothing to do with, so a redelivery costs nothing', async () => {
    expect(await applyPayPalWebhook(config, { id: 'WH-OTHER', event_type: 'BILLING.PLAN.CREATED', resource: {} })).toBe('ignored')
    expect(await applyPayPalWebhook(config, { id: 'WH-OTHER', event_type: 'BILLING.PLAN.CREATED', resource: {} })).toBe('duplicate')
  })

  it('asks for a redelivery when an owner fails, recording nothing', async () => {
    const orderId = await approvedOrder()
    owner.settle = async () => {
      throw new Error('owner down')
    }
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    // The browser captures; the owner fails; the webhook is retried until it does not.
    await capturePayPalCheckout(config, recordId(), orderId)
    const captureId = String((await readCheckout(recordId()))?.captureId)
    const event = {
      id: 'WH-RETRY',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: captureId, supplementary_data: { related_ids: { order_id: orderId } } },
    }
    expect((await webhookRoute(request(event))).status).toBe(500)
    expect(db.docs.has('paypalWebhookEvents/WH-RETRY')).toBe(false)
    owner.settle = async (settlement) => {
      settlements.push(settlement)
    }
    expect((await webhookRoute(request(event))).status).toBe(200)
    expect(settlements).toHaveLength(1)
    expect((await readCheckout(recordId()))?.settledAtMs).toEqual(expect.any(Number))
  })

  it('reads the capture a refund points up to', () => {
    expect(captureIdOfRefund({ links: [{ rel: 'up', href: 'https://api-m.paypal.com/v2/payments/captures/2GG279541U471931P' }] })).toBe('2GG279541U471931P')
    expect(captureIdOfRefund({ links: [] })).toBe('')
  })
})
