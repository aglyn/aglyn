/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * Form-submission overage is withheld while the Inbox PAGE is dark
 * (AGL-1688) — the Contacts remedy (AGL-1604), applied to the flag next door.
 *
 * `release_inbox` gates one surface: the console Inbox page and its nav tab.
 * `/api/forms/submit` keeps writing `hosts/{id}/formSubmissions` and
 * `GET /v1/sites/{id}/form-submissions` keeps serving them, so submissions
 * accrue past the plan's band and bill at cost x 1.3 for a lead list the
 * customer has no console way to read, mark read, or export.
 *
 * AGL-1688 recorded "no billing path" for Inbox and treated that as the one
 * way it was milder than Contacts. It is not: `hostUsage` reads
 * `counters/formSubmissions` into the snapshot `estimateMonthlyUsageCost`
 * prices. This suite exists mostly to keep that fact from being re-forgotten —
 * the ON case asserts a real dollar figure, so a future change that stops
 * pricing submissions fails here rather than passing quietly.
 *
 * The suppression is CONDITIONAL, never a removal. A hardcoded zero would
 * satisfy the OFF case forever and under-bill from the day Inbox ships, which
 * is the defect nobody goes looking for. So every case flips only the flag,
 * with the plan, the counters and the month held fixed.
 *
 * WHAT REACHES THE INVOICE, not what is counted. The recorded `formSubmissions`
 * total feeds `orgMonthlyCogsUsd`, and the same counter is what the AGL-1655
 * abuse ceiling and the plan quota are evaluated against — a suppression that
 * reshaped the count would move an anti-abuse verdict as a side effect of a
 * billing decision. It is asserted identical either way.
 *
 * NO STRIPE PATH IS EXERCISED. `fetch` is mocked and the captured request body
 * is the assertion surface — localhost carries the LIVE key.
 */

const MONTH = '2026-07'
const CRON_SECRET = 'test-cron-secret'

import { RELEASE_FLAGS, type ReleaseFlagValue } from '@aglyn/aglyn/server'

/**
 * EVERY flag, at its registry default, before the one under test is set.
 *
 * `getServerReleaseFlagValues` fills the whole map from `registryDefaults()`
 * even when Remote Config is unreachable, so a partial fixture is not a
 * smaller version of production — it is a shape production never produces.
 * `isReleaseFlagOn` reads `value.enabled` off whatever it is handed, so a
 * missing key throws inside the org loop, is swallowed by the per-org catch,
 * and turns the whole sweep into a 207 whose body never mentions flags. That
 * cost a debugging round here; seeding from the registry means the next flag
 * gate added to this cron does not cost another.
 */
const flagDefaults = (): Record<string, ReleaseFlagValue> =>
  Object.fromEntries(
    RELEASE_FLAGS.map((definition) => [
      definition.key,
      { enabled: definition.defaultEnabled },
    ]),
  )

/** `hosts/{id}/counters/formSubmissions.<month>` per counter path. */
let mockHostFormSubmissions: Record<string, number>
/** `hosts/{id}/counters/media.bytes` per counter path. */
let mockHostMediaBytes: Record<string, number>
/** Host id → org id. */
let mockHosts: Array<{ id: string; orgId: string }>
/** What each org's `usage/<month>` doc was written with. */
let mockUsageWrites: Record<string, Record<string, unknown>>
/** Plan per org id. */
let mockOrgPlans: Record<string, string>
/** The Remote Config verdicts the route reads. */
let mockFlagValues: Record<string, ReleaseFlagValue>
/** Per-org release-flag overrides on `orgs/{id}` (AGL-1635). */
let mockOrgOverrides: Record<string, Record<string, boolean>>
/** Stripe meter-event request bodies, captured at the `fetch` boundary. */
let mockMeterEvents: string[]

