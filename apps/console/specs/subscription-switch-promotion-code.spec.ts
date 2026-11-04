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
 * A plan switch on a live subscription applies the offer's code (AGL-4160).
 *
 * A workspace on a $0 Starter subscription (a code limited to Starter's base
 * price) offered "Pro yearly, 40% off" used to be switched with its old
 * discount kept and the offered code ignored, so Pro billed at list. The
 * switch now takes `promotionCode`, resolved by checkout's own resolver:
 *
 * - on a move UP it REPLACES the subscription's discounts, and the preview
 *   that prices the confirm uses it too;
 * - a code limited to another plan's base price is refused with the plan it
 *   is for, as at checkout;
 * - a move DOWN with a code is refused: it lands at the period end on a
 *   schedule, where the code would wait unseen or reach the plan being left;
 * - no code is today's behavior, byte for byte.
 *
 * No live Stripe call happens here: `fetch` is replaced per endpoint and the
 * captured requests are the assertion surface.
 */

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
  SELF_SERVE_PLANS: ['free', 'starter', 'pro'],
  PLAN_PRICING: {},
  POS_REGISTER_ADDON_MONTHLY_USD: 89,
  EVENT_CALENDAR_ADDON_MONTHLY_USD: 9,
}))

const ORIGINAL_ENV = process.env

/** A deployment's own price ids; the products are what Stripe holds them on. */
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_yearly',
  STRIPE_PRICE_PRO: 'price_pro_monthly',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_yearly',
  STRIPE_PRICE_METERED: 'price_metered_usage',
}
const PRICE_PRODUCTS: Record<string, string> = {
  price_starter_monthly: 'prod_starter',
  price_starter_yearly: 'prod_starter',
  price_pro_monthly: 'prod_pro',
  price_pro_yearly: 'prod_pro',
}

/** The live subscription: Starter monthly, with a $0 base-price discount on it. */
let planPriceId: string
/** The coupon the promotion-code lookup answers with, or null for no such code. */
let coupon: Record<string, unknown> | null
let stripeCalls: Array<{ href: string; method: string; body: string }>

function loadSubscription() {
  jest.resetModules()
  const clean = { ...ORIGINAL_ENV }
  for (const key of Object.keys(clean)) if (key.startsWith('STRIPE_')) delete clean[key]
  process.env = { ...clean, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/subscription/route').POST as (
    request: Request,
  ) => Promise<Response>
}

