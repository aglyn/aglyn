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
 * Downgrades are END-OF-CYCLE, upgrades are instant (AGL-1862 / AGL-1859).
 *
 * The asymmetry this file pins: a switch DOWN the self-serve ladder must
 * never re-price the live subscription — that issues a proration credit and
 * walks paid revenue back out the door. It goes onto a Stripe subscription
 * schedule whose second phase flips the items at the current period end,
 * with `metadata[plan]` on the phase so the webhook mirror learns the new
 * plan when it happens. A switch UP stays exactly what it was: an immediate
 * update with prorations — and it releases any pending downgrade schedule
 * first, or the schedule would re-flip the price at period end.
 *
 * No live Stripe call happens here: `fetch` is mocked per-endpoint and the
 * captured bodies are the assertion surface.
 */

// A module, not a script — without this the const declarations below collide
// with the other billing route specs' identical globals under `tsc`.
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
  // The REAL predicate, not a re-typed triple (AGL-1715).
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
  // The REAL ladder (AGL-1862): a hand-shuffled copy here would let the
  // route's up/down answer drift from the one the product sells.
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
  STRIPE_PRICE_METERED: 'price_metered_usage',
  STRIPE_PRICE_PRO_EXTRA_SEAT: 'price_pro_seat',
  STRIPE_PRICE_STARTER_EXTRA_SEAT: 'price_starter_seat',
}

/** 2026-01-01T00:00:00Z — the subscription's current period end. */
const PERIOD_END = 1767225600

/** The subscription the mocked Stripe returns; tests override these. */
let subscriptionItems: any[] = []
let subscriptionSchedule: string | null = null
/** `cancel_at_period_end` on the subscription Stripe returns (AGL-2151). */
let subscriptionCancelAtPeriodEnd = false
/**
 * Tail of the Stripe path that should FAIL, standing in for any of the
 * refusals the outer catch turns into a generic 502 (AGL-2151). Matched on the
 * END of the URL, so failing the schedule CREATE
 * (`…/v1/subscription_schedules`) does not also fail the RELEASE
 * (`…/v1/subscription_schedules/{id}/release`) that runs before it.
 */
let failStripePathEndingWith: string | null = null
let capturedSubUpdateBody: URLSearchParams | null = null
/**
 * Extra fields Stripe puts on phase 0 when a schedule is created
 * `from_subscription` — the discount, trial and tax configuration a phase-list
 * replacement would drop (AGL-2146). Seeded per test.
 */
let schedulePhaseExtras: Record<string, unknown> = {}

let capturedScheduleCreateBody: URLSearchParams | null = null
let capturedScheduleUpdateBody: URLSearchParams | null = null
let releasedScheduleIds: string[] = []
let previewRequested = false

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

const PRO_ITEM = {
  id: 'si_plan',
  quantity: 1,
  price: { id: 'price_pro_monthly', recurring: { interval: 'month' } },
}
const STARTER_ITEM = {
  id: 'si_plan',
  quantity: 1,
  price: { id: 'price_starter_monthly', recurring: { interval: 'month' } },
}
const METERED_ITEM = {
  id: 'si_metered',
  price: { id: 'price_metered_usage', recurring: { interval: 'month' } },
}

