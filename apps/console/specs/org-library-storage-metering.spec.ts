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
 * Org-library bytes reach the rollup (AGL-1473).
 *
 * `resolveMediaScope` serves two scopes and the counter follows the scope: a
 * site upload moves `hosts/{id}/counters/media`, an org DAM upload moves
 * `orgs/{id}/counters/media`. Both are enforced against the storage cap. Only
 * the first was ever summed by `report-usage`, `usage-alerts` and the COGS
 * rollup — so org-library bytes were gated at upload and then dropped before
 * anything priced them.
 *
 * ASSERTED AT THE ROLLUP, not by reading the sum back. AGL-1317 and AGL-1408
 * were both closed on evidence from a layer that was not the one carrying the
 * bytes, and AGL-1465's own note is that the metering claim is the one that
 * decays silently. So the suite drives `report-usage` and reads what it WROTE.
 *
 * The second claim is the one that costs money if it breaks: a host-scope
 * upload must be completely unchanged. A regression here bills someone twice
 * for the same file.
 *
 * THE BILLING SWITCH is separate from the metering, deliberately. Charging for
 * bytes that have sat in org libraries for months is Zach's call, so
 * `BILL_ORG_LIBRARY_STORAGE_FROM` names the first month whose invoice includes
 * them, and is unset by default. Everything else — the measurement, the COGS
 * figure, the audit fields — is live immediately, because none of it appears
 * on an invoice.
 */

const MONTH = '2026-07'
const CRON_SECRET = 'test-cron-secret'
const GB = 1024 * 1024 * 1024

interface SeededHost {
  id: string
  orgId: string
  /** `counters/media.bytes` for this host. */
  mediaBytes: number
}

let mockHosts: SeededHost[]
/** `counters/*` documents by full path, for BOTH `get()` and `getAll()`. */
let mockCounters: Record<string, Record<string, unknown>>
/** What each org's `usage/<month>` doc was written with. */
let mockUsageWrites: Record<string, Record<string, unknown>>
/** Plan per org id. */
let mockOrgPlans: Record<string, string>

