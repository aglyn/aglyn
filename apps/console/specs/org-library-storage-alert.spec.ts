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
 * The workspace's ONE storage alert (AGL-3482).
 *
 * Storage is one band for the whole workspace since AGL-2075: every site's
 * library and the organization library, against
 * `Math.max(1, hostLimit) × storagePerHostMb` — the band ingress refuses at and
 * the invoice subtracts. So the alert is one check against that band, and the
 * org library has no allowance of its own to be warned about. It is counted
 * (AGL-1473): an org whose bytes live in the shared library reads as using
 * them, and the body says how much of the total the library holds.
 *
 * No plan figure is written here: every band is derived from
 * `PLAN_ENTITLEMENTS`, and the plans are chosen by what they DO — refuse past
 * the band, or bill past it — not by name.
 */

import {
  PLAN_ENTITLEMENTS,
  planMetersInfraOverage,
  resolveOrgEntitlements,
} from '../../../libs/aglyn/src/lib/app-utils/plan-entitlements'
import { formatStorageMb } from '../utils/usage-alert-notice'

const CRON_SECRET = 'test-cron-secret'
const MB = 1024 * 1024
const MONTH = new Date().toISOString().slice(0, 7)

interface SeededOrg {
  id: string
  plan: string
  /** `orgs/{id}/counters/media.bytes`. */
  orgLibraryBytes: number
  /** Existing `usageAlerts` guard map. */
  usageAlerts?: Record<string, { month?: string; threshold?: number }>
  /** Any other org-doc field — entitlement overrides, a storage cap. */
  extra?: Record<string, unknown>
}
interface SeededHost {
  id: string
  orgId: string
  mediaBytes: number
}

let mockOrgs: SeededOrg[]
let mockHosts: SeededHost[]
/** What the sweep wrote to each org doc — the guard map among it. */
let mockWrites: Record<string, Record<string, unknown>>
/**
 * Every `notifyOrgAdmins` call, title AND body: past the band a metered plan
 * BILLS rather than refusing, so what this notification says is the whole of
 * the "no surprise bill" protection.
 */
let mockNotifications: Array<{ orgId: string; title: string; body: string }>

const mockNotifyOrgAdmins = jest.fn(
  async (orgId: string, payload: { title: string; body: string }) => {
    mockNotifications.push({
      orgId,
      title: payload.title,
      body: payload.body,
    })
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
    doc: () => ({
      get: async () => ({ exists: false, get: () => undefined }),
    }),
  }
  return api
}

function counterSnapshot(bytes: number | undefined) {
  return {
    exists: bytes !== undefined,
    get: (field: string) => (field === 'bytes' ? bytes : undefined),
  }
}

function fakeHostDoc(host: SeededHost) {
  return {
    id: host.id,
    get: (field: string) => (field === 'screens' ? {} : undefined),
    ref: {
      id: host.id,
      collection: (name: string) =>
        name === 'counters'
          ? {
              doc: (counter: string) => ({
                get: async () =>
                  counter === 'media'
                    ? counterSnapshot(host.mediaBytes)
                    : { exists: false, get: () => undefined },
              }),
            }
          : emptyCollection(),
    },
  }
}

function fakeOrgDoc(org: SeededOrg) {
  const data: Record<string, unknown> = {
    plan: org.plan,
    slug: org.id,
    ...(org.usageAlerts ? { usageAlerts: org.usageAlerts } : {}),
    ...org.extra,
  }
  return {
    id: org.id,
    data: () => data,
    get: (field: string) => data[field],
    ref: {
      id: org.id,
      set: async (update: Record<string, unknown>) => {
        mockWrites[org.id] = update
      },
      collection: (name: string) =>
        name === 'counters'
          ? {
              doc: (counter: string) => ({
                get: async () =>
                  counter === 'media'
                    ? counterSnapshot(org.orgLibraryBytes)
                    : { exists: false, get: () => undefined },
              }),
            }
          : emptyCollection(),
    },
  }
}

