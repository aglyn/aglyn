/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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
 * The environment gate (AGL-2040): an event is processed only when its
 * `livemode` matches the deployment's own.
 *
 * The fixtures are the FIVE REAL EVENT IDS that reached the production
 * webhook on 2026-08-18T12:32:59–12:33:12Z, not synthesised ones. That is
 * deliberate and it is the point of the issue: the rehearsal that caused this
 * proved a handler runs while proving nothing about which environment it ran
 * in, so this file is pinned to the deliveries that actually happened.
 *
 * Four claims, and two of them are POSITIVE controls — a gate that refused
 * everything would satisfy the first claim alone, and would be a worse bug
 * than the one it fixes:
 *
 * 1. A test-mode event on a LIVE deployment is ignored and writes NOTHING.
 * 2. A LIVE event on a live deployment still processes fully.
 * 3. A test-mode event on a TEST deployment still processes fully — the
 *    AGL-1951 rehearsal capability survives.
 * 4. Nothing is written BEFORE the decision: no `stripeEvents` claim exists
 *    on the ignored path, which is what makes the gate's position (after
 *    JSON.parse, before the claim) observable rather than asserted.
 *
 * NO STRIPE PATH IS EXERCISED: `global.fetch` is a jest mock and every
 * Firestore and GA4 dependency is captured in-process.
 */

// A module, not a script — the const declarations below would otherwise
// collide with the other console billing route specs' globals under `tsc`.
export {}

import { createHmac } from 'node:crypto'
import type { Ga4PurchaseInput, Ga4SendResult } from '@aglyn/tenant-data-admin'

/** Env without a trace of the developer's own Stripe config (`nx test` leaks the root env). */
const CLEAN_ENV = (() => {
  const clean = { ...process.env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('STRIPE_') || key.startsWith('NEXT_PUBLIC_STRIPE_')) {
      delete clean[key]
    }
  }
  return clean
})()

const ORIGINAL_ENV = process.env

/**
 * The two deployments, distinguished the way the route distinguishes them:
 * by the mode of the key the deployment SPENDS MONEY with. Both carry both
 * webhook secrets, exactly as production does (AGL-547) — so which secret
 * verifies a delivery can never be the signal.
 */
const LIVE_DEPLOYMENT = {
  STRIPE_SECRET_KEY: 'sk_live_fake',
  STRIPE_SECRET_KEY_TEST: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_live_fake',
  STRIPE_WEBHOOK_SECRET_TEST: 'whsec_test_fake',
}
const TEST_DEPLOYMENT = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_SECRET_KEY_TEST: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_live_fake',
  STRIPE_WEBHOOK_SECRET_TEST: 'whsec_test_fake',
}

const mockGa4Refunds: Ga4PurchaseInput[] = []
/** Every `runBillingWebhookHandlers` dispatch — the money-reversal fan-out. */
const mockDispatched: { type: string }[] = []
/** Every in-app notification the route attempted. */
const mockNotified: string[] = []

/** Every document, keyed by `collection/id`. */
let docs = new Map<string, Record<string, unknown>>()

function mockMakeFirestore() {
  const doc = (path: string) => ({
    id: path.split('/').pop(),
    create: async (data: Record<string, unknown>) => {
      if (docs.has(path)) throw new Error('ALREADY_EXISTS')
      docs.set(path, { ...data })
      return undefined
    },
    get: async () => ({
      exists: docs.has(path),
      id: path.split('/').pop(),
      ref: { id: path.split('/').pop() },
      data: () => docs.get(path),
      get: (field: string) => (docs.get(path) ?? {})[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...docs.get(path), ...data } : { ...data })
      return undefined
    },
    update: async (data: Record<string, unknown>) => {
      if (!docs.has(path)) throw new Error(`5 NOT_FOUND: ${path}`)
      docs.set(path, { ...docs.get(path), ...data })
      return undefined
    },
    delete: async () => {
      docs.delete(path)
      return undefined
    },
  })
  return {
    collection: (name: string) => ({
      doc: (id: string) => doc(`${name}/${id}`),
      add: async (data: Record<string, unknown>) => {
        docs.set(`${name}/auto-${docs.size}`, { ...data })
        return { id: `auto-${docs.size}` }
      },
    }),
  }
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  // Captured, not stubbed: this IS the money-reversal dispatch — the
  // marketplace refund and both dispute legs self-select inside it.
  runBillingWebhookHandlers: async (input: { type: string }) => {
    mockDispatched.push({ type: input.type })
    return undefined
  },
  SELF_SERVE_PLANS: [
    'free',
    'starter',
    'pro',
    'business',
    'scale',
    'advanced',
    'agency',
  ],
  PLAN_PRICING: {},
  POS_REGISTER_ADDON_MONTHLY_USD: 89,
  EVENT_CALENDAR_ADDON_MONTHLY_USD: 9,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => mockMakeFirestore() }),
    firestore: {
      FieldValue: {
        delete: () => '__delete__',
        serverTimestamp: () => '__now__',
      },
    },
  },
  findOrgIdByStripeCustomer: async (customerId: string) =>
    customerId === 'cus_own_1' ? 'org-real' : null,
  notifyOrgAdmins: async (orgId: string) => {
    mockNotified.push(orgId)
    return undefined
  },
  sendGa4Purchase: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  sendGa4Refund: async (input: Ga4PurchaseInput): Promise<Ga4SendResult> => {
    mockGa4Refunds.push(input)
    return { sent: true, synthesizedClientId: !input.clientId }
  },
  sendGa4SubscriptionCancelled: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  writeOrgBilling: async () => undefined,
  updateExisting: async () => true,
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

