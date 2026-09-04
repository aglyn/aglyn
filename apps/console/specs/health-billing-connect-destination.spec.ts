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
 * TWO DESTINATIONS, ONE URL (AGL-1948).
 *
 * AGL-2122 created the Connect destination at the SAME `STRIPE_WEBHOOK_URL`
 * as the platform one, because connected-account events are delivered only to
 * an endpoint made with `connect: true`. Stripe reports NOTHING about
 * `connect` when an endpoint is read back — the keys it returns are
 * api_version, application, created, description, enabled_events, id,
 * livemode, metadata, object, status, url — so the only thing separating the
 * two is the metadata stamp setup-stripe writes.
 *
 * The probe used to match on url alone. `webhook_endpoints` lists NEWEST
 * FIRST and the Connect destination was created second, so from the moment it
 * existed the probe would read IT as the platform destination: comparing the
 * ten required platform events against `['account.updated']` and reporting
 * all ten unsubscribed. A false `events-unsubscribed` red, permanently, on a
 * destination that is completely healthy — and the remedy text would have
 * sent someone to re-add ten events that were never missing.
 *
 * WHAT THIS CATCHES. Not "does the route mention connect". The route is
 * driven for real against a two-endpoint census in the order Stripe returns
 * it, and both destinations' verdicts are read off the response body. A route
 * that matched by url alone fails the first case here.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  // The literal three call sites compare against — the unsubscribe writes
  // it, the resubscribe link refuses to reverse anything else, and the
  // preference page reads it. A mock that omitted it would write `undefined`
  // and every one of those comparisons would silently stop matching.
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
      where: () => ({
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
      }),
    }),
  }),
}))

const ORIGINAL_ENV = process.env
const ORIGINAL_FETCH = global.fetch

const WEBHOOK_URL = 'https://app.aglyn.com/api/billing/webhook'

/** The ten events the platform destination carries, as setup-stripe writes them. */
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

const platformEndpoint = {
  id: 'we_platform',
  url: WEBHOOK_URL,
  status: 'enabled',
  enabled_events: PLATFORM_EVENTS,
  metadata: {},
}

const connectEndpoint = (overrides: Record<string, unknown> = {}) => ({
  id: 'we_connect',
  url: WEBHOOK_URL,
  status: 'enabled',
  enabled_events: ['account.updated'],
  // The stamp setup-stripe writes. Nothing else distinguishes it.
  metadata: { aglyn_scope: 'connect' },
  ...overrides,
})

/**
 * A fresh module registry per call: the probe is memoized for five minutes,
 * so a second invocation in the same registry would replay the first answer.
 */
async function probe(endpoints: unknown[]): Promise<Record<string, unknown>> {
  jest.resetModules()
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: 'sk_live_not_a_real_key',
    STRIPE_WEBHOOK_URL: WEBHOOK_URL,
    NEXT_PUBLIC_CONSOLE_ORIGIN: 'https://app.aglyn.com',
  } as NodeJS.ProcessEnv
  global.fetch = jest.fn(async (input: unknown) => ({
    ok: true,
    json: async () =>
      String(input).includes('webhook_endpoints')
        ? { data: endpoints }
        : { data: [] },
  })) as unknown as typeof fetch
  const { GET } = require('../app/api/health/billing/route')
  const body = await (await GET()).json()
  return body.checks.billingWebhook as Record<string, unknown>
}

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
})

describe('/api/health/billing tells the two destinations apart (AGL-1948)', () => {
  it('reads the PLATFORM destination even when Connect is listed first', async () => {
    // Stripe lists newest first, and the Connect destination was created
    // second — so this IS the production ordering, not a contrived one.
    const check = await probe([connectEndpoint(), platformEndpoint])

    expect(check['endpointStatus']).toBe('enabled')
    // The regression: matching by url alone reads Connect's single event as
    // the platform's subscription list and reports all ten missing.
    expect(check['unsubscribedEvents']).toEqual([])
    expect(check['code']).not.toBe('events-unsubscribed')
    expect(check['ok']).toBe(true)
  })

  it('reads the CONNECT destination off the same census, at no extra call', async () => {
    const fetchCallsBefore = 0
    const check = await probe([connectEndpoint(), platformEndpoint])

    expect(check['connectEndpoint']).toBe('enabled')
    expect(check['unsubscribedConnectEvents']).toEqual([])
    // Three Stripe reads: endpoints, failed events, all events. The Connect
    // leg must not add a fourth — it comes off the endpoint list already
    // fetched.
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(
      fetchCallsBefore + 3,
    )
  })

  it('goes red when only the platform destination exists — the AGL-2122 state', async () => {
    // Exactly what was measured on the live account on 2026-08-18: one
    // destination, right url, all ten events, and nothing that could ever
    // deliver `account.updated`.
    const check = await probe([platformEndpoint])

    expect(check['endpointStatus']).toBe('enabled')
    expect(check['unsubscribedEvents']).toEqual([])
    expect(check['connectEndpoint']).toBe('missing')
    expect(check['ok']).toBe(false)
    expect(check['code']).toBe('connect-endpoint-missing')
  })

  it('goes red when the Connect destination is switched off', async () => {
    const check = await probe([
      connectEndpoint({ status: 'disabled' }),
      platformEndpoint,
    ])

    expect(check['connectEndpoint']).toBe('disabled')
    expect(check['code']).toBe('connect-endpoint-disabled')
  })

  it('goes red when the Connect destination lost account.updated', async () => {
    const check = await probe([
      connectEndpoint({ enabled_events: ['account.application.deauthorized'] }),
      platformEndpoint,
    ])

    expect(check['unsubscribedConnectEvents']).toEqual(['account.updated'])
    expect(check['code']).toBe('connect-events-unsubscribed')
  })

  it('reports a MISSING platform destination even with Connect healthy', async () => {
    // The platform destination is this hour's revenue; it outranks Connect.
    const check = await probe([connectEndpoint()])

    expect(check['endpointStatus']).toBe('missing')
    expect(check['code']).toBe('endpoint-missing')
    // …and the Connect facts still ride in the body, so the board shows both.
    expect(check['connectEndpoint']).toBe('enabled')
  })
})
