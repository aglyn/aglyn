/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-2253 — a public form writing into a dataset meets `dataStorageMbPerOrg`.
 *
 * The form → dataset leg checked `recordsPerDataset` and never the BYTE band.
 * It is the one dataset-writing path a VISITOR drives — nobody with an
 * account, nobody the org can throttle — so it is the path where the volume is
 * least the customer's to control, and it was the one writing past a band the
 * console route hard-blocks at.
 *
 * ## The refusal here is a DROP, not an error
 *
 * The submission still lands in the inbox and still returns 200; only the
 * dataset row and its `routing.dataset` stamp are skipped — exactly what
 * already happens when `recordsPerDataset` is full. A lost lead is the worse
 * error, and AGL-2168 wrote that rule down. So every case below asserts BOTH:
 * the submission succeeded AND the row was or was not written.
 *
 * ## Both halves
 *
 * A suite that only showed the drop would pass against a route that never
 * writes a dataset row at all — which is precisely how this leg could
 * regress, since the whole block is inside a swallowing try/catch. So the
 * metered plan writing its row leads, and it asserts the read count too: a
 * paying customer must not pay a Firestore read per submission for a verdict
 * their price list already determines.
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
/** The owning org's billing doc, swapped per case. */
let mockOrg: Record<string, any> = { plan: 'business' }
/** Reads of `orgs/org-1/usage/{month}` — the storage gate's only read. */
let mockUsageReads = 0

const MONTH = new Date().toISOString().slice(0, 7)

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string) => ({
  get: async () => {
    if (path === `orgs/org-1/usage/${MONTH}`) mockUsageReads += 1
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
  // The attribution seam the route resolves once per submission. Recorded
  // rather than executed — `campaign-conversion-attribution.spec.ts` owns
  // what the write does — and defined here at all because a mocked module
  // answers `undefined` for a name it does not list, which would make the
  // route throw rather than fail an assertion.
  resolveCampaignTouch: async () => null,
  attributeCampaignConversion: async () => null,
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
  // The REAL storage gate. A wholesale mock of this module is a CLOSED
  // WORLD — `dataStorageRefusal` would be `undefined`, the route's own
  // try/catch would swallow the TypeError, and "no row was written" would
  // read as the cap working. That false green is the whole hazard.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/data-storage-gate',
  ),
  // `orgId` matters here: the gate resolves `orgs/{orgId}` from it, and the
  // sibling provenance suite omits it — which is why that suite could not
  // have seen this leg at all.
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
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
  mockUsageReads = 0
  mockDataset = datasetDoc()
  mockOrg = { plan: 'business', subscription: { status: 'active' } }
})

/**
 * An org whose data store is a STAFF OVERRIDE on a plan that meters nothing —
 * the only shape the byte band can refuse. Rows are granted generously so no
 * refusal below can be `recordsPerDataset` in disguise.
 */
const overriddenOrg = (entitlements: Record<string, unknown>) => ({
  plan: 'free',
  entitlements: {
    features: { dataStore: true },
    recordsPerDataset: 1_000,
    ...entitlements,
  },
})

describe('NEGATIVE CONTROL: a metered plan writes its row and pays no read', () => {
  it('appends the record and stamps the provenance', async () => {
    mockStore[`orgs/org-1/usage/${MONTH}`] = { dataStorageMb: 10_000_000 }
    const response = await submit()
    expect(response.status).toBe(200)
    expect(mockDatasetRecords).toHaveLength(1)
    expect(mockSubmissionUpdates).toHaveLength(1)
    // `dataStorageEnforcementShape` exists so this is free: a plan whose
    // answer its own price list determines must not pay a read per
    // submission to be told so.
    expect(mockUsageReads).toBe(0)
  })
})

describe('the byte band drops the row and keeps the submission', () => {
  it('a ZERO band with no overage rate: no row, no stamp, still 200', async () => {
    mockOrg = overriddenOrg({ dataStorageMbPerOrg: 0 })
    const response = await submit()
    expect(response.status).toBe(200)
    // THE LEAD IS NOT LOST. This is the half that makes the drop acceptable.
    expect(mockSubmissionUpdates).toHaveLength(0)
    expect(mockDatasetRecords).toHaveLength(0)
    // Refused without a measurement, so without a read.
    expect(mockUsageReads).toBe(0)
  })

  it('MEASURES a finite band and pins both sides of it', async () => {
    mockOrg = overriddenOrg({ dataStorageMbPerOrg: 100 })

    mockStore[`orgs/org-1/usage/${MONTH}`] = { dataStorageMb: 40 }
    expect((await submit()).status).toBe(200)
    expect(mockDatasetRecords).toHaveLength(1)
    expect(mockUsageReads).toBe(1)

    mockStore[`orgs/org-1/usage/${MONTH}`] = { dataStorageMb: 100 }
    expect((await submit()).status).toBe(200)
    // Still one — the second submission wrote no row.
    expect(mockDatasetRecords).toHaveLength(1)
  })

  it('the ROW quota still refuses on its own, so the two are independent', async () => {
    // Bytes wide open, rows full. Without this, "no record was written" in
    // the cases above could be either gate and the suite would not know.
    mockOrg = overriddenOrg({
      dataStorageMbPerOrg: 1_000_000,
      recordsPerDataset: 2,
    })
    mockStore[`orgs/org-1/usage/${MONTH}`] = { dataStorageMb: 0 }
    mockRecordCount = 2
    expect((await submit()).status).toBe(200)
    expect(mockDatasetRecords).toHaveLength(0)
  })
})
