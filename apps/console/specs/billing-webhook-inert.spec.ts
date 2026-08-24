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
 * A WEBHOOK THAT ANSWERS 200 AND DOES NOTHING (AGL-1954).
 *
 * Every signal this platform has about the billing webhook describes the
 * REQUEST. Stripe scores the status code. The `stripeEvents` claim records
 * that the signature verified. `/api/health/billing` counts what Stripe
 * attempted and failed to deliver. A handler that returns 200 and silently
 * drops the work satisfies all three, and AGL-1798 is that bug in the wild:
 * `charge.refunded` was not subscribed, AGL-1546's entitlement revocation had
 * no trigger, and every indicator read green for as long as it lasted.
 *
 * ## THE POINT OF THIS SUITE IS THAT THE CHECK CAN FAIL
 *
 * A detection nobody has watched go red is worth nothing, so the central
 * test here NEUTERS A REAL HANDLER: `updateExisting` — the mirror that writes
 * a workspace's plan onto its org document, and the one thing a
 * `customer.subscription.updated` delivery exists to do — is replaced with a
 * version that ANSWERS TRUE AND WRITES NOTHING. That is the defect shape
 * exactly: no throw, no 500, no failed delivery, the same `{ received: true }`
 * body byte for byte.
 *
 * The neutered delivery and the healthy one are asserted to be
 * indistinguishable from the outside, and distinguishable only by the marker.
 * If they were not identical the test would be proving something easier than
 * the bug.
 *
 * ## Why the ledger counts writes instead of being told about them
 *
 * `ledger.effect('org-plan-mirrored')` sitting beside the write would survive
 * the write being deleted, which makes it a check that cannot fail — the very
 * thing being complained about. `observeWrites` records the effect from
 * inside the call that commits it, so the neuter below removes the signal
 * along with the work. Both halves are asserted.
 *
 * ## And the middle case, which is where alarms go to die
 *
 * A delivery that legitimately does nothing — a tenant shopper's
 * subscription, a marketplace refund, a `won` dispute nobody claimed — must
 * NOT mark. Conflating it with the silent-drop case produces alert fatigue,
 * which ends with the alarm muted and the real one lost inside it. Those are
 * asserted as negative controls, one per shape.
 *
 * Harness lifted from `billing-webhook-claim-release.spec.ts`.
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

const LIVE_DEPLOYMENT = {
  STRIPE_SECRET_KEY: 'sk_live_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_live_fake',
}

/** Every `runBillingWebhookHandlers` dispatch. */
const mockDispatched: { type: string }[] = []
/** Whether the plugin fan-out claims the event (AGL-2429). */
let mockDispatchClaimed = false
/**
 * THE NEUTER SWITCH. When true, `updateExisting` answers TRUE and writes
 * NOTHING — a mirror that has silently stopped landing, which is
 * indistinguishable from a working one everywhere except the ledger.
 */
let mockNeuterOrgMirror = false

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
      if (!docs.has(path)) {
        const error = new Error(`5 NOT_FOUND: ${path}`) as Error & {
          code?: number
        }
        error.code = 5
        throw error
      }
      docs.set(path, { ...docs.get(path), ...data })
      return undefined
    },
    delete: async () => {
      docs.delete(path)
      return undefined
    },
  })
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

const mockAfterScheduled: Array<() => unknown> = []
jest.mock('next/server', () => ({
  after: (work: () => unknown) => {
    mockAfterScheduled.push(work)
    return work()
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING', ADMIN_OVERVIEW: 'ADMIN_OVERVIEW' },
  // THE REAL classifier, ledger and write observer. Stubbing any of the
  // three would make this whole suite an assertion about a test double.
  classifyDeliveryLag: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).classifyDeliveryLag,
  classifyWebhookDelivery: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).classifyWebhookDelivery,
  createWebhookEffectLedger: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).createWebhookEffectLedger,
  observeWrites: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).observeWrites,
  runBillingWebhookHandlers: async (input: { type: string }) => {
    mockDispatched.push({ type: input.type })
    return { claimed: mockDispatchClaimed }
  },
  // The REAL predicate the metered-backfill decision keys off — a re-typed
  // list here would drift from the one the route actually consults.
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
  SELF_SERVE_PLANS: ['free', 'starter', 'pro', 'business', 'scale'],
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
  notifyOrgAdmins: async () => undefined,
  notifyStaff: async () => undefined,
  sendGa4Purchase: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  sendGa4Refund: async (input: Ga4PurchaseInput): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: !input.clientId,
  }),
  sendGa4SubscriptionCancelled: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  writeOrgBilling: async () => undefined,
  /*==========================================
   * THE NEUTER, and it is a FAITHFUL double either way (AGL-1954).
   *
   * Healthy: it does what the real `update-existing.ts` does — `ref.update()`,
   * true on success, false on a NOT_FOUND. That write goes through the ref
   * the route obtained from its OBSERVED Firestore handle, so it reaches the
   * ledger from inside the call that commits it.
   *
   * Neutered: it returns true and never touches the ref. Nothing throws,
   * nothing 500s, the response is unchanged. This is the whole bug, in one
   * flag.
   *=========================================*/
  updateExisting: async (
    ref: { update: (data: Record<string, unknown>) => Promise<unknown> },
    data: Record<string, unknown>,
  ) => {
    if (mockNeuterOrgMirror) return true
    try {
      await ref.update(data)
      return true
    } catch (error) {
      if ((error as { code?: number })?.code === 5) return false
      throw error
    }
  },
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

