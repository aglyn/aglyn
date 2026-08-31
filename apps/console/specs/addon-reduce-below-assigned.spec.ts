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
 * Shrinking a seat POOL below what is already assigned takes capacity away
 * from a site nobody chose.
 *
 * `posRegisters` and `members` are org-level pools; a separate allocation map
 * (`registerAllocations` / `collaboratorAllocations`) says which site each seat
 * sits on. `/api/billing/addons` validated only `0 <= quantity <= max`, so a
 * reduction below the assigned count was accepted, the allocation map kept
 * every row, and the pool arbiter resolved the shortfall BY SORTED HOST ID — a
 * merchant dropping one register seat could take it off a different store, and
 * re-buying re-granted from the same stale map.
 *
 * Assertions are on the REFUSAL and on the Stripe call list — the stored
 * quantity and the money — never on rendered output.
 *
 * NO STRIPE PATH IS EXERCISED. `fetch` is mocked and never calls out;
 * localhost carries the LIVE key.
 */

export {}

const ORG_ID = 'org-1'

/** The org document the route reads plan, seatAddons and allocations from. */
let mockOrg: Record<string, unknown> = {}
/** Every Stripe request the route made, in order. */
let mockStripeCalls: Array<{ href: string; method: string; body: string }> = []
/** Everything written to the org doc (the `seatAddons` mirror). */
let mockOrgWrites: unknown[] = []
/** Subscription items, rebuilt per test from `mockOrg.seatAddons`. */
let mockItems: unknown[] = []

