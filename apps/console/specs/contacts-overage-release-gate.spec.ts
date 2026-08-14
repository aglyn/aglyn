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
 * Audience-band overage is withheld while the Contacts PAGE is dark
 * (AGL-1604).
 *
 * `release_contacts` gates one surface — the console Contacts page and its nav
 * tab. Ingestion (`upsertHostContact`, called from forms, memberships, orders,
 * newsletters, POS and bookings) and `GET /v1/contacts` both keep running, so
 * records accrue and the band is crossed while the org has no console way to
 * see, tag or export the records it would be invoiced for. This suite is the
 * proof that it is not invoiced for them.
 *
 * TWO claims, and the second is the one that decays silently:
 *
 * 1. Flag OFF → the overage never reaches `billedCents`, and no Stripe meter
 *    event is sent. Flag ON → it does, at the real rate.
 * 2. The suppression is CONDITIONAL, not a removal. A hardcoded zero would
 *    pass claim 1 forever and under-bill from the day Contacts ships, which is
 *    a defect nobody would go looking for. So the flag is flipped with
 *    everything else held fixed, and the ON case is asserted at a real dollar
 *    figure.
 *
 * WHEN, not HOW. `checkContactQuota` is also an entitlement input, and the
 * recorded `contactsCount` feeds the COGS rollup — a defaulted or reshaped
 * count there renders a paying org as Free. Both are therefore asserted to be
 * identical either way; only the billed figure moves.
 *
 * NO STRIPE PATH IS EXERCISED. `fetch` is mocked and the captured request body
 * is the assertion surface — localhost carries the LIVE key.
 */

const MONTH = '2026-07'
const CRON_SECRET = 'test-cron-secret'

import { RELEASE_FLAGS, type ReleaseFlagValue } from '@aglyn/aglyn/server'

/**
 * EVERY flag, at its registry default, before `release_contacts` is set
 * (AGL-1688).
 *
 * This fixture used to name `release_contacts` alone, which worked only while
 * the cron consulted exactly one flag. AGL-1688 added a second gate to the
 * same loop, and a map missing that key threw inside `isReleaseFlagOn` —
 * swallowed by the per-org catch and surfacing as a 207 that says nothing
 * about flags. `getServerReleaseFlagValues` fills the whole map from
 * `registryDefaults()` even with Remote Config unreachable, so a partial
 * fixture was never a smaller production; it was a shape production cannot
 * produce.
 */
const flagDefaults = (): Record<string, ReleaseFlagValue> =>
  Object.fromEntries(
    RELEASE_FLAGS.map((definition) => [
      definition.key,
      { enabled: definition.defaultEnabled },
    ]),
  )

