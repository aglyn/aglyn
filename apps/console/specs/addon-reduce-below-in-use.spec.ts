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
 * "Buy the capacity, use it, drop the capacity, keep using it."
 *
 * Extra sites, extra datasets and manager seats were checked at CREATE time
 * and nowhere else — `hostLimit` at the transaction that mints a site,
 * `checkDatasetQuota` at the one that mints a dataset, `checkSeatQuota` at the
 * invite. Every one of them was free to drop afterwards, with the site still
 * serving, the dataset still readable and the teammate still logged in.
 *
 * THE ENFORCEMENT POINT IS THE REDUCTION. Use-time enforcement for these three
 * would mean ejecting a teammate or locking data, which is why the two
 * capacities that DID survive (POS registers, the Event Calendar) are exactly
 * the ones where refusing at use time refuses a machine or a feature.
 *
 * Assertions are on the REFUSAL, the message's numbers, and the quantity that
 * reaches Stripe — never on rendered output.
 *
 * A PERMITTED reduction reaches Stripe as a subscription SCHEDULE, not as a
 * subscription update: capacity already paid for runs to the period end, so
 * the smaller quantity is written into the schedule's target phase and nothing
 * moves today. That is what "reaches Stripe" means in the control block below,
 * and it is the assertion that keeps the controls load-bearing — a gate that
 * refused every reduction would answer 409, but one that accepted every
 * reduction and then quietly failed to write anything would answer 200.
 *
 * NO STRIPE PATH IS EXERCISED. `fetch` is mocked and never calls out;
 * localhost carries the LIVE key.
 */

export {}

const ORG_ID = 'org-1'

/** The renewal a scheduled reduction lands on. */
const PERIOD_END = 1767225600

/** The org document the route reads plan, entitlements and seatAddons from. */
let mockOrg: Record<string, unknown> = {}
/** Every Stripe request the route made, in order. */
let mockStripeCalls: Array<{ href: string; method: string; body: string }> = []
/** Everything written to the org doc (the `seatAddons` mirror). */
let mockOrgWrites: unknown[] = []
/** Subscription items, rebuilt per test. */
let mockItems: unknown[] = []

/** What the org actually HOLDS. `null` makes the count throw (unreadable). */
let mockSiteCount: number | null = 0
let mockDatasetCount: number | null = 0
/** Roster rows, counted by the REAL `countManagerSeats`. */
let mockMembers: unknown[] = []
/** Un-accepted invites, which hold a manager seat just as a roster row does. */
let mockInvites: unknown[] = []

function mockAnswerCount(value: number | null) {
  return {
    get: async () => {
      if (value == null) throw new Error('unreadable')
      return { data: () => ({ count: value }) }
    },
  }
}

