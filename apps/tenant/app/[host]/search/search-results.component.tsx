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

'use client'

// Deep imports, not the barrel: `@aglyn/shared-ui-jsx`'s index warns that
// everything re-exported there ships eagerly on EVERY published customer
// page, and this one is on the critical path for a site-wide route.
import AppLink from '@aglyn/shared-ui-jsx/components/app-link'
import { Container } from '@aglyn/shared-ui-jsx/components/container'
import { Box, Chip, Stack, Typography } from '@mui/material'
import type { SearchFacet, SearchResult } from '../../../utils/search-facets'
import { SEARCH_FACET_ALL } from '../../../utils/search-facets'

export interface SearchResultsProps {
  query: string
  results: SearchResult[]
  facets: SearchFacet[]
  /** Active `?in=` facet; `all` (or absent) is the unfiltered view. */
  activeFacet: string
}

/**
 * The site-wide results page (AGL-1525, Figma 599:1218) — the destination of
 * the Collection Entries suggestion panel's "View all results" link.
 *
 * Presentational and CLIENT-side purely because MUI is: every search, count
 * and filter decision is made on the server and arrives as props, so this
 * holds no state and issues no request. The tabs are real links carrying
 * `?q=&in=`, which is what lets a reader bookmark or share "the changelog
 * hits for X" — and what keeps the page working with scripting broken, the
 * same bargain the search field itself makes.
 */
export function SearchResults({
  query,
  results,
  facets,
  activeFacet,
}: SearchResultsProps) {
  const facetHref = (key: string) =>
    key === SEARCH_FACET_ALL
      ? `/search?q=${encodeURIComponent(query)}`
      : `/search?q=${encodeURIComponent(query)}&in=${encodeURIComponent(key)}`
  return (
    <Container>
      <Stack spacing={4} sx={{ py: { xs: 6, md: 8 } }}>
        <Stack spacing={1}>
          <Typography
            variant="overline"
            sx={{ color: 'text.secondary', letterSpacing: '0.12em' }}
          >
            {'SEARCH'}
          </Typography>
          <Typography variant="h3" component="h1">
            {query ? `Results for “${query}”` : 'Search'}
          </Typography>
        </Stack>

        {/*
          The field stays on the page, prefilled. A results page that cannot
          be refined without going back is a dead end, and `?in=` is
          deliberately NOT carried into it: a new query is a new question,
          and silently keeping the old collection filter is how a reader ends
          up staring at "no results" for a term the site does actually match.
        */}
        <Box
          component="form"
          role="search"
          action="/search"
          method="get"
          sx={{ display: 'flex', gap: 1, maxWidth: 560 }}
        >
          <Box
            component="input"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search this site…"
            aria-label="Search this site"
            sx={{
              flex: 1,
              px: 2,
              py: 1.25,
              fontSize: 16,
              color: 'text.primary',
              bgcolor: 'action.hover',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
            }}
          />
          <Box
            component="button"
            type="submit"
            sx={{
              px: 3,
              py: 1.25,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              color: 'primary.contrastText',
              bgcolor: 'primary.main',
              border: 0,
              borderRadius: 2,
            }}
          >
            {'Search'}
          </Box>
        </Box>

        {/*
          Count tabs (frame 599:1218). `searchResultFacets` returns nothing
          when the matches all came from one place — a lone "All · 6" tab
          reads as a filter over a list it cannot change.
        */}
        {facets.length ? (
          <Stack
            direction="row"
            spacing={1}
            component="nav"
            aria-label="Filter results by section"
            sx={{ flexWrap: 'wrap', rowGap: 1 }}
          >
            {facets.map((facet) => {
              const active = facet.key === activeFacet
              return (
                <AppLink
                  key={facet.key}
                  href={facetHref(facet.key)}
                  underline="none"
                  // The active tab is the page you are ON, which is what
                  // `aria-current` is for — colour alone leaves a screen
                  // reader hearing four identical links.
                  {...(active ? { 'aria-current': 'page' } : {})}
                >
                  <Chip
                    label={`${facet.label} · ${facet.count}`}
                    variant={active ? 'filled' : 'outlined'}
                    color={active ? 'primary' : 'default'}
                    clickable
                  />
                </AppLink>
              )
            })}
          </Stack>
        ) : null}

        {!query ? null : results.length === 0 ? (
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            {`No results for “${query}”.`}
          </Typography>
        ) : (
          <Stack spacing={3} component="ul" sx={{ p: 0, listStyle: 'none' }}>
            {results.map((result) => (
              <Stack key={result.url} spacing={0.75} component="li">
                <AppLink href={result.url} variant="h6" underline="hover">
                  {result.title}
                </AppLink>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
                >
                  {result.collection ? (
                    <Chip label={result.collection.title} size="small" />
                  ) : null}
                  {result.date ? (
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary' }}
                    >
                      {result.date}
                    </Typography>
                  ) : null}
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary' }}
                  >
                    {result.url}
                  </Typography>
                </Stack>
                {result.snippet ? (
                  <Typography
                    variant="body2"
                    sx={{ color: 'text.secondary', lineHeight: 1.6 }}
                  >
                    {result.snippet}
                  </Typography>
                ) : null}
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Container>
  )
}

export default SearchResults
