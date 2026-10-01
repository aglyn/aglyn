/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * "UPDATE PAYMENT METHOD" OPENS STRIPE'S PAYMENT-METHOD FLOW (AGL-3442).
 *
 * Billing's button asks `/api/billing/subscription` for a portal session with
 * `flow: 'payment_method_update'`. What the customer meets is decided by the
 * parameters the route sends to `billing_portal/sessions`, so those are the
 * assertion surface: the flow type, and a redirect back to Billing once the
 * method is saved rather than on to the portal's home page.
 *
 * The control is the plain `portal` action, which must still open the whole
 * portal for the Outstanding card's dunning link. And the refusal: the only
 * flow a caller may name is this one, so a request cannot reach the portal's
 * subscription-update or cancel flows around the plan switch and the
 * retention funnel.
 */

export {}

const mockVerifyIdToken = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              get: (field: string) => (field === 'slug' ? 'acme' : undefined),
            }),
          }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  writeOrgBilling: async () => undefined,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
  // The REAL route table, so the return URL is the one Billing lives at.
  buildRoute: jest.requireActual('@aglyn/aglyn/app-utils/console-routes').buildRoute,
  Route: jest.requireActual('@aglyn/aglyn/app-utils/console-routes').Route,
  isCustomPricedPlan: () => false,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json(),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      origin: 'https://app.aglyn.com',
      host: 'app.aglyn.com',
    },
  }),
  SELF_SERVE_PLANS: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
    .SELF_SERVE_PLANS,
  PLAN_PRICING: {},
  POS_REGISTER_ADDON_MONTHLY_USD: 89,
  EVENT_CALENDAR_ADDON_MONTHLY_USD: 9,
}))

/** Env without a trace of the developer's own Stripe config. */
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

/** Every Stripe request the route made, as path + decoded form body. */
let stripeCalls: Array<{ path: string; params: URLSearchParams }>

function loadSubscription() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, STRIPE_SECRET_KEY: 'sk_test_fake' } as NodeJS.ProcessEnv
  return require('../app/api/billing/subscription/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function call(body: Record<string, unknown>) {
  return loadSubscription()(
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

beforeEach(() => {
  stripeCalls = []
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    stripeCalls.push({
      path: String(url).replace('https://api.stripe.com/v1/', ''),
      params: new URLSearchParams(String(init?.body ?? '')),
    })
    return {
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://billing.stripe.com/p/session/test_1' }),
    }
  }) as never
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('the Update payment method session (AGL-3442)', () => {
  it('opens the portal on the payment-method flow and returns to Billing when it is done', async () => {
    const response = await call({ action: 'portal', flow: 'payment_method_update' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      url: 'https://billing.stripe.com/p/session/test_1',
    })
    expect(stripeCalls.map((c) => c.path)).toEqual(['billing_portal/sessions'])
    const params = stripeCalls[0].params
    expect(params.get('customer')).toBe('cus_test_1')
    expect(params.get('flow_data[type]')).toBe('payment_method_update')
    expect(params.get('flow_data[after_completion][type]')).toBe('redirect')
    expect(params.get('flow_data[after_completion][redirect][return_url]')).toBe(
      'https://app.aglyn.com/acme/billing',
    )
    // Leaving without saving returns to the same place.
    expect(params.get('return_url')).toBe('https://app.aglyn.com/acme/billing')
  })

  it('CONTROL — the plain portal action still opens the whole portal', async () => {
    // The Outstanding card's dunning link. A route that always sent the flow
    // would pass the case above and take that link's portal away.
    const response = await call({ action: 'portal' })

    expect(response.status).toBe(200)
    const params = stripeCalls[0].params
    expect(params.get('return_url')).toBe('https://app.aglyn.com/acme/billing')
    expect([...params.keys()].filter((key) => key.startsWith('flow_data'))).toEqual([])
  })

  it('REFUSAL — names no other flow, and no flow on another action', async () => {
    for (const body of [
      { action: 'portal', flow: 'subscription_cancel' },
      { action: 'portal', flow: 'subscription_update' },
      { action: 'cancel', flow: 'payment_method_update' },
    ]) {
      const response = await call(body)
      expect({ body, status: response.status }).toEqual({ body, status: 400 })
    }
    // Refused before anything reached Stripe.
    expect(stripeCalls).toEqual([])
  })
})