const snapshotOf = (id: string, data: Record<string, unknown> | null) => ({
  id,
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

function counterDocRef(scopePath: string, name: string) {
  const path = `${scopePath}/counters/${name}`
  return {
    id: name,
    path,
    get: async () => ({
      exists: false,
      get: (field: string) => {
        if (path.endsWith('/counters/media') && field === 'bytes') {
          return mockHostMediaBytes[path] ?? 0
        }
        // The rollup asks this document for the MONTH key, which is also how
        // /api/forms/submit writes it — a differently-keyed fixture here would
        // read zero submissions on exactly the sites under test.
        if (path.endsWith('/counters/formSubmissions') && field === MONTH) {
          return mockHostFormSubmissions[path] ?? 0
        }
        return undefined
      },
    }),
  }
}

/** An empty collection that still answers every shape the route asks for. */
function emptyCollection(): any {
  const api: any = {
    select: () => api,
    where: () => api,
    limit: () => api,
    orderBy: () => api,
    startAfter: () => api,
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    get: async () => ({ docs: [], size: 0, empty: true }),
    doc: (id: string) => ({
      id,
      path: `?/${id}`,
      get: async () => snapshotOf(id, null),
      collection: () => emptyCollection(),
    }),
  }
  return api
}

function fakeHostRef(hostId: string) {
  const path = `hosts/${hostId}`
  return {
    id: hostId,
    path,
    collection: (name: string) =>
      name === 'counters'
        ? { doc: (counter: string) => counterDocRef(path, counter) }
        : emptyCollection(),
  }
}

function fakeOrgRef(orgId: string) {
  const path = `orgs/${orgId}`
  return {
    id: orgId,
    path,
    get: async () =>
      snapshotOf(orgId, {
        plan: mockOrgPlans[orgId] ?? 'starter',
        ...(mockOrgOverrides[orgId] && {
          releaseFlags: mockOrgOverrides[orgId],
        }),
      }),
    collection: (name: string) => {
      if (name === 'counters') {
        return { doc: (counter: string) => counterDocRef(path, counter) }
      }
      if (name === 'usage') {
        return {
          doc: (id: string) => ({
            id,
            get: async () => snapshotOf(id, null),
            set: async (payload: Record<string, unknown>) => {
              mockUsageWrites[orgId] = payload
            },
          }),
        }
      }
      return emptyCollection()
    },
  }
}

const fakeFirestore = {
  collection: (name: string) => {
    if (name === 'hosts') {
      const api: any = {
        limit: () => api,
        get: async () => ({
          docs: mockHosts.map((host) => ({
            id: host.id,
            get: (field: string) =>
              field === 'orgId'
                ? host.orgId
                : field === 'screens'
                  ? {}
                  : undefined,
            ref: fakeHostRef(host.id),
          })),
          size: mockHosts.length,
        }),
      }
      return api
    }
    if (name === 'orgs') return { doc: (id: string) => fakeOrgRef(id) }
    return emptyCollection()
  },
  getAll: async (...refs: Array<{ path: string }>) =>
    refs.map((ref) => ({ id: ref.path, get: () => undefined })),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: {
      FieldPath: { documentId: () => '__name__' },
      FieldValue: { serverTimestamp: () => '__server_timestamp__' },
    },
  },
  // A mirrored customer, so the "no meter event" assertions below are about the
  // gate and not about a missing customer id.
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  emailSendsOverage: jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/email-metering',
  ).emailSendsOverage,
  getServerReleaseFlagValues: async () => mockFlagValues,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan bands, the REAL unit rate and the REAL flag verdict. A
  // stubbed rate would make the ON case unfalsifiable, and a stubbed
  // `isReleaseFlagOnForOrg` would let a gate that ignores the rollout
  // percentage or the per-org override pass.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/measure-node-map'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/release-flags'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      'x-cron-secret': request.headers.get('x-cron-secret') ?? undefined,
    },
  }),
}))

jest.mock('../utils/screen-cap-reconciliation', () => ({
  __esModule: true,
  measureScreenCaps: async () => ({ maxBillable: 0, overCapHostIds: [] }),
}))

import { POST } from '../app/api/billing/report-usage/route'

/**
 * Starter includes `hostLimit (1) x formSubmissionsPerMonth (200)` = 200.
 * 10,200 submissions leaves 10,000 billable at $0.00005 = $0.50 at cost, which
 * is 65c after the 1.3 markup. Chosen to land on a whole cent so the assertion
 * is exact rather than a rounding tolerance.
 */
const SUBMISSIONS = 10_200
const WITHHELD_USD = 0.5
const BILLED_CENTS = 65

function seed(options: {
  submissions?: number
  plan?: string
  hostMediaBytes?: number
  flag?: ReleaseFlagValue
  /** `orgs/org-1.releaseFlags`, the per-org override map (AGL-1635). */
  overrides?: Record<string, boolean>
}) {
  mockOrgOverrides = options.overrides ? { 'org-1': options.overrides } : {}
  mockHosts = [{ id: 'site-a', orgId: 'org-1' }]
  mockHostMediaBytes = {
    'hosts/site-a/counters/media': options.hostMediaBytes ?? 0,
  }
  mockHostFormSubmissions = {
    'hosts/site-a/counters/formSubmissions': options.submissions ?? SUBMISSIONS,
  }
  mockOrgPlans = { 'org-1': options.plan ?? 'starter' }
  mockUsageWrites = {}
  mockMeterEvents = []
  mockFlagValues = {
    ...flagDefaults(),
    release_inbox: options.flag ?? { enabled: false },
  }
}

async function rollUp(month = MONTH) {
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/report-usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({ month }),
    }),
  )
  expect(response.status).toBe(200)
  return mockUsageWrites
}

const ORIGINAL_FETCH = global.fetch

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  // A FAKE key. The route only calls Stripe when one is set, and the meter
  // event is the thing under test — but no request leaves the process.
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
  delete process.env.BILL_ORG_LIBRARY_STORAGE_FROM
  global.fetch = jest.fn(async (url: any, init: any) => {
    if (String(url).includes('api.stripe.com')) {
      mockMeterEvents.push(String(init?.body ?? ''))
      return { ok: true, json: async () => ({}) } as any
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as any
})

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  delete process.env.STRIPE_SECRET_KEY
})

