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
 * The metered item must reach subscriptions our routes did not build
 * (AGL-1352) — and must NOT reach them at a moment that retroactively bills a
 * period.
 *
 * No live Stripe call happens in this file: `fetch` is mocked and the captured
 * requests are the assertion surface. The webhook half is driven through a
 * REAL signed payload, because "the helper exists" and "the helper is wired"
 * are different claims and only the second one is worth anything.
 */

import { createHmac } from 'node:crypto'

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
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_yearly',
  STRIPE_PRICE_METERED: 'price_metered_usage',
  STRIPE_PRICE_METERED_YEARLY: 'price_metered_usage_yearly',
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL predicate, not a re-typed triple (AGL-1715). A hand-written mock
  // of a single-source list is the drift this guard exists to prevent: the
  // spec would keep passing while the route's real answer changed.
  isLiveSubscriptionStatus: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isLiveSubscriptionStatus,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  runBillingWebhookHandlers: async () => undefined,
  // Read by utils/server/billing-addons. The real ladder, so `PAID_PLANS`
  // derives the same set it does in production.
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

const mockWriteOrgBilling = jest.fn()
const mockOrgUpdate = jest.fn()

/**
 * The org EXISTS here, and the fake says so.
 *
 * Before AGL-1763 the route never asked, so `get()` could return a snapshot
 * with no `exists` at all and every test above still ran. It asks now — the
 * merge-set that used to mint `orgs/{orgId}` from unchecked webhook metadata is
 * an `updateExisting`, which needs a document to update. A fake that stayed
 * silent on existence would report this file's subject (the back-fill) as
 * broken for a reason that has nothing to do with it, so existence is modelled
 * rather than stubbed around: `update()` resolves for the seeded org and would
 * reject for any other id.
 */
const mockUpdateExisting = jest.requireActual(
  '../../../libs/tenant/data/admin/src/lib/server/update-existing',
).updateExisting

jest.mock('@aglyn/tenant-data-admin', () => {
  const doc = (id: string) => ({
    create: async () => undefined,
    get: async () => ({
      exists: id === 'org-1',
      get: () => undefined,
      ref: { id },
    }),
    set: async () => undefined,
    update: async (...args: unknown[]) => {
      if (id !== 'org-1') {
        const error: Error & { code?: number } = new Error('5 NOT_FOUND')
        error.code = 5
        throw error
      }
      return mockOrgUpdate(...args)
    },
    delete: async () => undefined,
    ref: { id },
  })
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({ doc, add: async () => ({ id: 'audit-1' }) }),
        }),
      }),
      firestore: {
        FieldValue: {
          delete: () => '__delete__',
          serverTimestamp: () => '__now__',
        },
      },
    },
    findOrgIdByStripeCustomer: async () => null,
    notifyOrgAdmins: async () => undefined,
    writeOrgBilling: async (...args: unknown[]) => mockWriteOrgBilling(...args),
    updateExisting: (...args: unknown[]) => mockUpdateExisting(...args),
  }
})

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

const PLAN_ITEM_MONTHLY = {
  id: 'si_plan',
  price: {
    id: 'price_starter_monthly',
    recurring: { interval: 'month' },
    unit_amount: 2500,
  },
}
const PLAN_ITEM_YEARLY = {
  id: 'si_plan',
  price: {
    id: 'price_starter_yearly',
    recurring: { interval: 'year' },
    unit_amount: 19200,
  },
}
const METERED_ITEM_MONTHLY = {
  id: 'si_metered',
  price: { id: 'price_metered_usage', recurring: { interval: 'month' } },
}

const HOUR = 60 * 60