const mockOrgRef = {
  get: async () => ({
    data: () => mockOrg,
    ref: {
      set: async (value: unknown) => {
        mockOrgWrites.push(value)
      },
    },
  }),
  collection: (name: string) => ({
    // `orgs/{id}/datasets` — an aggregation, like the quota it protects.
    count: () => mockAnswerCount(name === 'datasets' ? mockDatasetCount : 0),
    // `orgs/{id}/invites` — `where('acceptedAt','==',null)`.
    where: () => ({
      get: async () => ({
        docs: mockInvites.map((row) => ({ data: () => row })),
      }),
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => mockOrgRef,
          // `hosts` where `orgId ==` — the same aggregation `claimHostForOrg`
          // counts sites with at create time.
          where: () => ({ count: () => mockAnswerCount(mockSiteCount) }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
  isServerReleaseFlagOnForOrg: async () => true,
  listOrgMembers: async () => mockMembers,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
  // The REAL plan model. A stubbed resolver answers zero for every ceiling,
  // so every case below would refuse at the `max` check instead of the
  // capacity check — passing, loudly, for the wrong reason. Starter's real
  // numbers are the fixture: hostLimit 1, datasetsPerOrg 3, managersPerOrg 2.
  ...jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements'),
  // The REAL manager-seat counter, which is what decides that a site-scoped
  // collaborator is not a manager. A `members.length` stub here would count
  // collaborators as managers and the seat case would pass on a wrong total.
  countManagerSeats: jest.requireActual('@aglyn/aglyn/app-utils/organizations')
    .countManagerSeats,
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
  STRIPE_PRICE_STARTER_EXTRA_HOST: 'price_starter_host',
  STRIPE_PRICE_STARTER_EXTRA_DATASET: 'price_starter_dataset',
  STRIPE_PRICE_STARTER_EXTRA_SEAT: 'price_starter_seat',
  STRIPE_PRICE_EVENT_CALENDAR: 'price_cal',
}

function loadAddons() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/addons/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function setQuantity(kind: string, quantity: number, action = 'set') {
  return loadAddons()(
    new Request('https://app.aglyn.com/api/billing/addons', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: ORG_ID, action, kind, quantity }),
    }),
  )
}

/**
 * The Stripe traffic that is NOT the unavoidable "which subscription does this
 * customer have" lookup — i.e. everything that can move money or quote it.
 */
function billingCalls() {
  return mockStripeCalls.filter(
    (entry) => !entry.href.includes('/subscriptions?customer='),
  )
}

/** The captured quantity of the one `POST subscriptions/{id}`, if any. */
function updatedQuantity(): string | null {
  const entry = mockStripeCalls.find(
    (call) =>
      call.method === 'POST' && call.href.includes('/subscriptions/sub_1'),
  )
  return entry ? new URLSearchParams(entry.body).get('items[0][quantity]') : null
}

/** The captured body of the one `POST subscription_schedules/{id}`, if any. */
function scheduleUpdate(): URLSearchParams | null {
  const entry = mockStripeCalls.find(
    (call) =>
      call.method === 'POST' && call.href.includes('/subscription_schedules/'),
  )
  return entry ? new URLSearchParams(entry.body) : null
}

/** The price ids the schedule's TARGET phase was written with, in order. */
function targetPhasePrices(): string[] {
  const body = scheduleUpdate()
  const prices: string[] = []
  for (let i = 0; ; i += 1) {
    const price = body?.get(`phases[1][items][${i}][price]`)
    if (!price) return prices
    prices.push(price)
  }
}

/**
 * The quantity the TARGET phase carries for one price — the figure a permitted
 * reduction actually moves. `null` when the phase carries no such line, which
 * is what a removal looks like.
 */
function scheduledQuantity(price: string): string | null {
  const at = targetPhasePrices().indexOf(price)
  if (at < 0) return null
  return scheduleUpdate()?.get(`phases[1][items][${at}][quantity]`) ?? null
}

beforeEach(() => {
  mockStripeCalls = []
  mockOrgWrites = []
  // A Starter org that bought all three gated capacities and then used them.
  // Starter includes 1 site, 3 datasets and 2 manager seats.
  mockOrg = {
    plan: 'starter',
    subscription: { status: 'active' },
    seatAddons: { hosts: 5, datasets: 4, managers: 3 },
  }
  // 4 sites (3 past the included 1), 6 datasets (3 past 3), and a roster that
  // the real counter reads as 3 managers + 1 pending invite = 4 (2 past 2).
  mockSiteCount = 4
  mockDatasetCount = 6
  mockMembers = [
    { role: 'owner' },
    { role: 'admin' },
    { role: 'editor', allHosts: true },
    // A site-scoped collaborator. NOT a manager seat, and the real counter is
    // what knows that.
    { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'editor' } },
  ]
  mockInvites = [{ role: 'admin', allHosts: true, acceptedAt: null }]
  mockItems = [
    {
      id: 'si_plan',
      quantity: 1,
      price: { id: 'price_starter_monthly', recurring: { interval: 'month' } },
    },
    {
      id: 'si_host',
      quantity: 5,
      price: { id: 'price_starter_host', recurring: { interval: 'month' } },
    },
    {
      id: 'si_dataset',
      quantity: 4,
      price: { id: 'price_starter_dataset', recurring: { interval: 'month' } },
    },
    {
      id: 'si_seat',
      quantity: 3,
      price: { id: 'price_starter_seat', recurring: { interval: 'month' } },
    },
  ]
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    mockStripeCalls.push({
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
            current_period_end: PERIOD_END,
            metadata: { plan: 'starter', orgId: ORG_ID },
            items: { data: mockItems },
          },
        ],
      }
    } else if (href.includes('/subscription_schedules')) {
      // A schedule created `from_subscription` carries ONE phase — the
      // present, filled from the subscription's own items. The reduction
      // appends the target phase to it; the same doc answers the update POST,
      // since only the request body is under test.
      payload = {
        id: 'sub_sched_1',
        status: 'not_started',
        end_behavior: 'release',
        phases: [
          {
            start_date: PERIOD_END - 2592000,
            end_date: PERIOD_END,
            items: (mockItems as any[]).map((item) => ({
              price: item.price.id,
              ...(item.quantity == null ? {} : { quantity: item.quantity }),
            })),
            automatic_tax: { enabled: true },
          },
        ],
      }
    } else if (href.includes('/invoices/upcoming')) {
      payload = { amount_due: 0, currency: 'usd', lines: { data: [] } }
    } else if (href.includes('/subscriptions/sub_1')) {
      payload = { id: 'sub_1', status: 'active', items: { data: mockItems } }
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

describe('the fixture reaches the code under test', () => {
  it('uses the real Starter numbers, not a hand-written table', () => {
    const { PLAN_ENTITLEMENTS } = jest.requireActual(
      '@aglyn/aglyn/app-utils/plan-entitlements',
    )
    // Every expectation below is arithmetic on these three. If the resolver
    // were stubbed they would all be 0 and the refusals would be coming from
    // the purchase-ceiling check instead.
    expect(PLAN_ENTITLEMENTS.starter.hostLimit).toBe(1)
    expect(PLAN_ENTITLEMENTS.starter.datasetsPerOrg).toBe(3)
    expect(PLAN_ENTITLEMENTS.starter.managersPerOrg).toBe(2)
  })
})

describe('reducing org-wide capacity below what it carries is refused', () => {
  it('5 extra sites carrying 4 sites cannot drop to 2', async () => {
    // THE DEFECT: this answered 200, the subscription lost the item, and the
    // four sites kept serving on capacity nobody was paying for.
    const response = await setQuantity('hosts', 2)
    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload.code).toBe('capacity_in_use')
    expect(payload).toMatchObject({ count: 4, included: 1, inUse: 3, release: 1 })
  })

  it('and the refusal names the count, the ceiling and the remedy', async () => {
    // "You cannot do that" is a support ticket. Every number a customer needs
    // to act is in this sentence.
    const payload = await (await setQuantity('hosts', 2)).json()
    expect(payload.error).toBe(
      'You have 4 sites. Your plan includes 1, so 3 of the extra sites you ' +
        'bought are in use. Remove 1 site first, then reduce to 2.',
    )
  })

  it('datasets are gated the same way', async () => {
    const response = await setQuantity('datasets', 2)
    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload).toMatchObject({ count: 6, included: 3, inUse: 3, release: 1 })
    expect(payload.error).toBe(
      'You have 6 datasets. Your plan includes 3, so 3 of the extra datasets ' +
        'you bought are in use. Remove 1 dataset first, then reduce to 2.',
    )
  })

  it('manager seats are gated the same way, invites included', async () => {
    // 3 roster managers + 1 pending invite = 4. The invite holds its seat:
    // the invite gate has always counted it, so a reduction that ignored it
    // would strand a teammate mid-onboarding.
    const response = await setQuantity('managers', 1)
    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload).toMatchObject({ count: 4, included: 2, inUse: 2, release: 1 })
    expect(payload.error).toBe(
      'You have 4 team members. Your plan includes 2, so 2 of the extra team ' +
        'seats you bought are in use. Remove 1 team member first, then ' +
        'reduce to 1.',
    )
  })

  it('nothing reaches Stripe, so no proration is raised', async () => {
    // A refusal that had already moved the subscription would be the worst of
    // both outcomes: charged for a change the console says it rejected.
    await setQuantity('hosts', 2)
    expect(billingCalls()).toEqual([])
  })

  it('and no seatAddons mirror is written', async () => {
    await setQuantity('datasets', 0)
    expect(mockOrgWrites).toEqual([])
  })

  it('a PREVIEW of a refused reduction is refused too', async () => {
    // Quoting a credit for a change that will be rejected is a lie about what
    // happens next, and the customer reads the quote before they act.
    const response = await setQuantity('hosts', 0, 'preview')
    expect(response.status).toBe(409)
    expect(billingCalls()).toEqual([])
  })
})

