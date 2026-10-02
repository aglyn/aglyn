/**
 * @jest-environment node
 */

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
 */

/**
 * `/api/media/storage` (AGL-3470): the band the media library's toolbar, the
 * Billing meter and the quota banner state, answered by the same
 * `resolveOrgMediaBand` the upload gate reads.
 *
 * Driven through the REAL band resolver and the REAL plan entitlements over a
 * fake Firestore, so what is asserted is the number an upload would be refused
 * at — not a mock agreeing with itself. No plan figure is written here: every
 * cap is derived from `PLAN_ENTITLEMENTS`.
 *
 * It is a READ (AGL-3482): any member of the library's org or site may ask,
 * viewers included, and a read-only lock lets it through. The lockdown double
 * below decides with the REAL pure verdict helpers, so "a read-only lock
 * passes a read" is the platform's rule, not this file's.
 */

import {
  PLAN_ENTITLEMENTS,
  planMetersInfraOverage,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  lockdownBlocks,
  lockdownIntentForMethod,
  normalizeHostLockdown,
  normalizeOrgLockdown,
  resolveLockdown,
} from '@aglyn/aglyn/app-utils/lockdown'

const MB = 1024 * 1024

/** `counters/media.bytes` by library path. */
let counters: Record<string, number> = {}
let getAllCalls = 0
/** Every library path a `getAll` was asked for — what the pool READ. */
let pooledPaths: string[] = []
/** `orgs/{id}` docs, and who is a member of each, by role. */
let mockOrgs: Record<string, Record<string, unknown>> = {}
let mockMembers: Record<string, Record<string, string>> = {}
/** `hosts/{id}` docs: the owning org (the index mirror) and `memberRoles`. */
let mockHosts: Record<string, { orgId: string | null; data: Record<string, unknown> }> = {}
let mockUid = 'u1'

function mockFirestore(): any {
  const doc = (path: string): any => ({
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => {
      const [kind, id] = path.split('/')
      const host = kind === 'hosts' ? mockHosts[id] : undefined
      return {
        exists: Boolean(host),
        get: (field: string) => host?.data[field],
        data: () => host?.data,
      }
    },
  })
  const collection = (prefix: string): any => ({
    doc: (id: string) => doc(`${prefix}/${id}`),
  })
  return {
    collection,
    getAll: async (...refs: Array<{ path: string }>) => {
      getAllCalls += 1
      return refs.map((ref) => {
        const library = ref.path.replace(/\/counters\/media$/, '')
        pooledPaths.push(library)
        return {
          get: (field: string) => (field === 'bytes' ? counters[library] : undefined),
        }
      })
    },
  }
}

/**
 * The verdict, decided by the platform's own pure helpers over the docs the
 * route hands it: the intent the route declares or its method implies, and
 * the lock the org and site carry.
 */
const mockLockdownRefusal = jest.fn(
  async (options: {
    request?: { method?: string }
    intent?: 'read' | 'write'
    staff?: boolean
    org?: Record<string, unknown>
    host?: Record<string, unknown>
  }) => {
    if (options.staff === true) return null
    const intent =
      options.intent ??
      (options.request ? lockdownIntentForMethod(options.request.method) : 'write')
    const state = resolveLockdown(
      {
        org: normalizeOrgLockdown(options.org as never),
        host: normalizeHostLockdown(options.host as never),
      },
      Date.now(),
    )
    return lockdownBlocks(state, intent)
      ? Response.json({ error: 'locked', scope: state?.scope }, { status: 423 })
      : null
  },
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: mockUid, email_verified: true }),
      }),
      firestore: () => mockFirestore(),
    }),
  },
  emailUnverifiedResponse: () => Response.json({}, { status: 403 }),
  isImpersonationSession: () => false,
  resolveOrgMembership: async (uid: string, orgId: string) => {
    const role = mockMembers[orgId]?.[uid]
    return role ? { orgId, member: { $id: uid, role } } : null
  },
  getOrgDoc: async (orgId: string) => mockOrgs[orgId] ?? null,
  getOrgForHost: async (hostId: string) => {
    const orgId = mockHosts[hostId]?.orgId
    return orgId && mockOrgs[orgId] ? { orgId, org: mockOrgs[orgId] } : null
  },
  lockdownRefusal: (options: any) => mockLockdownRefusal(options),
}))

import { GET } from '../app/api/media/storage/route'

