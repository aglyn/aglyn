/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * `checkDataStorageQuota(...).allowed` now REFUSES A WRITE (AGL-2163).
 *
 * The defect had the same shape as its API sibling: the field existed, its
 * docblock said "plans without one (free) hard-block at the included size",
 * `free-tier-never-billed.spec.ts` listed it among the free tier's runtime
 * braces — and the only call site in the platform was
 * `/api/billing/report-usage`, which reads `overageMonthlyUsd` and ignores
 * `allowed`. Nothing refused a byte.
 *
 * SO NOTHING HERE ASSERTS A RETURN VALUE. Every case drives the real
 * `/api/orgs/datasets` handler and asserts on the response status AND on
 * whether the record document actually exists afterwards — a refusal that
 * still wrote the row would be the same bug with a 403 painted on it.
 *
 * The reachable shape is an org that staff granted `features.dataStore` (and
 * rows) on a plan whose `dataStorageMbPerOrg` is still 0. `recordsPerDataset`
 * counts ROWS and says nothing about their size, so it was never this limit
 * and cannot stand in for it.
 */

const mockVerifyIdToken = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockLockdownRefusal = jest.fn()

/** The org document under test, and the record docs the route creates. */
let mockOrg: Record<string, unknown> = {}
let mockRecordDocs: Record<string, unknown> = {}
let mockRecordCount = 0
/** `orgs/{id}/usage/{month}.dataStorageMb`, the measured branch's input. */
let mockUsageDataStorageMb = 0
let mockUsageReads = 0

const recordsCollection = () => ({
  count: () => ({ get: async () => ({ data: () => ({ count: mockRecordCount }) }) }),
  doc: (id: string) => ({
    create: async (data: Record<string, unknown>) => {
      mockRecordDocs[id] = data
      return undefined
    },
  }),
})

const firestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      path: `${name}/${id}`,
      get: async () => ({ exists: true, data: () => mockOrg }),
      collection: (sub: string) => ({
        doc: (subId: string) => ({
          get: async () => {
            if (sub === 'usage') {
              mockUsageReads += 1
              return {
                exists: true,
                get: (field: string) =>
                  field === 'dataStorageMb' ? mockUsageDataStorageMb : undefined,
              }
            }
            // A dataset doc, with a model the values below satisfy.
            return {
              exists: true,
              data: () => ({
                displayName: 'People',
                fields: ['name'],
                model: { fields: [{ id: 'name', type: 'text', label: 'Name' }] },
              }),
              get: (field: string) => (field === 'id' ? subId : undefined),
            }
          },
          collection: () => recordsCollection(),
        }),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
      }),
    }),
  }),
  batch: () => {
    const writes: Array<() => void> = []
    return {
      create: (ref: { __id?: string }, data: Record<string, unknown>) =>
        writes.push(() => {
          mockRecordDocs[String(ref.__id ?? Object.keys(mockRecordDocs).length)] = data
        }),
      commit: async () => writes.forEach((write) => write()),
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...a: unknown[]) => mockVerifyIdToken(...a) }),
      firestore: () => firestore,
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  isServerReleaseFlagOnForOrg: async () => true,
  lockdownRefusal: (...a: unknown[]) => mockLockdownRefusal(...a),
  resolveOrgMembership: (...a: unknown[]) => mockResolveOrgMembership(...a),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => ({ toMillis: () => 0 }) },
}))

import { POST } from '../app/api/orgs/datasets/route'
import { checkDataStorageQuota, dataStorageEnforcementShape } from '@aglyn/aglyn/server'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/datasets', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )

const createRecord = () =>
  post({
    orgId: 'org-1',
    action: 'create-record',
    datasetId: 'ds_1',
    values: { name: 'Avery' },
  })

const importRecords = () =>
  post({
    orgId: 'org-1',
    action: 'import-records',
    datasetId: 'ds_1',
    records: [{ values: { name: 'Avery' } }, { values: { name: 'Blake' } }],
  })

