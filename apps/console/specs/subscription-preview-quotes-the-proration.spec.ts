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
 * A plan-switch preview quotes what the SWITCH costs, not what the next
 * invoice totals.
 *
 * `proration_behavior: create_prorations` charges nothing at the moment of the
 * switch — Stripe writes the proration adjustments onto the upcoming invoice.
 * So `invoices/upcoming.amount_due` is that entire invoice, next period's
 * recurring charge included, and it is the wrong number to put in front of
 * somebody about to click "switch plan": on a mid-cycle upgrade it overstates
 * the cost by a full billing period and dates it today instead of at renewal.
 *
 * The cost of the change is the `proration` lines alone. `/api/billing/addons`
 * already derives it that way for the same mechanic on the same subscription,
 * so this pins the plan-switch preview to the same derivation — two previews
 * of one Stripe behaviour answering differently is indistinguishable from a
 * pricing bug, from the customer's side and from ours.
 *
 * No live Stripe call happens here: `fetch` is mocked per-endpoint and the
 * returned JSON is the assertion surface.
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
  // The REAL ladder: a hand-shuffled copy here would let the route's up/down
  // answer drift from the one the product sells, and up/down decides whether
  // this preview calls Stripe at all.
  SELF_SERVE_PLANS: jest.requireActual(
    '@aglyn/aglyn/app-utils/plan-entitlements',
  ).SELF_SERVE_PLANS,
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

const STARTER_ITEM = {
  id: 'si_plan',
  quantity: 1,
  price: { id: 'price_starter_monthly', recurring: { interval: 'month' } },
}
const PRO_ITEM = {
  id: 'si_plan',
  quantity: 1,
  price: { id: 'price_pro_monthly', recurring: { interval: 'month' } },
}
const METERED_ITEM = {
  id: 'si_metered',
  price: { id: 'price_metered_usage', recurring: { interval: 'month' } },
}

/**
 * The plan item Stripe reports on the live subscription. The route decides
 * up/down from the price the subscription is ACTUALLY priced at, never from
 * the org doc's `plan` field, so this — not `mockOrgGet` — is what makes a
 * request an upgrade or a downgrade here.
 */
let planItem: any = STARTER_ITEM

/**
 * The upcoming invoice the mocked Stripe answers with.
 *
 * `amount_due` and the `lines` are seeded INDEPENDENTLY on purpose. A double
 * that derived one from the other could not tell a route that sums the
 * proration lines from one that echoes `amount_due` — the two numbers being
 * different is the entire subject of this file.
 */
let upcomingAmountDue = 0
let upcomingLines: any[] = []
let upcomingRequested = false

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

