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
 * Downgrades are END-OF-CYCLE, upgrades are instant (AGL-1862 / AGL-1859).
 *
 * The asymmetry this file pins: a switch DOWN the self-serve ladder must
 * never re-price the live subscription — that issues a proration credit and
 * walks paid revenue back out the door. It goes onto a Stripe subscription
 * schedule whose second phase flips the items at the current period end,
 * with `metadata[plan]` on the phase so the webhook mirror learns the new
 * plan when it happens. A switch UP stays exactly what it was: an immediate
 * update with prorations — and it releases any pending downgrade schedule
 * first, or the schedule would re-flip the price at period end.
 *
 * No live Stripe call happens here: `fetch` is mocked per-endpoint and the
 * captured bodies are the assertion surface.
 */

// A module, not a script — without this the const declarations below collide
// with the other billing route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockOrgGet = jest.fn()
const mockWriteOrgBilling = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({ doc: () => ({ get: () => mockOrgGet() }) }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  writeOrgBilling: (...args: unknown[]) => mockWriteOrgBilling(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL predicate, not a re-typed triple (AGL-1715).
  isLiveSubscriptionStatus: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isLiveSubscriptionStatus,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  isCustomPricedPlan: (plan: string) => plan === 'enterprise',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json(),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      origin: 'https://app.aglyn.com',
      host: 'app.aglyn.com',
    },
  }),
  // The REAL ladder (AGL-1862): a hand-shuffled copy here would let the
  // route's up/down answer drift from the one the product sells.
  SELF_SERVE_PLANS: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
    .SELF_SERVE_PLANS,
  PLAN_PRICING: {},
  POS_REGISTER_ADDON_MONTHLY_USD: 89,
  EVENT_CALENDAR_ADDON_MONTHLY_USD: 9,
}))

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

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_PRO: 'price_pro_monthly',
  STRIPE_PRICE_METERED: 'price_metered_usage',
}

/** 2026-01-01T00:00:00Z — the subscription's current period end. */
const PERIOD_END = 1767225600

/** The subscription the mocked Stripe returns; tests override these. */
let subscriptionItems: any[] = []
let subscriptionSchedule: string | null = null
let capturedSubUpdateBody: URLSearchParams | null = null
let capturedScheduleCreateBody: URLSearchParams | null = null
let capturedScheduleUpdateBody: URLSearchParams | null = null
let releasedScheduleIds: string[] = []
let previewRequested = false

function loadSubscription() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/subscription/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function call(
  post: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
) {
  return post(
    new Request('https://app.aglyn.com/api/billing/subscription', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )
}

const PRO_ITEM = {
  id: 'si_plan',
  quantity: 1,
  price: { id: 'price_pro_monthly', recurring: { interval: 'month' } },
}
const STARTER_ITEM = {
  id: 'si_plan',
  quantity: 1,
  price: { id: 'price_starter_monthly', recurring: { interval: 'month' } },
}
const METERED_ITEM = {
  id: 'si_metered',
  price: { id: 'price_metered_usage', recurring: { interval: 'month' } },
}

beforeEach(() => {
  subscriptionItems = [PRO_ITEM, METERED_ITEM]
  subscriptionSchedule = null
  capturedSubUpdateBody = null
  capturedScheduleCreateBody = null
  capturedScheduleUpdateBody = null
  releasedScheduleIds = []
  previewRequested = false
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockOrgGet.mockResolvedValue({
    // `org.get('slug')` and `org.get('plan')` both route through this.
    get: (field: string) => (field === 'plan' ? 'pro' : 'acme'),
    ref: { id: 'org-1', set: async () => undefined },
  })
  mockWriteOrgBilling.mockResolvedValue(undefined)
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            current_period_end: PERIOD_END,
            currency: 'usd',
            schedule: subscriptionSchedule,
            items: { data: subscriptionItems },
          },
        ],
      }
    } else if (/subscription_schedules\/([^/?]+)\/release/.test(href)) {
      releasedScheduleIds.push(
        String(href.match(/subscription_schedules\/([^/?]+)\/release/)?.[1]),
      )
      payload = { id: 'released', status: 'released' }
    } else if (href.includes('/subscription_schedules/sub_sched_new')) {
      capturedScheduleUpdateBody = new URLSearchParams(String(init?.body ?? ''))
      payload = { id: 'sub_sched_new', status: 'active' }
    } else if (href.endsWith('/subscription_schedules')) {
      capturedScheduleCreateBody = new URLSearchParams(String(init?.body ?? ''))
      payload = {
        id: 'sub_sched_new',
        phases: [
          {
            start_date: PERIOD_END - 2592000,
            end_date: PERIOD_END,
            items: subscriptionItems.map((item: any) => ({
              price: item.price.id,
              ...(item.quantity != null ? { quantity: item.quantity } : {}),
            })),
          },
        ],
      }
    } else if (href.includes('/subscriptions/sub_1')) {
      capturedSubUpdateBody = new URLSearchParams(String(init?.body ?? ''))
      payload = {
        status: 'active',
        cancel_at_period_end:
          capturedSubUpdateBody.get('cancel_at_period_end') === 'true',
        items: { data: [] },
      }
    } else if (href.includes('/invoices/upcoming')) {
      previewRequested = true
      payload = { amount_due: -1234, currency: 'usd', lines: { data: [] } }
    } else {
      throw new Error(`unexpected fetch: ${href}`)
    }
    return { ok: true, json: async () => payload }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

