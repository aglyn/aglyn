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
 * The cancellation/deletion funnel's server half (AGL-1863, under AGL-1859).
 *
 * Three surfaces, one contract:
 * - `/api/billing/retention` stores the churn survey org-scoped and mints
 *   THE bounded winback coupon — once per org, ever, with every Stripe body
 *   captured and asserted bounded (never `forever`, never 100%).
 * - `/api/billing/subscription action=cancel` keeps working without a
 *   funnelId (support ops / Stripe-dashboard parity) but RECORDS the skip.
 * - `/api/orgs/delete action=request` does the same for account deletion.
 *
 * The Firestore double models the real semantics this file depends on:
 * `create()` throws on an existing doc (the once-ever winback reservation is
 * an ALREADY_EXISTS race, not a code check), `set(merge)` merges, `doc()`
 * with no id mints a fresh id. An unfaithful fake here would fabricate
 * exactly the false greens the winback guard exists to prevent.
 */

export {}

const mockVerifyIdToken = jest.fn()

/**
 * path → data; the entire fake database.
 *
 * Every helper the `jest.mock` factory below reaches for is `mock`-prefixed on
 * purpose: the factory is hoisted above these declarations, and babel-jest
 * rejects any out-of-scope identifier that is not so named. Without the
 * prefix the whole suite fails to TRANSFORM — zero tests run, and a suite
 * that never runs looks a lot like a suite that passed.
 */
let mockStoredDocs = new Map<string, Record<string, unknown>>()
let mockAutoId = 0

function mockMakeDoc(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    create: async (data: Record<string, unknown>) => {
      if (mockStoredDocs.has(path)) {
        throw new Error(`6 ALREADY_EXISTS: ${path}`)
      }
      mockStoredDocs.set(path, { ...data })
    },
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      mockStoredDocs.set(
        path,
        options?.merge
          ? { ...(mockStoredDocs.get(path) ?? {}), ...data }
          : { ...data },
      )
    },
    update: async (data: Record<string, unknown>) => {
      if (!mockStoredDocs.has(path)) throw new Error(`5 NOT_FOUND: ${path}`)
      mockStoredDocs.set(path, { ...mockStoredDocs.get(path), ...data })
    },
    delete: async () => void mockStoredDocs.delete(path),
    get: async () => ({
      exists: mockStoredDocs.has(path) || path === 'orgs/org-1',
      id: path.split('/').pop(),
      ref: mockMakeDoc(path),
      data: () => mockStoredDocs.get(path) ?? {},
      get: (field: string) => {
        const seeded: Record<string, unknown> =
          path === 'orgs/org-1'
            ? { plan: 'pro', slug: 'acme', ownerUid: 'u-1' }
            : {}
        return (mockStoredDocs.get(path) ?? seeded)[field] ?? seeded[field]
      },
    }),
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
  }
}

function mockMakeCollection(path: string): any {
  return {
    doc: (id?: string) => mockMakeDoc(`${path}/${id ?? `auto-${++mockAutoId}`}`),
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
        collection: (name: string) => mockMakeCollection(name),
      }),
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'server-timestamp',
        delete: () => 'field-delete',
      },
    },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  writeOrgBilling: async () => undefined,
  lockdownRefusal: async () => null,
  logOrgActivity: async () => undefined,
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
  SELF_SERVE_PLANS: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
    .SELF_SERVE_PLANS,
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
  STRIPE_PRICE_PRO: 'price_pro_monthly',
}

let capturedCouponBody: URLSearchParams | null = null
let capturedSubUpdateBody: URLSearchParams | null = null

/**
 * Extra fields merged onto the live subscription the Stripe double returns —
 * how a test seeds an already-discounted subscription (AGL-2117).
 */
let subscriptionFields: Record<string, unknown> = {}

function loadRoute(path: string) {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require(path).POST as (request: Request) => Promise<Response>
}