function loadDecision(env: Record<string, string> = {}) {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...BASE_ENV, ...env } as NodeJS.ProcessEnv
  return require('../utils/server/metered-backfill')
}

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('the back-fill decision (AGL-1352)', () => {
  const nowSeconds = 1_770_000_000
  const now = nowSeconds * 1000

  const base = {
    items: [PLAN_ITEM_MONTHLY],
    plan: 'starter',
    status: 'active',
    canceled: false,
    currentPeriodStart: nowSeconds - 1 * HOUR,
    now,
  }

  it('attaches the interval-matched price at a fresh period boundary', () => {
    const { meteredBackfillDecision } = loadDecision()
    const monthly = meteredBackfillDecision(base)
    expect(monthly).toMatchObject({
      attach: true,
      priceId: 'price_metered_usage',
      interval: 'month',
      reason: 'attach',
    })
    const yearly = meteredBackfillDecision({ ...base, items: [PLAN_ITEM_YEARLY] })
    expect(yearly).toMatchObject({
      attach: true,
      priceId: 'price_metered_usage_yearly',
      interval: 'year',
    })
  })

  it('NEVER hands a monthly metered price to an annual subscription', () => {
    // Stripe rejects mixed `recurring.interval` outright, so this is the one
    // assertion that has to survive any refactor — asserted as an absence
    // rather than trusted to the branch above.
    const { meteredBackfillDecision } = loadDecision()
    for (const env of [{}, { STRIPE_PRICE_METERED_YEARLY: '' }]) {
      const { meteredBackfillDecision: decide } = loadDecision(env as never)
      const decision = decide({ ...base, items: [PLAN_ITEM_YEARLY] })
      expect(decision.priceId).not.toBe('price_metered_usage')
    }
    expect(meteredBackfillDecision).toBeDefined()
  })

  it('reads the interval off the PLAN item, not items[0]', () => {
    // The metered/add-on items are not the plan. Reading the interval off one
    // is how an annual subscription gets handed a monthly price.
    const { meteredBackfillDecision } = loadDecision()
    const addonFirst = [
      {
        id: 'si_seat',
        price: {
          id: 'price_starter_extra_seat_yearly',
          recurring: { interval: 'year' },
        },
      },
      PLAN_ITEM_YEARLY,
    ]
    expect(meteredBackfillDecision({ ...base, items: addonFirst })).toMatchObject({
      interval: 'year',
      priceId: 'price_metered_usage_yearly',
    })
  })

  // ── The negative controls ───────────────────────────────────────────────
  it('does NOT attach mid-period (the retroactive-billing guard)', () => {
    const { meteredBackfillDecision } = loadDecision()
    const decision = meteredBackfillDecision({
      ...base,
      currentPeriodStart: nowSeconds - 20 * 24 * HOUR,
    })
    expect(decision).toMatchObject({ attach: false, reason: 'mid-period' })
    expect(decision.priceId).toBeNull()
  })

  it('does attach mid-period when explicitly configured to', () => {
    const { meteredBackfillDecision } = loadDecision({
      STRIPE_METERED_BACKFILL: 'immediate',
    })
    expect(
      meteredBackfillDecision({
        ...base,
        currentPeriodStart: nowSeconds - 20 * 24 * HOUR,
      }),
    ).toMatchObject({ attach: true, reason: 'attach' })
  })

  it('attaches nothing at all when switched off', () => {
    const { meteredBackfillDecision } = loadDecision({
      STRIPE_METERED_BACKFILL: 'off',
    })
    expect(meteredBackfillDecision(base)).toMatchObject({
      attach: false,
      reason: 'disabled',
    })
  })

  it('skips a subscription that already meters', () => {
    const { meteredBackfillDecision } = loadDecision()
    expect(
      meteredBackfillDecision({
        ...base,
        items: [PLAN_ITEM_MONTHLY, METERED_ITEM_MONTHLY],
      }),
    ).toMatchObject({ attach: false, reason: 'already-metered' })
  })

  it('skips free, enterprise, canceled and non-billable subscriptions', () => {
    const { meteredBackfillDecision } = loadDecision()
    expect(meteredBackfillDecision({ ...base, plan: 'free' })).toMatchObject({
      attach: false,
      reason: 'not-a-paid-plan',
    })
    // An enterprise deal bills on a negotiated ad-hoc price and neither other
    // path meters it; adding usage billing to a signed contract is not a fix.
    expect(meteredBackfillDecision({ ...base, plan: 'enterprise' })).toMatchObject({
      attach: false,
      reason: 'not-a-paid-plan',
    })
    expect(meteredBackfillDecision({ ...base, canceled: true })).toMatchObject({
      attach: false,
      reason: 'not-billable',
    })
    expect(
      meteredBackfillDecision({ ...base, status: 'incomplete_expired' }),
    ).toMatchObject({ attach: false, reason: 'not-billable' })
  })

  it('warns only when the configuration is ASYMMETRIC', () => {
    const onlyMonthly = loadDecision({ STRIPE_PRICE_METERED_YEARLY: '' })
    const asymmetric = onlyMonthly.meteredBackfillDecision({
      ...base,
      items: [PLAN_ITEM_YEARLY],
    })
    expect(asymmetric.reason).toBe('no-metered-price')
    expect(asymmetric.warning).toContain('STRIPE_PRICE_METERED_YEARLY')

    // Both unset is Stripe simply unprovisioned — a deliberate configuration,
    // not a fault. Warning on it would train everyone to ignore the warning.
    const neither = loadDecision({
      STRIPE_PRICE_METERED: '',
      STRIPE_PRICE_METERED_YEARLY: '',
    })
    const quiet = neither.meteredBackfillDecision(base)
    expect(quiet.reason).toBe('no-metered-price')
    expect(quiet.warning).toBeUndefined()
  })
})

