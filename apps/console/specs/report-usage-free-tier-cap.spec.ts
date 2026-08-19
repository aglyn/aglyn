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

/**
 * THE FREE TIER'S CAP, DRIVEN THROUGH THE ROUTE THAT CHARGES (AGL-2135).
 *
 * ZACH, 2026-08-18, verbatim: **"We also need to make sure the free/hobby tier
 * does hard cap so it always actually stays free"**.
 *
 * ## Why this exists next to `free-tier-never-billed.spec.ts`
 *
 * That suite is good and stays. But every one of its assertions is against
 * `estimateMonthlyUsageCost` and the four `check*Quota` functions **directly**,
 * and its own docblock is candid about what it does with the assembly on top:
 *
 * > *"The assembly `report-usage` performs, reproduced here as the sum that
 * > actually reaches Stripe"*
 *
 * A **reproduction** is a second copy of the logic, and a guard that reads a
 * copy cannot see the original change. `report-usage` adds four terms today;
 * a fifth priced meter — email sends and workflow/action runs are already
 * counted on that document and explicitly waiting for a rate — would be
 * invisible to a hand-written sum. So would a caller that posts the meter
 * event on a different condition than `billedCents > 0`.
 *
 * This suite therefore asserts the only thing that is actually true or false
 * about a free org's invoice: **did a Billing Meter event leave the process.**
 * `https://api.stripe.com/v1/billing/meter_events` is the single door between
 * a usage number and a customer's card, and it is fetch-mocked here, counted,
 * and asserted at zero.
 *
 * It is also the FIRST test of `report-usage` of any kind — the route that
 * decides what every paying org is billed had none.
 *
 * ## Forcing the branch, not reading the constant
 *
 * The org is driven past every band by a factor of 100–1000× on real counters,
 * and the SAME fixture is then run on Starter as a positive control: identical
 * usage, one field different, and a real meter event with a real value. Free's
 * zero is therefore proven to come from the plan, not from a fixture that
 * happens to measure nothing.
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
    // `contacts.count().get()` — an aggregate, whose result is read through
    // `.data().count`, not `.get('count')`. Modelled exactly: the route reads
    // `contactsSnap.data().count` and `apiUsageSnap.get('count')`, two
    // different shapes, and a fake that blurred them would make one of the
    // two meters read zero for the wrong reason.
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
  getAll: async (...refs: any[]) =>
    Promise.all(refs.map((ref) => ref.get())),
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
  // The org's mirrored Stripe customer. Present on BOTH plans on purpose: if
  // free's zero came from a missing customer id rather than from the plan,
  // this suite would be proving nothing about the tier.
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_free_org' }),
  getServerReleaseFlagValues: async () => ({}),
  emailSendsOverage: () => 0,
}))

jest.mock('@aglyn/aglyn/server', () => {
  const actual = jest.requireActual(
    '@aglyn/aglyn/app-utils/plan-entitlements',
  )
  return {
    __esModule: true,
    // REAL, not stubbed. These four are the arithmetic under test; a stub
    // would make every assertion below a test of the stub.
    checkApiRequestQuota: actual.checkApiRequestQuota,
    checkContactQuota: actual.checkContactQuota,
    checkDataStorageQuota: actual.checkDataStorageQuota,
    resolveOrgEntitlements: actual.resolveOrgEntitlements,
    // Node-payload sizing: irrelevant to the meter decision and expensive to
    // model, so it measures nothing. Storage pressure is applied through the
    // media counter instead, which is a real input to the same estimate.
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

// ---------------------------------------------------------------------------

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
const MONTH = '2026-07'

/**
 * One org, one host, every band blown by 100–1000×.
 *
 * Free includes 250 MB of media, ~8,948 page views (5 GB), 20 form
 * submissions, 0 MB of dataset storage, 0 API requests and 100 contacts.
 */
