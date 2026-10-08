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
 * Store credit another plugin keeps (AGL-3640), taken at the register through
 * core's checkout-credits seam: by code or by the account a staff lookup
 * found, staged and debited INSIDE the sale's transaction, never more than the
 * account gives or the sale still owes, once per attempt key, aborted whole
 * when the account gives less than the payment records, and handed back by a
 * void. The provider is a fake whose balance lives in the same fake Firestore.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'
import {
  registerPluginCheckoutCredit,
  type PluginCheckoutCreditProvider,
} from '@aglyn/aglyn/plugin-manager/plugin-checkout-credits'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { fakeFirestore } from '../testing/fake-firestore'

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

const ACCOUNT = 'credit/acct'
let shortBy = 0

function provide(overrides: Partial<PluginCheckoutCreditProvider> = {}) {
  registerPluginCheckoutCredit(
    {
      key: 'rewards',
      label: 'Rewards',
      recognizes: (code) => code.startsWith('RW-'),
      offered: async () => true,
      resolve: async (input) => {
        if (input.code === 'RW-GOOD' || (input.staff && input.reference === 'm:good')) {
          return { ok: true, reference: 'm:good', label: 'Rewards', last4: 'GOOD', availableCents: 0 }
        }
        return { ok: false, status: 404, error: 'That rewards code is not valid.' }
      },
      hold: async () => ({ ok: false, status: 400, error: 'unused' }),
      release: async () => undefined,
      stage: async ({ transaction, orderId }) => {
        const ref = fakeFirestore.collection('credit').doc('acct')
        const snapshot = await transaction.get(ref)
        const balance = Number(snapshot.get('balanceCents') ?? 0)
        const debits = { ...(snapshot.get('debits') ?? {}) }
        return {
          availableCents: balance,
          debit: ({ cents, key }) => {
            const taken = Math.max(0, cents - shortBy)
            transaction.set(ref, { balanceCents: balance - taken, debits: { ...debits, [key]: { cents: taken, orderId } } })
            return taken
          },
          reverse: ({ key }) => {
            const prior = debits[key]
            if (!prior) return 0
            const next = { ...debits }
            delete next[key]
            transaction.set(ref, { balanceCents: balance + prior.cents, debits: next })
            return prior.cents
          },
        }
      },
      restore: async () => 0,
      lookup: async ({ query }) =>
        query.includes('@')
          ? [{ ok: true, reference: 'm:good', label: 'Rewards', last4: 'GOOD', availableCents: 2500, detail: `${query} · 2,500 points` }]
          : [],
      ...overrides,
    },
    { pluginId: 'loyalty' },
  )
}

beforeEach(() => {
  resetPluginServicesForTests()
  shortBy = 0
  fakeDocs.set(ACCOUNT, { balanceCents: 2500 })
})

