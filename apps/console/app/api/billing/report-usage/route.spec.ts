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
    // Same allow-list hazard the note below records — omit it and the
    // TypeError is swallowed per org rather than failing the assertion.
    priceEmailSendOverage: entitlements.priceEmailSendOverage,
    resolveOrgEntitlements: entitlements.resolveOrgEntitlements,
    // The org's effective tier, REAL (AGL-2486): the release-flag gates in
    // this route are evaluated against it, and an allow-list mock that omits
    // an export the route imports does not fail loudly — the per-org catch
    // swallows the TypeError and the sweep answers 207 with no rollup at all.
    resolveEffectivePlan: entitlements.resolveEffectivePlan,
    // AGL-2405: the route resolves the metered price through
    // `utils/server/billing-addons`, which derives PAID_PLANS from
    // SELF_SERVE_PLANS at module load. REAL, because these ARE the pricing
    // constants — a stub here would be a stubbed price.
    SELF_SERVE_PLANS: entitlements.SELF_SERVE_PLANS,
    PLAN_PRICING: entitlements.PLAN_PRICING,
    EVENT_CALENDAR_ADDON_MONTHLY_USD:
      entitlements.EVENT_CALENDAR_ADDON_MONTHLY_USD,
    POS_REGISTER_ADDON_MONTHLY_USD: entitlements.POS_REGISTER_ADDON_MONTHLY_USD,
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

/**
 * What `GET /v1/subscriptions` answers — the check AGL-1878 put in front of
 * the meter event.
 *
 * Default is a LIVE subscription carrying the metered price, because that is
 * the shape every pre-existing case in this suite assumes: they assert that a
 * closed month DOES meter, and if the default were "no metered item" they
 * would all still pass for the wrong reason (nothing posted, because nothing
 * was billable). A test changes this only when the missing item is the subject.
 */
let subscriptionsResponse: { ok: boolean; body: any } = {
  ok: true,
  body: {
    data: [
      {
        status: 'active',
        items: {
          data: [
            { price: { id: 'price_plan' } },
            { price: { id: 'price_metered_test' } },
          ],
        },
      },
    ],
  },
}

/** Every subscriptions read the route made, so "it asked" is assertable. */
const subscriptionReads: string[] = []