/** The last billing-doc patch's `subscription` field. */
function lastBillingPatch(): any {
  const calls = mockWriteOrgBilling.mock.calls
  return calls[calls.length - 1]?.[1]?.subscription
}

describe('a downgrade waits for the period end (AGL-1862)', () => {
  it('schedules the switch instead of re-pricing the subscription', async () => {
    const post = loadSubscription()
    const response = await call(post, {
      action: 'switch',
      plan: 'starter',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    const payload = await response.json()

    // The live subscription was NOT updated — no proration credit exists.
    expect(capturedSubUpdateBody).toBeNull()

    // A schedule was created from the subscription and given two phases.
    expect(capturedScheduleCreateBody?.get('from_subscription')).toBe('sub_1')
    const update = capturedScheduleUpdateBody
    expect(update?.get('end_behavior')).toBe('release')
    expect(update?.get('proration_behavior')).toBe('none')
    // Phase 0 restates the CURRENT paid items over the current window.
    expect(update?.get('phases[0][items][0][price]')).toBe('price_pro_monthly')
    expect(update?.get('phases[0][end_date]')).toBe(String(PERIOD_END))
    // Phase 1 is the target plan, with the metadata the webhook mirror
    // reads when the flip happens — without it the org doc keeps the old
    // plan forever.
    expect(update?.get('phases[1][items][0][price]')).toBe(
      'price_starter_monthly',
    )
    expect(update?.get('phases[1][metadata][plan]')).toBe('starter')
    expect(update?.get('phases[1][automatic_tax][enabled]')).toBe('true')
    // The metered usage item survives the flip (AGL-635/1340).
    expect(update?.get('phases[1][items][1][price]')).toBe(
      'price_metered_usage',
    )

    // The response says scheduled, not switched.
    expect(payload.scheduled).toBe(true)
    expect(payload.pendingPlan).toBe('starter')
    expect(payload.effectiveAt).toBe(
      new Date(PERIOD_END * 1000).toISOString(),
    )

    // The mirror carries the pending marker; the org's plan does not move.
    expect(lastBillingPatch()?.pendingDowngrade).toMatchObject({
      plan: 'starter',
      scheduleId: 'sub_sched_new',
    })
  })

  it('previews a downgrade as $0 today — never the proration credit', async () => {
    const post = loadSubscription()
    const response = await call(post, {
      action: 'preview',
      plan: 'starter',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.amountDueCents).toBe(0)
    expect(payload.downgrade).toBe(true)
    expect(payload.periodEnd).toBe(new Date(PERIOD_END * 1000).toISOString())
    // The upcoming-invoice preview (which would quote the credit) was
    // never consulted.
    expect(previewRequested).toBe(false)
  })

  it('an UPGRADE stays instant and releases a pending downgrade first', async () => {
    subscriptionItems = [STARTER_ITEM, METERED_ITEM]
    subscriptionSchedule = 'sub_sched_old'
    const post = loadSubscription()
    const response = await call(post, {
      action: 'switch',
      plan: 'pro',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    // The old schedule was released, THEN the subscription re-priced today.
    expect(releasedScheduleIds).toEqual(['sub_sched_old'])
    expect(capturedSubUpdateBody?.get('items[0][price]')).toBe(
      'price_pro_monthly',
    )
    expect(capturedSubUpdateBody?.get('proration_behavior')).toBe(
      'create_prorations',
    )
    expect(capturedScheduleCreateBody).toBeNull()
    // The mirror clears the pending marker alongside the new price.
    expect(lastBillingPatch()?.pendingDowngrade).toBeNull()
  })

  it('switching to the CURRENT plan is "keep my plan" — release only', async () => {
    subscriptionSchedule = 'sub_sched_old'
    const post = loadSubscription()
    const response = await call(post, {
      action: 'switch',
      plan: 'pro',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.releasedPendingDowngrade).toBe(true)
    expect(releasedScheduleIds).toEqual(['sub_sched_old'])
    // Nothing was re-priced and no new schedule appeared.
    expect(capturedSubUpdateBody).toBeNull()
    expect(capturedScheduleCreateBody).toBeNull()
    expect(lastBillingPatch()?.pendingDowngrade).toBeNull()
  })

  it('cancel releases a pending downgrade — the two must not race', async () => {
    subscriptionSchedule = 'sub_sched_old'
    const post = loadSubscription()
    const response = await call(post, { action: 'cancel' })
    expect(response.status).toBe(200)
    expect(releasedScheduleIds).toEqual(['sub_sched_old'])
    expect(capturedSubUpdateBody?.get('cancel_at_period_end')).toBe('true')
    expect(lastBillingPatch()?.pendingDowngrade).toBeNull()
  })
})
