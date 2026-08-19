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
 * The daily sweep ENGAGES the free plan's bandwidth cap, and tells the truth
 * about it (AGL-1967 / AGL-2070 / AGL-2155).
 *
 * Two things ship together here because they are the same sentence said to a
 * machine and to a person:
 *
 *  1. **The marker.** `usage-alerts` already sums an org's page views for the
 *     current month against `entitlements.bandwidthGb` in order to alert on
 *     them. It now also writes the verdict onto the org doc, where the tenant
 *     app reads it with no read of its own. The decision is made here rather
 *     than in the serving path because this is where the number already is —
 *     re-deriving it anywhere else is the AGL-1371 mistake, a cap that
 *     engages on a figure the customer's own alert does not show.
 *  2. **The words.** The bandwidth check had no `billsOverage` field
 *     (AGL-2070), so a falsy value selected the "the product stops at the
 *     band" copy — which was false for free, whose site kept serving, and
 *     false for paid, whose overage bills. Both halves are asserted below,
 *     because a copy fix that only checked one branch is how the field came
 *     to be missing in the first place.
 *
 * Every case is driven through the REAL route with the REAL entitlements. A
 * stubbed band would make the arithmetic unfalsifiable.
 */

const CRON_SECRET = 'test-cron-secret'

/** UTC `YYYY-MM`, the key the route stamps and the tenant reads. */
const MONTH = new Date().toISOString().slice(0, 7)

interface SeededOrg {
  id: string
  plan: string
  subscription?: { status: string }
  /** An already-engaged cap, to prove the sweep does not rewrite it. */
  bandwidthCap?: { month: string; engagedAt?: number }
}
interface SeededHost {
  id: string
  orgId: string
  /** This month's page views for the site. */
  pageViews: number
}

let mockOrgs: SeededOrg[]
let mockHosts: SeededHost[]
let mockNotifications: Array<{ orgId: string; title: string; body: string }>
/** Every merge written back to an org doc, in order. */
let mockOrgWrites: Array<{ orgId: string; data: Record<string, unknown> }>

const mockNotifyOrgAdmins = jest.fn(
  async (orgId: string, payload: { title: string; body: string }) => {
    mockNotifications.push({ orgId, title: payload.title, body: payload.body })
  },
)

function emptyCollection(): any {
  const api: any = {
    select: () => api,
    where: () => api,
    limit: () => api,
    orderBy: () => api,
    get: async () => ({ docs: [], size: 0, empty: true }),
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    doc: () => ({ get: async () => ({ exists: false, get: () => undefined }) }),
  }
  return api
}

/** One `hosts/{id}/analytics/{day}` document carrying the whole month. */
function analyticsCollection(pageViews: number): any {
  const api: any = {
    where: () => api,
    get: async () => ({
      docs: [
        {
          id: `${MONTH}-01`,
          get: (field: string) => (field === 'total' ? pageViews : undefined),
        },
      ],
    }),
  }
  return api
}

function fakeHostDoc(host: SeededHost) {
  return {
    id: host.id,
    get: (field: string) => (field === 'screens' ? {} : undefined),
    ref: {
      id: host.id,
      collection: (name: string) =>
        name === 'analytics'
          ? analyticsCollection(host.pageViews)
          : emptyCollection(),
    },
  }
}

function fakeOrgDoc(org: SeededOrg) {
  const data: Record<string, unknown> = {
    plan: org.plan,
    slug: org.id,
    ...(org.subscription ? { subscription: org.subscription } : {}),
    ...(org.bandwidthCap ? { bandwidthCap: org.bandwidthCap } : {}),
  }
  return {
    id: org.id,
    data: () => data,
    get: (field: string) => data[field],
    ref: {
      id: org.id,
      set: async (value: Record<string, unknown>) => {
        mockOrgWrites.push({ orgId: org.id, data: value })
      },
      collection: () => emptyCollection(),
    },
  }
}

const fakeFirestore = {
  collection: (name: string) => {
    if (name === 'orgs') {
      const api: any = {
        limit: () => api,
        get: async () => ({
          docs: mockOrgs.map(fakeOrgDoc),
          size: mockOrgs.length,
        }),
      }
      return api
    }
    if (name === 'hosts') {
      let orgId = ''
      const api: any = {
        where: (_field: string, _op: string, value: string) => {
          orgId = value
          return api
        },
        limit: () => api,
        get: async () => {
          const docs = mockHosts
            .filter((host) => host.orgId === orgId)
            .map(fakeHostDoc)
          return { docs, size: docs.length }
        },
      }
      return api
    }
    return emptyCollection()
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: { FieldPath: { documentId: () => '__name__' } },
  },
  notifyOrgAdmins: (...args: unknown[]) =>
    (mockNotifyOrgAdmins as any)(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table AND the REAL cap resolvers — the point of the suite is
  // that the shipped arithmetic engages, not that a stub can be made to.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/bandwidth-cap'),
  buildRoute: () => '/org/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: {},
    headers: {
      'x-cron-secret': request.headers.get('x-cron-secret') ?? undefined,
    },
  }),
}))

jest.mock('../utils/screen-cap-reconciliation', () => ({
  __esModule: true,
  measureScreenCaps: async () => ({ maxBillable: 0, overCapHostIds: [] }),
  screenCapMaxBillable: async () => 0,
}))

import { POST } from '../app/api/billing/usage-alerts/route'
import { pageViewsFromBandwidthGb } from '../utils/usage-metering'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/server'

