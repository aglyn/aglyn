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
 * `update-record` and `delete-record` on `/api/orgs/datasets` (AGL-3668): the
 * Data card's record edit and delete, for the native apps. An edit is coerced
 * and validated against the model and carries the integrity and filter index;
 * a delete honours `restrict` (refused, nothing written) and `setNull` (the
 * holders stripped first), over the datasets the caller can see.
 */

const mockVerifyIdToken = jest.fn()
const mockAnnounce = jest.fn(async () => ({ ok: true }))

let mockMember: Record<string, unknown>
/** Every dataset in org-1: its stored doc and its records by id. */
let mockDatasets: Record<string, { data: Record<string, unknown>; records: Record<string, Record<string, unknown>> }>
/** What the route wrote, in order. */
let mockWrites: Array<{ op: string; path: string; data?: Record<string, unknown> }>

const recordRef = (datasetId: string, id: string) => ({
  id,
  path: `orgs/org-1/datasets/${datasetId}/records/${id}`,
  get: async () => ({ exists: Boolean(mockDatasets[datasetId]?.records[id]), data: () => mockDatasets[datasetId]?.records[id] }),
  update: async (data: Record<string, unknown>) => {
    mockWrites.push({ op: 'update', path: `orgs/org-1/datasets/${datasetId}/records/${id}`, data })
  },
  delete: async () => {
    mockWrites.push({ op: 'delete', path: `orgs/org-1/datasets/${datasetId}/records/${id}` })
    delete mockDatasets[datasetId].records[id]
  },
})

const recordsCollection = (datasetId: string) => ({
  doc: (id: string) => recordRef(datasetId, id),
  count: () => ({ get: async () => ({ data: () => ({ count: Object.keys(mockDatasets[datasetId]?.records ?? {}).length }) }) }),
  where: (field: string, _op: string, value: string) => ({
    get: async () => ({
      docs: Object.entries(mockDatasets[datasetId]?.records ?? {})
        .filter(([, record]) => ((record[field] as string[] | undefined) ?? []).includes(value))
        .map(([id, record]) => ({ id, ref: recordRef(datasetId, id), get: (key: string) => record[key] })),
    }),
  }),
})

const datasetRef = (datasetId: string) => ({
  id: datasetId,
  get: async () => ({ exists: Boolean(mockDatasets[datasetId]), data: () => mockDatasets[datasetId]?.data }),
  collection: () => recordsCollection(datasetId),
})

const mockFirestore = {
  batch: () => {
    const pending: Array<() => Promise<unknown>> = []
    return {
      update: (ref: { update: (data: Record<string, unknown>) => Promise<unknown> }, data: Record<string, unknown>) => {
        pending.push(() => ref.update(data))
      },
      commit: async () => {
        for (const write of pending) await write()
      },
    }
  },
  collection: () => ({
    doc: () => ({
      get: async () => ({ exists: true, data: () => ({ plan: 'pro' }) }),
      collection: () => ({
        doc: (datasetId: string) => datasetRef(datasetId),
        get: async () => ({
          docs: Object.keys(mockDatasets).map((datasetId) => ({
            id: datasetId,
            ref: datasetRef(datasetId),
            data: () => mockDatasets[datasetId].data,
          })),
        }),
      }),
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => mockFirestore,
    }),
  },
  dataStorageRefusal: async () => null,
  emailUnverifiedResponse: () => Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  isServerReleaseFlagOnForOrg: async () => true,
  lockdownRefusal: async () => null,
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: mockMember }),
  memberHasOrgPermission: async () => true,
}))

jest.mock('./announce-dataset-records', () => ({
  __esModule: true,
  announceDatasetRecords: (...args: unknown[]) => mockAnnounce(...(args as [])),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => '__now__' },
  FieldValue: { delete: () => '__delete__' },
  FieldPath: { documentId: () => '__name__' },
}))

import { datasetsHandler } from './datasets-route'

