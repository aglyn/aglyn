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
 * A listing's PROPS carry the page, and compose still gets the whole set
 * (AGL-3213).
 *
 * `getCollectionContent` hands back every entry of the narrowed listing — up
 * to `COLLECTION_SOURCE_MAX` of them — because the Collection entries block
 * windows for itself, off its own props: its own `perPage`, its own pinned
 * `page`, `firstPageOnly`, its own filters. Narrowing before compose
 * double-windows and empties every page after the first, which is a mistake
 * this repo has already made once and documented at the source.
 *
 * Past compose nothing wants the remainder, and two readers were actively
 * harmed by it. The `ItemList` JSON-LD numbers its items off
 * `pagination.page`, on the premise that `entries` IS the page — so
 * `/blog/page/7` published a hundred items at positions 61–160. The legacy
 * fallback renderer maps `entries` with no window of its own, so every
 * `/page/{n}` rendered the entire list. Both are reading `entries` as the
 * page; the loader now means it.
 *
 * THE TWO ASSERTIONS ARE A PAIR and must stay one: "compose got everything"
 * alone passes against a loader that windows nothing, and "props got ten"
 * alone passes against a loader that windows too early. Only together do they
 * pin the boundary between them.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  getPlatformLockdown: jest.fn(async () => null),
  getDomainLockdown: jest.fn(async () => null),
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
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
    collectionListings: {} as Record<string, string>,
  })),
}))

import {
  composeCollectionFallbackPage,
  composeCollectionTemplatePage,
} from '@aglyn/tenant-runtime/compose-collection-page'
import getCollectionContent from '@aglyn/tenant-runtime/get-collection-content'
import { loadPageData } from '../app/[host]/[scheme]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock
const mockCollectionContent = getCollectionContent as jest.Mock
const mockComposeTemplate = composeCollectionTemplatePage as jest.Mock
const mockComposeFallback = composeCollectionFallbackPage as jest.Mock

const COLLECTION = { $id: 'col-blog', displayName: 'Blog', slug: 'blog' }
const PER_PAGE = 10
/** A collection at the read bound — the shape `/changelog` is in today. */
const ENTRIES = Array.from({ length: 100 }, (_, i) => ({
  $id: `e${i + 1}`,
  title: `Post ${i + 1}`,
  slug: `post-${i + 1}`,
}))

const slugsOf = (rows: unknown): string[] =>
  (rows as { slug: string }[]).map((row) => row.slug)

/** The loader's answer for `/blog/page/{page}` over the full 100. */
const listPage = async (page: number) => {
  mockCollectionContent.mockResolvedValue({
    collection: COLLECTION,
    // What `getCollectionContent` really returns on a list route: the whole
    // narrowed set, with pagination describing the page that was asked for.
    entries: ENTRIES,
    entry: null,
    pagination: {
      page,
      perPage: PER_PAGE,
      totalEntries: ENTRIES.length,
      totalPages: 10,
    },
    error: null,
  })
  const segments = page === 1 ? ['blog'] : ['blog', 'page', String(page)]
  return (await loadPageData('acme', segments)) as any
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetHost.mockResolvedValue({
    host: { $id: 'host-1', subdomain: 'acme', screens: { home: '/' } },
    error: null,
  })
  mockComposeTemplate.mockResolvedValue(null)
  mockComposeFallback.mockResolvedValue({ nodes: { root: {} } })
})

describe('a listing page carries its own entries and no others (AGL-3213)', () => {
  it('ships the page window, not the whole collection', async () => {
    const result = await listPage(7)

    expect(slugsOf(result.props.content.entries)).toEqual(
      slugsOf(ENTRIES.slice(60, 70)),
    )
  })

  it('still hands compose the WHOLE set, which windows for itself', async () => {
    await listPage(7)

    // The block reads `perPage`/`page` off its own props and slices there
    // (`expandCollectionEntries`); handed ten it would slice `[60, 70)` of a
    // ten-element array and render an empty page under a working pager.
    expect(mockComposeFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ entries: ENTRIES }),
      }),
    )
  })

  it('windows the template path the same way', async () => {
    mockComposeTemplate.mockResolvedValue({
      screen: { $id: 'blogListTmpl' },
      nodes: { root: {} },
    })
    const result = await listPage(3)

    expect(mockComposeTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ entries: ENTRIES }),
      }),
    )
    expect(slugsOf(result.props.content.entries)).toEqual(
      slugsOf(ENTRIES.slice(20, 30)),
    )
  })

  it('leaves the pagination itself describing the whole listing', async () => {
    // The window narrows the ENTRIES and nothing else: the pager still has to
    // say "page 7 of 10" out of a hundred, or narrowing the list would take
    // the rest of it off the site.
    const result = await listPage(7)

    expect(result.props.content.pagination).toEqual({
      page: 7,
      perPage: PER_PAGE,
      totalEntries: 100,
      totalPages: 10,
    })
  })

  it('leaves an ENTRY route, which has no pagination, untouched', async () => {
    mockCollectionContent.mockResolvedValue({
      collection: COLLECTION,
      entries: [],
      entry: { $id: 'e1', title: 'Post 1', slug: 'post-1' },
      error: null,
    })

    const result: any = await loadPageData('acme', ['blog', 'post-1'])

    expect(result.props.content.entry.slug).toBe('post-1')
    expect(result.props.content.entries).toEqual([])
  })
})