function call(
  post: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
  options: { bearer?: boolean } = {},
) {
  const { bearer = true } = options
  return post(
    new Request('https://app.aglyn.com/api/route-under-test', {
      method: 'POST',
      headers: {
        ...(bearer ? { authorization: 'Bearer tok' } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )
}

/** Every stored doc under `orgs/org-1/retention/`. */
function retentionDocs(): Array<Record<string, unknown>> {
  return [...mockStoredDocs.entries()]
    .filter(([path]) => path.startsWith('orgs/org-1/retention/'))
    .map(([, data]) => data)
}

/** Every stored doc under `orgs/org-1/churnSurveyDetails/` (AGL-1978). */
function detailDocs(): Array<Record<string, unknown>> {
  return [...mockStoredDocs.entries()]
    .filter(([path]) => path.startsWith('orgs/org-1/churnSurveyDetails/'))
    .map(([, data]) => data)
}

beforeEach(() => {
  mockStoredDocs = new Map()
  mockAutoId = 0
  capturedCouponBody = null
  capturedSubUpdateBody = null
  subscriptionFields = {}
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            current_period_end: 1767225600,
            items: { data: [] },
            ...subscriptionFields,
          },
        ],
      }
    } else if (href.endsWith('/coupons')) {
      capturedCouponBody = new URLSearchParams(String(init?.body ?? ''))
      payload = { id: 'coupon_winback_1' }
    } else if (href.includes('/subscriptions/sub_1')) {
      capturedSubUpdateBody = new URLSearchParams(String(init?.body ?? ''))
      payload = { id: 'sub_1', status: 'active', cancel_at_period_end: true }
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

describe('/api/billing/retention — survey (AGL-1863)', () => {
  const ROUTE = '../app/api/billing/retention/route'

  it('answers 401 unauthenticated — same posture as every billing route', async () => {
    const post = loadRoute(ROUTE)
    const response = await call(post, { action: 'survey' }, { bearer: false })
    expect(response.status).toBe(401)
  })

  it('stores the survey org-scoped and hands back the funnelId', async () => {
    const post = loadRoute(ROUTE)
    const response = await call(post, {
      action: 'survey',
      surface: 'subscription_cancel',
      reason: 'too_expensive',
      detail: '  the pro tier price jumped  ',
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(typeof payload.funnelId).toBe('string')
    const docs = retentionDocs()
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      kind: 'churn_survey',
      surface: 'subscription_cancel',
      reason: 'too_expensive',
      plan: 'pro',
      uid: 'u-1',
    })
    // The free text moved off the survey document (AGL-1978) so it can
    // expire without taking the reason breakdown with it.
    expect(docs[0].detail).toBeUndefined()
    expect(detailDocs()[0]).toMatchObject({
      detail: 'the pro tier price jumped',
    })
  })

  it('refuses a reason outside the closed set', async () => {
    const post = loadRoute(ROUTE)
    const response = await call(post, {
      action: 'survey',
      surface: 'subscription_cancel',
      reason: 'because',
    })
    expect(response.status).toBe(400)
    expect(retentionDocs()).toHaveLength(0)
  })

  it('refuses an unknown surface', async () => {
    const post = loadRoute(ROUTE)
    const response = await call(post, {
      action: 'survey',
      surface: 'checkout',
      reason: 'other',
    })
    expect(response.status).toBe(400)
  })

  it('caps the free-text detail at the bound', async () => {
    const post = loadRoute(ROUTE)
    await call(post, {
      action: 'survey',
      surface: 'account_delete',
      reason: 'other',
      detail: 'x'.repeat(2000),
    })
    const [doc] = detailDocs()
    expect(String(doc.detail).length).toBe(500)
  })

  it('the free text carries an expiry, and the SURVEY does not', async () => {
    // The separation, asserted in both directions (AGL-1978). An expiry on
    // the survey would reap the `reason` breakdown the retention funnel
    // exists to produce — Zach's twice-given directive — and a survey with
    // no expiry on its free text is the gap this closes. Testing only one
    // side would pass while the other silently regressed.
    const post = loadRoute(ROUTE)
    const before = Date.now()
    await call(post, {
      action: 'survey',
      surface: 'subscription_cancel',
      reason: 'other',
      detail: 'my card number is on file and I want it gone',
    })

    const [survey] = retentionDocs()
    expect(survey.expiresAt).toBeUndefined()

    const [detail] = detailDocs()
    // A Date, not an epoch number: a TTL policy silently governs nothing
    // when handed a number (`bookings.expiresAtMs` is the documented
    // non-target).
    expect(detail.expiresAt).toBeInstanceOf(Date)
    const ahead = (detail.expiresAt as Date).getTime() - before
    const day = 24 * 60 * 60 * 1000
    // 365 days, allowing for the clock moving during the call. The lower
    // bound is what fails if the period is ever zeroed or stamped in the
    // past — the within-period control for this collection.
    expect(ahead).toBeGreaterThan(364 * day)
    expect(ahead).toBeLessThanOrEqual(366 * day)
  })

  it('a survey with no free text writes no detail document at all', async () => {
    // Absent stays absent. An empty-string detail document would be a
    // retention record of nothing, and would make the collection's count a
    // lie about how many people actually typed something.
    const post = loadRoute(ROUTE)
    await call(post, {
      action: 'survey',
      surface: 'subscription_cancel',
      reason: 'not_using_enough',
    })
    expect(retentionDocs()).toHaveLength(1)
    expect(detailDocs()).toHaveLength(0)
  })
})

describe('/api/billing/retention — winback (AGL-1863 / AGL-1620)', () => {
  const ROUTE = '../app/api/billing/retention/route'

  it('mints a BOUNDED coupon and applies it server-side', async () => {
    const post = loadRoute(ROUTE)
    const response = await call(post, { action: 'winback', funnelId: 'f-1' })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.percentOff).toBe(50)
    expect(payload.durationMonths).toBe(2)

    // The Stripe body is the boundary that matters: time-boxed, capped,
    // single-redemption — never `forever`, never 100%.
    expect(capturedCouponBody?.get('duration')).toBe('repeating')
    expect(capturedCouponBody?.get('duration_in_months')).toBe('2')
    expect(capturedCouponBody?.get('percent_off')).toBe('50')
    expect(capturedCouponBody?.get('max_redemptions')).toBe('1')
    expect(capturedCouponBody?.get('duration')).not.toBe('forever')

    // Applied to the live subscription, not handed out as a code.
    expect(capturedSubUpdateBody?.get('discounts[0][coupon]')).toBe(
      'coupon_winback_1',
    )

    // The reservation doc records what was granted.
    const winback = mockStoredDocs.get('orgs/org-1/retention/winback')
    expect(winback).toMatchObject({
      kind: 'winback_applied',
      couponId: 'coupon_winback_1',
      percentOff: 50,
      durationMonths: 2,
    })
  })

  it('is once per org, EVER — the second request loses at the database', async () => {
    const post = loadRoute(ROUTE)
    const first = await call(post, { action: 'winback' })
    expect(first.status).toBe(200)
    capturedCouponBody = null
    const second = await call(post, { action: 'winback' })
    expect(second.status).toBe(409)
    // And no second coupon was minted.
    expect(capturedCouponBody).toBeNull()
  })

  it('GUARD IS WIRED — unbounded constants refuse at the route, before Stripe', async () => {
    // The mint site promises the assert "stays in the live path so a future
    // edit that unbounds the constants fails every request loudly instead of
    // minting quietly". Nothing proved that: replacing the call with a no-op
    // — `((_c: any) => undefined)({...})` — left this suite entirely GREEN,
    // because the real constants are bounded and the assert therefore never
    // fires in a passing run. The check existed and could not fail.
    //
    // So fire it. Real guard, unbounded constants: the exact future edit the
    // comment describes. Restoring the no-op now turns this test red.
    const actual = jest.requireActual('../app/api/_lib/retention')
    jest.doMock('../app/api/_lib/retention', () => ({
      ...actual,
      WINBACK_PERCENT_OFF: 100,
      WINBACK_DURATION_MONTHS: 999,
    }))
    try {
      const post = loadRoute(ROUTE)
      capturedCouponBody = null
      const response = await call(post, { action: 'winback' })

      // Refused, loudly — and Stripe was never reached, so no 100%-off
      // coupon exists anywhere to be redeemed later.
      expect(response.status).toBe(502)
      expect(capturedCouponBody).toBeNull()
      // And the reservation was released, so the org keeps its one shot.
      expect(mockStoredDocs.has('orgs/org-1/retention/winback')).toBe(false)
    } finally {
      jest.dontMock('../app/api/_lib/retention')
    }
  })

  it('releases the reservation when the mint fails — the org keeps its one shot', async () => {
    const post = loadRoute(ROUTE)
    ;(global.fetch as jest.Mock).mockImplementation(async (url: unknown) => {
      const href = String(url)
      if (href.includes('/subscriptions?customer=')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'sub_1', status: 'active', items: { data: [] } }],
          }),
        }
      }
      if (href.endsWith('/coupons')) {
        return {
          ok: false,
          json: async () => ({ error: { message: 'stripe said no' } }),
        }
      }
      throw new Error(`unexpected fetch: ${href}`)
    })
    const failed = await call(post, { action: 'winback' })
    expect(failed.status).toBe(502)
    expect(mockStoredDocs.has('orgs/org-1/retention/winback')).toBe(false)
  })
})

