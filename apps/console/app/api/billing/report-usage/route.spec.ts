/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`/`URL`.
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
 * THE IN-PROGRESS MONTH SWEEP (AGL-2219).
 *
 * ## What was broken
 *
 * `report-usage` is the only writer of `orgs/{id}/usage/{month}`, and its
 * month defaulted to `previousMonth()` while the scheduler posted it with no
 * body. So the document for the month **in progress** did not exist, and
 * every consumer that asks "what has this org spent this month" — the usage
 * budget cron, the Billing card — read a missing document, correctly called
 * it `meteredFresh: false`, and said nothing. The whole of AGL-1528 was
 * structurally silent while its own suite was green, because that suite
 * fabricates a current-month rollup production never produced.
 *
 * ## The two properties this suite exists for
 *
 * 1. **`?month=current` writes the rollup.** Without it there is nothing for
 *    a budget to read, and the first case here is the missing-document state
 *    itself, asserted directly so the defect can never quietly return.
 * 2. **An open month NEVER reaches Stripe.** The meter event is keyed
 *    `{orgId}-{month}` — Stripe dedupes on it and our own `reportedAt` then
 *    skips the org for good, so metering a month early does not report early,
 *    it freezes that month at a partial figure forever. Every path that can
 *    name an open month is driven here, including the body form that predates
 *    the query one.
 *
 * ## The adapter is REAL
 *
 * `pluginRequestFromWeb` parses the query string, and the query string is
 * where the month has to live: the chunked-sweep protocol re-POSTs
 * `{"cursor": ...}` and nothing else, so a month in the body would apply to
 * the first chunk and silently revert for every chunk after it. A mocked
 * adapter that returned no `query` would make the whole feature untestable
 * while looking tested, so this suite uses the real one.
 *
 * Every case was forced red before it was kept; each says how.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore, modelling only the reads `report-usage` performs.
// ---------------------------------------------------------------------------

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

interface MockFilter {
  field: string
  op: string
  value: unknown
}

/**
 * MODELS THE DOCUMENT-ID RANGE FILTER, unlike a `where: () => chainable` stub.
 *
 * `hostUsage` selects the month's analytics with
 * `where(documentId(), '>=', '{month}-01')` and `<= '{month}-31'`. A double
 * that ignored those clauses would return EVERY seeded day, so a fixture
 * holding two months would fold both into one figure — and the central claim
 * here ("the current-month sweep totals the current month") would pass no
 * matter which month the route asked for. That is the exact class of
 * unfaithful double that fabricates a green.
 */
function applyFilters(paths: string[], filters: MockFilter[]): string[] {
  return paths.filter((path) => {
    const id = path.split('/').pop() as string
    return filters.every((filter) => {
      if (filter.field !== '__name__') return true
      const value = String(filter.value)
      if (filter.op === '>=') return id >= value
      if (filter.op === '<=') return id <= value
      if (filter.op === '==') return id === value
      return true
    })
  })
}

function mockQuery(path: string, filters: MockFilter[] = []) {
  const build = () => {
    const docs = applyFilters(mockChildPaths(path), filters)
      .sort()
      .map(mockSnapshot)
    return { docs, size: docs.length, empty: docs.length === 0 }
  }
  const chainable: any = {
    where: (field: string, op: string, value: unknown) =>
      mockQuery(path, [...filters, { field, op, value }]),
    orderBy: () => chainable,
    select: () => chainable,
    startAfter: () => chainable,
    limit: () => chainable,
    get: async () => build(),
    // `contacts.count().get()` is an aggregate, read through `.data().count`
    // rather than `.get('count')`. Modelled exactly: the route reads
    // `contactsSnap.data().count` and `apiUsageSnap.get('count')`, and a fake
    // that blurred the two shapes would make a meter read zero for the wrong
    // reason.
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
    // `set(..., {merge:true})` conjures a missing document and merges a
    // present one. The rollup write is the only `set` the route performs.
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
  // PRESENT on every run. If a missing customer id were what suppressed the
  // meter event, this suite would prove nothing about the month.
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_org' }),
  getServerReleaseFlagValues: async () => ({}),
  emailSendsOverage: () => 0,
}))

jest.mock('@aglyn/aglyn/server', () => {
  const entitlements = jest.requireActual(
    '@aglyn/aglyn/app-utils/plan-entitlements',
  )
  const adapter = jest.requireActual('@aglyn/aglyn/app-utils/api-adapter')
  return {
    __esModule: true,
    // REAL: the arithmetic under the figure a budget reads.
    checkApiRequestQuota: entitlements.checkApiRequestQuota,
    checkContactQuota: entitlements.checkContactQuota,
    checkDataStorageQuota: entitlements.checkDataStorageQuota,
    resolveOrgEntitlements: entitlements.resolveOrgEntitlements,
    // REAL: the query string is the mechanism, so parsing it must not be
    // simulated. See the header.
    pluginRequestFromWeb: adapter.pluginRequestFromWeb,
    // Node-payload sizing measures nothing here; storage pressure is applied
    // through the media counter, a real input to the same estimate.
    decodeStoredNodes: () => ({}),
    nodeMapBytes: () => 0,
    isReleaseFlagOnForOrg: () => true,
    parseOrgReleaseFlagOverrides: () => ({}),
  }
})

jest.mock('../../../../utils/cron-auth', () => ({
  __esModule: true,
  isCronAuthorized: () => true,
}))

jest.mock('../../../../utils/org-counter-totals', () => ({
  __esModule: true,
  orgCounterTotals: async () => ({
    emailSends: 0,
    workflowRuns: 0,
    actionRuns: 0,
    orgLibraryBytes: 0,
  }),
}))

jest.mock('../../../../utils/screen-cap-reconciliation', () => ({
  __esModule: true,
  measureScreenCaps: async () => ({ maxBillable: 0, overCapHostIds: [] }),
}))

// ---------------------------------------------------------------------------

import { currentMonth, previousMonth } from '../../../../utils/billing-month'

const GB = 1024 * 1024 * 1024

/** Every Stripe Billing Meter event the route actually posted. */
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

/** The month in progress, and the closed one behind it — from the real clock. */
const OPEN = currentMonth()
const CLOSED = previousMonth()

/**
 * One Starter org with one host, carrying usage in BOTH months.
 *
 * Two months on purpose. With only the month under test seeded, a sweep that
 * asked for the wrong month would read zero and look quiet rather than wrong,
 * and the document-id filter modelled above would never be exercised.
 */
function seedOrg() {
  mockDocs.clear()
  mockDocs.set('hosts/host-1', { orgId: 'org-1', screens: {} })
  mockDocs.set('orgs/org-1', {
    plan: 'starter',
    subscription: { status: 'active' },
  })
  // 250 GB stored — far past any band, and NOT month-scoped: storage is a
  // level, not a flow, so both sweeps see it.
  mockDocs.set('hosts/host-1/counters/media', { bytes: 250 * GB })
  mockDocs.set('hosts/host-1/counters/formSubmissions', {
    [OPEN]: 10_000,
    [CLOSED]: 4_000,
  })
  // Distinguishable page-view volumes, one per month.
  mockDocs.set(`hosts/host-1/analytics/${OPEN}-15`, { total: 1_000_000 })
  mockDocs.set(`hosts/host-1/analytics/${CLOSED}-15`, { total: 300_000 })
  mockDocs.set(`orgs/org-1/apiUsage/${OPEN}`, { count: 50_000 })
  mockDocs.set(`orgs/org-1/apiUsage/${CLOSED}`, { count: 20_000 })
}

function loadRoute() {
  jest.resetModules()
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
    STRIPE_METER_EVENT_NAME: 'aglyn_metered_usage',
    CRON_SECRET: 'test-cron-secret',
  } as NodeJS.ProcessEnv
  return require('./route').POST as (request: Request) => Promise<Response>
}

/** Posts the route the way the scheduler does: a URL, and no body at all. */
function runSweep(
  post: (request: Request) => Promise<Response>,
  options: { query?: string; body?: Record<string, unknown> } = {},
) {
  const url = `https://app.aglyn.com/api/billing/report-usage${options.query ?? ''}`
  return post(
    new Request(url, {
      method: 'POST',
      headers: {
        'x-cron-secret': 'test-cron-secret',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }),
  )
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  meterEvents.length = 0
  fetchMock.mockClear()
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('the defect: a bodyless sweep never wrote the month in progress', () => {
  it('rolls up the CLOSED month and leaves the open one absent', async () => {
    // THE PRODUCTION STATE AGL-2219 IS ABOUT, asserted directly. This is what
    // the daily 02:00 job did and still does, and on its own it is why every
    // usage budget was silent: `usage/{OPEN}` simply did not exist, so
    // `orgMonthlySpend` read `meteredFresh: false` and declined to speak.
    //
    // Forced red by making the route default to `currentMonth()` — the
    // absence assertion then failed, which is the point: this case exists to
    // pin the default, not to bless it.
    seedOrg()
    const response = await runSweep(loadRoute())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      month: CLOSED,
      closed: true,
    })

    expect(mockDocs.get(`orgs/org-1/usage/${CLOSED}`)).toBeDefined()
    expect(mockDocs.get(`orgs/org-1/usage/${OPEN}`)).toBeUndefined()
  })
})

