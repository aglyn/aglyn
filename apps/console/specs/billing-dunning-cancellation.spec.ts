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
 * THE END OF THE DUNNING ROAD (AGL-1877) — what happens to a workspace whose
 * renewal never succeeds, and whether anything at all notices.
 *
 * ## The measurement this file is built on
 *
 * A TEST-MODE test-clock drill of a failed renewal against the real Stripe
 * test account, 2026-08-19 (never live — the live key is read-only by policy
 * and the live account has no subscription to fail):
 *
 * | clock | subscription | invoice |
 * | -- | -- | -- |
 * | renewal due | `past_due` | open, attempt 1, retry in 5.4d |
 * | +7d | `past_due` | attempt 2 |
 * | +14d | `past_due` | attempt 3 |
 * | +21d | `past_due` | attempt 4 |
 * | **21.08d** | **`canceled`** | attempt 5, then Stripe gives up |
 *
 * `cancellation_details.reason: 'payment_failed'`, `canceled_at === ended_at`.
 * **The subscription never passes through `unpaid`.** That single fact is what
 * this file exists for, because three separate things were written as though
 * it did:
 *
 *  1. `shouldAutoLockOrgForBilling` required `past_due`/`unpaid` AND 30 days
 *     past the period end. Stripe leaves that status set on day 21. The
 *     predicate had NO REACHABLE TRUE BRANCH — a guard that cannot fire,
 *     behind an env flag nobody has turned on, so nothing ever noticed.
 *  2. Nothing recorded WHY a subscription ended, so a workspace Stripe gave up
 *     on and one that clicked Cancel were the same row.
 *  3. The customer was told nothing whatsoever. The `past_due` banner keys on
 *     `billingStatus === 'past_due'` and therefore vanishes at the cancel;
 *     the org drops to Free entitlements in the same write; and this branch
 *     never called `notifyOrgAdmins`.
 *
 * ## The negative controls, and why they are load-bearing
 *
 * Every assertion that a dunning cancellation IS acted on is paired with one
 * that a VOLUNTARY cancellation is not. Without the pair, "lock delinquent
 * orgs" and "lock everyone who cancels" pass identically — and the second is
 * suspending a customer for the crime of leaving. The third control is the
 * unknown reason (every cancellation that predates this mirror), which must
 * fail closed rather than being assumed delinquent.
 */

// A module, not a script — the const declarations below would otherwise
// collide with the other console billing route specs' globals under `tsc`.
export {}

import { createHmac } from 'node:crypto'
import type { Ga4SendResult } from '@aglyn/tenant-data-admin'

import {
  BILLING_LOCK_GRACE_DAYS,
  shouldAutoLockOrgForBilling,
} from '../utils/billing-auto-lock'
import {
  LIVE_MODE_DUNNING_SCHEDULE,
  TEST_MODE_DUNNING_SCHEDULE,
} from '../utils/stripe-dunning-schedule'

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

const BASE_ENV = {
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
}

type NotifyInput = { type: string; title: string; orgId: string; link: string }

const mockNotifications: NotifyInput[] = []
const mockBillingWrites: Array<{ orgId: string; patch: any }> = []

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
    // `options` is HONOURED, not dropped. A double that ignores `merge`
    // replaces the document and makes a document-replacing regression
    // unassertable — the exact shape that has produced false greens here
    // before.
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

