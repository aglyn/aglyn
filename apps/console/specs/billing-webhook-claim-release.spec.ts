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
 * THE IDEMPOTENCY CLAIM IS RELEASED ONLY WHEN NOTHING CAN HAVE LANDED
 * (AGL-2157).
 *
 * The bug: the route's outer `catch` deleted the `stripeEvents/{id}` marker on
 * EVERY throw. That marker is the one thing standing between a Stripe
 * redelivery and a second application of a NON-IDEMPOTENT side effect —
 * inventory decrements, gift-card balances, coupon redemption counters — and
 * it was being dropped precisely when it was doing its job. A handler that
 * decremented stock and then threw un-claimed its own event, and the
 * redelivery decremented the stock again.
 *
 * The distinction now drawn, and BOTH halves are asserted here because a fix
 * that never released would be a different bug — a genuine pre-dispatch
 * failure would stop being retried at all:
 *
 *   nothing happened  → marker DELETED, 500, Stripe redelivers and re-runs.
 *   something MAY have → marker HELD, 500, recorded on the marker and
 *                        escalated to staff. Stripe's redelivery
 *                        short-circuits; a human reconciles.
 *
 * ⚠️ THE REGISTRY'S PROPAGATION SEMANTICS ARE NOT TOUCHED, and that is
 * deliberate. `billing-webhook-hooks.ts` runs handlers sequentially with no
 * error isolation, which is documented behaviour ("Handler errors propagate to
 * a 500 so Stripe redelivers; make handlers idempotent"). Per-handler
 * isolation would trade a DUPLICATED side effect for a DROPPED one, which is
 * the worse trade on a money path. The real remaining fix is per-effect
 * idempotency inside the plugins' own writes; this is the half that could
 * land alone without making anything worse.
 *
 * Harness lifted from `billing-webhook-livemode.spec.ts` — same signed
 * requests, same in-memory Firestore whose `create()` REJECTS on an existing
 * document, which is the dedupe primitive the whole claim rests on. A fake
 * that overwrote would make every assertion below green and meaningless.
 *
 * NO STRIPE PATH IS EXERCISED: `global.fetch` is a jest mock.
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
/** Every staff escalation the route attempted (AGL-2157). */
const mockStaffNotices: Array<Record<string, unknown>> = []
/** Flipped per test to make a specific stage throw. */
let mockFailPluginLoad = false
let mockFailDispatch = false
let mockFailOrgLookup = false

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
  /**
   * `where(...).limit(n).get()`, filtering over the real stored documents.
   *
   * Added with AGL-2120's platform-dispute branch, which resolves the revenue
   * row by query. Modelled rather than stubbed: the four `charge.dispute.*`
   * rehearsals below are POSITIVE controls asserting the event processes
   * FULLY, and a double that answered every query with the same document
   * would let that pass while the ownership boundary was broken. Returning
   * `{ docs: [] }` unconditionally would be just as unfaithful in the other
   * direction. A collection with no `where` at all is what these four
   * rehearsals actually hit first — a 500, which is the double's defect
   * surfacing as a route failure.
   */
  const query = (
    name: string,
    filters: readonly [string, unknown][],
    max: number | null,
  ) => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unmodelled query operator: ${op}`)
      return query(name, [...filters, [field, value]], max)
    },
    limit: (count: number) => query(name, filters, count),
    get: async () => {
      const matches = [...docs.keys()]
        .filter((path) => path.startsWith(`${name}/`))
        .filter((path) =>
          filters.every(
            ([field, value]) => (docs.get(path) ?? {})[field] === value,
          ),
        )
        .map((path) => ({
          id: path.split('/').pop() as string,
          exists: true,
          data: () => docs.get(path),
          get: (field: string) => (docs.get(path) ?? {})[field],
          ref: doc(path),
        }))
      return {
        docs: max == null ? matches : matches.slice(0, max),
        empty: matches.length === 0,
      }
    },
  })
  return {
    collection: (name: string) => ({
      doc: (id: string) => doc(`${name}/${id}`),
      add: async (data: Record<string, unknown>) => {
        docs.set(`${name}/auto-${docs.size}`, { ...data })
        return { id: `auto-${docs.size}` }
      },
      where: (field: string, op: string, value: unknown) =>
        query(name, [], null).where(field, op, value),
    }),
  }
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING', ADMIN_OVERVIEW: 'ADMIN_OVERVIEW' },
  // Captured, not stubbed: this IS the money-reversal dispatch — the
  // marketplace refund and both dispute legs self-select inside it.
  runBillingWebhookHandlers: async (input: { type: string }) => {
    mockDispatched.push({ type: input.type })
    // A plugin handler throwing AFTER it has begun — the case the claim
    // exists for. Recorded before throwing, so the assertion that it ran is
    // independent of the assertion that it failed.
    if (mockFailDispatch) throw new Error('a plugin handler blew up mid-effect')
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
  findOrgIdByStripeCustomer: async (customerId: string) => {
    if (mockFailOrgLookup) throw new Error('firestore unavailable mid-branch')
    return customerId === 'cus_own_1' ? 'org-real' : null
  },
  notifyOrgAdmins: async (orgId: string) => {
    mockNotified.push(orgId)
    return undefined
  },
  // Present because the route CALLS it (AGL-2157). A wholesale mock is a
  // closed world: omitting it would make the escalation a TypeError thrown
  // inside the catch block, i.e. an unhandled rejection standing in for a
  // guard, and every assertion here would still be about a 500.
  notifyStaff: async (payload: Record<string, unknown>) => {
    mockStaffNotices.push(payload)
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
  serverPluginLoader: {
    ensureAll: async () => {
      // The canonical PRE-DISPATCH failure: the console API surfaces could
      // not be loaded, so no handler of any kind ran and nothing landed.
      if (mockFailPluginLoad) throw new Error('plugin surfaces failed to load')
      return undefined
    },
  },
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
  object: Record<string, unknown> = REVERSAL_CHARGE,
) {
  return { id, type, livemode: true, data: { object } }
}

const claim = (id: string) => docs.get(`stripeEvents/${id}`)

describe('the billing webhook holds its claim only when an effect may have landed (AGL-2157)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
    docs.set('platformRevenue/in_ga_annual', {
      grossCents: 28900,
      orgId: 'org-real',
    })
    mockGa4Refunds.length = 0
    mockDispatched.length = 0
    mockNotified.length = 0
    mockStaffNotices.length = 0
    mockFailPluginLoad = false
    mockFailDispatch = false
    mockFailOrgLookup = false
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('THE NEGATIVE CONTROL: a clean event claims once and stays claimed', async () => {
    const post = loadWebhook(LIVE_DEPLOYMENT)
    const first = await post(
      signed(event('evt_clean', 'charge.refunded'), 'whsec_live_fake'),
    )
    expect(first.status).toBe(200)
    expect(claim('evt_clean')).toBeTruthy()
    expect(claim('evt_clean')?.['failedAfterEffects']).toBeUndefined()
    expect(mockStaffNotices).toHaveLength(0)
    expect(mockDispatched).toHaveLength(1)

    // A redelivery is an ordinary duplicate — no `held`, no second dispatch.
    const second = await post(
      signed(event('evt_clean', 'charge.refunded'), 'whsec_live_fake'),
    )
    expect(await second.json()).toEqual({ received: true, duplicate: true })
    expect(mockDispatched).toHaveLength(1)
  })

  it('NOTHING HAPPENED: a pre-dispatch failure RELEASES the claim, and the redelivery re-runs', async () => {
    // `ensureAll` throws, so no plugin handler ran — and the event type below
    // matches no built-in branch either, so nothing at all was applied. This
    // is the AGL-498 behaviour that must survive the fix: releasing here is
    // correct, and never releasing would silently drop a retryable event.
    const post = loadWebhook(LIVE_DEPLOYMENT)
    mockFailPluginLoad = true
    const failed = await post(
      signed(event('evt_pre', 'invoice.upcoming', {}), 'whsec_live_fake'),
    )
    expect(failed.status).toBe(500)
    expect(claim('evt_pre')).toBeUndefined() // released
    expect(mockDispatched).toHaveLength(0) // and nothing ever dispatched
    expect(mockStaffNotices).toHaveLength(0) // not an incident

    // Stripe redelivers, the claim is free, and the event actually processes.
    mockFailPluginLoad = false
    const retried = await post(
      signed(event('evt_pre', 'invoice.upcoming', {}), 'whsec_live_fake'),
    )
    expect(retried.status).toBe(200)
    expect(mockDispatched).toHaveLength(1)
  })

  it('SOMETHING HAPPENED: a handler failing mid-dispatch HOLDS the claim', async () => {
    const post = loadWebhook(LIVE_DEPLOYMENT)
    mockFailDispatch = true
    const failed = await post(
      signed(event('evt_mid', 'charge.refunded'), 'whsec_live_fake'),
    )
    expect(failed.status).toBe(500)
    // The dispatch DID begin — this is what separates this case from the one
    // above, and it is asserted rather than assumed.
    expect(mockDispatched).toEqual([{ type: 'charge.refunded' }])
    // The claim survives, carrying why.
    const held = claim('evt_mid')
    expect(held).toBeTruthy()
    expect(held?.['failedAfterEffects']).toBe(true)
    expect(held?.['failedType']).toBe('charge.refunded')
    expect(String(held?.['failedMessage'])).toContain('mid-effect')
    // …and it is never silent: a half-applied event needs a human.
    expect(mockStaffNotices).toHaveLength(1)
    expect(mockStaffNotices[0]['type']).toBe('system.billingWebhookHalfApplied')
    expect(String(mockStaffNotices[0]['body'])).toContain('evt_mid')
  })

  it('…and the redelivery of a held event does NOT re-run the handlers', async () => {
    // The whole point. Under the old catch this second delivery found no
    // marker, re-entered the dispatch and re-applied every non-idempotent
    // effect the first one had already committed.
    const post = loadWebhook(LIVE_DEPLOYMENT)
    mockFailDispatch = true
    await post(signed(event('evt_twice', 'charge.refunded'), 'whsec_live_fake'))
    expect(mockDispatched).toHaveLength(1)

    mockFailDispatch = false
    const redelivery = await post(
      signed(event('evt_twice', 'charge.refunded'), 'whsec_live_fake'),
    )
    expect(redelivery.status).toBe(200)
    expect(await redelivery.json()).toEqual({
      received: true,
      duplicate: true,
      held: true,
    })
    // NOT two. This number is the bug.
    expect(mockDispatched).toHaveLength(1)
  })

  it('a BUILT-IN branch failing holds the claim too, not just the plugin dispatch', async () => {
    // The flag is set at the top of each branch, not only before
    // `runBillingWebhookHandlers` — a subscription or invoice branch can write
    // and then throw just as a plugin handler can. Without this the fix would
    // cover a third of the route and read as covering all of it.
    const post = loadWebhook(LIVE_DEPLOYMENT)
    mockFailOrgLookup = true
    const failed = await post(
      signed(
        event('evt_builtin', 'invoice.paid', {
          id: 'in_ga_annual',
          customer: 'cus_own_1',
        }),
        'whsec_live_fake',
      ),
    )
    expect(failed.status).toBe(500)
    expect(claim('evt_builtin')?.['failedAfterEffects']).toBe(true)
    // The plugin dispatch never ran, so the hold came from the built-in
    // branch alone — the discriminator that makes this case distinct.
    expect(mockDispatched).toHaveLength(0)
    expect(mockStaffNotices).toHaveLength(1)
  })
})
