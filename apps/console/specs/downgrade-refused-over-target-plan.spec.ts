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
 * A DOWNGRADE IS AN ADD-ON REDUCTION ONE LEVEL UP.
 *
 * `/api/billing/addons` refuses shrinking a purchase below what its capacity
 * is carrying. A plan change moves the same capacity by moving what the plan
 * includes, so "buy Pro, make eight datasets, drop to Starter, keep the eight"
 * was the identical leak through a different door — and the only thing
 * standing in it was a warning list rendered on the way past.
 *
 * Nothing is revoked here and nothing may be: the org keeps every site,
 * dataset and teammate. What waits is the PLAN CHANGE, and the refusal says
 * exactly what to release, because a refusal that does not name a number is a
 * support ticket.
 *
 * Assertions are on the refusal, the numbers in it, and the Stripe traffic —
 * never on rendered output. No live Stripe call happens: `fetch` is mocked.
 */

export {}

const mockOrgDoc: Record<string, unknown> = { plan: 'pro' }

/** What the org HOLDS. `null` makes that count throw (unreadable). */
let mockSiteCount: number | null = 0
let mockDatasetCount: number | null = 0
let mockMembers: unknown[] = []

function mockAnswerCount(value: number | null) {
  return {
    get: async () => {
      if (value == null) throw new Error('unreadable')
      return { data: () => ({ count: value }) }
    },
  }
}

const mockOrgRef = {
  get: async () => ({
    data: () => mockOrgDoc,
    get: (field: string) => (field === 'plan' ? 'pro' : 'acme'),
    ref: { id: 'org-1', set: async () => undefined },
  }),
  collection: (name: string) => ({
    count: () => mockAnswerCount(name === 'datasets' ? mockDatasetCount : 0),
    where: () => ({ get: async () => ({ docs: [] }) }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'u-1', email_verified: true }),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => mockOrgRef,
          where: () => ({ count: () => mockAnswerCount(mockSiteCount) }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  writeOrgBilling: async () => undefined,
  listOrgMembers: async () => mockMembers,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan model and the REAL ladder. A stubbed entitlement table here
  // would answer 0 for every included count, which reads as "the target plan
  // includes nothing" and would refuse every downgrade — the loudest possible
  // way to pass for the wrong reason.
  ...jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements'),
  // The REAL manager-seat counter: it is what knows a site-scoped
  // collaborator is not a manager seat.
  countManagerSeats: jest.requireActual('@aglyn/aglyn/app-utils/organizations')
    .countManagerSeats,
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
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
const ORIGINAL_FETCH = global.fetch

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_PRO: 'price_pro_monthly',
  STRIPE_PRICE_METERED: 'price_metered_usage',
}

/** 2026-01-01T00:00:00Z — the subscription's current period end. */
const PERIOD_END = 1767225600

let mockStripeCalls: string[] = []
/** The plan price on the subscription, which is what decides up vs down. */
let subscriptionPlanPrice = 'price_pro_monthly'

function loadSubscription() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/subscription/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function call(body: Record<string, unknown>) {
  return loadSubscription()(
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

/** Everything but the unavoidable "which subscription is this" lookup. */
function billingCalls() {
  return mockStripeCalls.filter(
    (href) => !href.includes('/subscriptions?customer='),
  )
}

beforeEach(() => {
  mockStripeCalls = []
  subscriptionPlanPrice = 'price_pro_monthly'
  // A Pro org well past what Starter includes: 4 sites (Starter includes 1),
  // 5 manager seats (2) and 6 datasets (3).
  mockSiteCount = 4
  mockDatasetCount = 6
  mockMembers = [
    { role: 'owner' },
    { role: 'admin' },
    { role: 'admin' },
    { role: 'editor', allHosts: true },
    { role: 'editor', allHosts: true },
    // A site-scoped collaborator — metered per site, never a manager seat.
    { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'editor' } },
  ]
  global.fetch = jest.fn(async (url: unknown) => {
    const href = String(url)
    mockStripeCalls.push(href)
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            current_period_end: PERIOD_END,
            currency: 'usd',
            cancel_at_period_end: false,
            schedule: null,
            items: {
              data: [
                {
                  id: 'si_plan',
                  quantity: 1,
                  price: {
                    id: subscriptionPlanPrice,
                    recurring: { interval: 'month' },
                  },
                },
              ],
            },
          },
        ],
      }
    } else if (href.endsWith('/subscription_schedules')) {
      payload = {
        id: 'sub_sched_new',
        phases: [{ start_date: PERIOD_END - 2592000, end_date: PERIOD_END, items: [] }],
      }
    } else if (href.includes('/subscription_schedules/sub_sched_new')) {
      payload = { id: 'sub_sched_new', status: 'active' }
    } else if (href.includes('/subscriptions/sub_1')) {
      payload = { status: 'active', items: { data: [] } }
    } else if (href.includes('/invoices/upcoming')) {
      payload = { amount_due: -1234, currency: 'usd', lines: { data: [] } }
    } else {
      throw new Error(`unexpected fetch: ${href}`)
    }
    return { ok: true, json: async () => payload }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
  jest.restoreAllMocks()
})

describe('the fixture reaches the code under test', () => {
  it('measures against the real Starter INCLUDED counts', () => {
    const { PLAN_ENTITLEMENTS } = jest.requireActual(
      '@aglyn/aglyn/app-utils/plan-entitlements',
    )
    expect(PLAN_ENTITLEMENTS.starter.hostLimit).toBe(1)
    expect(PLAN_ENTITLEMENTS.starter.managersPerOrg).toBe(2)
    expect(PLAN_ENTITLEMENTS.starter.datasetsPerOrg).toBe(3)
    // The purchase CEILING is a different number, and measuring against it is
    // the defect this comparison already had once.
    expect(PLAN_ENTITLEMENTS.starter.maxDatasetsPerOrg).toBe(10)
  })
})

describe('a downgrade is refused while the org exceeds the target plan', () => {
  it('answers 409 naming the capacity, the ceiling and the remedy', async () => {
    const response = await call({ action: 'switch', plan: 'starter' })
    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload.code).toBe('over_target_plan_limits')
    expect(payload.error).toBe(
      'You have 4 sites. Starter includes 1. Remove 3 to continue. ' +
        'You have 5 team members. Starter includes 2. Remove 3 to continue. ' +
        'You have 6 datasets. Starter includes 3. Remove 3 to continue.',
    )
  })

  it('and reports each capacity separately for the surface to render', async () => {
    const payload = await (await call({ action: 'switch', plan: 'starter' })).json()
    expect(payload.overLimit).toEqual([
      { kind: 'sites', count: 4, included: 1, excess: 3 },
      { kind: 'seats', count: 5, included: 2, excess: 3 },
      { kind: 'datasets', count: 6, included: 3, excess: 3 },
    ])
  })

  it('one capacity over is enough', async () => {
    mockSiteCount = 1
    mockMembers = [{ role: 'owner' }]
    const payload = await (await call({ action: 'switch', plan: 'starter' })).json()
    expect(payload.error).toBe(
      'You have 6 datasets. Starter includes 3. Remove 3 to continue.',
    )
  })

  it('and no schedule is created, so nothing is pending afterwards', async () => {
    // A refusal that had already written the schedule would leave the plan
    // change queued behind an error saying it was rejected.
    await call({ action: 'switch', plan: 'starter' })
    expect(billingCalls()).toEqual([])
  })
})

