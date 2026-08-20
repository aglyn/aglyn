/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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
 * The cross-collection results page (AGL-1525, Figma 599:1218).
 *
 * Three separable claims, tested at the level each one lives at:
 *
 * 1. the ARITHMETIC of the count tabs — pure, no Firestore;
 * 2. the ATTRIBUTION that makes those counts possible, and the shared
 *    matcher that keeps this page's answer from being narrower than the
 *    suggestion panel that linked here — against a seeded Firestore;
 * 3. the ORDER the page composes them in, which is the one thing neither of
 *    the other two can see: facets counted AFTER filtering would leave every
 *    inactive tab reading "· 0" while both halves stayed individually
 *    correct.
 */

// Factories, not bare `jest.mock`: the module graph under
// `@aglyn/tenant-data-admin` reaches `undici`, and an auto-mock still
// evaluates the real graph to derive its shape.
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  orgDataQueryForHost: jest.fn(),
}))
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  // Faithful to the real helper's contract OUTSIDE a Next server context,
  // which is exactly where jest runs it: `withRenderCache` catches the
  // "incrementalCache missing" invariant and performs the read directly.
  // A double that returned a canned value instead would test the cache and
  // nothing else.
  withRenderCache: async (options: { read: () => Promise<unknown> }) =>
    options.read(),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
  })),
}))
// The REAL helpers by file path. `COLLECTION_SEARCH_FUSE_OPTIONS` above all:
// it is the subject of the typo test, and a faked one would assert nothing.
jest.mock('@aglyn/aglyn/server', () => {
  const collectionEntries = jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entries',
  )
  return {
    __esModule: true,
    screenRoutePathToUrl: jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/screen-route',
    ).screenRoutePathToUrl,
    hostCollectionKind: jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/collection-kind',
    ).hostCollectionKind,
    decodeStoredNodes: jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/stored-nodes',
    ).decodeStoredNodes,
    COLLECTION_SEARCH_FUSE_OPTIONS:
      collectionEntries.COLLECTION_SEARCH_FUSE_OPTIONS,
    formatCollectionEntryDate: collectionEntries.formatCollectionEntryDate,
  }
})

import { firebaseAdmin, orgDataQueryForHost } from '@aglyn/tenant-data-admin'
import type { SearchResult } from '../utils/search-content'
import searchContent, {
  filterSearchResults,
  SEARCH_FACET_ALL,
  searchResultFacets,
} from '../utils/search-content'

const HOST_ID = 'host_acme'

const entry = (
  slug: string,
  title: string,
  collection: { slug: string; title: string },
): SearchResult => ({
  title,
  url: `/${collection.slug}/${slug}`,
  snippet: '',
  kind: 'entry',
  collection,
})

const BLOG = { slug: 'blog', title: 'Blog' }
const CHANGELOG = { slug: 'changelog', title: 'Changelog' }
const NEWSROOM = { slug: 'newsroom', title: 'Press' }

