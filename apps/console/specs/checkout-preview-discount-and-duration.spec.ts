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
 * The priced quote carries the DISCOUNT and how long it lasts.
 *
 * ## Three numbers that could not all be true
 *
 * Stripe's `subtotal` is pre-discount and its `total` is post-discount, so a
 * quote built from those two alone renders $25.00, $0.05 of tax and a $0.80
 * total — arithmetic no reader can close, because the line that closes it was
 * never returned. `describeInvoiceAmounts` now reports it.
 *
 * ## And a discount that expires is a different price
 *
 * `duration: once` takes 97% off the first invoice and nothing after it. A
 * confirm that quotes only today is true about today and misleading about the
 * subscription, and no field on the old payload could tell the two apart. The
 * duration rides the promotion-code lookup the resolve path already makes.
 *
 * No live Stripe call happens here: `fetch` is replaced and the captured
 * request bodies are the assertion surface.
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
  featureLockdownRefusal: async () => null,
  memberHasOrgPermission: async () => true,
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  isServerReleaseFlagOnForOrg: async () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL claim helper: with no Idempotency-Key header — every case below
  // — it returns a no-op claim without touching any store.
  claimAttempt: jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
    .claimAttempt,
  // The REAL predicate, never a re-typed triple (AGL-1715).
  isOrgSubscriptionLive: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isOrgSubscriptionLive,
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

/** Env without a trace of the developer's own Stripe config. */
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
}

/** The coupon the fake `/v1/promotion_codes` lookup answers with. */
let coupon: Record<string, unknown>
/** Whether the upcoming-invoice double reports a discount line at all. */
let discounted: boolean
/** Which spelling of the discount array the invoice uses. */
let discountField: 'total_discount_amounts' | 'total_discounts'
/** Bodies POSTed to `/v1/subscriptions`, as parsed form data. */
let subscriptionBodies: URLSearchParams[]

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

function post(
  handler: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
) {
  return handler(
    new Request('https://app.aglyn.com/api/billing/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        plan: 'starter',
        interval: 'month',
        orgId: 'org-1',
        ...body,
      }),
    }),
  )
}

beforeEach(() => {
  coupon = { duration: 'once', duration_in_months: null }
  discounted = true
  discountField = 'total_discount_amounts'
  subscriptionBodies = []
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'owner@example.com',
    email_verified: true,
  })
  mockOrgGet.mockResolvedValue({ get: () => 'acme' })
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_test_1' })
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    if (/\/promotion_codes\?/.test(href)) {
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'promo_1', code: 'LAUNCH97', coupon }],
        }),
      }
    }
    if (/\/customers\//.test(href)) {
      return {
        ok: true,
        json: async () => ({
          invoice_settings: { default_payment_method: 'pm_saved_1' },
          address: { country: 'US' },
          tax_exempt: 'none',
          tax_ids: { data: [] },
        }),
      }
    }
    if (/\/invoices\/upcoming/.test(href)) {
      // 97% off $25.00: Stripe reports the PRE-discount subtotal, the tax on
      // what remains, and a post-discount total. The discount line is the
      // only thing that makes the three reconcile.
      return {
        ok: true,
        json: async () => ({
          subtotal: 2500,
          tax: 5,
          total: 80,
          currency: 'usd',
          automatic_tax: { status: 'complete' },
          total_tax_amounts: [{ taxability_reason: 'standard_rated' }],
          ...(discounted
            ? { [discountField]: [{ amount: 2425, discount: 'di_1' }] }
            : {}),
        }),
      }
    }
    subscriptionBodies.push(new URLSearchParams(String(init?.body ?? '')))
    return {
      ok: true,
      json: async () => ({
        id: 'sub_1',
        status: 'active',
        latest_invoice: {
          subtotal: 2500,
          tax: 5,
          total: 80,
          currency: 'usd',
          automatic_tax: { status: 'complete' },
          total_discount_amounts: [{ amount: 2425 }],
          payment_intent: { status: 'succeeded', client_secret: 'pi_secret' },
        },
      }),
    }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('the preview reports what the discount took off', () => {
  it('carries the discount, so subtotal − discount + tax equals the total', async () => {
    const handler = loadCheckout()
    const response = await post(handler, {
      action: 'preview',
      promotionCode: 'LAUNCH97',
    })
    expect(response.status).toBe(200)
    const { preview } = await response.json()
    expect(preview.discountCents).toBe(2425)
    // The reconciliation itself, asserted as arithmetic rather than as a
    // field: this is the property a customer performs on the rendered card,
    // and it is the one that failed.
    expect(
      preview.subtotalCents - preview.discountCents + preview.taxCents,
    ).toBe(preview.totalCents)
  })

  it('reads the newer `total_discounts` spelling too', async () => {
    // A pinned API version is not a promise about the next one. The pair is
    // read the way `total_tax_amounts` / `total_taxes` already is.
    discountField = 'total_discounts'
    const handler = loadCheckout()
    const response = await post(handler, {
      action: 'preview',
      promotionCode: 'LAUNCH97',
    })
    expect((await response.json()).preview.discountCents).toBe(2425)
  })

  it('reports zero — not a guess — when nothing was discounted', async () => {
    discounted = false
    const handler = loadCheckout()
    const response = await post(handler, { action: 'preview' })
    const { preview } = await response.json()
    expect(preview.discountCents).toBe(0)
    // And the quote card's rule "render the row when it is non-zero" is
    // therefore never fed a discount inferred from a subtotal that failed to
    // add up — which would also swallow tax and credits.
    expect(preview.subtotalCents).toBe(2500)
  })
})

