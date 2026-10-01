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
import { forwardRef, use } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'

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

/** The searching variant's module (AGL-3438). */
type EntriesSearchModule = typeof import('./collection-entries-search')

/**
 * What a searching block stamps on its root. The browser looks for it before
 * the page hydrates (`prepareEntriesSearch`); nothing styles or targets it.
 */
export const ENTRIES_SEARCH_ATTRIBUTE = 'data-aglyn-entries-search'

/**
 * React's thenable contract (`status`/`value`), stamped on the load once it
 * settles — the plugin loader's ensure promise carries it for the same reason
 * (AGL-1541): `use()` unwraps a stamped promise synchronously, and suspends on
 * a bare one even after it has resolved.
 */
type StampedLoad = Promise<EntriesSearchModule> & {
  status?: 'pending' | 'fulfilled' | 'rejected'
  value?: EntriesSearchModule
  reason?: unknown
}

let searchLoad: StampedLoad | undefined

/**
 * The searching variant, fetched once per visit however many blocks ask. A
 * failed fetch (a deploy mid-visit) is forgotten rather than cached, so the
 * next render that asks tries again.
 */
export const loadEntriesSearch = (): Promise<EntriesSearchModule> => {
  if (searchLoad) return searchLoad
  const load: StampedLoad = import('./collection-entries-search')
  searchLoad = load
  load.then(
    (module) => {
      load.status = 'fulfilled'
      load.value = module
    },
    (reason: unknown) => {
      load.status = 'rejected'
      load.reason = reason
      if (searchLoad === load) searchLoad = undefined
    },
  )
  return load
}

/**
 * Loads the searching variant BEFORE the element renders, wherever a render
 * that waited for it would cost something (AGL-3438). The plugin calls it as
 * the element registers (`prepare` in `plugin.ts`), and awaits it.
 *
 * - **On the server, always.** A render that suspended there would hold the
 *   whole streamed shell for the fetch — and a first, cold one would do it
 *   on a page the ISR cache then keeps.
 * - **Where the whole library is loading** (`everything`): the console and
 *   the besigner, where an author can turn search on at any moment.
 * - **In a browser about to hydrate a searching block**, which the server
 *   HTML says by carrying {@link ENTRIES_SEARCH_ATTRIBUTE}. The fetch then
 *   rides along with the element's own instead of starting when hydration
 *   reaches the block.
 *
 * Anywhere else nothing is fetched: a page whose blocks have search off —
 * most of them — never downloads the box. A searching block that renders
 * without it (a client-side navigation onto one) suspends until it lands,
 * which holds the navigation, never a half-drawn list.
 */
export const prepareEntriesSearch = (
  everything: boolean,
): Promise<unknown> | undefined =>
  everything ||
  typeof document === 'undefined' ||
  document.querySelector(`[${ENTRIES_SEARCH_ATTRIBUTE}]`)
    ? loadEntriesSearch()
    : undefined

/**
 * Repeats its children once per published entry of a content collection
 * (AGL-551) — the collections sibling of the dataset repeatable. The tenant
 * expands it at compose time with `{{entry.*}}` tokens; in the besigner the
 * template renders once with literal tokens, matching the repeatable UX.
 *
 * With `search` on (AGL-1516) the block is `SearchingEntries`, from its own
 * module (AGL-3438). Off — the default, and most blocks — it is the plain
 * stack below, and the search box's MUI input never reaches the page.
 *
 * There is NO Suspense boundary around the searching variant, on purpose. A
 * boundary would have to be in the server's tree too, and a client render
 * that suspended inside it would show its fallback: a list without its box,
 * then the box pushing it down. Without one, a render that has to wait holds
 * whatever is above it — the hydration of the page (whose server HTML stays
 * exactly as it is), or a navigation (whose old page stays up) — and
 * `prepareEntriesSearch` makes sure the published page almost never has to.
 */
const CollectionEntries = forwardRef<HTMLDivElement, CollectionEntriesProps>(
  (props, ref) => {
    if (props.search) {
      const { SearchingEntries } = use(loadEntriesSearch())
      return <SearchingEntries ref={ref} {...props} />
    }
    // collectionSlug/entriesLimit/filter*/search* are compose-time or
    // search-only attributes: strip so they never hit the DOM.
    const {
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
      ...rest
    } = props
    return (
      <MuiStack ref={ref} spacing={4} {...rest}>
        {children}
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
