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
 * A content collection goes live with its first published entry (AGL-3101).
 *
 * Every public address a collection has is driven here through the REAL
 * `getCollectionContent`, over a Firestore stand-in holding one `videos`
 * collection: the listing, its paged and category forms, its markdown twin and
 * its RSS feed. Mocking the reader, as the other loader specs do, would mock
 * away the decision under test — the loader, the feed and the twin all 404 on
 * the same `collection: null`, and whether an empty collection produces one is
 * the whole question.
 *
 * Both sides are pinned: nothing live is a 404 at every address, and a live
 * collection is served exactly as before, an empty category of it included.
 */

interface MockRow {
  id: string
  data: Record<string, unknown>
}

/** The one collection on the site, and what is in it. */
const mockSite: { collection: MockRow; entries: MockRow[] } = {
  collection: { id: 'col-videos', data: {} },
  entries: [],
}

/**
 * `where` (`==` and `in`), `select`, `limit` and `get` — the four calls the
 * reader makes. `where` and `limit` are honored rather than ignored: the entry
 * route reads ONE document by slug, and a fake that answered it with the
 * listing would let a wrong read pass.
 *
 * `select` returns the builder untouched (AGL-3213). This suite's subject is
 * which addresses resolve, not which bytes arrive, and the mask's own
 * completeness is pinned where it belongs — the fake in
 * `get-collection-content.spec.ts` applies it for real.
 */
function mockQuery(rows: () => MockRow[]): any {
  const filters: Array<(row: MockRow) => boolean> = []
  let take = Number.POSITIVE_INFINITY
  const query: any = {
    where: (field: string, op: string, wanted: unknown) => {
      filters.push((row) =>
        op === 'in'
          ? (wanted as unknown[]).includes(row.data[field])
          : row.data[field] === wanted,
      )
      return query
    },
    select: () => query,
    limit: (count: number) => {
      take = count
      return query
    },
    get: async () => ({
      docs: rows()
        .filter((row) => filters.every((matches) => matches(row)))
        .slice(0, take)
        .map(mockSnapshot),
    }),
  }
  return query
}

const mockSnapshot = (row: MockRow): any => ({
  id: row.id,
  exists: true,
  data: () => ({ ...row.data }),
  get: (field: string) => row.data[field],
  ref: {
    update: async () => undefined,
    collection: (name: string) =>
      mockQuery(() => (name === 'entries' ? mockSite.entries : [])),
  },
})

const mockFirestore = {
  collection: () => ({
    doc: () => ({
      collection: (name: string) =>
        name === 'collections'
          ? mockQuery(() => [mockSite.collection])
          : mockQuery(() => []),
    }),
  }),
  getAll: async () => [],
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
  // Lockdown (AGL-1501): nothing is locked in these scenarios.
  getPlatformLockdown: jest.fn(async () => null),
  visitorContentRefusal: jest.fn(async () => null),
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => []),
  getRealmPluginInstalls: jest.fn(async () => []),
  getOrgForHost: jest.fn(async () => ({
    orgId: 'org-1',
    org: { plan: 'business' },
  })),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    host: {
      $id: 'host-1',
      subdomain: 'acme',
      cname: 'acme.test',
      screens: { home: '/' },
    },
    error: null,
  })),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ org: { $id: 'org-1' } })),
}))
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: jest.fn(async () => undefined) },
}))
jest.mock('../utils/render-timings', () => ({
  __esModule: true,
  startRenderTimer: () => ({ mark: () => undefined, report: () => undefined }),
}))
jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ root: {} })),
  composeNodesWithChrome: jest.fn(async () => ({ root: {} })),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ screen: null, error: null })),
}))
// The page's DESIGN is not under test, only whether there is a page: with no
// template and no designed built-in the loader answers the plain listing, and
// every assertion below reads `notFound` and `content` rather than nodes.
jest.mock('@aglyn/tenant-runtime/compose-collection-page', () => ({
  __esModule: true,
  composeCollectionTemplatePage: jest.fn(async () => null),
  composeCollectionFallbackPage: jest.fn(async () => null),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
    collectionListings: {} as Record<string, string>,
  })),
}))

import { loadPageData } from '../app/[host]/[scheme]/[[...slug]]/load-page-data'
import { GET as rssGet } from '../app/api/collections-rss/route'
import { GET as markdownGet } from '../app/api/markdown/route'

const nowSeconds = () => Math.floor(Date.now() / 1000)

