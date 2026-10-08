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

/**
 * Every money path of a split-tender register sale (AGL-3607): the sum of the
 * tenders, the take that excludes the tip, idempotent retries, a reader from
 * another store refused, a webhook replay that does nothing, stock taken
 * once, the gift card that cannot be spent twice, and a void that hands
 * everything back. Stripe is a fake keyed by idempotency key, as Stripe is.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'
import { registerPluginSmsMessaging } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { posCardProcessingCostCents } from './pos-stripe'

const mockDecrement = jest.fn(async (options: any) => ({
  before: { variants: [] },
  after: { variants: [] },
  options,
}))
const mockContacts: any[] = []
const mockSaleCompleted: any[] = []

const mockNotified: any[] = []
const mockResent: any[] = []
const mockReceiptDoor: { next: any; resend: any } = { next: null, resend: null }
const mockRaised: any[] = []
jest.mock('./order-notifications', () => ({
  notifyOrderBuyer: async (ref: any, event: string, options: any) => {
    mockNotified.push({ ref, event, options })
    if (mockReceiptDoor.next) {
      const next = mockReceiptDoor.next
      mockReceiptDoor.next = null
      return next
    }
    return {
      outcome: 'handled',
      channels: [{ channel: options?.email ? 'email' : 'sms', outcome: 'sent' }],
    }
  },
  sendOrderReceipt: async (ref: any, input: any) => {
    mockResent.push({ ref, channel: input.channel, to: input.to })
    if (mockReceiptDoor.resend) {
      const resend = mockReceiptDoor.resend
      mockReceiptDoor.resend = null
      return resend
    }
    return { outcome: 'sent', channel: input.channel }
  },
}))
jest.mock('./order-events', () => ({
  raiseOrderEvent: async (_event: unknown, payload: any) => {
    mockRaised.push(payload)
  },
}))
jest.mock('./reserve-stock', () => ({
  decrementVariantStock: (options: any) => mockDecrement(options),
}))
jest.mock('./low-stock', () => ({ alertLowStockCrossing: () => undefined }))
jest.mock('@aglyn/aglyn/plugin-manager/record-captured-contact', () => ({
  __esModule: true,
  default: async (request: any) => {
    mockContacts.push(request)
  },
}))
jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: true } }),
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  merchantAccountIsReady: () => true,
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => ({ uid: token === 'other' ? 'stranger' : 'cashier-1' }),
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    consumeRateLimit: async () => ({ allowed: true }),
    getOrgForHost: async () => ({
      orgId: 'org-1',
      org: { id: 'org-1', plan: 'business', subscriptionStatus: 'active', ownerUid: 'owner-1', slug: 'acme' },
    }),
    getPluginConfig: async () => ({ posTippingEnabled: true, posTipPercentages: '15,20,25' }),
    meterHostEmail: async () => undefined,
    renderHostEmailWithTokens: async () => null,
    hostSendingIdentity: async () => null,
  }
})

import { posPaymentHandler } from './pos-payment'
import { handlePosStripeEvent } from './pos-terminal'
import { onPosSaleCompleted } from './pos-sale'

/*==========================================
 * A fake Stripe.
 *=========================================*/

interface StripeCall {
  method: string
  path: string
  key: string | null
  params: URLSearchParams
}
const stripeCalls: StripeCall[] = []
const intents = new Map<string, any>()
const replays = new Map<string, any>()
let intentCounter = 0

