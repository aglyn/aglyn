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
import { mdiPostOutline } from '@aglyn/shared-data-mdi'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { Children, forwardRef, useContext, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
// One coercion for every authored count in this bundle (AGL-1457) — number
// fields round-trip as strings, and a second parser here would drift.
import { toCount } from '../utils/to-count'
import {
  SearchField,
  SuggestSearchBox,
  useEntryFuse,
} from './collection-search-box'

// Persisted component id (AGL-551/582); the compose pipeline references it
// through the @aglyn/aglyn constant. Never rename.
export const ENTRIES_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRIES_COMPONENT_ID

export interface CollectionEntriesProps extends StackProps {
  /**
   * Collection to repeat over (compose-time, AGL-551). Blank = the
   * collection routed by the current URL on list-template screens.
   */
  collectionSlug?: string
  /** Maximum entries rendered (compose-time; blank = all, capped at 100). */
  entriesLimit?: number | string
  /**
   * Only entries in this category repeat (compose-time, AGL-582).
   * Matches the collection's category by stable id or display name.
   */
  filterCategory?: string
  /** Only entries carrying this tag repeat (compose-time, AGL-582). */
  filterTag?: string
  /**
   * Entries per page (compose-time, AGL-620). When set, the block renders one
   * page window instead of the top `entriesLimit`; the built-in collection
   * list uses this with the `page` from `/{collection}/page/{n}`.
   */
  perPage?: number | string
  /** 1-based page for `perPage` (compose-time, AGL-620). */
  page?: number | string
  /**
   * Render this block only on page 1 of the routed listing (compose-time,
   * AGL-1871). For a LEAD card — a block with no `perPage`, showing the top
   * of the set — every `/{collection}/page/{n}` past the first otherwise
   * repeats the identical entry above a page of different ones.
   *
   * Opt-in and default off: a block that legitimately belongs on every page
   * of a listing (a "popular posts" rail) has exactly the same shape.
   */
  firstPageOnly?: boolean
  /**
   * Show a search box that filters the RENDERED entries by title/excerpt as
   * the reader types (AGL-1516, Figma 494:1220). Opt-in and default off, so
   * every existing instance renders exactly as before.
   *
   * Client-evaluated over the entries this block already holds — the page is
   * ISR-cached, so a keystroke never costs a Firestore read. That set is
   * whatever the expansion left the block holding, which paging, an
   * `entriesLimit` or the 100-entry cap can each cut down. A truncated block
   * says so under its results either way — on a miss and on a hit
   * (AGL-1516, AGL-2569) — rather than pretending global search.
   */
  search?: boolean
  /**
   * What the search box DOES with a query (AGL-1525, Figma 496:1218).
   *
   * - `filter` (default, and the reading of an absent value) — hides the
   *   non-matching cards in place. What AGL-1516 shipped.
   * - `suggest` — the card grid stays exactly as it was and a floating panel
   *   of matching entries opens under the field, ending in a link to the
   *   site-wide results page. The frame's toolbar behaviour: a reader
   *   skimming the list is not made to lose it to a typo.
   */
  searchMode?: CollectionSearchMode
  /** Hint text inside the search box (blank = "Search posts…"). */
  searchPlaceholder?: string
  /**
   * Server-stamped matchable text per rendered entry
   * (`expandCollectionEntries`, AGL-1516); never set by hand.
   */
  searchIndex?: Aglyn.CollectionEntrySearchItem[]
  /**
   * How many entries `searchIndex` was drawn from — server-stamped by
   * `expandCollectionEntries` alongside it (AGL-1516), never set by hand.
   * `searchIndex.length < searchTotal` is the only honest test of whether
   * this block holds the whole set; `perPage` is not, because
   * `entriesLimit` and the 100-entry cap truncate too.
   */
  searchTotal?: number
  /**
   * Whether the read behind `searchTotal` reached its own bound — server-
   * stamped beside it (AGL-1516), never set by hand.
   *
   * `searchTotal` is a count of what the server SAW, and the collection read
   * is limited. Without this flag a block holding 100 of 400 posts satisfies
   * `searchIndex.length === searchTotal` and renders the one empty state that
   * claims to have looked everywhere.
   */
  searchCapped?: boolean
}

/** The two things the toolbar search box can do (AGL-1516/AGL-1525). */
export type CollectionSearchMode = 'filter' | 'suggest'

/**
 * Author-facing choices for {@link CollectionEntriesProps.searchMode}.
 *
 * Both values are truthy on purpose (AGL-1453): `''` cannot survive a save,
 * so an author who tried the other mode would have no route back. "Filter"
 * carries the absent-value reading, which is what every block published
 * before AGL-1525 has.
 */
export const COLLECTION_SEARCH_MODE_OPTIONS: ReadonlyArray<{
  value: CollectionSearchMode
  label: string
}> = [
  { value: 'filter', label: 'Filter the entries in place' },
  { value: 'suggest', label: 'Show a suggestions dropdown' },
]

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
 * Repeats its children once per published entry of a content collection
 * (AGL-551) — the collections sibling of the dataset repeatable. The tenant
 * expands it at compose time with `{{entry.*}}` tokens; in the besigner the
 * template renders once with literal tokens, matching the repeatable UX.
 *
 * Search (AGL-1516): with `search` on, a toolbar search box filters the
 * rendered entry clones client-side against the server-stamped
 * `searchIndex` — fuzzy, via the same Fuse the icon picker uses. The clones
 * arrive as `children` in stamp order, one group of template roots per
 * entry, so group N of the children IS entry N of the index. Matches keep
 * the list's own order rather than Fuse's score order: a blog list is
 * chronological, and search narrows it, it does not reshuffle it. In the
 * besigner the field renders as an inert affordance (the template renders
 * once with literal tokens and there is no index to search), matching how
 * Category Pills go inert on editing surfaces.
 */
const CollectionEntries = forwardRef<HTMLDivElement, CollectionEntriesProps>(
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
    /** `filter` mode only — `suggest` owns its own query (AGL-1516). */
    const [query, setQuery] = useState('')
    const items = search ? searchIndex : undefined
    const { fuzzy, requestFuzzy } = useEntryFuse(items)
    if (!search) {
      return (
        <MuiStack ref={ref} spacing={4} {...props}>
          {children}
        </MuiStack>
      )
    }
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
      <MuiStack ref={ref} spacing={4} {...props}>
        {field}
        {visible}
        {scopeNote}
      </MuiStack>
    )
  },
)
CollectionEntries.displayName = 'AglynCollectionEntries'