/**
 * The apply writes `discounts[0][coupon]`, and Stripe's `discounts` parameter
 * SETS the list rather than appending to it. Checkout sends
 * `allow_promotion_codes`, so a customer arriving at the funnel with a promo
 * already on their subscription is an ordinary case, not an exotic one — and
 * overwriting it takes months they were promised and lands them on full list
 * price two cycles later.
 */
describe('/api/billing/retention — an existing discount is never overwritten (AGL-2117)', () => {
  const ROUTE = '../app/api/billing/retention/route'

  it('refuses the winback when the subscription already carries a discount', async () => {
    subscriptionFields = {
      discounts: [{ id: 'di_promo_1', coupon: { id: 'LAUNCH30' } }],
    }
    const post = loadRoute(ROUTE)
    const response = await call(post, { action: 'winback' })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/already has a discount/i)
    // Nothing was minted and nothing was written to the subscription — the
    // customer's promo is still theirs.
    expect(capturedCouponBody).toBeNull()
    expect(capturedSubUpdateBody).toBeNull()
  })

  it('reads the LEGACY singular `discount` too — an old subscription is the likeliest to hold a promo', async () => {
    subscriptionFields = { discount: { id: 'di_legacy_1' } }
    const post = loadRoute(ROUTE)
    const response = await call(post, { action: 'winback' })
    expect(response.status).toBe(409)
    expect(capturedCouponBody).toBeNull()
  })

  it('the refusal costs the org NOTHING — its one winback is still unspent', async () => {
    subscriptionFields = { discounts: [{ id: 'di_promo_1' }] }
    const post = loadRoute(ROUTE)
    expect((await call(post, { action: 'winback' })).status).toBe(409)
    // Refused before the reservation, so there is no `winback` doc to release
    // and no race for a later request to lose.
    expect(mockStoredDocs.has('orgs/org-1/retention/winback')).toBe(false)

    // Once the discount is gone the same org can still take its offer.
    subscriptionFields = {}
    const second = loadRoute(ROUTE)
    expect((await call(second, { action: 'winback' })).status).toBe(200)
    expect(capturedSubUpdateBody?.get('discounts[0][coupon]')).toBe(
      'coupon_winback_1',
    )
  })

  it('an EMPTY discounts array is not a discount — a live subscription reports one routinely', async () => {
    subscriptionFields = { discounts: [] }
    const post = loadRoute(ROUTE)
    const response = await call(post, { action: 'winback' })
    expect(response.status).toBe(200)
    expect(capturedSubUpdateBody?.get('discounts[0][coupon]')).toBe(
      'coupon_winback_1',
    )
  })
})