function stripeAnswer(method: string, path: string, params: URLSearchParams): any {
  if (method === 'POST' && path === 'payment_intents') {
    const id = `pi_test_${++intentCounter}`
    const intent = {
      id,
      object: 'payment_intent',
      amount: Number(params.get('amount')),
      application_fee_amount: Number(params.get('application_fee_amount') ?? 0),
      capture_method: params.get('capture_method') ?? 'automatic',
      status: 'requires_payment_method',
      client_secret: `${id}_secret`,
      livemode: false,
      metadata: Object.fromEntries(
        [...params.entries()]
          .filter(([key]) => key.startsWith('metadata['))
          .map(([key, value]) => [key.slice(9, -1), value]),
      ),
    }
    intents.set(id, intent)
    return intent
  }
  const capture = /^payment_intents\/(pi_test_\d+)\/capture$/.exec(path)
  if (method === 'POST' && capture) {
    const intent = intents.get(capture[1])
    intent.status = 'succeeded'
    intent.application_fee_amount = Number(params.get('application_fee_amount') ?? 0)
    intent.latest_charge = { payment_method_details: { card_present: { brand: 'visa', last4: '4242' } } }
    return intent
  }
  const cancel = /^payment_intents\/(pi_test_\d+)\/cancel$/.exec(path)
  if (method === 'POST' && cancel) {
    const intent = intents.get(cancel[1])
    intent.status = 'canceled'
    return intent
  }
  const get = /^payment_intents\/(pi_test_\d+)$/.exec(path)
  if (method === 'GET' && get) return intents.get(get[1])
  if (method === 'POST' && /^terminal\/readers\/tmr_\w+\/process_payment_intent$/.test(path)) {
    return { id: path.split('/')[2], action: { status: 'in_progress' } }
  }
  if (method === 'GET' && /^terminal\/readers\/tmr_\w+$/.test(path)) {
    return { id: path.split('/')[2], status: 'online', action: null }
  }
  if (method === 'POST' && path === 'refunds') return { id: 're_1', status: 'succeeded' }
  return {}
}

