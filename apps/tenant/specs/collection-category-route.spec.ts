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
 * The category-filtered listing route (AGL-1321): `/{collection}/category/
 * {slug}` and its paginated form, served by the SAME collection branch — and
 * the same list template — that already serves `/{collection}` and
 * `/{collection}/page/{n}`.
 *
 * Why a path and not `?category=`, asserted here because it is the whole
 * design decision: this loader is ISR-cached per URL PATH. A query string is
 * not part of that key, so every `?category=` variant would share `/blog`'s
 * cache entry and serve whichever category rendered first to everybody — the
 * exact class of bug an ISR cache key invites. Reading `searchParams` at all
 * would additionally opt the entire tenant catch-all out of static rendering.
 *
 * So the assertions below are about the route table AND about separation: each
 * category resolves to its own path, asks the reader for its own category, and
 * comes back with its own content.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => []),
  getRealmPluginInstalls: jest.fn(async () => []),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
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
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/compose-collection-page', () => ({
  __esModule: true,
  composeCollectionTemplatePage: jest.fn(async () => null),
  composeCollectionFallbackPage: jest.fn(async () => null),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
}))

import { composeCollectionTemplatePage } from '@aglyn/tenant-runtime/compose-collection-page'
import getCollectionContent from '@aglyn/tenant-runtime/get-collection-content'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock
const mockCollectionContent = getCollectionContent as jest.Mock
const mockComposeTemplate = composeCollectionTemplatePage as jest.Mock

const CATEGORIES = [
  { id: 'product', name: 'Product' },
  { id: 'opensrc', name: 'Open source' },
]

const COLLECTION = {
  $id: 'col-blog',
  displayName: 'Blog',
  slug: 'blog',
  listScreenId: 'blogListTmpl',
  entryScreenId: 'blogEntryTmpl',
  categories: CATEGORIES,
}

/** Stands in for the real reader: filters, then paginates the filtered set. */
const ENTRIES = [
  { $id: 'p1', title: 'Product one', slug: 'p1', categoryId: 'product' },
  { $id: 'p2', title: 'Product two', slug: 'p2', categoryId: 'product' },
  { $id: 'o1', title: 'Open one', slug: 'o1', categoryId: 'opensrc' },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockGetHost.mockResolvedValue({
    host: { $id: 'host-1', subdomain: 'acme', screens: { home: '/' } },
    error: null,
  })
  mockCollectionContent.mockImplementation(async (options: any) => {
    if (options.collectionSlug !== 'blog') {
      return { collection: null, entries: [], entry: null, error: null }
    }
    const wanted = options.categorySlug
    const entries = wanted
      ? ENTRIES.filter(
          (item) =>
            item.categoryId === wanted ||
            (wanted === 'open-source' && item.categoryId === 'opensrc'),
        )
      : ENTRIES
    return {
      collection: COLLECTION,
      entries,
      entry: null,
      category: wanted
        ? {
            slug: wanted,
            name: wanted === 'ghosts' ? wanted : 'Named',
            known: wanted !== 'ghosts',
          }
        : null,
      pagination: {
        page: options.page ?? 1,
        perPage: options.perPage ?? 10,
        totalEntries: entries.length,
        totalPages: Math.max(1, Math.ceil(entries.length / (options.perPage ?? 10))),
      },
      error: null,
    }
  })
  mockComposeTemplate.mockImplementation(async ({ content }: any) => ({
    screen: { $id: 'blogListTmpl' },
    nodes: { root: {} },
    content,
  }))
})

describe('category listing routes (AGL-1321)', () => {
  it('routes /{collection}/category/{slug} through the LIST template', async () => {
    const result: any = await loadPageData('acme', ['blog', 'category', 'product'])

    expect(result.notFound).toBeUndefined()
    // The same list template `/blog` uses — not a third page shape.
    expect(result.props.data.screen.data.$id).toBe('blogListTmpl')
    expect(mockCollectionContent).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionSlug: 'blog',
        categorySlug: 'product',
        page: 1,
        perPage: 10,
      }),
    )
  })

  it('selects only that category’s entries', async () => {
    const result: any = await loadPageData('acme', ['blog', 'category', 'product'])

    expect(result.props.content.entries.map((item: any) => item.$id)).toEqual([
      'p1',
      'p2',
    ])
  })

  it('paginates WITHIN the category, page and filter composed', async () => {
    await loadPageData('acme', ['blog', 'category', 'opensrc', 'page', '2'])

    expect(mockCollectionContent).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionSlug: 'blog',
        categorySlug: 'opensrc',
        page: 2,
        // 10/page is real (AGL-1170) and applies to the FILTERED set.
        perPage: 10,
      }),
    )
  })

  it('404s a category page past the end rather than serving an empty one', async () => {
    const beyond: any = await loadPageData('acme', [
      'blog',
      'category',
      'opensrc',
      'page',
      '9',
    ])

    expect(beyond.notFound).toBe(true)
  })

  it('renders an unknown category as an empty listing, never a crash', async () => {
    const result: any = await loadPageData('acme', ['blog', 'category', 'ghosts'])

    expect(result.notFound).toBeUndefined()
    expect(result.props.content.entries).toEqual([])
    // Page 1 of an empty list is still in range, so the listing renders and
    // the empty state speaks for it.
    expect(result.props.content.category).toEqual({
      slug: 'ghosts',
      name: 'ghosts',
      known: false,
    })
  })

  it('keeps All as the canonical unfiltered URL', async () => {
    await loadPageData('acme', ['blog'])

    // No category key at all — `/blog` is the address of the unfiltered
    // listing, so there is no second URL that means the same thing.
    const options = mockCollectionContent.mock.calls[0][0]
    expect(options.categorySlug).toBeUndefined()
    expect(options.page).toBe(1)
  })

  it('gives each category its own content — no shared entry', async () => {
    // The cache-key claim, from the loader's side. The ISR entry is keyed by
    // PATH and these are three different paths; what this asserts is that
    // nothing upstream collapses them — each render asks for its own
    // category and gets its own answer, so one category's HTML can never be
    // built from another's data.
    const product: any = await loadPageData('acme', ['blog', 'category', 'product'])
    const open: any = await loadPageData('acme', ['blog', 'category', 'opensrc'])
    const all: any = await loadPageData('acme', ['blog'])

    expect(product.props.content.entries.map((item: any) => item.$id)).toEqual([
      'p1',
      'p2',
    ])
    expect(open.props.content.entries.map((item: any) => item.$id)).toEqual([
      'o1',
    ])
    expect(all.props.content.entries).toHaveLength(3)
    expect(
      mockCollectionContent.mock.calls.map((call) => call[0].categorySlug),
    ).toEqual(['product', 'opensrc', undefined])
  })

  it('leaves the existing list, paged-list and entry routes alone', async () => {
    await loadPageData('acme', ['blog', 'page', '2'])
    expect(mockCollectionContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ collectionSlug: 'blog', page: 2 }),
    )

    await loadPageData('acme', ['blog', 'hello'])
    expect(mockCollectionContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ collectionSlug: 'blog', entrySlug: 'hello' }),
    )
  })

  it('404s a malformed category path instead of guessing', async () => {
    const noSlug: any = await loadPageData('acme', [
      'blog',
      'category',
      'product',
      'extra',
    ])
    expect(noSlug.notFound).toBe(true)
    // The reader is never asked about a path the route table does not know.
    expect(mockCollectionContent).not.toHaveBeenCalled()
  })
})
