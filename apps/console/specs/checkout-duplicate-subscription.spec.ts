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
 * One workspace, one subscription (AGL-1697).
 *
 * `/api/billing/checkout` opens a `mode: subscription` session and has never
 * looked at whether the org already HAS one. Two completed sessions subscribe
 * the same org twice on the same Stripe customer — two recurring charges that
 * neither this route nor the webhook prevents, because the webhook's job is to
 * mirror whatever Stripe reports and it will happily mirror the second one over
 * the first.
 *
 * The only thing standing in the way was client-side: the Billing page routes a
 * plan change through the proration preview + subscription update "never a
 * second Checkout (AGL-269)" — a branch in a React callback, which does not
 * survive a stale tab, a direct POST, or a second window.
 *
 * What must NOT be blocked is the reason this is a status test rather than a
 * "has a subscription object" test: an org whose subscription was CANCELED has
 * to be able to buy again, and that org still carries the dead subscription
 * record plus its customer id.
 *
 * Counting, not trusting: every assertion here checks how many Stripe session
 * calls actually left the handler. `fetch` is mocked for the whole file so
 * nothing can reach api.stripe.com — localhost carries the LIVE key.
 */

// A module, not a script — without this the const declarations below collide
// with the other billing route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockOrgGet = jest.fn()
const mockReadOrgBilling = jest.fn()

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
  // Inert: the checkout feature gate (AGL-1510) has its own specs.
  featureLockdownRefusal: async () => null,
  memberHasOrgPermission: async () => true,
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  getServerReleaseFlagValues: async () => ({}),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL claim helper (AGL-1697 added it to the route): with no
  // Idempotency-Key header — this spec's case — it returns a no-op claim
  // without touching any store, so requiring the real one is exact.
  claimAttempt: jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
    .claimAttempt,
  // The REAL predicate, not a re-typed triple (AGL-1715). A hand-written mock
  // of a single-source list is the drift this guard exists to prevent: the
  // spec would keep passing while the route's real answer changed.
  isOrgSubscriptionLive: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isOrgSubscriptionLive,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  isCustomPricedPlan: (plan: string) => plan === 'enterprise',
  isReleaseFlagOn: () => false,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json(),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      origin: 'https://app.aglyn.com',
      host: 'app.aglyn.com',
    },
  }),
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
}

/** Every Stripe session request the handler actually made. */
let sessionCalls: URLSearchParams[] = []

/**
 * The route snapshots `PRICE_ENV` at module load, so env has to be in place
 * BEFORE the require — which is also why this is a require and not an import.
 */
function loadCheckout() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/checkout/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function checkout(
  post: (request: Request) => Promise<Response>,
  plan = 'starter',
) {
  return post(
    new Request('https://app.aglyn.com/api/billing/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ plan, interval: 'month', orgId: 'org-1' }),
    }),
  )
}

beforeEach(() => {
  sessionCalls = []
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'owner@example.com',
    email_verified: true,
  })
  mockOrgGet.mockResolvedValue({ get: () => 'acme' })
  mockReadOrgBilling.mockResolvedValue({})
  global.fetch = jest.fn(async (_url: unknown, init: any) => {
    sessionCalls.push(new URLSearchParams(String(init?.body ?? '')))
    return {
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/session' }),
    }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('one workspace, one subscription (AGL-1697)', () => {
  it('THE DEFECT: an org with a live subscription can open a SECOND checkout', async () => {
    mockReadOrgBilling.mockResolvedValue({
      stripeCustomerId: 'cus_test_1',
      subscription: { status: 'active', plan: 'starter' },
    })
    const post = loadCheckout()
    const response = await checkout(post, 'pro')
    expect(response.status).toBe(409)
    // The measurement that matters: no session was minted on the live account.
    expect(sessionCalls).toHaveLength(0)
    expect((await response.json()).code).toBe('subscription_exists')
  })

  it('refuses a trialing org too — a trial IS a subscription', async () => {
    mockReadOrgBilling.mockResolvedValue({
      stripeCustomerId: 'cus_test_1',
      subscription: { status: 'trialing' },
    })
    const post = loadCheckout()
    expect((await checkout(post)).status).toBe(409)
    expect(sessionCalls).toHaveLength(0)
  })

  it('refuses a past_due org — dunning is paid through invoices, not a new sub', async () => {
    // Matches what the Billing page already treats as live. A second
    // subscription does not settle the first one's unpaid invoice; it just
    // adds a charge beside it.
    mockReadOrgBilling.mockResolvedValue({
      stripeCustomerId: 'cus_test_1',
      subscription: { status: 'past_due' },
    })
    const post = loadCheckout()
    expect((await checkout(post)).status).toBe(409)
    expect(sessionCalls).toHaveLength(0)
  })

  it('CONTROL — a canceled org buys again, on its existing customer', async () => {
    // The case a naive "has a subscription record" guard would break: the
    // record survives cancellation and so does `stripeCustomerId`. Blocking
    // this would lock every churned workspace out of ever paying us again.
    mockReadOrgBilling.mockResolvedValue({
      stripeCustomerId: 'cus_test_1',
      subscription: { status: 'canceled' },
    })
    const post = loadCheckout()
    expect((await checkout(post)).status).toBe(200)
    expect(sessionCalls).toHaveLength(1)
    expect(sessionCalls[0].get('customer')).toBe('cus_test_1')
  })

  it('CONTROL — a first-ever subscribe is untouched', async () => {
    const post = loadCheckout()
    expect((await checkout(post)).status).toBe(200)
    expect(sessionCalls).toHaveLength(1)
    expect(sessionCalls[0].get('customer_email')).toBe('owner@example.com')
  })

  it('CONTROL — an incomplete session does not lock the org out', async () => {
    // `incomplete` is what Stripe reports for a subscription whose first
    // payment never succeeded. There is nothing live to protect, and the
    // buyer's only way forward is a new session.
    for (const status of ['incomplete', 'incomplete_expired', 'unpaid']) {
      mockReadOrgBilling.mockResolvedValue({ subscription: { status } })
      sessionCalls = []
      const post = loadCheckout()
      const response = await checkout(post)
      expect(`${status} → ${response.status}`).toBe(`${status} → 200`)
    }
  })
})
