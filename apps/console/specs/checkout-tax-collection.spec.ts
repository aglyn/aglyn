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
 * Checkout collects sales tax (AGL-1133 wired it, AGL-1537 turned Stripe Tax
 * on for the live account).
 *
 * The tax parameters are load-bearing as a SET: `automatic_tax` without
 * `billing_address_collection: required` reports `requires_location_inputs`
 * and silently charges no tax, and a REUSED customer without
 * `customer_update[address]=auto` resolves its tax location from the customer
 * record — which may hold no address at all. So this suite pins the whole
 * parameter set, not just the flag.
 *
 * No live Stripe call happens here: `fetch` is mocked and the captured request
 * body is the assertion surface.
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
  // Inert: this suite tests the tax parameter set; the checkout feature gate
  // (AGL-1510) has its own specs.
  featureLockdownRefusal: async () => null,
  memberHasOrgPermission: async () => true,
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
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
  STRIPE_PRICE_METERED: 'price_metered_usage',
}

let capturedBody: URLSearchParams | null = null

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

function checkout(post: (request: Request) => Promise<Response>) {
  return post(
    new Request('https://app.aglyn.com/api/billing/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ plan: 'starter', interval: 'month', orgId: 'org-1' }),
    }),
  )
}

beforeEach(() => {
  capturedBody = null
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'owner@example.com',
    email_verified: true,
  })
  mockOrgGet.mockResolvedValue({ get: () => 'acme' })
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_test_1' })
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

describe('checkout charges sales tax (AGL-1133 / AGL-1537)', () => {
  it('enables automatic tax on every session', async () => {
    const post = loadCheckout()
    const response = await checkout(post)
    expect(response.status).toBe(200)
    expect(capturedBody?.get('automatic_tax[enabled]')).toBe('true')
  })

  it('collects the address and tax id automatic tax depends on', async () => {
    // `automatic_tax` on a session with no address reports
    // `requires_location_inputs` and charges NOTHING — it looks enabled and
    // quietly collects no tax. `required` is the prerequisite, not polish.
    const post = loadCheckout()
    await checkout(post)
    expect(capturedBody?.get('billing_address_collection')).toBe('required')
    expect(capturedBody?.get('tax_id_collection[enabled]')).toBe('true')
  })

  it('saves the collected address onto a REUSED customer (AGL-1537)', async () => {
    // An existing customer's tax location comes from the CUSTOMER record;
    // without `customer_update[address]=auto` a stored-address-less customer
    // makes the automatic_tax session unresolvable.
    const post = loadCheckout()
    await checkout(post)
    expect(capturedBody?.get('customer')).toBe('cus_test_1')
    expect(capturedBody?.get('customer_update[address]')).toBe('auto')
  })

  it('CONTROL — a first subscribe sends customer_email and NO customer_update', async () => {
    // Stripe rejects `customer_update` on a session without a `customer`, so
    // leaking it onto the first-purchase path would break every first
    // subscribe.
    mockReadOrgBilling.mockResolvedValue({})
    const post = loadCheckout()
    const response = await checkout(post)
    expect(response.status).toBe(200)
    expect(capturedBody?.get('customer_email')).toBe('owner@example.com')
    expect(capturedBody?.get('customer')).toBeNull()
    expect(capturedBody?.get('customer_update[address]')).toBeNull()
  })

  it('PIN — tax params ride ALONGSIDE the existing session shape', async () => {
    // The tax work must not disturb what checkout already sends: the plan
    // price, the metered usage item (AGL-635/1280), and the promo-code field
    // (AGL-1105) are pinned here exactly so a tax refactor that drops one
    // goes red in this suite rather than in production.
    const post = loadCheckout()
    await checkout(post)
    expect(capturedBody?.get('line_items[0][price]')).toBe(
      'price_starter_monthly',
    )
    expect(capturedBody?.get('line_items[1][price]')).toBe('price_metered_usage')
    expect(capturedBody?.get('allow_promotion_codes')).toBe('true')
    expect(capturedBody?.get('mode')).toBe('subscription')
    expect(capturedBody?.get('subscription_data[metadata][orgId]')).toBe('org-1')
  })
})