/**
 * The rule is "not while it would strand what you hold", not "not ever" and
 * not "not while you are over anything". Without these, a guard that refused
 * every plan change would pass every assertion above.
 */
describe('CONTROL — what the gate must still let through', () => {
  it('an org that FITS the target plan downgrades as before', async () => {
    mockSiteCount = 1
    mockDatasetCount = 3
    mockMembers = [{ role: 'owner' }, { role: 'admin' }]
    const response = await call({ action: 'switch', plan: 'starter' })
    expect(response.status).toBe(200)
    expect(billingCalls().some((href) => href.endsWith('/subscription_schedules'))).toBe(true)
  })

  it('an UPGRADE is never refused, even over the target plan limits', async () => {
    // GRANDFATHERING. This org is on Starter and holds 4 sites — it is over
    // Starter's included 1 AND over Pro's included 3, for reasons that have
    // nothing to do with this request. Moving UP is not a reduction, and an
    // org finding itself over a cap is a different act from choosing to
    // reduce. Gate the action, never the state.
    subscriptionPlanPrice = 'price_starter_monthly'
    const response = await call({ action: 'switch', plan: 'pro' })
    expect(response.status).toBe(200)
  })

  it('a PREVIEW still answers, so the customer can see the price first', async () => {
    // The pre-choice surfaces render the over-limit list from this. Refusing
    // the quote would hide the number the customer needs in order to decide.
    const response = await call({ action: 'preview', plan: 'starter' })
    expect(response.status).toBe(200)
  })

  it('an unreadable count refuses nothing', async () => {
    // Our outage is not the customer's refusal, and a row with no count names
    // no remedy — "remove an unknown number of datasets" is the support
    // ticket this gate exists to avoid.
    mockSiteCount = null
    mockDatasetCount = null
    mockMembers = []
    const response = await call({ action: 'switch', plan: 'starter' })
    expect(response.status).toBe(200)
  })
})
