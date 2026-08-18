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
 * The media-storage alert can see the ORG LIBRARY (AGL-1473).
 *
 * `usage-alerts` summed `hosts/{id}/counters/media` and nothing else, so an org
 * whose bytes live in the shared org DAM read as using zero storage — on the
 * one alert whose entire purpose is warning somebody before a downgrade leaves
 * them over their allowance. Those bytes are enforced at upload against
 * `storagePerHostMb`, so the alert was silent about storage the platform will
 * refuse the next upload for.
 *
 * Unlike the rollup's billing arm this is NOT behind a switch. A warning is
 * not a charge, and staying quiet about an enforced limit is the defect rather
 * than the caution.
 */

const CRON_SECRET = 'test-cron-secret'
const MB = 1024 * 1024

interface SeededOrg {
  id: string
  plan: string
  /** `orgs/{id}/counters/media.bytes`. */
  orgLibraryBytes: number
  /** Existing `usageAlerts` guard map. */
  usageAlerts?: Record<string, { month?: string; threshold?: number }>
}
interface SeededHost {
  id: string
  orgId: string
  mediaBytes: number
}

let mockOrgs: SeededOrg[]
let mockHosts: SeededHost[]
/**
 * Every `notifyOrgAdmins` call.
 *
 * `body` is captured since 2026-08-18: once storage past the band BILLS
 * rather than being refused, this notification is the whole of the "no
 * surprise bill" protection, and what it says is the protection — a body that
 * tells a metered org to "upgrade to raise the limit" describes a wall that
 * is not there and omits the charge that is.
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
  }
  return {
    id: org.id,
    data: () => data,
    get: (field: string) => data[field],
    ref: {
      id: org.id,
      set: async () => undefined,
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
  notifyOrgAdmins: (...args: unknown[]) => (mockNotifyOrgAdmins as any)(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL entitlements — a stubbed allowance would make the threshold
  // arithmetic below unfalsifiable.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
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

/** Starter: 1 site × 2048 MB. 80% of the band is 1638.4 MB. */
const BAND_MB = 2048

async function run() {
  mockNotifications = []
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

/** The AGL-1886 check, keyed and labelled apart from the org-wide one. */
const libraryAlerts = (notifications: CapturedAlert[]) =>
  notifications.filter((entry) =>
    entry.title.includes('organization library storage'),
  )

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.USAGE_ALERT_APPROACH_PCT
  jest.clearAllMocks()
  mockHosts = []
  mockOrgs = []
})

describe('the media-storage alert sees the org library (AGL-1473)', () => {
  it('warns an org that is over its allowance PURELY in the org library', async () => {
    // Every site counter at zero. Before this fix the alert computed 0 MB
    // used, while the next org DAM upload would be refused at the cap.
    mockOrgs = [
      { id: 'org-1', plan: 'starter', orgLibraryBytes: BAND_MB * MB },
    ]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: 0 }]
    expect(mediaAlerts(await run())).toHaveLength(1)
  })

  it('adds the library to the sites rather than replacing them', async () => {
    // Neither figure crosses 80% alone (half the band each); together they are
    // the whole band. A fix that overwrote `mediaBytes` instead of adding
    // would pass the test above and fail this one.
    mockOrgs = [
      { id: 'org-1', plan: 'starter', orgLibraryBytes: (BAND_MB / 2) * MB },
    ]
    mockHosts = [
      { id: 'site-a', orgId: 'org-1', mediaBytes: (BAND_MB / 2) * MB },
    ]
    expect(mediaAlerts(await run())).toHaveLength(1)
  })

  it('leaves a quiet org quiet — no alert invented by the extra read', async () => {
    mockOrgs = [{ id: 'org-1', plan: 'starter', orgLibraryBytes: 1024 }]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: 1024 }]
    expect(mediaAlerts(await run())).toHaveLength(0)
  })

  it('leaves a host-only org’s alert exactly where it was', async () => {
    // The regression that would cost money elsewhere in this issue: nothing
    // about a site's own library may change. An org with no library counter at
    // all must behave as it always did, on both sides of the threshold.
    mockOrgs = [{ id: 'org-1', plan: 'starter', orgLibraryBytes: 0 }]
    mockHosts = [
      { id: 'site-a', orgId: 'org-1', mediaBytes: Math.round(0.5 * BAND_MB * MB) },
    ]
    expect(mediaAlerts(await run())).toHaveLength(0)

    mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: BAND_MB * MB }]
    expect(mediaAlerts(await run())).toHaveLength(1)
  })
})

