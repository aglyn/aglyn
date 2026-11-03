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

// Without a top-level import or export TypeScript treats this file as a global
// script, so its top-level `const`s collide with identically-named ones in
// sibling specs (TS2451/TS2393). The marker makes it a module.
export {}

/**
 * STRIPE'S UNDELIVERED LIST IS NOT A LIST OF FAILURES (AGL-4133).
 *
 * `delivery_success=false` returns events "still pending" as well as events
 * that failed, and it lags the deliveries. On 2026-11-03 an ordinary new
 * subscription turned `/api/health/billing` red with `deliveries-failing`
 * while every one of its seven deliveries had answered 200 first time.
 *
 * WHAT THIS SUITE CATCHES. The route is driven for real against a healthy
 * Stripe census, and only the list and the claims behind it vary. A probe that
 * dropped the claim read goes red on the first case. A probe that trusted any
 * claim, or that forgave a listed event outright, goes green on the failure
 * cases, and those are the three shapes this alarm exists for: a delivery we
 * rejected, a dispatch that half applied, and a Firestore we could not read.
 */

const WEBHOOK_URL = 'https://app.aglyn.com/api/billing/webhook'

/** The claim documents that exist, by event id, or `'throw'` for an outage. */
let mockClaims: Record<string, Record<string, unknown>> | 'throw' = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  UNSUBSCRIBE_SUPPRESSION_REASON: 'unsubscribe',
  __esModule: true,
  firebaseAdmin: {},
}))

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({}),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { fromMillis: (value: number) => ({ value }) },
  getFirestore: () => ({
    collection: () => ({
      doc: (id: string) => ({ id }),
      where: () => ({
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
      }),
    }),
    getAll: async (...refs: Array<{ id: string }>) => {
      if (mockClaims === 'throw') throw new Error('firestore unavailable')
      const claims = mockClaims
      return refs.map(({ id }) => ({
        id,
        exists: id in claims,
        get: (field: string) => claims[id]?.[field],
      }))
    },
  }),
}))

const ORIGINAL_ENV = process.env
const ORIGINAL_FETCH = global.fetch

const PLATFORM_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'checkout.session.completed',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'customer.updated',
  'payment_method.attached',
  'payment_method.detached',
  'radar.early_fraud_warning.created',
  'review.opened',
  'charge.failed',
  'terminal.reader.action_succeeded',
  'terminal.reader.action_failed',
  'payment_intent.amount_capturable_updated',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
]

const HEALTHY_ENDPOINTS = [
  {
    id: 'we_platform',
    url: WEBHOOK_URL,
    status: 'enabled',
    enabled_events: PLATFORM_EVENTS,
    metadata: {},
  },
  {
    id: 'we_connect',
    url: WEBHOOK_URL,
    status: 'enabled',
    enabled_events: ['account.updated', 'payout.failed', 'payout.paid'],
    metadata: { aglyn_scope: 'connect' },
  },
]

const minutesAgo = (minutes: number): number =>
  Math.floor((Date.now() - minutes * 60_000) / 1000)

/**
 * A fresh module registry per call: the probe is memoized for five minutes,
 * so a second invocation in the same registry would replay the first answer.
 */
async function probe(
  listed: unknown[],
): Promise<{ check: Record<string, unknown>; status: number }> {
  jest.resetModules()
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
    STRIPE_WEBHOOK_URL: WEBHOOK_URL,
    NEXT_PUBLIC_CONSOLE_ORIGIN: 'https://app.aglyn.com',
    // The sibling `meteredPricing` check shares this route's HTTP status.
    STRIPE_PRICE_METERED: 'price_metered_month',
    STRIPE_PRICE_METERED_YEARLY: 'price_metered_year',
  } as NodeJS.ProcessEnv
  global.fetch = jest.fn(async (input: unknown) => ({
    ok: true,
    json: async () =>
      String(input).includes('webhook_endpoints')
        ? { data: HEALTHY_ENDPOINTS }
        : String(input).includes('delivery_success=false')
          ? { data: listed }
          : { data: [] },
  })) as unknown as typeof fetch
  const { GET } = require('../app/api/health/billing/route')
  const response = await GET()
  const body = await response.json()
  return {
    check: body.checks.billingWebhook as Record<string, unknown>,
    status: response.status,
  }
}

beforeEach(() => {
  mockClaims = {}
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
})

describe('/api/health/billing reads Stripe’s undelivered list against its own claims (AGL-4133)', () => {
  it('stays green on a delivered event Stripe is still listing', async () => {
    mockClaims = { evt_landed: { type: 'customer.updated' } }
    const { check, status } = await probe([{ id: 'evt_landed', created: minutesAgo(7) }])
    expect(status).toBe(200)
    expect(check.ok).toBe(true)
    expect(check.undelivered).toBe(0)
  })

  it('stays green on an event the first attempt has not reached yet', async () => {
    const { check, status } = await probe([{ id: 'evt_new', created: minutesAgo(0) }])
    expect(status).toBe(200)
    expect(check.undelivered).toBe(0)
  })

  it('goes red on a delivery we rejected, which never wrote a claim', async () => {
    const { check, status } = await probe([{ id: 'evt_rejected', created: minutesAgo(7) }])
    expect(status).toBe(503)
    expect(check.code).toBe('deliveries-failing')
    expect(check.undelivered).toBe(1)
  })

  it('goes red on a half-applied dispatch, whose held claim is not clean', async () => {
    mockClaims = { evt_held: { type: 'invoice.paid', failedAfterEffects: true } }
    const { check, status } = await probe([{ id: 'evt_held', created: minutesAgo(7) }])
    expect(status).toBe(503)
    expect(check.code).toBe('deliveries-failing')
  })

  it('goes red when a claim is too old to explain the listing as a lag', async () => {
    mockClaims = { evt_stuck: { type: 'invoice.paid' } }
    const { check, status } = await probe([{ id: 'evt_stuck', created: minutesAgo(45) }])
    expect(status).toBe(503)
    expect(check.code).toBe('deliveries-failing')
  })

  it('believes Stripe when the claims cannot be read', async () => {
    mockClaims = 'throw'
    const { check, status } = await probe([{ id: 'evt_listed', created: minutesAgo(7) }])
    expect(status).toBe(503)
    expect(check.code).toBe('deliveries-failing')
  })
})
