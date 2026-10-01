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

import * as Aglyn from '@aglyn/aglyn'
import MuiStack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { Children, forwardRef, useContext, useState } from 'react'
// One coercion for every authored count in this bundle (AGL-1457) — number
// fields round-trip as strings, and a second parser here would drift.
import { toCount } from '../utils/to-count'
import {
  ENTRIES_SEARCH_ATTRIBUTE,
  type CollectionEntriesProps,
  type CollectionSearchMode,
} from './collection-entries'
import {
  SearchField,
  SuggestSearchBox,
  useEntryFuse,
} from './collection-search-box'

/**
 * The Collection Entries block with its search box on (AGL-1516, AGL-1525).
 *
 * Its own module, loaded only by a block whose `search` is on (AGL-3438): the
 * box draws MUI's InputBase, TextareaAutosize and Chip, about 22 KB the
 * entries block otherwise has no use for, and most blocks — aglyn.com/press's
 * among them — never turn search on. `collection-entries.tsx` renders the
 * plain block itself and reaches for this one through `loadEntriesSearch`.
 */

/**
 * How much of the collection an entries block's search could actually see
 * (AGL-1516, AGL-2569) — `truncated` says the rendered window is smaller
 * than the set, `paginated` says the missing part lives on other pages of
 * this same list rather than merely outside the block.
 *
 * The test is whether the window is SMALLER THAN THE SET, which only the
 * server knows — `perPage` is the wrong proxy for it in both directions. A
 * block truncated by `entriesLimit` or by the 100-entry cap has no `perPage`
 * at all and would claim a global miss over 6 of 40 posts; a block whose
 * `perPage` exceeds its entry count is a single complete page and would
 * blame pages that do not exist. `searchTotal` is stamped with `searchIndex`,
 * so the two are always in step.
 *
 * Absent — a page cached before that stamp shipped — falls back to the old
 * `perPage` reading rather than guessing "complete": understating the scope
 * of a search is the safe direction to be wrong in.
 *
 * `searchCapped` is the second way a block can fail to hold the set, and the
 * invisible one: `searchTotal` counts the entries the server READ, and that
 * read is bounded. Past the bound `shown === searchTotal` is satisfied by a
 * block holding 100 of 400 posts, and the wording that claims to have looked
 * everywhere is exactly the branch it would take.
 *
 * Both the miss and the hit disclose off this one answer, so the two can
 * never disagree about the same block.
 */
const searchScope = ({
  perPage,
  shown,
  searchTotal,
  searchCapped,
}: {
  perPage?: CollectionEntriesProps['perPage']
  /** Entries this block searched — the length of its stamped index. */
  shown: number
  searchTotal?: number
  searchCapped?: boolean
}): { paginated: boolean; truncated: boolean } => {
  const paginated = (toCount(perPage, 0) ?? 0) > 0
  return {
    paginated,
    truncated:
      typeof searchTotal === 'number'
        ? shown < searchTotal || Boolean(searchCapped)
        : paginated || Boolean(searchCapped),
  }
}

/**
 * Search (AGL-1516): a toolbar search box filters the rendered entry clones
 * client-side against the server-stamped `searchIndex` — fuzzy, via the same
 * Fuse the icon picker uses. The clones arrive as `children` in stamp order,
 * one group of template roots per entry, so group N of the children IS entry
 * N of the index. Matches keep the list's own order rather than Fuse's score
 * order: a blog list is chronological, and search narrows it, it does not
 * reshuffle it. In the besigner the field renders as an inert affordance (the
 * template renders once with literal tokens and there is no index to search),
 * matching how Category Pills go inert on editing surfaces.
 */
export const SearchingEntries = forwardRef<
  HTMLDivElement,
  CollectionEntriesProps
