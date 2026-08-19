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
 * An add-on purchase must refresh a pending downgrade's item list (AGL-2150).
 *
 * A subscription schedule's phases are ABSOLUTE item lists, snapshotted when
 * the downgrade was requested. `/api/billing/addons` updated
 * `subscriptions/{id}` with no awareness of `subscription.schedule`, so:
 * schedule a downgrade → buy five more seats (charged, prorated) → at the
 * period end phase 1 applies its stale list and the five PAID seats vanish.
 * Recurring revenue, deleted on a timer, invisible on every screen.
 *
 * The fix does not depend on how Stripe treats a schedule mid-phase, which is
 * the point: the phase is re-derived from the subscription's items as they are
 * NOW, so the snapshot matches reality at the one moment reality changed. The
 * assertion surface is therefore fully determinate — the captured
 * `subscription_schedules` update body.
 *
 * NO STRIPE PATH IS EXERCISED. `fetch` is mocked and never calls out;
 * localhost carries the LIVE key.
 */

export {}

const ORG_ID = 'org-1'

/** `subscription.schedule` on the subscription Stripe returns. */
let scheduleOnSubscription: string | null
/** The schedule `GET subscription_schedules/{id}` answers with. */
let scheduleDoc: any
/** Items the subscription reports AFTER the add-on update. */
let updatedItems: any[]
/** Whether the schedule update should fail, standing in for a Stripe refusal. */
let scheduleUpdateFails: boolean

let capturedScheduleUpdateBody: URLSearchParams | null = null
let capturedSubUpdateBody: URLSearchParams | null = null
let stripePaths: string[] = []

/**
 * The snapshot shape the route actually uses: `orgSnapshot.data()` for the
 * plan and `orgSnapshot.ref.set()` for the `seatAddons` mirror. A double that
 * omitted `ref` turned every successful purchase into a 502 — a closed-world
 * mock inventing a failure the real route does not have.
 */
const orgRef = {
  get: async () => ({
    data: () => ({ plan: 'pro' }),
    ref: { set: async () => undefined },
  }),
  set: async () => undefined,
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }),
      }),
      firestore: () => ({ collection: () => ({ doc: () => orgRef }) }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
  isServerReleaseFlagOnForOrg: async () => true,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isLiveSubscriptionStatus: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isLiveSubscriptionStatus,
  // The REAL plan model — the ceilings that decide whether a 5-seat purchase
  // is even legal have to be the ones the product sells.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
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
const ORIGINAL_FETCH = global.fetch

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_PRO: 'price_pro_monthly',
  STRIPE_PRICE_METERED: 'price_metered_usage',
  STRIPE_PRICE_PRO_EXTRA_SEAT: 'price_pro_seat',
  STRIPE_PRICE_STARTER_EXTRA_SEAT: 'price_starter_seat',
}

const PERIOD_END = 1767225600

function loadAddons() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/addons/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function call(
  post: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
) {
  return post(
    new Request('https://app.aglyn.com/api/billing/addons', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: ORG_ID, ...body }),
    }),
  )
}

/** The phase index the schedule update wrote a given price into, or -1. */
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

function quantityOf(phase: number, price: string): string | null {
  const index = phaseItemPrices(phase).indexOf(price)
  if (index < 0) return null
  return capturedScheduleUpdateBody?.get(
    `phases[${phase}][items][${index}][quantity]`,
  ) ?? null
}

beforeEach(() => {
  scheduleOnSubscription = 'sub_sched_1'
  updatedItems = [
    {
      id: 'si_plan',
      quantity: 1,
      price: { id: 'price_pro_monthly', recurring: { interval: 'month' } },
    },
    {
      id: 'si_seat',
      quantity: 5,
      price: { id: 'price_pro_seat', recurring: { interval: 'month' } },
    },
    {
      id: 'si_metered',
      price: { id: 'price_metered_usage', recurring: { interval: 'month' } },
    },
  ]
  scheduleUpdateFails = false
  capturedScheduleUpdateBody = null
  capturedSubUpdateBody = null
  stripePaths = []
  // The schedule as the downgrade path left it: phase 1 is Starter with the
  // items the subscription had WHEN THE DOWNGRADE WAS REQUESTED — one seat.
  scheduleDoc = {
    id: 'sub_sched_1',
    status: 'active',
    end_behavior: 'release',
    phases: [
      {
        start_date: PERIOD_END - 2592000,
        end_date: PERIOD_END,
        items: [
          { price: 'price_pro_monthly', quantity: 1 },
          { price: 'price_pro_seat', quantity: 1 },
          { price: 'price_metered_usage' },
        ],
        discounts: [{ coupon: { id: 'coupon_winback_1' } }],
        automatic_tax: { enabled: true },
      },
      {
        start_date: PERIOD_END,
        items: [
          { price: 'price_starter_monthly', quantity: 1 },
          { price: 'price_starter_seat', quantity: 1 },
          { price: 'price_metered_usage' },
        ],
        metadata: { plan: 'starter', orgId: ORG_ID },
        automatic_tax: { enabled: true },
      },
    ],
  }
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    stripePaths.push(href)
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            current_period_end: PERIOD_END,
            currency: 'usd',
            schedule: scheduleOnSubscription,
            items: {
              data: [
                {
                  id: 'si_plan',
                  quantity: 1,
                  price: {
                    id: 'price_pro_monthly',
                    recurring: { interval: 'month' },
                  },
                },
                {
                  id: 'si_seat',
                  quantity: 1,
                  price: {
                    id: 'price_pro_seat',
                    recurring: { interval: 'month' },
                  },
                },
                {
                  id: 'si_metered',
                  price: {
                    id: 'price_metered_usage',
                    recurring: { interval: 'month' },
                  },
                },
              ],
            },
          },
        ],
      }
    } else if (href.includes('/subscriptions/sub_1')) {
      capturedSubUpdateBody = new URLSearchParams(String(init?.body ?? ''))
      payload = { id: 'sub_1', status: 'active', items: { data: updatedItems } }
    } else if (href.includes('/subscription_schedules/')) {
      if (init?.method === 'POST') {
        if (scheduleUpdateFails) {
          return {
            ok: false,
            json: async () => ({ error: { message: 'schedule is not editable' } }),
          }
        }
        capturedScheduleUpdateBody = new URLSearchParams(String(init?.body ?? ''))
        payload = scheduleDoc
      } else {
        payload = scheduleDoc
      }
    } else {
      throw new Error(`unexpected fetch: ${href}`)
    }
    return { ok: true, json: async () => payload }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
  jest.restoreAllMocks()
})