function seedOrg(plan: string) {
  mockDocs.clear()
  mockDocs.set('hosts/host-1', { orgId: 'org-1', screens: {} })
  mockDocs.set('orgs/org-1', {
    plan,
    ...(plan === 'free' ? {} : { subscription: { status: 'active' } }),
  })
  // 250 GB stored — 1000× the band.
  mockDocs.set('hosts/host-1/counters/media', { bytes: 250 * GB })
  // 10,000 submissions — 500× the band.
  mockDocs.set('hosts/host-1/counters/formSubmissions', { [MONTH]: 10_000 })
  // A million page views — ~112× the band.
  mockDocs.set(`hosts/host-1/analytics/${MONTH}-15`, { total: 1_000_000 })
  // 50,000 API requests against a free quota of zero.
  mockDocs.set(`orgs/org-1/apiUsage/${MONTH}`, { count: 50_000 })
  // 250 contacts — 2.5× the band. (The aggregate counts documents, so the
  // band is crossed with real rows rather than a hand-set number.)
  for (let index = 0; index < 250; index += 1) {
    mockDocs.set(`orgs/org-1/contacts/c-${index}`, { email: `c${index}@x.test` })
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

describe('report-usage: a free org blowing every band posts NO meter event (AGL-2135)', () => {
  it('sends nothing to Stripe, and writes a literal 0 on the rollup', async () => {
    seedOrg('free')
    const response = await runRollup(loadRoute())
    expect(response.status).toBe(200)

    // THE ASSERTION. Not "the sum was zero" — no event left the process, so
    // there is no usage record on the customer and no invoice line to explain.
    expect(meterEvents).toHaveLength(0)

    const rollup = mockDocs.get(`orgs/org-1/usage/${MONTH}`)
    expect(rollup).toBeDefined()
    expect(rollup!['billedCents']).toBe(0)
    // …and not because the org-month was skipped as already reported.
    expect(rollup!['reportedAt']).toBeUndefined()
  })

  it('and the usage was MEASURED, so the zero is a pricing decision', async () => {
    // The failure mode that would make the assertion above pass with every
    // protection removed: usage silently reading as 0 — a dropped counter, a
    // projection that starves the input, a fake that models a read wrong.
    // Then "no meter event" would be true for the wrong reason.
    seedOrg('free')
    await runRollup(loadRoute())
    const rollup = mockDocs.get(`orgs/org-1/usage/${MONTH}`)!
    expect(rollup['storageGb']).toBeCloseTo(250, 3)
    expect(rollup['pageViews']).toBe(1_000_000)
    expect(rollup['formSubmissions']).toBe(10_000)
    expect(rollup['apiRequests']).toBe(50_000)
    expect(rollup['contactsCount']).toBe(250)
    // Our own COGS stays truthful — under-reporting it is what makes the
    // discount guardrail too generous, so free's zero must not reach here.
    expect(rollup['costUsd']).toBeGreaterThan(100)
  })

  it('POSITIVE CONTROL: the same usage on STARTER posts a real meter event', async () => {
    // Identical fixture, one field different. Without this the suite is
    // satisfied by a route that bills nobody at all — or by a fetch mock that
    // is simply never reached, which is the same green for a worse reason.
    seedOrg('starter')
    const response = await runRollup(loadRoute())
    expect(response.status).toBe(200)

    expect(meterEvents).toHaveLength(1)
    expect(meterEvents[0].get('event_name')).toBe('aglyn_metered_usage')
    expect(meterEvents[0].get('payload[stripe_customer_id]')).toBe(
      'cus_free_org',
    )
    // A substantial charge, not a rounding artefact.
    expect(Number(meterEvents[0].get('payload[value]'))).toBeGreaterThan(10_000)
    // Identifier is org-month, so a re-run converges on Stripe's side too.
    expect(meterEvents[0].get('identifier')).toBe(`org-1-${MONTH}`)

    const rollup = mockDocs.get(`orgs/org-1/usage/${MONTH}`)!
    expect(rollup['billedCents']).toBe(
      Number(meterEvents[0].get('payload[value]')),
    )
    expect(rollup['reportedAt']).toBeDefined()
  })

  it('an org with NO plan is treated as free, not as unknown-and-billable', async () => {
    // `resolvePlan` defaults to free, so a missing or garbage plan field lands
    // on the free side. Billing someone with no subscription is the error
    // direction with no recovery.
    seedOrg('free')
    mockDocs.set('orgs/org-1', {})
    await runRollup(loadRoute())
    expect(meterEvents).toHaveLength(0)

    mockDocs.set('orgs/org-1', { plan: 'not-a-plan' })
    mockDocs.delete(`orgs/org-1/usage/${MONTH}`)
    await runRollup(loadRoute())
    expect(meterEvents).toHaveLength(0)
  })

  it('a LAPSED paid org is free again — the stale plan field does not bill', async () => {
    // The plan field still says `starter`; the subscription is canceled.
    // `resolvePlan` resolves that to free, and this is the one case where a
    // stale mirror would otherwise charge a customer who has stopped paying.
    seedOrg('starter')
    mockDocs.set('orgs/org-1', {
      plan: 'starter',
      subscription: { status: 'canceled' },
    })
    await runRollup(loadRoute())
    expect(meterEvents).toHaveLength(0)
    expect(mockDocs.get(`orgs/org-1/usage/${MONTH}`)!['billedCents']).toBe(0)
  })
})
