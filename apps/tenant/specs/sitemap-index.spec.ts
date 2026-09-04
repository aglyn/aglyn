/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom, where `Request` is not a constructor.
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
 * `/sitemap.xml` is a sitemap INDEX over one child per section (AGL-2520).
 *
 * The flat file it replaced had no answer for a site outgrowing the protocol's
 * 50,000-URL cap: the URLs past the cap were simply never submitted, and
 * nothing anywhere said so. It also meant one crawler fetch swept every screen,
 * product, collection and entry the site had, because a single document has to
 * contain all of them.
 *
 * What is pinned here is the part a reader cannot verify by looking: that the
 * index's page arithmetic and the child sitemaps' slicing agree, so a URL lands
 * in exactly one child and every child the index names has something in it.
 */

// Factories, not bare `jest.mock`: the route reaches `@aglyn/tenant-data-admin`
// → `undici`, and an auto-mock still evaluates the real module graph to derive
// its shape. That fails before any test runs.
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
}))

interface Row {
  id: string
  data: Record<string, unknown>
  entries?: Row[]
}

/**
 * The Firestore surface this route uses, and only that: equality `where`,
 * `orderBy`/`select` (which change no result here), `offset`/`limit`, `count`
 * and `get`. Rows are held in id order, which is what `orderBy('__name__')`
 * means, so a page number addresses a stable slice exactly as it does live.
 */
function mockQuery(rows: Row[]): any {
  let matched = rows
  let offset = 0
  let take = Number.POSITIVE_INFINITY
  const query: any = {
    where: (field: string, _op: string, value: unknown) => {
      matched = matched.filter((row) => row.data[field] === value)
      return query
    },
    orderBy: () => query,
    select: () => query,
    offset: (n: number) => {
      offset = n
      return query
    },
    limit: (n: number) => {
      take = n
      return query
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: matched.length }) }),
    }),
    get: async () => ({
      docs: matched.slice(offset, offset + take).map(mockSnapshot),
    }),
  }
  return query
}

const mockSnapshot = (row: Row): any => ({
  id: row.id,
  data: () => row.data,
  get: (field: string) => row.data[field],
  ref: {
    collection: (name: string) =>
      mockQuery(name === 'entries' ? (row.entries ?? []) : []),
  },
})

const mockSite: {
  store: Record<string, unknown>
  products: Row[]
  collections: Row[]
  screens: Row[]
} = { store: {}, products: [], collections: [], screens: [] }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) => {
              if (name === 'settings') {
                return {
                  doc: () => ({
                    get: async () => ({
                      get: (field: string) => mockSite.store[field],
                    }),
                  }),
                }
              }
              if (name === 'screens') return mockQuery(mockSite.screens)
              if (name === 'products') return mockQuery(mockSite.products)
              if (name === 'collections') return mockQuery(mockSite.collections)
              return mockQuery([])
            },
          }),
        }),
      }),
    }),
  },
}))

import { SITEMAP_URLS_PER_FILE } from '@aglyn/aglyn/app-utils/sitemap'
import { GET } from '../app/api/sitemap/route'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.MockedFunction<typeof getHost>

const BASE = 'https://acme.test'

const givenSite = (options: {
  seo?: Record<string, unknown>
  screens?: Record<string, string>
  store?: Record<string, unknown>
  products?: Row[]
  collections?: Row[]
}) => {
  mockGetHost.mockResolvedValue({
    host: {
      $id: 'host-1',
      cname: 'acme.test',
      seo: options.seo ?? {},
      screens: options.screens ?? { home: '' },
    },
    nextPageToken: '',
    error: null,
  } as never)
  mockSite.store = options.store ?? {}
  mockSite.products = options.products ?? []
  mockSite.collections = options.collections ?? []
  mockSite.screens = []
}

const entryRows = (count: number, prefix = 'post'): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    // Zero-padded so id order — what `orderBy('__name__')` walks — is the
    // order the fixtures read in.
    id: `${prefix}-${String(index).padStart(6, '0')}`,
    data: { status: 'published', slug: `${prefix}-${index}` },
  }))

/** `''` is the index at `/sitemap.xml`; anything else is a child sitemap path. */
const fetchXml = async (path: string) =>
  (
    await GET(
      new Request(`${BASE}${path || '/sitemap.xml'}?host=acme`, {
        headers: { host: 'acme.test' },
      }),
    )
  ).text()

const locsOf = (xml: string) =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

