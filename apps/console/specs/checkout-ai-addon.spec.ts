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
 * The Aglyn AI add-on is sold WITH the plan (AGL-2897), as a tier (AGL-3965).
 *
 * A visitor who clicks the add-on CTA on /pricing arrives at the Billing page
 * with `?plan=pro&interval=month&ai=1` (or `&ai=<tier>`), and the page posts
 * `aiAddon: true` (and `aiTier`) to this route. The add-on becomes a second
 * recurring item on the same subscription — after the metered item,
 * quantity 1 — so the webhook mirrors it onto `seatAddons.aiAddon` and
 * `aiTier` exactly as a later purchase through `/api/billing/addons` would,
 * and the quote on the plan card carries it. `aiAddon: true` with no tier is
 * the tier with the plan's old price and band (Pro's is Boost), so a link
 * published before tiers still sells what it quoted.
 *
 * What cannot happen: the route selling the plan and quietly dropping the
 * add-on. An unconfigured price is refused by name, and a dead one is named
 * by the price-fault reader at the index the add-on actually occupied.
 *
 * Harness lifted from `checkout-metered-interval.spec.ts`. No live Stripe
 * call happens: `fetch` is mocked and the captured request is the assertion.
 */

const mockVerifyIdToken = jest.fn()
const mockOrgGet = jest.fn()

const mockAttemptDocs = new Map<string, Record<string, unknown>>()

function mockAttemptDocRef(id: string) {
  return {
    create: async (data: Record<string, unknown>) => {
      if (mockAttemptDocs.has(id)) throw new Error('ALREADY_EXISTS')
      mockAttemptDocs.set(id, { ...data })
    },
    get: async () => ({
      get: (field: string) => mockAttemptDocs.get(id)?.[field],
    }),
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      mockAttemptDocs.set(
        id,
        options?.merge ? { ...(mockAttemptDocs.get(id) ?? {}), ...data } : { ...data },
      )
    },
    delete: async () => {
      mockAttemptDocs.delete(id)
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) =>
          name === 'apiIdempotency'
            ? { doc: (id: string) => mockAttemptDocRef(id) }
            : { doc: () => ({ get: () => mockOrgGet() }) },
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  featureLockdownRefusal: async () => null,
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  isServerReleaseFlagOnForOrg: async () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan model: `addonUnitUsd('aiAddon', plan, tier)` reads
  // `AI_TIERS` and `planSellsAiTiers` to decide whether the plan sells a tier
  // at all, and a stub would make that decision about nothing.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  claimAttempt: jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
    .claimAttempt,
  isOrgSubscriptionLive: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isOrgSubscriptionLive,
  isLiveSubscriptionStatus: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isLiveSubscriptionStatus,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  isReleaseFlagOn: () => false,
  pluginRequestFromWeb: async (
    request: Request,
    params?: Record<string, string | string[]>,
  ) => {
    const real = await jest
      .requireActual('@aglyn/aglyn/app-utils/api-adapter')
      .pluginRequestFromWeb(request, params)
    return {
      ...real,
      headers: {
        origin: 'https://app.aglyn.com',
        host: 'app.aglyn.com',
        ...real.headers,
      },
    }
  },
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
  STRIPE_PRICE_PRO: 'price_pro_monthly',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_yearly',
}
const METERED = {
  STRIPE_PRICE_METERED: 'price_metered_usage',
  STRIPE_PRICE_METERED_YEARLY: 'price_metered_usage_yearly',
}
const AI_ADDON = {
  STRIPE_PRICE_AI_BOOST: 'price_ai_boost',
  STRIPE_PRICE_AI_BOOST_YEARLY: 'price_ai_boost_yearly',
  STRIPE_PRICE_AI_STUDIO: 'price_ai_studio',
  STRIPE_PRICE_AI_STUDIO_YEARLY: 'price_ai_studio_yearly',
}

