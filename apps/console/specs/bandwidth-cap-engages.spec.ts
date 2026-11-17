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
  bandwidthCap?: { month: string; engagedAt?: number; graceUntil?: number; pauseNotifiedAt?: number }
  /** When the workspace had its one-time grace (AGL-4232), if ever. */
  bandwidthGraceUsedAt?: number
}
interface SeededHost {
  id: string
  orgId: string
  /** This month's page views for the site. */
  pageViews: number
  /** When the site had its one-time grace (AGL-4232), if ever. */
  bandwidthGraceUsedAt?: number
}

let mockOrgs: SeededOrg[]
let mockHosts: SeededHost[]
/** `get()` calls against the `hosts` collection, i.e. pages read. */
let hostsPagesRead = 0
let mockNotifications: Array<{ orgId: string; title: string; body: string }>
const mockHostWrites: Array<{ hostId: string; data: Record<string, unknown> }> = []
/** Every merge written back to an org doc, in order. */
let mockOrgWrites: Array<{
  orgId: string
  data: Record<string, unknown>
  options?: { merge?: boolean }
}>

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
    data: () =>
      host.bandwidthGraceUsedAt === undefined
        ? {}
        : { bandwidthGraceUsedAt: host.bandwidthGraceUsedAt },
    get: (field: string) => (field === 'screens' ? {} : undefined),
    ref: {
      id: host.id,
      path: `hosts/${host.id}`,
      collection: (name: string) =>
        name === 'analytics'
          ? analyticsCollection(host.pageViews)
          : emptyCollection(),
      // Read inside the engage writer's transaction (AGL-4232).
      get: async () => ({
        exists: true,
        ref: fakeHostDoc(host).ref,
        data: () =>
          host.bandwidthGraceUsedAt === undefined
            ? {}
            : { bandwidthGraceUsedAt: host.bandwidthGraceUsedAt },
      }),
      // The one-time grace stamp (AGL-4232) lands on the site.
      update: async (value: Record<string, unknown>) => {
        mockHostWrites.push({ hostId: host.id, data: value })
      },
    },
  }
}

function fakeOrgDoc(org: SeededOrg) {
  const data: Record<string, unknown> = {
    plan: org.plan,
    slug: org.id,
    ...(org.subscription ? { subscription: org.subscription } : {}),
    ...(org.bandwidthCap ? { bandwidthCap: org.bandwidthCap } : {}),
    ...(org.bandwidthGraceUsedAt ? { bandwidthGraceUsedAt: org.bandwidthGraceUsedAt } : {}),
  }
  return {
    id: org.id,
    data: () => data,
    get: (field: string) => data[field],
    ref: {
      id: org.id,
      path: `orgs/${org.id}`,
      get: async () => ({ exists: true, data: () => data }),
      // The OPTIONS argument is captured too (AGL-2413). It was dropped until
      // then, which made the merge flag unassertable: a regression from
      // `set(updates, { merge: true })` to a bare `set(updates)` would wipe
      // `plan`, `subscription` and `slug` off every org this sweep caps — the
      // withConverter-on-partial-writes bug class, without the converter —
      // and every assertion in this file would still have been green.
      set: async (
        value: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        mockOrgWrites.push({ orgId: org.id, data: value, options })
      },
      collection: () => emptyCollection(),
    },
  }
}