beforeEach(() => {
  planItem = STARTER_ITEM
  upcomingAmountDue = 0
  upcomingLines = []
  upcomingRequested = false
  // Module-scope `jest.fn()`s survive `restoreAllMocks`, so without an
  // explicit clear "was this ever called?" accumulates across the file and can
  // never be false.
  mockWriteOrgBilling.mockClear()
  mockVerifyIdToken.mockClear()
  mockOrgGet.mockClear()
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockOrgGet.mockResolvedValue({
    // `org.get('slug')` and `org.get('plan')` both route through this.
    get: (field: string) => (field === 'plan' ? 'starter' : 'acme'),
    ref: { id: 'org-1', set: async () => undefined },
  })
  mockWriteOrgBilling.mockResolvedValue(undefined)
  global.fetch = jest.fn(async (url: unknown) => {
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
            cancel_at_period_end: false,
            schedule: null,
            items: { data: [planItem, METERED_ITEM] },
          },
        ],
      }
    } else if (href.includes('/invoices/upcoming')) {
      upcomingRequested = true
      payload = {
        amount_due: upcomingAmountDue,
        currency: 'usd',
        period_end: PERIOD_END,
        // Invoice-level tax, deliberately present and deliberately much
        // larger than the tax on any one proration: it covers the WHOLE
        // upcoming invoice, next period's recurring charge included. A
        // response that quotes this on a proration is reading the wrong
        // field, and it has to be readable for that mistake to be catchable.
        tax: 1064,
        automatic_tax: { status: 'complete' },
        lines: { data: upcomingLines },
      }
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

describe('plan-switch preview: the proration, not the next invoice', () => {
  it('reports the proration lines, not the whole upcoming invoice', async () => {
    // A mid-cycle starter → pro upgrade, half way through the month:
    // a $15.00 credit for the unused starter time, a $45.00 charge for the
    // remaining pro time, and next month's $99.00 pro renewal sitting on the
    // same invoice. The switch costs $30.00. The invoice totals $129.00.
    upcomingAmountDue = 12900
    upcomingLines = [
      { proration: true, amount: -1500 },
      { proration: true, amount: 4500 },
      { proration: false, amount: 9900 },
    ]
    const post = loadSubscription()
    const response = await call(post, {
      action: 'preview',
      plan: 'pro',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(upcomingRequested).toBe(true)
    // The number a customer is asked to commit money against.
    expect(payload.prorationCents).toBe(3000)
    // The whole invoice is still reported, under its own name, so a caller
    // that wants to state the renewal total can — it is simply no longer the
    // only number on offer.
    expect(payload.amountDueCents).toBe(12900)
    // The premise: on this invoice the two genuinely differ. Without it the
    // assertion above could pass against a route that never learned the
    // difference.
    expect(payload.prorationCents).not.toBe(payload.amountDueCents)
  })

  it('CONTROL: an invoice with no proration lines reports zero, while the renewal total stands', async () => {
    // Proves the proration figure is DERIVED from the lines rather than
    // echoed from `amount_due`. A route that echoed would answer 9900 here.
    upcomingAmountDue = 9900
    upcomingLines = [{ proration: false, amount: 9900 }]
    const post = loadSubscription()
    const response = await call(post, {
      action: 'preview',
      plan: 'pro',
      interval: 'month',
    })
    const payload = await response.json()
    expect(payload.prorationCents).toBe(0)
    expect(payload.amountDueCents).toBe(9900)
  })

  it('CONTROL: a credit stays negative rather than being folded to zero', async () => {
    // Proration is signed. A switch that hands back more unused time than it
    // bills is a credit, and reporting it as 0 — or as its absolute value —
    // would tell a customer they owe money they are owed.
    upcomingAmountDue = 8400
    upcomingLines = [
      { proration: true, amount: -2500 },
      { proration: true, amount: 1000 },
      { proration: false, amount: 9900 },
    ]
    const post = loadSubscription()
    const response = await call(post, {
      action: 'preview',
      plan: 'pro',
      interval: 'month',
    })
    const payload = await response.json()
    expect(payload.prorationCents).toBe(-1500)
  })

  it('a scheduled downgrade reports zero without asking Stripe to price it', async () => {
    // Nothing prorates end-of-cycle (AGL-1862), so the figure is 0 by
    // construction — and quoting Stripe here would surface the credit an
    // INSTANT switch would have issued, which is the number that flow exists
    // not to offer.
    planItem = PRO_ITEM
    mockOrgGet.mockResolvedValue({
      get: (field: string) => (field === 'plan' ? 'pro' : 'acme'),
      ref: { id: 'org-1', set: async () => undefined },
    })
    const post = loadSubscription()
    const response = await call(post, {
      action: 'preview',
      plan: 'starter',
      interval: 'month',
    })
    const payload = await response.json()
    expect(payload.downgrade).toBe(true)
    expect(payload.prorationCents).toBe(0)
    expect(payload.amountDueCents).toBe(0)
    expect(upcomingRequested).toBe(false)
  })
})

/**
 * The tax on a change is the tax on the CHANGE.
 *
 * `automatic_tax` was already enabled on this preview — Stripe computed the
 * tax every time and the response never carried it, so the confirm dialog
 * quoted a bare proration as though a mid-cycle switch were untaxed.
 *
 * Carrying it introduces a second chance at the original bug, one field over:
 * the invoice's own `tax` covers the whole upcoming invoice, so adding THAT to
 * a proration overstates the change by a period's tax. These cases pin the
 * attribution, which is the part a reader cannot verify by eye.
 */
describe('plan-switch preview: the tax on the proration, not on the invoice', () => {
  it('sums the proration lines\' own tax, not the invoice total', async () => {
    // The change costs $30.00 and carries $2.48 of tax. The invoice totals
    // $129.00 and carries $10.64 — the number that must NOT come back.
    upcomingLines = [
      { proration: true, amount: 4500, tax_amounts: [{ amount: 372, taxability_reason: 'standard_rated' }] },
      { proration: true, amount: -1500, tax_amounts: [{ amount: -124, taxability_reason: 'standard_rated' }] },
      { proration: false, amount: 9900, tax_amounts: [{ amount: 816, taxability_reason: 'standard_rated' }] },
    ]
    const post = loadSubscription()
    const payload = await (
      await call(post, { action: 'preview', plan: 'pro', interval: 'month' })
    ).json()
    expect(payload.prorationCents).toBe(3000)
    expect(payload.prorationTaxCents).toBe(248)
    // THE REGRESSION: the invoice's own tax must never be the answer.
    expect(payload.prorationTaxCents).not.toBe(1064)
  })

  it('carries whether Stripe finished computing it', async () => {
    // A tax of 0 from `requires_location_inputs` is indistinguishable from a
    // real zero unless the status travels with it.
    upcomingLines = [{ proration: true, amount: 3000, tax_amounts: [] }]
    const post = loadSubscription()
    const payload = await (
      await call(post, { action: 'preview', plan: 'pro', interval: 'month' })
    ).json()
    expect(payload.taxComplete).toBe(true)
    expect(payload.prorationTaxCents).toBe(0)
  })

  it('carries Stripe\'s own reason, so a zero can be explained', async () => {
    upcomingLines = [
      { proration: true, amount: 3000, tax_amounts: [{ amount: 0, taxability_reason: 'reverse_charge' }] },
    ]
    const post = loadSubscription()
    const payload = await (
      await call(post, { action: 'preview', plan: 'pro', interval: 'month' })
    ).json()
    expect(payload.taxReason).toBe('reverse_charge')
    expect(payload.prorationTaxCents).toBe(0)
  })

  it('CONTROL — a taxed proration really does report a non-zero tax', async () => {
    // Without this, a route that always returned 0 would satisfy every
    // "not the invoice total" assertion above.
    upcomingLines = [
      { proration: true, amount: 3000, tax_amounts: [{ amount: 248, taxability_reason: 'standard_rated' }] },
    ]
    const post = loadSubscription()
    const payload = await (
      await call(post, { action: 'preview', plan: 'pro', interval: 'month' })
    ).json()
    expect(payload.prorationTaxCents).toBeGreaterThan(0)
  })
})