function signed(body: unknown, secret: string) {
  const payload = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')
  return new Request('https://app.aglyn.com/api/billing/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': `t=${timestamp},v1=${signature}`,
      'content-type': 'application/json',
    },
    body: payload,
  })
}

function loadWebhook(env: Record<string, string>) {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...env } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

/**
 * The five deliveries that actually landed in the production `stripeEvents`
 * collection on 2026-08-18, with the types Stripe recorded for them. All five
 * resolve only on the TEST key, all five carry `livemode: false`.
 */
const REAL_TEST_MODE_EVENTS = [
  { id: 'evt_1U5mCMDYHP4psn7hVrKiWDDZ', type: 'charge.dispute.created' },
  { id: 'evt_1U5mCNDYHP4psn7hrM7hNfXb', type: 'charge.dispute.closed' },
  { id: 'evt_1U5mCQDYHP4psn7h8VXNfQns', type: 'charge.dispute.created' },
  { id: 'evt_1U5mCWDYHP4psn7hA6NWDFHu', type: 'charge.dispute.closed' },
  { id: 'evt_3U5mCXDYHP4psn7h1WQjR3B3', type: 'charge.refunded' },
]

/**
 * The charge a rehearsal would carry: a payment-intent id, which is what
 * BOTH dispute legs and the marketplace refund join on, plus the invoice and
 * customer the route's own `charge.refunded` branch resolves through. Built
 * so that every consumer in AGL-2040 §3 would fire if the gate let it past —
 * a fixture that could not have matched anything would make the guard
 * unfalsifiable.
 */
const REVERSAL_CHARGE = {
  id: 'ch_own_1',
  object: 'charge',
  customer: 'cus_own_1',
  invoice: 'in_ga_annual',
  payment_intent: 'pi_own_1',
  currency: 'usd',
  refunded: true,
  amount_refunded: 28900,
}

function event(
  id: string,
  type: string,
  livemode: boolean | undefined,
  object: Record<string, unknown> = REVERSAL_CHARGE,
) {
  return {
    id,
    type,
    ...(livemode === undefined ? {} : { livemode }),
    data: { object },
  }
}