const call = (body: Record<string, unknown>) =>
  loadSubscription()(
    new Request('https://app.aglyn.com/api/billing/subscription', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )

/** Every `POST subscriptions/sub_1`, decoded. */
const subscriptionPosts = () =>
  stripeCalls
    .filter((c) => c.method === 'POST' && c.href.includes('/subscriptions/sub_1'))
    .map((c) => new URLSearchParams(c.body))
const itemUpdate = () => subscriptionPosts().find((body) => body.get('items[0][id]'))
const upcoming = () => {
  const found = stripeCalls.find((c) => c.href.includes('/invoices/upcoming'))
  return found ? new URL(found.href).searchParams : null
}

beforeEach(() => {
  planPriceId = 'price_starter_monthly'
  coupon = { id: 'cpn_pro40', percent_off: 40, duration: 'repeating', duration_in_months: 12 }
  stripeCalls = []
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockOrgGet.mockResolvedValue({
    get: (field: string) => (field === 'plan' ? 'starter' : 'acme'),
    data: () => ({ plan: 'starter' }),
    ref: { id: 'org-1', set: async () => undefined },
  })
  mockWriteOrgBilling.mockReset()
  mockWriteOrgBilling.mockResolvedValue(undefined)
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    const method = String(init?.method ?? 'GET')
    stripeCalls.push({ href, method, body: String(init?.body ?? '') })
    const answer = (status: number, payload: unknown) => ({
      ok: status < 400,
      status,
      json: async () => payload,
    })
    if (href.includes('/promotion_codes?')) {
      return answer(200, { data: coupon ? [{ id: 'promo_pro40', code: 'PRO40', coupon }] : [] })
    }
    const price = href.match(/\/v1\/prices\/([^/?]+)/)
    if (price) {
      const id = decodeURIComponent(price[1])
      return PRICE_PRODUCTS[id]
        ? answer(200, { id, product: PRICE_PRODUCTS[id] })
        : answer(404, { error: { message: 'No such price' } })
    }
    if (href.includes('/subscriptions?customer=')) {
      return answer(200, {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            currency: 'usd',
            current_period_end: 1793194709,
            automatic_tax: { enabled: true },
            collection_method: 'charge_automatically',
            // The $0 Starter: a discount from a code limited to Starter.
            discounts: ['di_starter_free'],
            items: {
              data: [
                { id: 'si_plan', price: { id: planPriceId, recurring: { interval: planPriceId.endsWith('yearly') ? 'year' : 'month' } } },
                { id: 'si_metered', price: { id: 'price_metered_usage', recurring: { interval: 'month' } } },
              ],
            },
          },
        ],
      })
    }
    if (href.includes('/invoices/upcoming')) {
      // Pro yearly at 40% off, less the unused (free) Starter time.
      return answer(200, {
        amount_due: 35280,
        currency: 'usd',
        automatic_tax: { status: 'complete' },
        lines: { data: [{ proration: true, amount: 35280, tax_amounts: [] }] },
      })
    }
    if (href.includes('/subscriptions/sub_1') && method === 'POST') {
      return answer(200, {
        status: 'active',
        items: { data: [] },
        latest_invoice: {
          id: 'in_1',
          status: 'paid',
          amount_due: 35280,
          currency: 'usd',
          payment_intent: { status: 'succeeded' },
        },
      })
    }
    if (href.includes('/subscription_schedules')) {
      return answer(200, { id: 'sub_sched_1', phases: [{ items: [] }] })
    }
    throw new Error(`unexpected fetch: ${method} ${href}`)
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('an upgrade with the offer’s code', () => {
  it('prices the preview with the code, in place of the discount it has', async () => {
    const response = await call({
      action: 'preview',
      plan: 'pro',
      interval: 'year',
      promotionCode: 'PRO40',
    })
    expect(response.status).toBe(200)
    expect(upcoming()?.get('discounts[0][promotion_code]')).toBe('promo_pro40')
    expect(upcoming()?.get('subscription_items[0][price]')).toBe('price_pro_yearly')
    const payload = await response.json()
    expect(payload).toMatchObject({
      chargesNow: true,
      chargedNowCents: 35280,
      promotionCodeApplied: 'PRO40',
      promotionCodePercentOff: 40,
      promotionCodeDuration: 'repeating',
      promotionCodeDurationInMonths: 12,
      promotionCodeBasePriceOnly: false,
      promotionCodeReplacesDiscount: true,
    })
  })

  it('replaces the subscription’s discounts on the switch itself', async () => {
    const response = await call({
      action: 'switch',
      plan: 'pro',
      interval: 'year',
      promotionCode: 'PRO40',
    })
    expect(response.status).toBe(200)
    const body = itemUpdate()
    expect(body?.get('items[0][price]')).toBe('price_pro_yearly')
    // An absolute list: the Starter discount is gone, the offer's code is it.
    expect(body?.get('discounts[0][promotion_code]')).toBe('promo_pro40')
    expect([...(body?.keys() ?? [])].filter((key) => key.startsWith('discounts'))).toEqual([
      'discounts[0][promotion_code]',
    ])
    // Charged now and held until paid, the code with it (AGL-3358).
    expect(body?.get('payment_behavior')).toBe('pending_if_incomplete')
    expect((await response.json()).promotionCodeApplied).toBe('PRO40')
  })

  it('takes a code limited to the target plan’s base price', async () => {
    coupon = { ...coupon, applies_to: { products: ['prod_pro'] } }
    const response = await call({ action: 'switch', plan: 'pro', interval: 'year', promotionCode: 'PRO40' })
    expect(response.status).toBe(200)
    expect(itemUpdate()?.get('discounts[0][promotion_code]')).toBe('promo_pro40')
  })
})

describe('a code the switch cannot take', () => {
  it('refuses a code limited to another plan, with the plan it is for, and changes nothing', async () => {
    coupon = { ...coupon, applies_to: { products: ['prod_starter'] } }
    const response = await call({ action: 'switch', plan: 'pro', interval: 'year', promotionCode: 'PRO40' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'This code is for the Starter plan.',
      promotionCodeRefusal: 'plan',
    })
    expect(subscriptionPosts()).toEqual([])
    expect(upcoming()).toBeNull()
  })

  it('refuses a code Stripe does not know, before pricing anything', async () => {
    coupon = null
    const response = await call({ action: 'preview', plan: 'pro', interval: 'year', promotionCode: 'NOPE' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/do not recognize the code/)
    expect(upcoming()).toBeNull()
  })

  it('refuses a code on a move down, which waits for the period end', async () => {
    planPriceId = 'price_pro_monthly'
    mockOrgGet.mockResolvedValue({
      get: (field: string) => (field === 'plan' ? 'pro' : 'acme'),
      data: () => ({ plan: 'pro' }),
      ref: { id: 'org-1', set: async () => undefined },
    })
    const response = await call({ action: 'switch', plan: 'starter', promotionCode: 'PRO40' })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('promotion_code_on_downgrade')
    expect(stripeCalls.some((c) => c.href.includes('/subscription_schedules'))).toBe(false)
    expect(stripeCalls.some((c) => c.href.includes('/promotion_codes'))).toBe(false)
  })

  it('refuses a code on the plan and cadence already held', async () => {
    const response = await call({ action: 'switch', plan: 'starter', interval: 'month', promotionCode: 'PRO40' })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('promotion_code_needs_change')
    expect(subscriptionPosts()).toEqual([])
  })
})

describe('no code is today’s switch', () => {
  it('sends no discount and reads no code', async () => {
    const response = await call({ action: 'switch', plan: 'pro', interval: 'year' })
    expect(response.status).toBe(200)
    expect([...(itemUpdate()?.keys() ?? [])].some((key) => /discount|coupon|promotion/.test(key))).toBe(false)
    expect(upcoming()?.has('discounts[0][promotion_code]')).toBe(false)
    expect(stripeCalls.some((c) => c.href.includes('/promotion_codes'))).toBe(false)
    const payload = await response.json()
    expect(payload.promotionCodeApplied).toBeUndefined()
  })
})
