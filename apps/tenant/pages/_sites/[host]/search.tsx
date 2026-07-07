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

import type { GetServerSideProps } from 'next'
import Head from 'next/head'
import getHost from '../../../utils/get-host'
import searchContent, {
  type SearchResult,
} from '../../../utils/search-content'

interface Props {
  siteTitle: string
  query: string
  results: SearchResult[]
}

/**
 * Tenant site search results (AGL-88). A real route beats the catch-all,
 * and SSR lets it read ?q= per request. Reserved path: a screen slugged
 * "search" would be shadowed — acceptable, documented reserved word.
 */
export const getServerSideProps: GetServerSideProps<Props> = async (
  context,
) => {
  const hostParam = String(context.params?.['host'] ?? '')
  const query = String(context.query['q'] ?? '').slice(0, 100)
  const hostRes = await getHost({ host: hostParam })
  if (hostRes.error || !hostRes.host) return { notFound: true }
  const results = query
    ? await searchContent({ host: hostRes.host, query })
    : []
  return {
    props: {
      siteTitle:
        hostRes.host.seo?.title ?? hostRes.host.displayName ?? 'Search',
      query,
      results,
    },
  }
}

export default function SearchPage(props: Props) {
  const { siteTitle, query, results } = props
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
      <Head>
        <title>{`Search – ${siteTitle}`}</title>
        <meta key="robots" name="robots" content="noindex" />
      </Head>
      <h1>{'Search'}</h1>
      <form action="/search" method="get" role="search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search this site…"
          autoFocus
          style={{ padding: 8, width: '70%', boxSizing: 'border-box' }}
        />
        <button type="submit" style={{ padding: '8px 16px', marginLeft: 8 }}>
          {'Search'}
        </button>
      </form>
      {query ? (
        results.length === 0 ? (
          <p style={{ opacity: 0.7 }}>{`No results for “${query}”.`}</p>
        ) : (
          <div style={{ marginTop: 24 }}>
            {results.map((result) => (
              <article key={result.url} style={{ marginBottom: 24 }}>
                <h3 style={{ marginBottom: 4 }}>
                  <a href={result.url} style={{ color: 'inherit' }}>
                    {result.title}
                  </a>
                </h3>
                <p style={{ margin: 0, opacity: 0.6, fontSize: 13 }}>
                  {result.url}
                </p>
                {result.snippet ? (
                  <p style={{ lineHeight: 1.6 }}>{result.snippet}</p>
                ) : null}
              </article>
            ))}
          </div>
        )
      ) : null}
    </div>
  )
}