describe('cancel and delete record funnel completion or skip (AGL-1863)', () => {
  const SUBSCRIPTION_ROUTE = '../app/api/billing/subscription/route'
  const DELETE_ROUTE = '../app/api/orgs/delete/route'

  it('a cancel WITHOUT a funnelId still works — recorded as skipped', async () => {
    const post = loadRoute(SUBSCRIPTION_ROUTE)
    const response = await call(post, { action: 'cancel' })
    expect(response.status).toBe(200)
    const markers = retentionDocs().filter(
      (doc) => doc.kind === 'cancel_completed',
    )
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      surface: 'subscription_cancel',
      funnelSkipped: true,
      plan: 'pro',
      uid: 'u-1',
    })
  })

  it('a cancel WITH a funnelId is recorded as funnel-completed', async () => {
    const post = loadRoute(SUBSCRIPTION_ROUTE)
    const response = await call(post, { action: 'cancel', funnelId: 'f-9' })
    expect(response.status).toBe(200)
    const [marker] = retentionDocs().filter(
      (doc) => doc.kind === 'cancel_completed',
    )
    expect(marker).toMatchObject({ funnelSkipped: false, funnelId: 'f-9' })
  })

  it('PIN — the cancel route still answers 401 unauthenticated', async () => {
    // Production behavior that must survive the funnel (AGL-1859).
    const post = loadRoute(SUBSCRIPTION_ROUTE)
    const response = await call(post, { action: 'cancel' }, { bearer: false })
    expect(response.status).toBe(401)
  })

  it('an org-delete request records the marker with the skip flag', async () => {
    const post = loadRoute(DELETE_ROUTE)
    const response = await call(post, { action: 'request' })
    expect(response.status).toBe(200)
    const [marker] = retentionDocs().filter(
      (doc) => doc.kind === 'delete_requested',
    )
    expect(marker).toMatchObject({
      surface: 'account_delete',
      funnelSkipped: true,
      plan: 'pro',
      uid: 'u-1',
    })
  })

  it('an org-delete request through the funnel carries its funnelId', async () => {
    const post = loadRoute(DELETE_ROUTE)
    const response = await call(post, { action: 'request', funnelId: 'f-3' })
    expect(response.status).toBe(200)
    const [marker] = retentionDocs().filter(
      (doc) => doc.kind === 'delete_requested',
    )
    expect(marker).toMatchObject({ funnelSkipped: false, funnelId: 'f-3' })
  })

  it('canceling a deletion writes NO retention marker', async () => {
    const post = loadRoute(DELETE_ROUTE)
    const response = await call(post, { action: 'cancel' })
    expect(response.status).toBe(200)
    expect(
      retentionDocs().filter((doc) => doc.kind === 'delete_requested'),
    ).toHaveLength(0)
  })
})
