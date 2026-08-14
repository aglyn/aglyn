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
 * A plan switch turns automatic tax ON (AGL-1537).
 *
 * Checkout has created subscriptions with `automatic_tax` since AGL-1133 —
 * but a subscription created BEFORE that keeps billing untaxed forever unless
 * an update enables it, and the switch/preview route is where existing
 * subscriptions get updated. Without this, exactly the customers who
 * subscribed earliest are the ones whose upgrades bypass tax.
 *
 * No live Stripe call happens here: `fetch` is mocked per-endpoint and the
 * captured update body / preview URL are the assertion surface.
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
  STRIPE_PRICE_METERED: 'price_metered_usage',
}

/** The subscription the mocked Stripe returns; tests override `items`. */
let subscriptionItems: any[] = []
let capturedUpdateBody: URLSearchParams | null = null
let capturedPreviewUrl: string | null = null

/**
 * The route snapshots `PRICE_ENV` at module load, so env has to be in place
 * BEFORE the require — which is also why this is a require and not an import.
 */
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

const PLAN_ITEM = {
  id: 'si_plan',
  price: { id: 'price_starter_monthly', recurring: { interval: 'month' } },
}
const METERED_ITEM = {
  id: 'si_metered',
  price: { id: 'price_metered_usage', recurring: { interval: 'month' } },
}

beforeEach(() => {
  subscriptionItems = [PLAN_ITEM, METERED_ITEM]
  capturedUpdateBody = null
  capturedPreviewUrl = null
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockOrgGet.mockResolvedValue({
    get: () => 'acme',
    ref: { id: 'org-1', set: async () => undefined },
  })
  mockWriteOrgBilling.mockResolvedValue(undefined)
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          { id: 'sub_1', status: 'active', items: { data: subscriptionItems } },
        ],
      }
    } else if (href.includes('/subscriptions/sub_1')) {
      capturedUpdateBody = new URLSearchParams(String(init?.body ?? ''))
      payload = {
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [] },
      }
    } else if (href.includes('/invoices/upcoming')) {
      capturedPreviewUrl = href
      payload = { amount_due: 2500, currency: 'usd', lines: { data: [] } }
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

describe('a plan switch enables automatic tax (AGL-1537)', () => {
  it('sends automatic_tax on the subscription UPDATE', async () => {
    const post = loadSubscription()
    const response = await call(post, {
      action: 'switch',
      plan: 'pro',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    expect(capturedUpdateBody?.get('automatic_tax[enabled]')).toBe('true')
  })

  it('previews under the SAME tax setting the switch applies', async () => {
    // Otherwise a taxed customer is quoted one number and charged another.
    const post = loadSubscription()
    const response = await call(post, {
      action: 'preview',
      plan: 'pro',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    // The query is hand-assembled, so assert on the decoded parameter.
    const query = new URL(String(capturedPreviewUrl)).searchParams
    expect(query.get('automatic_tax[enabled]')).toBe('true')
    expect(query.get('subscription_proration_behavior')).toBe(
      'create_prorations',
    )
  })

  it('PIN — tax rides ALONGSIDE the existing switch shape', async () => {
    // The re-pricing this route already does must not move: the plan item
    // re-prices to the target (AGL-528/1340) and the interval-matched metered
    // item stays put (AGL-1280). Pinned so a tax refactor that disturbs
    // either goes red here rather than on a customer's invoice.
    const post = loadSubscription()
    await call(post, { action: 'switch', plan: 'pro', interval: 'month' })
    expect(capturedUpdateBody?.get('items[0][id]')).toBe('si_plan')
    expect(capturedUpdateBody?.get('items[0][price]')).toBe('price_pro_monthly')
    // The matching monthly metered item needs no change — and gets none.
    expect(capturedUpdateBody?.get('items[1][id]')).toBeNull()
    expect(capturedUpdateBody?.get('metadata[plan]')).toBe('pro')
    expect(capturedUpdateBody?.get('proration_behavior')).toBe(
      'create_prorations',
    )
  })

  it('PIN — a subscription without the metered item still gains it', async () => {
    // AGL-635: a plan switch is where pre-metered subscriptions pick up the
    // usage item. The tax flag must not displace that.
    subscriptionItems = [PLAN_ITEM]
    const post = loadSubscription()
    await call(post, { action: 'switch', plan: 'pro', interval: 'month' })
    expect(capturedUpdateBody?.get('items[0][price]')).toBe('price_pro_monthly')
    expect(capturedUpdateBody?.get('items[1][price]')).toBe(
      'price_metered_usage',
    )
    expect(capturedUpdateBody?.get('automatic_tax[enabled]')).toBe('true')
  })
})
