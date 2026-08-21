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
 * The shape and the arithmetic of site-search results (AGL-1525) — the half
 * of `search-content.ts` that the `'use client'` results page needs.
 *
 * Split into its own file for a reason a type-only import would not have
 * caught: the component reads `SEARCH_FACET_ALL`, a VALUE, and importing a
 * value from `search-content` puts that module in the client graph. It
 * imports `@aglyn/tenant-data-admin`, so the browser bundle started pulling
 * firebase-admin and `@google-cloud/storage` behind it and the production
 * build died on `Can't resolve 'child_process'` — 76 errors, none of which
 * named this file.
 *
 * Nothing here may import Firestore, the Admin SDK, or anything that
 * reaches them. It is plain data and pure functions on purpose.
 */

export interface SearchResult {
  title: string
  url: string
  snippet: string
  kind: 'page' | 'entry' | 'data'
  /**
   * Which content collection this entry came from (AGL-1525) — the results
   * page groups its count tabs by it ("Blog · 4", "Changelog · 1"). Absent
   * on pages and dataset records, which belong to no collection.
   */
  collection?: { slug: string; title: string }
  /** Published date, for the result card (AGL-1525). */
  date?: string
}

/** The unfiltered tab, and the bucket every non-collection result falls in. */
export const SEARCH_FACET_ALL = 'all'
export const SEARCH_FACET_PAGES = 'pages'

export interface SearchFacet {
  /** `?in=` value; `all` is the unfiltered default. */
  key: string
  label: string
  count: number
}

/**
 * The count tabs on the results page (frame 599:1218) — "All · 6, Blog · 4,
 * Changelog · 1, Press · 1".
 *
 * Derived from the results rather than counted separately, which is what
 * keeps a tab from promising rows the page cannot show: `All` is the length
 * of the list, and every other count is a partition of that same list, so
 * the totals cannot drift apart. Collection tabs keep the order the results
 * arrived in, so the busiest collection is not silently promoted over the
 * one the site lists first.
 */
export function searchResultFacets(results: SearchResult[]): SearchFacet[] {
  const byKey = new Map<string, SearchFacet>()
  for (const result of results) {
    const key = result.collection?.slug ?? SEARCH_FACET_PAGES
    const label = result.collection?.title ?? 'Pages'
    const existing = byKey.get(key)
    if (existing) existing.count += 1
    else byKey.set(key, { key, label, count: 1 })
  }
  // A single tab is not a choice — it would read as a filter over a list it
  // cannot change. `All` earns its place only next to something else.
  const facets = [...byKey.values()]
  if (facets.length < 2) return []
  return [
    { key: SEARCH_FACET_ALL, label: 'All', count: results.length },
    ...facets,
  ]
}

/** Results under one facet key; `all` (or anything unknown) filters nothing. */
export function filterSearchResults(
  results: SearchResult[],
  facetKey: string | undefined,
): SearchResult[] {
  if (!facetKey || facetKey === SEARCH_FACET_ALL) return results
  const known = new Set(
    results.map((result) => result.collection?.slug ?? SEARCH_FACET_PAGES),
  )
  // An unknown `?in=` shows everything rather than an empty page: the tab is
  // a view of a result set, and a stale or hand-edited URL must not be able
  // to make a site with matches look like a site with none.
  if (!known.has(facetKey)) return results
  return results.filter(
    (result) => (result.collection?.slug ?? SEARCH_FACET_PAGES) === facetKey,
  )
}