type PlanKey = keyof typeof PLAN_ENTITLEMENTS
const PLANS = Object.keys(PLAN_ENTITLEMENTS) as PlanKey[]
const orgOn = (plan: PlanKey, extra: Record<string, unknown> = {}) => ({
  plan,
  subscription: { status: 'active' },
  hosts: { 'host-1': true, 'host-2': true },
  ...extra,
})
const pooledBandMb = (org: any) => {
  const resolved = resolveOrgEntitlements(org)
  return Math.max(1, resolved.hostLimit) * resolved.storagePerHostMb
}
const HARD = PLANS.find((plan) => !planMetersInfraOverage(orgOn(plan) as any)) as PlanKey
const METERED = PLANS.find(
  (plan) =>
    planMetersInfraOverage(orgOn(plan) as any) &&
    resolveOrgEntitlements(orgOn(plan) as any).hostLimit > 1,
) as PlanKey

/** Seeds org-1 (with host-1 and host-2) on `org`, and its people by role. */
function seed(
  org: Record<string, unknown>,
  options: {
    orgRoles?: Record<string, string>
    hostRoles?: Record<string, string>
    host?: Record<string, unknown>
  } = {},
) {
  mockOrgs['org-1'] = org
  mockMembers['org-1'] = options.orgRoles ?? { u1: 'admin' }
  mockHosts['host-1'] = {
    orgId: 'org-1',
    data: { memberRoles: options.hostRoles ?? { u1: 'admin' }, ...options.host },
  }
  mockHosts['host-2'] = { orgId: 'org-1', data: { memberRoles: {} } }
}

const get = (query = 'hostId=host-1', method = 'GET') =>
  GET(
    new Request(`http://localhost/api/media/storage?${query}`, {
      method,
      headers: { authorization: 'Bearer token' },
    }),
  )

beforeEach(() => {
  counters = {
    'hosts/host-1': 4 * MB,
    'hosts/host-2': 30 * MB,
    'orgs/org-1': 6 * MB,
    // Another workspace's library, which no answer here may include.
    'orgs/org-2': 900 * MB,
    'hosts/host-9': 900 * MB,
  }
  getAllCalls = 0
  pooledPaths = []
  mockUid = 'u1'
  mockOrgs = {}
  mockMembers = {}
  mockHosts = {}
  mockLockdownRefusal.mockClear()
  delete process.env['BILL_ORG_LIBRARY_STORAGE_FROM']
})

describe('GET /api/media/storage (AGL-3470)', () => {
  it('has the plans it reasons about', () => {
    expect(HARD).toBeDefined()
    expect(METERED).toBeDefined()
  })

  it('answers the pooled band and this library’s share of one read', async () => {
    const org = orgOn(HARD)
    seed(org)
    const response = await get()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      allowanceMb: pooledBandMb(org),
      unlimited: false,
      // Every site's library plus the org's shared one.
      usedBytes: 40 * MB,
      scopeBytes: 4 * MB,
      hardBand: true,
    })
    expect(getAllCalls).toBe(1)
    // One org's figures, never held by a shared cache.
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('reports the org library’s share when the org library is open', async () => {
    seed(orgOn(HARD))
    const payload = await (await get('orgId=org-1')).json()
    expect(payload.usedBytes).toBe(40 * MB)
    expect(payload.scopeBytes).toBe(6 * MB)
  })

  it('marks a metered site library as billed past the band, not refused', async () => {
    const org = orgOn(METERED)
    seed(org)
    const payload = await (await get()).json()
    expect(payload.allowanceMb).toBe(pooledBandMb(org))
    expect(payload.hardBand).toBe(false)
  })

  it('marks the org library a hard band while its storage is not invoiced', async () => {
    // `mediaStorageGate` refuses past the band there (AGL-2003); the
    // console's pre-check must know to.
    seed(orgOn(METERED))
    const payload = await (await get('orgId=org-1')).json()
    expect(payload.hardBand).toBe(true)
  })

  it('says unlimited without quoting Infinity, and reads no counters', async () => {
    seed(
      orgOn(METERED, {
        entitlements: { storagePerHostMb: Number.POSITIVE_INFINITY },
      }),
    )
    const payload = await (await get()).json()
    expect(payload.unlimited).toBe(true)
    expect(payload.allowanceMb).toBeNull()
    expect(getAllCalls).toBe(0)
  })

  it('has no pool to read for a site with no organization', async () => {
    seed(orgOn(HARD))
    mockHosts['host-1'].orgId = null
    expect((await get()).status).toBe(404)
    expect(getAllCalls).toBe(0)
  })

  it('refuses anything but a GET, an unsigned request, and no library', async () => {
    seed(orgOn(HARD))
    expect((await get('hostId=host-1', 'POST')).status).toBe(405)
    const unsigned = await GET(
      new Request('http://localhost/api/media/storage?hostId=host-1'),
    )
    expect(unsigned.status).toBe(401)
    expect((await get('')).status).toBe(400)
    expect((await get('hostId=nowhere')).status).toBe(404)
    expect(getAllCalls).toBe(0)
  })
})