beforeEach(() => {
  subscriptionItems = [PRO_ITEM, METERED_ITEM]
  subscriptionSchedule = null
  subscriptionCancelAtPeriodEnd = false
  failStripePathEndingWith = null
  // These are module-scope `jest.fn()`s, so `restoreAllMocks` does not empty
  // them: without an explicit clear, "was this ever written?" accumulates
  // across the file and can never be false.
  mockWriteOrgBilling.mockClear()
  mockVerifyIdToken.mockClear()
  mockOrgGet.mockClear()
  capturedSubUpdateBody = null
  schedulePhaseExtras = {}
  capturedScheduleCreateBody = null
  capturedScheduleUpdateBody = null
  releasedScheduleIds = []
  previewRequested = false
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockOrgGet.mockResolvedValue({
    // `org.get('slug')` and `org.get('plan')` both route through this.
    get: (field: string) => (field === 'plan' ? 'pro' : 'acme'),
    ref: { id: 'org-1', set: async () => undefined },
  })
  mockWriteOrgBilling.mockResolvedValue(undefined)
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    // Modelled the way Stripe answers a refusal: a non-2xx carrying
    // `error.message`, which `stripeRequest` turns into the throw the route's
    // outer catch sees. Checked BEFORE the branches so a failed call records
    // no side effect — a release that "failed" must not appear in
    // `releasedScheduleIds`.
    if (failStripePathEndingWith && href.endsWith(failStripePathEndingWith)) {
      return { ok: false, json: async () => ({ error: { message: 'nope' } }) }
    }
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            current_period_end: PERIOD_END,
            currency: 'usd',
            cancel_at_period_end: subscriptionCancelAtPeriodEnd,
            schedule: subscriptionSchedule,
            items: { data: subscriptionItems },
          },
        ],
      }
    } else if (/subscription_schedules\/([^/?]+)\/release/.test(href)) {
      releasedScheduleIds.push(
        String(href.match(/subscription_schedules\/([^/?]+)\/release/)?.[1]),
      )
      payload = { id: 'released', status: 'released' }
    } else if (href.includes('/subscription_schedules/sub_sched_new')) {
      capturedScheduleUpdateBody = new URLSearchParams(String(init?.body ?? ''))
      payload = { id: 'sub_sched_new', status: 'active' }
    } else if (href.endsWith('/subscription_schedules')) {
      capturedScheduleCreateBody = new URLSearchParams(String(init?.body ?? ''))
      payload = {
        id: 'sub_sched_new',
        phases: [
          {
            start_date: PERIOD_END - 2592000,
            end_date: PERIOD_END,
            items: subscriptionItems.map((item: any) => ({
              price: item.price.id,
              ...(item.quantity != null ? { quantity: item.quantity } : {}),
            })),
            ...schedulePhaseExtras,
          },
        ],
      }
    } else if (href.includes('/subscriptions/sub_1')) {
      capturedSubUpdateBody = new URLSearchParams(String(init?.body ?? ''))
      payload = {
        status: 'active',
        cancel_at_period_end:
          capturedSubUpdateBody.get('cancel_at_period_end') === 'true',
        items: { data: [] },
      }
    } else if (href.includes('/invoices/upcoming')) {
      previewRequested = true
      payload = { amount_due: -1234, currency: 'usd', lines: { data: [] } }
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

/** The last billing-doc patch's `subscription` field. */
function lastBillingPatch(): any {
  const calls = mockWriteOrgBilling.mock.calls
  return calls[calls.length - 1]?.[1]?.subscription
}

describe('a downgrade waits for the period end (AGL-1862)', () => {
  it('schedules the switch instead of re-pricing the subscription', async () => {
    const post = loadSubscription()
    const response = await call(post, {
      action: 'switch',
      plan: 'starter',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    const payload = await response.json()

    // The live subscription was NOT updated — no proration credit exists.
    expect(capturedSubUpdateBody).toBeNull()

    // A schedule was created from the subscription and given two phases.
    expect(capturedScheduleCreateBody?.get('from_subscription')).toBe('sub_1')
    const update = capturedScheduleUpdateBody
    expect(update?.get('end_behavior')).toBe('release')
    expect(update?.get('proration_behavior')).toBe('none')
    // Phase 0 restates the CURRENT paid items over the current window.
    expect(update?.get('phases[0][items][0][price]')).toBe('price_pro_monthly')
    expect(update?.get('phases[0][end_date]')).toBe(String(PERIOD_END))
    // Phase 1 is the target plan, with the metadata the webhook mirror
    // reads when the flip happens — without it the org doc keeps the old
    // plan forever.
    expect(update?.get('phases[1][items][0][price]')).toBe(
      'price_starter_monthly',
    )
    expect(update?.get('phases[1][metadata][plan]')).toBe('starter')
    expect(update?.get('phases[1][automatic_tax][enabled]')).toBe('true')
    // The metered usage item survives the flip (AGL-635/1340).
    expect(update?.get('phases[1][items][1][price]')).toBe(
      'price_metered_usage',
    )

    // The response says scheduled, not switched.
    expect(payload.scheduled).toBe(true)
    expect(payload.pendingPlan).toBe('starter')
    expect(payload.effectiveAt).toBe(
      new Date(PERIOD_END * 1000).toISOString(),
    )

    // The mirror carries the pending marker; the org's plan does not move.
    expect(lastBillingPatch()?.pendingDowngrade).toMatchObject({
      plan: 'starter',
      scheduleId: 'sub_sched_new',
    })
  })

  it('previews a downgrade as $0 today — never the proration credit', async () => {
    const post = loadSubscription()
    const response = await call(post, {
      action: 'preview',
      plan: 'starter',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.amountDueCents).toBe(0)
    expect(payload.downgrade).toBe(true)
    expect(payload.periodEnd).toBe(new Date(PERIOD_END * 1000).toISOString())
    // The upcoming-invoice preview (which would quote the credit) was
    // never consulted.
    expect(previewRequested).toBe(false)
  })

  it('an UPGRADE stays instant and releases a pending downgrade first', async () => {
    subscriptionItems = [STARTER_ITEM, METERED_ITEM]
    subscriptionSchedule = 'sub_sched_old'
    const post = loadSubscription()
    const response = await call(post, {
      action: 'switch',
      plan: 'pro',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    // The old schedule was released, THEN the subscription re-priced today.
    expect(releasedScheduleIds).toEqual(['sub_sched_old'])
    expect(capturedSubUpdateBody?.get('items[0][price]')).toBe(
      'price_pro_monthly',
    )
    expect(capturedSubUpdateBody?.get('proration_behavior')).toBe(
      'create_prorations',
    )
    expect(capturedScheduleCreateBody).toBeNull()
    // The mirror clears the pending marker alongside the new price.
    expect(lastBillingPatch()?.pendingDowngrade).toBeNull()
  })

  it('switching to the CURRENT plan is "keep my plan" — release only', async () => {
    subscriptionSchedule = 'sub_sched_old'
    const post = loadSubscription()
    const response = await call(post, {
      action: 'switch',
      plan: 'pro',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.releasedPendingDowngrade).toBe(true)
    expect(releasedScheduleIds).toEqual(['sub_sched_old'])
    // Nothing was re-priced and no new schedule appeared.
    expect(capturedSubUpdateBody).toBeNull()
    expect(capturedScheduleCreateBody).toBeNull()
    expect(lastBillingPatch()?.pendingDowngrade).toBeNull()
  })

  it('cancel releases a pending downgrade — the two must not race', async () => {
    subscriptionSchedule = 'sub_sched_old'
    const post = loadSubscription()
    const response = await call(post, { action: 'cancel' })
    expect(response.status).toBe(200)
    expect(releasedScheduleIds).toEqual(['sub_sched_old'])
    expect(capturedSubUpdateBody?.get('cancel_at_period_end')).toBe('true')
    expect(lastBillingPatch()?.pendingDowngrade).toBeNull()
  })
})

/**
 * A `subscription_schedules` update REPLACES the phase list, so every term not
 * restated is dropped (AGL-2146). The original restatement wrote price,
 * quantity and the phase window and nothing else — which meant a downgrade
 * quietly ended the customer's coupon, their trial, and the tax configuration.
 *
 * The discount is the expensive one. Checkout sends `allow_promotion_codes`,
 * staff mint coupons through /api/admin/coupons, and the retention funnel
 * mints the winback — so an org holding a discount and choosing a smaller plan
 * is an ordinary customer, and losing the coupon at the flip is a price rise
 * nobody mentioned. An instant UPGRADE never touches subscription discounts;
 * this is the parity.
 */
describe('a downgrade preserves the terms it did not change (AGL-2146)', () => {
  async function downgrade() {
    const post = loadSubscription()
    return call(post, { action: 'switch', plan: 'starter', interval: 'month' })
  }

  it('carries the discount onto BOTH phases — the coupon outlives the plan change', async () => {
    schedulePhaseExtras = {
      discounts: [{ coupon: { id: 'coupon_winback_1' } }],
    }
    expect((await downgrade()).status).toBe(200)
    const update = capturedScheduleUpdateBody
    // The period they already paid for keeps its discount...
    expect(update?.get('phases[0][discounts][0][coupon]')).toBe('coupon_winback_1')
    // ...and so does the tier they move to, so a time-boxed coupon runs its
    // remaining months instead of being cancelled by an unrelated change.
    expect(update?.get('phases[1][discounts][0][coupon]')).toBe('coupon_winback_1')
  })

  it('reads a coupon given as a bare id, and a promotion code', async () => {
    schedulePhaseExtras = {
      discounts: [{ coupon: 'LAUNCH30' }, { promotion_code: 'promo_abc' }],
    }
    expect((await downgrade()).status).toBe(200)
    const update = capturedScheduleUpdateBody
    expect(update?.get('phases[0][discounts][0][coupon]')).toBe('LAUNCH30')
    expect(update?.get('phases[0][discounts][1][promotion_code]')).toBe('promo_abc')
  })

  it('reads the LEGACY singular `coupon` on the phase', async () => {
    schedulePhaseExtras = { coupon: 'OLDDEAL' }
    expect((await downgrade()).status).toBe(200)
    expect(capturedScheduleUpdateBody?.get('phases[0][coupon]')).toBe('OLDDEAL')
  })

  it('keeps a TRIAL on the current phase, and never restarts it on the next', async () => {
    schedulePhaseExtras = { trial_end: PERIOD_END }
    expect((await downgrade()).status).toBe(200)
    const update = capturedScheduleUpdateBody
    expect(update?.get('phases[0][trial_end]')).toBe(String(PERIOD_END))
    // A trial that restarted at the flip would hand back free time the
    // customer already used.
    expect(update?.get('phases[1][trial_end]')).toBeNull()
  })

  it('restates the collection method and payment method', async () => {
    schedulePhaseExtras = {
      collection_method: 'send_invoice',
      default_payment_method: { id: 'pm_1' },
    }
    expect((await downgrade()).status).toBe(200)
    const update = capturedScheduleUpdateBody
    expect(update?.get('phases[0][collection_method]')).toBe('send_invoice')
    expect(update?.get('phases[0][default_payment_method]')).toBe('pm_1')
    expect(update?.get('phases[1][collection_method]')).toBe('send_invoice')
  })

  it('NEGATIVE CONTROL: a phase with no such terms invents none', async () => {
    // The plain downgrade must not start sending empty discount or trial
    // params — Stripe would reject some and silently reinterpret others.
    expect((await downgrade()).status).toBe(200)
    const update = capturedScheduleUpdateBody
    expect(update?.get('phases[0][discounts][0][coupon]')).toBeNull()
    expect(update?.get('phases[0][coupon]')).toBeNull()
    expect(update?.get('phases[0][trial_end]')).toBeNull()
    expect(update?.get('phases[0][collection_method]')).toBeNull()
    // The move itself still happened.
    expect(update?.get('phases[1][items][0][price]')).toBe('price_starter_monthly')
  })
})


/**
 * A schedule phase is an ABSOLUTE item list; the instant switch is a DELTA
 * (AGL-2150).
 *
 * That difference is the whole bug. The instant path names the items it
 * wants changed and leaves everything else exactly where it is, so an item
 * `addonKindFromPriceId` cannot classify survives a switch untouched. Phase 1
 * was built from the recognised kinds alone, so the same item was DELETED —
 * at the period end, on a timer, with no log line and nothing in the response
 * naming it. `droppedAddons` carries recognised kinds only, so it read as a
 * complete account of what was lost while being silent about exactly the
 * lines it could not name.
 *
 * `addonKindFromPriceId` resolves by comparing against the CURRENT env values,
 * so "cannot classify" is not exotic: a legacy add-on whose `STRIPE_PRICE_*`
 * was rotated or unset, a price attached by hand in the Stripe dashboard, a
 * negotiated line item, and the flat POS-register / event-calendar add-ons in
 * any environment that does not configure those env names all land here. Each
 * is recurring revenue.
 */
describe('a downgrade carries the items it cannot classify (AGL-2150)', () => {
  /** A price no `STRIPE_PRICE_*` in `STRIPE_ENV` resolves to. */
  const LEGACY_ADDON_ITEM = {
    id: 'si_legacy',
    quantity: 3,
    price: { id: 'price_legacy_rotated_addon', recurring: { interval: 'month' } },
  }
  const PRO_SEAT_ITEM = {
    id: 'si_seat',
    quantity: 4,
    price: { id: 'price_pro_seat', recurring: { interval: 'month' } },
  }

  function phaseItemPrices(index: number): string[] {
    const prices: string[] = []
    for (let i = 0; ; i += 1) {
      const price = capturedScheduleUpdateBody?.get(
        `phases[${index}][items][${i}][price]`,
      )
      if (!price) return prices
      prices.push(price)
    }
  }

  async function downgrade() {
    const post = loadSubscription()
    return call(post, { action: 'switch', plan: 'starter', interval: 'month' })
  }

  it('passes an unrecognised item through to phase 1, quantity and all', async () => {
    subscriptionItems = [PRO_ITEM, LEGACY_ADDON_ITEM, METERED_ITEM]
    expect((await downgrade()).status).toBe(200)
    const prices = phaseItemPrices(1)
    expect(prices).toContain('price_legacy_rotated_addon')
    const index = prices.indexOf('price_legacy_rotated_addon')
    expect(
      capturedScheduleUpdateBody?.get(`phases[1][items][${index}][quantity]`),
    ).toBe('3')
  })

  it('names it in the response and in a log line — the loss was silent', async () => {
    subscriptionItems = [PRO_ITEM, LEGACY_ADDON_ITEM, METERED_ITEM]
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const payload = await (await downgrade()).json()
    expect(payload.unrecognizedItems).toEqual(['price_legacy_rotated_addon'])
    expect(
      warn.mock.calls.some(([message]) =>
        String(message).includes('cannot classify'),
      ),
    ).toBe(true)
  })

  it('the INSTANT path already left it alone — this is the parity', async () => {
    subscriptionItems = [STARTER_ITEM, LEGACY_ADDON_ITEM, METERED_ITEM]
    const post = loadSubscription()
    expect(
      (await call(post, { action: 'switch', plan: 'pro', interval: 'month' }))
        .status,
    ).toBe(200)
    // Nothing in the delta touches it: no `deleted`, no re-price.
    const body = capturedSubUpdateBody
    const touched = [...(body?.keys() ?? [])].some(
      (key) => key.startsWith('items[') && body?.get(key) === 'si_legacy',
    )
    expect(touched).toBe(false)
  })

  it('NEGATIVE CONTROL: a RECOGNISED add-on still re-prices to the target', async () => {
    // The pass-through must not swallow the AGL-528 re-pricing: a known seat
    // price has to become the TARGET plan's seat price, not survive verbatim
    // at the old plan's rate.
    subscriptionItems = [PRO_ITEM, PRO_SEAT_ITEM, METERED_ITEM]
    const payload = await (await downgrade()).json()
    const prices = phaseItemPrices(1)
    expect(prices).toContain('price_starter_seat')
    expect(prices).not.toContain('price_pro_seat')
    expect(payload.unrecognizedItems).toEqual([])
  })

  it('NEGATIVE CONTROL: the metered item is still attached once, not twice', async () => {
    subscriptionItems = [PRO_ITEM, LEGACY_ADDON_ITEM, METERED_ITEM]
    expect((await downgrade()).status).toBe(200)
    const metered = phaseItemPrices(1).filter(
      (price) => price === 'price_metered_usage',
    )
    expect(metered).toHaveLength(1)
  })
})

/**
 * Cancel and downgrade must not contradict each other, and a failed schedule
 * swap must not leave the mirror lying (AGL-2151).
 *
 * Two separate faults with one shared cause — this branch does things to
 * Stripe in a sequence and assumed every step lands.
 */
describe('a pending cancel and a pending downgrade cannot both stand (AGL-2151)', () => {
  it('a downgrade clears the cancellation instead of racing it', async () => {
    // Straight out of the retention funnel: cancelled, changed their mind,
    // trying to stay on something smaller. Refusing them would be the save
    // the funnel exists to make, lost.
    subscriptionCancelAtPeriodEnd = true
    const post = loadSubscription()
    const response = await call(post, {
      action: 'switch',
      plan: 'starter',
      interval: 'month',
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    // The cancellation was cleared FIRST — a schedule created underneath a
    // pending cancel is the contradiction, not the fix for it.
    expect(capturedSubUpdateBody?.get('cancel_at_period_end')).toBe('false')
    // ...and the downgrade still happened.
    expect(capturedScheduleCreateBody?.get('from_subscription')).toBe('sub_1')
    expect(payload.scheduled).toBe(true)
    expect(payload.clearedPendingCancel).toBe(true)
    // The mirror stops rendering both chips.
    expect(lastBillingPatch()?.cancelAtPeriodEnd).toBe(false)
    expect(lastBillingPatch()?.pendingDowngrade).toMatchObject({
      plan: 'starter',
    })
  })

  it('an UPGRADE clears it too — buying more is not leaving', async () => {
    subscriptionItems = [STARTER_ITEM, METERED_ITEM]
    subscriptionCancelAtPeriodEnd = true
    const post = loadSubscription()
    expect(
      (await call(post, { action: 'switch', plan: 'pro', interval: 'month' }))
        .status,
    ).toBe(200)
    expect(capturedSubUpdateBody?.get('cancel_at_period_end')).toBe('false')
    expect(lastBillingPatch()?.cancelAtPeriodEnd).toBe(false)
  })

  it('NEGATIVE CONTROL: an ordinary downgrade never touches the cancel flag', async () => {
    // Sending `cancel_at_period_end=false` on every switch would silently
    // resume a subscription nobody asked to resume.
    const post = loadSubscription()
    expect(
      (
        await call(post, {
          action: 'switch',
          plan: 'starter',
          interval: 'month',
        })
      ).status,
    ).toBe(200)
    expect(capturedSubUpdateBody).toBeNull()
  })

  it('NEGATIVE CONTROL: an ordinary UPGRADE sends no cancel flag either', async () => {
    subscriptionItems = [STARTER_ITEM, METERED_ITEM]
    const post = loadSubscription()
    expect(
      (await call(post, { action: 'switch', plan: 'pro', interval: 'month' }))
        .status,
    ).toBe(200)
    expect(capturedSubUpdateBody?.get('cancel_at_period_end')).toBeNull()
  })
})

/**
 * The mirror must never assert a schedule that is not there (AGL-2151).
 *
 * Every one of these branches RELEASES the subscription's schedule and then
 * does more work. A failure after the release used to return a generic 502
 * while the org doc kept the OLD `pendingDowngrade` naming the just-released
 * `scheduleId`: Stripe has no pending downgrade, the console insists there is
 * one, and the customer goes on being billed at the higher tier while the page
 * says they are dropping. An ABSENT pending downgrade is recoverable by
 * re-requesting; a PHANTOM one is invisible as wrong to everybody.
 */
describe('a failed schedule swap clears the mirror (AGL-2151)', () => {
  it('a downgrade that dies at the schedule create leaves nothing pending', async () => {
    subscriptionSchedule = 'sub_sched_old'
    failStripePathEndingWith = 'v1/subscription_schedules'
    const post = loadSubscription()
    const response = await call(post, {
      action: 'switch',
      plan: 'starter',
      interval: 'month',
    })
    expect(response.status).toBe(502)
    // The old schedule is genuinely gone...
    expect(releasedScheduleIds).toEqual(['sub_sched_old'])
    // ...so the mirror must not go on naming it.
    expect(lastBillingPatch()?.pendingDowngrade).toBeNull()
  })

  it('and states the cancel it cleared, so the mirror is true in failure too', async () => {
    subscriptionCancelAtPeriodEnd = true
    failStripePathEndingWith = 'v1/subscription_schedules'
    const post = loadSubscription()
    expect(
      (
        await call(post, {
          action: 'switch',
          plan: 'starter',
          interval: 'month',
        })
      ).status,
    ).toBe(502)
    expect(lastBillingPatch()?.cancelAtPeriodEnd).toBe(false)
    expect(lastBillingPatch()?.pendingDowngrade).toBeNull()
  })

  it('the same window in the CANCEL path is closed', async () => {
    subscriptionSchedule = 'sub_sched_old'
    failStripePathEndingWith = 'v1/subscriptions/sub_1'
    const post = loadSubscription()
    expect((await call(post, { action: 'cancel' })).status).toBe(502)
    expect(releasedScheduleIds).toEqual(['sub_sched_old'])
    expect(lastBillingPatch()?.pendingDowngrade).toBeNull()
  })

  it('and in the instant UPGRADE path', async () => {
    subscriptionItems = [STARTER_ITEM, METERED_ITEM]
    subscriptionSchedule = 'sub_sched_old'
    failStripePathEndingWith = 'v1/subscriptions/sub_1'
    const post = loadSubscription()
    expect(
      (await call(post, { action: 'switch', plan: 'pro', interval: 'month' }))
        .status,
    ).toBe(502)
    expect(releasedScheduleIds).toEqual(['sub_sched_old'])
    expect(lastBillingPatch()?.pendingDowngrade).toBeNull()
  })

  it('NEGATIVE CONTROL: a failure BEFORE the release leaves the mirror ALONE', async () => {
    // The old schedule still exists, so the pending marker naming it is
    // ACCURATE. Clearing it here would invent the opposite lie — the console
    // saying nothing is pending while Stripe still flips the plan.
    subscriptionSchedule = 'sub_sched_old'
    failStripePathEndingWith = '/release'
    const post = loadSubscription()
    expect(
      (
        await call(post, {
          action: 'switch',
          plan: 'starter',
          interval: 'month',
        })
      ).status,
    ).toBe(502)
    expect(releasedScheduleIds).toEqual([])
    expect(mockWriteOrgBilling).not.toHaveBeenCalled()
  })
})
