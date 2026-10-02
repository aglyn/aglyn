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
 * @jest-environment node
 */

/**
 * The record pages a publish or a record write makes stale (AGL-3475): the
 * pages a template draws, by each record's address, bounded and said to be
 * cut short when a dataset is larger than one drop names.
 */

type Row = { id: string; data: Record<string, unknown> }

const mockBindingDocs: Row[] = []
const mockRecords: Row[] = []
const mockDataset = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
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
jest.mock('./record-page-read.server', () => ({
  readSiteDataset: (...args: unknown[]) => mockDataset(...args),
}))

import {
  RECORD_PAGE_DROP_LIMIT,
  recordPageLivePaths,
  recordPagePathsForDataset,
} from './record-page-live-paths.server'

const records = (): any => {
  let take = Infinity
  const query: any = {
    orderBy: () => query,
    select: () => query,
    limit: (n: number) => ((take = n), query),
    get: async () => ({
      docs: mockRecords.slice(0, take).map((row) => ({ get: (f: string) => row.data[f] })),
    }),
  }
  return query
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBindingDocs.splice(
    0,
    mockBindingDocs.length,
    { id: 'svc', data: { datasetId: 'services', base: 'services', slugField: 'slug' } },
    { id: 'loc', data: { datasetId: 'areas', base: 'service-areas', slugField: 'slug' } },
  )
  mockRecords.splice(
    0,
    mockRecords.length,
    { id: 'a', data: { values: { slug: 'roofing' } } },
    { id: 'b', data: { values: {} } },
  )
  mockDataset.mockResolvedValue({ ref: { collection: () => records() } })
})

describe('the record pages a publish makes stale', () => {
  it('is the pages the published template draws', async () => {
    expect(await recordPageLivePaths({ hostId: 'h1', screenIds: ['svc'] })).toEqual([
      '/services/roofing',
    ])
  })

  it('is every template’s pages for a whole-site publish', async () => {
    expect(await recordPageLivePaths({ hostId: 'h1' })).toEqual([
      '/services/roofing',
      '/service-areas/roofing',
    ])
  })

  it('is nothing for a screen that is no record template', async () => {
    expect(await recordPageLivePaths({ hostId: 'h1', screenIds: ['about'] })).toEqual([])
  })
})

describe('the record pages a record write makes stale', () => {
  it('is every page of the templates that render the dataset', async () => {
    expect(await recordPagePathsForDataset('h1', 'services')).toEqual({
      paths: ['/services/roofing'],
      truncated: false,
    })
  })

  it('says it was cut short past the bound', async () => {
    mockRecords.splice(
      0,
      mockRecords.length,
      ...Array.from({ length: RECORD_PAGE_DROP_LIMIT + 1 }, (_, i) => ({
        id: `r${i}`,
        data: { values: { slug: `page-${i}` } },
      })),
    )
    const answer = await recordPagePathsForDataset('h1', 'services')
    expect(answer.paths).toHaveLength(RECORD_PAGE_DROP_LIMIT)
    expect(answer.truncated).toBe(true)
  })

  it('is nothing when the dataset is no longer shared with the site', async () => {
    mockDataset.mockResolvedValue(null)
    expect(await recordPagePathsForDataset('h1', 'services')).toEqual({
      paths: [],
      truncated: false,
    })
  })
})
