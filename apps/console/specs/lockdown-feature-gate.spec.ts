/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * The CHECKOUT feature gate at the ROUTE level (AGL-1510), layered exactly
 * like `lockdown-423-route-gate.spec.ts` sits on domains/detach: the
 * refusal helper (composition with the platform scope, the per-feature
 * staff-bypass map, expiry) has its unit proof in libs/tenant/data/admin —
 * what this file pins is the WIRING and the property the whole issue is
 * about, NON-INTERFERENCE:
 *
 *  - a checkout lock refuses BEFORE any Stripe call — a 423 after the
 *    session was created would be a charge wearing a refusal's clothes;
 *  - the verdict is fed the staff claim off the VERIFIED token (the
 *    no-bypass-for-checkout decision itself lives in the lib map and is
 *    unit-tested there — the route's only obligation is honest inputs);
 *  - a lock on a DIFFERENT feature (uploads) changes nothing here: the
 *    checkout flow proceeds to Stripe untouched.
 */

const mockVerifyIdToken = jest.fn()
const mockFeatureLockdownRefusal = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: async () => ({ get: () => 'acme' }) }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  featureLockdownRefusal: (...args: unknown[]) =>
    mockFeatureLockdownRefusal(...args),
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  getServerReleaseFlagValues: async () => ({}),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  isCustomPricedPlan: () => false,
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
  // Read by utils/server/billing-addons at import time (the metered price
  // ladder) — same real values checkout-metered-interval.spec.ts supplies.
  SELF_SERVE_PLANS: [
    'free',
    'starter',
    'pro',
    'business',
    'scale',
    'advanced',
    'agency',
  ],
}))

// The 423 the lib helper would build — exact shape unit-tested in
// libs/tenant/data/admin; the route's obligation is only to return it.
const CHECKOUT_LOCKED = () =>
  Response.json(
    { error: 'locked', scope: 'feature', feature: 'checkout', reason: 'manual' },
    { status: 423 },
  )

const ORIGINAL_ENV = process.env

/**
 * The route snapshots `PRICE_ENV` at module load (the
 * checkout-metered-interval.spec.ts posture), so a configured Stripe has to
 * be in the env BEFORE the require — otherwise every request 501s on
 * "billing is not configured" before the gate is ever reached.
 */
function loadCheckout() {
  jest.resetModules()
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: 'sk_test_gate',
    STRIPE_PRICE_PRO: 'price_pro_gate',
  } as NodeJS.ProcessEnv
  delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  return require('../app/api/billing/checkout/route').POST as (
    request: Request,
  ) => Promise<Response>
}

const post = () =>
  loadCheckout()(
    new Request('https://app.aglyn.com/api/billing/checkout', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ plan: 'pro', orgId: 'org-1' }),
    }),
  )

const originalFetch = global.fetch
const mockStripeFetch = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-owner',
    email: 'owner@acme.test',
    email_verified: true,
    staff: false,
  })
  mockFeatureLockdownRefusal.mockResolvedValue(null)
  mockStripeFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ url: 'https://checkout.stripe.test/session' }),
  })
  global.fetch = mockStripeFetch as unknown as typeof fetch
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = originalFetch
})

describe('AGL-1510 · the checkout feature gate on billing/checkout', () => {
  it('refuses a locked checkout with the feature 423 BEFORE any Stripe call', async () => {
    mockFeatureLockdownRefusal.mockResolvedValue(CHECKOUT_LOCKED())
    const response = await post()
    expect(response.status).toBe(423)
    expect(await response.json()).toMatchObject({
      error: 'locked',
      scope: 'feature',
      feature: 'checkout',
    })
    // The gate, not just the status: no checkout session was ever created.
    expect(mockStripeFetch).not.toHaveBeenCalled()
  })

  it('feeds the gate the checkout key and the VERIFIED staff claim', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email: 'staff@aglyn.com',
      email_verified: true,
      staff: true,
    })
    await post()
    expect(mockFeatureLockdownRefusal).toHaveBeenCalledWith({
      feature: 'checkout',
      // Off the verified token. Whether staff are bypassed is NOT the
      // route's decision — LOCKDOWN_FEATURE_STAFF_BYPASS.checkout=false
      // lives in the lib and is unit-tested there.
      staff: true,
    })
  })

  it('NON-INTERFERENCE: an uploads lock leaves checkout serving', async () => {
    // The refusal helper as it would behave with lockdowns/feature--uploads
    // set: refuse uploads, nothing else.
    mockFeatureLockdownRefusal.mockImplementation(
      async (options: { feature: string }) =>
        options.feature === 'uploads'
          ? Response.json(
              { error: 'locked', scope: 'feature', feature: 'uploads' },
              { status: 423 },
            )
          : null,
    )
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      url: 'https://checkout.stripe.test/session',
    })
    expect(mockStripeFetch).toHaveBeenCalledTimes(1)
  })

  it('a null verdict changes nothing — checkout proceeds to Stripe', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockStripeFetch).toHaveBeenCalledTimes(1)
  })
})

// Top-level consts collide across spec files unless the file is a module
// (tsc treats an import-free .ts as a global script; jest does not care).
export {}