/** ~8.7k views. Free's 5 GB band, in the unit the counter is in. */
const FREE_BAND_VIEWS = Math.round(
  pageViewsFromBandwidthGb(PLAN_ENTITLEMENTS.free.bandwidthGb),
)
/** 100× the band. A free site having its best day ever. */
const VIRAL = FREE_BAND_VIEWS * 100

async function run() {
  mockNotifications = []
  mockOrgWrites = []
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/usage-alerts', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
  )
  expect(response.status).toBe(200)
  return response
}

/** The `bandwidthCap` merged onto an org this run, if any. */
const capWrite = (orgId: string) =>
  mockOrgWrites.find(
    (write) => write.orgId === orgId && 'bandwidthCap' in write.data,
  )?.data['bandwidthCap'] as
    | { month: string; pageViews?: number; includedPageViews?: number }
    | undefined

const bandwidthAlert = () =>
  mockNotifications.find((entry) =>
    /bandwidth/i.test(`${entry.title} ${entry.body}`),
  )

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.USAGE_ALERT_APPROACH_PCT
  jest.clearAllMocks()
  mockHosts = []
  mockOrgs = []
  mockOrgWrites = []
})

describe('the sweep engages the cap on a free org past its band', () => {
  it('writes the marker, stamped with the CURRENT month', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: VIRAL }]
    await run()
    const cap = capWrite('org-1')
    expect(cap).toBeDefined()
    expect(cap?.month).toBe(MONTH)
    // The diagnostics the customer will be quoted if they ask what tripped it.
    expect(cap?.pageViews).toBe(VIRAL)
    expect(cap?.includedPageViews).toBe(FREE_BAND_VIEWS)
  })

  it('POSITIVE CONTROL: a PAID org with the identical traffic is untouched', async () => {
    // The promise that predates this cap: a metered plan bills its overage and
    // is never cut off. Same page views, same band arithmetic, no marker.
    mockOrgs = [
      { id: 'org-1', plan: 'starter', subscription: { status: 'active' } },
    ]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: VIRAL }]
    await run()
    expect(capWrite('org-1')).toBeUndefined()
  })

  it('leaves a free org INSIDE its band alone', async () => {
    // Half the band. Proves the marker above is written by the overage and not
    // simply by the org being free.
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = [
      {
        id: 'site-a',
        orgId: 'org-1',
        pageViews: Math.floor(FREE_BAND_VIEWS / 2),
      },
    ]
    await run()
    expect(capWrite('org-1')).toBeUndefined()
  })

  it('does NOT rewrite a cap already engaged this month', async () => {
    // Engaged once; the next thirty sweeps write nothing. Re-stamping daily
    // would replace the moment the site was paused with the moment it was
    // last swept, which is the figure a customer would be told.
    mockOrgs = [
      {
        id: 'org-1',
        plan: 'free',
        bandwidthCap: { month: MONTH, engagedAt: 1 },
      },
    ]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: VIRAL }]
    await run()
    expect(capWrite('org-1')).toBeUndefined()
  })

  it('RE-ENGAGES over LAST month’s stale marker', async () => {
    // Nothing ever clears a marker, so the new month must be able to stamp
    // over an old one — otherwise a site capped in August serves free forever
    // from September.
    mockOrgs = [
      { id: 'org-1', plan: 'free', bandwidthCap: { month: '2020-01' } },
    ]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: VIRAL }]
    await run()
    expect(capWrite('org-1')?.month).toBe(MONTH)
  })

  it('sums the org’s SITES — the band is org-wide', async () => {
    // Neither site crosses the band alone; together they are twice it. Free
    // has `hostLimit: 1`, so this case is only reachable after a downgrade —
    // which is exactly when an org has more sites than its plan allows.
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = [
      { id: 'site-a', orgId: 'org-1', pageViews: FREE_BAND_VIEWS },
      { id: 'site-b', orgId: 'org-1', pageViews: FREE_BAND_VIEWS },
    ]
    await run()
    expect(capWrite('org-1')).toBeDefined()
  })
})

describe('the alert says which of the two actually happens (AGL-2070)', () => {
  it('FREE at 100% is told it reached the limit — and now that is TRUE', async () => {
    // The wall wording was already what this branch produced; what changed is
    // that it stopped being a lie. Before the cap the customer read "you've
    // reached your monthly bandwidth limit" while every page kept serving.
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: VIRAL }]
    await run()
    const alert = bandwidthAlert()
    expect(alert?.title).toMatch(/reached your monthly bandwidth limit/i)
    expect(alert?.body).toMatch(/upgrade in Billing to raise the limit/i)
    // …and the site really is stopped, in the same run.
    expect(capWrite('org-1')).toBeDefined()
  })

  it('PAID at 100% is told it is being BILLED, never that it is stuck', async () => {
    // The half the missing `billsOverage` field got wrong in the other
    // direction. "Upgrade to raise the limit" implies the product has stopped;
    // a metered org's site is serving and its invoice is growing, and the
    // action it needs is a cap or an upgrade, not a rescue.
    mockOrgs = [
      { id: 'org-1', plan: 'starter', subscription: { status: 'active' } },
    ]
    mockHosts = [
      {
        id: 'site-a',
        orgId: 'org-1',
        pageViews: Math.round(
          pageViewsFromBandwidthGb(PLAN_ENTITLEMENTS.starter.bandwidthGb) * 2,
        ),
      },
    ]
    await run()
    const alert = bandwidthAlert()
    expect(alert?.title).toMatch(/extra usage is now billed/i)
    expect(alert?.body).toMatch(/billed on your\s+monthly invoice/i)
    expect(alert?.body).not.toMatch(/raise the limit/i)
    // And it is NOT capped — the words and the behaviour agree.
    expect(capWrite('org-1')).toBeUndefined()
  })
})
