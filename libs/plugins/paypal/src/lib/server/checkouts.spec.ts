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
  type PluginPaymentApproval,
  type PluginPaymentCheckoutOwner,
  type PluginPaymentCheckoutRef,
  type PluginPaymentSettlement,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { createFakePayPal, type FakePayPal } from '../testing/fake-paypal'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import {
  PAYPAL_TEST_ENV,
  seedReadySeller,
  setPayPalTestEnv,
  clearPayPalTestEnv,
  TEST_SELLER,
  testCheckoutRequest,
} from '../testing/paypal-env'
import {
  capturePayPalCheckout,
  changePayPalShipping,
  createPayPalCheckout,
  expireCheckout,
  openPayPalOrder,
  payPalCheckoutRecordId,
  readCheckout,
  sweepPayPalCheckouts,
  CAPTURE_CLAIM_MS,
} from './checkouts'
import { readPayPalConfig, type PayPalConfig } from './config'
import { setPayPalDbForTests } from './db'
import { setPayPalFetchForTests } from './paypal-api'

/**
 * One buyer's PayPal checkout end to end against a fake of PayPal's sandbox
 * API (AGL-3630): what is recorded, the order PayPal is asked to open, the
 * delivery option re-priced, the capture — once, whoever asks and however
 * often — the owner told once, and an abandoned checkout handed back.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
}))

jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  paymentProvider: () => ({ platformMode: () => 'test' }),
}))

let db: MemoryFirestore
let paypal: FakePayPal
let config: PayPalConfig
const approvals: PluginPaymentApproval[] = []
const settlements: PluginPaymentSettlement[] = []
const expired: PluginPaymentCheckoutRef[] = []
let refuseApproval: string | null = null

const owner: PluginPaymentCheckoutOwner = {
  approve: async (approval) => {
    approvals.push(approval)
    return refuseApproval ? { ok: false, reason: refuseApproval } : { ok: true }
  },
  settle: async (settlement) => {
    settlements.push(settlement)
  },
  expire: async (checkout) => {
    expired.push(checkout)
  },
}

beforeEach(async () => {
  resetPluginServicesForTests()
  registerPluginPaymentCheckoutOwner('shop-cart', owner, { pluginId: 'shop' })
  setPayPalTestEnv()
  db = createMemoryFirestore()
  setPayPalDbForTests(db)
  paypal = createFakePayPal({ clientId: PAYPAL_TEST_ENV['PAYPAL_CLIENT_ID'], partnerMerchantId: PAYPAL_TEST_ENV['PAYPAL_PARTNER_MERCHANT_ID'] })
  setPayPalFetchForTests(paypal.fetch)
  const read = readPayPalConfig()
  if (!read.configured) throw new Error('test env incomplete')
  config = read.config
  await seedReadySeller(db)
  approvals.length = 0
  settlements.length = 0
  expired.length = 0
  refuseApproval = null
})

afterEach(() => {
  setPayPalDbForTests(null)
  setPayPalFetchForTests(null)
  clearPayPalTestEnv()
})

const recordId = () => payPalCheckoutRecordId('shop-cart', testCheckoutRequest().checkoutId)

async function opened(source: 'paypal' | 'venmo' = 'paypal'): Promise<string> {
  await createPayPalCheckout(config, testCheckoutRequest())
  return openPayPalOrder(config, recordId(), source)
}

describe('recording a checkout', () => {
  it('records what the owner priced and sends the buyer to the pay page on the host they came from', async () => {
    const started = await createPayPalCheckout(config, testCheckoutRequest())
    expect(started).toEqual({
      providerId: 'paypal',
      providerCheckoutId: recordId(),
      redirectUrl: `https://candles.example/api/paypal/pay?c=${recordId()}`,
      livemode: false,
    })
    const record = await readCheckout(recordId())
    expect(record).toMatchObject({
      status: 'open',
      merchantId: TEST_SELLER,
      selectedShippingId: 'ground',
      settledAtMs: null,
      orderIds: [],
      platformFeeCents: 102,
    })
    // Nothing is asked of PayPal until the buyer presses a button.
    expect(paypal.calls).toEqual([])
  })

  it('answers a retried attempt with the same checkout, writing nothing new', async () => {
    const first = await createPayPalCheckout(config, testCheckoutRequest())
    const second = await createPayPalCheckout(config, testCheckoutRequest())
    expect(second).toEqual(first)
    expect([...db.docs.keys()].filter((key) => key.startsWith('paypalCheckouts/'))).toHaveLength(1)
  })

  it.each([
    ['a fee above the charge', { platformFeeCents: 999_999 }, 400],
    ['fractional cents', { taxCents: 4.5 }, 400],
    ['a currency PayPal does not take', { currency: 'inr' }, 409],
  ])('refuses %s before anything is written', async (_label, patch, status) => {
    await expect(createPayPalCheckout(config, testCheckoutRequest(patch as never))).rejects.toMatchObject({ status })
    expect([...db.docs.keys()].some((key) => key.startsWith('paypalCheckouts/'))).toBe(false)
  })

  it('refuses a workspace whose seller is not ready', async () => {
    await seedReadySeller(db, { status: 'action-needed' })
    await expect(createPayPalCheckout(config, testCheckoutRequest())).rejects.toMatchObject({ status: 409 })
  })
})

describe('opening the PayPal order', () => {
  it('asks PayPal for the priced total, paid to the seller, with the platform fee and every line', async () => {
    const orderId = await opened()
    const [create] = paypal.callsTo('POST', '/v2/checkout/orders')
    expect(create.headers['paypal-request-id']).toMatch(new RegExp(`^${recordId()}-paypal-`))
    expect(create.headers['paypal-partner-attribution-id']).toBe('Aglyn_SP_PPCP')
    const unit = create.body.purchase_units[0]
    expect(unit.amount).toEqual({
      currency_code: 'USD',
      value: '56.97',
      breakdown: {
        item_total: { currency_code: 'USD', value: '51.00' },
        shipping: { currency_code: 'USD', value: '6.95' },
        tax_total: { currency_code: 'USD', value: '4.12' },
        discount: { currency_code: 'USD', value: '5.10' },
      },
    })
    expect(unit.payee).toEqual({ merchant_id: TEST_SELLER })
    expect(unit.payment_instruction).toEqual({
      disbursement_mode: 'INSTANT',
      platform_fees: [{ amount: { currency_code: 'USD', value: '1.02' } }],
    })
    expect(unit.items).toEqual([
      { name: 'Fig candle', quantity: '2', unit_amount: { currency_code: 'USD', value: '24.00' }, sku: 'FIG-8OZ', category: 'PHYSICAL_GOODS' },
      { name: 'Gift note', quantity: '1', unit_amount: { currency_code: 'USD', value: '3.00' }, category: 'DIGITAL_GOODS' },
    ])
    expect(unit.shipping.options.map((option: any) => [option.id, option.selected, option.amount.value])).toEqual([
      ['ground', true, '6.95'],
      ['express', false, '19.95'],
    ])
    expect(create.body.payment_source.paypal.experience_context).toMatchObject({
      brand_name: 'Candle & Co',
      shipping_preference: 'GET_FROM_FILE',
      user_action: 'PAY_NOW',
    })
    expect((await readCheckout(recordId()))?.orderIds).toEqual([orderId])
  })

  it('opens one order however often the button is pressed', async () => {
    const first = await opened()
    const again = await openPayPalOrder(config, recordId(), 'paypal')
    expect(again).toBe(first)
    expect(paypal.callsTo('POST', '/v2/checkout/orders')).toHaveLength(1)
  })

  it('opens Venmo as its own funding source, in US dollars only', async () => {
    const venmo = await opened('venmo')
    const [create] = paypal.callsTo('POST', '/v2/checkout/orders')
    expect(Object.keys(create.body.payment_source)).toEqual(['venmo'])
    expect((await readCheckout(recordId()))?.orders.venmo?.id).toBe(venmo)
    await createPayPalCheckout(config, testCheckoutRequest({ checkoutId: 'pay_paypal_ffffffffffffffffffffffffffffffff', currency: 'eur' }))
    await expect(
      openPayPalOrder(config, payPalCheckoutRecordId('shop-cart', 'pay_paypal_ffffffffffffffffffffffffffffffff'), 'venmo'),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('posts nothing for a cart with nothing to deliver', async () => {
    await createPayPalCheckout(config, testCheckoutRequest({ shipping: undefined, lines: [{ name: 'E-book', quantity: 1, unitCents: 1_500, ships: false }], discountCents: 0, taxCents: 0 }))
    await openPayPalOrder(config, recordId(), 'paypal')
    const [create] = paypal.callsTo('POST', '/v2/checkout/orders')
    expect(create.body.purchase_units[0].shipping).toBeUndefined()
    expect(create.body.payment_source.paypal.experience_context.shipping_preference).toBe('NO_SHIPPING')
  })
})

describe('the delivery option chosen in PayPal', () => {
  it('re-prices the order to it', async () => {
    const orderId = await opened()
    await changePayPalShipping(config, recordId(), orderId, 'express')
    const [patch] = paypal.callsTo('PATCH', `/v2/checkout/orders/${orderId}`)
    expect(patch.body[0].value.value).toBe('69.97')
    expect((await readCheckout(recordId()))?.selectedShippingId).toBe('express')
  })

  it('refuses an option the store did not offer, and an order that is not this checkout’s', async () => {
    const orderId = await opened()
    await expect(changePayPalShipping(config, recordId(), orderId, 'teleport')).rejects.toMatchObject({ status: 400 })
    await expect(changePayPalShipping(config, recordId(), 'SOMEONE-ELSES', 'ground')).rejects.toMatchObject({ status: 404 })
  })
})

describe('capturing', () => {
  it('asks the owner, captures, and tells the owner once — however many times it is asked', async () => {
    const orderId = await opened()
    paypal.approve(orderId, { optionId: 'express', postalCode: '95131' })
    const first = await capturePayPalCheckout(config, recordId(), orderId)
    expect(first).toEqual({ kind: 'captured', redirectUrl: testCheckoutRequest().returnUrl })
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({
      totalCents: 6_997,
      shippingOptionId: 'express',
      shippingAddress: { country: 'US', postalCode: '95131', city: 'San Jose' },
      payer: { email: 'buyer@example.com', name: 'Ada Buyer' },
      metadata: { cartId: 'cart-1' },
    })
    expect(settlements).toHaveLength(1)
    expect(settlements[0]).toMatchObject({
      checkoutId: testCheckoutRequest().checkoutId,
      amountCents: 6_997,
      breakdown: { itemsCents: 5_100, discountCents: 510, taxCents: 412, shippingCents: 1_995, totalCents: 6_997 },
      platformFeeCents: 102,
      livemode: false,
    })
    // The webhook's turn, and the buyer's double click: no second capture.
    const again = await capturePayPalCheckout(config, recordId(), orderId)
    expect(again.kind).toBe('captured')
    expect(paypal.callsTo('POST', `/v2/checkout/orders/${orderId}/capture`)).toHaveLength(1)
    expect(settlements).toHaveLength(1)
    expect(await readCheckout(recordId())).toMatchObject({ status: 'captured', capturedCents: 6_997 })
  })

  it('captures once when two callers arrive together', async () => {
    const orderId = await opened()
    paypal.approve(orderId)
    const outcomes = await Promise.all([
      capturePayPalCheckout(config, recordId(), orderId),
      capturePayPalCheckout(config, recordId(), orderId),
    ])
    expect(outcomes.map((one) => one.kind).sort()).toEqual(['captured', 'pending'])
    expect(paypal.callsTo('POST', `/v2/checkout/orders/${orderId}/capture`)).toHaveLength(1)
    expect(settlements).toHaveLength(1)
  })

  it('moves no money when the owner refuses what the buyer chose', async () => {
    refuseApproval = 'Your delivery price was quoted for postal code 10001.'
    const orderId = await opened()
    paypal.approve(orderId)
    expect(await capturePayPalCheckout(config, recordId(), orderId)).toEqual({
      kind: 'refused',
      status: 409,
      message: 'Your delivery price was quoted for postal code 10001.',
    })
    expect(paypal.callsTo('POST', `/v2/checkout/orders/${orderId}/capture`)).toHaveLength(0)
    expect((await readCheckout(recordId()))?.status).toBe('open')
  })

  it('moves no money when the order no longer says what was priced', async () => {
    const orderId = await opened()
    paypal.approve(orderId)
    paypal.orders.get(orderId)!.body.purchase_units[0].amount.value = '0.01'
    jest.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    expect((await capturePayPalCheckout(config, recordId(), orderId)).kind).toBe('refused')
    expect(paypal.callsTo('POST', `/v2/checkout/orders/${orderId}/capture`)).toHaveLength(0)
  })

  it('refuses an address outside the countries the store delivers to, and lets the buyer pick again', async () => {
    const orderId = await opened()
    paypal.approve(orderId, { country: 'FR' })
    expect((await capturePayPalCheckout(config, recordId(), orderId)).kind).toBe('restart')
    expect(paypal.callsTo('POST', `/v2/checkout/orders/${orderId}/capture`)).toHaveLength(0)
  })

  it('asks the buyer for another way to pay when PayPal declines, and captures it then', async () => {
    const orderId = await opened()
    paypal.approve(orderId)
    paypal.nextCapture = 'INSTRUMENT_DECLINED'
    expect((await capturePayPalCheckout(config, recordId(), orderId)).kind).toBe('restart')
    expect((await readCheckout(recordId()))?.status).toBe('open')
    // PayPal answers the same request id with the same refusal, so a fresh
    // approval is captured under a fresh order, as the buttons restart one.
    paypal.orders.get(orderId)!.status = 'APPROVED'
    const outcome = await capturePayPalCheckout(config, recordId(), orderId)
    expect(outcome.kind).toBe('restart')
    expect(settlements).toHaveLength(0)
  })

  it('holds a pending capture without telling the owner it is paid', async () => {
    const orderId = await opened()
    paypal.approve(orderId)
    paypal.nextCapture = 'PENDING'
    expect((await capturePayPalCheckout(config, recordId(), orderId)).kind).toBe('pending')
    expect(settlements).toHaveLength(0)
    expect((await readCheckout(recordId()))?.status).toBe('pending')
  })

  it('finishes from the order when the capture answer was lost', async () => {
    const orderId = await opened()
    paypal.approve(orderId)
    paypal.nextCapture = 'NETWORK'
    await expect(capturePayPalCheckout(config, recordId(), orderId)).rejects.toThrow('fetch failed')
    // PayPal captured before the line dropped? Here it did not; the claim is
    // held. The sweep, once the claim is stale, reads the order and frees it.
    expect((await readCheckout(recordId()))?.status).toBe('capturing')
    const report = await sweepPayPalCheckouts(config, { nowMs: Date.now() + CAPTURE_CLAIM_MS + 1, deadlineMs: Date.now() + 60_000 })
    expect(report.recovered).toBe(0)
    expect((await readCheckout(recordId()))?.status).toBe('open')
    expect((await capturePayPalCheckout(config, recordId(), orderId)).kind).toBe('captured')
    expect(settlements).toHaveLength(1)
  })
})

describe('an abandoned checkout', () => {
  it('is handed back once, and can no longer be paid', async () => {
    const orderId = await opened()
    paypal.approve(orderId)
    const later = Date.now() + 32 * 60 * 1000
    const report = await sweepPayPalCheckouts(config, { nowMs: later, deadlineMs: Date.now() + 60_000 })
    expect(report.expired).toBe(1)
    expect(expired.map((one) => one.checkoutId)).toEqual([testCheckoutRequest().checkoutId])
    expect(await expireCheckout(recordId(), later)).toBe(false)
    expect(expired).toHaveLength(1)
    expect(await capturePayPalCheckout(config, recordId(), orderId, later)).toMatchObject({ kind: 'refused', status: 409 })
    expect(paypal.callsTo('POST', `/v2/checkout/orders/${orderId}/capture`)).toHaveLength(0)
  })

  it('is refused at capture once its time is up, and handed back then', async () => {
    const orderId = await opened()
    paypal.approve(orderId)
    const outcome = await capturePayPalCheckout(config, recordId(), orderId, Date.now() + 40 * 60 * 1000)
    expect(outcome).toMatchObject({ kind: 'refused', message: expect.stringMatching(/expired/) })
    expect(expired).toHaveLength(1)
  })
})
