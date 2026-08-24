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
 * THE ATTEMPTS THE EVENT COUNTS CANNOT SEE (AGL-2039, closing AGL-1948).
 *
 * `/api/health/billing` scores EVENTS. `delivery_success=false` is a
 * TERMINAL-state filter, so an event that 400s three times and succeeds on
 * the fourth reads back clean: zero in `undelivered`, present in `processed`,
 * zero in `inert` because the handler did eventually run. Every number the
 * probe reads describes a healthy hour while three real attempts failed —
 * which is exactly the reading AGL-1906 produced, 0.00% against the Stripe
 * Dashboard's 30%, over the window containing AGL-1551's three 400s.
 *
 * WHAT THIS SUITE CATCHES. Not "does the route mention retries". The route is
 * driven for real against a healthy Stripe census, and only the Firestore
 * marker count is varied — so a probe that read the marker but never gated on
 * it stays green here and fails the second case.
 *
 * The last case is the one that keeps this from becoming the 51-hour
 * false-green: an upstream it could not read must report `unknown` and a
 * non-200, never `ok`.
 */

const WEBHOOK_URL = 'https://app.aglyn.com/api/billing/webhook'

/** Per-field counts the Firestore aggregations should answer with. */
let mockCounts: Record<string, number | 'throw'> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
}))

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({}),
}))

/**
 * A census that answers PER FIELD, so `receivedAt`, `inertAtMs` and
 * `retriedAtMs` can be driven independently. A mock that answered one number
 * for every aggregation could not tell the three apart, and the whole point
 * of the marker fields is that they are separate questions.
 */
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { fromMillis: (value: number) => ({ value }) },
  getFirestore: () => ({
    collection: () => ({
      where: (field: string) => ({
        count: () => ({
          get: async () => {
            const answer = mockCounts[field] ?? 0
            if (answer === 'throw') throw new Error('firestore unavailable')
            return { data: () => ({ count: answer }) }
          },
        }),
      }),
    }),
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
]

/** A completely healthy Stripe side, so only the Firestore marker varies. */
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
    enabled_events: ['account.updated'],
    metadata: { aglyn_scope: 'connect' },
  },
]

/**
 * A fresh module registry per call: the probe is memoized for five minutes,
 * so a second invocation in the same registry would replay the first answer.
 */