describe('form overage is not invoiced while the Inbox page is dark', () => {
  it('withholds the overage, and sends Stripe nothing at all', async () => {
    seed({ flag: { enabled: false } })
    const write = (await rollUp())['org-1']
    expect(write.formSubmissionsBilled).toBe(false)
    expect(write.billableCostUsd).toBe(0)
    expect(write.billedCents).toBe(0)
    // `billedCents` is zero, so the meter event the cron would otherwise POST
    // is never attempted.
    expect(mockMeterEvents).toEqual([])
  })

  it('still COUNTS the submissions, and records what was forgone', async () => {
    // The count is a COGS input and the subject of the AGL-1655 abuse ceiling.
    // Suppressing the charge must not make the site look quiet.
    seed({ flag: { enabled: false } })
    const write = (await rollUp())['org-1']
    expect(write.formSubmissions).toBe(SUBMISSIONS)
    expect(write.formSubmissionsOverageWithheldUsd).toBeCloseTo(WITHHELD_USD, 6)
  })
})

describe('the suppression reverses itself when Inbox ships', () => {
  it('bills the overage, and reports it, once the flag is on', async () => {
    seed({ flag: { enabled: true } })
    const write = (await rollUp())['org-1']
    expect(write.formSubmissionsBilled).toBe(true)
    expect(write.formSubmissionsOverageWithheldUsd).toBe(0)
    expect(write.billableCostUsd).toBeCloseTo(WITHHELD_USD, 6)
    expect(write.billedCents).toBe(BILLED_CENTS)
    expect(mockMeterEvents).toHaveLength(1)
    expect(mockMeterEvents[0]).toContain(`payload%5Bvalue%5D=${BILLED_CENTS}`)
  })

  it('honours a partial rollout — an org that CAN reach the page is billed', async () => {
    seed({ flag: { enabled: false, rolloutPercent: 100 } })
    const write = (await rollUp())['org-1']
    expect(write.formSubmissionsBilled).toBe(true)
    expect(write.billedCents).toBe(BILLED_CENTS)
  })

  it('bills an org that staff granted Inbox early (AGL-1635 override)', async () => {
    // The override is what makes the page reachable for this one customer, so
    // it has to make the invoice reachable too.
    seed({ flag: { enabled: false }, overrides: { release_inbox: true } })
    const write = (await rollUp())['org-1']
    expect(write.formSubmissionsBilled).toBe(true)
    expect(write.billedCents).toBe(BILLED_CENTS)
  })

  it('honours a per-org kill switch even once the flag ships', async () => {
    // The override runs both ways: an org forced OFF cannot open the page, so
    // it must not be invoiced, flag or no flag.
    seed({ flag: { enabled: true }, overrides: { release_inbox: false } })
    const write = (await rollUp())['org-1']
    expect(write.formSubmissionsBilled).toBe(false)
    expect(write.formSubmissionsOverageWithheldUsd).toBeCloseTo(WITHHELD_USD, 6)
    expect(write.billedCents).toBe(0)
    expect(mockMeterEvents).toEqual([])
  })
})

describe('the suppression is scoped to form submissions', () => {
  it('still bills storage while the Inbox page is dark', async () => {
    const GB = 1024 * 1024 * 1024
    // 3 GB against Starter's 2 GB band, so there is a storage bill for the
    // gate to be indifferent about. A suppression that zeroed the whole
    // invoice rather than one meter would fail here.
    seed({ flag: { enabled: false }, hostMediaBytes: 3 * GB })
    const write = (await rollUp())['org-1']
    expect(write.formSubmissionsBilled).toBe(false)
    expect(Number(write.billedCents)).toBeGreaterThan(0)
    // The storage half only: 1 GB over at $0.026 x 1.3 = 3.38c → 3c.
    expect(write.billedCents).toBe(3)
  })

  it('changes only the form fields and the bill they feed', async () => {
    const GB = 1024 * 1024 * 1024
    seed({ flag: { enabled: false }, hostMediaBytes: 3 * GB })
    const off = { ...(await rollUp())['org-1'] }
    seed({ flag: { enabled: true }, hostMediaBytes: 3 * GB })
    const on = { ...(await rollUp())['org-1'] }

    // `costUsd` and the recorded `formSubmissions` are in NEITHER list, so
    // they are compared — the COGS figure and the count must be byte-identical
    // whichever way the flag sits.
    const formFields = [
      'formSubmissionsBilled',
      'formSubmissionsOverageWithheldUsd',
      'billableCostUsd',
      'billedCents',
    ]
    const withoutForms = (write: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(write).filter(([key]) => !formFields.includes(key)),
      )
    expect(withoutForms(on)).toEqual(withoutForms(off))
    expect(on.costUsd).toEqual(off.costUsd)
    expect(on.formSubmissions).toEqual(SUBMISSIONS)
  })
})
