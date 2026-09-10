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
 * is not. The same holds one level up: WHICH datasets a site loads decides
 * whether a repeat has anything to render at all.
 *
 * ⚠️ The Firestore double below models the ordering facts the reader depends
 * on — an unordered query answers in document-id order, and `orderBy(field)`
 * matches only documents that carry the field — and the site scope the real
 * `orgDataQueryForHost` applies. It cannot see an index, so a green run here
 * says nothing about whether a query is served.
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

/** The site scope `orgDataQueryForHost` applies, as `array-contains-any`. */
const mockVisibleToSite = (dataset: MockDataset) =>
  (dataset.data['visibleTo'] ?? []).some((token: string) =>
    ['org', `host:${HOST_ID}`].includes(token),
  )

function mockDatasetsQuery(
  equals: Array<[string, unknown]> = [],
  limit: number | null = null,
): any {
  return {
    where: (field: string, _op: string, value: unknown) =>
      mockDatasetsQuery([...equals, [field, value]], limit),
    orderBy: () => mockDatasetsQuery(equals, limit),
    limit: (count: number) => mockDatasetsQuery(equals, count),
    get: async () => ({
      docs: mockAnswer(
        mockDatasets
          .filter(mockVisibleToSite)
          .filter((dataset) =>
            equals.every(([field, value]) => dataset.data[field] === value),
          ),
        null,
        limit,
      ).map((row) => mockDatasetSnapshot(row as MockDataset)),
    }),
  }
}

/** The org's `datasets` collection, read by id — no scope applied. */
const mockDatasetsRef = {
  parent: { parent: { id: 'orgs' } },
  doc: (id: string) => ({
    get: async () => {
      const dataset = mockDatasets.find((candidate) => candidate.id === id)
      return dataset
        ? mockDatasetSnapshot(dataset)
        : { id, exists: false, data: () => undefined, get: () => undefined }
    },
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  orgDataQueryForHost: async () => ({
    ref: mockDatasetsRef,
    query: mockDatasetsQuery(),
  }),
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

const dataset = (
  id: string,
  records: MockRow[],
  data: Record<string, unknown> = {},
): MockDataset => ({
  id,
  data: { displayName: id, fields: ['title'], visibleTo: ['org'], ...data },
  records,
})

const titlesOf = async (key: string) =>
  (
    (await getDatasets({ hostId: HOST_ID, keys: [key] }))[key]?.records ?? []
  ).map((row) => row['title'])

beforeEach(() => {
  mockDatasets = []
  mockRecordReads = []
})

describe('a repeat over more records than it renders (AGL-2773)', () => {
  it('reads the FIRST records in editor order, not a sample by document id', async () => {
    // Document ids run opposite to editor order, so the lowest ids hold the
    // highest `order`. A read by id takes orders 149 down to 50.
    mockDatasets = [
      dataset(
        'menu',
        Array.from({ length: 150 }, (_, index) =>
          record(`r${pad(index)}`, 149 - index, `Dish ${149 - index}`),
        ),
      ),
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
    mockDatasets = [dataset('leads', [...appended, ...pinned])]

    expect(await titlesOf('leads')).toEqual([
      ...Array.from({ length: 30 }, (_, index) => `Pinned ${index}`),
      ...Array.from({ length: 70 }, (_, index) => `Lead ${index}`),
    ])
  })

  it('THE CONTROL: a dataset inside the bound renders every record, in order', async () => {
    mockDatasets = [
      dataset('team', [
        record('b', 1, 'Second'),
        record('c', undefined, 'Unordered'),
        record('a', 0, 'First'),
      ]),
    ]

    expect(await titlesOf('team')).toEqual(['First', 'Second', 'Unordered'])
  })

  it('never reads more than two bounded pages per dataset', async () => {
    // The render path re-reads this hourly per site; an unbounded read here
    // is the cost regression, whatever it buys in correctness.
    mockDatasets = [
      dataset(
        'leads',
        Array.from({ length: 500 }, (_, index) =>
          record(`a${pad(index)}`, index % 3 ? undefined : index, `Row ${index}`),
        ),
      ),
    ]

    await getDatasets({ hostId: HOST_ID, keys: ['leads'] })

    expect(mockRecordReads.length).toBeLessThanOrEqual(2)
    expect(
      mockRecordReads.every((read) => read.limit === REPEAT_MAX_RECORDS),
    ).toBe(true)
  })
})

describe('a site with more datasets than one page of them (AGL-2773)', () => {
  /** `count` datasets the site can see, `d000`…, one record each. */
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      dataset(`d${pad(index)}`, [record(`r${index}`, 0, `Row of ${index}`)], {
        displayName: `Dataset ${index}`,
      }),
    )

  it('loads a repeated dataset wherever it falls among the site’s datasets', async () => {
    mockDatasets = many(60)

    expect(await titlesOf('d057')).toEqual(['Row of 57'])
  })

  it('resolves a repeat that names its dataset by display name', async () => {
    mockDatasets = many(60)

    expect(await titlesOf('Dataset 58')).toEqual(['Row of 58'])
  })

  it('loads the dataset a reference field points at, for its one hop', async () => {
    mockDatasets = [
      ...many(60),
      dataset('zz-posts', [record('p1', 0, 'Hello')], {
        model: {
          order: ['title', 'author'],
          fields: {
            title: { name: 'Title', type: 'text' },
            author: {
              name: 'Author',
              type: 'reference',
              reference: { datasetId: 'zz-authors' },
            },
          },
        },
      }),
      dataset('zz-authors', [record('a1', 0, 'Ada')]),
    ]

    const datasets = await getDatasets({ hostId: HOST_ID, keys: ['zz-posts'] })

    expect(datasets['zz-authors']?.records.map((row) => row['title'])).toEqual(
      ['Ada'],
    )
  })

  it('reads records only for the datasets the page repeats over', async () => {
    mockDatasets = many(60)

    await getDatasets({ hostId: HOST_ID, keys: ['d001'] })

    expect(mockRecordReads.length).toBeLessThanOrEqual(2)
  })

  it('reads nothing for a page that repeats over nothing', async () => {
    mockDatasets = many(3)

    expect(await getDatasets({ hostId: HOST_ID, keys: [] })).toEqual({})
    expect(mockRecordReads).toHaveLength(0)
  })

  it('THE LEAK GUARD: never loads a dataset this site cannot see, by id or by name', async () => {
    // AGL-1039: a client site binding a repeat to the agency's internal
    // dataset must render nothing, whichever way the key names it.
    mockDatasets = [
      dataset('internal', [record('x', 0, 'Secret')], {
        displayName: 'Internal rates',
        visibleTo: ['host:another-site'],
      }),
    ]

    const datasets = await getDatasets({
      hostId: HOST_ID,
      keys: ['internal', 'Internal rates'],
    })

    expect(datasets).toEqual({})
  })
})