/** See `billing-webhook-ga-cancellation.spec.ts` — records AND runs inline. */
const mockAfterScheduled: Array<() => unknown> = []
jest.mock('next/server', () => ({
  after: (work: () => unknown) => {
    mockAfterScheduled.push(work)
    return work()
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL classifier, ledger and write observer (AGL-1954), never stubs.
  // The route's "did this delivery do anything" verdict is the thing under
  // test in `billing-webhook-inert.spec.ts`, and a hand-written double here
  // would let this suite keep passing while the real rule changed under it.
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
  buildRoute: (_route: string, params: { orgSlug?: string }) =>
    `/${params?.orgSlug ?? 'org'}/billing`,
  Route: { MANAGE_BILLING: 'MANAGE_BILLING', ADMIN_OVERVIEW: 'ADMIN_OVERVIEW' },
  runBillingWebhookHandlers: async () => undefined,
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
  findOrgIdByStripeCustomer: async () => null,
  // Captured, not stubbed — HALF the subject of this file.
  notifyOrgAdmins: async (orgId: string, input: Omit<NotifyInput, 'orgId'>) => {
    mockNotifications.push({ ...input, orgId })
  },
  // The subscription lifecycle entry (AGL-118). A no-op IS the contract: the
  // real one swallows its own failures and the route does not branch on it.
  // Named explicitly because this factory is a closed world — an absent
  // export is `undefined`, the route throws into its half-applied catch, and
  // the delivery reads as broken for a reason nothing here is testing.
  logOrgActivity: async () => undefined,
  notifyStaff: async () => undefined,
  sendGa4Purchase: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  sendGa4Refund: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  sendGa4SubscriptionCancelled: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  // Captured, not stubbed — the OTHER half.
  writeOrgBilling: async (orgId: string, patch: unknown) => {
    mockBillingWrites.push({ orgId, patch })
  },
  updateExisting: async () => true,
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

function signed(body: unknown, secret = 'whsec_fake') {
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
  process.env = { ...CLEAN_ENV, ...BASE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

/**
 * The subscription object off the REAL `customer.subscription.deleted` the
 * test-clock drill produced (`sub_1U6GjZ…`, evt_1U6GmI…), reduced to the
 * fields this route reads. `cancellation_details` is verbatim.
 */
function deletedSubscription(
  cancellationDetails: Record<string, unknown> | undefined,
) {
  return {
    id: 'sub_drill',
    object: 'subscription',
    customer: 'cus_drill',
    status: 'canceled',
    created: 1_787_173_753,
    canceled_at: 1_794_265_590,
    ended_at: 1_794_265_590,
    current_period_end: 1_792_444_153,
    metadata: { orgId: 'org-real', plan: 'starter' },
    ...(cancellationDetails ? { cancellation_details: cancellationDetails } : {}),
    items: {
      data: [
        {
          id: 'si_plan',
          price: {
            id: 'price_starter_monthly',
            recurring: { interval: 'month' },
            unit_amount: 2500,
          },
        },
      ],
    },
  }
}

function event(object: Record<string, unknown>, type: string) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: { object },
  }
}

/** The `subscription` patch the route handed `writeOrgBilling`. */
function lastSubscriptionPatch(): Record<string, unknown> | undefined {
  return mockBillingWrites.at(-1)?.patch?.subscription
}

describe('the webhook records WHY a subscription ended (AGL-1877)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', {
      name: 'Acme Ltd',
      slug: 'acme',
      plan: 'starter',
    })
    mockNotifications.length = 0
    mockBillingWrites.length = 0
    mockAfterScheduled.length = 0
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    })) as never
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('mirrors payment_failed onto the billing doc', async () => {
    const post = loadWebhook()
    const response = await post(
      signed(
        event(
          deletedSubscription({
            reason: 'payment_failed',
            comment: null,
            feedback: null,
            feedback_option: null,
          }),
          'customer.subscription.deleted',
        ),
      ),
    )
    expect(response.status).toBe(200)
    expect(lastSubscriptionPatch()?.['status']).toBe('canceled')
    expect(lastSubscriptionPatch()?.['canceledReason']).toBe('payment_failed')
  })

  it('mirrors a VOLUNTARY cancellation as its own reason — the control', async () => {
    const post = loadWebhook()
    await post(
      signed(
        event(
          deletedSubscription({ reason: 'cancellation_requested' }),
          'customer.subscription.deleted',
        ),
      ),
    )
    expect(lastSubscriptionPatch()?.['canceledReason']).toBe(
      'cancellation_requested',
    )
  })

  it('records null when Stripe states no reason — never a guess', async () => {
    const post = loadWebhook()
    await post(
      signed(event(deletedSubscription(undefined), 'customer.subscription.deleted')),
    )
    expect(lastSubscriptionPatch()?.['canceledReason']).toBeNull()
  })

  it('CONVERGES on a live subscription, so a resubscribe clears the reason', async () => {
    // `writeOrgBilling` merge-sets. A stale `'payment_failed'` surviving a new
    // subscription would make the auto-lock predicate read a paying customer
    // as delinquent and suspend them — which is why this is written
    // explicitly rather than simply omitted on the non-cancel path.
    const post = loadWebhook()
    const live = {
      ...deletedSubscription({ reason: 'payment_failed' }),
      status: 'active',
    }
    await post(signed(event(live, 'customer.subscription.updated')))
    expect(lastSubscriptionPatch()?.['status']).toBe('active')
    expect(lastSubscriptionPatch()?.['canceledReason']).toBeNull()
  })

  it('TELLS the workspace when Stripe gave up — and links them to Billing', async () => {
    const post = loadWebhook()
    await post(
      signed(
        event(
          deletedSubscription({ reason: 'payment_failed' }),
          'customer.subscription.deleted',
        ),
      ),
    )
    const told = mockNotifications.filter(
      (notification) => notification.type === 'billing.subscriptionCanceled',
    )
    expect(told).toHaveLength(1)
    expect(told[0].orgId).toBe('org-real')
    expect(told[0].title).toMatch(/payment/i)
    // The org's own slug, not the fallback — the banner they would have used
    // to fix this is the thing that just disappeared.
    expect(told[0].link).toBe('/acme/billing')
    // Scheduled through `after()`, like every other notification on this
    // route: revert it to a bare `void promise` and this is empty.
    expect(mockAfterScheduled.length).toBeGreaterThan(0)
  })

  it('does NOT tell a workspace that cancelled on purpose — the control', async () => {
    const post = loadWebhook()
    await post(
      signed(
        event(
          deletedSubscription({ reason: 'cancellation_requested' }),
          'customer.subscription.deleted',
        ),
      ),
    )
    expect(
      mockNotifications.filter(
        (notification) => notification.type === 'billing.subscriptionCanceled',
      ),
    ).toHaveLength(0)
  })

  it('does NOT tell a workspace whose reason is unknown — fails closed', async () => {
    const post = loadWebhook()
    await post(
      signed(event(deletedSubscription(undefined), 'customer.subscription.deleted')),
    )
    expect(
      mockNotifications.filter(
        (notification) => notification.type === 'billing.subscriptionCanceled',
      ),
    ).toHaveLength(0)
  })
})