describe('the back-fill Stripe write (AGL-1352)', () => {
  it('re-reads, then adds ONE item with no quantity and no proration', async () => {
    const { backfillMeteredItem } = loadDecision()
    const calls: Array<{ url: string; init: any }> = []
    global.fetch = jest.fn(async (url: unknown, init: any) => {
      calls.push({ url: String(url), init })
      if (!init || init.method !== 'POST') {
        return {
          ok: true,
          json: async () => ({ items: { data: [PLAN_ITEM_MONTHLY] } }),
        }
      }
      return { ok: true, json: async () => ({ id: 'si_new' }) }
    }) as never

    const attached = await backfillMeteredItem({
      secretKey: 'sk_test_fake',
      subscriptionId: 'sub_123',
      priceId: 'price_metered_usage',
      orgId: 'org-1',
    })
    expect(attached).toBe(true)
    expect(calls).toHaveLength(2)
    // 1. the re-read
    expect(calls[0].url).toContain('/v1/subscriptions/sub_123')
    // 2. the attach
    expect(calls[1].url).toContain('/v1/subscription_items')
    const body = new URLSearchParams(String(calls[1].init.body))
    expect(body.get('subscription')).toBe('sub_123')
    expect(body.get('price')).toBe('price_metered_usage')
    expect(body.get('proration_behavior')).toBe('none')
    // A metered price carries no quantity — Stripe rejects one.
    expect(body.get('quantity')).toBeNull()
    // Keyed on the SUBSCRIPTION, because duplicate ITEMS are what cost money.
    expect(calls[1].init.headers['Idempotency-Key']).toContain('sub_123')
    expect(calls[1].init.headers['Idempotency-Key']).toContain(
      'price_metered_usage',
    )
  })

  it('does NOT write when the re-read shows the item already there', async () => {
    // The event payload is the subscription as of the event, and two
    // deliveries can be in flight at once. Trusting it is how a subscription
    // ends up with two metered items and bills its usage twice.
    const { backfillMeteredItem } = loadDecision()
    const posts: string[] = []
    global.fetch = jest.fn(async (url: unknown, init: any) => {
      if (init?.method === 'POST') {
        posts.push(String(url))
        return { ok: true, json: async () => ({ id: 'si_new' }) }
      }
      return {
        ok: true,
        json: async () => ({
          items: { data: [PLAN_ITEM_MONTHLY, METERED_ITEM_MONTHLY] },
        }),
      }
    }) as never

    const attached = await backfillMeteredItem({
      secretKey: 'sk_test_fake',
      subscriptionId: 'sub_123',
      priceId: 'price_metered_usage',
    })
    expect(attached).toBe(false)
    expect(posts).toHaveLength(0)
  })

  it('never throws — a webhook must not 500 over this', async () => {
    const { backfillMeteredItem } = loadDecision()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    global.fetch = jest.fn(async () => {
      throw new Error('network down')
    }) as never
    await expect(
      backfillMeteredItem({
        secretKey: 'sk_test_fake',
        subscriptionId: 'sub_123',
        priceId: 'price_metered_usage',
      }),
    ).resolves.toBe(false)
  })
})