const fetchMock = jest.fn(async (url: any, init: any) => {
  const target = new URL(String(url))
  const path = target.pathname.replace(/^\/v1\//, '')
  const method = String(init?.method ?? 'GET')
  const params = new URLSearchParams(method === 'GET' ? target.search : String(init?.body ?? ''))
  const key = (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null
  stripeCalls.push({ method, path, key, params })
  if (key && replays.has(key)) {
    return { ok: true, status: 200, json: async () => replays.get(key) }
  }
  const body = stripeAnswer(method, path, params)
  if (key) replays.set(key, body)
  return { ok: true, status: 200, json: async () => body }
})

/*==========================================
 * Harness.
 *=========================================*/

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

async function act(body: Record<string, unknown>, key?: string, token = 'staff') {
  const { res, result } = response()
  const req: PluginApiRequest = {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', orderId: 'sale-1', ...body },
    headers: {
      authorization: `Bearer ${token}`,
      host: 'console.example.com',
      ...(key ? { 'idempotency-key': key } : {}),
    },
    cookies: {},
    socket: {},
  }
  await posPaymentHandler(req, res)
  return result
}

const ORDER = 'hosts/host-1/orders/sale-1'

function seedSale(totalCents = 10_000, takeFeeCents = 200) {
  fakeDocs.set('hosts/host-1', { memberRoles: { 'cashier-1': 'admin' } })
  fakeDocs.set('hosts/host-1/registers/register-1', { name: 'Front' })
  fakeDocs.set('profiles/owner-1', { stripeAccountId: 'acct_merchant', stripeChargesEnabled: true })
  fakeDocs.set('hosts/host-1/terminalReaders/tmr_ours123', {
    label: 'Counter',
    stripeLocationId: 'tml_1',
    livemode: false,
    createdAtMs: 1,
  })
  fakeDocs.set('hosts/other-host/terminalReaders/tmr_theirs99', {
    label: 'Theirs',
    stripeLocationId: 'tml_2',
    livemode: false,
    createdAtMs: 1,
  })
  fakeDocs.set('hosts/host-1/products/coffee', {
    name: 'Coffee',
    variants: [{ id: 'default', priceUsd: 50, inventory: 9, options: {} }],
  })
  fakeDocs.set(ORDER, {
    number: 7,
    status: 'pending',
    channel: 'pos',
    registerId: 'register-1',
    lineItems: [{ productId: 'coffee', name: 'Coffee', quantity: 2, unitAmountCents: 5000 }],
    totals: {
      itemsCents: totalCents,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents,
      feeCents: takeFeeCents,
    },
    posTakeFeeCents: takeFeeCents,
    posFeeOrgId: 'org-1',
    payments: [],
    timeline: [],
  })
}

function sale() {
  return fakeDocs.get(ORDER) as any
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
})

beforeEach(() => {
  resetFakeFirestore()
  stripeCalls.length = 0
  intents.clear()
  replays.clear()
  intentCounter = 0
  mockDecrement.mockClear()
  mockContacts.length = 0
  mockSaleCompleted.length = 0
  mockNotified.length = 0
  mockResent.length = 0
  mockReceiptDoor.next = null
  mockReceiptDoor.resend = null
  mockRaised.length = 0
  seedSale()
})

onPosSaleCompleted((event) => {
  mockSaleCompleted.push(event.orderId)
})

describe('split tender', () => {
  it('takes cash, a gift card and cash until the balance is zero, then completes once', async () => {
    fakeDocs.set('hosts/host-1/giftCards/GIFTCARD01', { balanceCents: 2500 })
    const first = await act({ action: 'cash', tenderedCents: 3000, amountCents: 3000 }, 'k1')
    expect(first.status).toBe(200)
    expect(first.body.sale).toMatchObject({ paidCents: 3000, dueCents: 7000 })
    const card = await act({ action: 'gift-card', code: 'giftcard01' }, 'k2')
    expect(card.body.sale).toMatchObject({ paidCents: 5500, dueCents: 4500 })
    expect(fakeDocs.get('hosts/host-1/giftCards/GIFTCARD01')?.balanceCents).toBe(0)
    const last = await act({ action: 'cash', tenderedCents: 5000 }, 'k3')
    expect(last.body.completed).toBe(true)
    expect(last.body.sale.payments.at(-1)).toMatchObject({ amountCents: 4500, changeCents: 500 })
    expect(sale().status).toBe('paid')
    // No card took a share, so the whole take is on the invoice, exactly once.
    expect(fakeDocs.get(`orgs/org-1/offlineFees/${new Date().toISOString().slice(0, 7)}`)).toMatchObject({
      feeCents: 200,
      orders: 1,
    })
    expect(sale().totals.feeCents).toBe(200)
    expect(sale().feeCollection).toBe('invoice')
    expect(mockDecrement).toHaveBeenCalledTimes(1)
    expect(mockSaleCompleted).toEqual(['sale-1'])
  })

  it('replays a retried tender instead of taking the money twice', async () => {
    await act({ action: 'cash', tenderedCents: 2000 }, 'same')
    const again = await act({ action: 'cash', tenderedCents: 2000 }, 'same')
    expect(again.status).toBe(200)
    expect(sale().payments).toHaveLength(1)
    expect(again.body.sale.paidCents).toBe(2000)
  })

  it('refuses a tender with no idempotency key', async () => {
    expect((await act({ action: 'cash', tenderedCents: 2000 })).status).toBe(400)
  })

  it('refuses short cash and a tender bigger than the balance', async () => {
    expect((await act({ action: 'cash', tenderedCents: 500, amountCents: 1000 }, 'a')).body.error).toBe(
      'Cash received is short',
    )
    await act({ action: 'cash', tenderedCents: 9000 }, 'b')
    const over = await act({ action: 'card-keyed', amountCents: 2000 }, 'c')
    expect(over.status).toBe(409)
    expect(stripeCalls).toHaveLength(0)
  })
})

describe('gift cards at the register (the AGL-2449 race guard)', () => {
  it('cannot spend dollars an online checkout is holding', async () => {
    fakeDocs.set('hosts/host-1/giftCards/GIFTCARD02', {
      balanceCents: 3000,
      holds: { cs_live: { cents: 2000, expiresAtMs: Date.now() + 60_000 } },
    })
    const taken = await act({ action: 'gift-card', code: 'GIFTCARD02' }, 'g1')
    expect(taken.body.sale.paidCents).toBe(1000)
    const empty = await act({ action: 'gift-card', code: 'GIFTCARD02' }, 'g2')
    expect(empty.status).toBe(409)
    expect(fakeDocs.get('hosts/host-1/giftCards/GIFTCARD02')?.balanceCents).toBe(2000)
  })

  it('refuses a frozen card', async () => {
    fakeDocs.set('hosts/host-1/giftCards/GIFTCARD03', { balanceCents: 3000, frozenAtMs: 5 })
    expect((await act({ action: 'gift-card', code: 'GIFTCARD03' }, 'g')).status).toBe(409)
  })
})

describe('card readers', () => {
  it('refuses a reader that belongs to another store, before Stripe is asked anything', async () => {
    const result = await act({ action: 'card-present', amountCents: 5000, readerId: 'tmr_theirs99' }, 'r1')
    expect(result.status).toBe(404)
    expect(stripeCalls).toHaveLength(0)
    expect(sale().payments).toHaveLength(0)
  })

  it('refuses a live card-present payment until Terminal is switched on for the platform', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake'
    delete process.env.STRIPE_TERMINAL_LIVE_ENABLED
    try {
      const refused = await act({ action: 'card-present', amountCents: 5000, readerId: 'tmr_ours123' }, 'live')
      expect(refused.status).toBe(409)
      const sdk = await act({ action: 'card-present-sdk', amountCents: 5000 }, 'live-sdk')
      expect(sdk.status).toBe(409)
      expect(stripeCalls.some((call) => call.path === 'payment_intents')).toBe(false)
    } finally {
      process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
    }
  })

  it('authorizes on the reader, then captures with a fee that excludes the tip', async () => {
    const started = await act({ action: 'card-present', amountCents: 10_000, readerId: 'tmr_ours123' }, 'r2')
    expect(started.status).toBe(200)
    const create = stripeCalls.find((call) => call.path === 'payment_intents')!
    expect(create.params.get('capture_method')).toBe('manual')
    // Settlement stays on the platform account (ToS §10.7), like every
    // other storefront charge: a destination charge with no `on_behalf_of`.
    expect(create.params.has('on_behalf_of')).toBe(false)
    expect(create.params.get('transfer_data[destination]')).toBe('acct_merchant')
    expect(create.params.getAll('payment_method_types[]')).toEqual(['card_present'])
    expect(create.params.get('metadata[kind]')).toBe('pos')
    expect(stripeCalls.some((call) => call.path.endsWith('/process_payment_intent'))).toBe(true)

    // The customer adds a $15 tip on the reader and taps.
    const intent = [...intents.values()][0]
    intent.status = 'requires_capture'
    intent.amount = 11_500
    intent.amount_details = { tip: { amount: 1500 } }
    const paymentId = started.body.paymentId
    const status = await act({ action: 'status', paymentId })
    expect(status.body.completed).toBe(true)
    const capture = stripeCalls.find((call) => call.path.endsWith('/capture'))!
    // The take is the sale's ($2.00 of $100), never the tip's; Stripe's own
    // cost is on the whole $115 charge.
    expect(Number(capture.params.get('application_fee_amount'))).toBe(
      200 + posCardProcessingCostCents(11_500),
    )
    expect(sale().totals).toMatchObject({ totalCents: 10_000, tipCents: 1500 })
    expect(sale().payments[0]).toMatchObject({
      status: 'succeeded',
      amountCents: 10_000,
      tipCents: 1500,
      cardBrand: 'visa',
      last4: '4242',
    })
    expect(sale().paymentIntentId).toBe(intent.id)
    // A card carried the whole take: nothing is invoiced.
    expect(fakeDocs.get(`orgs/org-1/offlineFees/${new Date().toISOString().slice(0, 7)}`)).toBeUndefined()
  })

  it('does nothing on a webhook replay: one capture, one completion, stock once', async () => {
    const started = await act({ action: 'card-present', amountCents: 10_000, readerId: 'tmr_ours123' }, 'r3')
    const intent = [...intents.values()][0]
    intent.status = 'requires_capture'
    const event = {
      type: 'terminal.reader.action_succeeded',
      object: { action: { type: 'process_payment_intent', process_payment_intent: { payment_intent: intent.id } } },
    }
    expect(await handlePosStripeEvent(event)).toEqual({ hostId: 'host-1' })
    expect(await handlePosStripeEvent(event)).toEqual({ hostId: 'host-1' })
    await act({ action: 'status', paymentId: started.body.paymentId })
    expect(stripeCalls.filter((call) => call.path.endsWith('/capture'))).toHaveLength(1)
    expect(mockDecrement).toHaveBeenCalledTimes(1)
    expect(mockSaleCompleted).toEqual(['sale-1'])
    expect(mockRaised).toEqual([{ hostId: 'host-1', orderId: 'sale-1', key: 'paid' }])
    expect(sale().timeline.filter((entry: any) => entry.event === 'paid')).toHaveLength(1)
  })

  it('ignores Stripe events that are not the register’s', async () => {
    expect(await handlePosStripeEvent({ type: 'payment_intent.succeeded', object: { metadata: {} } })).toBeNull()
    expect(await handlePosStripeEvent({ type: 'invoice.paid', object: {} })).toBeNull()
  })

  it('records a decline as failed, keeps the balance, and retries on the same intent', async () => {
    const started = await act({ action: 'card-present', amountCents: 4000, readerId: 'tmr_ours123' }, 'r4')
    const intent = [...intents.values()][0]
    intent.last_payment_error = { message: 'Your card was declined.' }
    await act({ action: 'status', paymentId: started.body.paymentId })
    expect(sale().payments[0]).toMatchObject({ status: 'failed', failureMessage: 'Your card was declined.' })
    delete intent.last_payment_error
    const retried = await act({ action: 'retry', paymentId: started.body.paymentId })
    expect(retried.status).toBe(200)
    expect(stripeCalls.filter((call) => call.path === 'payment_intents')).toHaveLength(1)
    expect(stripeCalls.filter((call) => call.path.endsWith('/process_payment_intent'))).toHaveLength(2)
  })
})