const mockOrgRef = {
  get: async () => ({
    data: () => mockOrg,
    ref: {
      set: async (value: unknown) => {
        mockOrgWrites.push(value)
      },
    },
  }),
  // `orgs/{id}/datasets` (a count) and `orgs/{id}/invites` (a query). An org
  // holding nothing: the ORG-WIDE capacity gate has to evaluate for real and
  // permit, rather than decline to decide because the double throws.
  collection: () => ({
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    where: () => ({ get: async () => ({ docs: [] }) }),
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
          // `hosts` where `orgId ==` — the site count.
          where: () => ({
            count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
          }),
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
  listOrgMembers: async () => [],
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
  // The REAL plan model. A stubbed resolver answers zero for every ceiling,
  // which would make each case here refuse at the `max` check instead of the
  // assignment check — passing for the wrong reason.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ),
  // The REAL manager-seat counter — the org-wide capacity gate measures held
  // seats with it, and a stub would count collaborators as manager seats.
  countManagerSeats: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/organizations',
  ).countManagerSeats,
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
  STRIPE_PRICE_BUSINESS: 'price_business_monthly',
  STRIPE_PRICE_POS_REGISTER: 'price_pos_register',
  STRIPE_PRICE_BUSINESS_EXTRA_MEMBER: 'price_business_member',
  STRIPE_PRICE_BUSINESS_EXTRA_SEAT: 'price_business_seat',
}

function loadAddons() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/addons/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function setQuantity(kind: string, quantity: number) {
  return loadAddons()(
    new Request('https://app.aglyn.com/api/billing/addons', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: ORG_ID, action: 'set', kind, quantity }),
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

beforeEach(() => {
  mockStripeCalls = []
  mockOrgWrites = []
  // A Business org: four register seats bought, THREE of them assigned to two
  // different sites. Business sells `pos`, so the ceiling is well above these.
  mockOrg = {
    plan: 'business',
    subscription: { status: 'active' },
    seatAddons: { posRegisters: 4, members: 4, managers: 4 },
    registerAllocations: { 'host-a': 2, 'host-b': 1 },
    collaboratorAllocations: { 'host-a': 3 },
  }
  mockItems = [
    {
      id: 'si_plan',
      quantity: 1,
      price: { id: 'price_business_monthly', recurring: { interval: 'month' } },
    },
    {
      id: 'si_pos',
      quantity: 4,
      price: { id: 'price_pos_register', recurring: { interval: 'month' } },
    },
    {
      id: 'si_member',
      quantity: 4,
      price: { id: 'price_business_member', recurring: { interval: 'month' } },
    },
    {
      id: 'si_seat',
      quantity: 4,
      price: { id: 'price_business_seat', recurring: { interval: 'month' } },
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
            items: { data: mockItems },
          },
        ],
      }
    } else if (href.includes('/invoices/upcoming')) {
      payload = {
        amount_due: 0,
        currency: 'usd',
        lines: { data: [] },
      }
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

describe('reducing a pooled add-on below what is assigned is refused', () => {
  it('4 registers with 3 assigned cannot drop to 2', async () => {
    // THE DEFECT: this used to answer 200, shrink the pool, and leave the
    // allocation map to be arbitrated by sorted host id.
    const response = await setQuantity('posRegisters', 2)
    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload.code).toBe('assigned_seats_exceed_quantity')
    expect(payload.assigned).toBe(3)
  })

  it('the refusal names how many to unassign first', async () => {
    // "Unassign 1 first" is the whole difference between a dead end and a
    // next step; 3 assigned minus 2 wanted.
    const payload = await (await setQuantity('posRegisters', 2)).json()
    expect(payload.error).toContain('Unassign 1')
  })

  it('and nothing reaches Stripe, so no proration is raised', async () => {
    // A refusal that had already moved the subscription would be the worst of
    // both outcomes: charged for a change the console says it rejected.
    await setQuantity('posRegisters', 2)
    expect(billingCalls()).toEqual([])
  })

  it('and no seatAddons mirror is written', async () => {
    await setQuantity('posRegisters', 2)
    expect(mockOrgWrites).toEqual([])
  })

  it('collaborator seats are pooled the same way and refuse the same way', async () => {
    // `members` reads `collaboratorAllocations` — 3 assigned on host-a.
    const response = await setQuantity('members', 1)
    expect(response.status).toBe(409)
    expect((await response.json()).assigned).toBe(3)
  })

  it('a reduction all the way to zero is refused too', async () => {
    const response = await setQuantity('posRegisters', 0)
    expect(response.status).toBe(409)
    expect(billingCalls()).toEqual([])
  })
})

/**
 * The rule is "never below what is ASSIGNED", not "never down" and not "never
 * at all". Without these, a guard that refused every reduction — or every
 * write — would pass every assertion above.
 */
describe('CONTROL — what the guard must still let through', () => {
  it('reducing to EXACTLY the assigned count is allowed and reaches Stripe', async () => {
    const response = await setQuantity('posRegisters', 3)
    expect(response.status).toBe(200)
    expect(updatedQuantity()).toBe('3')
  })

  it('increasing is untouched', async () => {
    const response = await setQuantity('posRegisters', 6)
    expect(response.status).toBe(200)
    expect(updatedQuantity()).toBe('6')
  })

  it('an EMPTY allocation map is "none assigned", not "not a pool"', async () => {
    // Zero assigned is a real state: the reduction proceeds. This is what
    // separates a 0 from the `null` the non-pooled kinds return.
    mockOrg = { ...mockOrg, registerAllocations: {} }
    const response = await setQuantity('posRegisters', 0)
    expect(response.status).toBe(200)
  })

  it('an org-wide kind with NO allocation map is not gated by this', async () => {
    // Manager seats, datasets, extra sites and the Event Calendar are org-wide
    // capacity with no per-site assignment — there is nothing an ALLOCATION
    // can contradict. `collaboratorAllocations` is populated here on purpose:
    // a guard that summed whichever map it found, rather than the one
    // belonging to the kind being changed, would refuse this.
    //
    // They carry a separate gate against what the capacity is CARRYING
    // (`addon-reduce-below-in-use.spec.ts`), and this org holds nothing, so
    // that one permits — which is why the doubles above count for real.
    const response = await setQuantity('managers', 1)
    expect(response.status).toBe(200)
    expect(updatedQuantity()).toBe('1')
  })
})
