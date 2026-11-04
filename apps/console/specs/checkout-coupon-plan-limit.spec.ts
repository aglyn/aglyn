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
 * A code limited to one plan's base price is refused on another plan
 * (AGL-4159).
 *
 * Stripe accepts a coupon limited to products that are not on the
 * subscription and simply discounts nothing, so without this check a
 * Starter code typed on Pro was shown as applied and charged the full Pro
 * price. The quote refuses it the way it refuses any code — a 400 with no
 * `code`, which the Billing card reads as the code's own refusal — with the
 * plan it is for, and the purchase refuses it again above the point of no
 * return.
 *
 * No live Stripe call happens here: `fetch` is replaced and the captured
 * requests are the assertion surface.
 */

// A module, not a script — the const declarations below share names with the
// other billing route specs.
export {}

const mockVerifyIdToken = jest.fn()
const mockReadOrgBilling = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({ doc: () => ({ get: async () => ({ get: () => 'acme' }) }) }),
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
  claimAttempt: jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency').claimAttempt,
  isOrgSubscriptionLive: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isOrgSubscriptionLive,
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
  SELF_SERVE_PLANS: ['free', 'starter', 'pro'],
  PLAN_PRICING: {},
}))

const ORIGINAL_ENV = process.env

/** A deployment's own price ids; the products below are what Stripe holds them on. */
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_month',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_year',
  STRIPE_PRICE_PRO: 'price_pro_month',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_year',
  STRIPE_PRICE_METERED: 'price_metered_month',
}
const PRICE_PRODUCTS: Record<string, string> = {
  price_starter_month: 'prod_starter',
  price_starter_year: 'prod_starter',
  price_pro_month: 'prod_pro',
  price_pro_year: 'prod_pro',
}

/** The coupon the promotion-code lookup answers with. */
let coupon: Record<string, unknown>
/** Price ids Stripe answers with an error. */
let failingPrices: Set<string>
let customerId: string | null
/** Every Stripe URL asked for, in order. */
let stripeCalls: string[]
/** Bodies POSTed to `/v1/subscriptions`. */
let subscriptionBodies: URLSearchParams[]

function loadCheckout() {
  jest.resetModules()
  const clean = { ...ORIGINAL_ENV }
  for (const key of Object.keys(clean)) if (key.startsWith('STRIPE_')) delete clean[key]
  process.env = { ...clean, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/checkout/route').POST as (
    request: Request,
  ) => Promise<Response>
}

const post = (body: Record<string, unknown>) =>
  loadCheckout()(
    new Request('https://app.aglyn.com/api/billing/checkout', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({
        interval: 'month',
        orgId: 'org-1',
        promotionCode: 'PARTNER',
        ...body,
      }),
    }),
  )

beforeEach(() => {
  coupon = { id: 'cpn_1', percent_off: 100, duration: 'repeating', duration_in_months: 24 }
  failingPrices = new Set()
  customerId = 'cus_test_1'
  stripeCalls = []
  subscriptionBodies = []
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockReadOrgBilling.mockImplementation(async () => ({ stripeCustomerId: customerId }))
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    stripeCalls.push(href)
    const answer = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
    })
    if (/\/promotion_codes\?/.test(href)) {
      return answer(200, { data: [{ id: 'promo_1', code: 'PARTNER', coupon }] })
    }
    const price = href.match(/\/v1\/prices\/([^/?]+)/)
    if (price) {
      const id = decodeURIComponent(price[1])
      return failingPrices.has(id) || !PRICE_PRODUCTS[id]
        ? answer(404, { error: { message: `No such price: '${id}'` } })
        : answer(200, { id, product: PRICE_PRODUCTS[id] })
    }
    if (/\/customers\//.test(href)) {
      return answer(200, {
        invoice_settings: { default_payment_method: 'pm_saved_1' },
        address: { country: 'US' },
        tax_exempt: 'none',
        tax_ids: { data: [] },
      })
    }
    if (/\/invoices\/upcoming/.test(href)) {
      return answer(200, {
        subtotal: 2500,
        tax: 0,
        total: 0,
        currency: 'usd',
        automatic_tax: { status: 'complete' },
        total_discount_amounts: [{ amount: 2500 }],
      })
    }
    subscriptionBodies.push(new URLSearchParams(String(init?.body ?? '')))
    return answer(200, {
      id: 'sub_1',
      status: 'active',
      latest_invoice: {
        subtotal: 2500,
        tax: 0,
        total: 0,
        currency: 'usd',
        automatic_tax: { status: 'complete' },
        payment_intent: { status: 'succeeded' },
      },
    })
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

