/**
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
 *
 * @jest-environment node
 */

// Without a top-level import or export TypeScript treats this file as a global
// script, so its top-level `const`s collide with identically-named ones in
// sibling specs (TS2451/TS2393). The marker makes it a module.
export {}

/**
 * THE CASH FEE HAS TO REACH AN INVOICE (AGL-2111).
 *
 * `pos-order.ts` now charges the plan's platform fee on every POS tender,
 * cash and folio included, and accrues the non-card half to
 * `orgs/{id}/offlineFees/{YYYY-MM}` — because those tenders never touch
 * Stripe and there is no charge to net an `application_fee_amount` out of.
 * This route is the ONLY thing that turns that accrual into money: it is the
 * sole writer of the org-month rollup and the sole sender of the Billing
 * Meter event.
 *
 * So a fee written on an order and never swept is the same zero it replaced —
 * [[written-but-never-read]] wearing a new field name. The load-bearing test
 * here is therefore not "is `offlinePosFeeCents` present on the rollup" but
 * "does `payload[value]`, the number Stripe actually bills, move by exactly
 * the accrued amount". Two seeds, and the delta asserted, so a writer that
 * records a constant — or records the field and forgets to add it to
 * `billedCents` — is red.
 *
 * The boundary is pinned the other way too: an accrual for a DIFFERENT month
 * must not be billed into this one, which is what would happen if the read
 * used its own clock instead of the month being swept.
 */

const mockDocs = new Map<string, Record<string, any>>()

/** Direct children of `path` — a collection read must not return grandchildren. */
function mockChildPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function mockSnapshot(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    path,
    exists: data !== undefined,
    data: () => data ?? {},
    get: (field: string) => data?.[field],
    ref: mockDocRef(path),
  }
}

function mockQuery(path: string) {
  const build = () => {
    const docs = mockChildPaths(path).sort().map(mockSnapshot)
    return { docs, size: docs.length, empty: docs.length === 0 }
  }
  const chainable: any = {
    where: () => chainable,
    orderBy: () => chainable,
    select: () => chainable,
    startAfter: () => chainable,
    limit: () => chainable,
    get: async () => build(),
    // `contacts.count().get()` is an aggregate read through `.data().count`,
    // while `apiUsage` and `assistUsage` are document reads through
    // `.get(field)`. Two different shapes, modelled as two different shapes —
    // blurring them would make a meter read zero for the wrong reason.
    count: () => ({
      get: async () => ({ data: () => ({ count: build().docs.length }) }),
    }),
  }
  return chainable
}

function mockDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => mockSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      mockDocs.set(
        path,
        options?.merge ? { ...(mockDocs.get(path) ?? {}), ...value } : value,
      )
    },
    collection: (name: string) => mockCollection(`${path}/${name}`),
  }
}

function mockCollection(path: string): any {
  const query = mockQuery(path)
  return { ...query, doc: (id: string) => mockDocRef(`${path}/${id}`) }
}

const mockFirestore: any = {
  collection: (name: string) => mockCollection(name),
  getAll: async (...refs: any[]) => Promise.all(refs.map((ref) => ref.get())),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore }),
    firestore: {
      FieldValue: { serverTimestamp: () => '<server-timestamp>' },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_org_1' }),
  getServerReleaseFlagValues: async () => ({}),
  emailSendsOverage: () => 0,
}))

jest.mock('@aglyn/aglyn/server', () => {
  const actual = jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
  return {
    __esModule: true,
    // REAL arithmetic — a stubbed quota would make every figure below a test
    // of the stub rather than of the route.
    checkApiRequestQuota: actual.checkApiRequestQuota,
    checkContactQuota: actual.checkContactQuota,
    checkDataStorageQuota: actual.checkDataStorageQuota,
    resolveOrgEntitlements: actual.resolveOrgEntitlements,
    // AGL-2405: the route resolves the metered price through
    // `utils/server/billing-addons`, which derives PAID_PLANS from
    // SELF_SERVE_PLANS at module load. REAL, because these ARE the pricing
    // constants — a stub here would be a stubbed price.
    SELF_SERVE_PLANS: actual.SELF_SERVE_PLANS,
    PLAN_PRICING: actual.PLAN_PRICING,
    EVENT_CALENDAR_ADDON_MONTHLY_USD: actual.EVENT_CALENDAR_ADDON_MONTHLY_USD,
    POS_REGISTER_ADDON_MONTHLY_USD: actual.POS_REGISTER_ADDON_MONTHLY_USD,
    decodeStoredNodes: () => ({}),
    nodeMapBytes: () => 0,
    isReleaseFlagOnForOrg: () => true,
    parseOrgReleaseFlagOverrides: () => ({}),
    pluginRequestFromWeb: async (request: Request) => ({
      method: request.method,
      body: await request.json(),
      headers: { 'x-cron-secret': 'test-cron-secret' },
    }),
  }
})