/** Every Stripe request the route made, in order. */
let stripeCalls: Array<{ href: string; body: URLSearchParams }> = []
/** What `POST /v1/subscriptions` answers; swapped to a refusal in one case. */
let subscriptionAnswer: { ok: boolean; payload: unknown }

function loadCheckout(env: Record<string, string> = {}) {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...PLAN_PRICES, ...env } as NodeJS.ProcessEnv
  return require('../app/api/billing/checkout/route').POST as (
    request: Request,
  ) => Promise<Response>
}

let attemptSeq = 0

function post(
  handler: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
) {
  return handler(
    new Request('https://app.aglyn.com/api/billing/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
        'Idempotency-Key': `attempt-${++attemptSeq}`,
      },
      body: JSON.stringify({ plan: 'pro', interval: 'month', orgId: 'org-1', ...body }),
    }),
  )
}

/** The body of the one `POST /v1/subscriptions`, or null when none was made. */
function subscribeBody(): URLSearchParams | null {
  return stripeCalls.find((call) => /\/v1\/subscriptions$/.test(call.href))?.body ?? null
}

/** The query of the one `GET /v1/invoices/upcoming`, or null. */
function previewQuery(): URLSearchParams | null {
  const call = stripeCalls.find((entry) => entry.href.includes('/invoices/upcoming'))
  return call ? new URL(call.href).searchParams : null
}