describe('searchResultFacets — the count tabs (AGL-1525)', () => {
  it('reproduces the frame: All · 6, Blog · 4, Changelog · 1, Press · 1', () => {
    const results = [
      entry('a', 'A', BLOG),
      entry('b', 'B', BLOG),
      entry('c', 'C', BLOG),
      entry('d', 'D', BLOG),
      entry('e', 'E', CHANGELOG),
      entry('f', 'F', NEWSROOM),
    ]
    expect(searchResultFacets(results)).toEqual([
      { key: SEARCH_FACET_ALL, label: 'All', count: 6 },
      { key: 'blog', label: 'Blog', count: 4 },
      { key: 'changelog', label: 'Changelog', count: 1 },
      { key: 'newsroom', label: 'Press', count: 1 },
    ])
  })

  it('keeps All equal to the SUM of the other tabs', () => {
    // The invariant that makes the tab row trustworthy: every tab is a
    // partition of the same list, so a reader can add them up and get the
    // number at the top. Counted from a second source, they would drift the
    // first time a result kind was added.
    const results = [
      entry('a', 'A', BLOG),
      entry('b', 'B', CHANGELOG),
      { title: 'About', url: '/about', snippet: '', kind: 'page' as const },
      { title: 'Row', url: '/data', snippet: '', kind: 'data' as const },
    ]
    const facets = searchResultFacets(results)
    const all = facets.find((facet) => facet.key === SEARCH_FACET_ALL)
    const rest = facets.filter((facet) => facet.key !== SEARCH_FACET_ALL)
    expect(all?.count).toBe(results.length)
    expect(rest.reduce((sum, facet) => sum + facet.count, 0)).toBe(
      results.length,
    )
  })

  it('files pages and dataset rows under one Pages tab', () => {
    // They belong to no collection but they are still results. Left out,
    // "All" would exceed the tabs beneath it and the row would stop adding
    // up — which is worse than an extra tab.
    const facets = searchResultFacets([
      entry('a', 'A', BLOG),
      { title: 'About', url: '/about', snippet: '', kind: 'page' },
      { title: 'Row', url: '/data', snippet: '', kind: 'data' },
    ])
    expect(facets).toContainEqual({ key: 'pages', label: 'Pages', count: 2 })
  })

  it('renders NO tabs when every match came from one place', () => {
    // A lone "All · 3" is not a choice; it reads as a filter over a list it
    // cannot change.
    expect(
      searchResultFacets([
        entry('a', 'A', BLOG),
        entry('b', 'B', BLOG),
        entry('c', 'C', BLOG),
      ]),
    ).toEqual([])
    expect(searchResultFacets([])).toEqual([])
  })

  it("labels a tab with the collection's NAME, never its slug", () => {
    // The frame says "Press" for a collection slugged `newsroom`. A slug on
    // the tab is a URL fragment shown to a reader.
    const facets = searchResultFacets([
      entry('a', 'A', NEWSROOM),
      entry('b', 'B', BLOG),
    ])
    expect(facets.find((facet) => facet.key === 'newsroom')?.label).toBe(
      'Press',
    )
  })
})

describe('filterSearchResults — the active tab (AGL-1525)', () => {
  const results = [
    entry('a', 'A', BLOG),
    entry('b', 'B', CHANGELOG),
    { title: 'About', url: '/about', snippet: '', kind: 'page' as const },
  ]

  it('narrows to one collection', () => {
    expect(filterSearchResults(results, 'changelog')).toEqual([results[1]])
    expect(filterSearchResults(results, 'pages')).toEqual([results[2]])
  })

  it('shows everything for All, and for an absent tab', () => {
    expect(filterSearchResults(results, SEARCH_FACET_ALL)).toEqual(results)
    expect(filterSearchResults(results, undefined)).toEqual(results)
  })

  it('shows everything for an UNKNOWN ?in=, never an empty page', () => {
    // A stale bookmark or a hand-edited URL must not be able to make a site
    // with three matches look like a site with none — the reader would read
    // that as "nothing here", not as "that tab is gone".
    expect(filterSearchResults(results, 'products')).toEqual(results)
  })
})

/* ── The read behind the counts ──────────────────────────────────────── */

interface EntrySeed {
  id: string
  title: string
  slug: string
  excerpt?: string
  body?: string
  publishedAt?: { seconds: number }
}
interface CollectionSeed {
  id: string
  slug: string
  displayName: string
  kind?: string
  entries: EntrySeed[]
}

const seed = (collections: CollectionSeed[]) => {
  const hostRef = {
    collection: (name: string) => {
      if (name === 'collections') {
        return {
          limit: () => ({
            get: async () => ({
              docs: collections.map((collection) => ({
                id: collection.id,
                data: () => ({ kind: collection.kind ?? 'content' }),
                get: (field: string) =>
                  field === 'slug'
                    ? collection.slug
                    : field === 'displayName'
                      ? collection.displayName
                      : undefined,
                ref: {
                  collection: () => ({
                    where: () => ({
                      limit: () => ({
                        get: async () => ({
                          docs: collection.entries.map((seedEntry) => ({
                            id: seedEntry.id,
                            data: () => seedEntry,
                            get: (field: string) =>
                              (seedEntry as any)[field],
                          })),
                        }),
                      }),
                    }),
                  }),
                },
              })),
            }),
          }),
        }
      }
      // No screens in this suite: the routing map below is empty, so the
      // screen branch never reaches Firestore.
      return { doc: () => ({ get: async () => ({ exists: false }) }) }
    },
  }
  ;(firebaseAdmin.app as jest.Mock).mockReturnValue({
    firestore: () => ({ collection: () => ({ doc: () => hostRef }) }),
  })
  ;(orgDataQueryForHost as jest.Mock).mockResolvedValue({
    query: { limit: () => ({ get: async () => ({ docs: [] }) }) },
  })
  return { host: { $id: HOST_ID, screens: {} } as any }
}