describe('typed card and the QR link', () => {
  it('creates a card-only intent with the tip in the charge and not in the take', async () => {
    const keyed = await act({ action: 'card-keyed', amountCents: 5000, tipCents: 1000 }, 'kd')
    expect(keyed.body.clientSecret).toMatch(/_secret$/)
    const create = stripeCalls.find((call) => call.path === 'payment_intents')!
    expect(create.params.get('amount')).toBe('6000')
    expect(create.params.getAll('payment_method_types[]')).toEqual(['card'])
    expect(create.params.get('capture_method')).toBeNull()
    expect(Number(create.params.get('application_fee_amount'))).toBe(100 + posCardProcessingCostCents(6000))
  })
})

describe('voiding an open sale', () => {
  it('refunds the card, re-credits the gift card and cancels the order', async () => {
    fakeDocs.set('hosts/host-1/giftCards/GIFTCARD04', { balanceCents: 1000 })
    await act({ action: 'gift-card', code: 'GIFTCARD04' }, 'v1')
    const keyed = await act({ action: 'card-keyed', amountCents: 2000 }, 'v2')
    const intent = intents.get(sale().payments[1].paymentIntentId)
    intent.status = 'succeeded'
    await act({ action: 'status', paymentId: keyed.body.paymentId })
    const voided = await act({ action: 'void' })
    expect(voided.status).toBe(200)
    expect(sale().status).toBe('cancelled')
    expect(sale().payments.map((payment: any) => payment.status)).toEqual(['reversed', 'reversed'])
    expect(fakeDocs.get('hosts/host-1/giftCards/GIFTCARD04')?.balanceCents).toBe(1000)
    const refund = stripeCalls.find((call) => call.path === 'refunds')!
    expect(refund.params.get('reverse_transfer')).toBe('true')
    expect(refund.params.get('refund_application_fee')).toBe('true')
    expect(mockDecrement).not.toHaveBeenCalled()
  })

  it('refuses to void a paid sale', async () => {
    await act({ action: 'cash', tenderedCents: 10_000 }, 'paid')
    expect((await act({ action: 'void' })).status).toBe(409)
  })
})

