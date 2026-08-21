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
 * How /search COMPOSES the count tabs with the active filter (AGL-1525,
 * frame 599:1218).
 *
 * `searchResultFacets` and `filterSearchResults` are each correct in
 * isolation and are tested that way in `search-results-facets.spec.ts`. This
 * suite exists because the ORDER they run in is a third decision that
 * neither of them can observe: count the facets from the FILTERED list and
 * every tab but the active one reads "· 0", while both functions keep
 * returning exactly what their own tests demand.
 *
 * The page is an async Server Component, so it is awaited directly and the
 * element it returns is inspected — the props handed to the presentational
 * component ARE the page's output, and asserting them needs no DOM.
 */

jest.mock('next/navigation', () => ({
  __esModule: true,
  notFound: jest.fn(() => {
    throw new Error('notFound')
  }),
}))
jest.mock('../app/[host]/host-data', () => ({
  __esModule: true,
  getHostCached: jest.fn(),
}))
// The REAL facet arithmetic — only the Firestore-backed read is doubled.
// Mocking `searchResultFacets` here would leave this suite asserting its own
// stub's call order and nothing about the page.
jest.mock('../utils/search-content', () => {
  const actual = jest.requireActual('../utils/search-content')
  return {
    __esModule: true,
    ...actual,
    default: jest.fn(),
  }
})
// The presentational component is a `'use client'` MUI tree; the page's
// contract with it is the props, so it is stubbed to a marker.
jest.mock('../app/[host]/search/search-results.component', () => ({
  __esModule: true,
  default: 'SearchResults',
}))

import type { SearchResult } from '../utils/search-content'
import searchContent from '../utils/search-content'
import { getHostCached } from '../app/[host]/host-data'
import SearchPage from '../app/[host]/search/page'

const mockSearch = searchContent as jest.MockedFunction<typeof searchContent>
const mockHost = getHostCached as jest.MockedFunction<typeof getHostCached>

const entry = (
  slug: string,
  collection: { slug: string; title: string },
): SearchResult => ({
  title: `Post ${slug}`,
  url: `/${collection.slug}/${slug}`,
  snippet: '',
  kind: 'entry',
  collection,
})

const BLOG = { slug: 'blog', title: 'Blog' }
const CHANGELOG = { slug: 'changelog', title: 'Changelog' }
const NEWSROOM = { slug: 'newsroom', title: 'Press' }

const RESULTS = [
  entry('a', BLOG),
  entry('b', BLOG),
  entry('c', BLOG),
  entry('d', BLOG),
  entry('e', CHANGELOG),
  entry('f', NEWSROOM),
]

const renderPage = async (query: Record<string, string>) =>
  (await SearchPage({
    params: Promise.resolve({ host: 'acme' }),
    searchParams: Promise.resolve(query),
  })) as any

describe('/search composition (AGL-1525)', () => {
  beforeEach(() => {
    mockHost.mockResolvedValue({ host: { $id: 'host_acme' } } as any)
    mockSearch.mockResolvedValue(RESULTS)
  })
  afterEach(() => jest.clearAllMocks())

  it('counts the tabs over ALL results while showing one collection', async () => {
    const element = await renderPage({ q: 'platform', in: 'changelog' })
    // Filtered to the tab the reader picked…
    expect(element.props.results).toEqual([RESULTS[4]])
    // …while every tab still reports the whole result set. This is the
    // ordering guard: facets from the filtered list would read
    // All · 1, Blog · 0, Changelog · 1, Press · 0.
    expect(element.props.facets).toEqual([
      { key: 'all', label: 'All', count: 6 },
      { key: 'blog', label: 'Blog', count: 4 },
      { key: 'changelog', label: 'Changelog', count: 1 },
      { key: 'newsroom', label: 'Press', count: 1 },
    ])
    expect(element.props.activeFacet).toBe('changelog')
  })

  it('defaults to All with nothing filtered out', async () => {
    const element = await renderPage({ q: 'platform' })
    expect(element.props.results).toHaveLength(6)
    expect(element.props.activeFacet).toBe('all')
  })

  it('falls the ACTIVE tab back to All on an unknown ?in=', async () => {
    // The filter already fell back to showing everything, so leaving the
    // stale tab highlighted would caption the wrong list — six results under
    // a lit "Products" tab.
    const element = await renderPage({ q: 'platform', in: 'products' })
    expect(element.props.results).toHaveLength(6)
    expect(element.props.activeFacet).toBe('all')
  })

  it('searches nothing at all without a query', async () => {
    const element = await renderPage({})
    expect(mockSearch).not.toHaveBeenCalled()
    expect(element.props.results).toEqual([])
    expect(element.props.facets).toEqual([])
  })

  it('passes the query through for the heading, clamped at 100 chars', async () => {
    // The heading is `Results for “…”`; the clamp is the existing AGL-88
    // bound on what reaches Firestore and must survive the rewrite.
    const long = 'x'.repeat(250)
    const element = await renderPage({ q: long })
    expect(element.props.query).toHaveLength(100)
  })
})