describe('the preview reports how long the discount lasts', () => {
  it('names a `once` coupon as such', async () => {
    const handler = loadCheckout()
    const response = await post(handler, {
      action: 'preview',
      promotionCode: 'LAUNCH97',
    })
    const payload = await response.json()
    expect(payload.promotionCodeApplied).toBe('LAUNCH97')
    expect(payload.promotionCodeDuration).toBe('once')
    expect(payload.promotionCodeDurationInMonths).toBeNull()
  })

  it('carries the month count of a `repeating` coupon', async () => {
    coupon = { duration: 'repeating', duration_in_months: 3 }
    const handler = loadCheckout()
    const response = await post(handler, {
      action: 'preview',
      promotionCode: 'LAUNCH97',
    })
    const payload = await response.json()
    expect(payload.promotionCodeDuration).toBe('repeating')
    expect(payload.promotionCodeDurationInMonths).toBe(3)
  })

  it('answers null for a duration Stripe did not state', async () => {
    // Reported as unknown rather than resolved in either direction: guessing
    // `forever` promises a price nobody verified.
    coupon = {}
    const handler = loadCheckout()
    const response = await post(handler, {
      action: 'preview',
      promotionCode: 'LAUNCH97',
    })
    const payload = await response.json()
    expect(payload.promotionCodeApplied).toBe('LAUNCH97')
    expect(payload.promotionCodeDuration).toBeNull()
  })

  it('reports no duration when no code was applied', async () => {
    const handler = loadCheckout()
    const response = await post(handler, { action: 'preview' })
    const payload = await response.json()
    expect(payload.promotionCodeApplied).toBeNull()
    expect(payload.promotionCodeDuration).toBeNull()
    expect(payload.promotionCodeDurationInMonths).toBeNull()
  })
})

describe('the subscribe path applies the code it is sent', () => {
  it('sets `discounts[0][promotion_code]` from the request body', async () => {
    // The half of this that always worked. Pinned because the client now
    // sends the field, and a route that quietly stopped reading it would put
    // the whole defect back with every screen still looking correct.
    const handler = loadCheckout()
    const response = await post(handler, { promotionCode: 'LAUNCH97' })
    expect(response.status).toBe(200)
    expect(subscriptionBodies).toHaveLength(1)
    expect(subscriptionBodies[0].get('discounts[0][promotion_code]')).toBe(
      'promo_1',
    )
  })

  it('sends no discount parameter when the body carries no code', async () => {
    const handler = loadCheckout()
    await post(handler, {})
    expect(subscriptionBodies[0].get('discounts[0][promotion_code]')).toBeNull()
  })
})
