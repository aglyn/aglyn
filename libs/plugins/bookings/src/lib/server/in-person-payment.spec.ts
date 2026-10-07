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
 * PAYING FOR A BOOKING AT THE COUNTER (AGL-3618). Every money path: the
 * destination charge and its fee, tax on the service only, one card in
 * flight per booking, a retried start that replays, a settle that trusts
 * Stripe rather than the app, a capture taken once, a paid booking that
 * cannot be paid twice, and an authorized card that a cancel cannot drop.
 */

const docs = new Map<string, Record<string, any>>()
let mockTaxPct = 0

jest.mock('@aglyn/aglyn/plugin-manager/plugin-tax-profile', () => ({
  pluginTaxProfile: () => ({
    flatRate: async () => mockTaxPct,
    flatTax: (rate: number, cents: number, label: string) => ({
      taxCents: rate > 0 ? Math.round((cents * rate) / 100) : 0,
      label,
      pct: rate,
    }),
    taxModeOf: (_payment: unknown, manual?: number) => (manual ? 'manual' : 'none'),
  }),
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  merchantAccountIsReady: (account: { accountId?: string }) => Boolean(account.accountId),
}))
let mockPlan = 'business'
jest.mock('@aglyn/tenant-data-admin', () => {
  function snapshotOf(path: string) {
    const data = docs.get(path)
    return { exists: Boolean(data), data: () => (data ? { ...data } : undefined), get: (field: string) => data?.[field] }
  }
  function ref(path: string): any {
    return {
      path,
      get: async () => snapshotOf(path),
      set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
        docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...data } : { ...data })
      },
      collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    }
  }
  const firestore = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (run: (transaction: any) => Promise<unknown>) =>
      run({
        get: async (target: any) => snapshotOf(target.path),
        set: (target: any, data: Record<string, any>, options?: { merge?: boolean }) => {
          docs.set(target.path, options?.merge ? { ...(docs.get(target.path) ?? {}), ...data } : { ...data })
        },
      }),
  }
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token === 'bad') throw new Error('expired')
            return { uid: token === 'viewer' ? 'viewer-1' : 'staff-1' }
          },
        }),
        firestore: () => firestore,
      }),
    },
    getOrgForHost: async () => ({
      orgId: 'org-1',
      org: { id: 'org-1', plan: mockPlan, subscriptionStatus: 'active', ownerUid: 'owner-1' },
    }),
  }
})

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { resolveTransactionFeeCents } from '@aglyn/aglyn/server'
import { bookingInPersonPaymentHandler, inPersonCardsAvailable } from './in-person-payment'

/*==========================================
 * A fake Stripe, keyed by idempotency key as Stripe is.
 *=========================================*/

interface StripeCall {
  method: string
  path: string
  key: string | null
  params: URLSearchParams
}
const calls: StripeCall[] = []
const intents = new Map<string, any>()
const replays = new Map<string, any>()
let counter = 0

function answer(method: string, path: string, params: URLSearchParams): any {
  if (method === 'POST' && path === 'payment_intents') {
    const id = `pi_test${++counter}abcdef`
    const intent = {
      id,
      amount: Number(params.get('amount')),
      status: 'requires_payment_method',
      client_secret: `${id}_secret_abc`,
      metadata: Object.fromEntries(
        [...params.entries()].filter(([key]) => key.startsWith('metadata[')).map(([key, value]) => [key.slice(9, -1), value]),
      ),
    }
    intents.set(id, intent)
    return intent
  }
  const capture = /^payment_intents\/(pi_\w+)\/capture$/.exec(path)
  if (method === 'POST' && capture) {
    const intent = intents.get(capture[1])
    intent.status = 'succeeded'
    intent.amount_received = intent.amount
    return { ...intent }
  }
  const cancel = /^payment_intents\/(pi_\w+)\/cancel$/.exec(path)
  if (method === 'POST' && cancel) {
    const intent = intents.get(cancel[1])
    intent.status = 'canceled'
    return { ...intent }
  }
  const get = /^payment_intents\/(pi_\w+)$/.exec(path)
  if (method === 'GET' && get) return intents.has(get[1]) ? { ...intents.get(get[1]) } : null
  return null
}