describe('receipts', () => {
  it('sends the receipt the customer chose through the buyer-notification door, once', async () => {
    await act({ action: 'receipt', channel: 'email', to: 'Ann@Example.com', marketingOptIn: true })
    expect(sale().receiptRequest).toMatchObject({ channel: 'email', to: 'ann@example.com', marketingOptIn: true })
    expect(mockNotified).toHaveLength(0)
    await act({ action: 'cash', tenderedCents: 10_000 }, 'paid')
    expect(mockNotified).toEqual([
      { ref: { hostId: 'host-1', orderId: 'sale-1' }, event: 'receipt', options: { email: 'ann@example.com' } },
    ])
    expect(mockContacts[0]).toMatchObject({ marketingConsent: true, identity: { email: 'ann@example.com' } })
  })

  it('refuses a text receipt when no SMS provider is on', async () => {
    expect((await act({ action: 'receipt', channel: 'sms', to: '+1 555 010 0199' })).status).toBe(409)
  })

  describe('with an SMS provider registered (AGL-3610)', () => {
    let configured = true
    beforeAll(() => {
      registerPluginSmsMessaging(
        { isConfigured: () => configured, send: async () => ({ outcome: 'sent', id: 'SM1' }) as any },
        { pluginId: 'sms-spec' },
      )
    })
    afterAll(() => {
      configured = false
    })

    it('texts the receipt of a paid sale to the number the customer typed', async () => {
      await act({ action: 'cash', tenderedCents: 10_000 }, 'paid')
      mockNotified.length = 0
      const sent = await act({ action: 'receipt', channel: 'sms', to: '+1 (555) 010-0199' })
      expect(sent.status).toBe(200)
      expect(sale()).toMatchObject({
        customerPhone: '+15550100199',
        receiptRequest: { channel: 'sms', to: '+15550100199' },
      })
      expect(mockNotified).toEqual([
        { ref: { hostId: 'host-1', orderId: 'sale-1' }, event: 'receipt', options: {} },
      ])
      expect(mockResent).toHaveLength(0)
    })

    it('still texts the customer who asked when the store turned automatic texts off', async () => {
      await act({ action: 'cash', tenderedCents: 10_000 }, 'paid')
      mockNotified.length = 0
      mockResent.length = 0
      // The door skips the text: the store's `texts` switch is off.
      mockReceiptDoor.next = { outcome: 'handled', channels: [] }
      const sent = await act({ action: 'receipt', channel: 'sms', to: '+1 (555) 010-0199' })
      expect(sent.status).toBe(200)
      expect(mockResent).toEqual([
        { ref: { hostId: 'host-1', orderId: 'sale-1' }, channel: 'sms', to: '+15550100199' },
      ])
    })

    it('sends one text for a double tap, and lets a failed one be retried', async () => {
      await act({ action: 'cash', tenderedCents: 10_000 }, 'paid')
      mockNotified.length = 0
      mockResent.length = 0
      mockReceiptDoor.next = { outcome: 'handled', channels: [{ channel: 'sms', outcome: 'failed', error: 'x' }] }
      expect((await act({ action: 'receipt', channel: 'sms', to: '+15550100199' })).status).toBe(502)
      expect((await act({ action: 'receipt', channel: 'sms', to: '+15550100199' })).status).toBe(200)
      expect((await act({ action: 'receipt', channel: 'sms', to: '+15550100199' })).status).toBe(200)
      expect(mockNotified).toHaveLength(2)
    })
  })

  it('emails the address typed at the counter, not the one the sale was opened with', async () => {
    await act({ action: 'cash', tenderedCents: 10_000 }, 'paid')
    const order = sale()
    fakeDocs.set(ORDER, { ...order, customerEmail: 'opened@example.com' })
    mockNotified.length = 0
    mockResent.length = 0
    expect((await act({ action: 'receipt', channel: 'email', to: 'typed@example.com' })).status).toBe(200)
    expect(mockNotified).toHaveLength(0)
    expect(mockResent).toEqual([
      { ref: { hostId: 'host-1', orderId: 'sale-1' }, channel: 'email', to: 'typed@example.com' },
    ])
  })

  it('ends the customer display turn and drops the typed address once handled (AGL-3608)', async () => {
    const STATE = 'posDisplayStates/host-1__register-1'
    await act({ action: 'cash', tenderedCents: 10_000 }, 'paid')
    fakeDocs.set(STATE, {
      mode: 'receipt',
      promptId: 'r1',
      updatedAtMs: Date.now(),
      receipt: { channels: ['email', 'none'], offerMarketing: false },
      response: { promptId: 'r1', receiptChannel: 'email', email: 'ann@example.com', atMs: 1 },
    })
    expect((await act({ action: 'receipt', channel: 'email', to: 'ann@example.com' })).status).toBe(200)
    expect(fakeDocs.get(STATE)).toMatchObject({ mode: 'thanks', currency: 'usd' })
    expect(JSON.stringify(fakeDocs.get(STATE))).not.toContain('ann@example.com')
  })

  it('leaves the display alone for a receipt chosen before the sale is paid', async () => {
    const STATE = 'posDisplayStates/host-1__register-1'
    fakeDocs.set(STATE, { mode: 'cart', updatedAtMs: Date.now() })
    await act({ action: 'receipt', channel: 'none' })
    expect(fakeDocs.get(STATE)).toMatchObject({ mode: 'cart' })
  })
})