describe('?month=current writes the figure a budget reads', () => {
  it('rolls up the month in progress', async () => {
    seedOrg()
    const response = await runSweep(loadRoute(), { query: '?month=current' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      month: OPEN,
      closed: false,
    })

    const rollup = mockDocs.get(`orgs/org-1/usage/${OPEN}`)
    expect(rollup).toBeDefined()
    // The two fields `orgMonthlySpend` actually consumes. Anything else on
    // this document is somebody else's contract.
    expect(rollup!['month']).toBe(OPEN)
    expect(rollup!['billedCents']).toBeGreaterThan(0)
    // Forced red by reverting the month resolution to `previousMonth()`:
    // `usage/{OPEN}` came back undefined on the first assertion.
  })

  it('totals THIS month, not the one behind it', async () => {
    // The month-selection assertion with teeth. Both months carry usage and
    // the figures differ, so a sweep reading the wrong window produces the
    // wrong number rather than the same one.
    seedOrg()
    await runSweep(loadRoute(), { query: '?month=current' })
    const rollup = mockDocs.get(`orgs/org-1/usage/${OPEN}`)!
    expect(rollup['pageViews']).toBe(1_000_000)
    expect(rollup['formSubmissions']).toBe(10_000)
    expect(rollup['apiRequests']).toBe(50_000)

    // Forced red by removing the document-id filter from `applyFilters`: page
    // views came back 1,300,000 — both months folded together — which is the
    // number an unfaithful double would have blessed.
  })

  it('and the usage was MEASURED, so a later $0 would mean $0', async () => {
    // Guards the reason, not just the result: if every counter read as zero —
    // a starved projection, a mis-modelled read — `billedCents > 0` above
    // would be the only thing standing, and it would fail loudly rather than
    // silently. This says the inputs were real.
    seedOrg()
    await runSweep(loadRoute(), { query: '?month=current' })
    const rollup = mockDocs.get(`orgs/org-1/usage/${OPEN}`)!
    expect(rollup['storageGb']).toBeCloseTo(250, 3)
    expect(rollup['costUsd']).toBeGreaterThan(0)
  })
})

