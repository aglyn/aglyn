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
import { assistMonthOverage } from '@aglyn/aglyn/app-utils/assist-credits'

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
 * It also pins the boundary the other way, on both of its sides. Inside the
 * plan's band Assist is entitled, not metered: `billedCents` must be
 * byte-for-byte what it was, because a cost that started charging customers
 * merely because it started being measured would be a far worse defect than
 * the one being fixed. Past the band the org has agreed to a price — the
 * plan's per-1,000-credit rate (AGL-2653) — so the overage, and only the
 * overage, joins the invoice.
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
    checkCrmRecordsQuota: actual.checkCrmRecordsQuota,
    checkDataStorageQuota: actual.checkDataStorageQuota,
    // Same allow-list hazard the note below records: omit this and the
    // route's TypeError is swallowed per org and the sweep answers with no
    // rollup at all rather than failing on the assertion under test.
    priceEmailSendOverage: actual.priceEmailSendOverage,
    resolveOrgEntitlements: actual.resolveOrgEntitlements,
    // The org's effective tier, REAL (AGL-2486): the release-flag gates in
    // this route are evaluated against it, and an allow-list mock that omits
    // an export the route imports does not fail loudly — the per-org catch
    // swallows the TypeError and the sweep answers 207 with no rollup at all.
    resolveEffectivePlan: actual.resolveEffectivePlan,
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
  if (href.includes('/v1/subscriptions')) {
    // A live subscription carrying the metered price: the org is billable,
    // so an Assist overage past the band has somewhere to go.
    return {
      ok: true,
      json: async () => ({
        data: [
          {
            status: 'active',
            items: {
              data: [{ price: { id: 'price_plan' } }, { price: { id: 'price_metered_test' } }],
            },
          },
        ],
      }),
    }
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
    stripeCustomerId: 'cus_org1',
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
    STRIPE_PRICE_METERED: 'price_metered_test',
    STRIPE_PRICE_METERED_YEARLY: 'price_metered_yearly_test',
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

  it('charges past the band and only there — inside it billedCents is unchanged by Assist', async () => {
    /*
      The boundary, asserted in both directions. Business includes 7,500
      credits ($7.50 of provider spend). Inside that band Assist enters COGS
      because it is what an org costs us, and it must not enter the invoice:
      same org, one with $6.50 of Assist and one with none, and the meter
      event that reaches Stripe has to be identical. Past the band the org
      has agreed to the plan's per-1,000-credit rate (AGL-2653), so the
      overage — and nothing but the overage — is what `billedCents` grows by.
      An org that chose the hard cap never gets here: assist stops at the
      band, so no overage accrues to bill.
    */
    const none = await rollupFor(undefined)
    const noneEvents = meterEvents.map((event) => event.get('payload[value]'))
    const inside = await rollupFor(6.5)
    const insideEvents = meterEvents.map((event) => event.get('payload[value]'))

    expect(inside['billedCents']).toBe(none['billedCents'])
    expect(insideEvents).toEqual(noneEvents)
    expect(inside['costUsd']).toBeCloseTo(none['costUsd'], 10)

    const huge = await rollupFor(1_204.5)
    const overage = assistMonthOverage({ plan: 'business' }, 1_204.5)
    expect(overage.overageCredits).toBe(1_204_500 - 7_500)
    expect(overage.overageMonthlyUsd).toBeGreaterThan(0)
    expect(huge['billedCents']).toBe(
      none['billedCents'] + Math.round(overage.overageMonthlyUsd * 100),
    )
    expect(huge['assistOverageUsd']).toBeCloseTo(overage.overageMonthlyUsd, 6)
    // The recorded cost estimate — the one that feeds `billedCents` for every
    // other metered line — has not absorbed the Assist bill on either side:
    // the overage is its own line, never a markup folded into COGS.
    expect(huge['costUsd']).toBeCloseTo(none['costUsd'], 10)
  })
})