const fakeFirestore = {
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
       * ORDER, LIMIT and an EXCLUSIVE START-AFTER (AGL-2421). The route pages
       * this query now, so a double that answers `where().get()` and nothing
       * else throws "orderBy is not a function" and the whole sweep 500s —
       * which is what happened when only `bandwidth-cap-engages` was updated.
       *
       * Modelled properly rather than stubbed to `() => api`, even though
       * these fixtures never fill a page: an un-modelled limit is exactly
       * what hid the truncation this issue was filed for.
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
            const next = build(limit, typeof ref === 'string' ? ref : ref?.id)
            next.where('orgId', '==', orgId)
            return next
          },
          get: async () => {
            const ordered = [...mockHosts]
              .filter((host) => host.orgId === orgId)
              .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            const remaining = startAfter
              ? ordered.filter((host) => host.id > startAfter)
              : ordered
            const page = limit == null ? remaining : remaining.slice(0, limit)
            const docs = page.map(fakeHostDoc)
            return { docs, size: docs.length }
          },
          doc: (hostId: string) => ({ id: hostId }),
        }
        return api
      }
      return build(null, null)
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
  notifyOrgAdmins: (...args: unknown[]) => (mockNotifyOrgAdmins as any)(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL entitlements — a stubbed allowance would make the threshold
  // arithmetic below unfalsifiable.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  // The route stamps and reads the free-plan bandwidth cap through the same
  // barrel (AGL-2155); a stubbed export here would fail as "not a function"
  // rather than as anything to do with this suite's subject.
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

import { POST } from '../app/api/billing/usage-alerts/route'

type PlanKey = keyof typeof PLAN_ENTITLEMENTS
const PLANS = Object.keys(PLAN_ENTITLEMENTS) as PlanKey[]
const entitlementsOf = (org: Record<string, unknown>) =>
  resolveOrgEntitlements(org as never)
/** The pooled band, in the arithmetic ingress and the invoice share. */
const bandMbOf = (org: Record<string, unknown>) => {
  const resolved = entitlementsOf(org)
  return Math.max(1, resolved.hostLimit) * resolved.storagePerHostMb
}
const finiteStorage = (plan: PlanKey) =>
  Number.isFinite(entitlementsOf({ plan }).storagePerHostMb) &&
  Number.isFinite(entitlementsOf({ plan }).hostLimit)
/** A plan that REFUSES past the band, with one site — its band is one site's. */
const HARD = PLANS.find(
  (plan) =>
    finiteStorage(plan) &&
    !planMetersInfraOverage({ plan } as never) &&
    entitlementsOf({ plan }).hostLimit === 1,
) as PlanKey
/** A plan that BILLS past the band, with several sites pooled into it. */
const METERED = PLANS.find(
  (plan) =>
    finiteStorage(plan) &&
    planMetersInfraOverage({ plan } as never) &&
    entitlementsOf({ plan }).hostLimit > 1,
) as PlanKey
const HARD_BAND_MB = () => bandMbOf({ plan: HARD })
const METERED_BAND_MB = () => bandMbOf({ plan: METERED })
const METERED_SCOPE_MB = () => entitlementsOf({ plan: METERED }).storagePerHostMb

async function run() {
  mockNotifications = []
  mockWrites = {}
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/usage-alerts', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
  )
  expect(response.status).toBe(200)
  return mockNotifications
}

/** One captured notification: title AND body (see `mockNotifications`). */
type CapturedAlert = { title: string; body: string }

const mediaAlerts = (notifications: CapturedAlert[]) =>
  notifications.filter((entry) => entry.title.includes('media storage'))
/** Every storage notice of any name — there must only ever be the one. */
const storageAlerts = (notifications: CapturedAlert[]) =>
  notifications.filter((entry) => /storage/i.test(entry.title))

const mbBytes = (mb: number) => Math.round(mb * MB)

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env['BILL_ORG_LIBRARY_STORAGE_FROM']
  jest.clearAllMocks()
  mockHosts = []
  mockOrgs = []
  mockWrites = {}
})

it('has the plans it reasons about', () => {
  expect(HARD).toBeDefined()
  expect(METERED).toBeDefined()
  // What makes METERED the plan that tells the pooled band from one site's.
  expect(METERED_BAND_MB()).toBeGreaterThan(METERED_SCOPE_MB())
})

describe('the storage alert sees the org library (AGL-1473)', () => {
  it('warns an org that is over its band PURELY in the org library', async () => {
    mockOrgs = [
      { id: 'org-1', plan: HARD, orgLibraryBytes: mbBytes(HARD_BAND_MB()) },
    ]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: 0 }]
    expect(mediaAlerts(await run())).toHaveLength(1)
  })

  it('adds the library to the sites rather than replacing them', async () => {
    // Neither figure crosses a step alone (half the band each); together
    // they are the whole band.
    mockOrgs = [
      { id: 'org-1', plan: HARD, orgLibraryBytes: mbBytes(HARD_BAND_MB() / 2) },
    ]
    mockHosts = [
      { id: 'site-a', orgId: 'org-1', mediaBytes: mbBytes(HARD_BAND_MB() / 2) },
    ]
    expect(mediaAlerts(await run())).toHaveLength(1)
  })

  it('leaves a quiet org quiet', async () => {
    mockOrgs = [{ id: 'org-1', plan: HARD, orgLibraryBytes: 1024 }]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: 1024 }]
    expect(storageAlerts(await run())).toHaveLength(0)
  })

  it('warns a host-only org on both sides of the band as it always did', async () => {
    mockOrgs = [{ id: 'org-1', plan: HARD, orgLibraryBytes: 0 }]
    mockHosts = [
      { id: 'site-a', orgId: 'org-1', mediaBytes: mbBytes(0.5 * HARD_BAND_MB()) },
    ]
    expect(mediaAlerts(await run())).toHaveLength(0)

    mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: mbBytes(HARD_BAND_MB()) }]
    const notifications = await run()
    expect(mediaAlerts(notifications)).toHaveLength(1)
    // No library, no sentence about one.
    expect(mediaAlerts(notifications)[0].body).not.toContain(
      'of it is in the organization library',
    )
  })
})

