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
 * THE ROLLUP HAS TO CARRY THE ASSIST BILL (AGL-2280).
 *
 * `orgs/{id}/usage/{month}` is the document every cost reader on the platform
 * reads — the staff usage table, `/api/admin/org-usage`, the enterprise
 * pricing preview, `orgCogsInputFrom`. Aglyn Assist's provider spend lived in
 * `orgs/{id}/assistUsage/{month}` and the rollup never touched it, so the one
 * line item big enough to matter was absent from the only document those
 * surfaces look at.
 *
 * The mutation this file exists to kill is NOT "is the field present".
 * A writer that records `assistCostUsd: 0`, or a fixed 0.001, or drops the
 * read and defaults, satisfies every presence check. So the load-bearing test
 * runs the SAME org twice with two different `estCostUsd` seeds and demands
 * the rollup change by exactly the delta.
 *
 * It also pins the boundary the other way: Assist is entitled by plan, not
 * metered on the invoice, and `billedCents` must be byte-for-byte what it was.
 * A cost that started charging customers because it started being measured
 * would be a far worse defect than the one being fixed.
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
  throw new Error(`unexpected fetch: ${href}`)
})

const ORIGINAL_ENV = process.env
const MONTH = '2026-07'
const ROLLUP = `orgs/org-1/usage/${MONTH}`

/** A modest paid org — small enough that Assist is the interesting number. */
function seedOrg(assistEstCostUsd: number | undefined) {
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
  if (assistEstCostUsd !== undefined) {
    mockDocs.set(`orgs/org-1/assistUsage/${MONTH}`, {
      month: MONTH,
      messages: 812,
      estCostUsd: assistEstCostUsd,
    })
  }
}

function loadRoute() {
  jest.resetModules()
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
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

/** One full sweep for a given Assist bill; returns the rollup it wrote. */
async function rollupFor(assistEstCostUsd: number | undefined) {
  seedOrg(assistEstCostUsd)
  meterEvents.length = 0
  const response = await runRollup(loadRoute())
  expect(response.status).toBe(200)
  const rollup = mockDocs.get(ROLLUP)
  expect(rollup).toBeDefined()
  return rollup as Record<string, any>
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('report-usage records Assist provider spend (AGL-2280)', () => {
  it('THE MEASURED VALUE, NOT A CONSTANT — the rollup tracks estCostUsd', async () => {
    // Three sweeps, three different bills, same everything else. A writer
    // that recorded a fixed figure — or dropped the read and defaulted —
    // passes any single-seed "is it there" check and dies here.
    const cheap = await rollupFor(0.4)
    const dear = await rollupFor(63.75)
    const huge = await rollupFor(1_204.5)

    expect(cheap['assistCostUsd']).toBeCloseTo(0.4, 8)
    expect(dear['assistCostUsd']).toBeCloseTo(63.75, 8)
    expect(huge['assistCostUsd']).toBeCloseTo(1_204.5, 8)
    // Stated as a delta as well, so a writer that echoed some OTHER dollar
    // figure off the same document is red too.
    expect(huge['assistCostUsd'] - dear['assistCostUsd']).toBeCloseTo(
      1_140.75,
      6,
    )
  })

  it('an org that has never used Assist records a real zero, not undefined', async () => {
    // No `assistUsage` document. The field still has to be written, or the
    // staff table cannot tell "no Assist" from "this rollup predates the
    // field" — which is the same silence one layer along.
    const rollup = await rollupFor(undefined)
    expect(rollup['assistCostUsd']).toBe(0)
  })

  it('refuses a negative Assist figure rather than crediting COGS', async () => {
    const rollup = await rollupFor(-500)
    expect(rollup['assistCostUsd']).toBe(0)
  })

  it('does NOT charge for it — billedCents is unchanged by Assist', async () => {
    /*
      The boundary, asserted in the direction that would be worse to get
      wrong. Assist is entitled by plan; it enters COGS because it is what an
      org costs us, and it must not enter the invoice because nobody agreed to
      a per-token price. Same org, one with a $1,200 Assist bill and one with
      none: the meter event that reaches Stripe has to be identical.
    */
    const none = await rollupFor(undefined)
    const noneEvents = meterEvents.map((event) => event.get('payload[value]'))
    const huge = await rollupFor(1_204.5)
    const hugeEvents = meterEvents.map((event) => event.get('payload[value]'))

    expect(huge['billedCents']).toBe(none['billedCents'])
    expect(hugeEvents).toEqual(noneEvents)
    // And the recorded cost estimate — the one that DOES feed `billedCents`
    // — must not have absorbed it either.
    expect(huge['costUsd']).toBeCloseTo(none['costUsd'], 10)
  })
})