/**
 * The org library is warnable AT ALL (AGL-1886).
 *
 * AGL-1473's suite above passes on `starter`, and that is exactly why the
 * defect survived it: starter's `hostLimit` is 1, so the org-wide band
 * (`hostLimit x storagePerHostMb`) and the per-scope cap the uploader enforces
 * are the SAME NUMBER, and any org-library overage crosses both at once. Give
 * the org a second site and the two numbers part company — the org library can
 * be full, refusing uploads, and read as a third of the band it is compared
 * against.
 *
 * That is a guard that could not fail, on a plan where it could never be
 * asked. These cases ask it on `pro`.
 *
 * Zach's condition on billing these bytes from today was, verbatim: "also give
 * overage protection and usage alerts, so customers don't get a surprise
 * bill." An alert that is structurally unable to fire is not an alert.
 */
describe('the org library is warnable on its own (AGL-1886)', () => {
  /** Pro: 3 sites x 10240 MB. The org-wide band is 30720 MB. */
  const PRO_SCOPE_MB = 10240
  const PRO_BAND_MB = 3 * PRO_SCOPE_MB

  it('warns an org whose library is full while the org-wide band is a third used', async () => {
    // The bytes: 10240 MB in the org library, nothing on either site. The
    // uploader refuses the next org DAM upload — `storagePerHostMb` is the
    // scope's cap and this scope is at it.
    mockOrgs = [{ id: 'org-1', plan: 'pro', orgLibraryBytes: PRO_SCOPE_MB * MB }]
    mockHosts = [
      { id: 'site-a', orgId: 'org-1', mediaBytes: 0 },
      { id: 'site-b', orgId: 'org-1', mediaBytes: 0 },
    ]
    const notifications = await run()
    // The org-wide check is SILENT and correct to be: 10240 of 30720 is 33%.
    // Forced red by deleting the `orgLibraryStorage` check: this line still
    // passed and the next one failed, which is the shape of the whole bug.
    expect(mediaAlerts(notifications)).toHaveLength(0)
    expect(10240 / PRO_BAND_MB).toBeLessThan(0.8)
    // The library check fires, at the cap.
    expect(libraryAlerts(notifications)).toHaveLength(1)
    // Pro METERS storage, so past the band the product keeps working and
    // starts charging (2026-08-18). The alert has to say that — "you've
    // reached your limit" would describe a wall that no longer exists, and
    // would omit the only thing the customer needs to know.
    expect(libraryAlerts(notifications)[0].title).toContain('now billed')
    expect(libraryAlerts(notifications)[0].body).toContain(
      'billed on your monthly invoice',
    )
    // And it names both ways out, because the cap is the customer's control.
    expect(libraryAlerts(notifications)[0].body).toContain('monthly cap')
    expect(libraryAlerts(notifications)[0].body).toContain('upgrade')
  })

  it('CONTROL: a plan that hard-bands is still told to upgrade, not billed at', () => {
    // The other side of the same branch, and the reason it is a branch. Free
    // never bills for storage — its band is a wall — so telling a free org
    // that extra storage "is billed on your monthly invoice" would be a
    // surprise bill invented by a notification. Forced red by dropping the
    // `check.billsOverage` ternary: free got the metered wording.
    //
    // Free's `hostLimit` is 1, so both storage checks cross together here.
    // That collapse is what makes free useless for testing WHICH band is
    // read — but it is irrelevant to WHAT THE ALERT SAYS, which is all this
    // case asks.
    return (async () => {
      mockOrgs = [{ id: 'org-1', plan: 'free', orgLibraryBytes: 250 * MB }]
      mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: 0 }]
      const notifications = await run()
      const library = libraryAlerts(notifications)
      expect(library).toHaveLength(1)
      expect(library[0].title).toContain('reached')
      expect(library[0].title).not.toContain('billed')
      expect(library[0].body).toContain('upgrade in Billing to raise the limit')
      expect(library[0].body).not.toContain('invoice')
    })()
  })

  it('warns on the approach, before the money and before the refusal', async () => {
    // 85% of the scope cap: uploads still succeed, nothing is refused yet, and
    // this is the last stretch in which a customer can act for free.
    mockOrgs = [
      {
        id: 'org-1',
        plan: 'pro',
        orgLibraryBytes: Math.round(0.85 * PRO_SCOPE_MB * MB),
      },
    ]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: 0 }]
    const notifications = await run()
    expect(libraryAlerts(notifications)).toHaveLength(1)
    expect(libraryAlerts(notifications)[0].title).toContain('above 80%')
  })

  it('stays quiet below the approach threshold', async () => {
    mockOrgs = [
      {
        id: 'org-1',
        plan: 'pro',
        orgLibraryBytes: Math.round(0.79 * PRO_SCOPE_MB * MB),
      },
    ]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: 0 }]
    expect(libraryAlerts(await run())).toHaveLength(0)
  })

  it('honours a configured approach percentage', async () => {
    // `USAGE_ALERT_APPROACH_PCT` moves the warning; the same 79% that was
    // silent above must speak at 70. Forced red by hard-coding 0.8 back into
    // the loop.
    process.env.USAGE_ALERT_APPROACH_PCT = '70'
    mockOrgs = [
      {
        id: 'org-1',
        plan: 'pro',
        orgLibraryBytes: Math.round(0.79 * PRO_SCOPE_MB * MB),
      },
    ]
    mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: 0 }]
    const notifications = await run()
    expect(libraryAlerts(notifications)).toHaveLength(1)
    expect(libraryAlerts(notifications)[0].title).toContain('above 70%')
  })

  it('falls back to 80 rather than going silent on a malformed percentage', async () => {
    // The failure mode that matters: a typo in an env var must not disable the
    // warning. `''`, `'yes'` and `'0'` each used to be candidates for a
    // threshold of zero (alert always) or NaN (alert never).
    for (const bad of ['yes', '0', '-10', '100', '']) {
      process.env.USAGE_ALERT_APPROACH_PCT = bad
      mockOrgs = [
        {
          id: 'org-1',
          plan: 'pro',
          orgLibraryBytes: Math.round(0.85 * PRO_SCOPE_MB * MB),
        },
      ]
      mockHosts = [{ id: 'site-a', orgId: 'org-1', mediaBytes: 0 }]
      const notifications = await run()
      expect(libraryAlerts(notifications)).toHaveLength(1)
      expect(libraryAlerts(notifications)[0].title).toContain('above 80%')
    }
  })

  it('leaves a host-only org untouched by the new check', async () => {
    // Nothing about a site's own library moves. An org with no library at all
    // gets neither alert, whatever its sites hold, until the org-wide band
    // itself is crossed.
    mockOrgs = [{ id: 'org-1', plan: 'pro', orgLibraryBytes: 0 }]
    mockHosts = [
      { id: 'site-a', orgId: 'org-1', mediaBytes: PRO_SCOPE_MB * MB },
      { id: 'site-b', orgId: 'org-1', mediaBytes: 0 },
    ]
    const notifications = await run()
    expect(libraryAlerts(notifications)).toHaveLength(0)
    expect(mediaAlerts(notifications)).toHaveLength(0)
  })
})
