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
/** Every `notifyOrgAdmins` call, as `{orgId, title}`. */
let mockNotifications: Array<{ orgId: string; title: string }>

const mockNotifyOrgAdmins = jest.fn(
  async (orgId: string, payload: { title: string }) => {
    mockNotifications.push({ orgId, title: payload.title })
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

const mediaAlerts = (notifications: Array<{ title: string }>) =>
  notifications.filter((entry) => entry.title.includes('media storage'))

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
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