const fakeFirestore = {
  // The engage writer's transaction (AGL-4232), over these same refs: reads
  // through `get`, writes applied when the body returns.
  runTransaction: async (body: (tx: any) => Promise<unknown>) => {
    const pending: Array<Promise<unknown>> = []
    const result = await body({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: unknown, options?: unknown) => {
        pending.push(ref.set(value, options))
      },
      update: (ref: any, value: unknown) => {
        pending.push(ref.update(value))
      },
    })
    await Promise.all(pending)
    return result
  },
  collection: (name: string) => {
    if (name === 'orgs') {
      /**
       * ORDER, LIMIT and an EXCLUSIVE START-AFTER, all modelled (AGL-2220).
       *
       * The sweep is chunked and resumable now. `limit: () => api` — a stub
       * that accepts the call and drops it — would hand back every seeded org
       * on every page, so a cursor that never advanced, a page that skipped
       * orgs, or an infinite resume loop would all read as green here. The
       * double has to be able to express a boundary for the assertions below
       * to mean anything.
       */
      const build = (limit: number | null, startAfter: string | null): any => {
        const api: any = {
          orderBy: () => api,
          limit: (size: number) => build(size, startAfter),
          startAfter: (ref: any) =>
            build(limit, typeof ref === 'string' ? ref : ref?.id),
          get: async () => {
            const ordered = [...mockOrgs].sort((a, b) =>
              a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
            )
            // Strictly greater than: the cursor names an org the previous
            // page already finished, so including it would redo one org per
            // resume.
            const remaining = startAfter
              ? ordered.filter((org) => org.id > startAfter)
              : ordered
            const page = limit == null ? remaining : remaining.slice(0, limit)
            return { docs: page.map(fakeOrgDoc), size: page.length }
          },
          // `startAfter` is handed a DocumentReference built from this same
          // collection, so the double has to serve `.doc()` as well as the
          // query.
          doc: (orgId: string) => ({ id: orgId }),
        }
        return api
      }
      return build(null, null)
    }
    if (name === 'hosts') {
      /**
       * ORDER, LIMIT and an EXCLUSIVE START-AFTER, modelled here too
       * (AGL-2421).
       *
       * This branch used to be `limit: () => api` — a stub that accepted the
       * call and dropped it — over a plain `filter`. That is why the 100-host
       * truncation could not be caught by a test: the double handed back
       * every seeded host no matter what the route asked for, so the shipped
       * `.limit(100)` and a correct paging loop were INDISTINGUISHABLE. The
       * limit has to be real before an assertion about it can fail.
       *
       * `hostsPagesRead` counts `get()` calls so the loop is observable: a
       * fix that raised the ceiling to one big `.limit(10000)` instead of
       * paging would pass the totals assertions and fail this one.
       */
      const build = (limit: number | null, startAfter: string | null): any => {
        let orgId = ''
        const api: any = {
          where: (_field: string, _op: string, value: string) => {
            orgId = value
            return api
          },
          orderBy: () => api,
          limit: (size: number) => {
            const next = build(size, startAfter)
            next.where('orgId', '==', orgId)
            return next
          },
          startAfter: (ref: any) => {
            const next = build(
              limit,
              typeof ref === 'string' ? ref : ref?.id,
            )
            next.where('orgId', '==', orgId)
            return next
          },
          get: async () => {
            hostsPagesRead += 1
            const ordered = [...mockHosts]
              .filter((host) => host.orgId === orgId)
              .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            // Strictly greater than: the cursor names a host the previous
            // page already summed, so including it would DOUBLE-COUNT that
            // site's page views — the failure mode opposite to the undercount
            // being fixed, and one the totals assertions would catch.
            const remaining = startAfter
              ? ordered.filter((host) => host.id > startAfter)
              : ordered
            const page = limit == null ? remaining : remaining.slice(0, limit)
            const docs = page.map(fakeHostDoc)
            return { docs, size: docs.length }
          },
          // `startAfter` is handed a DocumentReference built from this same
          // collection.
          doc: (hostId: string) => ({ id: hostId }),
        }
        return api
      }
      return build(null, null)
    }
    return emptyCollection()
  },
}

const mockHostNotices: Array<{ hostId: string; title: string; body: string }> = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The crossing's one notice, per site (AGL-4232).
  notifyHostManagers: async (hostId: string, payload: { title: string; body: string }) => {
    mockHostNotices.push({ hostId, title: payload.title, body: payload.body })
  },
  // The one engage write every cap writer shares (AGL-4232), for real, over
  // this suite's own store.
  engageBandwidthCap: (options: unknown) =>
    jest
      .requireActual('../../../libs/tenant/data/admin/src/lib/server/bandwidth-cap-engage')
      .engageBandwidthCap(options),
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
    // The REAL body, not a hardcoded `{}` (AGL-2220). The sweep reads its
    // page size and resume cursor from here; a double that always answers
    // `{}` would run page one no matter what a test posted.
    body: await request
      .clone()
      .json()
      .catch(() => ({})),
    headers: {
      'x-cron-secret': request.headers.get('x-cron-secret') ?? undefined,
    },
  }),
}))