const video = (status: 'published' | 'draft'): MockRow => ({
  id: 'video-1',
  data: {
    title: 'First video',
    slug: 'first-video',
    status,
    categoryId: 'demos',
    ...(status === 'published'
      ? { publishedAt: { seconds: nowSeconds() - 3600 } }
      : {}),
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockSite.collection = {
    id: 'col-videos',
    data: {
      kind: 'content',
      slug: 'videos',
      displayName: 'Videos',
      categories: [
        { id: 'demos', name: 'Demos' },
        { id: 'talks', name: 'Talks' },
      ],
    },
  }
  mockSite.entries = []
})

/** Every shape of the listing address, as the router parses it. */
const LISTING_ADDRESSES: Array<[string, string[]]> = [
  ['/videos', ['videos']],
  ['/videos/page/1', ['videos', 'page', '1']],
  ['/videos/category/demos', ['videos', 'category', 'demos']],
  ['/videos/category/demos/page/1', ['videos', 'category', 'demos', 'page', '1']],
]

const markdownFor = (path: string) =>
  markdownGet(
    new Request('https://acme.test/api/markdown', {
      headers: {
        host: 'acme.test',
        'x-aglyn-tenant-host': 'acme',
        'x-aglyn-markdown-path': path,
      },
    }),
  )

const feedFor = (collection: string) =>
  rssGet(
    new Request(
      `https://acme.test/api/collections-rss?host=acme&collection=${collection}`,
      { headers: { host: 'acme.test' } },
    ),
  )

describe('a collection with nothing published is not a page (AGL-3101)', () => {
  it.each(LISTING_ADDRESSES)('404s %s', async (_path, segments) => {
    const result: any = await loadPageData('acme', segments)
    expect(result.notFound).toBe(true)
  })

  it('404s its markdown twin', async () => {
    const response = await markdownFor('videos')
    expect(response.status).toBe(404)
  })

  it('404s its RSS feed rather than serving an empty channel', async () => {
    const response = await feedFor('videos')
    expect(response.status).toBe(404)
  })

  it('stays down while its only entry is a draft', async () => {
    mockSite.entries = [video('draft')]
    const result: any = await loadPageData('acme', ['videos'])
    expect(result.notFound).toBe(true)
    expect((await feedFor('videos')).status).toBe(404)
  })
})

describe('its first published entry makes it one', () => {
  it('goes live the moment that entry is published', async () => {
    mockSite.entries = [video('draft')]
    expect(((await loadPageData('acme', ['videos'])) as any).notFound).toBe(true)

    mockSite.entries = [video('published')]
    const result: any = await loadPageData('acme', ['videos'])
    expect(result.notFound).toBeUndefined()
    expect(result.props.content.collection.slug).toBe('videos')
    expect(
      result.props.content.entries.map((entry: any) => entry.slug),
    ).toEqual(['first-video'])
  })

  it.each(LISTING_ADDRESSES)('serves %s', async (_path, segments) => {
    mockSite.entries = [video('published')]
    const result: any = await loadPageData('acme', segments)
    expect(result.notFound).toBeUndefined()
    expect(result.props.content.collection.slug).toBe('videos')
  })

  it('still serves an EMPTY category of a live collection', async () => {
    mockSite.entries = [video('published')]
    const result: any = await loadPageData('acme', ['videos', 'category', 'talks'])
    // A thin category renders its empty state, as it always has, so a reader
    // can pick another pill rather than land on a 404.
    expect(result.notFound).toBeUndefined()
    expect(result.props.content.entries).toEqual([])
    expect(result.props.content.category).toMatchObject({
      slug: 'talks',
      known: true,
    })
  })

  it('still 404s a page past the end of a live collection', async () => {
    mockSite.entries = [video('published')]
    const result: any = await loadPageData('acme', ['videos', 'page', '2'])
    expect(result.notFound).toBe(true)
  })

  it('serves its markdown twin', async () => {
    mockSite.entries = [video('published')]
    const response = await markdownFor('videos')
    expect(response.status).toBe(200)
    expect((await response.text()).split('\n')[0]).toBe('# Videos')
  })

  it('serves its RSS feed, carrying the entry', async () => {
    mockSite.entries = [video('published')]
    const response = await feedFor('videos')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(
      '<link>https://acme.test/videos/first-video</link>',
    )
  })

  it('serves the entry page itself', async () => {
    mockSite.entries = [video('published')]
    const result: any = await loadPageData('acme', ['videos', 'first-video'])
    expect(result.notFound).toBeUndefined()
    expect(result.props.content.entry.slug).toBe('first-video')
  })
})