describe('any member may read the band, and only their own org’s (AGL-3482)', () => {
  it('answers an org viewer on the org library — the Billing meter’s read', async () => {
    const org = orgOn(METERED)
    seed(org, { orgRoles: { u1: 'viewer' } })
    const response = await get('orgId=org-1')
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.allowanceMb).toBe(pooledBandMb(org))
    expect(payload.usedBytes).toBe(40 * MB)
  })

  it('answers a site viewer on the site library — the banner’s read', async () => {
    seed(orgOn(HARD), { hostRoles: { u1: 'viewer' } })
    const response = await get()
    expect(response.status).toBe(200)
    expect((await response.json()).usedBytes).toBe(40 * MB)
  })

  it('refuses someone who is not a member of the org it names', async () => {
    // A member of ANOTHER workspace, naming this one.
    seed(orgOn(HARD), { orgRoles: { u2: 'owner' } })
    mockMembers['org-2'] = { u1: 'owner' }
    const response = await get('orgId=org-1')
    expect(response.status).toBe(403)
    expect(JSON.stringify(await response.json())).not.toMatch(/\d{6,}/)
    expect(getAllCalls).toBe(0)
  })

  it('refuses someone who is not on the site it names', async () => {
    // An org member who was never added to this site has no `memberRoles`
    // entry; the rules refuse them the site's counters too.
    seed(orgOn(HARD), { orgRoles: { u1: 'admin' }, hostRoles: { u2: 'admin' } })
    expect((await get()).status).toBe(403)
    expect(getAllCalls).toBe(0)
  })

  it('reads the pool of the SITE’s org, never one the request names', async () => {
    // Member of host-1 (org-1) and owner of org-2. Naming host-1 must read
    // org-1's libraries and nothing of org-2's.
    seed(orgOn(HARD), { hostRoles: { u1: 'viewer' } })
    mockOrgs['org-2'] = orgOn(HARD, { hosts: { 'host-9': true } })
    mockMembers['org-2'] = { u1: 'owner' }
    const payload = await (await get('hostId=host-1')).json()
    expect(payload.usedBytes).toBe(40 * MB)
    expect(pooledPaths).toContain('orgs/org-1')
    expect(pooledPaths).not.toContain('orgs/org-2')
    expect(pooledPaths).not.toContain('hosts/host-9')
  })

  it('answers for the org alone when both are named, as ingress does', async () => {
    // A site member who is not in org-2 cannot borrow host-1 to read it.
    seed(orgOn(HARD), { hostRoles: { u1: 'admin' } })
    mockOrgs['org-2'] = orgOn(HARD, { hosts: { 'host-9': true } })
    mockMembers['org-2'] = { u2: 'owner' }
    expect((await get('orgId=org-2&hostId=host-1')).status).toBe(403)
    expect(getAllCalls).toBe(0)
  })
})

describe('a read-only lock does not hide the band (AGL-3482)', () => {
  const lockedAt = () => Date.now() - 60_000

  it('answers under a read-only org lock, on both scopes', async () => {
    seed(
      orgOn(HARD, { suspendedAt: lockedAt(), suspendedMode: 'read-only' }),
      { orgRoles: { u1: 'viewer' }, hostRoles: { u1: 'viewer' } },
    )
    expect((await get('orgId=org-1')).status).toBe(200)
    expect((await get('hostId=host-1')).status).toBe(200)
    // Asked as what it is: the verdict sees the GET.
    for (const [options] of mockLockdownRefusal.mock.calls) {
      expect(options.request?.method).toBe('GET')
      expect(options.intent).toBeUndefined()
    }
  })

  it('answers under a read-only lock on the site', async () => {
    seed(orgOn(HARD), {
      host: { suspendedAt: lockedAt(), suspendedMode: 'read-only' },
    })
    expect((await get()).status).toBe(200)
  })

  it('CONTROL: a full lock still refuses it, with the 423 body', async () => {
    seed(orgOn(HARD, { suspendedAt: lockedAt() }))
    const response = await get('orgId=org-1')
    expect(response.status).toBe(423)
    expect(await response.json()).toMatchObject({ error: 'locked', scope: 'org' })
    expect(getAllCalls).toBe(0)

    seed(orgOn(HARD), { host: { suspendedAt: lockedAt() } })
    expect((await get()).status).toBe(423)
    expect(getAllCalls).toBe(0)
  })
})