jest.mock('../utils/screen-cap-reconciliation', () => ({
  __esModule: true,
  measureScreenCaps: async () => ({ maxBillable: 0, overCapHostIds: [] }),
  screenCapReading: async () => ({ maxBillable: 0, overCapHostIds: [] }),
}))

import {
  hostsForOrg,
  POST,
} from '../app/api/billing/usage-alerts/route'
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
  mockHostWrites.length = 0
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

/** The full write record the cap rode on, options included. */
const capWriteRecord = (orgId: string) =>
  mockOrgWrites.find(
    (write) => write.orgId === orgId && 'bandwidthCap' in write.data,
  )

const bandwidthAlert = () =>
  mockNotifications.find((entry) =>
    /bandwidth/i.test(`${entry.title} ${entry.body}`),
  )

beforeEach(() => {
  mockHostNotices.length = 0
  process.env.CRON_SECRET = CRON_SECRET
  jest.clearAllMocks()
  mockHosts = []
  mockOrgs = []
  mockOrgWrites = []
  mockHostWrites.length = 0
  hostsPagesRead = 0
})

describe('the sweep engages the cap on a free org past its band', () => {
  it('MERGES the write — it does not replace the org document', async () => {
    // The one assertion this suite could not make until the double captured
    // the options argument (AGL-2413). `set(updates)` without `{ merge: true }`
    // REPLACES the document: every capped org would lose `plan`,
    // `subscription`, `entitlements` and `hosts` — which resolves them to the
    // free tier, which engages the cap, which is unrecoverable without a
    // restore. Nothing else in this file can see the difference.
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: VIRAL }]
    await run()
    expect(capWriteRecord('org-1')?.options).toEqual({ merge: true })
  })

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
    // over an old one — otherwise a site capped in August goes on serving
    // uncapped from September onward, indefinitely.
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
  it('FREE at 80% is warned, with the upgrade path, and nothing engages (AGL-4232)', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: Math.round(FREE_BAND_VIEWS * 0.85) }]
    await run()
    const alert = bandwidthAlert()
    expect(alert?.title).toMatch(/above 80% of your monthly bandwidth/i)
    expect(alert?.body).toMatch(/upgrade in Billing/i)
    expect(capWrite('org-1')).toBeUndefined()
    expect(mockHostWrites).toEqual([])
  })

  it('FREE under the band: no alert, no cap, no grace spent', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: Math.round(FREE_BAND_VIEWS * 0.5) }]
    await run()
    expect(bandwidthAlert()).toBeUndefined()
    expect(capWrite('org-1')).toBeUndefined()
    expect(mockHostWrites).toEqual([])
  })

  it('FREE at 100% the FIRST time: ONE notice, per site, with its deadline (AGL-4232)', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: VIRAL }]
    const before = Date.now()
    await run()
    expect(mockHostNotices).toHaveLength(1)
    const [notice] = mockHostNotices
    expect(notice.hostId).toBe('site-a')
    expect(notice.title).toMatch(/^Upgrade or \{site\} pauses on \w+day, \w+ \d+ at \d+:\d\d [AP]M UTC$/)
    expect(notice.body).toMatch(/stays online until/i)
    expect(notice.body).toMatch(/temporarily unavailable/i)
    expect(notice.body).toMatch(/An unusually large surge of traffic can still pause it before then\./)
    expect(notice.body).toMatch(/This extra time is given once,/)
    expect(notice.body).not.toMatch(/once per site/)
    expect(notice.body).not.toMatch(/invoice/i)
    // ONE notice per crossing: the 100% usage alert stays silent for it.
    expect(bandwidthAlert()).toBeUndefined()
    // The marker carries the grace; the workspace AND the site record it.
    const marker = capWrite('org-1') as unknown as Record<string, number>
    expect(marker['graceUntil']).toBeGreaterThanOrEqual(before + 72 * 3_600_000)
    expect(marker['graceUntil']).toBeLessThanOrEqual(Date.now() + 72 * 3_600_000)
    expect(capWriteRecord('org-1')?.data['bandwidthGraceUsedAt']).toBe(marker['engagedAt'])
    expect(mockHostWrites).toEqual([
      { hostId: 'site-a', data: { bandwidthGraceUsedAt: marker['engagedAt'] } },
    ])
  })

  it('a workspace that had the grace gets none for a NEW site: deleting and re-making does not re-arm it', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'free', bandwidthGraceUsedAt: Date.now() - 40 * 86_400_000 }]
    mockHosts = [{ id: 'site-new', orgId: 'org-1', pageViews: VIRAL }]
    await run()
    expect((capWrite('org-1') as unknown as Record<string, unknown>)['graceUntil']).toBeUndefined()
    expect(mockHostWrites).toEqual([])
    expect(mockHostNotices[0]?.title).toBe('{site} paused — monthly traffic limit reached')
  })

  it('a grace that OUTLASTS the month tells the owner no pause date (AGL-4232)', async () => {
    // Granted 12:00 UTC on November 29: its 72 hours end after the 1st.
    jest.useFakeTimers({
      now: Date.UTC(2026, 10, 29, 12),
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask', 'clearTimeout', 'clearInterval'],
    })
    try {
      mockOrgs = [{ id: 'org-1', plan: 'free' }]
      mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: VIRAL }]
      await run()
      const [notice] = mockHostNotices
      expect(notice.title).toBe('{site} is past its monthly traffic limit and stays online')
      expect(notice.body).toMatch(/stays online: the month ends before its extra time would/)
      expect(`${notice.title} ${notice.body}`).not.toMatch(/pauses on|until \w+day/)
    } finally {
      jest.useRealTimers()
    }
  })

  it('when a grace ENDS, the owner is told the sites are paused — once (AGL-4232)', async () => {
    const month = new Date().toISOString().slice(0, 7)
    const ended = { month, engagedAt: Date.now() - 80 * 3_600_000, graceUntil: Date.now() - 1 }
    mockOrgs = [{ id: 'org-1', plan: 'free', bandwidthCap: ended }]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: VIRAL, bandwidthGraceUsedAt: ended.engagedAt }]
    await run()
    expect(mockHostNotices.map((entry) => entry.title)).toEqual([
      '{site} paused — monthly traffic limit reached',
    ])
    const marked = mockOrgWrites.find((write) => (write.data['bandwidthCap'] as any)?.pauseNotifiedAt)
    expect(marked?.options).toEqual({ merge: true })
    // A sweep that finds it already said writes and sends nothing more.
    mockOrgs = [{ id: 'org-1', plan: 'free', bandwidthCap: { ...ended, pauseNotifiedAt: 1 } }]
    mockHostNotices.length = 0
    await run()
    expect(mockHostNotices).toHaveLength(0)
  })

  it('while a grace runs, no pause is announced', async () => {
    const month = new Date().toISOString().slice(0, 7)
    mockOrgs = [
      {
        id: 'org-1',
        plan: 'free',
        bandwidthCap: { month, engagedAt: Date.now(), graceUntil: Date.now() + 3_600_000 },
      },
    ]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', pageViews: VIRAL, bandwidthGraceUsedAt: Date.now() }]
    await run()
    expect(mockHostNotices).toHaveLength(0)
  })

  it('FREE at 100% after its site already had the grace is paused at once', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = [
      {
        id: 'site-a',
        orgId: 'org-1',
        pageViews: VIRAL,
        // A grace from an earlier month: long over.
        bandwidthGraceUsedAt: Date.now() - 40 * 24 * 3_600_000,
      },
    ]
    await run()
    const [notice] = mockHostNotices
    expect(notice.title).toBe('{site} paused — monthly traffic limit reached')
    // What visitors see, that nothing is charged, and the way back.
    expect(notice.body).toMatch(/temporarily unavailable/i)
    expect(notice.body).toMatch(/Nothing is charged/)
    expect(notice.body).toMatch(/as soon as you upgrade in Billing/)
    expect(notice.body).not.toMatch(/invoice/i)
    expect(bandwidthAlert()).toBeUndefined()
    // …and the site really is stopped, in the same run: no grace, no stamp.
    expect(capWrite('org-1')).toBeDefined()
    expect((capWrite('org-1') as unknown as Record<string, unknown>)['graceUntil']).toBeUndefined()
    expect(mockHostWrites).toEqual([])
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

/**
 * The inner host query is PAGED (AGL-2421).
 *
 * `hosts` was `.limit(100).get()` with no order and no cursor, and every
 * per-org total in this sweep — page views (and so `bandwidthGb`, and so
 * whether the cap engages), email sends, workflow and action runs, media
 * bytes, and the site count the `hosts` quota alert reports — was summed over
 * that single page. An org past 100 sites was undercounted with no flag and
 * no log.
 *
 * Every case below is seeded so the FIRST HUNDRED HOSTS ARE INSIDE THE BAND
 * and the whole org is outside it. That is the shape that separates the fix
 * from the defect; a fixture whose first page already crossed the band would
 * pass against both.
 */
describe('an org with more sites than one page (AGL-2421)', () => {
  /** Per-site views such that 100 sites are under the band and 250 are over. */
  const PER_SITE = Math.floor(FREE_BAND_VIEWS / 150)

  /** `site-000` … so document-id order and array order agree. */
  const seedHosts = (count: number, orgId = 'org-1'): SeededHost[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `site-${String(index).padStart(5, '0')}`,
      orgId,
      pageViews: PER_SITE,
    }))

  it('sums EVERY site, not the first hundred', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = seedHosts(250)

    // Guard the premise both ways, or the assertion below proves nothing:
    // one page must be INSIDE the band and the whole org OUTSIDE it.
    expect(100 * PER_SITE).toBeLessThan(FREE_BAND_VIEWS)
    expect(250 * PER_SITE).toBeGreaterThan(FREE_BAND_VIEWS)

    await run()
    const cap = capWrite('org-1')
    expect(cap).toBeDefined()
    // The figure the customer would be quoted. Truncated at 100 it would read
    // `100 * PER_SITE` and the cap would not have engaged at all.
    expect(cap?.pageViews).toBe(250 * PER_SITE)
  })

  it('pages rather than raising the ceiling to one huge limit', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = seedHosts(250)
    await run()
    // 100 + 100 + 50: the short third page ends the loop. A single
    // `.limit(10000)` would read one page and still total correctly, so this
    // is what separates "paged" from "a bigger number".
    expect(hostsPagesRead).toBe(3)
  })

  it('does not double-count the host a cursor names', async () => {
    // An INCLUSIVE cursor is the natural mistake, and it inflates rather than
    // truncates — the same customer, told the opposite wrong number.
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = seedHosts(201)
    await run()
    expect(capWrite('org-1')?.pageViews).toBe(201 * PER_SITE)
  })

  it('reads exactly one page for an org that fits in one', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = seedHosts(1)
    await run()
    expect(hostsPagesRead).toBe(1)
  })

  it('STOPS at the ceiling and says so', async () => {
    // The positive control for `hostsTruncated`. Driven through `hostsForOrg`
    // with an injected ceiling rather than through the route, because
    // reaching the shipped 10,000 would mean ten thousand fixtures and sixty
    // thousand counter reads to observe one boolean — and a flag with only a
    // negative control is a flag nothing proves can ever fire.
    mockHosts = seedHosts(250)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await hostsForOrg(fakeFirestore as any, 'org-1', 200)
    expect(result.truncated).toBe(true)
    expect(result.docs).toHaveLength(200)
    // Logged as well as flagged: the response reaches the cron workflow, the
    // log reaches whoever is reading them when an org's numbers look wrong.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('org-1'))
    warn.mockRestore()
  })

  it('reports nothing truncated for an ordinary org', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'free' }]
    mockHosts = seedHosts(250)
    const response = await run()
    // The negative control for the flag: it must not fire for every org that
    // merely needed a second page.
    await expect(response.json()).resolves.toMatchObject({
      hostsTruncated: [],
    })
  })
})
