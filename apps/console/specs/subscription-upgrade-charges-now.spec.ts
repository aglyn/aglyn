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
 * AN UPGRADE IS PAID FOR BEFORE IT IS GRANTED (AGL-3358).
 *
 * Production, 2026-09-26: an org paid $56 for Pro and switched Pro → Business
 * → Scale → Advanced the same day. Every switch was `create_prorations`, so
 * each difference was filed as a pending invoice item for the renewal a month
 * out, while this route wrote `plan: 'advanced'` onto the org the moment the
 * Stripe update returned. $337.55 of Advanced was used before any of it was
 * billed — and the account was a fraudster, so "pay for the cheapest plan once,
 * switch to the top one" was a free month of the top plan.
 *
 * Pinned here:
 *
 * - a switch that costs more is `always_invoice` + `pending_if_incomplete`,
 *   so it is charged now and Stripe holds it until paid;
 * - the org's `plan` moves only when Stripe reports the update APPLIED;
 * - a 3DS challenge and a decline each answer `paymentPending` with what the
 *   page needs, and write no plan;
 * - a switch that nets a credit keeps the old mechanic, charging nothing.
 *
 * No live Stripe call happens here: `fetch` is mocked per endpoint and the
 * captured request bodies plus the route's answer are the assertion surface.
 * The Stripe semantics the mocks model (`pending_update` on an unpaid invoice,
 * `automatic_tax` refused beside `pending_if_incomplete`) were measured against
 * a TEST-mode account.
 */

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
  isLiveSubscriptionStatus: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isLiveSubscriptionStatus,
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
  STRIPE_PRICE_PRO: 'price_pro_monthly',
  STRIPE_PRICE_BUSINESS: 'price_business_monthly',
  STRIPE_PRICE_ADVANCED: 'price_advanced_monthly',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_yearly',
  STRIPE_PRICE_METERED: 'price_metered_usage',
}

const PLAN_ITEM = {
  id: 'si_plan',
  price: { id: 'price_pro_monthly', recurring: { interval: 'month' } },
}
const METERED_ITEM = {
  id: 'si_metered',
  price: { id: 'price_metered_usage', recurring: { interval: 'month' } },
}

/** The live subscription's automatic tax, as Stripe serializes it. */
let automaticTax: { enabled: boolean }
let collectionMethod: 'charge_automatically' | 'send_invoice'
/** The proration lines the `always_invoice` preview answers with. */
let previewLines: Array<{ proration: boolean; amount: number }>
let previewAmountDue: number
/** What `POST subscriptions/sub_1` answers — the outcome of the charge. */
let updateAnswer: Record<string, unknown>
let stripeCalls: Array<{ href: string; method: string; body: string }>
/** Everything `org.ref.set` was handed — the org doc's `plan` lives here. */
let orgWrites: Array<Record<string, unknown>>

const PAID_UPDATE = {
  status: 'active',
  cancel_at_period_end: false,
  pending_update: null,
  items: { data: [] },
  latest_invoice: {
    id: 'in_paid',
    status: 'paid',
    amount_due: 34355,
    currency: 'usd',
    hosted_invoice_url: 'https://invoice.stripe.com/i/paid',
    payment_intent: { status: 'succeeded', client_secret: 'pi_paid_secret' },
  },
}

/** The shape measured in test mode on an always-authenticate card. */
const HELD_FOR_3DS = {
  status: 'active',
  cancel_at_period_end: false,
  metadata: { plan: 'pro' },
  pending_update: {
    expires_at: 1790685512,
    metadata: { plan: 'advanced' },
    subscription_items: [{ id: 'si_plan', price: { id: 'price_advanced_monthly' } }],
  },
  items: { data: [PLAN_ITEM, METERED_ITEM] },
  latest_invoice: {
    id: 'in_held',
    status: 'open',
    amount_due: 34355,
    currency: 'usd',
    hosted_invoice_url: 'https://invoice.stripe.com/i/held',
    payment_intent: {
      status: 'requires_action',
      client_secret: 'pi_held_secret_abc',
    },
  },
}

/** The shape measured in test mode on a card that declines. */
const HELD_DECLINED = {
  ...HELD_FOR_3DS,
  latest_invoice: {
    ...HELD_FOR_3DS.latest_invoice,
    payment_intent: {
      status: 'requires_payment_method',
      client_secret: 'pi_declined_secret',
      last_payment_error: { code: 'card_declined' },
    },
  },
}

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

/** Every `POST subscriptions/sub_1`, bodies decoded, in order. */
function subscriptionPosts(): URLSearchParams[] {
  return stripeCalls
    .filter((c) => c.method === 'POST' && c.href.includes('/subscriptions/sub_1'))
    .map((c) => new URLSearchParams(c.body))
}

/** The update that carries the item change (the one with `items[0][id]`). */
function itemUpdate(): URLSearchParams | undefined {
  return subscriptionPosts().find((body) => body.get('items[0][id]'))
}