/**
 * The rule is "never below what the capacity is CARRYING" — not "never down",
 * not "never while over a cap", and not "never at all". Without these, a guard
 * that refused every reduction would pass every assertion above.
 */
describe('CONTROL — what the gate must still let through', () => {
  it('reducing to EXACTLY the in-use count is allowed and is scheduled', async () => {
    // 4 sites, 1 included, so 3 of the 5 bought sites are carrying something.
    // Dropping the other 2 costs nobody anything.
    //
    // Permitted, and therefore WRITTEN: the target phase carries 3. A status
    // code on its own would be satisfied by a gate that let the request in and
    // then did nothing with it.
    const response = await setQuantity('hosts', 3)
    expect(response.status).toBe(200)
    expect(scheduledQuantity('price_starter_host')).toBe('3')
    // Deferred, so the live subscription keeps all 5 until the renewal.
    expect(updatedQuantity()).toBeNull()
  })

  it('the same boundary holds for datasets and seats', async () => {
    expect((await setQuantity('datasets', 3)).status).toBe(200)
    expect(scheduledQuantity('price_starter_dataset')).toBe('3')
    mockStripeCalls = []
    expect((await setQuantity('managers', 2)).status).toBe(200)
    expect(scheduledQuantity('price_starter_seat')).toBe('2')
  })

  it('increasing is untouched', async () => {
    // The gate only reads on a reduction, and an increase is still immediate:
    // it is the subscription that moves, today, not a phase.
    const response = await setQuantity('hosts', 7)
    expect(response.status).toBe(200)
    expect(updatedQuantity()).toBe('7')
    expect(scheduleUpdate()).toBeNull()
  })

  it('an unreadable count refuses nothing', async () => {
    // A count nobody could read is not a reason to refuse a customer — that
    // is our outage charged to them. It is also not zero; it simply cannot
    // decide, so the reduction proceeds as it did before this gate existed.
    //
    // Proceeding means the removal is SCHEDULED: the host line is gone from
    // the target phase and still on the phase the org is billed for today.
    mockSiteCount = null
    const response = await setQuantity('hosts', 0)
    expect(response.status).toBe(200)
    expect(targetPhasePrices()).not.toContain('price_starter_host')
    expect(targetPhasePrices()).toContain('price_starter_monthly')
    expect(updatedQuantity()).toBeNull()
  })

  it('an org already over a cap for other reasons is not newly blocked', async () => {
    // GRANDFATHERING. Staff shrank this org's included datasets to 1 while it
    // holds 6 — it is 5 over, and it bought NOTHING. Nothing about being over
    // a cap may create a refusal: the gate is attached to the purchase, and
    // there is no purchase here.
    mockOrg = {
      plan: 'starter',
      subscription: { status: 'active' },
      entitlements: { datasetsPerOrg: 1 },
      seatAddons: { hosts: 5, managers: 3 },
    }
    mockItems = (mockItems as any[]).filter((item) => item.id !== 'si_dataset')
    expect((await setQuantity('datasets', 0)).status).toBe(200)
    mockStripeCalls = []
    expect((await setQuantity('datasets', 2)).status).toBe(200)
    expect(updatedQuantity()).toBe('2')
  })

  it('the Event Calendar is a feature switch and is not gated by this', async () => {
    // The capacities that survive use-time enforcement are the ones where
    // refusing refuses a machine or a feature rather than a person or their
    // data. Turning the calendar off takes nothing away from anybody.
    mockOrg = {
      ...mockOrg,
      seatAddons: { ...(mockOrg as any).seatAddons, eventCalendar: 1 },
    }
    mockItems = [
      ...(mockItems as any[]),
      {
        id: 'si_cal',
        quantity: 1,
        price: { id: 'price_cal', recurring: { interval: 'month' } },
      },
    ]
    const response = await setQuantity('eventCalendar', 0)
    expect(response.status).toBe(200)
    // Not gated, so it is written — off at the renewal, on until then, which
    // is the same "paid for, so kept" rule every other reduction follows.
    expect(targetPhasePrices()).not.toContain('price_cal')
    expect((await response.json()).pendingAddonChange).toMatchObject({
      kind: 'eventCalendar',
      quantity: 0,
    })
  })
})

