/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and jsdom has no global `Request` for the route to be
 * called with.
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
 * EMAIL OVERAGE REACHES THE INVOICE — AND NOT BEFORE THE MONTH IT IS TOLD TO.
 *
 * Email sending has been counted for a long time and charged for none of it.
 * Two things make switching that on retroactive by default:
 *
 *  - the daily cron RE-SWEEPS any org-month that has no `reportedAt`, so a
 *    boolean flipped today prices a month whose mail has already been sent;
 *  - the included bands came DOWN in the same change as the rate, so that
 *    month's volume would be measured against an allowance smaller than the
 *    one it was sent under.
 *
 * And most of the excess is TRANSACTIONAL — receipts, invites, password
 * resets, booking reminders — which no cap was ever allowed to refuse. So the
 * customer could not have avoided it, did not know it would cost anything,
 * and would meet it first as a line on a closed month's invoice.
 *
 * `BILL_EMAIL_SEND_OVERAGE_FROM` is a START MONTH rather than a boolean, and
 * that is the whole design: a start month cannot reach backwards no matter
 * when it is set, which makes the no-backdating guarantee a property of the
 * mechanism instead of of anyone's care. Same instrument, same reasoning, as
 * `BILL_ORG_LIBRARY_STORAGE_FROM`.
 *
 * ## Why every other meter is zeroed in the fixture
 *
 * `billedCents` sums five terms. With storage, page views, forms, datasets,
 * API and contacts all at zero, `billedCents` IS the email charge — so a
 * regression that dropped the email term reads as 0 rather than hiding inside
 * a larger number that still moves for other reasons.
 */

