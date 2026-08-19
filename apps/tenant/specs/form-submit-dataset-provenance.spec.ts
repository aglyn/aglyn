/**
 * @jest-environment node
 *
 * The pragma must stay in the FIRST block comment: behind the license
 * header jest silently ignores it and this runs on jsdom, where `Request`
 * is not a constructor and every case fails for the wrong reason.
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
 * AGL-2168 — where a submission WENT.
 *
 * `/product/forms`'s hero mockup shows the Inbox detail pane carrying
 * `Added to "Leads" dataset` under the fields. The route appended the
 * record and threw the reference away, so the Inbox could not have said it
 * if it wanted to.
 *
 * The interesting half is the negative one. The dataset block swallows two
 * failures on purpose — a deleted dataset and a full `recordsPerDataset`
 * quota — so a submission is never lost to either. A chip claiming a row
 * in those cases would be worse than the silence it replaced, so "no
 * record, no stamp" is asserted as hard as the happy path.
 */

const HOST_ID = 'site-1'

type Increment = { __increment: number }
const mockIsIncrement = (value: unknown): value is Increment =>
  typeof value === 'object' && value !== null && '__increment' in (value as any)

let mockStore: Record<string, Record<string, any>> = {}
/** Every `add` to a dataset's `records` subcollection. */
let mockDatasetRecords: Record<string, any>[] = []
/** Patches applied to the submission document after it was created. */
let mockSubmissionUpdates: Record<string, any>[] = []
/** What `resolveDatasetDoc` hands back, swapped per case. */
let mockDataset: any = null
/** Existing records in the dataset, for the quota check. */
let mockRecordCount = 0

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string) => ({
  get: async () => {
    const data = mockStore[path]
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    const base = options?.merge ? (mockStore[path] ?? {}) : {}
    const next: Record<string, any> = { ...base }
    for (const [key, value] of Object.entries(patch)) {
      next[key] = mockIsIncrement(value)
        ? Number(next[key] ?? 0) + value.__increment
        : value
    }
    mockStore[path] = next
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string): any => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    if (!path.endsWith('formSubmissions')) {
      throw new Error(`unexpected add to ${path}`)
    }
    // The route calls `.update()` on what `add` returns. A fake returning a
    // bare `{ id }` would throw a TypeError inside the route's own
    // try/catch and be indistinguishable from "no stamp was written" —
    // a false GREEN on the assertion this file exists for.
    return {
      id: 'submission-1',
      update: async (patch: Record<string, any>) => {
        mockSubmissionUpdates.push(patch)
      },
    }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => mockCollectionHandle(name),
      }),
    }),
  },
  consumeRateLimit: async () => ({
    allowed: true,
    limit: 10,
    remaining: 9,
    resetMs: Date.now() + 30_000,
    degraded: false,
  }),
  getOrgForHost: async () => ({ org: { plan: 'business' } }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () => mockCollectionHandle('orgs/org-1/datasets'),
  upsertHostContact: async () => undefined,
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: async () => ({ alerts: [] }),
  resolveDatasetDoc: async () => mockDataset,
}))

import { POST } from '../app/api/forms/submit/route'

/** A dataset document the route will accept and append to. */
const datasetDoc = (overrides: Record<string, any> = {}) => {
  const fields: Record<string, any> = {
    // `displayName` is what the console writes; `fields` is a list of
    // column NAMES (v1 shape), not objects — modelling it as objects
    // yields zero values and a silently skipped append.
    displayName: 'Leads',
    model: null,
    fields: ['email', 'message'],
    ...overrides,
  }
  return {
    id: 'dataset-1',
    exists: true,
    get: (key: string) => fields[key],
    ref: {
      collection: () => ({
        add: async (data: Record<string, any>) => {
          mockDatasetRecords.push(data)
          return { id: 'record-1' }
        },
        count: () => ({
          get: async () => ({ data: () => ({ count: mockRecordCount }) }),
        }),
      }),
    },
  }
}

const submit = (body: Record<string, unknown> = {}) =>
  POST(
    new Request('https://site.example/api/forms/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify({
        hostId: HOST_ID,
        formName: 'Contact',
        path: '/contact',
        fields: { email: 'visitor@example.com', message: 'hello' },
        datasetId: 'dataset-1',
        fieldMap: { email: 'email', message: 'message' },
        ...body,
      }),
    }),
  ) as Promise<Response>

beforeEach(() => {
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockDatasetRecords = []
  mockSubmissionUpdates = []
  mockRecordCount = 0
  mockDataset = datasetDoc()
})

describe('AGL-2168 · dataset provenance on a submission', () => {
  it('records the dataset and the record it created', async () => {
    const response = await submit()
    expect(response.status).toBe(200)
    expect(mockDatasetRecords).toHaveLength(1)
    expect(mockSubmissionUpdates).toHaveLength(1)
    expect(mockSubmissionUpdates[0].routing.dataset).toEqual({
      id: 'dataset-1',
      name: 'Leads',
      recordId: 'record-1',
    })
  })

  it('stamps NOTHING when the form has no dataset bound', async () => {
    // The control. A route that stamped unconditionally would pass the case
    // above and put a chip on every submission in the database.
    const response = await submit({ datasetId: '', dataset: '' })
    expect(response.status).toBe(200)
    expect(mockDatasetRecords).toHaveLength(0)
    expect(mockSubmissionUpdates).toHaveLength(0)
  })

  it('stamps nothing when the bound dataset no longer exists', async () => {
    // Deleting a dataset must not start failing a live form, and it must
    // not start lying about one either.
    mockDataset = null
    const response = await submit()
    expect(response.status).toBe(200)
    expect(mockDatasetRecords).toHaveLength(0)
    expect(mockSubmissionUpdates).toHaveLength(0)
  })

  it('stamps nothing when the dataset was soft-deleted', async () => {
    mockDataset = datasetDoc({ deletedAt: 'yesterday' })
    const response = await submit()
    expect(response.status).toBe(200)
    expect(mockDatasetRecords).toHaveLength(0)
    expect(mockSubmissionUpdates).toHaveLength(0)
  })

  it('stamps nothing when the record quota refused the append', async () => {
    // Business allows 100,000 records per dataset; a full one drops the
    // append silently so the lead is still captured in the Inbox.
    mockRecordCount = 10_000_000
    const response = await submit()
    expect(response.status).toBe(200)
    expect(mockDatasetRecords).toHaveLength(0)
    expect(mockSubmissionUpdates).toHaveLength(0)
  })

  it('still accepts the submission when the dataset write throws', async () => {
    // Fail-soft is the decided posture: a broken binding must never cost a
    // customer a lead.
    mockDataset = {
      ...datasetDoc(),
      ref: {
        collection: () => ({
          add: async () => {
            throw new Error('boom')
          },
          count: () => ({
            get: async () => ({ data: () => ({ count: 0 }) }),
          }),
        }),
      },
    }
    const response = await submit()
    expect(response.status).toBe(200)
    expect(mockSubmissionUpdates).toHaveLength(0)
  })
})
