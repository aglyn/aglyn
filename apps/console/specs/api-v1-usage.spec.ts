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
 * AGL-2277 — `GET /v1/usage`, the meter an integration is billed on.
 *
 * The whole value of this endpoint is that it reports what the ENFORCEMENT
 * path will do. So the thing every case here has to defeat is a handler that
 * answers plausible constants: a `used` of 0, an `included` copied from a
 * table by hand, a `metered` hardcoded true. Each number is therefore seeded
 * to a distinct, arbitrary value and asserted exactly, and the bands come from
 * the REAL `check*Quota` helpers over the REAL plan table — so a second copy
 * of the rule in the handler would show up as a disagreement rather than as a
 * passing test about a stub.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
let mockOrg: Record<string, unknown> = { plan: 'business' }
let mockScopes: string[] = ['datasets:read']

const mockMonth = new Date().toISOString().slice(0, 7)

class MockIncrement {
  mockBy = 0
}
const mockIncrement = (by: number) => {
  const sentinel = new MockIncrement()
  sentinel.mockBy = by
  return sentinel
}

function mockResolveWrite(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    out[key] =
      value instanceof MockIncrement
        ? Number(existing?.[key] ?? 0) + value.mockBy
        : value
  }
  return out
}

/** Immediate children of a collection path — not grandchildren. */
function mockChildPaths(collectionPath: string): string[] {
  const prefix = `${collectionPath}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function mockDocRef(path: string) {
  const id = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    id,
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => ({
      id,
      exists: mockDocs.has(path),
      data: () => mockDocs.get(path),
      get: (field: string) => mockDocs.get(path)?.[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      const existing = mockDocs.get(path)
      mockDocs.set(path, {
        ...(options?.merge ? (existing ?? {}) : {}),
        ...mockResolveWrite(existing, data),
      })
    },
  }
}

function mockCollectionRef(path: string) {
  return {
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
    count: () => ({
      get: async () => ({ data: () => ({ count: mockChildPaths(path).length }) }),
    }),
  }
}

const mockFirestore = { collection: (name: string) => mockCollectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => {
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: mockScopes,
    }),
    getOrgDoc: async () => mockOrg,
    lockdownRefusal: async () => null,
    consumeRateLimit: async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetMs: Date.now() + 60_000,
      degraded: false,
    }),
    firebaseAdmin: {
      app: () => ({ firestore: () => mockFirestore }),
      firestore: {
        FieldValue: {
          increment: (n: number) => mockIncrement(n),
          serverTimestamp: () => 'NOW',
        },
      },
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table and the REAL quota helpers. Stubbing them would make
  // every band below a statement about the stub, and "the endpoint agrees with
  // the enforcement path" is the entire claim under test.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/contacts'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  // The CRM collection names (AGL-2606): the usage object reports the size
  // of each, so the handler reads them on every call.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/crm'),
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_m: unknown, v: Record<string, unknown>) => v,
  validateDocument: () => ({}),
  createResourceUid: () => 'uid_1',
}))

jest.mock('firebase-admin/firestore', () => {
  class MockTimestamp {
    mockMs = 0
    toDate() {
      return new Date(this.mockMs)
    }
    toMillis() {
      return this.mockMs
    }
    static now() {
      return new MockTimestamp()
    }
    static fromMillis(mockMillis: number) {
      const stamp = new MockTimestamp()
      stamp.mockMs = mockMillis
      return stamp
    }
  }
  return {
    __esModule: true,
    FieldPath: { documentId: () => '__name__' },
    Timestamp: MockTimestamp,
  }
})

import { GET, POST } from '../app/api/v1/[[...route]]/route'
import {
  checkApiRequestQuota,
  checkContactQuota,
  checkDataStorageQuota,
  PLAN_ENTITLEMENTS,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

const usageRequest = (method = 'GET') =>
  new Request('https://app.aglyn.com/api/v1/usage', {
    method,
    headers: { authorization: 'Bearer k' },
  })

const routeContext = { params: Promise.resolve({ route: ['usage'] }) }

const getUsage = async () => {
  const response = await GET(usageRequest(), routeContext)
  return { status: response.status, body: await response.json() }
}

/** `n` documents in an org subcollection, so `count()` answers `n`. */
const seedCollection = (name: string, n: number) => {
  for (let index = 0; index < n; index += 1) {
    mockDocs.set(`orgs/org-1/${name}/seed-${index}`, { seeded: true })
  }
}

beforeEach(() => {
  mockDocs.clear()
  mockScopes = ['datasets:read']
  mockOrg = { plan: 'business', subscription: { status: 'active' } }
})

describe('every number is MEASURED, not a plausible constant', () => {
  it('reports the seeded counters exactly, and moves when they move', async () => {
    // Arbitrary, mutually distinct values: a handler returning any single
    // constant, or reading the wrong document, cannot satisfy all four.
    mockDocs.set(`orgs/org-1/apiUsage/${mockMonth}`, { count: 41 })
    mockDocs.set(`orgs/org-1/usage/${mockMonth}`, { dataStorageMb: 137 })
    seedCollection('contacts', 3)
    seedCollection('datasets', 2)

    const first = await getUsage()
    expect(first.status).toBe(200)
    expect(first.body.object).toBe('usage')
    expect(first.body.month).toBe(mockMonth)
    // 42, not 41: this request is itself metered before the handler reads the
    // counter, which is the point — the number reported is the LIVE document
    // the refusal path enforces from, not a separate tally.
    expect(first.body.apiRequests.used).toBe(42)
    expect(first.body.dataStorageMb.used).toBe(137)
    expect(first.body.contacts.used).toBe(3)
    expect(first.body.datasets.used).toBe(2)

    // Move every input to a different arbitrary value. A constant survives the
    // first case; nothing survives this one.
    mockDocs.set(`orgs/org-1/apiUsage/${mockMonth}`, { count: 900 })
    mockDocs.set(`orgs/org-1/usage/${mockMonth}`, { dataStorageMb: 4 })
    seedCollection('contacts', 11)
    seedCollection('datasets', 5)

    const second = await getUsage()
    expect(second.body.apiRequests.used).toBe(901)
    expect(second.body.dataStorageMb.used).toBe(4)
    expect(second.body.contacts.used).toBe(11)
    expect(second.body.datasets.used).toBe(5)
  })

  it('reads the SAME apiUsage document the quota refuses from', async () => {
    // Not a separate tally that could drift: seed a month already past a
    // hand-overridden band and check the endpoint's own arithmetic matches
    // `checkApiRequestQuota`, which is what `refuseIfApiQuotaExhausted` calls.
    mockOrg = {
      plan: 'business',
      entitlements: { apiRequestsPerMonth: 50 },
    }
    mockDocs.set(`orgs/org-1/apiUsage/${mockMonth}`, { count: 30 })
    const { body } = await getUsage()
    const expected = checkApiRequestQuota(mockOrg as never, 31)
    expect(body.apiRequests.used).toBe(expected.used)
    expect(body.apiRequests.included).toBe(expected.included)
    expect(body.apiRequests.remaining).toBe(expected.remaining)
  })
})

describe('remaining is pinned on both sides of a band', () => {
  beforeEach(() => {
    mockOrg = { plan: 'business', entitlements: { contactsPerHost: 5 } }
  })

  it('counts down inside the band', async () => {
    seedCollection('contacts', 2)
    expect((await getUsage()).body.contacts).toMatchObject({
      used: 2,
      included: 5,
      remaining: 3,
    })
  })

  it('floors at zero past the band rather than going negative', async () => {
    seedCollection('contacts', 9)
    const { body } = await getUsage()
    expect(body.contacts).toMatchObject({ used: 9, included: 5, remaining: 0 })
    // And it agrees with the helper the enforcement path uses.
    expect(body.contacts.remaining).toBe(
      checkContactQuota(mockOrg as never, 9).remaining,
    )
  })
})

describe('`metered` says what happens when you cross the band', () => {
  it('is true where the plan carries an overage rate, false where it does not', async () => {
    // Business meters requests, contacts and storage; nothing meters dataset
    // slots, which are an add-on you buy rather than usage that bills.
    const { body } = await getUsage()
    expect(body.apiRequests.metered).toBe(true)
    expect(body.contacts.metered).toBe(true)
    expect(body.dataStorageMb.metered).toBe(true)
    expect(body.datasets.metered).toBe(false)
  })

  it('is false on a plan that hard-bands, which is what refuses the next call', async () => {
    // API access is a STAFF OVERRIDE on free — the one shape that reaches
    // /v1 on a plan that meters nothing. `apiRequestsPerMonth` is granted
    // generously so the request quota (free's band is 0) cannot refuse the
    // read before the bands under test are ever computed.
    mockOrg = {
      plan: 'free',
      entitlements: {
        features: { apiAccess: true },
        apiRequestsPerMonth: 1_000_000,
      },
    }
    const { body } = await getUsage()
    expect(body.contacts.metered).toBe(false)
    expect(body.dataStorageMb.metered).toBe(false)
    // The claim behind the field: `metered: false` and a full band is exactly
    // the state in which a write is refused.
    expect(checkContactQuota(mockOrg as never, body.contacts.included).allowed).toBe(
      false,
    )
  })
})

describe('an unlimited band is null, on purpose', () => {
  it('publishes null rather than letting Infinity become null by accident', async () => {
    expect(PLAN_ENTITLEMENTS.enterprise.contactsPerHost).toBe(
      Number.POSITIVE_INFINITY,
    )
    mockOrg = { plan: 'enterprise' }
    seedCollection('contacts', 7)
    const { body } = await getUsage()
    expect(body.contacts.used).toBe(7)
    expect(body.contacts.included).toBeNull()
    expect(body.contacts.remaining).toBeNull()
  })
})

describe('the datasets band is the EFFECTIVE limit, add-ons included', () => {
  it('reports the limit that would actually refuse a create', async () => {
    // `checkDatasetQuota` folds purchased add-ons into `limit`, and `limit` is
    // what `POST /v1/datasets` compares against. Publishing the plan's bare
    // `datasetsPerOrg` instead would tell a customer who bought slots that
    // they are full when they are not.
    mockOrg = {
      plan: 'business',
      entitlements: { datasetsPerOrg: 2, maxDatasetsPerOrg: 10 },
      // The field `resolvePurchasedAddons` actually reads. A test that named
      // it wrong would silently assert the un-bought limit.
      seatAddons: { datasets: 3 },
    }
    seedCollection('datasets', 4)
    const { body } = await getUsage()
    expect(body.datasets).toMatchObject({ used: 4, included: 5, remaining: 1 })
  })
})

describe('access', () => {
  it('needs no scope — a key scoped to anything can read its own meter', async () => {
    // Like `GET /v1/me`. Requiring a resource scope would mean a key scoped to
    // contacts could not see the request quota that refuses it.
    mockScopes = ['media:read']
    expect((await getUsage()).status).toBe(200)
    mockScopes = []
    expect((await getUsage()).status).toBe(200)
  })

  it('is still gated by the plan, like every other /v1 path', async () => {
    mockOrg = { plan: 'free' }
    const response = await GET(usageRequest(), routeContext)
    expect(response.status).toBe(403)
    expect((await response.json()).error.type).toBe('plan_required')
  })

  it('answers 405 with Allow: GET on a write, not 404', async () => {
    // The AGL-900 rule: a wrong METHOD on a path that plainly exists must not
    // read as "this path doesn't exist" and send an integrator hunting.
    const response = await POST(usageRequest('POST'), routeContext)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
  })
})

describe('the endpoint is itself metered', () => {
  it('bills like any other request — reading the meter is not free', async () => {
    mockDocs.set(`orgs/org-1/apiUsage/${mockMonth}`, { count: 10 })
    await getUsage()
    await getUsage()
    await new Promise((resolve) => setImmediate(resolve))
    // Two reads, two increments. A route that skipped `recordApiRequest` for
    // this path would give an integration a free polling loop on the surface
    // we bill by request.
    expect(mockDocs.get(`orgs/org-1/apiUsage/${mockMonth}`)?.count).toBe(12)
  })

  it('agrees with the storage figure billing prices from', async () => {
    mockDocs.set(`orgs/org-1/usage/${mockMonth}`, { dataStorageMb: 2_048 })
    const { body } = await getUsage()
    const expected = checkDataStorageQuota(mockOrg as never, 2_048)
    expect(body.dataStorageMb.used).toBe(expected.usedMb)
    expect(body.dataStorageMb.included).toBe(expected.includedMb)
    expect(body.dataStorageMb.remaining).toBe(expected.remainingMb)
  })
})