const SITE: CollectionSeed[] = [
  {
    id: 'c_blog',
    slug: 'blog',
    displayName: 'Blog',
    entries: [
      {
        id: 'e1',
        title: 'One platform, not a stack',
        slug: 'one-platform',
        excerpt: 'commerce, forms and media in one place',
        publishedAt: { seconds: 1_700_000_000 },
      },
      {
        id: 'e2',
        title: 'Design it live',
        slug: 'design-it-live',
        excerpt: 'how the besigner renders a page',
      },
    ],
  },
  {
    id: 'c_changelog',
    slug: 'changelog',
    displayName: 'Changelog',
    entries: [
      { id: 'e3', title: 'Platform 2.1', slug: 'platform-2-1', excerpt: '' },
    ],
  },
  {
    id: 'c_news',
    slug: 'newsroom',
    displayName: 'Press',
    entries: [
      {
        id: 'e4',
        title: 'Aglyn in the press',
        slug: 'in-the-press',
        excerpt: '',
        body: 'a long write-up mentioning the platform at length',
      },
    ],
  },
]

describe('searchContent attribution and matcher (AGL-1525)', () => {
  afterEach(() => jest.clearAllMocks())

  it('stamps every entry hit with its collection, for the tabs', () => {
    // Without this the results page has nothing to group by and the frame's
    // tab row cannot exist at all.
    const { host } = seed(SITE)
    return searchContent({ host, query: 'platform' }).then((results) => {
      const slugs = results.map((result) => result.collection?.slug)
      expect(new Set(slugs)).toEqual(
        new Set(['blog', 'changelog', 'newsroom']),
      )
      expect(
        results.find((result) => result.url === '/changelog/platform-2-1')
          ?.collection,
      ).toEqual({ slug: 'changelog', title: 'Changelog' })
    })
  })

  it('carries the published date onto the result card', async () => {
    const { host } = seed(SITE)
    const results = await searchContent({ host, query: 'platform' })
    const hit = results.find((result) => result.url === '/blog/one-platform')
    expect(hit?.date).toBeTruthy()
    // The entry with no `publishedAt` gets no date rather than an epoch.
    const undated = await searchContent({ host, query: 'besigner' })
    expect(undated[0]?.url).toBe('/blog/design-it-live')
    expect(undated[0]?.date).toBeUndefined()
  })

  it('answers a TYPO the suggestion panel forgave (AGL-1525)', async () => {
    // THE cross-half guarantee. The panel fuzzes with
    // COLLECTION_SEARCH_FUSE_OPTIONS, shows "One platform, not a stack" for
    // "platfrom", and offers "View all results" — which lands here. Matched
    // by substring alone, this page answered that click with an empty page:
    // the reader saw their post, asked for more, and was told there was
    // none.
    const { host } = seed(SITE)
    const results = await searchContent({ host, query: 'platfrom' })
    expect(results.map((result) => result.url)).toContain(
      '/blog/one-platform',
    )
  })

  it('still matches the BODY by substring, the wider net of the two', () => {
    // The block never indexed bodies, so this page must keep finding what
    // only the body mentions — narrowing it to the fuzzy keys would lose
    // results the old page returned.
    const { host } = seed(SITE)
    return searchContent({ host, query: 'write-up' }).then((results) => {
      expect(results.map((result) => result.url)).toEqual([
        '/newsroom/in-the-press',
      ])
    })
  })

  it('skips a commerce catalog sharing the collections path (AGL-954)', async () => {
    const { host } = seed([
      ...SITE,
      {
        id: 'c_catalog',
        slug: 'shop',
        displayName: 'Shop',
        kind: 'catalog',
        entries: [{ id: 'p1', title: 'Platform tee', slug: 'tee' }],
      },
    ])
    const results = await searchContent({ host, query: 'platform' })
    expect(results.map((result) => result.collection?.slug)).not.toContain(
      'shop',
    )
  })
})