describe('an OPEN month never reaches Stripe', () => {
  it('posts no meter event and stamps no reportedAt', async () => {
    // THE SAFETY PROPERTY. The meter event is keyed `{orgId}-{month}`, Stripe
    // dedupes on it, and `reportedAt` then skips the org permanently — so a
    // partial month that reached Stripe would be the org's invoice for that
    // month, uncorrectable. There is no undo, only this branch.
    seedOrg()
    await runSweep(loadRoute(), { query: '?month=current' })

    expect(meterEvents).toHaveLength(0)
    expect(mockDocs.get(`orgs/org-1/usage/${OPEN}`)!['reportedAt']).toBeUndefined()

    // Forced red by dropping `closed &&` from the metering condition: one
    // meter event appeared carrying the mid-month `billedCents`.
  })

  it('POSITIVE CONTROL: the closed month DOES meter, off the same fixture', async () => {
    // Without this the suite is satisfied by a route that bills nobody, or by
    // a fetch mock that is never reached — the same green for a worse reason.
    // One thing differs between this case and the one above: which month.
    seedOrg()
    await runSweep(loadRoute())

    expect(meterEvents).toHaveLength(1)
    expect(meterEvents[0].get('identifier')).toBe(`org-1-${CLOSED}`)
    expect(Number(meterEvents[0].get('payload[value]'))).toBeGreaterThan(0)
    expect(
      mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!['reportedAt'],
    ).toBe('<server-timestamp>')
  })

  it('refuses an open month named in the BODY too, not only the query', async () => {
    // The pre-existing footgun. `body.month` has always been accepted, and a
    // manual backfill that typed this month's key would have frozen the
    // month. The guard is on the month, not on how it was spelled.
    seedOrg()
    const response = await runSweep(loadRoute(), { body: { month: OPEN } })
    await expect(response.json()).resolves.toMatchObject({
      month: OPEN,
      closed: false,
    })
    expect(meterEvents).toHaveLength(0)
    expect(mockDocs.get(`orgs/org-1/usage/${OPEN}`)!['reportedAt']).toBeUndefined()
  })

  it('refuses a FUTURE month, which is neither closed nor in progress', async () => {
    seedOrg()
    const future = `${Number(OPEN.slice(0, 4)) + 1}-06`
    const response = await runSweep(loadRoute(), { body: { month: future } })
    await expect(response.json()).resolves.toMatchObject({
      month: future,
      closed: false,
    })
    expect(meterEvents).toHaveLength(0)
  })
})

describe('the in-progress rollup refreshes rather than freezing', () => {
  it('a second sweep of the open month updates billedCents', async () => {
    // `report-usage` skips an org-month that already carries `reportedAt`. An
    // open month never gets one, so the daily sweep keeps the figure current —
    // which is the difference between a budget that tracks spend and one that
    // reports whatever the first run of the month happened to see.
    seedOrg()
    await runSweep(loadRoute(), { query: '?month=current' })
    const first = Number(mockDocs.get(`orgs/org-1/usage/${OPEN}`)!['billedCents'])
    expect(first).toBeGreaterThan(0)

    mockDocs.set(`hosts/host-1/analytics/${OPEN}-16`, { total: 5_000_000 })
    await runSweep(loadRoute(), { query: '?month=current' })
    const second = Number(
      mockDocs.get(`orgs/org-1/usage/${OPEN}`)!['billedCents'],
    )
    expect(second).toBeGreaterThan(first)

    // Forced red by stamping `reportedAt` on the open month: the second sweep
    // hit the already-reported skip and `second` equalled `first`.
  })
})