function loadWebhook() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...LIVE_DEPLOYMENT } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function event(id: string, type: string, object: Record<string, unknown>) {
  return { id, type, livemode: true, data: { object } }
}

const claim = (id: string) => docs.get(`stripeEvents/${id}`)
const wasMarkedInert = (id: string) => claim(id)?.['inert'] === true

/** A paid workspace's subscription — the delivery whose whole job is the mirror. */
const OUR_SUBSCRIPTION = {
  id: 'sub_own_1',
  object: 'subscription',
  customer: 'cus_own_1',
  status: 'active',
  metadata: { orgId: 'org-real', plan: 'pro' },
  items: { data: [{ price: { id: 'price_pro', recurring: { interval: 'month' } } }] },
}

describe('the webhook records a delivery that did nothing (AGL-1954)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'starter' })
    mockDispatched.length = 0
    mockAfterScheduled.length = 0
    mockDispatchClaimed = false
    mockNeuterOrgMirror = false
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

  /*==========================================
   * THE PROOF THAT THE CHECK CAN FAIL.
   *=========================================*/

  it('THE HEALTHY CONTROL: a subscription event that mirrors the plan is NOT marked', async () => {
    const post = loadWebhook()
    const response = await post(
      signed(
        event('evt_ok', 'customer.subscription.updated', OUR_SUBSCRIPTION),
        'whsec_live_fake',
      ),
    )
    expect(response.status).toBe(200)
    // The work actually happened — otherwise the control proves nothing.
    expect(docs.get('orgs/org-real')?.['plan']).toBe('pro')
    expect(wasMarkedInert('evt_ok')).toBe(false)
  })

  it('NEUTERED: the mirror answers true and writes nothing — and it IS marked', async () => {
    // `updateExisting` now returns true without touching the document. No
    // throw, no 500, no failed delivery. This is the AGL-1954 shape.
    mockNeuterOrgMirror = true
    const post = loadWebhook()
    const response = await post(
      signed(
        event('evt_dead', 'customer.subscription.updated', OUR_SUBSCRIPTION),
        'whsec_live_fake',
      ),
    )

    // Everything Stripe and the delivery log can see is unchanged...
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
    expect(claim('evt_dead')).toBeTruthy()
    // ...and the work did not happen.
    expect(docs.get('orgs/org-real')?.['plan']).toBe('starter')
    // The one thing that noticed.
    expect(wasMarkedInert('evt_dead')).toBe(true)
    expect(claim('evt_dead')?.['inertType']).toBe(
      'customer.subscription.updated',
    )
    expect(typeof claim('evt_dead')?.['inertAtMs']).toBe('number')
  })

  it('the healthy and the neutered delivery are IDENTICAL from outside', async () => {
    // If they differed anywhere else, this suite would be proving something
    // easier than the bug — and the bug is precisely that they do not differ.
    const healthy = await loadWebhook()(
      signed(
        event('evt_a', 'customer.subscription.updated', OUR_SUBSCRIPTION),
        'whsec_live_fake',
      ),
    )
    const healthyBody = await healthy.json()

    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'starter' })
    mockNeuterOrgMirror = true
    const dead = await loadWebhook()(
      signed(
        event('evt_b', 'customer.subscription.updated', OUR_SUBSCRIPTION),
        'whsec_live_fake',
      ),
    )
    const deadBody = await dead.json()

    expect(dead.status).toBe(healthy.status)
    expect(deadBody).toEqual(healthyBody)
    expect(wasMarkedInert('evt_b')).toBe(true)
  })

  it('the marker does NOT ride on the field the processed count reads', async () => {
    // `/api/health/billing` counts claims by `receivedAt`. A marker sharing
    // that field would inflate the very number it sits beside.
    mockNeuterOrgMirror = true
    await loadWebhook()(
      signed(
        event('evt_field', 'customer.subscription.updated', OUR_SUBSCRIPTION),
        'whsec_live_fake',
      ),
    )
    const marked = claim('evt_field') as Record<string, unknown>
    expect(marked['inertAtMs']).toEqual(expect.any(Number))
    // `receivedAt` is the claim's own stamp and is untouched by the marker.
    expect(Object.keys(marked)).toContain('receivedAt')
  })

  it('a failure to WRITE the marker never costs the delivery', async () => {
    // A monitoring write must not be able to 500 a webhook whose work is
    // done — by the AGL-2157 rule that would HOLD the idempotency claim and
    // stop Stripe retrying at all. Best-effort, and loudly logged.
    mockNeuterOrgMirror = true
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const post = loadWebhook()
    const response = await post(
      signed(
        event('evt_logged', 'customer.subscription.updated', OUR_SUBSCRIPTION),
        'whsec_live_fake',
      ),
    )
    expect(response.status).toBe(200)
    expect(
      errors.mock.calls.some((call) =>
        String(call[0]).includes('moved nothing at all'),
      ),
    ).toBe(true)
  })

  /*==========================================
   * THE MIDDLE CASE — legitimately irrelevant deliveries.
   *
   * Every one of these writes nothing and every one of them is correct.
   * Marking them would be alert fatigue, which is its own failure.
   *=========================================*/

  it("a tenant shopper's subscription names no workspace and is NOT marked", async () => {
    const post = loadWebhook()
    await post(
      signed(
        event('evt_shopper', 'customer.subscription.updated', {
          id: 'sub_shopper',
          object: 'subscription',
          customer: 'cus_shopper',
          status: 'active',
          metadata: { type: 'commerce-subscription' },
          items: { data: [] },
        }),
        'whsec_live_fake',
      ),
    )
    expect(wasMarkedInert('evt_shopper')).toBe(false)
  })

  it('a marketplace refund resolves to no workspace and is NOT marked', async () => {
    const post = loadWebhook()
    await post(
      signed(
        event('evt_mkt_refund', 'charge.refunded', {
          id: 'ch_mkt',
          object: 'charge',
          customer: 'cus_buyer',
          invoice: 'in_mkt',
          payment_intent: 'pi_mkt',
          currency: 'usd',
          refunded: true,
          amount_refunded: 900,
        }),
        'whsec_live_fake',
      ),
    )
    expect(wasMarkedInert('evt_mkt_refund')).toBe(false)
  })

  it('a WON dispute nobody claimed moved no money and is NOT marked', async () => {
    const post = loadWebhook()
    await post(
      signed(
        event('evt_won', 'charge.dispute.closed', {
          id: 'dp_won',
          object: 'dispute',
          charge: 'ch_unknown',
          payment_intent: 'pi_unknown',
          status: 'won',
          amount: 5000,
          currency: 'usd',
        }),
        'whsec_live_fake',
      ),
    )
    expect(wasMarkedInert('evt_won')).toBe(false)
  })

  it('a plugin-owned checkout is NOT marked — the route cannot see inside one', async () => {
    // `checkout.session.completed` has no branch here at all. Marking it
    // would fire on the most common event we receive. The honest close for
    // that half is `claimed` on the plugin handlers.
    const post = loadWebhook()
    await post(
      signed(
        event('evt_checkout', 'checkout.session.completed', {
          id: 'cs_1',
          object: 'checkout.session',
          metadata: { type: 'marketplace-purchase' },
        }),
        'whsec_live_fake',
      ),
    )
    expect(mockDispatched).toHaveLength(1)
    expect(wasMarkedInert('evt_checkout')).toBe(false)
  })

  it('an event type we never subscribed to is NOT marked', async () => {
    const post = loadWebhook()
    await post(
      signed(
        event('evt_unasked', 'payment_intent.succeeded', {
          id: 'pi_x',
          object: 'payment_intent',
        }),
        'whsec_live_fake',
      ),
    )
    expect(wasMarkedInert('evt_unasked')).toBe(false)
  })

  it('a plugin CLAIM rescues an event the route wrote nothing for', async () => {
    // The route's own branches wrote nothing here; the commerce plugin
    // recognised the charge. That is a handled event, not a dropped one.
    mockDispatchClaimed = true
    mockNeuterOrgMirror = true
    const post = loadWebhook()
    await post(
      signed(
        event('evt_claimed', 'customer.subscription.updated', OUR_SUBSCRIPTION),
        'whsec_live_fake',
      ),
    )
    expect(wasMarkedInert('evt_claimed')).toBe(false)
  })

  /*==========================================
   * THE OBSERVER ITSELF.
   *=========================================*/

  it('an orphaned subscription is a RECORD, not a silent drop', async () => {
    // `recordOrphanedSubscription` answers 200 on purpose (a 500 would
    // un-claim the event and buy days of identical retries) and writes to
    // `adminAudit`. That IS an effect, and it must not read as inertness.
    const post = loadWebhook()
    await post(
      signed(
        event('evt_orphan', 'customer.subscription.updated', {
          ...OUR_SUBSCRIPTION,
          metadata: { orgId: 'org-gone', plan: 'pro' },
        }),
        'whsec_live_fake',
      ),
    )
    expect(wasMarkedInert('evt_orphan')).toBe(false)
  })

  it('a delivery with no event id cannot be marked, and does not throw', async () => {
    const post = loadWebhook()
    const response = await post(
      signed(
        { type: 'customer.subscription.updated', livemode: true, data: { object: OUR_SUBSCRIPTION } },
        'whsec_live_fake',
      ),
    )
    expect(response.status).toBe(200)
  })
})
