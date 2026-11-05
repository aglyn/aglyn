/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * A staff coupon can be limited to a plan's base price (AGL-4159).
 *
 * The vehicle for "this plan's base price free (or discounted), while
 * add-ons, usage past the plan's limits and a move to another plan still
 * bill": a real subscription with a coupon Stripe applies only to the plan's
 * product (`applies_to[products]`). Every add-on and the metered usage item
 * is a different product, so the discount cannot reach them.
 *
 * Pinned here: the mint parameters with and without a limit, the product read
 * from the deployment's own price env (never an id in the code), a clear
 * refusal when that env is unset, the audit row, the list row's label, and
 * the full-use rating held to the limited plan.
 *
 * NO LIVE STRIPE WRITE HAPPENS HERE: `fetch` is replaced wholesale.
 */

// A module, not a script: these names are shared with other route suites.
export {}

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          add: async (row: unknown) => mockAuditAdd(name, row),
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } },
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  DISCOUNT_APPROVAL_THRESHOLD_PCT: 40,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      body: request.method === 'GET' ? undefined : await request.json().catch(() => ({})),
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(
        [...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
      ),
    }
  },
}))

const { GET, POST } = require('../app/api/admin/coupons/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}
const {
  COUPON_PLAN_CHOICES,
  couponAppliesToLabel,
  couponFullUse,
  couponListRow,
} = require('../utils/coupon-list-query')

/** Every Stripe call the handler made, in order. */
let stripeCalls: Array<{ path: string; method: string; body: string | null }>
/** Each configured price id → the product Stripe holds it on. */
let priceProducts: Record<string, string>
/** Price ids Stripe answers with an error. */
let failingPrices: Set<string>
/** The coupons and codes the list reads. */
let stripeCoupons: any[]

const ORIGINAL_ENV = process.env

beforeEach(() => {
  jest.clearAllMocks()
  stripeCalls = []
  failingPrices = new Set()
  stripeCoupons = []
  // A deployment's own price ids, as its env holds them. No Aglyn id.
  const clean = { ...ORIGINAL_ENV }
  for (const key of Object.keys(clean)) if (key.startsWith('STRIPE_')) delete clean[key]
  process.env = {
    ...clean,
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
    STRIPE_PRICE_STARTER: 'price_starter_month',
    STRIPE_PRICE_STARTER_YEARLY: 'price_starter_year',
    STRIPE_PRICE_PRO: 'price_pro_month',
    STRIPE_PRICE_PRO_YEARLY: 'price_pro_year',
  } as NodeJS.ProcessEnv
  priceProducts = {
    price_starter_month: 'prod_starter',
    price_starter_year: 'prod_starter',
    price_pro_month: 'prod_pro',
    price_pro_year: 'prod_pro',
  }
  mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    const method = init.method ?? 'GET'
    stripeCalls.push({ path, method, body: init.body ?? null })
    const answer = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
    })
    if (path.startsWith('prices/')) {
      const id = decodeURIComponent(path.slice('prices/'.length))
      if (failingPrices.has(id) || !priceProducts[id]) {
        return answer(404, { error: { message: `No such price: '${id}'` } })
      }
      return answer(200, { id, object: 'price', product: priceProducts[id] })
    }
    if (method === 'POST' && path === 'coupons') {
      const sent = new URLSearchParams(String(init.body ?? ''))
      const products = [...sent.entries()]
        .filter(([key]) => key.startsWith('applies_to[products]'))
        .map(([, value]) => value)
      return answer(200, {
        id: 'cpn_new',
        name: sent.get('name'),
        percent_off: Number(sent.get('percent_off')) || null,
        duration: sent.get('duration'),
        duration_in_months: Number(sent.get('duration_in_months')) || null,
        valid: true,
        // Stripe answers `applies_to` only when it was expanded.
        ...(sent.get('expand[]') === 'applies_to'
          ? { applies_to: products.length ? { products } : null }
          : {}),
      })
    }
    if (path.startsWith('coupons?')) {
      return answer(200, { object: 'list', data: stripeCoupons, has_more: false })
    }
    if (path.startsWith('promotion_codes?')) {
      return answer(200, { object: 'list', data: [], has_more: false })
    }
    return answer(500, { error: { message: `unexpected ${method} ${path}` } })
  })
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

const create = (body: Record<string, unknown>) =>
  POST(
    new Request('https://console.aglyn.com/api/admin/coupons', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Partnership',
        percentOff: 100,
        duration: 'forever',
        confirmHighDiscount: true,
        ...body,
      }),
    }),
  )

/** The coupon create Stripe was sent, as form fields. */
const mintParams = () => {
  const call = stripeCalls.find((one) => one.method === 'POST' && one.path === 'coupons')
  return call ? new URLSearchParams(String(call.body)) : null
}

const limitedProducts = (params: URLSearchParams | null) =>
  [...(params?.entries() ?? [])]
    .filter(([key]) => key.startsWith('applies_to[products]'))
    .map(([key, value]) => `${key}=${value}`)