const fetchMock = jest.fn(async (url: any, init: any) => {
  const target = new URL(String(url))
  const path = target.pathname.replace(/^\/v1\//, '')
  const method = String(init?.method ?? 'GET')
  const params = new URLSearchParams(String(init?.body ?? ''))
  const key = (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null
  calls.push({ method, path, key, params })
  if (key && replays.has(key)) return { ok: true, status: 200, json: async () => replays.get(key) }
  const body = answer(method, path, params)
  if (key) replays.set(key, body)
  return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body ?? { error: { message: 'No such' } } }
})

/*==========================================
 * Harness.
 *=========================================*/

const BOOKING = 'hosts/host-1/bookings/booking-1'

async function call(body: Record<string, unknown>, options: { key?: string; token?: string; method?: string } = {}) {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(value: unknown) {
      result.body = value
    },
  } as unknown as PluginApiResponse
  const req = {
    method: options.method ?? 'POST',
    query: {},
    body: { hostId: 'host-1', bookingId: 'booking-1', ...body },
    headers: {
      authorization: `Bearer ${options.token ?? 'staff'}`,
      ...(options.key ? { 'idempotency-key': options.key } : {}),
    },
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
  await bookingInPersonPaymentHandler(req, res)
  return result
}

/** The app collecting the card: Stripe now holds an authorization. */
function tap(paymentIntentId: string) {
  intents.get(paymentIntentId).status = 'requires_capture'
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  calls.length = 0
  intents.clear()
  replays.clear()
  counter = 0
  mockTaxPct = 0
  mockPlan = 'business'
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
  delete process.env.STRIPE_TERMINAL_LIVE_ENABLED
  docs.set('hosts/host-1', { memberRoles: { 'staff-1': 'editor', 'viewer-1': 'viewer' } })
  docs.set('profiles/owner-1', { stripeAccountId: 'acct_merchant', stripeChargesEnabled: true })
  docs.set(BOOKING, { serviceName: 'Haircut', status: 'confirmed', startsAtMs: 1 })
})