const call = (body: Record<string, unknown>) =>
  datasetsHandler(
    new Request('https://app.aglyn.com/api/orgs/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
    { params: {} },
  )

const customers = () => ({
  data: {
    displayName: 'Customers',
    visibleTo: ['org'],
    model: {
      order: ['name', 'vip', 'visits'],
      fields: {
        name: { name: 'Name', type: 'text', required: true },
        vip: { name: 'VIP', type: 'bool' },
        visits: { name: 'Visits', type: 'int32' },
      },
    },
  },
  records: { c1: { values: { name: 'Avery' } }, c2: { values: { name: 'Blake' } } } as Record<string, Record<string, unknown>>,
})

const orders = (onDelete: 'restrict' | 'setNull', visibleTo = ['org']) => ({
  data: {
    displayName: 'Orders',
    visibleTo,
    model: {
      order: ['title', 'customer'],
      fields: {
        title: { name: 'Title', type: 'text' },
        customer: { name: 'Customer', type: 'reference', reference: { datasetId: 'customers', onDelete } },
      },
    },
  },
  records: {
    o1: { values: { title: 'First', customer: 'c1' }, referencedIds: ['c1'] },
    o2: { values: { title: 'Second', customer: 'c2' }, referencedIds: ['c2'] },
  } as Record<string, Record<string, unknown>>,
})

beforeEach(() => {
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  mockMember = { role: 'owner' }
  mockDatasets = { customers: customers(), orders: orders('setNull') }
  mockWrites = []
  mockAnnounce.mockClear()
})

describe('update-record', () => {
  it('replaces the values, coerced, with the filter and integrity index beside them', async () => {
    const response = await call({ action: 'update-record', datasetId: 'customers', recordId: 'c1', values: { name: ' Avery Jones ', vip: 'true', visits: '7' } })

    expect(response.status).toBe(200)
    const [write] = mockWrites
    expect(write.op).toBe('update')
    expect(write.path).toBe('orgs/org-1/datasets/customers/records/c1')
    expect(write.data?.values).toEqual({ name: ' Avery Jones ', vip: true, visits: 7 })
    expect(write.data?.filterValues).toEqual({ name: 'avery jones', vip: true, visits: 7 })
    expect(write.data?.filterKeys).toEqual(expect.arrayContaining(['s:avery', 'f:name^jones']))
    // Nothing referenced: the index field is cleared, not left stale.
    expect(write.data?.referencedIds).toBe('__delete__')
    expect(write.data?.updatedAt).toBe('__now__')
    expect(mockAnnounce).toHaveBeenCalledTimes(1)
  })

  it('answers the field errors and writes nothing for an invalid record', async () => {
    const response = await call({ action: 'update-record', datasetId: 'customers', recordId: 'c1', values: { visits: 'many' } })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(Object.keys(body.errors).sort()).toEqual(['name', 'visits'])
    expect(mockWrites).toEqual([])
  })

  it('refuses a record that does not exist', async () => {
    const response = await call({ action: 'update-record', datasetId: 'customers', recordId: 'nope', values: { name: 'X' } })
    expect(response.status).toBe(404)
    expect(mockWrites).toEqual([])
  })

  it('refuses a dataset the caller cannot see, as a create is', async () => {
    mockMember = { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'editor' } }
    mockDatasets.customers.data.visibleTo = ['host:host-b']
    const response = await call({ action: 'update-record', datasetId: 'customers', recordId: 'c1', values: { name: 'X' } })
    expect(response.status).toBe(404)
    expect(mockWrites).toEqual([])
  })
})

describe('delete-record', () => {
  it('strips a setNull reference from its holder, then deletes', async () => {
    const response = await call({ action: 'delete-record', datasetId: 'customers', recordId: 'c1' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ ok: true, fixed: 1 }))
    expect(mockWrites.map((write) => [write.op, write.path])).toEqual([
      ['update', 'orgs/org-1/datasets/orders/records/o1'],
      ['delete', 'orgs/org-1/datasets/customers/records/c1'],
    ])
    expect(mockWrites[0].data?.values).toEqual({ title: 'First' })
    expect(mockWrites[0].data?.referencedIds).toBe('__delete__')
    // Both datasets' pages are told.
    expect(mockAnnounce).toHaveBeenCalledTimes(2)
  })

  it('refuses under restrict and writes nothing', async () => {
    mockDatasets.orders = orders('restrict')
    const response = await call({ action: 'delete-record', datasetId: 'customers', recordId: 'c1' })

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('Cannot delete: referenced by 1 document in "Orders"')
    expect(mockWrites).toEqual([])
    expect(mockDatasets.customers.records.c1).toBeDefined()
  })

  it('deletes a record nothing references without touching other datasets', async () => {
    mockDatasets.orders.records = {}
    const response = await call({ action: 'delete-record', datasetId: 'customers', recordId: 'c2' })
    expect(response.status).toBe(200)
    expect(mockWrites.map((write) => write.op)).toEqual(['delete'])
  })

  it('consults only the datasets the caller can see, as the card does', async () => {
    mockMember = { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'editor' } }
    mockDatasets.orders = orders('restrict', ['host:host-b'])
    const response = await call({ action: 'delete-record', datasetId: 'customers', recordId: 'c1' })
    expect(response.status).toBe(200)
    expect(mockWrites.map((write) => write.op)).toEqual(['delete'])
  })
})