describe('the gate', () => {
  it('refuses someone who is not a member of the site', async () => {
    expect((await act({ action: 'cash', tenderedCents: 100 }, 'x', 'other')).status).toBe(403)
  })
})

/*==========================================
 * ANOTHER PLUGIN'S PROVIDER, BY QR (AGL-3630).
 *=========================================*/

import {
  registerPluginPaymentProvider,
  type PluginPaymentCheckoutRequest,
  type PluginPaymentRefundRequest,
  type PluginPaymentSettlement,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { commercePosCheckoutOwner } from './pos-provider-payment'

describe('a provider’s QR at the register (AGL-3630)', () => {
  const opened: PluginPaymentCheckoutRequest[] = []
  const refunds: PluginPaymentRefundRequest[] = []

  beforeEach(() => {
    resetPluginServicesForTests()
    opened.length = 0
    refunds.length = 0
    registerPluginPaymentProvider(
      'wallet',
      {
        available: async () => ({
          providerId: 'wallet',
          label: 'Wallet',
          methods: [{ id: 'wallet', label: 'Wallet' }, { id: 'later', label: 'Later' }],
          livemode: false,
        }),
        createCheckout: async (request) => {
          opened.push(request)
          return { providerId: 'wallet', providerCheckoutId: 'w1', redirectUrl: 'https://console.example.com/api/wallet/pay?c=w1', livemode: false }
        },
        refund: async (request) => {
          refunds.push(request)
          return { ok: true, refundId: `R-${refunds.length}`, status: 'completed' }
        },
      },
      { pluginId: 'wallet-plugin' },
    )
  })

  function settlementFor(request: PluginPaymentCheckoutRequest, overrides: Partial<PluginPaymentSettlement> = {}): PluginPaymentSettlement {
    const amount = request.lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0)
    return {
      providerId: 'wallet',
      providerLabel: 'Wallet',
      providerCheckoutId: 'w1',
      ownerKind: request.ownerKind,
      checkoutId: request.checkoutId,
      orgId: 'org-1',
      hostId: 'host-1',
      currency: 'usd',
      metadata: request.metadata,
      totalCents: amount,
      payer: { email: 'customer@example.com' },
      paymentId: 'CAPTURE-1',
      amountCents: amount,
      breakdown: { itemsCents: amount, discountCents: 0, taxCents: 0, shippingCents: 0, totalCents: amount },
      platformFeeCents: request.platformFeeCents,
      livemode: false,
      settledAtMs: 1_800_000_000_000,
      ...overrides,
    }
  }

  it('is offered to the register by the provider’s methods', async () => {
    const context = await act({ action: 'context' })
    expect(context.body.paymentOptions).toEqual([{ providerId: 'wallet', label: 'Wallet', methods: ['Wallet', 'Later'] }])
  })

  it('reserves the amount, opens one checkout for it with the tip, and shows its page', async () => {
    const first = await act({ action: 'provider-link', providerId: 'wallet', amountCents: 5_000, tipCents: 500 }, 'q1')
    expect(first.status).toBe(200)
    expect(first.body.sale.payments).toEqual([
      expect.objectContaining({ method: 'wallet_link', status: 'pending', amountCents: 5_000, tipCents: 500, checkoutUrl: 'https://console.example.com/api/wallet/pay?c=w1', providerLabel: 'Wallet' }),
    ])
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({
      ownerKind: 'commerce-pos',
      channel: 'in-person',
      lines: [
        { name: 'In-store purchase', quantity: 1, unitCents: 5_000, ships: false },
        { name: 'Tip', quantity: 1, unitCents: 500, ships: false },
      ],
      // Half the sale carries half the take, and the tip none — no card cost on top.
      platformFeeCents: 100,
      metadata: { type: 'pos-payment', hostId: 'host-1', orderId: 'sale-1' },
    })
    expect(opened[0].returnUrl).toMatch(/paid=1$/)
    // The same press again: the same payment, no second checkout.
    await act({ action: 'provider-link', providerId: 'wallet', amountCents: 5_000, tipCents: 500 }, 'q1')
    expect(opened).toHaveLength(1)
    expect(stripeCalls).toEqual([])
  })

  it('refuses a provider that is not offered', async () => {
    const refused = await act({ action: 'provider-link', providerId: 'elsewhere', amountCents: 5_000 }, 'q2')
    expect(refused.status).toBe(409)
    expect(sale().payments).toEqual([])
  })

  it('settles the payment once, completing the sale with the fee netted, not invoiced', async () => {
    await act({ action: 'provider-link', providerId: 'wallet', amountCents: 10_000 }, 'q3')
    const request = opened[0]
    expect(await commercePosCheckoutOwner.approve({ ...settlementFor(request) })).toEqual({ ok: true })
    await commercePosCheckoutOwner.settle(settlementFor(request))
    await commercePosCheckoutOwner.settle(settlementFor(request))
    expect(sale().status).toBe('paid')
    expect(sale().payments[0]).toMatchObject({ status: 'succeeded', providerPaymentId: 'CAPTURE-1', feeCents: 200 })
    expect(sale().totals.feeCents).toBe(200)
    expect(sale().feeCollection).toBe('payout')
    expect([...fakeDocs.keys()].some((key) => key.startsWith('orgs/org-1/offlineFees/'))).toBe(false)
    expect(mockSaleCompleted).toEqual(['sale-1'])
  })

  it('refuses to take money the register stopped waiting for', async () => {
    const started = await act({ action: 'provider-link', providerId: 'wallet', amountCents: 5_000 }, 'q4')
    await act({ action: 'cancel', paymentId: started.body.paymentId })
    expect(sale().payments[0].status).toBe('canceled')
    expect(await commercePosCheckoutOwner.approve(settlementFor(opened[0]))).toMatchObject({ ok: false })
    expect(stripeCalls).toEqual([])
  })

  it('gives the amount back when the customer never pays', async () => {
    await act({ action: 'provider-link', providerId: 'wallet', amountCents: 5_000 }, 'q5')
    await commercePosCheckoutOwner.expire(settlementFor(opened[0]))
    expect(sale().payments[0]).toMatchObject({ status: 'failed' })
    expect(sale().status).toBe('pending')
  })

  it('hands a settled QR payment back through the provider when the sale is voided', async () => {
    await act({ action: 'provider-link', providerId: 'wallet', amountCents: 4_000, tipCents: 400 }, 'q6')
    await commercePosCheckoutOwner.settle(settlementFor(opened[0]))
    const voided = await act({ action: 'void' })
    expect(voided.status).toBe(200)
    expect(sale().status).toBe('cancelled')
    expect(sale().payments[0].status).toBe('reversed')
    expect(refunds).toEqual([expect.objectContaining({ paymentId: 'CAPTURE-1', amountCents: 4_400, idempotencyKey: expect.stringMatching(/^pos-void:/) })])
    expect(stripeCalls).toEqual([])
  })
})