beforeEach(() => {
  stripeCalls = []
  mockAttemptDocs.clear()
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockOrgGet.mockResolvedValue({ get: () => 'acme' })
  subscriptionAnswer = {
    ok: true,
    payload: {
      id: 'sub_1',
      status: 'active',
      latest_invoice: {
        subtotal: 7500,
        tax: 0,
        total: 7500,
        currency: 'usd',
        automatic_tax: { status: 'complete' },
        payment_intent: { status: 'succeeded', client_secret: 'pi_secret' },
      },
    },
  }
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    stripeCalls.push({ href, body: new URLSearchParams(String(init?.body ?? '')) })
    if (/\/customers\//.test(href)) {
      return {
        ok: true,
        json: async () => ({
          invoice_settings: { default_payment_method: 'pm_saved_1' },
          address: { country: 'US' },
          tax_ids: { data: [] },
        }),
      }
    }
    if (href.includes('/invoices/upcoming')) {
      return {
        ok: true,
        json: async () => ({
          subtotal: 7500,
          tax: 0,
          total: 7500,
          currency: 'usd',
          automatic_tax: { status: 'complete' },
        }),
      }
    }
    return { ok: subscriptionAnswer.ok, json: async () => subscriptionAnswer.payload }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('the Aglyn AI add-on is sold with the plan (AGL-2897)', () => {
  it('attaches the add-on after the metered item, quantity 1', async () => {
    const handler = loadCheckout({ ...METERED, ...AI_ADDON })
    const response = await post(handler, { aiAddon: true })
    expect(response.status).toBe(200)
    const body = subscribeBody()
    expect(body?.get('items[0][price]')).toBe('price_pro_monthly')
    expect(body?.get('items[1][price]')).toBe('price_metered_usage')
    expect(body?.get('items[2][price]')).toBe('price_ai_boost')
    expect(body?.get('items[2][quantity]')).toBe('1')
  })

  it('sells the tier named, on any paid plan: Studio with Pro', async () => {
    const handler = loadCheckout({ ...METERED, ...AI_ADDON })
    const response = await post(handler, { aiAddon: true, aiTier: 'studio' })
    expect(response.status).toBe(200)
    expect(subscribeBody()?.get('items[2][price]')).toBe('price_ai_studio')
  })

  it('a tier alone is the ask: `aiTier` without `aiAddon` still sells it', async () => {
    const handler = loadCheckout({ ...METERED, ...AI_ADDON })
    await post(handler, { aiTier: 'studio', interval: 'year' })
    expect(subscribeBody()?.get('items[2][price]')).toBe('price_ai_studio_yearly')
  })

  it('refuses a tier that does not exist rather than guessing one', async () => {
    const handler = loadCheckout({ ...METERED, ...AI_ADDON })
    const response = await post(handler, { aiAddon: true, aiTier: 'mega' })
    expect(response.status).toBe(400)
    expect(subscribeBody()).toBeNull()
  })

  it('refuses a tier on a plan that sells none', async () => {
    const handler = loadCheckout({ ...METERED, ...AI_ADDON })
    const response = await post(handler, { plan: 'free', aiAddon: true })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(subscribeBody()).toBeNull()
  })

  it('follows the annual interval — one recurring.interval per subscription', async () => {
    const handler = loadCheckout({ ...METERED, ...AI_ADDON })
    await post(handler, { aiAddon: true, interval: 'year' })
    const body = subscribeBody()
    expect(body?.get('items[0][price]')).toBe('price_pro_yearly')
    expect(body?.get('items[2][price]')).toBe('price_ai_boost_yearly')
  })

  it('takes slot [1] when no metered price is configured', async () => {
    const handler = loadCheckout(AI_ADDON)
    await post(handler, { aiAddon: true })
    const body = subscribeBody()
    expect(body?.get('items[1][price]')).toBe('price_ai_boost')
    expect(body?.get('items[1][quantity]')).toBe('1')
    expect(body?.get('items[2][price]')).toBeNull()
  })

  it('is not attached unless asked for', async () => {
    const handler = loadCheckout({ ...METERED, ...AI_ADDON })
    await post(handler, {})
    const body = subscribeBody()
    expect(body?.get('items[2][price]')).toBeNull()
    expect(body?.toString()).not.toContain('price_ai_')
  })

  it('quotes the add-on on the same preview invoice as the plan', async () => {
    const handler = loadCheckout({ ...METERED, ...AI_ADDON })
    const response = await post(handler, { action: 'preview', aiAddon: true })
    expect(response.status).toBe(200)
    const query = previewQuery()
    expect(query?.get('subscription_details[items][0][price]')).toBe('price_pro_monthly')
    expect(query?.get('subscription_details[items][2][price]')).toBe('price_ai_boost')
    expect(query?.get('subscription_details[items][2][quantity]')).toBe('1')
    expect(subscribeBody()).toBeNull()
  })

  it('refuses by env name when the add-on price is unset — never sells the plan without it', async () => {
    const handler = loadCheckout(METERED)
    const response = await post(handler, { aiAddon: true })
    expect(response.status).toBe(501)
    expect((await response.json()).error).toContain('STRIPE_PRICE_AI_BOOST')
    // Nothing reached Stripe: a refusal above the claim burns no attempt.
    expect(subscribeBody()).toBeNull()
    // The yearly variant is named for an annual request, and the tier asked
    // for rather than the plan's default.
    const annual = await post(loadCheckout(METERED), { aiAddon: true, aiTier: 'studio', interval: 'year' })
    expect((await annual.json()).error).toContain('STRIPE_PRICE_AI_STUDIO_YEARLY')
  })

  it('names the add-on env, not the plan or metered one, when Stripe rejects its price', async () => {
    // The real shape of a dead id (AGL-1137), at the index the add-on took.
    subscriptionAnswer = {
      ok: false,
      payload: {
        error: {
          code: 'resource_missing',
          param: 'items[2][price]',
          message: "No such price: 'price_ai_boost'",
        },
      },
    }
    const handler = loadCheckout({ ...METERED, ...AI_ADDON })
    const response = await post(handler, { aiAddon: true })
    expect(response.status).toBe(501)
    const { error } = await response.json()
    expect(error).toContain('STRIPE_PRICE_AI_BOOST')
    expect(error).not.toContain('STRIPE_PRICE_METERED')
  })
})

// Top-level consts collide across spec files unless the file is a module.
export {}
