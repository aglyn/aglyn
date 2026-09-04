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
 * The subscribe path CONFIRMS its PaymentIntent, and only then talks about SCA.
 *
 * ## What was actually wrong
 *
 * `payment_behavior: default_incomplete` leaves the first invoice's
 * PaymentIntent unconfirmed on purpose. Nothing confirmed it. Driven against
 * real test-mode subscriptions:
 *
 *   - an ORDINARY saved card (`pm_card_visa`) produced an intent at
 *     `requires_confirmation` and a subscription stuck at `incomplete` — no
 *     charge, ever;
 *   - the route flagged `requires_confirmation` as `requiresAction` and handed
 *     the secret to `stripe.handleNextAction`, which THREW
 *     `IntegrationError: handleNextAction: The PaymentIntent supplied is not
 *     in the requires_action state`. The page catches that as "Could not start
 *     checkout".
 *
 * So the SCA fix that landed earlier — `handleNextAction` instead of
 * `confirmPayment` — named the right method for a state this route never
 * reached. Confirming server-side is what produces that state: an ordinary
 * card goes straight to `succeeded` and the subscription activates, and a 3DS
 * card moves to `requires_action` with a real next action for the browser to
 * run.
 *
 * ## What is NOT asserted here
 *
 * That anyone is entitled to anything. `succeeded` means Stripe took the
 * money; the plan is mirrored onto the org by the webhook and by nothing in
 * this handler.
 */

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
  featureLockdownRefusal: async () => null,
  memberHasOrgPermission: async () => true,
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  isServerReleaseFlagOnForOrg: async () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
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
}

/** Every Stripe path the route called, in order. */
let stripeCalls: string[]

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

/**
 * A Stripe double that behaves the way the real one was OBSERVED to behave:
 * a `default_incomplete` subscription answers with an UNCONFIRMED intent, and
 * the confirm endpoint is what moves it on.
 */
function stripeWhereConfirmYields(confirmedStatus: string) {
  global.fetch = jest.fn(async (url: unknown) => {
    const href = String(url)
    if (/\/customers\//.test(href)) {
      return {
        ok: true,
        json: async () => ({
          invoice_settings: { default_payment_method: 'pm_saved_1' },
          address: { country: 'US' },
        }),
      }
    }
    if (/\/payment_intents\/[^/]+\/confirm$/.test(href)) {
      stripeCalls.push('confirm')
      return {
        ok: true,
        json: async () => ({
          id: 'pi_1',
          status: confirmedStatus,
          client_secret: 'pi_1_secret',
          ...(confirmedStatus === 'requires_action'
            ? { next_action: { type: 'use_stripe_sdk' } }
            : {}),
        }),
      }
    }
    stripeCalls.push('subscriptions')
    return {
      ok: true,
      json: async () => ({
        id: 'sub_1',
        status: 'incomplete',
        latest_invoice: {
          subtotal: 2500,
          tax: 165,
          total: 2665,
          currency: 'usd',
          automatic_tax: { status: 'complete' },
          // As Stripe really answers: unconfirmed, no next action yet.
          payment_intent: {
            id: 'pi_1',
            status: 'requires_confirmation',
            client_secret: 'pi_1_secret',
          },
        },
      }),
    }
  }) as never
}

beforeEach(() => {
  stripeCalls = []
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'owner@example.com',
    email_verified: true,
  })
  mockOrgGet.mockResolvedValue({ get: () => 'acme' })
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_test_1' })
  stripeWhereConfirmYields('succeeded')
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('the first invoice is confirmed server-side', () => {
  it('confirms the intent the subscription left unconfirmed', async () => {
    const post = loadCheckout()
    const response = await subscribe(post)
    expect(response.status).toBe(200)
    // The confirm happened, and AFTER the subscription that created the
    // intent — the order is the whole mechanism.
    expect(stripeCalls).toEqual(['subscriptions', 'confirm'])
  })

  it('an ordinary card needs NO browser step at all', async () => {
    // `succeeded` on confirm. Sending `requiresAction` here would put a
    // customer through a challenge their bank never asked for — and, before
    // the confirm existed, through a method that throws.
    const post = loadCheckout()
    const payload = await (await subscribe(post)).json()
    expect(payload.requiresAction).toBeUndefined()
    expect(payload.paymentClientSecret).toBeUndefined()
    expect(payload.declined).toBeUndefined()
  })

  it('a 3DS card is handed the secret, in the ONE state handleNextAction accepts', async () => {
    stripeWhereConfirmYields('requires_action')
    const post = loadCheckout()
    const payload = await (await subscribe(post)).json()
    expect(payload.requiresAction).toBe(true)
    expect(payload.paymentClientSecret).toBe('pi_1_secret')
  })

  it('CONTROL — `requires_confirmation` is never reported as an action', async () => {
    // The regression this file exists for. Stripe.js answers a
    // `requires_confirmation` intent with `IntegrationError: … not in the
    // requires_action state` — a THROW, which the page shows as a generic
    // failure. If the confirm above is ever removed, the double's unconfirmed
    // intent flows straight through and this fails.
    stripeWhereConfirmYields('requires_confirmation')
    const post = loadCheckout()
    const payload = await (await subscribe(post)).json()
    expect(payload.requiresAction).toBeUndefined()
    expect(payload.paymentClientSecret).toBeUndefined()
  })

  it('a confirm Stripe REFUSES is reported as a decline, not a server fault', async () => {
    global.fetch = jest.fn(async (url: unknown) => {
      const href = String(url)
      if (/\/customers\//.test(href)) {
        return {
          ok: true,
          json: async () => ({
            invoice_settings: { default_payment_method: 'pm_saved_1' },
            address: { country: 'US' },
          }),
        }
      }
      if (/\/payment_intents\/[^/]+\/confirm$/.test(href)) {
        return {
          ok: false,
          json: async () => ({ error: { code: 'card_declined' } }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          id: 'sub_1',
          status: 'incomplete',
          latest_invoice: {
            subtotal: 2500,
            tax: 165,
            total: 2665,
            currency: 'usd',
            automatic_tax: { status: 'complete' },
            payment_intent: {
              id: 'pi_1',
              status: 'requires_confirmation',
              client_secret: 'pi_1_secret',
            },
          },
        }),
      }
    }) as never
    const post = loadCheckout()
    const response = await subscribe(post)
    expect(response.status).toBe(200)
    const payload = await response.json()
    // The customer is told their card was declined — which is what happened —
    // rather than being sent to a challenge that cannot run.
    expect(payload.declined).toBe(true)
    expect(payload.requiresAction).toBeUndefined()
  })
})
