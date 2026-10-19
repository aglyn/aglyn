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

/**
 * A bundle checkout sells every add-on Billing sells, in one subscription
 * (AGL-3955).
 *
 * The staff bundle link and the proposal carry an `addons` map (or the link
 * form, `siteCare,extraHost:2`) and the Billing page posts it as is. Each
 * add-on becomes one more recurring item at its quantity, held to what the
 * plan sells and to its ceiling, the same `addonMaxForPlan` the add-ons card
 * sells against once the subscription exists. What cannot happen: an add-on
 * nobody can name silently left off, one the plan does not sell, more than
 * the plan allows, or the plan sold without an add-on whose price is unset.
 *
 * Harness lifted from `checkout-site-care.spec.ts`. No live Stripe call
 * happens: `fetch` is mocked and the captured request is the assertion.
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
  // The REAL plan model: `planSellsSiteCare(plan)` is the rule that keeps
  // Free from buying Site Care, and a stub would make that decision about
  // nothing.
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
// Aglyn AI is sold per tier (AGL-3965); with no tier named, Pro's purchase
// means Boost, the tier with Pro's old add-on price and band.
const AI_ADDON = {
  STRIPE_PRICE_AI_BOOST: 'price_ai_boost',
  STRIPE_PRICE_AI_BOOST_YEARLY: 'price_ai_boost_yearly',
}
const SITE_CARE = {
  STRIPE_PRICE_SITE_CARE: 'price_site_care',
  STRIPE_PRICE_SITE_CARE_YEARLY: 'price_site_care_yearly',
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

const EXTRA_HOST = {
  STRIPE_PRICE_PRO_EXTRA_HOST: 'price_pro_extra_host',
  STRIPE_PRICE_PRO_EXTRA_HOST_YEARLY: 'price_pro_extra_host_yearly',
}
const EVENT_CALENDAR = {
  STRIPE_PRICE_EVENT_CALENDAR: 'price_event_calendar',
  STRIPE_PRICE_EVENT_CALENDAR_YEARLY: 'price_event_calendar_yearly',
}
const STARTER = {
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_yearly',
  STRIPE_PRICE_STARTER_EXTRA_SEAT: 'price_starter_extra_seat',
  STRIPE_PRICE_POS_REGISTER: 'price_pos_register',
}
const EVERYTHING = { ...METERED, ...AI_ADDON, ...SITE_CARE, ...EXTRA_HOST, ...EVENT_CALENDAR }

describe('a bundle checkout sells every add-on in one subscription (AGL-3955)', () => {
  it('attaches each add-on at its quantity, the others ahead of AI and Site Care', async () => {
    const handler = loadCheckout(EVERYTHING)
    const response = await post(handler, {
      addons: { hosts: 2, eventCalendar: true, aiAddon: 1, siteCare: true },
    })
    expect(response.status).toBe(200)
    const body = subscribeBody()
    expect(body?.get('items[0][price]')).toBe('price_pro_monthly')
    expect(body?.get('items[1][price]')).toBe('price_metered_usage')
    expect(body?.get('items[2][price]')).toBe('price_pro_extra_host')
    expect(body?.get('items[2][quantity]')).toBe('2')
    expect(body?.get('items[3][price]')).toBe('price_event_calendar')
    expect(body?.get('items[3][quantity]')).toBe('1')
    expect(body?.get('items[4][price]')).toBe('price_ai_boost')
    expect(body?.get('items[5][price]')).toBe('price_site_care')
  })

  it('reads the link form the same way, and follows the annual interval', async () => {
    const handler = loadCheckout(EVERYTHING)
    await post(handler, { addons: 'siteCare,extraHost:2', interval: 'year' })
    const body = subscribeBody()
    expect(body?.get('items[0][price]')).toBe('price_pro_yearly')
    expect(body?.get('items[2][price]')).toBe('price_pro_extra_host_yearly')
    expect(body?.get('items[2][quantity]')).toBe('2')
    expect(body?.get('items[3][price]')).toBe('price_site_care_yearly')
  })

  it('keeps the two flags the Billing page sent before the map', async () => {
    const handler = loadCheckout(EVERYTHING)
    await post(handler, { addons: { hosts: 1 }, aiAddon: true, siteCare: true })
    const body = subscribeBody()
    expect(body?.get('items[2][price]')).toBe('price_pro_extra_host')
    expect(body?.get('items[3][price]')).toBe('price_ai_boost')
    expect(body?.get('items[4][price]')).toBe('price_site_care')
  })

  it('quotes the whole bundle on the same preview invoice', async () => {
    const handler = loadCheckout(EVERYTHING)
    const response = await post(handler, { action: 'preview', addons: { hosts: 3, siteCare: 1 } })
    expect(response.status).toBe(200)
    const query = previewQuery()
    expect(query?.get('subscription_details[items][2][price]')).toBe('price_pro_extra_host')
    expect(query?.get('subscription_details[items][2][quantity]')).toBe('3')
    expect(query?.get('subscription_details[items][3][price]')).toBe('price_site_care')
    expect(subscribeBody()).toBeNull()
  })

  it('refuses an add-on nobody can name rather than billing less than it shows', async () => {
    const response = await post(loadCheckout(EVERYTHING), { addons: 'siteCare,banana' })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('unknown_addon')
    expect(body.error).toContain('banana')
    expect(stripeCalls).toHaveLength(0)
  })

  it('refuses an add-on the plan does not sell', async () => {
    const response = await post(loadCheckout(STARTER), { plan: 'starter', addons: { posRegisters: 1 } })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('addon_not_sold')
    expect(body.error).toContain('POS register')
    expect(stripeCalls).toHaveLength(0)
  })

  it('refuses more than the plan allows', async () => {
    const response = await post(loadCheckout(STARTER), { plan: 'starter', addons: { managers: 4 } })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('addon_over_max')
    expect(body.error).toContain('at most 3')
    expect(stripeCalls).toHaveLength(0)
  })

  it('refuses by env name when an add-on price is unset, never selling the plan without it', async () => {
    const response = await post(loadCheckout({ ...METERED, ...SITE_CARE }), { addons: { hosts: 2 } })
    expect(response.status).toBe(501)
    const { error } = await response.json()
    expect(error).toContain('STRIPE_PRICE_PRO_EXTRA_HOST')
    expect(error).not.toContain('_YEARLY')
    expect(subscribeBody()).toBeNull()
  })

  it('names the add-on env, not the plan or AI one, when Stripe rejects its price', async () => {
    subscriptionAnswer = {
      ok: false,
      payload: {
        error: {
          code: 'resource_missing',
          param: 'items[2][price]',
          message: "No such price: 'price_pro_extra_host'",
        },
      },
    }
    const response = await post(loadCheckout(EVERYTHING), { addons: { hosts: 2, aiAddon: 1 } })
    expect(response.status).toBe(501)
    const { error } = await response.json()
    expect(error).toContain('STRIPE_PRICE_PRO_EXTRA_HOST')
    expect(error).not.toContain('STRIPE_PRICE_AI_')
    expect(error).not.toContain('STRIPE_PRICE_METERED')
  })
})

// Top-level consts collide across spec files unless the file is a module.
export {}
