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
 * The metered price must recur the way the plan does (AGL-1340, completed in
 * AGL-1280).
 *
 * Stripe forbids mixed `recurring.interval` on one subscription. Verified
 * read-only against LIVE Stripe with `GET /v1/invoices/upcoming` while
 * diagnosing AGL-1137: Starter monthly + monthly metered previews at $25.00,
 * Starter yearly alone at $192.00, and Starter yearly + MONTHLY metered
 * returns `invalid_request_error` — "All prices on a subscription must have
 * the same recurring.interval…".
 *
 * AGL-1340 avoided that by attaching the metered item to monthly checkouts
 * only, which left annual subscriptions with no metered item at all — metered
 * on paper, billed $0 in fact. AGL-1280 minted `aglyn_metered_usage_yearly`
 * on the same meter, so each interval now has its own price and the crash is
 * unrepresentable rather than merely avoided.
 *
 * No live Stripe call happens in this file: `fetch` is mocked and the captured
 * request body is the assertion surface.
 */

const mockVerifyIdToken = jest.fn()
const mockOrgGet = jest.fn()

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
  // Inert: this suite tests metered-price wiring; the checkout feature gate
  // (AGL-1510) has its own specs.
  featureLockdownRefusal: async () => null,
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  getServerReleaseFlagValues: async () => ({}),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
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
  // Read by utils/server/billing-addons, which checkout now imports for the
  // metered price. The plan ladder is the real one so `PAID_PLANS` derives
  // the same set it does in production.
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

const PLAN_PRICES = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_yearly',
}

let capturedBody: URLSearchParams | null = null
let warnings: unknown[][] = []

/**
 * The route snapshots `PRICE_ENV` at module load, so env has to be in place
 * BEFORE the require — which is also why this is a require and not an import.
 */
function loadCheckout(env: Record<string, string> = {}) {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...PLAN_PRICES, ...env } as NodeJS.ProcessEnv
  return require('../app/api/billing/checkout/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function checkout(
  post: (request: Request) => Promise<Response>,
  interval: 'month' | 'year',
) {
  return post(
    new Request('https://app.aglyn.com/api/billing/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ plan: 'starter', interval, orgId: 'org-1' }),
    }),
  )
}

beforeEach(() => {
  capturedBody = null
  warnings = []
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockOrgGet.mockResolvedValue({ get: () => 'acme' })
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args)
  })
  global.fetch = jest.fn(async (_url: unknown, init: any) => {
    capturedBody = new URLSearchParams(String(init?.body ?? ''))
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

const BOTH = {
  STRIPE_PRICE_METERED: 'price_metered_usage',
  STRIPE_PRICE_METERED_YEARLY: 'price_metered_usage_yearly',
}

describe('the metered usage item follows the plan interval (AGL-1340/AGL-1280)', () => {
  it('attaches the MONTHLY metered price to a monthly checkout', async () => {
    const post = loadCheckout(BOTH)
    const response = await checkout(post, 'month')
    expect(response.status).toBe(200)
    expect(capturedBody?.get('line_items[0][price]')).toBe(
      'price_starter_monthly',
    )
    expect(capturedBody?.get('line_items[1][price]')).toBe('price_metered_usage')
    expect(warnings).toHaveLength(0)
  })

  it('attaches the YEARLY metered price to an annual checkout', async () => {
    const post = loadCheckout(BOTH)
    const response = await checkout(post, 'year')
    expect(response.status).toBe(200)
    expect(capturedBody?.get('line_items[0][price]')).toBe(
      'price_starter_yearly',
    )
    expect(capturedBody?.get('line_items[1][price]')).toBe(
      'price_metered_usage_yearly',
    )
    expect(warnings).toHaveLength(0)
  })

  it('NEVER puts the monthly metered price on an annual subscription', async () => {
    // The mixed-interval crash, asserted as an absence rather than trusted to
    // the branch above: whatever else annual checkout does, `line_items[1]`
    // must not be the monthly id. Stripe rejects such a subscription outright
    // ("All prices on a subscription must have the same recurring.interval"),
    // so this is the one assertion that has to hold under any refactor.
    for (const env of [BOTH, { STRIPE_PRICE_METERED: 'price_metered_usage' }]) {
      const post = loadCheckout(env)
      await checkout(post, 'year')
      expect(capturedBody?.get('line_items[1][price]')).not.toBe(
        'price_metered_usage',
      )
    }
  })

  it('skips, and warns, when only the OTHER interval is configured', async () => {
    // Asymmetric configuration is the real fault: one interval's customers
    // bill for overage and the other's silently do not, which no screen shows.
    const post = loadCheckout({ STRIPE_PRICE_METERED: 'price_metered_usage' })
    const response = await checkout(post, 'year')
    expect(response.status).toBe(200)
    expect(capturedBody?.get('line_items[1][price]')).toBeNull()
    const note = warnings.find((args) =>
      String(args[0]).includes('metered usage item not attached'),
    )
    expect(note).toBeDefined()
    expect(JSON.stringify(note?.[1])).toContain('STRIPE_PRICE_METERED_YEARLY')
    expect((note?.[1] as { interval?: string })?.interval).toBe('year')
  })

  it('does not throw — or warn — on either interval when BOTH are unset', async () => {
    for (const interval of ['month', 'year'] as const) {
      const post = loadCheckout()
      const response = await checkout(post, interval)
      expect(response.status).toBe(200)
      expect(capturedBody?.get('line_items[1][price]')).toBeNull()
    }
    // Both unset is Stripe simply unprovisioned — a deliberate configuration,
    // not a fault: warning on it would train everyone to ignore the warning.
    expect(warnings).toHaveLength(0)
  })
})