describe('sitemap index (AGL-2520)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('names one child per section, and none for a section with nothing in it', async () => {
    givenSite({
      screens: { home: '', about: 'about' },
      store: { pdpScreenId: 'pdp' },
      products: [
        { id: 'p1', data: { status: 'active', slug: 'mug' } },
        { id: 'p2', data: { status: 'active', slug: 'tee' } },
      ],
      collections: [
        { id: 'c1', data: { kind: 'content', slug: 'blog' }, entries: entryRows(3) },
      ],
    })

    const xml = await fetchXml('')

    expect(xml).toContain('<sitemapindex')
    expect(locsOf(xml)).toEqual([
      `${BASE}/sitemaps/pages/1.xml`,
      `${BASE}/sitemaps/products/1.xml`,
      `${BASE}/sitemaps/content-blog/1.xml`,
    ])
    // `collectionScreenId` is unset, so the site has no `/collections/{slug}`
    // pages and the index does not send a crawler to fetch an empty file.
    expect(xml).not.toContain('/sitemaps/catalog/')
  })

  it('splits a collection that outgrows one file, and each entry lands in exactly one child', async () => {
    const entries = entryRows(SITEMAP_URLS_PER_FILE + 10)
    givenSite({
      collections: [{ id: 'c1', data: { kind: 'content', slug: 'blog' }, entries }],
    })

    expect(locsOf(await fetchXml(''))).toEqual([
      `${BASE}/sitemaps/pages/1.xml`,
      `${BASE}/sitemaps/content-blog/1.xml`,
      `${BASE}/sitemaps/content-blog/2.xml`,
    ])

    const first = locsOf(await fetchXml('/sitemaps/content-blog/1.xml'))
    const second = locsOf(await fetchXml('/sitemaps/content-blog/2.xml'))

    // Page 1 carries the listing on TOP of a full page of entries rather than
    // displacing one, so an entry's page is a plain function of its position
    // and adding a category never repaginates the collection.
    expect(first[0]).toBe(`${BASE}/blog`)
    expect(first).toHaveLength(SITEMAP_URLS_PER_FILE + 1)
    expect(second).toHaveLength(10)
    expect(second).not.toContain(`${BASE}/blog`)

    const everything = [...first, ...second]
    expect(new Set(everything).size).toBe(everything.length)
    expect(everything).toContain(`${BASE}/blog/post-0`)
    expect(everything).toContain(
      `${BASE}/blog/post-${SITEMAP_URLS_PER_FILE + 9}`,
    )
  })

  it('gives an empty collection a child sitemap anyway — the listing is a page', async () => {
    givenSite({
      collections: [{ id: 'c1', data: { kind: 'content', slug: 'blog' }, entries: [] }],
    })

    expect(locsOf(await fetchXml(''))).toContain(
      `${BASE}/sitemaps/content-blog/1.xml`,
    )
    expect(locsOf(await fetchXml('/sitemaps/content-blog/1.xml'))).toEqual([
      `${BASE}/blog`,
    ])
  })

  it('puts a category listing on page 1 with the collection it filters', async () => {
    givenSite({
      collections: [
        {
          id: 'c1',
          data: {
            kind: 'content',
            slug: 'blog',
            categories: [{ id: 'open-source', name: 'Open source' }],
          },
          entries: entryRows(1),
        },
      ],
    })

    expect(locsOf(await fetchXml('/sitemaps/content-blog/1.xml'))).toEqual([
      `${BASE}/blog`,
      `${BASE}/blog/category/open-source`,
      `${BASE}/blog/post-0`,
    ])
  })

  it('keeps a catalog collection out of the content sections and vice versa', async () => {
    // The two kinds share one Firestore collection and serve different paths
    // (AGL-954): `/collections/{slug}` for catalog, `/{slug}` for content.
    givenSite({
      store: { collectionScreenId: 'catalog-tmpl' },
      collections: [
        { id: 'c1', data: { kind: 'catalog', slug: 'sale' } },
        { id: 'c2', data: { kind: 'content', slug: 'blog' }, entries: [] },
      ],
    })

    const index = locsOf(await fetchXml(''))
    expect(index).toContain(`${BASE}/sitemaps/catalog/1.xml`)
    expect(index).toContain(`${BASE}/sitemaps/content-blog/1.xml`)
    expect(index).not.toContain(`${BASE}/sitemaps/content-sale/1.xml`)

    expect(locsOf(await fetchXml('/sitemaps/catalog/1.xml'))).toEqual([
      `${BASE}/collections/sale`,
    ])
    // Asking for the catalog collection AS a content section answers empty
    // rather than inventing `/sale`, which the site does not serve.
    expect(locsOf(await fetchXml('/sitemaps/content-sale/1.xml'))).toEqual([])
  })

  it('drops a soft-deleted product without dropping the page it shared', async () => {
    // Soft deletes keep `status: 'active'`, so the filter cannot live in the
    // query and the index's count can run one ahead of the URLs emitted.
    givenSite({
      store: { pdpScreenId: 'pdp' },
      products: [
        { id: 'p1', data: { status: 'active', slug: 'mug' } },
        { id: 'p2', data: { status: 'active', slug: 'gone', deletedAt: 1 } },
        { id: 'p3', data: { status: 'draft', slug: 'wip' } },
      ],
    })

    expect(locsOf(await fetchXml('/sitemaps/products/1.xml'))).toEqual([
      `${BASE}/products/mug`,
    ])
  })

  it('answers an unknown section with an empty sitemap, not an error', async () => {
    givenSite({})

    const xml = await fetchXml('/sitemaps/content-nope/1.xml')

    expect(xml).toContain('<urlset')
    expect(locsOf(xml)).toEqual([])
  })

  it('still answers a discouraged site with an empty urlset, never an index', async () => {
    // AGL-1263: the file exists and parses, so Search Console reads "nothing
    // here" instead of an error it will retry. An index of empty children
    // would advertise the very URLs the switch exists to withhold.
    givenSite({ seo: { discourageSearchEngines: true }, screens: { home: '' } })

    const xml = await fetchXml('')

    expect(xml).toContain('<urlset')
    expect(xml).not.toContain('<sitemapindex')
    expect(locsOf(xml)).toEqual([])
  })
})
