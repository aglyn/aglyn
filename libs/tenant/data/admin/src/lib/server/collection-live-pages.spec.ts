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
 * The pages a content collection's change makes stale, as ONE site's drop
 * target (AGL-3340).
 *
 * The console's route resolves the dependent screens through its own routing
 * map read; the tenant's scheduled-entry beat has no request and resolves
 * them here. So this is where a scheduled post's reach is decided, and the
 * cases are the ways it can come out short: the addresses a routing map
 * cannot name, the screens only a routing map can, and the custom domain
 * visitors actually read.
 */

let mockScreenIds: string[] = []
let mockTruncated = false

jest.mock('./live-page-usage', () => ({
  __esModule: true,
  readUsageSources: async () => ({
    candidates: { screens: [], layouts: [], components: [] },
    truncated: mockTruncated,
  }),
  screenIdsUsingCollectionDeep: () => mockScreenIds,
}))

import { collectionLivePageTarget } from './collection-live-pages'

interface Docs {
  host: Record<string, unknown> | null
  collection: Record<string, unknown> | null
}
let docs: Docs

const snapshot = (value: Record<string, unknown> | null) => ({
  exists: value !== null,
  data: () => value ?? undefined,
  get: (field: string) => value?.[field],
})

const firestore = {
  collection: () => ({
    doc: () => ({
      get: async () => snapshot(docs.host),
      collection: () => ({
        doc: () => ({ get: async () => snapshot(docs.collection) }),
      }),
    }),
  }),
} as never

const target = () =>
  collectionLivePageTarget({
    firestore,
    hostId: 'host-1',
    collectionId: 'blog-id',
    entrySlugs: ['new-post'],
  })

beforeEach(() => {
  mockScreenIds = []
  mockTruncated = false
  docs = {
    host: {
      subdomain: 'aglyn-marketing',
      screens: { home: '/', pricing: '/pricing' },
    },
    collection: {
      slug: 'blog',
      kind: 'content',
      categories: [{ name: 'Guides' }],
    },
  }
})

describe('collectionLivePageTarget', () => {
  it('leads with the entry and the listing, then its pages and categories', async () => {
    const result = await target()
    expect(result?.paths.slice(0, 3)).toEqual([
      '/blog/new-post',
      '/blog',
      '/blog/page/2',
    ])
    expect(result?.paths).toContain('/blog/category/guides')
    expect(result?.subdomain).toBe('aglyn-marketing')
  })

  it('adds the screens that render the collection elsewhere, by their routes', async () => {
    // The home page's "Latest posts" rail: a page no slug derivation reaches.
    const derived = (await target())?.paths ?? []
    mockScreenIds = ['home', 'unrouted']
    const result = await target()
    // After the derived addresses, because the tenant's cap keeps what it is
    // handed first — and a screen with no routing entry is not a page, so it
    // adds nothing.
    expect(result?.paths).toEqual([...derived, '/'])
  })

  it('carries the custom domain, whose pages sit under a second cache key', async () => {
    docs.host = { ...docs.host, cname: 'aglyn.com' }
    expect((await target())?.cname).toBe('aglyn.com')
  })

  it('reports a truncated placement scan rather than absorbing it', async () => {
    mockTruncated = true
    expect((await target())?.truncated).toBe(true)
  })

  it('names nothing for a site with no subdomain — no deployment holds its pages', async () => {
    docs.host = { screens: {} }
    expect(await target()).toBeNull()
  })

  it("names nothing for the store's collection — its pages are not these shapes", async () => {
    docs.collection = { slug: 'shop', kind: 'catalog' }
    expect(await target()).toBeNull()
  })

  it('names nothing for a deleted collection', async () => {
    docs.collection = { ...docs.collection, deletedAt: { seconds: 1 } }
    expect(await target()).toBeNull()
  })
})