/** Every `plan` value written onto the org doc. */
function planWrites(): unknown[] {
  return orgWrites.filter((w) => 'plan' in w).map((w) => w.plan)
}

beforeEach(() => {
  automaticTax = { enabled: true }
  collectionMethod = 'charge_automatically'
  // Pro → Advanced mid-cycle: a credit for Pro's unused time and a charge
  // for Advanced's remaining time, netting positive.
  previewLines = [
    { proration: true, amount: -3733 },
    { proration: true, amount: 38088 },
  ]
  previewAmountDue = 34355
  updateAnswer = PAID_UPDATE
  stripeCalls = []
  orgWrites = []
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockOrgGet.mockResolvedValue({
    get: (field: string) => (field === 'plan' ? 'pro' : 'acme'),
    ref: {
      id: 'org-1',
      set: async (value: Record<string, unknown>) => {
        orgWrites.push(value)
      },
    },
  })
  mockWriteOrgBilling.mockReset()
  mockWriteOrgBilling.mockResolvedValue(undefined)
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    stripeCalls.push({
      href,
      method: String(init?.method ?? 'GET'),
      body: String(init?.body ?? ''),
    })
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            currency: 'usd',
            current_period_end: 1793194709,
            automatic_tax: automaticTax,
            collection_method: collectionMethod,
            items: { data: [PLAN_ITEM, METERED_ITEM] },
          },
        ],
      }
    } else if (href.includes('/subscriptions/sub_1')) {
      const body = new URLSearchParams(String(init?.body ?? ''))
      // Stripe's own refusal, reproduced: the pending-update call cannot carry
      // `automatic_tax`.
      if (
        body.get('payment_behavior') === 'pending_if_incomplete' &&
        body.has('automatic_tax[enabled]')
      ) {
        return {
          ok: false,
          json: async () => ({
            error: { message: '`automatic_tax` is not supported.' },
          }),
        }
      }
      payload = body.get('items[0][id]') ? updateAnswer : { status: 'active' }
    } else if (href.includes('/invoices/upcoming')) {
      payload = {
        amount_due: previewAmountDue,
        currency: 'usd',
        automatic_tax: { status: 'complete' },
        lines: { data: previewLines },
      }
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

describe('an upgrade is charged now and held until paid (AGL-3358)', () => {
  it('updates with always_invoice + pending_if_incomplete, never create_prorations', async () => {
    const post = loadSubscription()
    const response = await call(post, { action: 'switch', plan: 'advanced' })
    expect(response.status).toBe(200)
    const body = itemUpdate()
    expect(body?.get('items[0][price]')).toBe('price_advanced_monthly')
    expect(body?.get('proration_behavior')).toBe('always_invoice')
    expect(body?.get('payment_behavior')).toBe('pending_if_incomplete')
    expect(body?.get('expand[]')).toBe('latest_invoice.payment_intent')
    // The metadata the webhook projects `plan` from rides the SAME call, so
    // Stripe holds it in `pending_update` along with the items.
    expect(body?.get('metadata[plan]')).toBe('advanced')
  })

  it('prices the change first, under the same always_invoice mechanic', async () => {
    const post = loadSubscription()
    await call(post, { action: 'switch', plan: 'advanced' })
    const preview = stripeCalls.find((c) => c.href.includes('/invoices/upcoming'))
    expect(preview).toBeDefined()
    const query = new URL(String(preview?.href)).searchParams
    expect(query.get('subscription_proration_behavior')).toBe('always_invoice')
    // And before anything was written to Stripe.
    const previewAt = stripeCalls.indexOf(preview as never)
    const firstPost = stripeCalls.findIndex((c) => c.method === 'POST')
    expect(previewAt).toBeLessThan(firstPost)
  })

  it('a PAID upgrade moves the plan and reports what it charged', async () => {
    const post = loadSubscription()
    const payload = await (
      await call(post, { action: 'switch', plan: 'advanced' })
    ).json()
    expect(payload.ok).toBe(true)
    expect(payload.plan).toBe('advanced')
    expect(payload.chargedNowCents).toBe(34355)
    expect(payload.paymentPending).toBeUndefined()
    expect(planWrites()).toEqual(['advanced'])
  })

  it('THE LEAK: an upgrade held for 3DS writes NO plan and hands back the challenge', async () => {
    updateAnswer = HELD_FOR_3DS
    const post = loadSubscription()
    const response = await call(post, { action: 'switch', plan: 'advanced' })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(planWrites()).toEqual([])
    expect(payload.ok).toBe(false)
    expect(payload.paymentPending).toBe(true)
    expect(payload.plan).toBe('pro')
    expect(payload.pendingPlan).toBe('advanced')
    expect(payload.requiresAction).toBe(true)
    expect(payload.paymentClientSecret).toBe('pi_held_secret_abc')
    expect(payload.hostedInvoiceUrl).toBe('https://invoice.stripe.com/i/held')
    expect(payload.chargedNowCents).toBe(34355)
    // Nor is the price mirrored onto the billing doc as though it had moved.
    for (const [, patch] of mockWriteOrgBilling.mock.calls) {
      expect(patch?.subscription?.priceId).toBeUndefined()
    }
  })

  it('THE LEAK: a declined upgrade writes NO plan and says it was declined', async () => {
    updateAnswer = HELD_DECLINED
    const post = loadSubscription()
    const payload = await (
      await call(post, { action: 'switch', plan: 'advanced' })
    ).json()
    expect(planWrites()).toEqual([])
    expect(payload.paymentPending).toBe(true)
    expect(payload.declined).toBe(true)
    expect(payload.requiresAction).toBeUndefined()
    expect(payload.paymentClientSecret).toBeUndefined()
  })

  it('a month → year move that raises the amount due is charged the same way', async () => {
    // Pro monthly → Pro yearly: the unused month credited against the
    // year's charge, netting positive.
    previewLines = [
      { proration: true, amount: -3733 },
      { proration: true, amount: 55733 },
    ]
    previewAmountDue = 52000
    const post = loadSubscription()
    await call(post, { action: 'switch', plan: 'pro', interval: 'year' })
    const body = itemUpdate()
    expect(body?.get('items[0][price]')).toBe('price_pro_yearly')
    expect(body?.get('proration_behavior')).toBe('always_invoice')
    expect(body?.get('payment_behavior')).toBe('pending_if_incomplete')
  })

  it('turns automatic tax on in a call of its own, BEFORE the charge, when Stripe reports it off', async () => {
    automaticTax = { enabled: false }
    const post = loadSubscription()
    const response = await call(post, { action: 'switch', plan: 'advanced' })
    // The mock refuses `automatic_tax` beside `pending_if_incomplete`, as
    // Stripe does; a 200 means the two were kept apart.
    expect(response.status).toBe(200)
    const posts = subscriptionPosts()
    expect(posts).toHaveLength(2)
    expect(posts[0].get('automatic_tax[enabled]')).toBe('true')
    expect(posts[0].get('proration_behavior')).toBe('none')
    expect(posts[0].get('items[0][id]')).toBeNull()
    expect(posts[1].get('payment_behavior')).toBe('pending_if_incomplete')
    expect(posts[1].has('automatic_tax[enabled]')).toBe(false)
  })

  it('makes no tax call when the subscription already has it', async () => {
    const post = loadSubscription()
    await call(post, { action: 'switch', plan: 'advanced' })
    expect(subscriptionPosts()).toHaveLength(1)
  })
})

describe('an invoiced (net-terms) subscription', () => {
  it('is invoiced now, without the payment condition Stripe offers only to charged ones', async () => {
    // Enterprise agreements staff provision on send-invoice terms: capability
    // applies when the invoice is sent, by design, and Stripe refuses a
    // pending update on them.
    collectionMethod = 'send_invoice'
    const post = loadSubscription()
    const response = await call(post, { action: 'switch', plan: 'advanced' })
    expect(response.status).toBe(200)
    const body = itemUpdate()
    expect(body?.get('proration_behavior')).toBe('always_invoice')
    expect(body?.get('payment_behavior')).toBeNull()
  })
})

describe('a switch that owes nothing today keeps its old mechanic', () => {
  it('a net credit is create_prorations, with no payment condition and no charge', async () => {
    previewLines = [
      { proration: true, amount: -38088 },
      { proration: true, amount: 3733 },
    ]
    previewAmountDue = 0
    const post = loadSubscription()
    const payload = await (
      await call(post, { action: 'switch', plan: 'business' })
    ).json()
    const body = itemUpdate()
    expect(body?.get('proration_behavior')).toBe('create_prorations')
    expect(body?.get('payment_behavior')).toBeNull()
    expect(body?.get('automatic_tax[enabled]')).toBe('true')
    expect(payload.ok).toBe(true)
    expect(payload.chargedNowCents).toBeUndefined()
  })
})

describe('the preview says what the switch will take, and when', () => {
  it('an upgrade quotes chargesNow with the amount due now', async () => {
    const post = loadSubscription()
    const payload = await (
      await call(post, { action: 'preview', plan: 'advanced' })
    ).json()
    expect(payload.prorationCents).toBe(34355)
    expect(payload.chargesNow).toBe(true)
    expect(payload.chargedNowCents).toBe(34355)
  })

  it('a credit quotes nothing charged now', async () => {
    previewLines = [{ proration: true, amount: -2000 }]
    previewAmountDue = 0
    const post = loadSubscription()
    const payload = await (
      await call(post, { action: 'preview', plan: 'business' })
    ).json()
    expect(payload.chargesNow).toBe(false)
    expect(payload.chargedNowCents).toBe(0)
  })
})