/** Contact head-count per org id, as the aggregate `count()` answers it. */
let mockContactCounts: Record<string, number>
/** `hosts/{id}/counters/media.bytes` per host id. */
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
      get: (field: string) =>
        path.endsWith('/counters/media') && field === 'bytes'
          ? (mockHostMediaBytes[path] ?? 0)
          : undefined,
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
      // The aggregate the rollup meters against (AGL-890). Records exist
      // whatever the flag says — that is the whole premise of AGL-1604.
      if (name === 'contacts') {
        return {
          count: () => ({
            get: async () => ({
              data: () => ({ count: mockContactCounts[orgId] ?? 0 }),
            }),
          }),
        }
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
              field === 'orgId' ? host.orgId : field === 'screens' ? {} : undefined,
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
  // The REAL plan rules and the REAL flag verdict. A stubbed rate would make
  // the ON case unfalsifiable, and a stubbed `isReleaseFlagOn` would let a
  // gate that ignores the rollout percentage pass.
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

/** Starter: 1,000 contacts included, $1.00 per 1,000 over. 3,500 → $2.50. */
const CONTACTS = 3_500
const OVERAGE_USD = 2.5
const OVERAGE_CENTS = 250

function seed(options: {
  contacts?: number
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
  mockContactCounts = { 'org-1': options.contacts ?? CONTACTS }
  mockOrgPlans = { 'org-1': options.plan ?? 'starter' }
  mockUsageWrites = {}
  mockMeterEvents = []
  mockFlagValues = {
    ...flagDefaults(),
    release_contacts: options.flag ?? { enabled: false },
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

describe('the audience band is not invoiced while the Contacts page is dark', () => {
  it('withholds the overage, and sends Stripe nothing at all', async () => {
    seed({ flag: { enabled: false } })
    const write = (await rollUp())['org-1']
    expect(write.contactsOverageUsd).toBe(0)
    expect(write.contactsOverageBilled).toBe(false)
    expect(write.billedCents).toBe(0)
    // Nothing was reported: `billedCents` is zero, so the meter event the cron
    // would otherwise POST is never attempted.
    expect(mockMeterEvents).toEqual([])
  })

  it('still COUNTS the contacts, and records what was forgone', async () => {
    // The count is an entitlement input and a COGS input. Suppressing the
    // charge must not make the org look like it holds no contacts — that is
    // the failure shape where a gated field silently re-plans a paying org.
    seed({ flag: { enabled: false } })
    const write = (await rollUp())['org-1']
    expect(write.contactsCount).toBe(CONTACTS)
    expect(write.contactsOverageWithheldUsd).toBeCloseTo(OVERAGE_USD, 6)
  })
})

describe('the suppression reverses itself when Contacts ships', () => {
  it('bills the overage, and reports it, once the flag is on', async () => {
    seed({ flag: { enabled: true } })
    const write = (await rollUp())['org-1']
    expect(write.contactsOverageUsd).toBeCloseTo(OVERAGE_USD, 6)
    expect(write.contactsOverageBilled).toBe(true)
    expect(write.contactsOverageWithheldUsd).toBe(0)
    expect(write.billedCents).toBe(OVERAGE_CENTS)
    expect(mockMeterEvents).toHaveLength(1)
    expect(mockMeterEvents[0]).toContain(
      `payload%5Bvalue%5D=${OVERAGE_CENTS}`,
    )
  })

  it('honours a partial rollout — an org that CAN reach the page is billed', async () => {
    // Not an on/off boolean but the real verdict, so an org inside a staged
    // rollout is charged like any other org that can open the page.
    seed({ flag: { enabled: false, rolloutPercent: 100 } })
    const write = (await rollUp())['org-1']
    expect(write.contactsOverageBilled).toBe(true)
    expect(write.billedCents).toBe(OVERAGE_CENTS)
  })

  it('bills an org that staff granted Contacts early (AGL-1635 override)', async () => {
    // The override is what makes the page reachable for this one customer, so
    // it has to make the invoice reachable too. A gate reading only the Remote
    // Config value would under-bill exactly the orgs that CAN open Contacts.
    seed({
      flag: { enabled: false },
      overrides: { release_contacts: true },
    })
    const write = (await rollUp())['org-1']
    expect(write.contactsOverageBilled).toBe(true)
    expect(write.billedCents).toBe(OVERAGE_CENTS)
  })

  it('honours a per-org kill switch even once the flag ships', async () => {
    // The override runs both ways. An org forced OFF cannot open the page, so
    // it must not be invoiced, flag or no flag.
    seed({
      flag: { enabled: true },
      overrides: { release_contacts: false },
    })
    const write = (await rollUp())['org-1']
    expect(write.contactsOverageBilled).toBe(false)
    expect(write.contactsOverageWithheldUsd).toBeCloseTo(OVERAGE_USD, 6)
    expect(write.billedCents).toBe(0)
    expect(mockMeterEvents).toEqual([])
  })
})

describe('nothing else about the usage cron moves', () => {
  it('changes only the contacts fields and the bill they feed', async () => {
    const GB = 1024 * 1024 * 1024
    // 3 GB against Starter's 2 GB band, so the rollup has a non-zero storage
    // bill of its own to be indifferent about.
    seed({ flag: { enabled: false }, hostMediaBytes: 3 * GB })
    const off = { ...(await rollUp())['org-1'] }
    seed({ flag: { enabled: true }, hostMediaBytes: 3 * GB })
    const on = { ...(await rollUp())['org-1'] }

    const contactsFields = [
      'contactsOverageUsd',
      'contactsOverageBilled',
      'contactsOverageWithheldUsd',
      'billedCents',
    ]
    const withoutContacts = (write: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(write).filter(([key]) => !contactsFields.includes(key)),
      )
    expect(withoutContacts(on)).toEqual(withoutContacts(off))
    // …and the storage half of the bill is billed either way, so the
    // suppression is scoped to the audience band rather than to the invoice.
    // 1 GB past the band × $0.026 × 1.30 = 3.38¢.
    expect(off.billedCents).toBe(3)
    expect(on.billedCents).toBe(3 + OVERAGE_CENTS)
  })

  it('leaves free — which hard-bands and has no rate — untouched', async () => {
    // Free has no `extraContactsUsdPer1k`, so there was never an overage to
    // withhold. The gate must not invent one, in either direction.
    seed({ flag: { enabled: false }, plan: 'free', contacts: 5_000 })
    const off = (await rollUp())['org-1']
    expect(off.contactsCount).toBe(5_000)
    expect(off.contactsOverageUsd).toBe(0)
    expect(off.contactsOverageWithheldUsd).toBe(0)
    seed({ flag: { enabled: true }, plan: 'free', contacts: 5_000 })
    const on = (await rollUp())['org-1']
    expect(on.contactsOverageUsd).toBe(0)
    expect(on.billedCents).toBe(off.billedCents)
  })
})