describe('one storage alert, against the workspace’s pooled band (AGL-3482)', () => {
  it('says nothing about a full library while the workspace has room', async () => {
    // One site's worth of bytes in the org library, nothing on the sites. That
    // refuses nothing and bills nothing — the pool is a fraction used — so a
    // notice telling this workspace to free up space would be false.
    mockOrgs = [
      { id: 'org-1', plan: METERED, orgLibraryBytes: mbBytes(METERED_SCOPE_MB()) },
    ]
    mockHosts = [
      { id: 'site-a', orgId: 'org-1', mediaBytes: 0 },
      { id: 'site-b', orgId: 'org-1', mediaBytes: 0 },
    ]
    expect(METERED_SCOPE_MB() / METERED_BAND_MB()).toBeLessThan(0.75)
    expect(storageAlerts(await run())).toHaveLength(0)
  })

  it('sends ONE notice for the pool, naming the library’s share of it', async () => {
    const band = METERED_BAND_MB()
    const library = Math.round(0.3 * band)
    mockOrgs = [{ id: 'org-1', plan: METERED, orgLibraryBytes: mbBytes(library) }]
    mockHosts = [
      { id: 'site-a', orgId: 'org-1', mediaBytes: mbBytes(0.25 * band) },
      { id: 'site-b', orgId: 'org-1', mediaBytes: mbBytes(0.3 * band) },
    ]
    const notifications = await run()
    expect(storageAlerts(notifications)).toHaveLength(1)
    const [alert] = mediaAlerts(notifications)
    expect(alert.title).toContain('above 80%')
    // The pooled band is the figure quoted, with every library in it.
    expect(alert.body).toContain(`of the ${formatStorageMb(band)} of media storage`)
    expect(alert.body).toContain('across all its sites and its organization library')
    expect(alert.body).toContain(
      `${formatStorageMb(library)} of it is in the organization library.`,
    )
  })

  it('prints the step actually crossed: 75 at 79%, 90 at 95% (AGL-3431)', async () => {
    for (const [share, step] of [
      [0.79, 'above 75%'],
      [0.95, 'above 90%'],
    ] as const) {
      mockOrgs = [
        {
          id: 'org-1',
          plan: METERED,
          orgLibraryBytes: mbBytes(share * METERED_BAND_MB()),
        },
      ]
      mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: 0 }]
      const alerts = mediaAlerts(await run())
      expect(alerts).toHaveLength(1)
      expect(alerts[0].title).toContain(step)
    }
  })

  it('never measures against a band of zero sites — `Math.max(1, …)`', async () => {
    // A site limit that resolves to 0 still includes one site's band on the
    // invoice and at ingress. Measured against `0 × storagePerHostMb` the
    // alert could never fire at all.
    const org = { plan: HARD, entitlements: { hostLimit: 0 } }
    expect(entitlementsOf(org).hostLimit).toBe(0)
    const band = bandMbOf(org)
    expect(band).toBe(entitlementsOf(org).storagePerHostMb)
    mockOrgs = [
      {
        id: 'org-1',
        plan: HARD,
        orgLibraryBytes: mbBytes(band),
        extra: { entitlements: { hostLimit: 0 } },
      },
    ]
    const alerts = mediaAlerts(await run())
    expect(alerts).toHaveLength(1)
    expect(alerts[0].body).toContain(formatStorageMb(band))
  })
})

