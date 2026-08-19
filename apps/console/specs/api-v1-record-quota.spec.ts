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
 * AGL-2253 — `POST /v1/datasets/{id}/records` meets `recordsPerDataset` and
 * `dataStorageMbPerOrg`.
 *
 * It met neither. The handler counted rows only to compute `order` and then
 * created: the console route enforces both on the same write and the tenant
 * form path enforces the rows half, so `/v1` was the one door into
 * `orgs/{id}/datasets/{id}/records` with no cap on it. A customer could blow,
 * through the documented REST API, a limit the UI refuses.
 *
 * AGL-2163's own note is why this happened: it wired
 * `checkDataStorageQuota().allowed` into `/api/orgs/datasets` and defined the
 * measurement INSIDE that route file, so the next writer could not reach it.
 * The verdict now lives in `dataStorageRefusal`; only the wording is per
 * caller.
 *
 * ## What each case has to prove
 *
 * A cap suite that only shows a refusal is satisfied by a route that refuses
 * everything — and on this route that is the likely regression, because the
 * plans that can reach `/v1` at all are exactly the ones that must never be
 * blocked. So the negative control leads: **a metered plan a hundredfold past
 * its band is still created, and pays no read to find that out.** Every
 * refusal case then pins its own pair — the last permitted row lands, the next
 * is refused.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
let mockOrg: Record<string, unknown> = { plan: 'business' }
/** Reads of `orgs/{id}/usage/{month}`, so "costs nothing" is measured. */
let mockUsageReads = 0
let mockUidSeq = 0

const mockMonth = new Date().toISOString().slice(0, 7)

function mockDocRef(path: string) {
  const id = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    id,
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => {
      if (path === `orgs/org-1/usage/${mockMonth}`) mockUsageReads += 1
      return {
        id,
        exists: mockDocs.has(path),
        data: () => mockDocs.get(path),
        get: (field: string) => mockDocs.get(path)?.[field],
      }
    },
    create: async (data: Record<string, unknown>) => {
      // `create` is not an upsert. Modelled, so a double-write cannot read as
      // a silent overwrite and the idempotency primitive keeps working.
      if (mockDocs.has(path)) throw new Error('ALREADY_EXISTS')
      mockDocs.set(path, { ...data })
    },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, {
        ...(options?.merge ? (mockDocs.get(path) ?? {}) : {}),
        ...data,
      })
    },
    update: async (data: Record<string, unknown>) => {
      mockDocs.set(path, { ...(mockDocs.get(path) ?? {}), ...data })
    },
    delete: async () => {
      mockDocs.delete(path)
    },
  }
}