jest.mock('../utils/cron-auth', () => ({
  __esModule: true,
  isCronAuthorized: () => true,
}))

jest.mock('../utils/org-counter-totals', () => ({
  __esModule: true,
  orgCounterTotals: async () => ({
    emailSends: 0,
    workflowRuns: 0,
    actionRuns: 0,
    orgLibraryBytes: 0,
  }),
}))

jest.mock('../utils/screen-cap-reconciliation', () => ({
  __esModule: true,
  measureScreenCaps: async () => ({ maxBillable: 0, overCapHostIds: [] }),
}))

const meterEvents: URLSearchParams[] = []
const fetchMock = jest.fn(async (url: unknown, init?: any) => {
  const href = String(url)
  if (href.includes('/billing/meter_events')) {
    meterEvents.push(new URLSearchParams(String(init?.body ?? '')))
    return { ok: true, json: async () => ({ object: 'billing.meter_event' }) }
  }
  // AGL-1878: the route asks whether the customer holds a subscription item
  // priced on the meter BEFORE it reports, because a 200 from `meter_events`
  // is not a charge. Answered YES so this suite's positive controls assert a
  // real meter event — a "no" would silence them and they would pass for the
  // wrong reason. What this file is about is the accrual, not the
  // subscription item, so the answer is a constant.
  if (href.includes('/v1/subscriptions')) {
    return {
      ok: true,
      json: async () => ({
        data: [
          {
            status: 'active',
            items: { data: [{ price: { id: 'price_metered_test' } }] },
          },
        ],
      }),
    }
  }
  throw new Error(`unexpected fetch: ${href}`)
})

const ORIGINAL_ENV = process.env
const MONTH = '2026-07'
const OTHER_MONTH = '2026-06'
const ROLLUP = `orgs/org-1/usage/${MONTH}`

/**
 * A modest paid org with an optional cash-fee accrual for the swept month.
 * Everything else is held byte-for-byte constant between seeds, so any change
 * in the billed figure can only have come from the accrual.
 */
function seedOrg(offline?: { feeCents?: unknown; orders?: number; month?: string }) {
  mockDocs.clear()
  mockDocs.set('hosts/host-1', { orgId: 'org-1', screens: {} })
  mockDocs.set('orgs/org-1', {
    plan: 'business',
    subscription: { status: 'active' },
  })
  mockDocs.set('hosts/host-1/counters/media', { bytes: 12 * 1024 * 1024 })
  mockDocs.set('hosts/host-1/counters/formSubmissions', { [MONTH]: 4 })
  mockDocs.set(`hosts/host-1/analytics/${MONTH}-15`, { total: 900 })
  mockDocs.set(`orgs/org-1/apiUsage/${MONTH}`, { count: 30 })
  if (offline) {
    const month = offline.month ?? MONTH
    mockDocs.set(`orgs/org-1/offlineFees/${month}`, {
      month,
      feeCents: offline.feeCents,
      orders: offline.orders ?? 1,
    })
  }
}

function loadRoute() {
  jest.resetModules()
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
    // What the AGL-1878 subscription-item check matches the customer's items
    // against. Unset, the route takes the `meter-not-configured` branch and
    // bills nothing, for a reason that has nothing to do with this fix.
    STRIPE_PRICE_METERED: 'price_metered_test',
    STRIPE_METER_EVENT_NAME: 'aglyn_metered_usage',
    CRON_SECRET: 'test-cron-secret',
  } as NodeJS.ProcessEnv
  return require('../app/api/billing/report-usage/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function runRollup(post: (request: Request) => Promise<Response>) {
  return post(
    new Request('https://app.aglyn.com/api/billing/report-usage', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': 'test-cron-secret',
      },
      body: JSON.stringify({ month: MONTH }),
    }),
  )
}