export const collectionEntriesSchema: Aglyn.ComponentSchema<CollectionEntriesProps> =
  {
    $id: ENTRIES_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Collection Entries',
    description: 'Repeats its children once per entry in a content collection.',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiPostOutline.path, sx: { color: 'secondary.main' } },
    attributes: [
      {
        name: 'collectionSlug',
        label: 'Collection slug',
        description:
          'Content collection whose published entries the children repeat ' +
          'over (e.g. "blog"). Leave blank on a list-template page to use ' +
          'the collection from the URL.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'entriesLimit',
        label: 'Entries limit',
        description: 'Maximum entries rendered (blank = all, capped at 100).',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
      },
      {
        name: 'filterCategory',
        label: 'Filter by category',
        description:
          'Only entries in this category repeat — the category name or its ' +
          'stable id both match (e.g. "Guides"). Blank = no category filter.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'filterTag',
        label: 'Filter by tag',
        description:
          'Only entries carrying this tag repeat (e.g. "nextjs"). Blank = ' +
          'no tag filter.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'perPage',
        label: 'Entries per page',
        description:
          'Paginate the list: entries per page (blank = no pagination). ' +
          'Pairs with the page from /{collection}/page/{n}.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
      },
      {
        name: 'page',
        label: 'Page',
        description: '1-based page to render when Entries per page is set.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
      },
      {
        name: 'firstPageOnly',
        label: 'Only on page 1',
        description:
          'Show this block on the first page of the listing only. Use it ' +
          'for a featured or lead card: without it the same entry repeats ' +
          'at the top of every /page/{n}, above a page of different ones.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'search',
        label: 'Search',
        description:
          'Show a search box that filters the rendered entries by title ' +
          'and excerpt as the reader types. It searches the entries this ' +
          'block rendered — whatever paging, an entry limit or the ' +
          '100-entry cap left it holding, and it says so on a miss.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'searchMode',
        label: 'When the reader types',
        description:
          'Filter the entries in place, or leave the list alone and open a ' +
          'dropdown of matching entries under the box — each one a link, ' +
          'ending in "View all results" for a search across the whole site.',
        component: Aglyn.FieldComponentType.SELECT,
        options: COLLECTION_SEARCH_MODE_OPTIONS.map((option) => ({
          ...option,
        })),
        // Meaningless while there is no search box to type in.
        condition: { when: 'search', is: true },
      },
      {
        name: 'searchPlaceholder',
        label: 'Search placeholder',
        description:
          'Hint text inside this block’s own search box — the one that ' +
          'filters the entries below it as a reader types. Blank shows ' +
          '"Search posts…".',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        // Meaningless while there is no search box to hint in.
        condition: { when: 'search', is: true },
      },
      // `searchIndex` and `searchTotal` are deliberately NOT attributes: both
      // are server-stamped by expandCollectionEntries, like Category Pills'
      // `items` and Related Posts' `entries`.
      {
        name: 'spacing',
        label: 'Spacing',
        description: 'Defines the space/gap between entries.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
      },
    ],
  }

export { CollectionEntries }
// The collection family's palette presets ride this element's registry entry
// (`presets: 'collectionPresets'` in plugin.ts), as they did when the family
// was one module.
export { collectionPresets } from './collection-presets'