describe('store credit at the register (AGL-3640)', () => {
  it('offers each provider the site takes on the register’s context', async () => {
    provide()
    const { res, result } = response()
    await posPaymentHandler(
      {
        method: 'GET',
        query: { action: 'context', hostId: 'host-1' },
        body: {},
        headers: { authorization: 'Bearer staff', host: 'console.example.com' },
        cookies: {},
        socket: {},
      } as unknown as PluginApiRequest,
      res,
    )
    expect(result.status).toBe(200)
    expect(result.body.credits).toEqual([{ providerId: 'loyalty.rewards', label: 'Rewards', lookup: true }])
  })

  it('takes what the account gives toward the sale, once per key, and the rest by cash', async () => {
    provide()
    const credit = await act({ action: 'credit', code: 'rw-good' }, 'c1')
    expect(credit.status).toBe(200)
    expect(credit.body.sale).toMatchObject({ paidCents: 2500, dueCents: 7500 })
    expect(credit.body.sale.payments[0]).toMatchObject({ method: 'credit', amountCents: 2500, last4: 'GOOD', creditLabel: 'Rewards' })
    expect(sale().payments[0]).toMatchObject({ creditProviderId: 'loyalty.rewards', creditReference: 'm:good' })
    expect(fakeDocs.get(ACCOUNT)?.balanceCents).toBe(0)
    // The same press again finds its payment and takes nothing more.
    const replay = await act({ action: 'credit', code: 'RW-GOOD' }, 'c1')
    expect(replay.body.sale.paidCents).toBe(2500)
    expect(fakeDocs.get(ACCOUNT)?.balanceCents).toBe(0)
    const rest = await act({ action: 'cash', tenderedCents: 7500 }, 'c2')
    expect(rest.body.completed).toBe(true)
    expect(sale().timeline.at(-1).detail).toContain('Rewards (•••• GOOD) $25.00')
  })

  it('takes no more than the sale still owes, or the amount typed', async () => {
    provide()
    fakeDocs.set(ACCOUNT, { balanceCents: 50_000 })
    const typed = await act({ action: 'credit', code: 'RW-GOOD', amountCents: 1200 }, 't1')
    expect(typed.body.sale.paidCents).toBe(1200)
    const all = await act({ action: 'credit', code: 'RW-GOOD' }, 't2')
    expect(all.body.completed).toBe(true)
    expect(fakeDocs.get(ACCOUNT)?.balanceCents).toBe(40_000)
  })

  it('refuses an empty account, an unknown code, and a site that does not take it', async () => {
    provide()
    fakeDocs.set(ACCOUNT, { balanceCents: 0 })
    expect(await act({ action: 'credit', code: 'RW-GOOD' }, 'e1')).toEqual({
      status: 409,
      body: { error: 'This rewards account has nothing to spend.' },
    })
    expect((await act({ action: 'credit', code: 'RW-NOPE' }, 'e2')).status).toBe(404)
    expect((await act({ action: 'credit', code: 'GC-1234' }, 'e3')).status).toBe(404)
    resetPluginServicesForTests()
    provide({ offered: async () => false })
    expect((await act({ action: 'credit', code: 'RW-GOOD' }, 'e4')).status).toBe(404)
    expect(sale().payments).toEqual([])
  })

  it('takes from the account a staff lookup found', async () => {
    provide()
    const found = await act({ action: 'credit-lookup', providerId: 'loyalty.rewards', query: 'sam@example.com' })
    expect(found).toEqual({
      status: 200,
      body: {
        providerId: 'loyalty.rewards',
        accounts: [{ ok: true, reference: 'm:good', label: 'Rewards', last4: 'GOOD', availableCents: 2500, detail: 'sam@example.com · 2,500 points' }],
      },
    })
    const taken = await act({ action: 'credit', providerId: 'loyalty.rewards', reference: 'm:good' }, 'l1')
    expect(taken.body.sale.paidCents).toBe(2500)
  })

  it('aborts the whole payment when the account gives less than it records', async () => {
    provide()
    shortBy = 100
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const short = await act({ action: 'credit', code: 'RW-GOOD' }, 's1')
    spy.mockRestore()
    expect(short.status).toBe(500)
    expect(sale().payments).toEqual([])
    expect(fakeDocs.get(ACCOUNT)?.balanceCents).toBe(2500)
  })

  it('a void hands the credit back before the sale is canceled', async () => {
    provide()
    await act({ action: 'credit', code: 'RW-GOOD' }, 'v1')
    expect(fakeDocs.get(ACCOUNT)?.balanceCents).toBe(0)
    const voided = await act({ action: 'void' })
    expect(voided.status).toBe(200)
    expect(fakeDocs.get(ACCOUNT)?.balanceCents).toBe(2500)
    expect(sale().status).toBe('cancelled')
    expect(sale().payments[0].status).toBe('reversed')
  })

  it('a void stops, with the sale open, when the provider is gone', async () => {
    provide()
    await act({ action: 'credit', code: 'RW-GOOD' }, 'g1')
    resetPluginServicesForTests()
    const voided = await act({ action: 'void' })
    expect(voided.status).toBe(409)
    expect(sale().status).toBe('pending')
  })
})