describe('the billing auto-lock has a reachable true branch (AGL-1877)', () => {
  /** The failed renewal's period end, from the drill. */
  const PERIOD_END_SECONDS = 1_792_444_153
  const DAY_MS = 24 * 60 * 60 * 1000
  const at = (days: number) => PERIOD_END_SECONDS * 1000 + days * DAY_MS

  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * Measured: Stripe cancels at day 21.08. The grace is 30 days. So on the
   * only status set the predicate used to accept, the org has left that set
   * NINE DAYS before the clock it is waiting on runs out — for every org,
   * always. Arithmetic, not a fixture.
   *
   * The day count used to be a `21.08` literal written out here, which was a
   * seventh copy of a number whose entire problem was being copied (AGL-2430).
   * It now comes from the module that owns it, tagged with its mode — and
   * from BOTH modes, because this console renders against the LIVE account
   * while every number behind the drill above came off a TEST clock. If the
   * two ever diverge, this is the assertion that has to be re-argued rather
   * than the one that quietly keeps passing on the wrong mode's figure.
   */
  it('the dunning cancellation lands INSIDE the grace window it must survive', () => {
    expect(TEST_MODE_DUNNING_SCHEDULE.cancelsAfterDays).toBeLessThan(
      BILLING_LOCK_GRACE_DAYS,
    )

    // The mode that actually bills customers. Recorded from the live
    // Dashboard on 2026-08-24; `null` would mean nobody has read it, which
    // must fail loudly rather than skip.
    expect(LIVE_MODE_DUNNING_SCHEDULE).not.toBeNull()
    expect(LIVE_MODE_DUNNING_SCHEDULE?.cancelsAfterDays).toBeLessThan(
      BILLING_LOCK_GRACE_DAYS,
    )

    // And the terminal state the auto-lock's reachable branch is predicated
    // on. If live is ever reconfigured to *mark unpaid*, the `canceled` +
    // `payment_failed` clause below becomes dead code and the `unpaid`
    // branch becomes primary — so this is the tripwire for that swap.
    expect(LIVE_MODE_DUNNING_SCHEDULE?.terminalStatus).toBe('canceled')
  })

  it('locks an org Stripe cancelled for non-payment, once the grace expires', () => {
    expect(
      shouldAutoLockOrgForBilling(
        {},
        {
          status: 'canceled',
          canceledReason: 'payment_failed',
          currentPeriodEnd: { seconds: PERIOD_END_SECONDS },
        },
        at(BILLING_LOCK_GRACE_DAYS + 1),
      ),
    ).toBe(true)
  })

  it('does NOT lock it before the grace expires', () => {
    expect(
      shouldAutoLockOrgForBilling(
        {},
        {
          status: 'canceled',
          canceledReason: 'payment_failed',
          currentPeriodEnd: { seconds: PERIOD_END_SECONDS },
        },
        at(BILLING_LOCK_GRACE_DAYS - 1),
      ),
    ).toBe(false)
  })

  it('never locks a VOLUNTARY cancellation, however old — the control', () => {
    expect(
      shouldAutoLockOrgForBilling(
        {},
        {
          status: 'canceled',
          canceledReason: 'cancellation_requested',
          currentPeriodEnd: { seconds: PERIOD_END_SECONDS },
        },
        at(400),
      ),
    ).toBe(false)
  })

  it('never locks a cancellation with no recorded reason — fails closed', () => {
    // Every org whose subscription ended before the mirror shipped.
    for (const canceledReason of [undefined, null, '']) {
      expect(
        shouldAutoLockOrgForBilling(
          {},
          {
            status: 'canceled',
            canceledReason,
            currentPeriodEnd: { seconds: PERIOD_END_SECONDS },
          },
          at(400),
        ),
      ).toBe(false)
    }
  })

  it('never locks off the bare billingStatus mirror, which carries no reason', () => {
    // `orgs/{id}.billingStatus` is a status STRING. An org known only through
    // it can never prove a payment failure, and must not be locked on a guess.
    expect(
      shouldAutoLockOrgForBilling({ billingStatus: 'canceled' }, null, at(400)),
    ).toBe(false)
  })

  it('still locks the classic past_due / unpaid shapes', () => {
    for (const status of ['past_due', 'unpaid']) {
      expect(
        shouldAutoLockOrgForBilling(
          {},
          { status, currentPeriodEnd: { seconds: PERIOD_END_SECONDS } },
          at(BILLING_LOCK_GRACE_DAYS + 1),
        ),
      ).toBe(true)
    }
  })

  it('never locks an already-suspended org, whatever the reason', () => {
    expect(
      shouldAutoLockOrgForBilling(
        { suspendedAt: 1 },
        {
          status: 'canceled',
          canceledReason: 'payment_failed',
          currentPeriodEnd: { seconds: PERIOD_END_SECONDS },
        },
        at(400),
      ),
    ).toBe(false)
  })

  it('never locks without a period end — the grace clock has no start', () => {
    expect(
      shouldAutoLockOrgForBilling(
        {},
        { status: 'canceled', canceledReason: 'payment_failed' },
        at(400),
      ),
    ).toBe(false)
  })
})
