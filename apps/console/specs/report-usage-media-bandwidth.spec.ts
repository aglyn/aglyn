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

import {
  PLAN_ENTITLEMENTS,
  pageViewsFromBandwidthGb,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  ORIGIN_MEDIA_BANDWIDTH_WEIGHT,
  PAGE_VIEW_PUBLISHED_PRICE_USD,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { MEDIA_BANDWIDTH_DAY_FIELD } from '@aglyn/aglyn/app-utils/media-bandwidth'
import { METERED_BILLED_RATES_USD } from '../utils/usage-metering'

/**
 * VIDEO AND FILES ON THE INVOICE, DRIVEN THROUGH THE ROUTE THAT CHARGES
 * (AGL-3474).
 *
 * The media CDN counts the bytes of every video and file it serves on the
 * scope's analytics day documents. This suite plants a month of them and
 * asserts what `report-usage` does with it: a paying org past its band is
 * billed for the excess at the page-view rate, each byte counted at the
 * origin-media weight;
 * the org library's delivery is billed beside the sites' (it is bandwidth,
 * not the library STORAGE that waits behind `BILL_ORG_LIBRARY_STORAGE_FROM`);
 * and Free, at the same traffic, posts nothing.
 *
 * The expected charge is built from the plan table and the published rate,
 * never from the estimate function the route itself calls.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore, modelling only the reads `report-usage` performs —
// the harness of `report-usage-free-tier-cap.spec.ts`.
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
    counters: {},
    actionRuns: 0,
    orgLibraryBytes: 0,
  }),
}))

jest.mock('../utils/screen-cap-reconciliation', () => ({
  __esModule: true,
  measureScreenCaps: async () => ({ maxBillable: 0, overCapHostIds: [] }),
}))

// ---------------------------------------------------------------------------

const GIB = 1024 * 1024 * 1024

/** Every Stripe Billing Meter event the route actually posted. */
const meterEvents: URLSearchParams[] = []
const fetchMock = jest.fn(async (url: unknown, init?: any) => {
  const href = String(url)
  if (href.includes('/billing/meter_events')) {
    meterEvents.push(new URLSearchParams(String(init?.body ?? '')))
    return { ok: true, json: async () => ({ object: 'billing.meter_event' }) }
  }
  // AGL-1878: the route now asks whether the customer has a subscription item
  // priced on the meter before it reports, because a 200 from `meter_events`
  // is not a charge. Answered YES here so the POSITIVE CONTROLS in this file
  // still assert a real meter event — a "no" would silence them and they would
  // pass for the wrong reason. What THIS suite is about is the plan, not the
  // subscription item, and that separation is why the answer is a constant.
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
/** Page views inside every band, so the media alone crosses it. */
const PAGE_VIEWS = 1_000
/** The org library's films served past the band, in GiB as served. */
const LIBRARY_GIB = 10
const WEIGHT = ORIGIN_MEDIA_BANDWIDTH_WEIGHT

/**
 * One org, one site. The site's pages and films fill the band exactly; the
 * org library's films go `LIBRARY_GIB` past it.
 */
/** The site's film bytes that, with its page views, fill the band exactly. */
function siteFilmBytes(plan: 'free' | 'starter'): number {
  const band = PLAN_ENTITLEMENTS[plan].bandwidthGb
  const pageViewGib = (PAGE_VIEWS * band) / pageViewsFromBandwidthGb(band)
  return ((band - pageViewGib) * GIB) / WEIGHT
}

function seedOrg(plan: 'free' | 'starter', options: { library?: boolean } = {}) {
  mockDocs.clear()
  mockDocs.set('hosts/host-1', { orgId: 'org-1', screens: {} })
  mockDocs.set('orgs/org-1', {
    plan,
    ...(plan === 'free' ? {} : { subscription: { status: 'active' } }),
  })
  const bandBytes = PLAN_ENTITLEMENTS[plan].bandwidthGb * GIB
  mockDocs.set(`hosts/host-1/analytics/${MONTH}-15`, {
    total: PAGE_VIEWS,
    // Exactly the band less what the page views weigh, at the weight a film
    // counts.
    [MEDIA_BANDWIDTH_DAY_FIELD]: siteFilmBytes(plan),
    media: { film: { serves: 9, bytes: bandBytes } },
  })
  if (options.library !== false) {
    mockDocs.set(`orgs/org-1/analytics/${MONTH}-16`, {
      [MEDIA_BANDWIDTH_DAY_FIELD]: LIBRARY_GIB * GIB,
    })
  }
}

function loadRoute() {
  jest.resetModules()
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
    // AGL-1878: what the subscription-item check matches a customer's items
    // against. Production sets it; a suite that left it unset would take the
    // `meter-not-configured` branch and stop metering for a reason that has
    // nothing to do with the plan this file is about.
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

const rollup = () => mockDocs.get(`orgs/org-1/usage/${MONTH}`)!

describe('report-usage bills video and files past the band (AGL-3474)', () => {
  it('derives the weight from the price the invoice actually bills', () => {
    // The weight is derived in `plan-entitlements` from its own copy of the
    // page-view price; this is the console's. One figure, or the weight was
    // sized against a price nobody pays.
    expect(PAGE_VIEW_PUBLISHED_PRICE_USD).toBe(METERED_BILLED_RATES_USD.perPageView)
  })

  it('a paying org is billed for the excess at the page-view rate', async () => {
    seedOrg('starter')
    const response = await runRollup(loadRoute())
    expect(response.status).toBe(200)

    // The excess is the org library's films, at their weight, in the band's
    // own units.
    const billableViews = pageViewsFromBandwidthGb(LIBRARY_GIB * WEIGHT)
    const expectedCents = Math.round(
      billableViews * METERED_BILLED_RATES_USD.perPageView * 100,
    )
    expect(expectedCents).toBeGreaterThan(0)
    expect(meterEvents).toHaveLength(1)
    expect(Number(meterEvents[0].get('payload[value]'))).toBe(expectedCents)
    expect(rollup()['billedCents']).toBe(expectedCents)
  })

  it('records how much of the band was media, beside the page views it is in', async () => {
    seedOrg('starter')
    await runRollup(loadRoute())
    const band = PLAN_ENTITLEMENTS.starter.bandwidthGb
    expect(rollup()['pageViews']).toBeCloseTo(
      pageViewsFromBandwidthGb(band + LIBRARY_GIB * WEIGHT),
      3,
    )
    // The media share, as served — unweighted, so the audit doc says how much
    // video left rather than how much band it took.
    expect(rollup()['mediaBandwidthGb']).toBeCloseTo(
      siteFilmBytes('starter') / GIB + LIBRARY_GIB,
      6,
    )
  })

  it('NEGATIVE: inside the band, the same org is billed nothing', async () => {
    seedOrg('starter', { library: false })
    await runRollup(loadRoute())
    expect(meterEvents).toHaveLength(0)
    expect(rollup()['billedCents']).toBe(0)
  })

  it('NEGATIVE: Free at the same traffic posts nothing — its band is a stop, not a bill', async () => {
    seedOrg('free')
    const response = await runRollup(loadRoute())
    expect(response.status).toBe(200)
    expect(meterEvents).toHaveLength(0)
    expect(rollup()['billedCents']).toBe(0)
    // Measured all the same: the zero is the plan's, not a missing input.
    expect(rollup()['pageViews']).toBeGreaterThan(
      pageViewsFromBandwidthGb(PLAN_ENTITLEMENTS.free.bandwidthGb),
    )
  })
})
