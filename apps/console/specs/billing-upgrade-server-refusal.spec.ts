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
 * THE CONTROL for the in-flow collection change.
 *
 * The plan grid stopped refusing. Upgrade is clickable with nothing on file
 * and the missing pieces are collected on the way through
 * (`billing-upgrade-collects-in-flow.spec.tsx` drives that). The reason that
 * is safe rather than reckless is that the UI was never the enforcement: the
 * route refuses, and it still does.
 *
 * This file exists so that fact is asserted BESIDE the change that relies on
 * it. `checkout-tax-collection.spec.ts` pins the same two refusals from the
 * tax angle, and the duplication is deliberate — a control that lives only in
 * another file can be rewritten by someone who has no reason to know that a
 * button three directories away stopped guarding anything.
 *
 * ⚠️ Read as a pair. A flow that removed the grid's gate AND either of these
 * would have deleted the protection while looking like it moved it.
 *
 * No Stripe call happens here: `fetch` is a double and the captured request is
 * the assertion surface.
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
  // Inert: the checkout feature lockdown has its own specs and is not what
  // this control is about.
  featureLockdownRefusal: async () => null,
  memberHasOrgPermission: async () => true,
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  isServerReleaseFlagOnForOrg: async () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL helpers, not re-typed stand-ins. A hand-written copy of a
  // single-source predicate is how a guard keeps passing while the thing it
  // guards changes underneath it.
  claimAttempt: jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
    .claimAttempt,
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

/**
 * A TEST key, and it matters that it is one even though no request leaves the
 * process: this suite asserts what the route sends, and a live key in the env
 * of a spec that captures request bodies is one edit away from a real charge.
 */
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
}

/** The body POSTed to `subscriptions`, or null when nothing was created. */
let subscriptionBody: URLSearchParams | null

/** The route snapshots its price env at module load, so env precedes require. */
function loadCheckout() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/checkout/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function subscribe(post: (request: Request) => Promise<Response>) {
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

/** Answer the customer read with a given record; capture any subscription POST. */
function stripeAnswering(customer: Record<string, unknown>) {
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    if (/\/customers\//.test(String(url))) {
      return { ok: true, json: async () => customer }
    }
    subscriptionBody = new URLSearchParams(String(init?.body ?? ''))
    return {
      ok: true,
      json: async () => ({
        id: 'sub_1',
        status: 'active',
        latest_invoice: {
          subtotal: 2500,
          tax: 206,
          total: 2706,
          currency: 'usd',
          automatic_tax: { status: 'complete' },
          payment_intent: { status: 'succeeded', client_secret: 'pi_secret' },
        },
      }),
    }
  }) as never
}

beforeEach(() => {
  subscriptionBody = null
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'owner@example.com',
    email_verified: true,
  })
  mockOrgGet.mockResolvedValue({ get: () => 'acme' })
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_test_1' })
  stripeAnswering({
    invoice_settings: { default_payment_method: 'pm_saved_1' },
    address: { country: 'US' },
  })
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('the server still refuses what the button stopped refusing', () => {
  it('409 payment_method_required — no card, no subscription', async () => {
    stripeAnswering({ invoice_settings: {}, address: { country: 'US' } })
    const post = loadCheckout()
    const response = await subscribe(post)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('payment_method_required')
    // Refused BEFORE Stripe: nothing was created and nothing needs unwinding.
    expect(subscriptionBody).toBeNull()
  })

  it('409 billing_address_required — no address, no untaxed invoice', async () => {
    // Without an address `automatic_tax` reports `requires_location_inputs`
    // and charges nothing at all. It looks enabled and quietly collects no
    // tax, which is how an untaxed invoice reaches a tax authority.
    stripeAnswering({
      invoice_settings: { default_payment_method: 'pm_saved_1' },
      address: null,
    })
    const post = loadCheckout()
    const response = await subscribe(post)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('billing_address_required')
    expect(subscriptionBody).toBeNull()
  })

  it('409 billing_details_required — no Stripe customer at all', async () => {
    // The state a brand-new workspace is in before the collection flow runs.
    // There is no card and no address because there is nothing to hang them
    // on, and the route says which of the three it is.
    mockReadOrgBilling.mockResolvedValue({})
    const post = loadCheckout()
    const response = await subscribe(post)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('billing_details_required')
    expect(subscriptionBody).toBeNull()
  })

  it('CONTROL — with both on file the subscription IS created', async () => {
    // Three refusals above are worthless if the wiring made the Stripe call
    // impossible: an inert route refuses everything and passes them all.
    const post = loadCheckout()
    const response = await subscribe(post)
    expect(response.status).toBe(200)
    expect(subscriptionBody).not.toBeNull()
    expect(subscriptionBody?.get('customer')).toBe('cus_test_1')
    // The COLLECTED card, charged as the stored default rather than as a
    // one-off token for this invoice — which is what makes it a saved payment
    // method and not a checkout artefact.
    expect(subscriptionBody?.get('default_payment_method')).toBe('pm_saved_1')
    // And the tax the address is there for.
    expect(subscriptionBody?.get('automatic_tax[enabled]')).toBe('true')
  })

  it('the quote refuses a total before an address, rather than omitting tax', async () => {
    // The other half of the sequencing rule the flow depends on. A preview for
    // an addressless customer would return a confident-looking total with the
    // tax silently missing; the route answers `needsBillingAddress` instead,
    // and the quote renders a dash under "Total before tax".
    stripeAnswering({
      invoice_settings: { default_payment_method: 'pm_saved_1' },
      address: null,
    })
    const post = loadCheckout()
    const response = await post(
      new Request('https://app.aglyn.com/api/billing/checkout', {
        method: 'POST',
        headers: {
          authorization: 'Bearer tok',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'preview',
          plan: 'starter',
          interval: 'month',
          orgId: 'org-1',
        }),
      }),
    )
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.needsBillingAddress).toBe(true)
    expect(payload.preview).toBeUndefined()
  })
})
