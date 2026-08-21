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

import * as Aglyn from '@aglyn/aglyn/server'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import searchContent, {
  filterSearchResults,
  SEARCH_FACET_ALL,
  searchResultFacets,
} from '../../../utils/search-content'
import { getHostCached } from '../host-data'
import SearchResults from './search-results.component'

// Reads ?q= per request, so it can never be statically cached.
export const dynamic = 'force-dynamic'

type SearchPageProps = {
  params: Promise<{ host: string }>
  searchParams: Promise<{ q?: string | string[]; in?: string | string[] }>
}

export async function generateMetadata({
  params,
}: SearchPageProps): Promise<Metadata> {
  const { host } = await params
  const hostRes = await getHostCached(host)
  // The built-in search page through the same rule as every other head
  // (AGL-1341). "Search" is a name we generate rather than an authored title,
  // so it keeps the site title after it — but through the HOST's separator,
  // not the hard-coded en dash this used to carry, and without the old
  // `?? 'Search'` site-title fallback that could render "Search – Search".
  return {
    title: Aglyn.resolveSeoTitle({
      name: 'Search',
      siteTitle: hostRes.host?.seo?.title ?? hostRes.host?.displayName,
      separator: hostRes.host?.seo?.separator,
      fallback: 'Search',
    }),
    robots: { index: false, follow: true },
  }
}

/**
 * Tenant site search results (AGL-88), migrated from a Pages Router
 * `getServerSideProps` page to an async Server Component. A real route beats
 * the catch-all, and reading `searchParams` keeps it per-request. Reserved
 * path: a screen slugged "search" is shadowed — documented reserved word.
 *
 * Brought to frame 599:1218 in AGL-1525: the `SEARCH / Results for “…”`
 * heading and the per-collection count tabs the Collection Entries
 * suggestion panel now sends readers to. Cross-collection by construction —
 * `searchContent` already walks every content collection the host owns, so
 * the Blog / Changelog / Newsroom split the frame draws comes out of the
 * results themselves rather than out of a list of collection names this file
 * would otherwise have to hard-code and keep in step.
 *
 * The FACETS are computed over the unfiltered results and the FILTER is
 * applied after, in that order and never the other way round: counted after
 * filtering, every tab but the active one would read `· 0`.
 */
export default async function SearchPage({
  params,
  searchParams,
}: SearchPageProps) {
  const { host } = await params
  const sp = await searchParams
  const query = String(sp?.q ?? '').slice(0, 100)
  const facetKey = String(sp?.in ?? SEARCH_FACET_ALL).slice(0, 100)
  const hostRes = await getHostCached(host)
  if (hostRes.error || !hostRes.host) notFound()
  const results = query
    ? await searchContent({ host: hostRes.host, query })
    : []
  const facets = searchResultFacets(results)
  return (
    <SearchResults
      query={query}
      results={filterSearchResults(results, facetKey)}
      facets={facets}
      activeFacet={
        // A `?in=` the results cannot honour falls back to the tab that IS
        // showing — `filterSearchResults` already showed everything, so
        // highlighting the stale tab would caption the wrong list.
        facets.some((facet) => facet.key === facetKey)
          ? facetKey
          : SEARCH_FACET_ALL
      }
    />
  )
}