const auditAfter = () => mockAuditAdd.mock.calls[0]?.[1]?.after

describe('minting a coupon for the whole subscription (the default)', () => {
  it('sends no product limit and reads no plan price', async () => {
    const response = await create({})
    expect(response.status).toBe(200)
    expect(limitedProducts(mintParams())).toEqual([])
    expect(mintParams()?.get('metadata[appliesTo]')).toBeNull()
    expect(stripeCalls.map((call) => call.path)).toEqual(['coupons'])
    expect(auditAfter()).toMatchObject({
      appliesTo: 'subscription',
      appliesToPlans: null,
      appliesToProducts: null,
    })
    expect((await response.json()).coupon.appliesTo).toBeNull()
  })

  it('is what an explicit `subscription` asks for too', async () => {
    const response = await create({ appliesTo: 'subscription' })
    expect(response.status).toBe(200)
    expect(limitedProducts(mintParams())).toEqual([])
  })
})

describe('minting a coupon for one plan’s base price', () => {
  it('limits it to that plan’s product, read from the plan’s own price env', async () => {
    const response = await create({ appliesTo: 'base_price', plan: 'starter' })
    expect(response.status).toBe(200)
    // Both of the plan's prices are read for their product; nothing else is.
    expect(
      stripeCalls.filter((call) => call.path.startsWith('prices/')).map((call) => call.path).sort(),
    ).toEqual(['prices/price_starter_month', 'prices/price_starter_year'])
    const params = mintParams()
    // One product: the monthly and yearly prices share it.
    expect(limitedProducts(params)).toEqual(['applies_to[products][0]=prod_starter'])
    expect(params?.get('metadata[appliesTo]')).toBe('base_price')
    expect(params?.get('metadata[plans]')).toBe('starter')
    expect(params?.get('percent_off')).toBe('100')
    expect(params?.get('duration')).toBe('forever')

    const payload = await response.json()
    expect(payload.coupon.appliesTo).toEqual({ products: ['prod_starter'], plans: ['starter'] })
    // Rated on Starter alone: Pro is not where the code can be redeemed.
    expect(payload.fullUse.worst.plan).toBe('starter')
    expect(payload.fullUse.worst.label).toMatch(/^Starter, /)
    expect(auditAfter()).toMatchObject({
      couponId: 'cpn_new',
      appliesTo: 'base_price',
      appliesToPlans: ['starter'],
      appliesToProducts: ['prod_starter'],
    })
  })

  it('works with a repeating duration: the first 24 months free, then billing starts', async () => {
    const response = await create({
      appliesTo: 'base_price',
      plan: 'pro',
      duration: 'repeating',
      durationInMonths: 24,
    })
    expect(response.status).toBe(200)
    const params = mintParams()
    expect(params?.get('duration')).toBe('repeating')
    expect(params?.get('duration_in_months')).toBe('24')
    expect(limitedProducts(params)).toEqual(['applies_to[products][0]=prod_pro'])
  })

  it('keeps both products when the monthly and yearly prices sit on different ones', async () => {
    priceProducts.price_starter_year = 'prod_starter_annual'
    await create({ appliesTo: 'base_price', plan: 'starter' })
    expect(limitedProducts(mintParams()).sort()).toEqual([
      'applies_to[products][0]=prod_starter',
      'applies_to[products][1]=prod_starter_annual',
    ])
  })

  it('reads the yearly price alone when only it is configured', async () => {
    delete process.env.STRIPE_PRICE_STARTER
    const response = await create({ appliesTo: 'base_price', plan: 'starter' })
    expect(response.status).toBe(200)
    expect(limitedProducts(mintParams())).toEqual(['applies_to[products][0]=prod_starter'])
  })

  it('refuses, naming the env, when the plan has no price configured', async () => {
    delete process.env.STRIPE_PRICE_PRO
    delete process.env.STRIPE_PRICE_PRO_YEARLY
    const response = await create({ appliesTo: 'base_price', plan: 'pro' })
    expect(response.status).toBe(501)
    const { error } = await response.json()
    expect(error).toContain('STRIPE_PRICE_PRO')
    expect(error).toContain('STRIPE_PRICE_PRO_YEARLY')
    // Never minted unlimited instead.
    expect(stripeCalls).toEqual([])
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('refuses rather than mint unlimited when Stripe cannot read the plan’s price', async () => {
    failingPrices.add('price_starter_year')
    const response = await create({ appliesTo: 'base_price', plan: 'starter' })
    expect(response.status).toBe(502)
    expect((await response.json()).error).toContain('STRIPE_PRICE_STARTER')
    expect(mintParams()).toBeNull()
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('refuses a plan no coupon can be limited to, before asking Stripe anything', async () => {
    for (const plan of ['business', 'enterprise', 'free', 'nope']) {
      stripeCalls = []
      const response = await create({ appliesTo: 'base_price', plan })
      expect(response.status).toBe(400)
      expect(stripeCalls).toEqual([])
    }
    expect(COUPON_PLAN_CHOICES).toEqual(['starter', 'pro'])
  })

  it('refuses a plan named on a whole-subscription coupon, and an unknown choice', async () => {
    expect((await create({ appliesTo: 'subscription', plan: 'starter' })).status).toBe(400)
    expect((await create({ appliesTo: 'metered' })).status).toBe(400)
    expect(stripeCalls).toEqual([])
  })
})

describe('minting a coupon for the base price of any plan', () => {
  it('limits it to every sold plan’s product', async () => {
    const response = await create({ appliesTo: 'base_price' })
    expect(response.status).toBe(200)
    expect(limitedProducts(mintParams()).sort()).toEqual([
      'applies_to[products][0]=prod_starter',
      'applies_to[products][1]=prod_pro',
    ])
    expect(mintParams()?.get('metadata[plans]')).toBe('starter,pro')
    const { coupon } = await response.json()
    expect(coupon.appliesTo.plans).toEqual(['starter', 'pro'])
    expect(couponAppliesToLabel(coupon)).toBe('Base price, any plan')
  })

  it('reaches the plans this deployment sells, and refuses when it sells none', async () => {
    delete process.env.STRIPE_PRICE_PRO
    delete process.env.STRIPE_PRICE_PRO_YEARLY
    await create({ appliesTo: 'base_price' })
    expect(limitedProducts(mintParams())).toEqual(['applies_to[products][0]=prod_starter'])

    delete process.env.STRIPE_PRICE_STARTER
    delete process.env.STRIPE_PRICE_STARTER_YEARLY
    stripeCalls = []
    const response = await create({ appliesTo: 'base_price' })
    expect(response.status).toBe(501)
    expect(stripeCalls).toEqual([])
  })
})

describe('the existing-coupons list shows what each coupon applies to', () => {
  const coupon = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: id,
    percent_off: 100,
    duration: 'forever',
    times_redeemed: 0,
    valid: true,
    applies_to: null,
    ...over,
  })

  const list = async () =>
    (
      await (
        await GET(
          new Request('https://console.aglyn.com/api/admin/coupons', {
            headers: { Authorization: 'Bearer tok' },
          }),
        )
      ).json()
    ).coupons

  it('reads `applies_to` and names each limited coupon’s plans', async () => {
    stripeCoupons = [
      coupon('cpn_whole'),
      coupon('cpn_starter', { applies_to: { products: ['prod_starter'] } }),
      coupon('cpn_any', { applies_to: { products: ['prod_starter', 'prod_pro'] } }),
      coupon('cpn_other', { applies_to: { products: ['prod_somewhere_else'] } }),
    ]
    const rows = await list()
    expect(stripeCalls[0].path).toContain('expand[]=data.applies_to')
    expect(rows.map((row: any) => [row.id, row.appliesTo])).toEqual([
      ['cpn_whole', null],
      ['cpn_starter', { products: ['prod_starter'], plans: ['starter'] }],
      ['cpn_any', { products: ['prod_starter', 'prod_pro'], plans: ['starter', 'pro'] }],
      ['cpn_other', { products: ['prod_somewhere_else'], plans: [] }],
    ])
    expect(rows.map((row: any) => couponAppliesToLabel(couponListRow(row)))).toEqual([
      'Whole subscription',
      'Base price, Starter',
      'Base price, any plan',
      'Products no plan uses',
    ])
  })

  it('reads no plan price when no coupon is limited', async () => {
    stripeCoupons = [coupon('cpn_whole')]
    await list()
    expect(stripeCalls.some((call) => call.path.startsWith('prices/'))).toBe(false)
  })

  it('still lists, unnamed, when a plan’s price cannot be read', async () => {
    delete process.env.STRIPE_PRICE_PRO
    delete process.env.STRIPE_PRICE_PRO_YEARLY
    stripeCoupons = [coupon('cpn_pro', { applies_to: { products: ['prod_pro'] } })]
    const rows = await list()
    expect(rows[0].appliesTo).toEqual({ products: ['prod_pro'], plans: [] })
  })
})

describe('the full-use rating of a limited coupon', () => {
  const row = (appliesTo: unknown) => ({
    percentOff: 100,
    amountOffUsd: null,
    duration: 'forever',
    durationInMonths: null,
    appliesTo,
  })

  it('judges a one-plan coupon on that plan only, both intervals', () => {
    const verdict = couponFullUse(row({ products: ['prod_starter'], plans: ['starter'] }))
    expect(verdict.cases.map((one: any) => `${one.plan}/${one.interval}`)).toEqual([
      'starter/month',
      'starter/year',
    ])
  })

  it('judges a whole-subscription coupon on every paid plan', () => {
    const verdict = couponFullUse(row(null))
    expect(new Set(verdict.cases.map((one: any) => one.plan))).toEqual(new Set(['starter', 'pro']))
  })

  it('judges a coupon no plan uses on every paid plan, the cautious reading', () => {
    const verdict = couponFullUse(row({ products: ['prod_x'], plans: [] }))
    expect(verdict.cases).toHaveLength(4)
  })
})