>(
  // collectionSlug/entriesLimit/filter*/search* are compose-time or
  // search-only attributes: strip so they never hit the DOM.
  (
    {
      collectionSlug,
      entriesLimit,
      filterCategory,
      filterTag,
      perPage,
      page,
      firstPageOnly,
      search,
      searchMode,
      searchPlaceholder,
      searchIndex,
      searchTotal,
      searchCapped,
      children,
      ...props
    },
    ref,
  ) => {
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    const items = searchIndex
    /** `filter` mode only — `suggest` owns its own query (AGL-1516). */
    const [query, setQuery] = useState('')
    const { fuzzy, requestFuzzy } = useEntryFuse(items)
    const childArray = Children.toArray(children)
    // Template roots per entry. Every entry clones the same template, so the
    // children divide evenly; anything else means the children are not the
    // stamped clones, and filtering blind would hide the wrong cards —
    // fail open and render everything.
    const groupSize =
      items?.length && childArray.length % items.length === 0
        ? childArray.length / items.length
        : 0
    // `suggest` draws its rows from the INDEX and never touches the clones,
    // so the clone-alignment precondition is a `filter` precondition only.
    // A block whose children do not divide evenly still suggests correctly;
    // requiring `groupSize` here would silently kill the panel on exactly
    // the templates that made the fail-open necessary.
    const mode: CollectionSearchMode =
      searchMode === 'suggest' ? 'suggest' : 'filter'
    // Whether there is an index to search, NOT whether the matcher has loaded:
    // the field has to be there for the keystroke that loads it.
    const live =
      !suppressNavigation &&
      Boolean(items?.length) &&
      (mode === 'suggest' || groupSize > 0)
    const trimmed = query.trim()
    let visible: ReactNode[] | ReactNode = children
    /**
     * The one line under the results that says what the search covered —
     * either a miss scoped to the set that came back empty, or a hit scoped
     * to the window it was drawn from. Never both.
     */
    let scopeNote: ReactNode = null
    if (mode === 'suggest') {
      // The grid is deliberately untouched (Figma 496:1218): the panel is an
      // overlay on a page the reader is still reading, not a filter.
      visible = children
    } else if (live && trimmed && fuzzy) {
      const matched = new Set(
        fuzzy.search(trimmed).map((result) => result.refIndex),
      )
      visible = childArray.filter((_, index) =>
        matched.has(Math.floor(index / groupSize)),
      )
      // HONEST scope (AGL-1516, AGL-2569): this block holds whatever window
      // the expansion gave it, and pretending the search was global would
      // turn every miss into a false "this post does not exist" — and every
      // hit into a result set that looks like the whole answer.
      const shown = items?.length ?? 0
      const { paginated, truncated } = searchScope({
        perPage,
        shown,
        searchTotal,
        searchCapped,
      })
      if (!(visible as ReactNode[]).length) {
        scopeNote = (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {!truncated
              ? `No matches for “${trimmed}”.`
              : paginated
                ? `No matches for “${trimmed}” on this page — other pages ` +
                  'are not searched.'
                : `No matches for “${trimmed}” in the ${shown} entries ` +
                  'shown here — the rest of the collection is not searched.'}
          </Typography>
        )
      } else if (truncated) {
        // The hit half of the same honesty (AGL-2569). Matches are drawn from
        // the same window the miss apologizes for, they carry no pager of
        // their own, and nothing else on screen says the pages behind this
        // one went unread — so a list that happens to be partial reads as
        // complete. A block that holds the whole collection says nothing
        // here: a disclaimer on a complete answer is noise, and every small
        // site would carry it.
        //
        // No route out to `/search?q=` (AGL-88): the suggestion panel links
        // there because it is the panel's only possible answer, but this
        // mode has a working list under the field and that page does not
        // exist yet. Trading a silent partial answer for a dead link is not
        // the trade.
        scopeNote = (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {paginated
              ? 'Showing matches on this page — other pages are not searched.'
              : `Showing matches in the ${shown} entries here — the rest of ` +
                'the collection is not searched.'}
          </Typography>
        )
      }
    }
    // The field renders when there is something to search, and as an inert
    // affordance on editing surfaces so the author sees what they enabled.
    // A live surface with nothing stamped (unknown collection, zero entries)
    // renders no field at all — a search box over nothing is a lie.
    const showField = suppressNavigation || live
    const field = !showField ? null : mode === 'suggest' ? (
      // Rows in Fuse's SCORE order, the opposite of what `filter` does and
      // deliberately: filtering narrows a chronological feed, so reshuffling
      // it would be a second, unasked-for change to what the reader is
      // looking at. A suggestion list is not a feed — it is an answer to a
      // question, and the best answer belongs first.
      <SuggestSearchBox
        fuzzy={fuzzy}
        requestFuzzy={requestFuzzy}
        {...(items ? { items } : {})}
        {...(searchPlaceholder === undefined
          ? {}
          : { placeholder: searchPlaceholder })}
        {...(suppressNavigation ? { inert: true } : {})}
        // This block searched the entries IT rendered — a page window, an
        // `entriesLimit` slice, or a bounded read. Never "this collection".
        emptyText={(text) => `No matches for “${text}” on this page.`}
      />
    ) : (
      <SearchField
        value={query}
        landmark
        {...(searchPlaceholder === undefined ? {} : { placeholder: searchPlaceholder })}
        {...(suppressNavigation ? { inert: true } : {})}
        onQuery={(next) => {
          requestFuzzy()
          setQuery(next)
        }}
      />
    )
    return (
      <MuiStack
        ref={ref}
        spacing={4}
        {...props}
        // What the browser looks for before it hydrates the page, so this
        // module is fetched alongside the element rather than after it
        // (`prepareEntriesSearch`).
        {...{ [ENTRIES_SEARCH_ATTRIBUTE]: '' }}
      >
        {field}
        {visible}
        {scopeNote}
      </MuiStack>
    )
  },
)
SearchingEntries.displayName = 'AglynCollectionEntriesSearch'