const STARTER_ONLY = { products: ['prod_starter'] }

describe('the quote refuses a code limited to another plan', () => {
  it('refuses a Starter code on Pro, naming the plan it is for', async () => {
    coupon = { ...coupon, applies_to: STARTER_ONLY }
    const response = await post({ action: 'preview', plan: 'pro' })
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload).toEqual({
      error: 'This code is for the Starter plan.',
      promotionCodeRefusal: 'plan',
    })
    // No `code`: the card reads it as the code's own refusal, not an add-on's.
    expect(payload.code).toBeUndefined()
    expect(stripeCalls.some((href) => /invoices\/upcoming/.test(href))).toBe(false)
  })

  it('refuses it on a workspace that has never been billed, too', async () => {
    customerId = null
    coupon = { ...coupon, applies_to: STARTER_ONLY }
    const response = await post({ action: 'preview', plan: 'pro', interval: 'year' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('This code is for the Starter plan.')
  })

  it('expands the coupon’s `applies_to` on the code lookup', async () => {
    await post({ action: 'preview', plan: 'starter' })
    const lookup = stripeCalls.find((href) => /promotion_codes\?/.test(href))
    expect(lookup).toContain('expand[]=data.coupon.applies_to')
  })

  it('prices a Starter code on Starter, and says it is off the base price only', async () => {
    coupon = { ...coupon, applies_to: STARTER_ONLY }
    const response = await post({ action: 'preview', plan: 'starter' })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.promotionCodeApplied).toBe('PARTNER')
    expect(payload.promotionCodeBasePriceOnly).toBe(true)
    expect(payload.promotionCodeDuration).toBe('repeating')
    expect(payload.promotionCodeDurationInMonths).toBe(24)
    const upcoming = stripeCalls.find((href) => /invoices\/upcoming/.test(href))
    expect(new URL(upcoming!).searchParams.get('discounts[0][promotion_code]')).toBe('promo_1')
    // The price being sold is the one read for its product.
    expect(stripeCalls.some((href) => href.endsWith('/v1/prices/price_starter_month'))).toBe(true)
  })

  it('carries the base-price flag on a quote with no price yet', async () => {
    customerId = null
    coupon = { ...coupon, applies_to: STARTER_ONLY }
    const response = await post({ action: 'preview', plan: 'starter', interval: 'year' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      needsBillingDetails: true,
      promotionCodeApplied: 'PARTNER',
      promotionCodePercentOff: 100,
      promotionCodeBasePriceOnly: true,
    })
  })

  it('prices a code for any plan’s base price on Pro', async () => {
    coupon = { ...coupon, applies_to: { products: ['prod_starter', 'prod_pro'] } }
    const response = await post({ action: 'preview', plan: 'pro' })
    expect(response.status).toBe(200)
    expect((await response.json()).promotionCodeBasePriceOnly).toBe(true)
  })

  it('reads no plan price for a whole-subscription code', async () => {
    const response = await post({ action: 'preview', plan: 'pro' })
    expect(response.status).toBe(200)
    expect((await response.json()).promotionCodeBasePriceOnly).toBe(false)
    expect(stripeCalls.some((href) => /\/v1\/prices\//.test(href))).toBe(false)
  })

  it('answers 502, not a refusal of the code, when the plan’s price cannot be read', async () => {
    coupon = { ...coupon, applies_to: STARTER_ONLY }
    failingPrices.add('price_pro_month')
    const response = await post({ action: 'preview', plan: 'pro' })
    expect(response.status).toBe(502)
    expect((await response.json()).promotionCodeRefusal).toBeUndefined()
  })
})

describe('the purchase refuses it again, before anything is charged', () => {
  it('creates no subscription for a Starter code on Pro', async () => {
    coupon = { ...coupon, applies_to: STARTER_ONLY }
    const response = await post({ plan: 'pro' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'This code is for the Starter plan.',
      promotionCodeRefusal: 'plan',
    })
    expect(subscriptionBodies).toHaveLength(0)
  })

  it('subscribes Starter with the Starter code, and the metered item beside it', async () => {
    coupon = { ...coupon, applies_to: STARTER_ONLY }
    const response = await post({ plan: 'starter' })
    expect(response.status).toBe(200)
    expect(subscriptionBodies).toHaveLength(1)
    const body = subscriptionBodies[0]
    expect(body.get('items[0][price]')).toBe('price_starter_month')
    expect(body.get('items[1][price]')).toBe('price_metered_month')
    // The discount is the subscription's; Stripe takes it off the Starter
    // product's line alone, so the code changes nothing about the usage item.
    expect(body.get('discounts[0][promotion_code]')).toBe('promo_1')
  })
})