describe('what the storage notice says happens at the band (AGL-3482)', () => {
  it('on a plan that refuses past it: uploads stop, nothing is charged', async () => {
    mockOrgs = [
      { id: 'org-1', plan: HARD, orgLibraryBytes: mbBytes(HARD_BAND_MB()) },
    ]
    const [reached] = mediaAlerts(await run())
    expect(reached.title).toContain('reached')
    expect(reached.title).not.toContain('billed')
    expect(reached.body).toContain('new uploads stop')
    expect(reached.body).toContain('nothing is charged')
    expect(reached.body).toContain('upgrade in Billing')
    expect(reached.body).not.toContain('invoice')
    expect(reached.body).not.toMatch(/\bbilled\b/)

    mockOrgs = [
      { id: 'org-1', plan: HARD, orgLibraryBytes: mbBytes(0.85 * HARD_BAND_MB()) },
    ]
    const [approach] = mediaAlerts(await run())
    expect(approach.body).toContain('new uploads stop')
    expect(approach.body).not.toMatch(/\bbilled\b/)
  })

  it('on a plan that bills past it: billed unless a storage cap is set', async () => {
    // The org library's storage on the invoice, as in production.
    process.env['BILL_ORG_LIBRARY_STORAGE_FROM'] = '2020-01'
    mockOrgs = [
      { id: 'org-1', plan: METERED, orgLibraryBytes: mbBytes(METERED_BAND_MB()) },
    ]
    const [reached] = mediaAlerts(await run())
    expect(reached.title).toContain('now billed')
    expect(reached.body).toContain(
      'billed on your monthly invoice unless you set a storage cap',
    )
    expect(reached.body).toContain('upgrade')
    expect(reached.body).not.toContain('uploads stop')
    expect(reached.body).not.toContain('organization library stop')

    mockOrgs = [
      {
        id: 'org-1',
        plan: METERED,
        orgLibraryBytes: mbBytes(0.85 * METERED_BAND_MB()),
      },
    ]
    const [approach] = mediaAlerts(await run())
    expect(approach.body).toContain('Nothing is charged yet')
    expect(approach.body).toContain('unless you set a storage cap')
  })

  it('names the cap the customer set rather than offering one', async () => {
    process.env['BILL_ORG_LIBRARY_STORAGE_FROM'] = '2020-01'
    mockOrgs = [
      {
        id: 'org-1',
        plan: METERED,
        orgLibraryBytes: mbBytes(METERED_BAND_MB()),
        extra: { storageOverage: { capUsd: 10 } },
      },
    ]
    const [reached] = mediaAlerts(await run())
    expect(reached.body).toContain('storage cap you set in Billing')
    expect(reached.body).toContain('new uploads stop')
    expect(reached.body).not.toContain('unless you set')
  })

  it('says the org library stops at the band while it is not invoiced', async () => {
    // `mediaStorageGate` refuses org-library uploads past the band on a
    // metered plan until `BILL_ORG_LIBRARY_STORAGE_FROM` names a month.
    mockOrgs = [
      { id: 'org-1', plan: METERED, orgLibraryBytes: mbBytes(METERED_BAND_MB()) },
    ]
    const [reached] = mediaAlerts(await run())
    expect(reached.body).toContain(
      'Uploads to the organization library stop at the included amount',
    )
  })
})

describe('one guard, as before (AGL-3482)', () => {
  const atEightyFive = () => [
    {
      id: 'org-1',
      plan: METERED,
      orgLibraryBytes: mbBytes(0.85 * METERED_BAND_MB()),
    },
  ]

  it('does not re-announce a step the `mediaStorage` guard already holds', async () => {
    // The guard key is the one the pooled figure was always announced under,
    // so a workspace already told is not told again — whatever month it was.
    mockOrgs = atEightyFive().map((org) => ({
      ...org,
      usageAlerts: { mediaStorage: { month: '2026-01', threshold: 80 } },
    }))
    expect(storageAlerts(await run())).toHaveLength(0)
  })

  it('does not read a per-library guard as anything', async () => {
    // A workspace told this month about its library alone, under the retired
    // `orgLibraryStorage` key, and inside its pooled band: nothing is due, and
    // nothing rewrites the retired entry.
    mockOrgs = [
      {
        id: 'org-1',
        plan: METERED,
        orgLibraryBytes: mbBytes(METERED_SCOPE_MB()),
        usageAlerts: { orgLibraryStorage: { month: MONTH, threshold: 100 } },
      },
    ]
    expect(storageAlerts(await run())).toHaveLength(0)
    const guards = (mockWrites['org-1']?.['usageAlerts'] ?? {}) as Record<
      string,
      unknown
    >
    expect(guards).not.toHaveProperty('orgLibraryStorage')
    expect(guards).not.toHaveProperty('mediaStorage')
  })

  it('records the pooled crossing under `mediaStorage` and nothing else', async () => {
    mockOrgs = atEightyFive()
    expect(storageAlerts(await run())).toHaveLength(1)
    const guards = mockWrites['org-1']?.['usageAlerts'] as Record<string, unknown>
    expect(guards['mediaStorage']).toEqual({ month: MONTH, threshold: 80 })
    expect(Object.keys(guards).filter((key) => /storage/i.test(key))).toEqual([
      'mediaStorage',
    ])
  })
})