const fetchMock = jest.fn(async (url: unknown, init?: any) => {
  const href = String(url)
  if (href.includes('/billing/meter_events')) {
    meterEvents.push(new URLSearchParams(String(init?.body ?? '')))
    return { ok: true, json: async () => ({ object: 'billing.meter_event' }) }
  }
  if (href.includes('/v1/subscriptions')) {
    subscriptionReads.push(href)
    return {
      ok: subscriptionsResponse.ok,
      json: async () => subscriptionsResponse.body,
    }
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

function loadRoute(extraEnv: Record<string, string> = {}) {
  jest.resetModules()
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
    STRIPE_METER_EVENT_NAME: 'aglyn_metered_usage',
    // The price ids the AGL-1878 check matches a subscription item against.
    STRIPE_PRICE_METERED: 'price_metered_test',
    STRIPE_PRICE_METERED_YEARLY: 'price_metered_yearly_test',
    // EXPLICITLY EMPTY, overridden by the one case that is about it. `nx test`
    // leaks the root `.env`, so a real meter id could otherwise arrive here
    // and decide a match nothing in this file asked for.
    STRIPE_METER_ID: '',
    CRON_SECRET: 'test-cron-secret',
    ...extraEnv,
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
  subscriptionReads.length = 0
  fetchMock.mockClear()
  subscriptionsResponse = {
    ok: true,
    body: {
      data: [
        {
          status: 'active',
          items: {
            data: [
              { price: { id: 'price_plan' } },
              { price: { id: 'price_metered_test' } },
            ],
          },
        },
      ],
    },
  }
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

/*==========================================
 * AGL-1878 — A STRIPE 200 IS NOT A CHARGE.
 *
 * `POST /v1/billing/meter_events` returns 200 for any valid customer id. It
 * says nothing about whether that customer has a subscription item priced on
 * the meter, and without one the event lands on the meter and reaches NO
 * invoice line. The route used to stamp `reportedAt` on that 200, which makes
 * the org-month permanently skipped — so the usage was measured, accepted, and
 * forfeited, silently and for good.
 *
 * Observed on LIVE Stripe before this suite existed: customer
 * `cus_UuQjDdd1oxPMNH` carries a meter event of 3 units dated 2026-08-01 (the
 * July rollup) while its subscription `sub_1TubsJ…` has a plan item and no
 * metered item. The other live subscription, which does carry the yearly
 * metered item, shows the line on its invoice. The item is the whole
 * difference.
 *
 * Every case below was forced red before it was kept; each says how.
 *=========================================*/
describe('AGL-1878: usage is withheld rather than forfeited when nothing can bill it', () => {
  /** A subscriptions payload with a plan item and no metered item. */
  function subscriptionWithoutMeteredItem(status = 'active') {
    return {
      ok: true,
      body: { data: [{ status, items: { data: [{ price: { id: 'price_plan' } }] } }] },
    }
  }

  it('posts NO meter event when the subscription carries no metered item', async () => {
    seedOrg()
    subscriptionsResponse = subscriptionWithoutMeteredItem()
    await runSweep(loadRoute())

    expect(subscriptionReads).toHaveLength(1)
    expect(subscriptionReads[0]).toContain('customer=cus_test_org')
    expect(meterEvents).toHaveLength(0)

    // Forced red by deleting the `meterReportBlockedReason` call: one meter
    // event appeared, exactly the live `cus_UuQjDdd1oxPMNH` shape.
  })

  it('does NOT stamp reportedAt, so the month stays re-sweepable', async () => {
    // THE MONEY PROPERTY. `reportedAt` is what makes an org-month permanently
    // skipped; withholding the stamp is the difference between revenue that is
    // recoverable and revenue that is gone.
    seedOrg()
    subscriptionsResponse = subscriptionWithoutMeteredItem()
    await runSweep(loadRoute())

    const rollup = mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!
    expect(rollup['reportedAt']).toBeUndefined()
    expect(rollup['meterReportBlocked']).toBe('no-metered-item')
    expect(rollup['meterUnbilledCents']).toBe(rollup['billedCents'])
    expect(rollup['meterUnbilledCents']).toBeGreaterThan(0)

    // And a later sweep, once the item exists, DOES report it — the whole
    // point of not stamping.
    subscriptionsResponse = {
      ok: true,
      body: {
        data: [
          {
            status: 'active',
            items: { data: [{ price: { id: 'price_metered_yearly_test' } }] },
          },
        ],
      },
    }
    await runSweep(loadRoute())
    expect(meterEvents).toHaveLength(1)
    expect(meterEvents[0].get('identifier')).toBe(`org-1-${CLOSED}`)
    expect(
      mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!['reportedAt'],
    ).toBe('<server-timestamp>')

    // Forced red by restoring the old `if (response.ok) reported = true` with
    // no gate: the first sweep stamped `reportedAt`, and the second — the
    // sweep that represents somebody attaching the item — reported nothing at
    // all, which is the defect stated as a test.
  })

  it('answers 207 with the unbilled cents named, so the workflow fails', async () => {
    // 207 is this cron's only alerting channel (`scheduled-crons.yml` exits
    // non-zero on it). Money measured and charged to nobody must not be
    // something you find by reading a rollup document you had no reason to
    // open.
    seedOrg()
    subscriptionsResponse = subscriptionWithoutMeteredItem()
    const response = await runSweep(loadRoute())

    expect(response.status).toBe(207)
    const payload: any = await response.json()
    expect(payload.unbilled['org-1'].reason).toBe('no-metered-item')
    expect(payload.unbilled['org-1'].billedCents).toBeGreaterThan(0)

    // Forced red by returning `failed.length ? 207 : 200`: status was 200 and
    // `unbilled` was absent, i.e. the leak was silent again.
  })

  it('treats a metered item on a DEAD subscription as no item at all', async () => {
    // A canceled subscription generates no further invoice, so an event
    // reported against it is an event nobody pays. The item being present is
    // not the question; the subscription being able to bill is.
    seedOrg()
    subscriptionsResponse = {
      ok: true,
      body: {
        data: [
          {
            status: 'canceled',
            items: { data: [{ price: { id: 'price_metered_test' } }] },
          },
        ],
      },
    }
    await runSweep(loadRoute())

    expect(meterEvents).toHaveLength(0)
    expect(
      mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!['meterReportBlocked'],
    ).toBe('no-metered-item')

    // Forced red by dropping the `BILLABLE_SUBSCRIPTION_STATUSES` test: the
    // canceled subscription's item counted and the event was posted.
  })

  it('matches on the METER id too, not only the configured price ids', async () => {
    // The price ids can be re-minted (`aglyn_metered_usage_yearly` was, on
    // 2026-08-09); the meter is what actually prices the event. A deployment
    // whose `STRIPE_PRICE_METERED*` drifted from Stripe must still bill.
    seedOrg()
    subscriptionsResponse = {
      ok: true,
      body: {
        data: [
          {
            status: 'active',
            items: {
              data: [
                { price: { id: 'price_reminted', recurring: { meter: 'mtr_test' } } },
              ],
            },
          },
        ],
      },
    }
    await runSweep(loadRoute({ STRIPE_METER_ID: 'mtr_test' }))

    expect(meterEvents).toHaveLength(1)

    // Forced red by matching on the price ids alone: no event, because the
    // re-minted price id is in no env var.
  })

  it('withholds when the subscription read FAILS, rather than guessing', async () => {
    // Failing to ASK is treated as a "no". An unreported month reports late
    // and visibly; a wrongly-stamped one is silent and permanent, so the
    // unknown answer must take the recoverable branch.
    seedOrg()
    subscriptionsResponse = { ok: false, body: { error: { message: 'boom' } } }
    const response = await runSweep(loadRoute())

    expect(meterEvents).toHaveLength(0)
    expect(response.status).toBe(207)
    const rollup = mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!
    expect(rollup['meterReportBlocked']).toBe('check-failed')
    expect(rollup['reportedAt']).toBeUndefined()

    // Forced red by returning `null` from the `!response.ok` arm: the event
    // was posted into the dark on a Stripe outage.
  })

  it('names the ENVIRONMENT when no metered price is configured at all', async () => {
    // The hazard this check introduces, stated as a test. With no
    // `STRIPE_METER_ID` and neither price id set, nothing can be matched — so
    // the route withholds from EVERYBODY, and it must say the deployment is
    // misconfigured rather than blame each customer's subscription. Withheld,
    // not forfeited: `reportedAt` is unstamped and the 207 repeats daily until
    // somebody sets the variable.
    seedOrg()
    const response = await runSweep(
      loadRoute({ STRIPE_PRICE_METERED: '', STRIPE_PRICE_METERED_YEARLY: '' }),
    )

    // It does not even ASK Stripe: there is nothing to compare an answer to.
    expect(subscriptionReads).toHaveLength(0)
    expect(meterEvents).toHaveLength(0)
    expect(response.status).toBe(207)
    const rollup = mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!
    expect(rollup['meterReportBlocked']).toBe('meter-not-configured')
    expect(rollup['reportedAt']).toBeUndefined()

    // Forced red by deleting the `!meterId && !meteredPriceConfigured` guard:
    // the reason came back as `no-metered-item`, pointing an operator at the
    // customer's subscription for a fault in their own env.
  })

  it('an ANNUAL-only deployment is configured, and is asked about (AGL-2405)', async () => {
    // "Configured" means EITHER price id, not the monthly one. An all-annual
    // deployment has `STRIPE_PRICE_METERED_YEARLY` and no monthly price, and
    // calling that `meter-not-configured` would withhold from every customer
    // on it and send an operator hunting a variable that is correctly unset.
    //
    // This is the case that keeps the two-interval probe honest: with only the
    // monthly id consulted, everything else in this suite still passes,
    // because the one env test above blanks BOTH ids.
    seedOrg()
    const response = await runSweep(
      loadRoute({ STRIPE_PRICE_METERED: '' }),
    )

    // It ASKED — which is the half a monthly-only probe would skip.
    expect(subscriptionReads).toHaveLength(1)
    const rollup = mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!
    expect(rollup['meterReportBlocked']).not.toBe('meter-not-configured')
    // The fixture's item carries the MONTHLY price, so on an annual-only
    // deployment it genuinely is not on this meter — the customer-level
    // answer, reached by looking rather than by giving up.
    expect(rollup['meterReportBlocked']).toBe('no-metered-item')
    expect(rollup['reportedAt']).toBeUndefined()
    expect(response.status).toBe(207)
  })

  it('POSITIVE CONTROL: a clean sweep is still 200 and records no block', async () => {
    // Without this the suite is satisfied by a route that withholds from
    // everybody, which loses more money than the bug did.
    seedOrg()
    const response = await runSweep(loadRoute())

    expect(response.status).toBe(200)
    expect(meterEvents).toHaveLength(1)
    const rollup = mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!
    expect(rollup['meterReportBlocked']).toBeNull()
    expect(rollup['meterUnbilledCents']).toBe(0)
    expect(rollup['reportedAt']).toBe('<server-timestamp>')
  })

  it('never reads subscriptions for an OPEN month — no month, no cost', async () => {
    // The check is inside the `closed` branch. An in-progress sweep runs daily
    // over every org and must not pay a Stripe round trip per org for a
    // question it is not allowed to act on.
    seedOrg()
    await runSweep(loadRoute(), { query: '?month=current' })

    expect(subscriptionReads).toHaveLength(0)
    expect(meterEvents).toHaveLength(0)
    expect(
      mockDocs.get(`orgs/org-1/usage/${OPEN}`)!['meterUnbilledCents'],
    ).toBe(0)

    // Forced red by hoisting the check above `if (closed …)`: one subscription
    // read per org per day, and `meterUnbilledCents` claimed the running
    // mid-month figure was money owed.
  })
})


/*==========================================
 * THE STOCK MEASURES ARE TAKEN INSIDE THE MONTH THEY BILL (AGL-2399).
 *
 * ## What was broken
 *
 * Four dimensions are metered; two of them are not month-scoped counters.
 * API requests read `apiUsage/{month}.count` and form submissions read
 * `counters/formSubmissions.{month}` — both are FLOWS, accumulated inside the
 * period and unaffected by anything done afterwards. Contacts and dataset
 * storage are STOCKS: `contacts.count()` and `orgDatasetBytes()` are live
 * readings of the collection as it stands at the instant the sweep runs, and
 * the closed-month sweep runs at 02:00 UTC on the 1st — i.e. AFTER the month
 * it is billing has ended.
 *
 * So the amount charged for August depended on what the customer did in
 * September, in both directions:
 *
 *   - bulk-delete on the 1st and August's audience-band overage vanishes,
 *   - import on the 1st and the import lands on August's invoice.
 *
 * And a re-sweep on the 3rd measured a THIRD value, so the figure was not even
 * stable across runs of the same month — only `reportedAt` froze it, and only
 * for whichever run happened to report first.
 *
 * ## The convention, and why this one
 *
 * A stock has no single honest monthly figure; the candidates are period-end,
 * peak and time-weighted mean, and each charges a different amount for the
 * same behaviour. This picks **the last reading taken INSIDE the period** —
 * the `?month=current` sweep's final daily write, recorded as
 * `contactsCountAtPeriodEnd` / `dataStorageMbAtPeriodEnd`.
 *
 * It is the narrowest change that makes the meter honest, and deliberately so,
 * because pricing is locked for Sept 1:
 *
 *   1. It keeps the same STATISTIC — a point-in-time level. Only the instant
 *      it is read moves, from just after the period to the last moment inside
 *      it. Peak and mean are different statistics and would be a pricing
 *      decision; this is a measurement-window fix.
 *   2. It is the number the customer was already shown. The console meter and
 *      the budget card read `contactsCount`/`dataStorageMb` off this very
 *      document, written by the in-progress sweep — so the invoice now equals
 *      the last figure the console displayed, instead of one no surface ever
 *      showed.
 *   3. It is computable for every month. Mean needs a complete daily series;
 *      months before the in-progress sweep existed have none.
 *   4. The platform's other level meters (host media bytes, org-library bytes)
 *      are already billed as point-in-time levels, so the four meters stay
 *      mutually consistent.
 *
 * Peak is the only candidate that fully closes the bulk-delete-before-the-31st
 * vector. That remains the call; it would raise bills, which is the
 * direction the locked-pricing rule reserves for him.
 *=========================================*/
describe('contacts and dataset storage bill the month, not the sweep (AGL-2399)', () => {
  /** Starter: 1,000 contacts included at $1.00/1k, 1,024 MB at $0.25/GB. */
  const CONTACTS_AT_PERIOD_END = 6_000
  const DATA_MB_AT_PERIOD_END = 5_000
  /** 5,000 contacts over the band at $1/1k. */
  const EXPECTED_CONTACT_OVERAGE_USD = 5
  /** (5000 - 1024) MB = 3.8828125 GB x $0.25, rounded to the cent. */
  const EXPECTED_DATA_OVERAGE_USD = 0.97

  /**
   * What last month's daily in-progress sweeps left on the document — the
   * fixture is the production state, not a contrivance: `?month=current` wrote
   * `usage/{CLOSED}` every day while CLOSED was the month in progress, and the
   * last of those writes is the period-end reading.
   */
  function seedPeriodEndReading(
    fields: Record<string, unknown> = {
      contactsCountAtPeriodEnd: CONTACTS_AT_PERIOD_END,
      dataStorageMbAtPeriodEnd: DATA_MB_AT_PERIOD_END,
    },
  ) {
    mockDocs.set(`orgs/org-1/usage/${CLOSED}`, {
      month: CLOSED,
      ...fields,
    })
  }

  /** `count()` counts seeded documents, so this IS the live reading. */
  function seedLiveContacts(howMany: number) {
    for (let index = 0; index < howMany; index += 1) {
      mockDocs.set(`orgs/org-1/contacts/contact-${index}`, { email: 'a@b.c' })
    }
  }

  it('a bulk-delete on the 1st no longer erases the closed month (under-billing)', async () => {
    // The gaming vector. August ended with 6,000 contacts and 5,000 MB of
    // datasets; on 1 September the customer deleted almost all of it, hours
    // before the 02:00 sweep. Under the old basis August billed the ten
    // records that survived, which is $0 of a $5.97 overage.
    //
    // FORCED RED: on the pre-fix route this case failed on the first
    // expectation with `contactsOverageUsd: 0` and `dataOverageUsd: 0` — the
    // sweep read the live collection and found ten contacts and no datasets.
    seedOrg()
    seedPeriodEndReading()
    seedLiveContacts(10)

    const response = await runSweep(loadRoute())
    expect(response.status).toBe(200)

    const rollup = mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!
    expect(rollup['contactsOverageUsd']).toBe(EXPECTED_CONTACT_OVERAGE_USD)
    expect(rollup['dataOverageUsd']).toBe(EXPECTED_DATA_OVERAGE_USD)
    // The BASIS is on the document, so "why was I charged this" is answerable
    // from the audit row alone.
    expect(rollup['stockBasis']).toBe('period-end')
    // The figures the console reads are the billed ones, not the post-period
    // measurement — a meter that disagrees with the invoice is its own bug.
    expect(rollup['contactsCount']).toBe(CONTACTS_AT_PERIOD_END)
    expect(rollup['dataStorageMb']).toBe(DATA_MB_AT_PERIOD_END)
    // What the sweep saw is still recorded, under a name that says when it
    // was taken. Dropping it would make the two bases indistinguishable in
    // the very months somebody will want to compare them.
    expect(rollup['contactsCountAtSweep']).toBe(10)
  })

  it('an import on the 1st is not billed to the month before it (over-billing)', async () => {
    // The other direction, and the one that is harder to defend in a support
    // conversation. August ended inside every band; the customer imported
    // 6,000 contacts on 1 September and the closed-month sweep put that
    // import on AUGUST's invoice.
    //
    // FORCED RED: pre-fix, `contactsOverageUsd` came back as 5 — a $5 charge
    // for records that did not exist during the month being billed.
    seedOrg()
    seedPeriodEndReading({
      contactsCountAtPeriodEnd: 10,
      dataStorageMbAtPeriodEnd: 0,
    })
    seedLiveContacts(CONTACTS_AT_PERIOD_END)

    await runSweep(loadRoute())

    const rollup = mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!
    expect(rollup['contactsCount']).toBe(10)
    expect(rollup['contactsOverageUsd']).toBe(0)
    expect(rollup['contactsCountAtSweep']).toBe(CONTACTS_AT_PERIOD_END)
    expect(rollup['stockBasis']).toBe('period-end')
  })

  it('a re-sweep days later bills the same figure (idempotency, AGL-1878)', async () => {
    // The daily cron re-sweeps any org-month lacking `reportedAt`, so a month
    // blocked on the 1st is measured again on the 2nd and the 3rd. On a live
    // reading that is a different number every time; the amount was stable
    // only by accident, because `reportedAt` froze whichever run reported
    // first. Here it is stable BY CONSTRUCTION: the closed sweep never writes
    // the period-end fields, so every re-run reads the same frozen input.
    //
    // FORCED RED: pre-fix the second sweep billed 5000 more contacts than the
    // first, and the two `billedCents` differed by 500.
    seedOrg()
    seedPeriodEndReading()
    seedLiveContacts(10)
    // No metered item, so nothing reports and `reportedAt` is never stamped —
    // which is exactly the state that earns an org a re-sweep tomorrow.
    subscriptionsResponse = { ok: true, body: { data: [] } }

    const first = await runSweep(loadRoute())
    const firstCents = (await first.json()).orgs['org-1'].billedCents

    // A day passes and the customer re-imports. The closed month must not care.
    seedLiveContacts(CONTACTS_AT_PERIOD_END)
    subscriptionsResponse = { ok: true, body: { data: [] } }
    const second = await runSweep(loadRoute())
    const secondCents = (await second.json()).orgs['org-1'].billedCents

    expect(secondCents).toBe(firstCents)
    expect(mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!['contactsCount']).toBe(
      CONTACTS_AT_PERIOD_END,
    )
  })

  it('the in-progress sweep is what records the period-end reading', async () => {
    // The writer half. Nothing above can hold if the daily `?month=current`
    // run does not put these fields on the document — and it must write them
    // on EVERY in-progress run, so the last one before the month rolls over
    // is the reading the closed sweep inherits.
    //
    // FORCED RED by writing the fields unconditionally instead of only when
    // the month is open: the closed sweep then overwrote the period-end
    // reading with its own post-period measurement on the first re-sweep, and
    // the idempotency case above went red with it.
    seedOrg()
    seedLiveContacts(2_500)

    await runSweep(loadRoute(), { query: '?month=current' })

    const rollup = mockDocs.get(`orgs/org-1/usage/${OPEN}`)!
    expect(rollup['contactsCountAtPeriodEnd']).toBe(2_500)
    expect(rollup['dataStorageMbAtPeriodEnd']).toBe(rollup['dataStorageMb'])
    // An open month is measured now BY DEFINITION — "now" is inside it.
    expect(rollup['stockBasis']).toBe('in-progress')
  })

  it('a closed month with no in-period reading falls back, and says so', async () => {
    // Months that ended before the in-progress sweep existed have no daily
    // series at all, and an org created in the last seventeen hours of a
    // month misses the final 07:00 run. Refusing to bill those would forfeit
    // real revenue; billing them silently on the old basis would hide which
    // months are comparable. So it falls back and NAMES the fallback.
    //
    // FORCED RED by making the fallback bill zero: the sweep charged nothing
    // for 6,000 contacts and the case failed on `contactsOverageUsd`.
    seedOrg()
    seedLiveContacts(CONTACTS_AT_PERIOD_END)

    await runSweep(loadRoute())

    const rollup = mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!
    expect(rollup['stockBasis']).toBe('sweep-time')
    expect(rollup['contactsCount']).toBe(CONTACTS_AT_PERIOD_END)
    expect(rollup['contactsOverageUsd']).toBe(EXPECTED_CONTACT_OVERAGE_USD)
  })

  it('POSITIVE CONTROL: the FLOW meters are untouched by any of this', async () => {
    // Page views, form submissions and API requests are month-scoped counters
    // and were always honest. If this change moved them, it moved something
    // it had no business near — and every figure in this suite would shift
    // together, which is how a basis change disguises itself as a fix.
    seedOrg()
    seedPeriodEndReading()
    seedLiveContacts(10)

    await runSweep(loadRoute())

    const rollup = mockDocs.get(`orgs/org-1/usage/${CLOSED}`)!
    expect(rollup['apiRequests']).toBe(20_000)
    expect(rollup['pageViews']).toBe(300_000)
    expect(rollup['formSubmissions']).toBe(4_000)
  })
})