async function probe(
  options: {
    endpoints?: unknown[]
    /** Whether Stripe answers at all — the unreadable-upstream case. */
    stripeOk?: boolean
    /** Events Stripe attempted and failed to deliver in the window. */
    undelivered?: unknown[]
  } = {},
): Promise<{ check: Record<string, unknown>; status: number }> {
  jest.resetModules()
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
    STRIPE_WEBHOOK_URL: WEBHOOK_URL,
    NEXT_PUBLIC_CONSOLE_ORIGIN: 'https://app.aglyn.com',
    // The sibling `meteredPricing` check shares this route's HTTP status, so
    // without these the whole endpoint 503s on a reason that has nothing to
    // do with what is under test here.
    STRIPE_PRICE_METERED: 'price_metered_month',
    STRIPE_PRICE_METERED_YEARLY: 'price_metered_year',
  } as NodeJS.ProcessEnv
  const endpoints = options.endpoints ?? HEALTHY_ENDPOINTS
  global.fetch = jest.fn(async (input: unknown) => ({
    ok: options.stripeOk !== false,
    json: async () =>
      String(input).includes('webhook_endpoints')
        ? { data: endpoints }
        : String(input).includes('delivery_success=false')
          ? { data: options.undelivered ?? [] }
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
  mockCounts = {}
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
})

describe('/api/health/billing counts deliveries that only landed on a RETRY (AGL-2039)', () => {
  it('ROW 1 — healthy recent processing: every delivery landed first time', async () => {
    mockCounts = { receivedAt: 12, inertAtMs: 0, retriedAtMs: 0 }
    const { check, status } = await probe()

    expect(check['processed']).toBe(12)
    expect(check['retried']).toBe(0)
    expect(check['ok']).toBe(true)
    expect(check['code']).toBeUndefined()
    expect(status).toBe(200)
  })

  it('ROW 2 — a delivery that only landed on a retry: RED, while every other count reads healthy', async () => {
    // This is the whole issue in one case. Stripe is perfectly healthy, the
    // handler ran and did its work, nothing is unsubscribed, nothing is
    // inert, `undelivered` is zero — and three attempts failed.
    mockCounts = { receivedAt: 12, inertAtMs: 0, retriedAtMs: 3 }
    const { check, status } = await probe()

    expect(check['undelivered']).toBe(0)
    expect(check['inert']).toBe(0)
    expect(check['unsubscribedEvents']).toEqual([])
    expect(check['endpointStatus']).toBe('enabled')
    // Every arm that existed before this one says healthy...
    expect(check['retried']).toBe(3)
    // ...and the new one is the only thing that noticed.
    expect(check['ok']).toBe(false)
    expect(check['code']).toBe('deliveries-retried')
    expect(status).toBe(503)
  })

  it('ROW 3 — a handler answering 200 and doing nothing still outranks it', async () => {
    // A delivery that landed late AND moved nothing is worse than one that
    // landed late and worked, so the louder code takes the headline — and
    // the retry fact still rides in the body.
    mockCounts = { receivedAt: 12, inertAtMs: 2, retriedAtMs: 3 }
    const { check, status } = await probe()

    expect(check['code']).toBe('handlers-inert')
    expect(check['retried']).toBe(3)
    expect(check['ok']).toBe(false)
    expect(status).toBe(503)
  })

  it('ROW 4 — an unreadable upstream is UNKNOWN, never ok', async () => {
    // The 51-hour false-green rule: a 200 carrying a degraded verdict is the
    // failure. An incomplete census reports null facts and a non-200.
    mockCounts = { receivedAt: 12, inertAtMs: 0, retriedAtMs: 0 }
    const { check, status } = await probe({ stripeOk: false })

    expect(check['code']).toBe('stripe-unavailable')
    expect(check['retried']).toBeNull()
    expect(check['ok']).toBe(false)
    expect(status).toBe(503)
  })

  it('an unreadable MARKER is unanswered, not red — the alarm never fires on itself', async () => {
    // A Firestore hiccup must not manufacture a billing page. Distinct from
    // row 4: Stripe answered, so the question that matters IS answered.
    mockCounts = { receivedAt: 12, inertAtMs: 0, retriedAtMs: 'throw' }
    const { check } = await probe()

    expect(check['retried']).toBeNull()
    expect(check['ok']).toBe(true)
  })

  it('a currently-failing delivery outranks a recovered one', async () => {
    // An event failing EVERY attempt explains an event that needed several,
    // and names the more urgent thing to look at.
    mockCounts = { receivedAt: 12, inertAtMs: 0, retriedAtMs: 3 }
    const { check } = await probe({ undelivered: [{ id: 'evt_stuck' }] })

    expect(check['code']).toBe('deliveries-failing')
    expect(check['retried']).toBe(3)
  })

  it('the retry leg adds NO Stripe call — it is our own marker', async () => {
    mockCounts = { receivedAt: 1, inertAtMs: 0, retriedAtMs: 0 }
    await probe()

    // Three reads: endpoints, failed events, all events. Unchanged.
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(3)
  })

  it('a quiet window is healthy, not blind', async () => {
    // The standing rule on this board: the verdict never keys on the ABSENCE
    // of deliveries. Zero of everything is green.
    mockCounts = { receivedAt: 0, inertAtMs: 0, retriedAtMs: 0 }
    const { check } = await probe()

    expect(check['ok']).toBe(true)
    expect(check['retried']).toBe(0)
  })
})
