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
  // The checkout route resolves `release_native_checkout` through the ORG-AWARE
  // gate (AGL-2486), so this is the seam, not `getServerReleaseFlagValues`.
  // False keeps every case in these suites on the hosted redirect, which is
  // the shape they assert.
  isServerReleaseFlagOnForOrg: async () => false,
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
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    // The customer read the purchase path makes before it will charge
    // anything: it needs a stored payment method and a stored address, both
    // of which the Billing page now collects before a plan is chosen.
    if (/\/customers\//.test(href)) {
      return {
        ok: true,
        json: async () => ({
          invoice_settings: { default_payment_method: 'pm_saved_1' },
          address: { country: 'US' },
        }),
      }
    }
    capturedBody = new URLSearchParams(String(init?.body ?? ''))
    return {
      ok: true,
      json: async () => ({
        id: 'sub_1',
        status: 'active',
        latest_invoice: {
          subtotal: 2500,
          tax: 165,
          total: 2665,
          currency: 'usd',
          automatic_tax: { status: 'complete' },
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

describe('the subscription charges sales tax (AGL-1133 / AGL-1537)', () => {
  /*
   * Rewritten when Checkout was dropped. The tax POSITION did not change and
   * neither did the parameter that carries it — `automatic_tax[enabled]` was
   * always a property of the subscription rather than of the session, which is
   * precisely why removing the session cost no tax behaviour.
   *
   * What DID change is where the prerequisites come from. Checkout collected
   * the address and the tax id at purchase time via
   * `billing_address_collection` and `tax_id_collection`; now the Billing page
   * collects both before a plan is chosen, and the route REFUSES to subscribe
   * without them. Those refusals are the new form of the same guarantee, and
   * they are asserted below — an untaxed invoice in front of a tax authority
   * is the failure either way.
   */
  it('enables automatic tax on every subscription', async () => {
    const post = loadCheckout()
    const response = await checkout(post)
    expect(response.status).toBe(200)
    expect(capturedBody?.get('automatic_tax[enabled]')).toBe('true')
  })

  it('bills the customer whose address the tax is computed from', async () => {
    const post = loadCheckout()
    await checkout(post)
    expect(capturedBody?.get('customer')).toBe('cus_test_1')
    // The stored card, so there is no payment step to collect one in.
    expect(capturedBody?.get('default_payment_method')).toBe('pm_saved_1')
  })

  it('REFUSES to subscribe with no billing address, rather than billing untaxed', async () => {
    // The replacement for `billing_address_collection: required`. Without an
    // address `automatic_tax` reports `requires_location_inputs` and charges
    // NOTHING — it looks enabled and quietly collects no tax. Checkout
    // prevented that by demanding an address on the form; this prevents it by
    // refusing before Stripe is called at all.
    global.fetch = jest.fn(async (url: unknown, init: any) => {
      const href = String(url)
      if (/\/customers\//.test(href)) {
        return {
          ok: true,
          json: async () => ({
            invoice_settings: { default_payment_method: 'pm_saved_1' },
            address: null,
          }),
        }
      }
      capturedBody = new URLSearchParams(String(init?.body ?? ''))
      return { ok: true, json: async () => ({}) }
    }) as never
    const post = loadCheckout()
    const response = await checkout(post)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('billing_address_required')
    // And nothing was created: the refusal is before the subscription call.
    expect(capturedBody).toBeNull()
  })

  it('REFUSES to subscribe with no payment method', async () => {
    // Not a tax rule, but the same shape of guarantee: the flow requires the
    // pieces up front instead of collecting them on a Stripe-rendered page.
    global.fetch = jest.fn(async (url: unknown, init: any) => {
      const href = String(url)
      if (/\/customers\//.test(href)) {
        return {
          ok: true,
          json: async () => ({
            invoice_settings: {},
            address: { country: 'US' },
          }),
        }
      }
      capturedBody = new URLSearchParams(String(init?.body ?? ''))
      return { ok: true, json: async () => ({}) }
    }) as never
    const post = loadCheckout()
    const response = await checkout(post)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('payment_method_required')
    expect(capturedBody).toBeNull()
  })

  it('CONTROL — an org with no Stripe customer is refused before any Stripe call', async () => {
    // There is no `customer_email` path any more: without a customer there is
    // no address and no card, so there is nothing to charge and nothing to
    // compute tax from.
    mockReadOrgBilling.mockResolvedValue({})
    const post = loadCheckout()
    const response = await checkout(post)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('billing_details_required')
  })

  it('CONTROL — the happy path really does reach Stripe', async () => {
    // Four cases above assert a refusal before Stripe. Each is worthless if
    // the wiring made the Stripe call impossible.
    const post = loadCheckout()
    const response = await checkout(post)
    expect(response.status).toBe(200)
    expect(capturedBody).not.toBeNull()
  })
})

describe('what the session used to carry, and where it went', () => {
  it('PIN — the plan price and the metered item ride on the subscription', async () => {
    // The tax work must not disturb what the purchase already sends: the plan
    // price and the metered usage item (AGL-635/1280) are pinned here exactly
    // so a refactor that drops one goes red in this suite rather than in
    // production. They moved from `line_items[n]` to `items[n]` with the
    // session; nothing else about them changed, and the interval-matching
    // rule (AGL-1340) is what makes `meteredPriceId(interval)` the resolver.
    const post = loadCheckout()
    await checkout(post)
    expect(capturedBody?.get('items[0][price]')).toBe('price_starter_monthly')
    expect(capturedBody?.get('items[1][price]')).toBe('price_metered_usage')
    expect(capturedBody?.get('metadata[orgId]')).toBe('org-1')
    expect(capturedBody?.get('metadata[plan]')).toBe('starter')
  })

  it('opens the first invoice without charging until it is confirmed', async () => {
    // `default_incomplete` is what lets the subscription be created and then
    // authenticated: Stripe opens the first invoice and its PaymentIntent but
    // takes nothing until it is confirmed, so an issuer challenge has
    // somewhere to happen and an abandoned attempt expires on Stripe's side.
    const post = loadCheckout()
    await checkout(post)
    expect(capturedBody?.get('payment_behavior')).toBe('default_incomplete')
    expect(capturedBody?.get('expand[]')).toBe('latest_invoice.payment_intent')
  })

  it('a card is guaranteed even when nothing is due today', async () => {
    // AGL-2486's guarantee, kept in a different shape. A $0-today signup — an
    // enterprise first month free, a 100%-off promo code — must still have a
    // card on file, or the FIRST RENEWAL fails and there is nothing to
    // charge. Checkout enforced it with `payment_method_collection: always`;
    // this flow enforces it earlier and harder, by refusing to subscribe at
    // all without a stored default payment method (asserted above), and by
    // pinning that method onto the subscription so the renewal uses it.
    const post = loadCheckout()
    await checkout(post)
    expect(capturedBody?.get('default_payment_method')).toBe('pm_saved_1')
    expect(capturedBody?.get('payment_settings[save_default_payment_method]')).toBe(
      'on_subscription',
    )
  })
})
