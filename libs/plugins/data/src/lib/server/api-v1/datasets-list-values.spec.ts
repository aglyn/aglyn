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
 * `/v1` record create and update store a list as a list (AGL-3496).
 *
 * An integrator's client that serialized a list field before sending it — a
 * JSON array as a string — had it split on commas into
 * `["[\"Residential\"", "\"Commercial\"]"]`. Both writes now coerce through the
 * one list coercion the console's writes use; asserted on the row the handler
 * actually wrote.
 */

/** Stored records by id. */
let mockRecords: Record<string, Record<string, unknown>>

const mockRecordRef = (id: string) => ({
  id,
  get: async () => ({
    id,
    exists: id in mockRecords,
    data: () => mockRecords[id],
    get: (field: string) => mockRecords[id]?.[field],
  }),
  create: async (data: Record<string, unknown>) => {
    mockRecords[id] = data
  },
  update: async (data: Record<string, unknown>) => {
    mockRecords[id] = { ...mockRecords[id], ...data }
  },
})

const mockDatasetRef = {
  get: async () => ({
    id: 'ds-1',
    exists: true,
    data: () => ({
      displayName: 'Services',
      model: {
        order: ['name', 'categories', 'related'],
        fields: {
          name: { name: 'Name', type: 'text' },
          categories: { name: 'Categories', type: 'sorted' },
          related: {
            name: 'Related',
            type: 'reference',
            reference: { datasetId: 'ds-2', multiple: true },
          },
        },
      },
    }),
  }),
  collection: () => ({
    count: () => ({
      get: async () => ({
        data: () => ({ count: Object.keys(mockRecords).length }),
      }),
    }),
    doc: (id: string) => mockRecordRef(id),
  }),
}

const mockFirestore = {
  collection: () => ({
    doc: () => ({
      collection: () => ({ doc: () => mockDatasetRef }),
    }),
  }),
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkDatasetQuota: () => ({ allowed: true }),
  checkEntitlement: () => ({ allowed: true }),
  checkQuota: () => ({ allowed: true, limit: Infinity }),
  createResourceUid: () => 'rec-new',
  defaultScopeForNewResource: () => ['org'],
  newResourceScopeFields: () => ({}),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const error = (status: number) => (options: Record<string, unknown>) =>
    Response.json(options, { status })
  return {
    __esModule: true,
    ApiErrors: {
      badRequest: error(400),
      notFound: error(404),
      methodNotAllowed: error(405),
      planRequired: error(402),
    },
    apiJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
    dataStorageRefusal: async () => null,
    listResponse: (data: unknown) => Response.json({ data }),
  }
})

jest.mock('@aglyn/tenant-data-admin/server/api-v1-kit', () => ({
  __esModule: true,
  claimWrite: async () => ({
    claim: { release: async () => undefined, record: async () => undefined },
  }),
  paginate: async () => ({ docs: [], nextCursor: null }),
  readJsonBody: (request: Request) => request.json(),
  requireScope: () => null,
  serialize: (value: unknown) => value,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { delete: () => '__delete__' },
  Timestamp: { now: () => '__now__' },
}))

// Neither is what this suite is about: live-page staleness and plugin field
// validators each have their own.
jest.mock('../announce-dataset-records', () => ({
  announceDatasetRecords: async () => undefined,
}))
jest.mock('../custom-field-types', () => ({
  loadCustomFieldTypes: async () => undefined,
}))

import { handleDatasets } from './datasets'

const ctx = {
  orgId: 'org-1',
  keyId: 'key-1',
  keyName: null,
  scopes: ['datasets:read', 'datasets:write'],
  org: {},
  firestore: mockFirestore,
  headers: {},
} as any

const call = (method: string, segments: string[], values: unknown) =>
  handleDatasets(
    new Request(`https://api.aglyn.com/v1/${segments.join('/')}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    }),
    ctx,
    segments,
    new URL(`https://api.aglyn.com/v1/${segments.join('/')}`),
  )

beforeEach(() => {
  mockRecords = {}
})

describe.each([
  ['a JSON array string', '["Residential","Commercial"]', '["r1","r2"]'],
  ['a comma list', 'Residential, Commercial', 'r1, r2'],
  ['a real array', ['Residential', ' Commercial', ''], ['r1', 'r2']],
] as const)('a list sent as %s', (_label, categories, related) => {
  it('is stored as the list by POST /v1/datasets/{id}/records', async () => {
    const response = await call('POST', ['datasets', 'ds-1', 'records'], {
      name: 'Roofing',
      categories,
      related,
    })
    expect(response.status).toBe(201)
    expect(mockRecords['rec-new']['values']).toEqual({
      name: 'Roofing',
      categories: ['Residential', 'Commercial'],
      related: ['r1', 'r2'],
    })
  })

  it('is stored as the list by PATCH /v1/datasets/{id}/records/{recordId}', async () => {
    mockRecords['r9'] = { values: { name: 'Roofing', categories: ['Old'] } }
    const response = await call('PATCH', ['datasets', 'ds-1', 'records', 'r9'], {
      categories,
    })
    expect(response.status).toBe(200)
    expect(mockRecords['r9']['values']).toEqual({
      name: 'Roofing',
      categories: ['Residential', 'Commercial'],
    })
  })
})

it('refuses a list field given something that is not a list', async () => {
  const response = await call('POST', ['datasets', 'ds-1', 'records'], {
    categories: { residential: true },
  })
  expect(response.status).toBe(400)
  await expect(response.json()).resolves.toMatchObject({
    fields: { categories: 'Categories must be a list' },
  })
  expect(mockRecords).toEqual({})
})