describe('the billing webhook refuses events from the other Stripe environment (AGL-2040)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
    // The AGL-1811 tax row — present so a refund that got past the gate would
    // visibly stamp it. Its absence of a `refundedCents` key is the assertion.
    docs.set('platformRevenue/in_ga_annual', {
      grossCents: 28900,
      orgId: 'org-real',
    })
    mockGa4Refunds.length = 0
    mockDispatched.length = 0
    mockNotified.length = 0
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  describe('a TEST-mode event on the LIVE deployment — the 2026-08-18 delivery', () => {
    it.each(REAL_TEST_MODE_EVENTS)(
      '$id ($type) is ignored, and writes nothing at all',
      async ({ id, type }) => {
        const post = loadWebhook(LIVE_DEPLOYMENT)
        const before = new Map(docs)

        // Signed with the TEST secret, exactly as the real delivery was: the
        // signature is VALID and AGL-547's fallback accepts it. Verification
        // is not the control and this asserts it is not being borrowed as one.
        const response = await post(
          signed(event(id, type, false), 'whsec_test_fake'),
        )

        // 200, not 4xx — `livemode` never changes, so a retry would re-reach
        // this refusal for days and then leave the destination looking dead.
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          received: true,
          ignored: 'livemode-mismatch',
        })

        // The money-reversal fan-out never ran.
        expect(mockDispatched).toHaveLength(0)
        // Nor did any of the route's own reversal consumers.
        expect(mockGa4Refunds).toHaveLength(0)
        expect(mockNotified).toHaveLength(0)
        expect(docs.get('platformRevenue/in_ga_annual')).not.toHaveProperty(
          'refundedCents',
        )

        // NOTHING WAS WRITTEN BEFORE THE DECISION. This is the assertion that
        // pins the gate's POSITION rather than its verdict: the idempotency
        // claim sits a few lines below it, so a gate placed even one step
        // later would leave this document behind.
        expect(docs.has(`stripeEvents/${id}`)).toBe(false)
        expect(docs.has(`stripeEventsTest/${id}`)).toBe(false)
        // And no other document moved either.
        expect([...docs.keys()].sort()).toEqual([...before.keys()].sort())
        expect([...docs.entries()]).toEqual([...before.entries()])
      },
    )

    it('an event that OMITS livemode is refused too — the hand-built-replay shape', async () => {
      const post = loadWebhook(LIVE_DEPLOYMENT)
      // A fixture assembled by hand around a copied payment-intent id is
      // exactly what would not carry the field. Strict `=== true` means this
      // needs no special branch to get right.
      const response = await post(
        signed(
          event('evt_3U5mCXDYHP4psn7h1WQjR3B3', 'charge.refunded', undefined),
          'whsec_test_fake',
        ),
      )
      expect(await response.json()).toEqual({
        received: true,
        ignored: 'livemode-mismatch',
      })
      expect(mockDispatched).toHaveLength(0)
      expect(docs.has('stripeEvents/evt_3U5mCXDYHP4psn7h1WQjR3B3')).toBe(false)
    })
  })

  describe('POSITIVE CONTROL — a LIVE event on the LIVE deployment still processes fully', () => {
    it('claims the event, runs the reversal dispatch, and stamps the tax record', async () => {
      const post = loadWebhook(LIVE_DEPLOYMENT)
      const response = await post(
        signed(
          event('evt_live_refund_1', 'charge.refunded', true),
          'whsec_live_fake',
        ),
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ received: true })

      // The claim landed, in the LIVE collection.
      expect(docs.get('stripeEvents/evt_live_refund_1')).toMatchObject({
        type: 'charge.refunded',
      })
      expect(docs.has('stripeEventsTest/evt_live_refund_1')).toBe(false)

      // The money-reversal fan-out ran.
      expect(mockDispatched).toEqual([{ type: 'charge.refunded' }])
      // And so did the route's own AGL-1811 / AGL-1850 consumers, which is
      // what makes this a control on the FULL path rather than on the claim.
      expect(docs.get('platformRevenue/in_ga_annual')).toMatchObject({
        refundedCents: 28900,
        refundRecordedAt: '__now__',
      })
      expect(mockGa4Refunds).toHaveLength(1)
      expect(mockGa4Refunds[0].transactionId).toBe('in_ga_annual')
    })
  })

  describe('POSITIVE CONTROL — the AGL-1951 rehearsal survives on a TEST deployment', () => {
    it.each(REAL_TEST_MODE_EVENTS)(
      '$id ($type) processes fully, claiming into stripeEventsTest',
      async ({ id, type }) => {
        const post = loadWebhook(TEST_DEPLOYMENT)
        const response = await post(
          signed(event(id, type, false), 'whsec_test_fake'),
        )
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ received: true })

        // The three money-reversal handlers AGL-1951 subscribed are reached:
        // the rehearsal capability is intact, which is the whole reason this
        // is a mode GATE and not a blanket refusal of test-mode events.
        expect(mockDispatched).toEqual([{ type }])

        // Claimed in the segregated collection, so `stripeEvents` stays a
        // pure record of live traffic (AGL-2040 §6).
        expect(docs.get(`stripeEventsTest/${id}`)).toMatchObject({ type })
        expect(docs.has(`stripeEvents/${id}`)).toBe(false)
      },
    )

    it('a LIVE event on a TEST deployment is refused — the mirror hazard', async () => {
      // A laptop or preview build holding the live webhook secret must not
      // act on real money, nor write real outcomes into a test data set.
      const post = loadWebhook(TEST_DEPLOYMENT)
      const response = await post(
        signed(
          event('evt_live_refund_1', 'charge.refunded', true),
          'whsec_live_fake',
        ),
      )
      expect(await response.json()).toEqual({
        received: true,
        ignored: 'livemode-mismatch',
      })
      expect(mockDispatched).toHaveLength(0)
      expect(docs.has('stripeEvents/evt_live_refund_1')).toBe(false)
      expect(docs.has('stripeEventsTest/evt_live_refund_1')).toBe(false)
    })
  })

  describe('the deployment mode comes from CONFIGURATION, not from the secret that verified', () => {
    it('a test-mode event refused by the live deployment is accepted by the test one — same bytes, same signature', async () => {
      // The ONE difference between these two runs is STRIPE_SECRET_KEY. Both
      // deployments carry BOTH webhook secrets, as production does, and the
      // delivery verifies against the test secret in both. If the route were
      // deciding from "which secret matched", both would behave identically.
      const delivery = () =>
        signed(
          event('evt_1U5mCMDYHP4psn7hVrKiWDDZ', 'charge.dispute.created', false),
          'whsec_test_fake',
        )

      const onLive = await loadWebhook(LIVE_DEPLOYMENT)(delivery())
      expect(await onLive.json()).toEqual({
        received: true,
        ignored: 'livemode-mismatch',
      })

      mockDispatched.length = 0
      const onTest = await loadWebhook(TEST_DEPLOYMENT)(delivery())
      expect(await onTest.json()).toEqual({ received: true })
      expect(mockDispatched).toEqual([{ type: 'charge.dispute.created' }])
    })
  })
})
