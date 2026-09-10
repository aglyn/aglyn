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
 * What a published repeat READS.
 *
 * A repeat renders at most `REPEAT_MAX_RECORDS` rows in the editor's `order`.
 * WHICH rows is decided by the read, not by the sort that follows it: a
 * `limit()` with no `orderBy` is answered in document-id order, so past the
 * bound a repeat renders an arbitrary sample, sorted — which looks ordered and
 * is not.
 *
 * ⚠️ The Firestore double below models the two ordering facts the reader
 * depends on: an unordered query answers in document-id order, and
 * `orderBy(field)` matches only documents that carry the field. It cannot see
 * an index, so a green run here says nothing about whether a query is served.
 */

import { REPEAT_MAX_RECORDS } from '@aglyn/aglyn/server'

const HOST_ID = 'site-1'

interface MockRow {
  id: string
  data: Record<string, any>
}

interface MockDataset extends MockRow {
  records: MockRow[]
}

let mockDatasets: MockDataset[] = []
/** Every records query issued, as the ordering and bound it asked for. */
let mockRecordReads: Array<{ orderBy: string | null; limit: number | null }> =
  []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
}))

const byId = (a: MockRow, b: MockRow) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Firestore's answer to one query, as far as the reader depends on it. */
function mockAnswer(
  rows: MockRow[],
  orderBy: string | null,
  limit: number | null,
): MockRow[] {
  let result = [...rows].sort(byId)
  if (orderBy && orderBy !== '__name__') {
    result = result
      .filter((row) => row.data[orderBy] !== undefined)
      .sort((a, b) => a.data[orderBy] - b.data[orderBy] || byId(a, b))
  }
  return limit == null ? result : result.slice(0, limit)
}

const mockSnapshot = (row: MockRow, extra: Record<string, unknown> = {}) => ({
  id: row.id,
  exists: true,
  data: () => row.data,
  get: (field: string) => row.data[field],
  ...extra,
})

function mockRecordsQuery(
  rows: MockRow[],
  orderBy: string | null = null,
  limit: number | null = null,
): any {
  return {
    orderBy: (field: unknown) => mockRecordsQuery(rows, String(field), limit),
    limit: (count: number) => mockRecordsQuery(rows, orderBy, count),
    get: async () => {
      mockRecordReads.push({ orderBy, limit })
      return {
        docs: mockAnswer(rows, orderBy, limit).map((row) => mockSnapshot(row)),
      }
    },
  }
}

const mockDatasetSnapshot = (dataset: MockDataset) =>
  mockSnapshot(dataset, {
    ref: { collection: () => mockRecordsQuery(dataset.records) },
  })

function mockDatasetsQuery(limit: number | null = null): any {
  return {
    orderBy: () => mockDatasetsQuery(limit),
    limit: (count: number) => mockDatasetsQuery(count),
    get: async () => ({
      docs: mockAnswer(mockDatasets, null, limit).map((row) =>
        mockDatasetSnapshot(row as MockDataset),
      ),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  orgDataQueryForHost: async () => ({ ref: {}, query: mockDatasetsQuery() }),
}))

jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant:${hostId}`,
  withRenderCache: async (options: { read: () => unknown }) => options.read(),
}))

import { getDatasets } from './get-datasets'

const pad = (index: number) => String(index).padStart(3, '0')

const record = (
  id: string,
  order: number | undefined,
  title: string,
): MockRow => ({
  id,
  data: { ...(order === undefined ? {} : { order }), values: { title } },
})

const titlesOf = async (datasetId: string) =>
  ((await getDatasets({ hostId: HOST_ID }))[datasetId]?.records ?? []).map(
    (row) => row['title'],
  )

beforeEach(() => {
  mockDatasets = []
  mockRecordReads = []
})

describe('a repeat over more records than it renders (AGL-2773)', () => {
  it('reads the FIRST records in editor order, not a sample by document id', async () => {
    // Document ids run opposite to editor order, so the lowest ids hold the
    // highest `order`. A read by id takes orders 149 down to 50.
    mockDatasets = [
      {
        id: 'menu',
        data: { displayName: 'Menu', fields: ['title'] },
        records: Array.from({ length: 150 }, (_, index) =>
          record(`r${pad(index)}`, 149 - index, `Dish ${149 - index}`),
        ),
      },
    ]

    expect(await titlesOf('menu')).toEqual(
      Array.from({ length: REPEAT_MAX_RECORDS }, (_, index) => `Dish ${index}`),
    )
  })

  it('shows records with no editor order after the ordered ones, by id', async () => {
    // Forms and Actions append records without `order`, so a dataset they
    // feed holds both kinds, and `orderBy('order')` alone would drop these.
    const pinned = Array.from({ length: 30 }, (_, index) =>
      record(`z${pad(index)}`, index, `Pinned ${index}`),
    )
    const appended = Array.from({ length: 200 }, (_, index) =>
      record(`a${pad(index)}`, undefined, `Lead ${index}`),
    )
    mockDatasets = [
      {
        id: 'leads',
        data: { displayName: 'Leads', fields: ['title'] },
        records: [...appended, ...pinned],
      },
    ]

    expect(await titlesOf('leads')).toEqual([
      ...Array.from({ length: 30 }, (_, index) => `Pinned ${index}`),
      ...Array.from({ length: 70 }, (_, index) => `Lead ${index}`),
    ])
  })

  it('THE CONTROL: a dataset inside the bound renders every record, in order', async () => {
    mockDatasets = [
      {
        id: 'team',
        data: { displayName: 'Team', fields: ['title'] },
        records: [
          record('b', 1, 'Second'),
          record('c', undefined, 'Unordered'),
          record('a', 0, 'First'),
        ],
      },
    ]

    expect(await titlesOf('team')).toEqual(['First', 'Second', 'Unordered'])
  })

  it('never reads more than two bounded pages per dataset', async () => {
    // The render path re-reads this hourly per site; an unbounded read here
    // is the cost regression, whatever it buys in correctness.
    mockDatasets = [
      {
        id: 'leads',
        data: { displayName: 'Leads', fields: ['title'] },
        records: Array.from({ length: 500 }, (_, index) =>
          record(`a${pad(index)}`, index % 3 ? undefined : index, `Row ${index}`),
        ),
      },
    ]

    await getDatasets({ hostId: HOST_ID })

    expect(mockRecordReads.length).toBeLessThanOrEqual(2)
    expect(
      mockRecordReads.every((read) => read.limit === REPEAT_MAX_RECORDS),
    ).toBe(true)
  })
})