/** Buy five manager seats. */
function buySeats(post: (request: Request) => Promise<Response>) {
  return call(post, { action: 'set', kind: 'managers', quantity: 5 })
}

describe('buying an add-on refreshes a pending downgrade (AGL-2150)', () => {
  it('rewrites the TARGET phase with the quantity that was just paid for', async () => {
    const post = loadAddons()
    const response = await buySeats(post)
    expect(response.status).toBe(200)
    // The subscription really was updated — the seats are charged.
    expect(capturedSubUpdateBody?.get('items[0][quantity]')).toBe('5')
    // ...and the phase that would otherwise have deleted four of them at the
    // period end now carries all five, at the TARGET plan's seat price.
    expect(quantityOf(1, 'price_starter_seat')).toBe('5')
  })

  it('keeps the phase metadata the webhook mirror reads at the flip', async () => {
    // A refresh that dropped `metadata[plan]` would leave the org doc on the
    // old plan forever after the phase flipped — AGL-1862's mirror, broken by
    // the repair.
    const post = loadAddons()
    await buySeats(post)
    expect(capturedScheduleUpdateBody?.get('phases[1][metadata][plan]')).toBe(
      'starter',
    )
    expect(capturedScheduleUpdateBody?.get('phases[1][metadata][orgId]')).toBe(
      ORG_ID,
    )
  })

  it('keeps the discount and the window on the current phase (AGL-2146)', async () => {
    // A schedule update REPLACES the phase list, so a naive refresh would end
    // the customer's coupon as a side effect of buying a seat.
    const post = loadAddons()
    await buySeats(post)
    expect(
      capturedScheduleUpdateBody?.get('phases[0][discounts][0][coupon]'),
    ).toBe('coupon_winback_1')
    expect(capturedScheduleUpdateBody?.get('phases[0][start_date]')).toBe(
      String(PERIOD_END - 2592000),
    )
    expect(capturedScheduleUpdateBody?.get('phases[0][end_date]')).toBe(
      String(PERIOD_END),
    )
  })

  it('states the CURRENT phase from the live subscription, not the stale snapshot', async () => {
    // Whether Stripe amends phase 0 when the subscription changes mid-phase is
    // exactly the unknown this fix refuses to depend on. Writing the
    // subscription's own items back is correct either way: a no-op if Stripe
    // already did it, and an alignment if it did not.
    const post = loadAddons()
    await buySeats(post)
    expect(quantityOf(0, 'price_pro_seat')).toBe('5')
  })

  it('NEGATIVE CONTROL: no schedule, no schedule call at all', async () => {
    scheduleOnSubscription = null
    const post = loadAddons()
    expect((await buySeats(post)).status).toBe(200)
    expect(
      stripePaths.some((path) => path.includes('subscription_schedules')),
    ).toBe(false)
  })

  it('NEGATIVE CONTROL: a released schedule with one phase is left alone', async () => {
    scheduleDoc = { id: 'sub_sched_1', status: 'released', phases: [] }
    const post = loadAddons()
    expect((await buySeats(post)).status).toBe(200)
    expect(capturedScheduleUpdateBody).toBeNull()
  })

  it('a refresh failure does not fail the purchase — it reports it', async () => {
    // The card was already charged. Answering 502 would tell the customer
    // nothing happened while their invoice says otherwise.
    scheduleUpdateFails = true
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const post = loadAddons()
    const response = await buySeats(post)
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.ok).toBe(true)
    expect(payload.scheduleRefreshFailed).toBe(true)
    expect(
      error.mock.calls.some(([message]) =>
        String(message).includes('NOT refreshed'),
      ),
    ).toBe(true)
  })
})