/**
 * The clamp, tested directly on the pure function.
 *
 * The route only reaches the gate on a real reduction, so this property never
 * shows up through the HTTP surface — but it is the whole grandfathering
 * guarantee, and the thing that keeps the refusal's numbers TRUE for an org
 * that is over a cap it did not choose.
 */
describe('the in-use figure never exceeds what the org bought', () => {
  const load = () =>
    require('../utils/server/capacity-in-use') as typeof import('../utils/server/capacity-in-use')

  it('an org holding no add-on is never refused, however far over it is', () => {
    const { capacityReductionRefusal } = load()
    expect(
      capacityReductionRefusal({
        kind: 'datasets',
        quantity: 0,
        currentQuantity: 0,
        included: 1,
        counts: { datasetCount: 40 },
      }),
    ).toBeNull()
  })

  it('and an org over a cap for other reasons is told what IT bought', () => {
    // 20 datasets on a plan including 3, but only 5 were ever purchased. The
    // in-use figure is 5, not 17 — "17 of the extra datasets you bought are
    // in use" would be a false sentence about somebody's invoice.
    const { capacityReductionRefusal } = load()
    const refusal = capacityReductionRefusal({
      kind: 'datasets',
      quantity: 0,
      currentQuantity: 5,
      included: 3,
      counts: { datasetCount: 20 },
    })
    expect(refusal).toMatchObject({ inUse: 5, release: 17 })
  })
})
