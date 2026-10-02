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
 * `/api/media/storage` (AGL-3470): the band the media library's toolbar
 * states, answered by the same `resolveOrgMediaBand` the upload gate reads.
 *
 * Driven through the REAL band resolver and the REAL plan entitlements over a
 * fake Firestore, so what is asserted is the number an upload would be refused
 * at — not a mock agreeing with itself. No plan figure is written here: every
 * cap is derived from `PLAN_ENTITLEMENTS`.
 */

import {
  PLAN_ENTITLEMENTS,
  planMetersInfraOverage,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

const mockResolveMediaScope = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'u1', email_verified: true }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({}, { status: 403 }),
  isImpersonationSession: () => false,
}))
jest.mock('../utils/server/media-scope', () => ({
  resolveMediaScope: (...args: unknown[]) => mockResolveMediaScope(...args),
}))

import { GET } from '../app/api/media/storage/route'

const MB = 1024 * 1024

/** `counters/media.bytes` by library path. */
let counters: Record<string, number> = {}
let getAllCalls = 0

function fakeFirestore(): any {
  const doc = (path: string): any => ({
    path,
    collection: (name: string) => collection(`${path}/${name}`),
  })
  const collection = (prefix: string): any => ({
    doc: (id: string) => doc(`${prefix}/${id}`),
  })
  return {
    collection,
    getAll: async (...refs: Array<{ path: string }>) => {
      getAllCalls += 1
      return refs.map((ref) => ({
        get: (field: string) =>
          field === 'bytes'
            ? counters[ref.path.replace(/\/counters\/media$/, '')]
            : undefined,
      }))
    },
  }
}

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

function scopeOf(collection: 'hosts' | 'orgs', org: Record<string, unknown>) {
  const scopeId = collection === 'hosts' ? 'host-1' : 'org-1'
  return {
    scope: {
      collection,
      scopeId,
      orgId: 'org-1',
      scopeRef: { firestore: fakeFirestore() },
      billing: org,
    },
  }
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
  }
  getAllCalls = 0
  mockResolveMediaScope.mockReset()
  delete process.env['BILL_ORG_LIBRARY_STORAGE_FROM']
})

describe('GET /api/media/storage (AGL-3470)', () => {
  it('has the plans it reasons about', () => {
    expect(HARD).toBeDefined()
    expect(METERED).toBeDefined()
  })

  it('answers the pooled band and this library’s share of one read', async () => {
    const org = orgOn(HARD)
    mockResolveMediaScope.mockResolvedValue(scopeOf('hosts', org))
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
    // The ingress routes' own resolver, with the query it was sent.
    expect(mockResolveMediaScope.mock.calls[0][1]).toEqual({ hostId: 'host-1' })
  })

  it('reports the org library’s share when the org library is open', async () => {
    mockResolveMediaScope.mockResolvedValue(scopeOf('orgs', orgOn(HARD)))
    const payload = await (await get('orgId=org-1')).json()
    expect(payload.usedBytes).toBe(40 * MB)
    expect(payload.scopeBytes).toBe(6 * MB)
  })

  it('marks a metered site library as billed past the band, not refused', async () => {
    const org = orgOn(METERED)
    mockResolveMediaScope.mockResolvedValue(scopeOf('hosts', org))
    const payload = await (await get()).json()
    expect(payload.allowanceMb).toBe(pooledBandMb(org))
    expect(payload.hardBand).toBe(false)
  })

  it('marks the org library a hard band while its storage is not invoiced', async () => {
    // `mediaStorageGate` refuses past the band there (AGL-2003); the
    // console's pre-check must know to.
    mockResolveMediaScope.mockResolvedValue(scopeOf('orgs', orgOn(METERED)))
    const payload = await (await get('orgId=org-1')).json()
    expect(payload.hardBand).toBe(true)
  })

  it('says unlimited without quoting Infinity, and reads no counters', async () => {
    const org = orgOn(METERED, {
      entitlements: { storagePerHostMb: Number.POSITIVE_INFINITY },
    })
    mockResolveMediaScope.mockResolvedValue(scopeOf('hosts', org))
    const payload = await (await get()).json()
    expect(payload.unlimited).toBe(true)
    expect(payload.allowanceMb).toBeNull()
    expect(getAllCalls).toBe(0)
  })

  it('passes the scope resolver’s refusal through, 423 body included', async () => {
    mockResolveMediaScope.mockResolvedValue({
      error: {
        status: 423,
        message: 'Locked: maintenance',
        response: Response.json({ locked: true }, { status: 423 }),
      },
    })
    const response = await get()
    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ locked: true })

    mockResolveMediaScope.mockResolvedValue({
      error: { status: 403, message: 'Not a site admin' },
    })
    expect((await get()).status).toBe(403)
  })

  it('has no pool to read for a site with no organization', async () => {
    mockResolveMediaScope.mockResolvedValue({
      scope: { ...scopeOf('hosts', orgOn(HARD)).scope, orgId: '' },
    })
    expect((await get()).status).toBe(404)
    expect(getAllCalls).toBe(0)
  })

  it('refuses anything but a GET, and an unsigned request', async () => {
    expect((await get('hostId=host-1', 'POST')).status).toBe(405)
    const unsigned = await GET(
      new Request('http://localhost/api/media/storage?hostId=host-1'),
    )
    expect(unsigned.status).toBe(401)
    expect(mockResolveMediaScope).not.toHaveBeenCalled()
  })
})