const snapshotOf = (id: string, data: Record<string, unknown> | null) => ({
  id,
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

/**
 * A `counters/{name}` document reference. It carries `path` so the same object
 * answers a direct `.get()` (what `hostUsage` and the quota gate do) AND a
 * `getAll` (what `orgCounterTotals` does) — which is the point: the doc the
 * upload moves must be the doc the rollup reads.
 */
function counterDocRef(scopePath: string, name: string) {
  const path = `${scopePath}/counters/${name}`
  return {
    id: name,
    path,
    get: async () => ({
      exists: Boolean(mockCounters[path]),
      get: (field: string) => mockCounters[path]?.[field],
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

function fakeHostRef(host: SeededHost) {
  const path = `hosts/${host.id}`
  return {
    id: host.id,
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
      snapshotOf(orgId, { plan: mockOrgPlans[orgId] ?? 'starter' }),
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
            ref: fakeHostRef(host),
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
    refs.map((ref) => ({
      id: ref.path,
      get: (field: string) => mockCounters[ref.path]?.[field],
    })),
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
  // No Stripe customer and no key (see `beforeEach`) — this suite must never
  // reach the Stripe API, and localhost carries the LIVE key.
  readOrgBilling: async () => ({}),
  emailSendsOverage: jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/email-metering',
  ).emailSendsOverage,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan rules — a stubbed entitlement would make the "included band"
  // arithmetic below unfalsifiable.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/measure-node-map'),
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
 * Starter includes 1 site × 2048 MB = exactly 2 GB org-wide, and meters the
 * excess. Every figure below is expressed against that band so the assertions
 * are arithmetic rather than golden numbers.
 */
const INCLUDED_GB = 2

function seed(options: {
  hosts: Array<{ id: string; orgId: string; mediaBytes: number }>
  /** `orgs/{id}/counters/media.bytes` per org. */
  orgLibraryBytes?: Record<string, number>
  plans?: Record<string, string>
}) {
  mockCounters = {}
  mockUsageWrites = {}
  mockOrgPlans = options.plans ?? {}
  mockHosts = options.hosts.map((host) => {
    mockCounters[`hosts/${host.id}/counters/media`] = { bytes: host.mediaBytes }
    return host
  })
  for (const [orgId, bytes] of Object.entries(options.orgLibraryBytes ?? {})) {
    mockCounters[`orgs/${orgId}/counters/media`] = { bytes }
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

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.BILL_ORG_LIBRARY_STORAGE_FROM
})

describe('org-library bytes reach the rollup (AGL-1473)', () => {
  it('adds the org library’s bytes to the rollup’s storageGb', async () => {
    seed({
      hosts: [{ id: 'site-a', orgId: 'org-1', mediaBytes: 1 * GB }],
      orgLibraryBytes: { 'org-1': 1 * GB },
    })
    const writes = await rollUp()
    // 1 GB on the site + 1 GB in the org library. Summing hosts alone gives 1.
    expect(writes['org-1'].storageGb).toBeCloseTo(2, 6)
  })

  it('records the org library figure on its own, so the split is auditable', async () => {
    seed({
      hosts: [{ id: 'site-a', orgId: 'org-1', mediaBytes: 1 * GB }],
      orgLibraryBytes: { 'org-1': 0.5 * GB },
    })
    const writes = await rollUp()
    expect(writes['org-1'].orgLibraryStorageGb).toBeCloseTo(0.5, 6)
  })

  it('counts the org library ONCE, however many sites the org runs', async () => {
    // The org counter has no host to fan out over, and a naive per-host read
    // would multiply it. An org with three sites would then be billed three
    // times for one photo.
    seed({
      hosts: [
        { id: 'site-a', orgId: 'org-1', mediaBytes: 0 },
        { id: 'site-b', orgId: 'org-1', mediaBytes: 0 },
        { id: 'site-c', orgId: 'org-1', mediaBytes: 0 },
      ],
      orgLibraryBytes: { 'org-1': 1 * GB },
    })
    const writes = await rollUp()
    expect(writes['org-1'].storageGb).toBeCloseTo(1, 6)
  })

  it('measures an org whose bytes are ALL in the org library', async () => {
    // The population a host-only sum could not have seen even in principle:
    // every site counter at zero and a full library. This org read as using no
    // storage whatsoever, on every surface that prices bytes.
    seed({
      hosts: [{ id: 'site-a', orgId: 'org-1', mediaBytes: 0 }],
      orgLibraryBytes: { 'org-1': 3 * GB },
    })
    const writes = await rollUp()
    expect(writes['org-1'].storageGb).toBeCloseTo(3, 6)
  })
})

describe('a host-scope upload is unchanged (the double-billing regression)', () => {
  it('reports identical figures for an org with no org library', async () => {
    seed({ hosts: [{ id: 'site-a', orgId: 'org-1', mediaBytes: 3 * GB }] })
    const writes = await rollUp()
    expect(writes['org-1'].storageGb).toBeCloseTo(3, 6)
    expect(writes['org-1'].orgLibraryStorageGb).toBe(0)
    // 3 GB against a 2 GB band = 1 GB billable × $0.026 × 1.30 = 3.38¢.
    expect(writes['org-1'].billedCents).toBe(3)
  })

  it('bills the same host bytes identically with the switch on', async () => {
    // The switch must move ONLY org-library bytes. If turning it on changed a
    // host-only org's bill by a cent, it would be re-pricing something that
    // has been invoiced correctly all along.
    seed({ hosts: [{ id: 'site-a', orgId: 'org-1', mediaBytes: 3 * GB }] })
    const off = { ...(await rollUp())['org-1'] }
    process.env.BILL_ORG_LIBRARY_STORAGE_FROM = MONTH
    seed({ hosts: [{ id: 'site-a', orgId: 'org-1', mediaBytes: 3 * GB }] })
    const on = (await rollUp())['org-1']
    expect(on.billedCents).toBe(off.billedCents)
    expect(on.storageGb).toBe(off.storageGb)
    expect(on.billableCostUsd).toBe(off.billableCostUsd)
  })

  it('does not move a host-only org’s bill by adding the org counter at zero', async () => {
    seed({
      hosts: [{ id: 'site-a', orgId: 'org-1', mediaBytes: 3 * GB }],
      orgLibraryBytes: { 'org-1': 0 },
    })
    const writes = await rollUp()
    expect(writes['org-1'].billedCents).toBe(3)
    expect(writes['org-1'].storageGb).toBeCloseTo(3, 6)
  })
})

describe('the billing consequence is a switch, not a side effect', () => {
  /** Org-library bytes big enough to cross the band on their own. */
  const overBand = {
    hosts: [{ id: 'site-a', orgId: 'org-1', mediaBytes: INCLUDED_GB * GB }],
    orgLibraryBytes: { 'org-1': 1 * GB },
  }

  it('meters but does NOT bill org-library bytes by default', async () => {
    seed(overBand)
    const writes = await rollUp()
    // Measured — the whole point of the fix…
    expect(writes['org-1'].storageGb).toBeCloseTo(3, 6)
    expect(writes['org-1'].orgLibraryStorageGb).toBeCloseTo(1, 6)
    // …and not priced, because nobody has decided to charge for it yet.
    expect(writes['org-1'].billedCents).toBe(0)
    expect(writes['org-1'].orgLibraryBilled).toBe(false)
  })

  it('bills them once the start month is reached', async () => {
    process.env.BILL_ORG_LIBRARY_STORAGE_FROM = MONTH
    seed(overBand)
    const writes = await rollUp()
    // 1 GB past the band × $0.026 × 1.30 = 3.38¢.
    expect(writes['org-1'].billedCents).toBe(3)
    expect(writes['org-1'].orgLibraryBilled).toBe(true)
  })

  it('NEVER backdates: a month before the start month bills nothing extra', async () => {
    // The guarantee. Whatever month the switch is thrown in, every month that
    // closed before it re-rolls to the bill it already produced.
    process.env.BILL_ORG_LIBRARY_STORAGE_FROM = '2026-09'
    seed(overBand)
    const writes = await rollUp('2026-07')
    expect(writes['org-1'].billedCents).toBe(0)
    expect(writes['org-1'].orgLibraryBilled).toBe(false)
    // Still measured, though — history has to accumulate before a rate can be
    // argued from it (AGL-1438's posture, kept).
    expect(writes['org-1'].orgLibraryStorageGb).toBeCloseTo(1, 6)
  })

  it('leaves the COGS figure truthful whichever way the switch is set', async () => {
    // `costUsd` and `storageGb` are what the cost model reads. Org bytes cost
    // us real money whether or not we pass the cost on, so under-reporting
    // them makes the discount guardrail MORE generous — the one direction
    // that loses money silently.
    seed(overBand)
    const off = { ...(await rollUp())['org-1'] }
    process.env.BILL_ORG_LIBRARY_STORAGE_FROM = MONTH
    seed(overBand)
    const on = (await rollUp())['org-1']
    expect(on.storageGb).toBe(off.storageGb)
    expect(on.costUsd).toBe(off.costUsd)
    expect(Number(on.costUsd)).toBeGreaterThan(0)
  })
})
