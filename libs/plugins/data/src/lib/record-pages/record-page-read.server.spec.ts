/**
 * @jest-environment node
 *
 * The pragma stays in the FIRST block comment: behind the license header it
 * is silently ignored.
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
 * What a record page READS (AGL-3475): a site's bindings, and the one record
 * an address names — found through the indexed `filterValues` equality, held
 * to the site's sharing, and joined to just the records its references name.
 *
 * ⚠️ The Firestore double answers `where(path, '==', value)` by reading the
 * stored field at that path, which is what the index serves; it cannot see
 * an index, so a green run here says nothing about whether one exists.
 */

type Doc = { id: string; data: Record<string, unknown> }

const mockDatasets: Record<string, Doc> = {}
const mockRecords: Record<string, Doc[]> = {}
const mockBindingDocs: Doc[] = []
const mockQueries: Array<{ dataset: string; path: string; value: unknown }> = []

const read = (data: Record<string, unknown>, path: string) =>
  path.split('.').reduce<unknown>(
    (value, key) => (value as Record<string, unknown> | undefined)?.[key],
    data,
  )

const snapshotOf = (doc: Doc | undefined, id: string) => ({
  id,
  exists: Boolean(doc),
  data: () => doc?.data,
  get: (field: string) => (doc ? read(doc.data, field) : undefined),
})

const datasetRef = (datasetId: string): any => ({
  id: datasetId,
  get: async () => ({ ...snapshotOf(mockDatasets[datasetId], datasetId), ref: datasetRef(datasetId) }),
  collection: () => ({
    doc: (recordId: string) => ({
      get: async () =>
        snapshotOf(
          (mockRecords[datasetId] ?? []).find((record) => record.id === recordId),
          recordId,
        ),
    }),
    where: (path: string, _op: string, value: unknown) => ({
      limit: (count: number) => ({
        get: async () => {
          mockQueries.push({ dataset: datasetId, path, value })
          return {
            docs: (mockRecords[datasetId] ?? [])
              .filter((record) => read(record.data, path) === value)
              .slice(0, count)
              .map((record) => ({ id: record.id, data: () => record.data })),
          }
        },
      }),
    }),
  }),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  orgDataQueryForHost: async () => ({
    ref: { parent: { parent: { id: 'orgs' } }, doc: (id: string) => datasetRef(id) },
  }),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              limit: () => ({
                get: async () => ({
                  docs: mockBindingDocs.map((doc) => ({ id: doc.id, data: () => doc.data })),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async ({ read }: { read: () => Promise<unknown> }) => read(),
}))

import { readRecordPageRecord, readSiteRecordPageBindings } from './record-page-read.server'

const MODEL = {
  order: ['name', 'slug', 'lead'],
  fields: {
    name: { name: 'Name', type: 'text' },
    slug: { name: 'Page address', type: 'text', customType: 'pageAddress' },
    lead: { name: 'Lead', type: 'reference', reference: { datasetId: 'people' } },
  },
}

const BINDING = {
  screenId: 'tmpl',
  datasetId: 'services',
  base: 'services',
  slugField: 'slug',
}

const record = (id: string, values: Record<string, unknown>, order?: number): Doc => ({
  id,
  data: {
    values,
    filterValues: { slug: String(values['slug'] ?? '').toLowerCase().slice(0, 64) },
    ...(order != null ? { order } : {}),
  },
})

beforeEach(() => {
  for (const key of Object.keys(mockDatasets)) delete mockDatasets[key]
  for (const key of Object.keys(mockRecords)) delete mockRecords[key]
  mockBindingDocs.splice(0)
  mockQueries.splice(0)
  mockDatasets['services'] = {
    id: 'services',
    data: { displayName: 'Services', model: MODEL, visibleTo: ['org'] },
  }
  mockDatasets['people'] = {
    id: 'people',
    data: { displayName: 'People', visibleTo: ['org'] },
  }
  mockRecords['services'] = [
    record('r1', { name: 'Roofing', slug: 'roofing', lead: 'p1' }),
    record('r2', { name: 'Siding', slug: 'siding' }),
  ]
  mockRecords['people'] = [
    { id: 'p1', data: { values: { name: 'Marisol' } } },
    { id: 'p2', data: { values: { name: 'Dev' } } },
  ]
})

describe('a site’s record templates', () => {
  it('are the binding documents that describe one', async () => {
    mockBindingDocs.push(
      { id: 'tmpl', data: { datasetId: 'services', base: 'services', slugField: 'slug' } },
      { id: 'broken', data: { datasetId: 'services' } },
    )
    expect(await readSiteRecordPageBindings('host-1')).toEqual([BINDING])
  })
})

describe('the record an address names', () => {
  it('is found through the indexed equality on its address field', async () => {
    const routed = await readRecordPageRecord('host-1', BINDING, 'roofing')
    expect(mockQueries).toEqual([
      { dataset: 'services', path: 'filterValues.slug', value: 'roofing' },
    ])
    expect(routed?.record).toEqual({ name: 'Roofing', slug: 'roofing', lead: 'p1', $id: 'r1' })
    expect(routed?.dataset).toMatchObject({ id: 'services', name: 'Services' })
  })

  it('carries just the records its references name, by dataset', async () => {
    const routed = await readRecordPageRecord('host-1', BINDING, 'roofing')
    expect(routed?.datasetsByKey).toEqual({
      people: { records: [{ name: 'Marisol', $id: 'p1' }] },
    })
  })

  it('leaves out a reference target the site may not see', async () => {
    mockDatasets['people']!.data['visibleTo'] = ['host:another-site']
    const routed = await readRecordPageRecord('host-1', BINDING, 'roofing')
    expect(routed?.datasetsByKey).toEqual({})
  })

  it('is the first in the dataset’s order when two records share an address', async () => {
    mockRecords['services'] = [
      record('a', { name: 'Roofing (old)', slug: 'roofing' }, 5),
      record('b', { name: 'Roofing', slug: 'roofing' }, 1),
    ]
    expect((await readRecordPageRecord('host-1', BINDING, 'roofing'))?.record['$id']).toBe('b')
  })

  it('is nothing for an address no record holds', async () => {
    expect(await readRecordPageRecord('host-1', BINDING, 'gutters')).toBeNull()
  })

  it('is nothing when the dataset is no longer shared with the site', async () => {
    mockDatasets['services']!.data['visibleTo'] = ['host:another-site']
    expect(await readRecordPageRecord('host-1', BINDING, 'roofing')).toBeNull()
    expect(mockQueries).toEqual([])
  })

  it('is nothing when the dataset has been deleted', async () => {
    mockDatasets['services']!.data['deletedAt'] = { seconds: 1 }
    expect(await readRecordPageRecord('host-1', BINDING, 'roofing')).toBeNull()
  })

  it('is nothing when the model no longer has the address field', async () => {
    expect(
      await readRecordPageRecord('host-1', { ...BINDING, slugField: 'gone' }, 'roofing'),
    ).toBeNull()
    expect(mockQueries).toEqual([])
  })
})
