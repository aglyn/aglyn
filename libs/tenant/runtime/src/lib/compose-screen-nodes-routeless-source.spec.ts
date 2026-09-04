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
 * A source whose slug is a KEY, not an address (AGL-2524).
 *
 * The author page mixes collections, so it hands the compose pipeline a
 * synthetic collection slug with its entries already in hand. Most blocks are
 * fine with that — every entry carries its own `collectionSlug` and builds
 * `entry.url` from it. Category Pills are the exception: a category is a
 * filter on ONE collection's listing, so the block builds
 * `/{slug}/category/{x}` out of the source's slug, and on the author page that
 * route does not exist.
 *
 * These cases pin the three behaviours that matter: an unbound pills block
 * renders nothing on a routeless page, a BOUND one still works there, and an
 * ordinary collection listing is untouched.
 */

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetComponents = jest.fn()
const mockGetVariables = jest.fn()
const mockGetFunctions = jest.fn()
const mockGetDatasets = jest.fn()
const mockGetWorkflows = jest.fn()
const mockGetPluginInstalls = jest.fn()
const mockGetForms = jest.fn()
const mockGetPublishedCollectionSource = jest.fn()

jest.mock('./get-layout-version', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPublishedLayoutVersion(...a),
}))
jest.mock('./get-components', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetComponents(...a),
}))
jest.mock('./get-forms', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetForms(...a),
}))
jest.mock('./get-datasets', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetDatasets(...a),
}))
jest.mock('./get-plugin-installs', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPluginInstalls(...a),
}))
jest.mock('./get-variables', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetVariables(...a),
  getFunctions: (...a: unknown[]) => mockGetFunctions(...a),
  getWorkflows: (...a: unknown[]) => mockGetWorkflows(...a),
}))
jest.mock('./get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: (...a: unknown[]) =>
    mockGetPublishedCollectionSource(...a),
}))
jest.mock('./apply-publish-schedule', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('./get-screen-version', () => ({
  __esModule: true,
  default: jest.fn(),
}))

import { composeNodesWithChrome } from './compose-screen-nodes'

const ROOT = '_@_'

const CATEGORIES = [
  { id: 'guides', name: 'Guides' },
  { id: 'engineering', name: 'Engineering' },
]

const entry = (id: string, collectionSlug?: string) => ({
  $id: id,
  title: id,
  slug: id,
  categoryId: 'guides',
  ...(collectionSlug ? { collectionSlug, collectionName: collectionSlug } : {}),
})

/** A page carrying one Category Pills block, optionally bound. */
const pageWithPills = (props: Record<string, unknown> = {}) => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['pills'] },
  pills: {
    $id: 'pills',
    componentId: 'collectionCategories',
    pluginId: 'mui',
    parentId: ROOT,
    props,
  },
})

const pillItems = (nodes: Record<string, any>) =>
  (nodes?.['pills']?.props?.items ?? []) as Array<{ href?: string }>

beforeEach(() => {
  jest.clearAllMocks()
  mockGetPublishedLayoutVersion.mockResolvedValue({ version: null })
  mockGetComponents.mockResolvedValue({ components: [] })
  mockGetForms.mockResolvedValue({ forms: [] })
  mockGetDatasets.mockResolvedValue({ datasets: [] })
  mockGetPluginInstalls.mockResolvedValue({ installs: [] })
  mockGetVariables.mockResolvedValue({ variables: [] })
  mockGetFunctions.mockResolvedValue({ functions: [] })
  mockGetWorkflows.mockResolvedValue({ workflows: [] })
  mockGetPublishedCollectionSource.mockResolvedValue({
    collection: { slug: 'blog' },
    entries: [entry('post-a')],
    categories: CATEGORIES,
    reachedBound: false,
  })
})

describe('category pills against a routeless source (AGL-2524)', () => {
  it('renders NOTHING for an unbound block on an author page', async () => {
    /*
      The defect. Without the guard the block stamps
      `/__author__/category/guides` — a dead link on a page every byline on
      the site now points at.

      Nothing is the honest answer rather than a fallback: the page spans
      every collection, there is no `/author/{slug}/category/{x}` to lead to,
      and the only real destination would be one collection's own listing,
      which drops the author the reader came to see.
    */
    const nodes = await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: pageWithPills() as never,
      collection: {
        slug: '__author__',
        routeless: true,
        entries: [entry('post-a', 'blog'), entry('note-a', 'changelog')] as never,
        categories: CATEGORIES,
      },
    })
    expect(pillItems(nodes as never)).toEqual([])
  })

  it('still resolves a block that NAMES a collection there', async () => {
    // "Browse the blog by category" beside an archive is a sensible thing to
    // build, and it addresses a route that exists — so the guard must not
    // reach it.
    const nodes = await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: pageWithPills({ collectionSlug: 'blog' }) as never,
      collection: {
        slug: '__author__',
        routeless: true,
        entries: [entry('post-a', 'blog')] as never,
        categories: CATEGORIES,
      },
    })
    const hrefs = pillItems(nodes as never).map((item) => item.href)
    expect(hrefs).toContain('/blog/category/guides')
    expect(hrefs.some((h) => String(h).includes('__author__'))).toBe(false)
  })

  it('leaves an ordinary collection listing exactly as it was', async () => {
    // The routed listing is the case this must not touch: an unbound block
    // there inherits the routed collection and is correct.
    const nodes = await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: pageWithPills() as never,
      collection: {
        slug: 'blog',
        entries: [entry('post-a')] as never,
        categories: CATEGORIES,
      },
    })
    expect(pillItems(nodes as never).map((item) => item.href)).toContain(
      '/blog/category/guides',
    )
  })
})