// ── Is it WIRED? ──────────────────────────────────────────────────────────
describe('the webhook actually performs the back-fill (AGL-1352)', () => {
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

  function subscriptionEvent(overrides: Record<string, unknown> = {}) {
    return {
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_portal',
          status: 'active',
          customer: 'cus_1',
          metadata: { orgId: 'org-1', plan: 'starter' },
          items: { data: [PLAN_ITEM_MONTHLY] },
          current_period_start: Math.floor(Date.now() / 1000) - HOUR,
          current_period_end: Math.floor(Date.now() / 1000) + 20 * 24 * HOUR,
          ...overrides,
        },
      },
    }
  }

  function loadWebhook(env: Record<string, string> = {}) {
    jest.resetModules()
    process.env = { ...CLEAN_ENV, ...BASE_ENV, ...env } as NodeJS.ProcessEnv
    return require('../app/api/billing/webhook/route').POST as (
      request: Request,
    ) => Promise<Response>
  }

  /** Captures the subscription_items POSTs the route makes. */
  function captureStripe() {
    const attaches: URLSearchParams[] = []
    global.fetch = jest.fn(async (url: unknown, init: any) => {
      const href = String(url)
      if (href.includes('/v1/subscription_items') && init?.method === 'POST') {
        attaches.push(new URLSearchParams(String(init.body)))
        return { ok: true, json: async () => ({ id: 'si_new' }) }
      }
      if (href.includes('/v1/subscriptions/')) {
        return {
          ok: true,
          json: async () => ({ items: { data: [PLAN_ITEM_MONTHLY] } }),
        }
      }
      // customer-identity stamping and anything else
      return { ok: true, json: async () => ({}) }
    }) as never
    return attaches
  }

  beforeEach(() => {
    mockWriteOrgBilling.mockReset()
    mockOrgUpdate.mockReset()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('attaches the metered item for a portal plan change at a boundary', async () => {
    const post = loadWebhook()
    const attaches = captureStripe()
    const response = await post(signed(subscriptionEvent()))
    expect(response.status).toBe(200)
    expect(attaches).toHaveLength(1)
    expect(attaches[0].get('subscription')).toBe('sub_portal')
    expect(attaches[0].get('price')).toBe('price_metered_usage')
  })

  it('NEGATIVE CONTROL: attaches nothing mid-period', async () => {
    const post = loadWebhook()
    const attaches = captureStripe()
    const response = await post(
      signed(
        subscriptionEvent({
          current_period_start: Math.floor(Date.now() / 1000) - 20 * 24 * HOUR,
        }),
      ),
    )
    expect(response.status).toBe(200)
    expect(attaches).toHaveLength(0)
  })

  it('NEGATIVE CONTROL: attaches nothing to a cancellation', async () => {
    const post = loadWebhook()
    const attaches = captureStripe()
    const event = subscriptionEvent()
    event.type = 'customer.subscription.deleted'
    const response = await post(signed(event))
    expect(response.status).toBe(200)
    expect(attaches).toHaveLength(0)
  })

  it('NEGATIVE CONTROL: attaches nothing when the item is already there', async () => {
    const post = loadWebhook()
    const attaches = captureStripe()
    const response = await post(
      signed(
        subscriptionEvent({
          items: { data: [PLAN_ITEM_MONTHLY, METERED_ITEM_MONTHLY] },
        }),
      ),
    )
    expect(response.status).toBe(200)
    expect(attaches).toHaveLength(0)
  })

  it('still mirrors the plan when the Stripe attach fails', async () => {
    // Best-effort by contract: a 500 here would make Stripe redeliver the
    // whole event and re-apply every mirror for nothing.
    const post = loadWebhook()
    global.fetch = jest.fn(async (url: unknown) => {
      if (String(url).includes('/v1/subscription_items')) {
        return { ok: false, json: async () => ({ error: { message: 'nope' } }) }
      }
      if (String(url).includes('/v1/subscriptions/')) {
        return {
          ok: true,
          json: async () => ({ items: { data: [PLAN_ITEM_MONTHLY] } }),
        }
      }
      return { ok: true, json: async () => ({}) }
    }) as never
    const response = await post(signed(subscriptionEvent()))
    expect(response.status).toBe(200)
    expect(mockWriteOrgBilling).toHaveBeenCalled()
  })
})
