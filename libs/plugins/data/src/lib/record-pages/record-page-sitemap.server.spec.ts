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
 * Record pages in the sitemap and `/llms.txt` (AGL-3475): exactly the pages the
 * resolver serves, minus what a crawler must not be handed — a template that
 * is unpublished, hidden or no longer a template, a dataset no longer shared,
 * a site that switched Data off — paged by record id with each record's date.
 */

type Row = { id: string; data: Record<string, unknown> }

const mockHost: { doc: Record<string, unknown> } = { doc: {} }
const mockOrg: { doc: Record<string, unknown> } = { doc: {} }
const mockScreens: Record<string, Record<string, unknown>> = {}
const mockRecords: Row[] = []
const mockBindings = jest.fn()
const mockDataset = jest.fn()

const recordsQuery = (): any => {
  let offset = 0
  let take = Infinity
  const query: any = {
    orderBy: () => query,
    select: () => query,
    offset: (n: number) => ((offset = n), query),
    limit: (n: number) => ((take = n), query),
    count: () => ({ get: async () => ({ data: () => ({ count: mockRecords.length }) }) }),
    get: async () => ({
      docs: mockRecords.slice(offset, offset + take).map((row) => ({
        id: row.id,
        get: (field: string) => row.data[field],
      })),
    }),
  }
  return query
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: () => ({
            get: async () => ({ data: () => (name === 'orgs' ? mockOrg.doc : mockHost.doc) }),
            collection: () => ({
              doc: (screenId: string) => ({
                get: async () => ({ data: () => mockScreens[screenId] }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))
jest.mock('./record-page-read.server', () => ({
  readSiteRecordPageBindings: (...args: unknown[]) => mockBindings(...args),
  readSiteDataset: (...args: unknown[]) => mockDataset(...args),
}))

import {
  recordPagesSitemapKey,
  recordPagesSitemapReader as reader,
} from './record-page-sitemap.server'

const SERVICES = { screenId: 'svc', datasetId: 'services', base: 'services', slugField: 'slug' }
const ROOFS = {
  screenId: 'roofs',
  datasetId: 'services',
  base: 'services/residential',
  slugField: 'slug',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockHost.doc = { orgId: 'org-1' }
  mockOrg.doc = {}
  for (const key of Object.keys(mockScreens)) delete mockScreens[key]
  mockScreens['svc'] = { kind: 'template', versionId: 'v1' }
  mockScreens['roofs'] = { kind: 'template', versionId: 'v1' }
  mockRecords.splice(
    0,
    mockRecords.length,
    { id: 'a', data: { values: { slug: 'roofing' }, updatedAt: Date.UTC(2026, 9, 1) } },
    { id: 'b', data: { values: {} } },
    { id: 'c', data: { values: { slug: 'Siding' }, createdAt: Date.UTC(2026, 8, 1) } },
  )
  mockBindings.mockResolvedValue([SERVICES, ROOFS])
  mockDataset.mockResolvedValue({
    id: 'services',
    name: 'Services',
    model: { order: [], fields: {} },
    ref: { collection: () => recordsQuery() },
  })
})

describe('the children record pages have on a site', () => {
  it('is one per published template, sized by its dataset', async () => {
    expect(await reader.children({ hostId: 'host-1' })).toEqual([
      { key: 'services', urls: 3 },
      { key: 'services--residential', urls: 3 },
    ])
  })

  it('leaves out a template a crawler must not be handed', async () => {
    mockScreens['svc'] = { kind: 'template' }
    mockScreens['roofs'] = { kind: 'template', versionId: 'v1', visibility: 'unlisted' }
    expect(await reader.children({ hostId: 'host-1' })).toEqual([])
  })

  it('leaves out a template made a page again', async () => {
    mockScreens['roofs'] = { kind: 'page', versionId: 'v1' }
    expect((await reader.children({ hostId: 'host-1' })).map((one) => one.key)).toEqual([
      'services',
    ])
  })

  it('leaves out a dataset no longer shared with the site', async () => {
    mockDataset.mockResolvedValue(null)
    expect(await reader.children({ hostId: 'host-1' })).toEqual([])
  })

  it('is nothing on a site that switched Data off', async () => {
    mockHost.doc = { orgId: 'org-1', disabledPlugins: ['data'] }
    expect(await reader.children({ hostId: 'host-1' })).toEqual([])
  })
})

describe('one child’s URLs', () => {
  it('is each record’s page, dated, skipping a record with no address', async () => {
    expect(
      await reader.urls({ hostId: 'host-1', key: 'services', page: 1, perPage: 10 }),
    ).toEqual([
      { path: '/services/roofing', lastmod: Date.UTC(2026, 9, 1) },
      { path: '/services/siding', lastmod: Date.UTC(2026, 8, 1) },
    ])
  })

  it('pages by record so a page number names the same records every time', async () => {
    expect(
      await reader.urls({ hostId: 'host-1', key: 'services--residential', page: 2, perPage: 2 }),
    ).toEqual([{ path: '/services/residential/siding', lastmod: Date.UTC(2026, 8, 1) }])
  })

  it('is nothing for a key no template has', async () => {
    expect(await reader.urls({ hostId: 'host-1', key: 'nope', page: 1, perPage: 10 })).toEqual(
      [],
    )
  })
})

describe('the groups llms.txt names', () => {
  it('is each template’s dataset, base and count', async () => {
    expect(await reader.listings?.({ hostId: 'host-1' })).toEqual([
      { name: 'Services', base: 'services', count: 3 },
      { name: 'Services', base: 'services/residential', count: 3 },
    ])
  })
})

describe('a child key', () => {
  it('names exactly one base', () => {
    expect(recordPagesSitemapKey('services/residential')).toBe('services--residential')
    expect(recordPagesSitemapKey('services')).toBe('services')
  })
})
