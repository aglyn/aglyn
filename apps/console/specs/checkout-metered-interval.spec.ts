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
 * `STRIPE_PRICE_METERED` is a MONTHLY price attached to every checkout
 * (AGL-1340) — a latent annual-sales killer.
 *
 * Stripe forbids mixed `recurring.interval` on one subscription. Verified
 * read-only against LIVE Stripe with `GET /v1/invoices/upcoming` while
 * diagnosing AGL-1137: Starter monthly + metered previews at $25.00, Starter
 * yearly alone at $192.00, and Starter yearly + metered returns
 * `invalid_request_error` — "All prices on a subscription must have the same
 * recurring.interval…". Annual checkout works in production TODAY only because
 * that env var happens to be unset there, so the obvious next step (copying the
 * full price block into Vercel) would have broken every annual sale.
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

describe('the metered usage item follows the plan interval (AGL-1340)', () => {
  it('attaches it to a MONTHLY checkout when configured', async () => {
    const post = loadCheckout({ STRIPE_PRICE_METERED: 'price_metered_usage' })
    const response = await checkout(post, 'month')
    expect(response.status).toBe(200)
    expect(capturedBody?.get('line_items[0][price]')).toBe(
      'price_starter_monthly',
    )
    expect(capturedBody?.get('line_items[1][price]')).toBe('price_metered_usage')
  })

  it('leaves it off an ANNUAL checkout — the request Stripe rejects', async () => {
    const post = loadCheckout({ STRIPE_PRICE_METERED: 'price_metered_usage' })
    const response = await checkout(post, 'year')
    // The whole point: with the var SET, annual checkout still succeeds.
    expect(response.status).toBe(200)
    expect(capturedBody?.get('line_items[0][price]')).toBe(
      'price_starter_yearly',
    )
    expect(capturedBody?.get('line_items[1][price]')).toBeNull()
    // Nothing anywhere else records this, and a missing metered item means
    // reported usage never reaches an invoice — so it has to say why.
    const note = warnings.find((args) =>
      String(args[0]).includes('metered usage item not attached'),
    )
    expect(note).toBeDefined()
    expect(JSON.stringify(note?.[1])).toContain('mixed intervals')
    expect((note?.[1] as { interval?: string })?.interval).toBe('year')
  })

  it('does not throw — or warn — on either interval when the var is unset', async () => {
    for (const interval of ['month', 'year'] as const) {
      const post = loadCheckout()
      const response = await checkout(post, interval)
      expect(response.status).toBe(200)
      expect(capturedBody?.get('line_items[1][price]')).toBeNull()
    }
    // Unset is the production state and a deliberate configuration, not a
    // fault: warning on it would train everyone to ignore the warning.
    expect(warnings).toHaveLength(0)
  })
})