/** One full sweep; returns the rollup written and the meter values sent. */
async function rollupFor(
  offline?: { feeCents?: unknown; orders?: number; month?: string },
) {
  seedOrg(offline)
  meterEvents.length = 0
  const response = await runRollup(loadRoute())
  expect(response.status).toBe(200)
  const rollup = mockDocs.get(ROLLUP)
  expect(rollup).toBeDefined()
  return {
    rollup: rollup as Record<string, any>,
    events: meterEvents.length,
    // Units sent to the meter, summed — 0 when no event left the process,
    // which is the right reading: `report-usage` sends nothing at all when
    // `billedCents` is 0, and this org's baseline usage sits inside its
    // plan's bands. So every unit below is the accrual and nothing else.
    metered: meterEvents.reduce(
      (sum, event) => sum + Number(event.get('payload[value]') ?? 0),
      0,
    ),
  }
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('report-usage bills the cash/folio POS platform fee (AGL-2111)', () => {
  it('THE ACCRUED VALUE REACHES STRIPE, and moves by exactly the delta', async () => {
    const none = await rollupFor(undefined)
    const small = await rollupFor({ feeCents: 8, orders: 1 })
    const large = await rollupFor({ feeCents: 4_213, orders: 517 })

    // The baseline org sits inside every included band, so nothing reaches
    // Stripe at all — which makes every unit below attributable to the
    // accrual and to nothing else.
    expect(none.events).toBe(0)
    expect(none.metered).toBe(0)
    // The number Stripe is handed IS `billedCents`, and the meter is priced
    // at $0.01/unit — so one unit is one cent of platform fee.
    expect(small.metered - none.metered).toBe(8)
    expect(large.metered - none.metered).toBe(4_213)
    // Stated on `billedCents` too, because the rollup is what every staff
    // revenue surface reads and the two must not disagree.
    expect(small.rollup['billedCents'] - none.rollup['billedCents']).toBe(8)
    expect(large.rollup['billedCents'] - small.rollup['billedCents']).toBe(4_205)
  })

  it('records the amount and the sale count on the rollup', async () => {
    const { rollup } = await rollupFor({ feeCents: 4_213, orders: 517 })
    expect(rollup['offlinePosFeeCents']).toBe(4_213)
    expect(rollup['offlinePosFeeOrders']).toBe(517)
  })

  it('a store that took no cash records a real zero, not undefined', async () => {
    // Without the field the rollup cannot tell "no cash sales" from "this
    // month predates the sweep" — the same silence one layer along.
    const { rollup } = await rollupFor(undefined)
    expect(rollup['offlinePosFeeCents']).toBe(0)
    expect(rollup['offlinePosFeeOrders']).toBe(0)
  })

  /*=====================================================================
   * NEGATIVE CONTROLS. This document is written by a different service, so
   * every malformed shape has to bill zero rather than REDUCE an invoice.
   *====================================================================*/

  it('a negative accrual does not credit the invoice', async () => {
    const none = await rollupFor(undefined)
    const negative = await rollupFor({ feeCents: -50_000 })
    expect(negative.rollup['offlinePosFeeCents']).toBe(0)
    expect(negative.metered).toBe(none.metered)
  })

  it('a NaN or stringly-typed accrual bills nothing', async () => {
    const none = await rollupFor(undefined)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 'lots', null]) {
      const { rollup, metered } = await rollupFor({ feeCents: bad })
      expect(rollup['offlinePosFeeCents']).toBe(0)
      expect(metered).toBe(none.metered)
    }
  })

  it("does not bill ANOTHER month's accrual into this one", async () => {
    // The accrual is keyed by the month the sale was rung in, and the sweep
    // asks for one month. A read that used its own clock rather than the
    // swept month would double-bill June onto July's invoice.
    const none = await rollupFor(undefined)
    const stale = await rollupFor({ feeCents: 9_999, month: OTHER_MONTH })
    expect(stale.rollup['offlinePosFeeCents']).toBe(0)
    expect(stale.metered).toBe(none.metered)
  })
})