import {
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

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
  // REAL: the subtraction under the charge. A stub returning 0 would make
  // every assertion in this file pass with the meter disconnected.
  emailSendsOverage: jest.requireActual(
    '@aglyn/aglyn/app-utils/plan-entitlements',
  ).emailSendsOverage,
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

// The org-wide counter sums, which is where the month's email volume enters
// the route. `mockEmailSends` is the one dial this file turns.
let mockEmailSends = 0
jest.mock('../utils/org-counter-totals', () => ({
  __esModule: true,
  orgCounterTotals: async () => ({
    emailSends: mockEmailSends,
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

/**
 * One org, one host, and NOTHING metered except email.
 *
 * Every other meter is left at zero on purpose. `billedCents` is a sum of
 * five terms, and a fixture that also blew the storage band would let this
 * file pass while the email term was dropped entirely — the figure would
 * still be non-zero and still move when the plan changed. With the rest at
 * zero, `billedCents` IS the email charge, to the cent.
 */
function seedOrg(plan: string) {
  mockDocs.clear()
  mockDocs.set('hosts/host-1', { orgId: 'org-1', screens: {} })
  mockDocs.set('orgs/org-1', {
    plan,
    ...(plan === 'free' ? {} : { subscription: { status: 'active' } }),
  })
  mockDocs.set('hosts/host-1/counters/media', { bytes: 0 })
  mockDocs.set('hosts/host-1/counters/formSubmissions', { [MONTH]: 0 })
}

function loadRoute(billFrom?: string) {
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
    // The switch under test. Absent means the overage is measured, shown and
    // priced into COGS, and reaches no invoice.
    ...(billFrom === undefined ? {} : { BILL_EMAIL_SEND_OVERAGE_FROM: billFrom }),
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
  mockEmailSends = 0
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})


/**
 * Business's band and rate, READ rather than transcribed.
 *
 * This is also what makes the file a MODULE rather than a script: without a
 * top-level import TypeScript places every `const` here in the global scope,
 * where it collides with the identically-shaped harness in
 * `report-usage-free-tier-cap.spec.ts`. Jest does not care; `tsc` does, and
 * the error names a redeclaration rather than the missing import.
 */
const BAND = PLAN_ENTITLEMENTS.business.emailSendsPerMonth
const RATE_PER_1K = PLAN_PRICING.business.extraEmailSendsUsdPer1k as number
const AGENCY_BAND = PLAN_ENTITLEMENTS.agency.emailSendsPerMonth

describe('the premise: the fixture meters email and nothing else', () => {
  it('a month inside the band bills exactly nothing', async () => {
    seedOrg('business')
    mockEmailSends = BAND
    await runRollup(loadRoute(MONTH))
    const rollup = mockDocs.get(`orgs/org-1/usage/${MONTH}`)!
    expect(rollup['emailSends']).toBe(BAND)
    expect(rollup['emailSendsOverage']).toBe(0)
    expect(rollup['billedCents']).toBe(0)
    // …and no other meter is quietly contributing.
    expect(rollup['storageGb']).toBe(0)
    expect(rollup['pageViews']).toBe(0)
    expect(rollup['formSubmissions']).toBe(0)
  })

  it('the band it is measured against is the plan\'s, not a default', async () => {
    // Free resolves for an unknown org and its band is 0, which would make
    // every send an overage — the shape that would let this file pass with
    // the plan lookup broken. Business is asserted by its effect: 30,000
    // sends leave 5,000 over, not 30,000.
    seedOrg('business')
    mockEmailSends = 30_000
    await runRollup(loadRoute(MONTH))
    expect(mockDocs.get(`orgs/org-1/usage/${MONTH}`)!['emailSendsOverage']).toBe(
      5_000,
    )
  })
})

describe('with the switch set to this month, the overage bills', () => {
  it('adds exactly the priced excess to billedCents', async () => {
    seedOrg('business')
    mockEmailSends = BAND + 4_000
    await runRollup(loadRoute(MONTH))
    const rollup = mockDocs.get(`orgs/org-1/usage/${MONTH}`)!
    expect(rollup['emailSendsOverage']).toBe(4_000)
    // 4,000 at $2.00/1,000 = $8.00.
    expect(rollup['emailSendsOverageUsd']).toBe(8)
    expect(rollup['billedCents']).toBe(800)
    expect(rollup['emailSendsOverageBilled']).toBe(true)
    expect(rollup['emailSendsOverageWithheldUsd']).toBe(0)
  })

  it('reaches Stripe as a real meter event', async () => {
    seedOrg('business')
    mockEmailSends = BAND + 4_000
    await runRollup(loadRoute(MONTH))
    expect(meterEvents).toHaveLength(1)
    expect(Number(meterEvents[0].get('payload[value]'))).toBe(800)
  })

  it('charges a cheaper tier less for the same excess', async () => {
    // The rate is the PLAN'S. A single hardcoded rate would satisfy every
    // assertion above.
    seedOrg('agency')
    // Agency's band, plus the same 4,000.
    mockEmailSends = AGENCY_BAND + 4_000
    await runRollup(loadRoute(MONTH))
    const rollup = mockDocs.get(`orgs/org-1/usage/${MONTH}`)!
    expect(rollup['emailSendsOverage']).toBe(4_000)
    // 4,000 at $1.80/1,000 = $7.20.
    expect(rollup['billedCents']).toBe(720)
  })

  it('never bills a FREE org, whatever it sent', async () => {
    // Free has no rate, so the charge is structurally zero rather than
    // checked — and no meter event leaves the process at all.
    seedOrg('free')
    mockEmailSends = 500_000
    await runRollup(loadRoute(MONTH))
    const rollup = mockDocs.get(`orgs/org-1/usage/${MONTH}`)!
    // The volume is recorded in full — the cost is real and the COGS model
    // prices it — while the OVERAGE reads 0. A band of zero is how "no
    // included allowance" is written, and `emailSendsOverage` yields 0 there
    // rather than the whole month's volume, so no arithmetic anywhere can
    // turn a plan that sells no campaigns into the platform's largest bill.
    expect(rollup['emailSends']).toBe(500_000)
    expect(rollup['emailSendsOverage']).toBe(0)
    expect(rollup['emailSendsOverageUsd']).toBe(0)
    // …and the rate is null too, so the charge is zero twice over.
    expect(rollup['emailSendsOverageWithheldUsd']).toBe(0)
    expect(rollup['billedCents']).toBe(0)
    expect(meterEvents).toHaveLength(0)
  })
})

describe('with the switch unset or in the future, it does not', () => {
  it('measures and records the overage, and charges nothing', async () => {
    seedOrg('business')
    mockEmailSends = BAND + 4_000
    await runRollup(loadRoute(undefined))
    const rollup = mockDocs.get(`orgs/org-1/usage/${MONTH}`)!
    // MEASURED — the count and the price are both on the document, so the
    // first billed month is a comparison rather than a surprise.
    expect(rollup['emailSendsOverage']).toBe(4_000)
    expect(rollup['emailSendsOverageWithheldUsd']).toBe(8)
    expect(rollup['emailSendsOverageBilled']).toBe(false)
    // …and NOT CHARGED.
    expect(rollup['emailSendsOverageUsd']).toBe(0)
    expect(rollup['billedCents']).toBe(0)
    expect(meterEvents).toHaveLength(0)
  })

  it('does not reach backwards into an earlier month', async () => {
    // The property a boolean cannot have. The sweep is running MONTH; the
    // switch names the month after it.
    seedOrg('business')
    mockEmailSends = BAND + 4_000
    await runRollup(loadRoute('2026-08'))
    const rollup = mockDocs.get(`orgs/org-1/usage/${MONTH}`)!
    expect(MONTH).toBe('2026-07')
    expect(rollup['emailSendsOverageBilled']).toBe(false)
    expect(rollup['billedCents']).toBe(0)
  })

  it('FAILS CLOSED on anything that is not a YYYY-MM', () => {
    // Nobody is charged because somebody wrote `yes` in a field that wanted a
    // month. Driven through the route for each value.
    return ['true', '1', 'yes', '2026', '2026-7', 'now'].reduce(
      (chain, bad) =>
        chain.then(async () => {
          seedOrg('business')
          mockEmailSends = BAND + 4_000
          await runRollup(loadRoute(bad))
          const rollup = mockDocs.get(`orgs/org-1/usage/${MONTH}`)!
          expect(`${bad}: ${rollup['emailSendsOverageBilled']}`).toBe(
            `${bad}: false`,
          )
          expect(`${bad}: ${rollup['billedCents']}`).toBe(`${bad}: 0`)
        }),
      Promise.resolve(),
    )
  })

  it('BOTH WAYS: the same month with the switch ON does bill', async () => {
    // The control for every case above. Without it a route that had stopped
    // billing email altogether would satisfy all of them.
    seedOrg('business')
    mockEmailSends = BAND + 4_000
    await runRollup(loadRoute(MONTH))
    expect(mockDocs.get(`orgs/org-1/usage/${MONTH}`)!['billedCents']).toBe(
      Math.round((4_000 / 1000) * RATE_PER_1K * 100),
    )
  })
})