/** Immediate children of a collection path — not grandchildren. */
function mockChildPaths(collectionPath: string): string[] {
  const prefix = `${collectionPath}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function mockCollectionRef(path: string) {
  return {
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
    count: () => ({
      get: async () => ({
        data: () => ({ count: mockChildPaths(path).length }),
      }),
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
    // The REAL storage gate. A wholesale mock of this module is a CLOSED
    // WORLD — a stub here would let the suite pass against a route that
    // enforced nothing, which is the defect under repair.
    ...jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/data-storage-gate',
    ),
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: ['datasets:read', 'datasets:write'],
    }),
    getOrgDoc: async () => mockOrg,
    lockdownRefusal: async () => null,
    // The per-minute limiter is not under test; always allow, with the real
    // header shape, so no refusal below can be it in disguise.
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
        FieldValue: { increment: (n: number) => n, serverTimestamp: () => 'NOW' },
      },
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL idempotency claim and the REAL plan table. Stubbing the plan
  // table would make every assertion below a statement about the stub.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  checkEntitlement: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ).checkEntitlement,
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_model: unknown, values: Record<string, unknown>) =>
    values,
  validateDocument: () => ({}),
  createResourceUid: () => `rec_${++mockUidSeq}`,
}))

jest.mock('firebase-admin/firestore', () => {
  // A CLASS, not an object literal: `serialize` narrows with
  // `value instanceof Timestamp`, and a plain object there throws
  // "Right-hand side of 'instanceof' is not callable" — which the route's
  // outer handler turns into a 500 that looks exactly like a refusal working.
  class MockTimestamp {
    // A plain field, not a parameter property: babel-plugin-jest-hoist reads
    // the constructor parameter name as an out-of-scope reference and refuses
    // the whole factory.
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

import { POST } from '../app/api/v1/[[...route]]/route'
import {
  dataStorageEnforcementShape,
  PLAN_ENTITLEMENTS,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

const postRecord = (idempotencyKey?: string) =>
  POST(
    new Request('https://app.aglyn.com/api/v1/datasets/ds-1/records', {
      method: 'POST',
      headers: {
        authorization: 'Bearer k',
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ values: { a: 1 } }),
    }),
    { params: Promise.resolve({ route: ['datasets', 'ds-1', 'records'] }) },
  )

/** `n` existing rows in `ds-1`. */
const seedRecords = (n: number) => {
  for (let index = 0; index < n; index += 1) {
    mockDocs.set(`orgs/org-1/datasets/ds-1/records/seed-${index}`, { order: index })
  }
}

const recordCount = () =>
  mockChildPaths('orgs/org-1/datasets/ds-1/records').length

/**
 * An org whose API access and data store are STAFF OVERRIDES on a plan that
 * meters neither — the only shape that can reach `/v1` and still be refused,
 * and therefore the only shape either cap can be observed through.
 */
const overriddenOrg = (entitlements: Record<string, unknown>) => ({
  plan: 'free',
  entitlements: {
    features: { apiAccess: true, dataStore: true },
    apiRequestsPerMonth: 1_000_000,
    // Both caps are granted GENEROUSLY by default and each block below
    // narrows only the one it is about. Free's own bands are 0 for rows AND
    // 0 for bytes, so an org that overrode neither would be refused by
    // whichever gate ran first — and every "refused" assertion would be true
    // for the wrong reason, which is the failure this suite exists to avoid.
    recordsPerDataset: 1_000,
    dataStorageMbPerOrg: 1_000_000,
    ...entitlements,
  },
})

beforeEach(() => {
  mockDocs.clear()
  mockUsageReads = 0
  mockUidSeq = 0
  mockOrg = { plan: 'business', subscription: { status: 'active' } }
  mockDocs.set('orgs/org-1/datasets/ds-1', { displayName: 'Leads' })
})

describe('the premise', () => {
  it('business meters both dimensions, so neither cap may ever refuse it', () => {
    expect(PLAN_ENTITLEMENTS.business.features.apiAccess).toBe(true)
    expect(PLAN_ENTITLEMENTS.business.recordsPerDataset).toBe(100_000)
    expect(dataStorageEnforcementShape({ plan: 'business' } as never)).toBe(
      'never-blocks',
    )
  })
})

describe('NEGATIVE CONTROL: a paying customer is never refused, and pays no read', () => {
  it('creates the record with dataset storage far past the included band', async () => {
    mockDocs.set(`orgs/org-1/usage/${mockMonth}`, { dataStorageMb: 10_000_000 })
    const response = await postRecord()
    expect(response.status).toBe(201)
    expect(recordCount()).toBe(1)
    // The whole reason `dataStorageEnforcementShape` exists: a plan whose
    // answer is determined by its price list must not pay a Firestore read
    // per record write to be told so.
    expect(mockUsageReads).toBe(0)
  })

  it('creates the 100,000th row and would create the next', async () => {
    // Not seeded to 100k — that would be 100k map entries. The point is that
    // business's band is far above anything this suite writes, so no refusal
    // below can be business's own cap wearing a different coat.
    seedRecords(50)
    expect((await postRecord()).status).toBe(201)
    expect(recordCount()).toBe(51)
  })
})

describe('recordsPerDataset (the rows half)', () => {
  beforeEach(() => {
    mockOrg = overriddenOrg({ recordsPerDataset: 3 })
  })

  it('creates the LAST row inside the band', async () => {
    seedRecords(2)
    const response = await postRecord()
    expect(response.status).toBe(201)
    expect(recordCount()).toBe(3)
  })

  it('refuses the NEXT one and writes nothing', async () => {
    seedRecords(3)
    const response = await postRecord()
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.code).toBe('record_quota')
    expect(String(body.error.message)).toContain('3')
    // Refused AND unwritten. "402 with the row created anyway" is the same
    // defect with a status code in front of it.
    expect(recordCount()).toBe(3)
  })

  it('does not BURN the idempotency key on a refusal', async () => {
    // `createDataset` states the rule and this is the same one: a plan
    // refusal is the most retried failure there is, so the retry that finally
    // should succeed must not replay the refusal forever.
    seedRecords(3)
    expect((await postRecord('k-1')).status).toBe(403)
    // The band is raised, as buying an add-on would raise it…
    mockOrg = overriddenOrg({ recordsPerDataset: 10 })
    const retried = await postRecord('k-1')
    expect(retried.status).toBe(201)
    expect(recordCount()).toBe(4)
  })
})

describe('dataStorageMbPerOrg (the bytes half)', () => {
  it('refuses when the band is ZERO and the plan meters nothing', async () => {
    // `dataStorageMbPerOrg` is 0 on free and free carries no
    // `extraDataGbMonthlyUsd`, so the shape is `always-blocks` — refused
    // without a measurement, and therefore without a read.
    mockOrg = overriddenOrg({ dataStorageMbPerOrg: 0 })
    expect(dataStorageEnforcementShape(mockOrg as never)).toBe('always-blocks')
    const response = await postRecord()
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('data_storage_quota')
    expect(recordCount()).toBe(0)
    expect(mockUsageReads).toBe(0)
  })

  it('MEASURES a finite non-zero band, and pins both sides of it', async () => {
    // The one shape that needs the read: a staff `dataStorageMbPerOrg` on a
    // plan with no overage rate. Rows are granted generously so the refusal
    // below can only be the bytes.
    mockOrg = overriddenOrg({
      dataStorageMbPerOrg: 100,
      recordsPerDataset: 1_000,
    })
    expect(dataStorageEnforcementShape(mockOrg as never)).toBe('measure')

    mockDocs.set(`orgs/org-1/usage/${mockMonth}`, { dataStorageMb: 40 })
    expect((await postRecord()).status).toBe(201)
    expect(recordCount()).toBe(1)
    expect(mockUsageReads).toBe(1)

    mockDocs.set(`orgs/org-1/usage/${mockMonth}`, { dataStorageMb: 100 })
    const refused = await postRecord()
    expect(refused.status).toBe(403)
    expect((await refused.json()).error.code).toBe('data_storage_quota')
    expect(recordCount()).toBe(1)
  })

  it('the refusal is the BYTES, not the rows sitting beside it', async () => {
    // Without this the case above passes against a route that only ever
    // checks `recordsPerDataset` — the two caps refuse with different codes
    // and only one of them is under test here.
    mockOrg = overriddenOrg({
      dataStorageMbPerOrg: 100,
      recordsPerDataset: 1_000,
    })
    seedRecords(3) // far inside 1,000 rows
    mockDocs.set(`orgs/org-1/usage/${mockMonth}`, { dataStorageMb: 100_000 })
    const response = await postRecord()
    expect((await response.json()).error.code).toBe('data_storage_quota')
  })
})
