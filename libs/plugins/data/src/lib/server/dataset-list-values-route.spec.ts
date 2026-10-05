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
 * The console's record writes store a list as a list (AGL-3496).
 *
 * `/api/orgs/datasets` is where the record form's create and the CSV/JSON
 * import land. A JSON import hands a list cell over as its JSON text; split on
 * commas it was stored as `["[\"Residential\"", "\"Commercial\"]"]`, and
 * the EDR services grid's `categories contains Residential` filter matched
 * nothing. The firestore below is the write-scope suite's, so what is asserted
 * is the row the route actually wrote.
 */

const mockVerifyIdToken = jest.fn()

/** The caller's member document in org-1. */
let mockMember: Record<string, unknown>
/** The dataset under test, as stored. */
let mockDataset: Record<string, unknown>
/** Records created under it. */
let mockRecords: Array<Record<string, unknown>>

const mockRecordsCollection = () => ({
  count: () => ({
    get: async () => ({ data: () => ({ count: mockRecords.length }) }),
  }),
  doc: () => ({
    create: async (data: Record<string, unknown>) => {
      mockRecords.push(data)
    },
  }),
})

const mockFirestore = {
  // Writes buffered and applied on commit, as every suite over this route
  // models it — a refused transaction must not leave its row behind.
  runTransaction: async (body: (tx: any) => Promise<any>) => {
    const buffered: Array<() => Promise<unknown>> = []
    const result = await body({
      get: async (target: any) => target.get(),
      create: (ref: any, payload: unknown) => {
        buffered.push(() => ref.create(payload))
      },
    })
    for (const write of buffered) await write()
    return result
  },
  collection: () => ({
    doc: () => ({
      get: async () => ({ exists: true, data: () => ({ plan: 'pro' }) }),
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => mockDataset }),
          collection: () => mockRecordsCollection(),
        }),
      }),
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockFirestore,
    }),
  },
  // The byte band never blocks: its own suite is
  // `dataset-storage-quota-enforced.spec.ts`.
  dataStorageRefusal: async () => null,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  isServerReleaseFlagOnForOrg: async () => true,
  lockdownRefusal: async () => null,
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: mockMember }),
  memberHasOrgPermission: async (
    _orgId: string,
    subject: unknown,
    permission: string,
  ) =>
    Boolean(
      (
        jest.requireActual('@aglyn/aglyn/app-utils/org-permissions') as {
          resolveOrgPermissions: (member: unknown) => Record<string, boolean>
        }
      ).resolveOrgPermissions(subject)[permission],
    ),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => '__now__' },
}))

// Which live pages a write makes stale is its own suite's
// (`dataset-live-pages.spec.ts`); this one reads only the row written.
jest.mock('./announce-dataset-records', () => ({
  announceDatasetRecords: async () => undefined,
}))

import { datasetsHandler } from './datasets-route'

const POST = (body: Record<string, unknown>) =>
  datasetsHandler(
    new Request('https://app.aglyn.com/api/orgs/datasets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ orgId: 'org-1', datasetId: 'ds-1', ...body }),
    }),
    { params: {} },
  )

beforeEach(() => {
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  mockMember = { role: 'owner' }
  mockDataset = {
    displayName: 'Services',
    visibleTo: ['org'],
    model: {
      order: ['name', 'categories'],
      fields: {
        name: { name: 'Name', type: 'text' },
        categories: { name: 'Categories', type: 'sorted' },
      },
    },
  }
  mockRecords = []
})

const LISTS = [
  ['a JSON array, as a JSON import sends it', '["Residential","Commercial"]'],
  ['a comma list, as the form sends it', 'Residential, Commercial'],
  ['a real array', ['Residential', ' Commercial ', '']],
] as const

describe.each(LISTS)('a list written as %s', (_label, categories) => {
  it('is stored as the list by the record form create', async () => {
    const response = await POST({
      action: 'create-record',
      values: { name: 'Roofing', categories },
    })
    expect(response.status).toBe(200)
    expect(mockRecords).toHaveLength(1)
    expect((mockRecords[0]['values'] as Record<string, unknown>)['categories']).toEqual([
      'Residential',
      'Commercial',
    ])
  })

  it('is stored as the list by the import', async () => {
    const response = await POST({
      action: 'import-records',
      records: [{ values: { name: 'Roofing', categories } }],
    })
    expect(response.status).toBe(200)
    expect(mockRecords).toHaveLength(1)
    expect((mockRecords[0]['values'] as Record<string, unknown>)['categories']).toEqual([
      'Residential',
      'Commercial',
    ])
  })
})

it('refuses a list field given something that is not a list, and writes nothing', async () => {
  const response = await POST({
    action: 'create-record',
    values: { name: 'Roofing', categories: 7 },
  })
  expect(response.status).toBe(400)
  expect(mockRecords).toEqual([])
})