/**
 * Free, with `dataStore` and a row allowance granted by staff — the exact
 * override the filing named as reaching this code. The BYTE band stays 0.
 */
const overriddenFreeOrg = (dataStorageMbPerOrg?: number) => ({
  plan: 'free',
  entitlements: {
    features: { dataStore: true },
    recordsPerDataset: 1_000,
    ...(dataStorageMbPerOrg === undefined ? {} : { dataStorageMbPerOrg }),
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockRecordDocs = {}
  mockRecordCount = 0
  mockUsageDataStorageMb = 0
  mockUsageReads = 0
  mockOrg = { plan: 'starter' }
  mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
  mockResolveOrgMembership.mockResolvedValue({ member: { role: 'admin' } })
  mockLockdownRefusal.mockResolvedValue(null)
})

describe('the dataset record write enforces the storage quota (AGL-2163)', () => {
  it('THE NEGATIVE CONTROL: a metered plan stays allowed and writes the record', async () => {
    // Starter carries `extraDataGbMonthlyUsd: 0.25`, so overage BILLS.
    // A terabyte past a 1 GB band and the record is still created — refusing
    // a paying customer here would be a worse bug than the one being fixed.
    mockUsageDataStorageMb = 1_000_000
    expect(checkDataStorageQuota({ plan: 'starter' } as never, 1_000_000).allowed).toBe(true)
    const response = await createRecord()
    expect(response.status).toBe(200)
    expect(Object.keys(mockRecordDocs)).toHaveLength(1)
    // …and it cost them no read: the plan already determines the answer.
    expect(mockUsageReads).toBe(0)
    expect(dataStorageEnforcementShape({ plan: 'starter' } as never)).toBe(
      'never-blocks',
    )
  })

  it('THE BRANCH: dataStore granted with a ZERO byte band refuses the write', async () => {
    mockOrg = overriddenFreeOrg()
    const response = await createRecord()
    expect(response.status).toBe(403)
    // The row must not exist. A 403 that still wrote it would leave the byte
    // in the database and the customer told it was rejected.
    expect(Object.keys(mockRecordDocs)).toHaveLength(0)
    expect(mockUsageReads).toBe(0) // no band can be satisfied; nothing to read
  })

  it('THE BRANCH, on IMPORT — the path that moves the most bytes at once', async () => {
    mockOrg = overriddenFreeOrg()
    const response = await importRecords()
    expect(response.status).toBe(403)
    expect(Object.keys(mockRecordDocs)).toHaveLength(0)
  })

  it('a granted FINITE band is measured, and refuses only past it', async () => {
    mockOrg = overriddenFreeOrg(500)
    expect(dataStorageEnforcementShape(overriddenFreeOrg(500) as never)).toBe(
      'measure',
    )

    mockUsageDataStorageMb = 499
    expect((await createRecord()).status).toBe(200)
    expect(Object.keys(mockRecordDocs)).toHaveLength(1)
    expect(mockUsageReads).toBe(1)

    mockUsageDataStorageMb = 500
    const refused = await createRecord()
    expect(refused.status).toBe(403)
    expect(Object.keys(mockRecordDocs)).toHaveLength(1) // still just the first
  })

  it('the refusal is the STORAGE quota, not the row quota it sits beside', async () => {
    // `recordsPerDataset` refuses with its own 403, so without this the
    // assertions above could be green for the wrong reason. Same org, same
    // row allowance, plenty of rows left — only the byte band differs.
    mockOrg = overriddenFreeOrg(500)
    mockRecordCount = 3 // far inside the granted 1,000 rows
    mockUsageDataStorageMb = 0
    expect((await createRecord()).status).toBe(200)
    mockUsageDataStorageMb = 10_000
    const refused = await createRecord()
    expect(refused.status).toBe(403)
    expect(String((await refused.json()).error)).toContain('storage')
  })
})