describe('the gate', () => {
  it('refuses a missing or bad token, a viewer, GET, and a plan without POS', async () => {
    expect((await call({ action: 'start' }, { token: 'bad', key: 'k' })).status).toBe(401)
    expect((await call({ action: 'start', amountCents: 5000 }, { token: 'viewer', key: 'k' })).status).toBe(403)
    expect((await call({ action: 'start' }, { method: 'GET' })).status).toBe(405)
    mockPlan = 'free'
    expect((await call({ action: 'start', amountCents: 5000 }, { key: 'k' })).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('refuses in live mode until Terminal live mode is on', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake'
    expect(inPersonCardsAvailable()).toBe(false)
    expect((await call({ action: 'start', amountCents: 5000 }, { key: 'k' })).status).toBe(409)
    process.env.STRIPE_TERMINAL_LIVE_ENABLED = 'true'
    expect(inPersonCardsAvailable()).toBe(true)
  })

  it('refuses a missing booking id, an unknown booking, and an unknown action', async () => {
    expect((await call({ action: 'start', bookingId: '../x' }, { key: 'k' })).status).toBe(400)
    expect((await call({ action: 'start', bookingId: 'nope', amountCents: 5000 }, { key: 'k' })).status).toBe(404)
    expect((await call({ action: 'refund-everything' })).status).toBe(400)
  })
})

describe('start', () => {
  it('needs an Idempotency-Key and a chargeable amount', async () => {
    expect((await call({ action: 'start', amountCents: 5000 })).status).toBe(400)
    expect((await call({ action: 'start', amountCents: 10 }, { key: 'k' })).body.error).toMatch(/\$0\.50/)
    expect((await call({ action: 'start', amountCents: 12.5 }, { key: 'k' })).status).toBe(400)
    expect((await call({ action: 'start', amountCents: 2_000_000 }, { key: 'k' })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('creates a card-present destination charge with the service fee, tax on the service only', async () => {
    mockTaxPct = 8
    const result = await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-1' })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      paymentIntentId: 'pi_test1abcdef',
      clientSecret: 'pi_test1abcdef_secret_abc',
      amountCents: 5400,
      serviceCents: 5000,
      taxCents: 400,
    })
    const created = calls.find((entry) => entry.path === 'payment_intents')!
    const fee = resolveTransactionFeeCents(
      { id: 'org-1', plan: 'business', subscriptionStatus: 'active' } as never,
      'service',
      5000,
      5400,
    )
    expect(Object.fromEntries(created.params)).toMatchObject({
      amount: '5400',
      currency: 'usd',
      'payment_method_types[]': 'card_present',
      capture_method: 'manual',
      on_behalf_of: 'acct_merchant',
      'transfer_data[destination]': 'acct_merchant',
      'metadata[type]': 'booking-in-person',
      'metadata[hostId]': 'host-1',
      'metadata[bookingId]': 'booking-1',
      'metadata[taxCents]': '400',
    })
    expect(created.params.get('application_fee_amount') ?? '0').toBe(String(fee))
    expect(created.key).toMatch(/^booking-in-person:[0-9a-f]{40}$/)
    expect(docs.get(BOOKING)?.['inPersonPayment']).toMatchObject({
      paymentIntentId: 'pi_test1abcdef',
      status: 'pending',
      amountCents: 5400,
      startedBy: 'staff-1',
    })
  })

  it('replays a retried start instead of opening a second charge', async () => {
    const first = await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-1' })
    const again = await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-1' })
    expect(again.body.paymentIntentId).toBe(first.body.paymentIntentId)
    expect(intents.size).toBe(1)
  })

  it('a new start releases the uncollected card before opening another', async () => {
    const first = await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-1' })
    const second = await call({ action: 'start', amountCents: 6000 }, { key: 'attempt-2' })
    expect(second.status).toBe(200)
    expect(second.body.paymentIntentId).not.toBe(first.body.paymentIntentId)
    expect(intents.get(first.body.paymentIntentId).status).toBe('canceled')
  })

  it('refuses to start over a card that is already authorized', async () => {
    const first = await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-1' })
    tap(first.body.paymentIntentId)
    const second = await call({ action: 'start', amountCents: 6000 }, { key: 'attempt-2' })
    expect(second.status).toBe(409)
    expect(second.body.error).toMatch(/already authorized/)
    expect(intents.size).toBe(1)
  })

  it('refuses a paid, canceled or online-paying booking', async () => {
    docs.set(BOOKING, { status: 'confirmed', paidAmountCents: 5000, paymentIntentId: 'pi_online1' })
    expect((await call({ action: 'start', amountCents: 5000 }, { key: 'a' })).body.error).toMatch(/already paid/)
    docs.set(BOOKING, { status: 'canceled' })
    expect((await call({ action: 'start', amountCents: 5000 }, { key: 'b' })).body.error).toMatch(/canceled/)
    docs.set(BOOKING, { status: 'pendingPayment', expiresAtMs: Date.now() + 60_000 })
    expect((await call({ action: 'start', amountCents: 5000 }, { key: 'c' })).body.error).toMatch(/online/)
    expect(calls).toHaveLength(0)
  })

  it('refuses while the merchant cannot take card payments', async () => {
    docs.set('profiles/owner-1', {})
    expect((await call({ action: 'start', amountCents: 5000 }, { key: 'a' })).status).toBe(409)
    expect(calls).toHaveLength(0)
  })
})

describe('settle', () => {
  it('captures an authorized card once and records the booking paid, as an online payment is', async () => {
    mockTaxPct = 10
    const started = await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-1' })
    tap(started.body.paymentIntentId)
    const settled = await call({ action: 'settle' })
    expect(settled.body).toEqual({ status: 'paid', amountCents: 5500 })
    const booking = docs.get(BOOKING)!
    expect(booking).toMatchObject({
      paidAmountCents: 5500,
      paymentIntentId: started.body.paymentIntentId,
      taxCents: 500,
      taxMode: 'manual',
      paidInPerson: true,
      status: 'confirmed',
      inPersonPayment: { status: 'paid' },
    })
    const fee = booking['feeCents']
    const capture = calls.find((entry) => entry.path.endsWith('/capture'))!
    expect(capture.params.get('application_fee_amount') ?? '0').toBe(String(fee))
    expect(capture.key).toBe(`booking-in-person-capture:${started.body.paymentIntentId}`)

    // Settled again (a lost answer): nothing moves.
    const again = await call({ action: 'settle' })
    expect(again.body).toEqual({ status: 'paid', amountCents: 5500 })
    expect(calls.filter((entry) => entry.path.endsWith('/capture'))).toHaveLength(1)
    // And it cannot be paid twice.
    expect((await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-3' })).status).toBe(409)
  })

  it('leaves an uncollected card pending, whatever the app claims', async () => {
    await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-1' })
    const settled = await call({ action: 'settle', status: 'succeeded' })
    expect(settled.body).toEqual({ status: 'pending' })
    expect(docs.get(BOOKING)?.['paidAmountCents']).toBeUndefined()
    expect(calls.some((entry) => entry.path.endsWith('/capture'))).toBe(false)
  })

  it('refuses an intent that is not this booking’s', async () => {
    const started = await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-1' })
    intents.get(started.body.paymentIntentId).metadata.bookingId = 'booking-2'
    tap(started.body.paymentIntentId)
    expect((await call({ action: 'settle' })).status).toBe(409)
    expect(calls.some((entry) => entry.path.endsWith('/capture'))).toBe(false)
  })

  it('refuses with no payment in progress', async () => {
    expect((await call({ action: 'settle' })).status).toBe(409)
  })
})

describe('cancel', () => {
  it('releases an uncollected card, and the booking is payable again', async () => {
    const started = await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-1' })
    expect((await call({ action: 'cancel' })).body).toEqual({ status: 'canceled' })
    expect(intents.get(started.body.paymentIntentId).status).toBe('canceled')
    expect((await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-2' })).status).toBe(200)
  })

  it('never drops an authorized card', async () => {
    const started = await call({ action: 'start', amountCents: 5000 }, { key: 'attempt-1' })
    tap(started.body.paymentIntentId)
    expect((await call({ action: 'cancel' })).status).toBe(409)
    expect(intents.get(started.body.paymentIntentId).status).toBe('requires_capture')
  })

  it('is a no-op with nothing in progress', async () => {
    expect((await call({ action: 'cancel' })).body).toEqual({ status: 'none' })
  })
})
