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
import {
  mdiAccountCircleOutline,
  mdiContentCopy,
  mdiFacebook,
  mdiLinkedin,
  mdiMagnify,
  mdiNewspaperVariantOutline,
  mdiPostOutline,
  mdiShareVariant,
  mdiTagMultipleOutline,
  mdiTagOutline,
  mdiTextLong,
  mdiTwitter,
} from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
// The icon picker's fuzzy matcher (use-mdi-icons-fuzzy), not a re-implementation
// (AGL-1516): search here has to feel like search does everywhere else in the
// product, and two matchers is how they drift.
import { Fuse } from '@aglyn/shared-util-vendor/fuse'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import MuiLink from '@mui/material/Link'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { Children, forwardRef, useContext, useMemo, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
// One coercion for every authored count in this bundle (AGL-1457) — number
// fields round-trip as strings, and a second parser here would drift.
import { toCount } from './image-list'
// The theme's own type steps (AGL-2486), shared with the Typography element
// rather than a second list here — one rung list, one place to extend.
import { typographyVariants } from './typography'

// Persisted component ids (AGL-551/582); the compose pipeline references
// them through @aglyn/aglyn constants. Never rename.
export const ENTRIES_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRIES_COMPONENT_ID
export const ENTRY_BODY_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID
export const RELATED_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_RELATED_COMPONENT_ID
export const SHARE_ID: Aglyn.ComponentId = Aglyn.COLLECTION_SHARE_COMPONENT_ID
export const ENTRY_META_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID
export const ENTRY_AUTHOR_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRY_AUTHOR_COMPONENT_ID
export const CATEGORIES_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_CATEGORIES_COMPONENT_ID
export const SEARCH_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_SEARCH_COMPONENT_ID

/* ── Collection entries (repeater) ──────────────────────────────────────── */

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
   * `entriesLimit` or the 100-entry cap can each cut down; the empty state
   * says so rather than pretending global search (AGL-1516).
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

/** The toolbar search field, from the frame (Figma 494:1220). */
const SEARCH_FIELD_WIDTH = 240

/** Suggestion panel (Figma 496:1218). */
const SUGGESTION_PANEL_WIDTH = 420

/**
 * Rows in the panel before it stops. The frame shows five; the sixth row is
 * always the "View all results" link, which is the honest overflow answer —
 * a scrolling suggestion panel is a worse results page.
 */
const SUGGESTION_LIMIT = 5

/** Where "View all results" goes — the reserved site-search route (AGL-88). */
const searchResultsHref = (query: string) =>
  `/search?q=${encodeURIComponent(query)}`

/**
 * The frame's compact filled field: magnify glyph + hint on the quiet
 * surface token, right-aligned so it sits where the toolbar row puts it.
 * Palette tokens only, so it follows the site theme in both modes.
 */
const searchFieldSx = {
  alignSelf: 'flex-end',
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  px: 1.5,
  py: 0.75,
  borderRadius: 2,
  bgcolor: 'action.hover',
  color: 'text.secondary',
  width: SEARCH_FIELD_WIDTH,
  maxWidth: '100%',
}

/**
 * The positioned parent of the suggestion panel (AGL-1525). It takes over
 * `alignSelf` from the field so the toolbar row is unchanged — the panel
 * hangs off the field, it does not move it.
 */
const suggestionAnchorSx = {
  alignSelf: 'flex-end',
  position: 'relative',
  width: SEARCH_FIELD_WIDTH,
  maxWidth: '100%',
}

/**
 * The floating panel itself. Right-aligned to the field it drops from, and
 * wider than it, as the frame draws it — a suggestion row carries a title, a
 * chip, a date and a line of excerpt, none of which fit in 240px.
 *
 * Palette and shadow tokens only, so it follows the site theme in both
 * modes rather than pinning a light-mode card onto a dark page.
 */
const suggestionPanelSx = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  zIndex: 10,
  width: SUGGESTION_PANEL_WIDTH,
  // Never wider than the viewport on a phone, where the anchor is narrow
  // and `right: 0` would otherwise hang the panel off the left edge.
  maxWidth: 'calc(100vw - 32px)',
  bgcolor: 'background.paper',
  color: 'text.primary',
  border: 1,
  borderColor: 'divider',
  borderRadius: 2,
  boxShadow: 6,
  overflow: 'hidden',
  textAlign: 'left',
}

const suggestionRowLinkSx = {
  display: 'block',
  color: 'inherit',
  '&:hover': { bgcolor: 'action.hover' },
}

const suggestionFooterSx = {
  display: 'block',
  px: 2,
  py: 1.25,
  borderTop: 1,
  borderColor: 'divider',
  bgcolor: 'action.hover',
  fontSize: 14,
  fontWeight: 500,
}

/** What a built index can be searched by — Fuse over the stamped rows. */
type EntryFuse = InstanceType<typeof Fuse<Aglyn.CollectionEntrySearchItem>>

/**
 * The frame's search input (Figma 494:1220) — the magnify glyph and a bare
 * `InputBase` on the quiet surface token.
 *
 * Presentational and stateless, so the entries block's in-place filter and
 * the standalone toolbar box (AGL-1516) are the SAME field rather than two
 * that merely look alike. `inert` is the editing-surface rendering: read-only
 * and handler-free, so a click or stray keystroke in the besigner never edits
 * state the canvas cannot use — how Category Pills go inert there too.
 */
const SearchField = ({
  value,
  placeholder,
  inert,
  landmark,
  onQuery,
  onEscape,
}: {
  value: string
  placeholder?: string
  inert?: boolean
  /**
   * Put `role="search"` on the FIELD. False when a wrapping form carries it
   * instead — one search landmark per box, or a screen reader announces the
   * same field twice.
   */
  landmark?: boolean
  onQuery?: (next: string) => void
  onEscape?: () => void
}) => (
  <Box {...(landmark ? { role: 'search' } : {})} sx={searchFieldSx}>
    <MdiIcon path={mdiMagnify.path} />
    <InputBase
      value={value}
      name="q"
      placeholder={(placeholder ?? '').trim() || 'Search posts…'}
      inputProps={{ 'aria-label': 'Search entries' }}
      sx={{ flex: 1, fontSize: 14, color: 'text.primary' }}
      {...(inert
        ? { readOnly: true }
        : {
            onChange: (event) => onQuery?.(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Escape') onEscape?.()
            },
          })}
    />
  </Box>
)

/**
 * The floating suggestion panel (AGL-1525, Figma 496:1218) — rows straight
 * off the server-stamped index, and a "View all results" link that is there
 * hits or no hits.
 *
 * `emptyText` is the caller's, not this component's, and that is the whole
 * point of it being a parameter: a page-windowed entries block and a
 * whole-collection toolbar box searched different sets, and a miss has to say
 * WHICH set came back empty. A shared "No matches." would let one of them
 * claim a reach it never had.
 */
const SuggestionPanel = ({
  suggestions,
  trimmed,
  emptyText,
}: {
  suggestions: readonly Aglyn.CollectionEntrySearchItem[]
  trimmed: string
  emptyText: string
}) => (
  <Box sx={suggestionPanelSx}>
    {suggestions.length ? (
      suggestions.map((item, index) => {
        const row = (
          <MuiStack spacing={0.5} sx={{ px: 2, py: 1.25 }}>
            <MuiStack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2" sx={{ color: 'text.primary' }}>
                {item.title}
              </Typography>
              {item.category ? (
                <Chip label={item.category} size="small" />
              ) : null}
              {item.date ? (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {item.date}
                </Typography>
              ) : null}
            </MuiStack>
            {item.excerpt ? (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  // One line of excerpt, as the frame draws it. A row that
                  // grows with the prose turns the panel into a page.
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.excerpt}
              </Typography>
            ) : null}
          </MuiStack>
        )
        // A row without a `url` is a page cached before AGL-1525 stamped one,
        // or a slugless entry. It renders as TEXT rather than as a link to
        // nowhere: a suggestion that navigates to the wrong page is worse
        // than one the reader has to read.
        return item.url ? (
          <AppLink
            key={index}
            href={item.url}
            sx={suggestionRowLinkSx}
            underline="none"
          >
            {row}
          </AppLink>
        ) : (
          <Box key={index}>{row}</Box>
        )
      })
    ) : (
      <Typography
        variant="body2"
        sx={{ color: 'text.secondary', px: 2, py: 1.25 }}
      >
        {emptyText}
      </Typography>
    )}
    {/*
      Always present, hits or no hits (Figma 496:1218). A box that searches
      one page, or one bounded read of a collection, cannot answer "then
      where is it?" on its own — the site-wide results page is the only
      honest answer, and it matters most in exactly the case where the panel
      came back empty.
    */}
    <AppLink
      href={searchResultsHref(trimmed)}
      sx={suggestionFooterSx}
      underline="none"
    >
      {`View all results for “${trimmed}” →`}
    </AppLink>
  </Box>
)

/**
 * Field plus dropdown, in a REAL form (AGL-1525) — so Enter reaches the
 * results page and the box still works with the panel's JS doing nothing at
 * all. The panel is an enhancement over a working search box, not the search
 * box.
 *
 * Owns the query, because nothing outside it needs one: `suggest` never
 * touches the cards underneath. That is what lets the standalone toolbar
 * block exist at all (AGL-1516) — a box with no clones to hide is a complete
 * feature, not a crippled one.
 */
const SuggestSearchBox = ({
  fuzzy,
  items,
  placeholder,
  inert,
  emptyText,
}: {
  fuzzy: EntryFuse | null
  items?: readonly Aglyn.CollectionEntrySearchItem[]
  placeholder?: string
  inert?: boolean
  /** The honest miss for the set THIS box searched. */
  emptyText: (query: string) => string
}) => {
  const [query, setQuery] = useState('')
  /** Escape dismissed THIS answer (AGL-1525); typing brings it back. */
  const [closed, setClosed] = useState(false)
  const trimmed = query.trim()
  const suggestions =
    !inert && trimmed && fuzzy && items
      ? fuzzy
          .search(trimmed)
          .slice(0, SUGGESTION_LIMIT)
          .map((result) => items[result.refIndex])
          .filter(Boolean)
      : []
  const field = (
    <SearchField
      value={query}
      {...(placeholder === undefined ? {} : { placeholder })}
      // No form wraps the inert field, so the landmark belongs on it.
      {...(inert ? { inert: true, landmark: true } : {})}
      onQuery={(next) => {
        setQuery(next)
        // A new query reopens a panel the reader dismissed — Escape closes
        // THIS answer, it does not turn the feature off for the visit.
        setClosed(false)
      }}
      onEscape={() => setClosed(true)}
    />
  )
  if (inert) return field
  return (
    <Box
      component="form"
      role="search"
      action="/search"
      method="get"
      sx={suggestionAnchorSx}
    >
      {field}
      {trimmed && !closed ? (
        <SuggestionPanel
          suggestions={suggestions}
          trimmed={trimmed}
          emptyText={emptyText(trimmed)}
        />
      ) : null}
    </Box>
  )
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
    const fuzzy = useMemo(
      () =>
        items?.length
          ? // The ONE matcher config (AGL-1525), shared with the site-wide
            // results page this block's panel links to — a query the panel
            // forgave must not come back empty from "View all results".
            new Fuse(items, { ...Aglyn.COLLECTION_SEARCH_FUSE_OPTIONS })
          : null,
      [items],
    )
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
    const live =
      !suppressNavigation &&
      Boolean(fuzzy) &&
      (mode === 'suggest' || groupSize > 0)
    const trimmed = query.trim()
    let visible: ReactNode[] | ReactNode = children
    let emptyState: ReactNode = null
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
      if (!(visible as ReactNode[]).length) {
        // HONEST scope (AGL-1516): this block holds whatever window the
        // expansion gave it, and pretending the search was global would turn
        // every miss into a false "this post does not exist".
        //
        // The test is whether the window is SMALLER THAN THE SET, which only
        // the server knows — `perPage` was the wrong proxy for it in both
        // directions. A block truncated by `entriesLimit` or by the
        // 100-entry cap has no `perPage` at all and used to claim a global
        // miss over 6 of 40 posts; a block whose `perPage` exceeds its entry
        // count is a single complete page and used to blame pages that do
        // not exist. `searchTotal` is stamped with `searchIndex`, so the two
        // are always in step.
        //
        // Absent — a page cached before this shipped — falls back to the old
        // `perPage` reading rather than guessing "complete": understating
        // the scope of a search is the safe direction to be wrong in.
        //
        // `searchCapped` is the second way this block can fail to hold the
        // set, and the invisible one: `searchTotal` counts the entries the
        // server READ, and that read is bounded. Past the bound
        // `searchIndex.length === searchTotal` is satisfied by a block
        // holding 100 of 400 posts, and the bare `No matches.` — the one
        // wording that claims to have looked everywhere — is exactly the
        // branch it would take.
        const paginated = (toCount(perPage, 0) ?? 0) > 0
        const truncated =
          typeof searchTotal === 'number'
            ? (items?.length ?? 0) < searchTotal || Boolean(searchCapped)
            : paginated || Boolean(searchCapped)
        const shown = items?.length ?? 0
        emptyState = (
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
        onQuery={setQuery}
      />
    )
    return (
      <MuiStack ref={ref} spacing={4} {...props}>
        {field}
        {visible}
        {emptyState}
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
          'over (e.g. "blog"). Leave blank on a list-template screen to use ' +
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

/* ── Entry body (markdown) ──────────────────────────────────────────────── */

export interface CollectionEntryBodyProps {
  /**
   * Markdown-lite source. On entry-template screens `{{entry.body}}`
   * resolves to the rendered entry's body at compose time.
   */
  markdown?: string
}

/** A still-unresolved `{{token}}` (no entry context on this render). */
const UNRESOLVED_TOKEN = /^\{\{[^}]+\}\}$/

const renderInlines = (
  inlines: Aglyn.MarkdownInline[],
  suppressNavigation?: boolean,
): ReactNode[] =>
  inlines.map((item, index) =>
    item.type === 'bold' ? (
      <strong key={index}>{item.text}</strong>
    ) : item.type === 'italic' ? (
      <em key={index}>{item.text}</em>
    ) : item.type === 'link' ? (
      // parseMarkdownInlines only emits http(s) or site-relative hrefs.
      // Internal paths route through AppLink for client-side navigation
      // (AGL-582); external links stay plain anchors. Editing surfaces
      // render the link look without an href so clicks never navigate.
      suppressNavigation ? (
        <MuiLink key={index} component="span" sx={{ cursor: 'default' }}>
          {item.text}
        </MuiLink>
      ) : Aglyn.isInternalMarkdownHref(item.href) ? (
        <AppLink key={index} href={item.href}>
          {item.text}
        </AppLink>
      ) : (
        <MuiLink key={index} href={item.href}>
          {item.text}
        </MuiLink>
      )
    ) : (
      <span key={index}>{item.text}</span>
    ),
  )

/**
 * Renders a content entry's markdown-lite body as themed MUI elements
 * (AGL-551): headings, paragraphs, lists, and images pick up the site
 * theme's typography instead of the old unthemed article HTML. Parsing is
 * pure, so the full body server-renders (SEO keeps the article text).
 */
const CollectionEntryBody = forwardRef<
  HTMLDivElement,
  CollectionEntryBodyProps
>((props, ref) => {
  const { markdown, ...rest } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  // The site being rendered, for image blocks (AGL-1686) — read once here
  // because hooks cannot run inside the block map below.
  const { hostId } = Aglyn.useSite()
  const source = (markdown ?? '').trim()
  const unresolved = !source || UNRESOLVED_TOKEN.test(source)
  const blocks = useMemo(
    () => (unresolved ? [] : Aglyn.parseMarkdownLite(source)),
    [source, unresolved],
  )
  // Heading anchors, on the same terms as the Markdown element (AGL-1162).
  // Without them a blog article could not carry an "On this page" aside at
  // all: the Table of Contents element emits `#slug` links, and there was
  // nothing on this page for them to land on.
  const slugs = useMemo(() => Aglyn.markdownHeadingSlugs(blocks), [blocks])
  if (unresolved) {
    // Editing surfaces get an affordance; the published site renders
    // nothing rather than a literal token.
    if (!suppressNavigation) return <Box ref={ref} {...rest} />
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          {
            p: 2,
            border: '1px dashed',
            borderColor: 'divider',
            color: 'text.secondary',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
          },
          ...nodeSx,
        ]}
      >
        {'Entry body — the {{entry.body}} markdown renders here'}
      </Box>
    )
  }
  return (
    <Box ref={ref} {...rest}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Typography
              key={index}
              id={slugs[index]}
              variant={block.level === 2 ? 'h4' : 'h5'}
              component={block.level === 2 ? 'h2' : 'h3'}
              gutterBottom
              sx={{
                scrollMarginTop: `${Aglyn.HEADING_ANCHOR_SCROLL_MARGIN}px`,
              }}
            >
              {renderInlines(block.inlines, suppressNavigation)}
            </Typography>
          )
        }
        if (block.type === 'image') {
          return (
            <Box
              key={index}
              component="img"
              // Resolved like the entry's cover image a few hundred lines
              // below (AGL-1686): a body image is the same kind of asset and
              // has no reason to be stored in a more fragile form.
              src={Aglyn.resolveMediaSrc(block.src, { hostId })}
              alt={block.alt}
              sx={{ maxWidth: '100%', borderRadius: 1, my: 1 }}
              // An image inside an entry body is below the fold by
              // construction — the title, byline and opening paragraphs are
              // above it. This one carried no loading hint at all, so it was
              // fetched EAGERLY, at default priority, competing with the
              // entry's own cover (AGL-2486).
              {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
            />
          )
        }
        if (block.type === 'list') {
          return (
            <Box key={index} component="ul" sx={{ lineHeight: 1.7, pl: 3 }}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {renderInlines(item, suppressNavigation)}
                </li>
              ))}
            </Box>
          )
        }
        // A numbered list (AGL-1320) — a real `<ol>`, so the markers are the
        // browser's and `start` survives: a notice that resumes at 7 has to
        // read as 7 for the enumeration to mean anything.
        if (block.type === 'orderedList') {
          return (
            <Box
              key={index}
              component="ol"
              start={block.start}
              sx={{ lineHeight: 1.7, pl: 3 }}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {renderInlines(item, suppressNavigation)}
                </li>
              ))}
            </Box>
          )
        }
        // Code blocks and tables (AGL-974). Both scroll rather than wrap:
        // a wrapped code line or a squeezed table column loses the very
        // structure that made the block worth writing.
        if (block.type === 'code') {
          return (
            <Box
              key={index}
              component="pre"
              sx={{
                my: 2,
                p: 2,
                overflowX: 'auto',
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontFamily: 'monospace',
                fontSize: 14,
              }}
            >
              <code>{block.text}</code>
            </Box>
          )
        }
        if (block.type === 'table') {
          return (
            <Box key={index} sx={{ my: 2, overflowX: 'auto' }}>
              <Box
                component="table"
                sx={{
                  borderCollapse: 'collapse',
                  width: '100%',
                  '& th, & td': {
                    border: '1px solid',
                    borderColor: 'divider',
                    px: 1.5,
                    py: 1,
                  },
                  '& th': { bgcolor: 'action.hover' },
                }}
              >
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th
                        key={cellIndex}
                        style={{ textAlign: block.align[cellIndex] ?? 'left' }}
                      >
                        {renderInlines(cell, suppressNavigation)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          style={{
                            textAlign: block.align[cellIndex] ?? 'left',
                          }}
                        >
                          {renderInlines(cell, suppressNavigation)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Box>
            </Box>
          )
        }
        // The article template's pull-quote (AGL-1315, Figma 170:225):
        // larger italic prose behind a left accent. Palette tokens only, so
        // it follows the site theme in both modes.
        if (block.type === 'quote') {
          return (
            <Typography
              key={index}
              component="blockquote"
              sx={{
                my: 3,
                mx: 0,
                pl: 2.5,
                borderLeft: '3px solid',
                borderColor: 'primary.main',
                fontStyle: 'italic',
                fontSize: '1.25em',
                lineHeight: 1.6,
                color: 'text.primary',
              }}
            >
              {renderInlines(block.inlines, suppressNavigation)}
            </Typography>
          )
        }
        return (
          <Typography
            key={index}
            variant="body1"
            sx={{ lineHeight: 1.7 }}
            gutterBottom
          >
            {renderInlines(block.inlines, suppressNavigation)}
          </Typography>
        )
      })}
    </Box>
  )
})
CollectionEntryBody.displayName = 'AglynCollectionEntryBody'

export const collectionEntryBodySchema: Aglyn.ComponentSchema<CollectionEntryBodyProps> =
  {
    $id: ENTRY_BODY_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Entry Body',
    description: "The current entry's markdown body, on an entry template.",
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTextLong.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'markdown',
        label: 'Markdown',
        description:
          'Markdown-lite content. Keep {{entry.body}} on entry-template ' +
          "screens so each entry's body renders here.",
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
    ],
  }

/* ── Related posts (AGL-582) ────────────────────────────────────────────── */

/** How the related posts are laid out (AGL-1457). */
export type CollectionRelatedLayout = 'list' | 'cards'

/** One related post as stamped by the compose pipeline (AGL-582). */
export interface CollectionRelatedProps extends StackProps {
  /** Section heading; empty string hides it. */
  heading?: string
  /** Compose-time: most related posts listed (default 3). */
  limit?: number | string
  /**
   * Emit each entry's cover image (AGL-1457). OFF is the default and the
   * shipped behaviour — the block is live on every blog entry, so turning
   * covers on by default would restyle published pages nobody asked about.
   */
  showCover?: boolean
  /**
   * `list` (default) is the plain-link list that has always shipped; `cards`
   * is the article frame's grid of cover + category chip + title.
   */
  layout?: CollectionRelatedLayout
  /** Columns in the `cards` grid (default 3, the frame's 3-up). */
  columns?: number | string
  /**
   * Type step the section heading reads at (default `h5`). One of the
   * theme's own rungs, shared with the Typography element — a heading sized
   * by hand in the Styles panel is the pixel-typing the tokens exist to stop.
   */
  headingVariant?: string
  /**
   * Type step each card title reads at (default `subtitle1`, what the block
   * has always emitted). The title is the block's own markup, so the Styles
   * panel — which edits the node's root — cannot reach it; this is the only
   * handle on it.
   */
  titleVariant?: string
  /** Show each post's published date. On is the shipped behaviour. */
  showDate?: boolean
  /**
   * How each card's published date reads (AGL-1459) — a COMPOSE-TIME prop
   * like {@link limit}: it is answered in `expandCollectionRelated`, where
   * the timestamp still exists, and never reaches the DOM. Blank, or
   * `default`, is the locale date the block has always emitted.
   *
   * Read here too, but only to date the SAMPLE cards: an editing surface has
   * no routed entry and therefore no server fill, so the picker would
   * otherwise preview nothing.
   */
  dateFormat?: Aglyn.CollectionEntryDateFormat
  /** Show each post's category. On is the shipped behaviour. */
  showCategory?: boolean
  /**
   * Show each post's excerpt. OFF is the default and the shipped behaviour:
   * the excerpt has been stamped onto every related item since AGL-582 and
   * rendered by nothing, so turning it on by default would add a paragraph
   * to every published entry nobody asked about.
   */
  showExcerpt?: boolean
  /**
   * Server-stamped related posts (`expandCollectionRelated`); never set by
   * hand — the tenant computes it from the current entry's category/tags.
   */
  entries?: Aglyn.CollectionRelatedItem[]
}

/** The frame's 3-up (Figma 170:242) when nothing usable is authored. */
const RELATED_DEFAULT_COLUMNS = 3

/** Cover height in the card grid, from the frame. */
const RELATED_COVER_HEIGHT = 180

/**
 * The card's category chip (AGL-1457). ONE fixed token pair for every
 * category: colour-coding a chip per category needs conditional styling,
 * which is not expressible yet (AGL-1307), and inventing a palette here
 * would have to be unpicked when it is. Same shape as the tag chips Entry
 * Meta already renders, so the two blocks read as one vocabulary.
 */
const relatedChipSx = {
  alignSelf: 'flex-start',
  borderColor: 'divider',
  color: 'text.secondary',
}

/** The heading step the block has always emitted. */
const RELATED_DEFAULT_HEADING_VARIANT = 'h5'

/** The card-title step the block has always emitted. */
const RELATED_DEFAULT_TITLE_VARIANT = 'subtitle1'

/**
 * The instant the sample cards are dated. A FIXED one, never `Date.now()`:
 * the canvas has to render the same bytes every time it opens, and this is
 * the date the Date-format labels use as their worked example — so the
 * dropdown and the cards it previews agree word for word.
 */
const RELATED_SAMPLE_PUBLISHED_AT = { seconds: Date.UTC(2026, 7, 9) / 1000 }

/**
 * Titles for the sample cards. Deliberately unmistakable as copy: the author
 * is looking at a LAYOUT, and a plausible-looking headline here is one an
 * author can mistake for a post that exists — or worse, design around.
 */
const RELATED_SAMPLE_TITLES = [
  'Sample related post',
  'A second sample post',
  'A third sample post',
]

/** Category chip text for the sample cards; names the field, not a taxonomy. */
const RELATED_SAMPLE_CATEGORY = 'Category'

/** Excerpt text for the sample cards; one line, so the card keeps its shape. */
const RELATED_SAMPLE_EXCERPT =
  'Each post’s own excerpt reads here, trimmed to a line or two.'

/**
 * Stand-in posts for editing surfaces (AGL-2486).
 *
 * Related posts are resolved FROM the routed entry, and a besigner canvas has
 * no routed entry — so the block used to draw a one-line dashed strip and the
 * author styled a layout they could not see. The sample is the block's REAL
 * markup, at the author's own settings, which is the only way the canvas can
 * answer "what will this look like".
 *
 * It exists only where {@link ScreenLinkContext.suppressNavigation} is on —
 * the besigner canvas and Preview. A published render reaches this function
 * on no path at all, so no visitor can ever be shown a post that does not
 * exist.
 *
 * The count follows the author's own `limit` so a 6-post rail at 3 columns
 * previews as two rows, and is bounded by the same ceiling the server
 * applies rather than a second one.
 */
const sampleRelatedEntries = (
  limit: number | string | undefined,
  dateFormat: Aglyn.CollectionEntryDateFormat,
): Aglyn.CollectionRelatedItem[] => {
  const count = Math.min(
    // `|| default` also rejects 0, which `toCount` would otherwise accept and
    // preview as an empty rail — the one thing the sample exists to avoid.
    toCount(limit, Aglyn.COLLECTION_RELATED_DEFAULT_LIMIT) ||
      Aglyn.COLLECTION_RELATED_DEFAULT_LIMIT,
    Aglyn.COLLECTION_RELATED_MAX,
  )
  const date = Aglyn.formatCollectionEntryDate(
    RELATED_SAMPLE_PUBLISHED_AT,
    dateFormat,
  )
  return Array.from({ length: count }, (_, index) => ({
    title: RELATED_SAMPLE_TITLES[index] ?? `Sample related post ${index + 1}`,
    // Empty, not a plausible path: every surface that renders the sample
    // suppresses navigation, so the title is text rather than an anchor and
    // this is never read. A real-looking href would be a link to nowhere the
    // moment that stopped being true.
    url: '',
    date,
    category: RELATED_SAMPLE_CATEGORY,
    excerpt: RELATED_SAMPLE_EXCERPT,
  }))
}

/**
 * Lists other entries of the same collection sharing the current entry's
 * category or a tag (AGL-582). The tenant stamps `entries` at compose time
 * on entry renders; without them the published site renders nothing and an
 * editing surface renders sample cards (AGL-2486).
 *
 * Two layouts (AGL-1457). `list` is the plain-link list that has always
 * shipped and stays the default — the block is live on every blog entry, so
 * a new default would restyle published pages nobody asked about. `cards` is
 * the article frame's grid: cover, category chip, title, at an author-set
 * column count.
 *
 * The block owns its markup, so nothing inside a card is a node the Styles
 * panel can select. Every part it renders therefore needs an attribute, or
 * it is unauthorable by construction — which is what the type steps and the
 * `show*` switches are (AGL-2486).
 */
const CollectionRelated = forwardRef<HTMLDivElement, CollectionRelatedProps>(
  (props, ref) => {
    // `limit` and `dateFormat` are compose-time: the tenant resolves them
    // while stamping `entries`; strip them so they never hit the DOM. The
    // rest are read here, so they must not reach it either.
    const {
      heading,
      limit,
      entries,
      showCover,
      layout,
      columns,
      headingVariant,
      titleVariant,
      showDate,
      dateFormat,
      showCategory,
      showExcerpt,
      ...rest
    } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    // The resolver every other surface shares (AGL-1215): a stamped `media:`
    // reference becomes a CDN URL HERE, not in the document, so one
    // reference keeps working across sites. Called before the early return —
    // it is a hook.
    const { hostId } = Aglyn.useSite()
    // An editing surface has no routed entry, so nothing is stamped and the
    // block used to be the one part of the page that was not WYSIWYG. The
    // sample stands in for exactly that gap, and only there.
    const sample = !entries?.length && Boolean(suppressNavigation)
    const items = entries?.length
      ? entries
      : sample
        ? sampleRelatedEntries(
            limit,
            Aglyn.normalizeCollectionEntryDateFormat(dateFormat),
          )
        : []
    if (!items.length) return <Box ref={ref} {...rest} />
    const title = heading ?? 'Related articles'
    const headingNode = title ? (
      <Typography
        variant={(headingVariant || RELATED_DEFAULT_HEADING_VARIANT) as 'h5'}
        component="h2"
      >
        {title}
      </Typography>
    ) : null
    /**
     * The card title, as a HEADING in the site theme.
     *
     * It used to be a bare `AppLink`, which is MUI's `Link` — `primary.main`
     * and `underline="always"` — so the one thing a related card is FOR read
     * as a default browser link on a themed page, at no heading level, and
     * with no attribute able to touch it. The type step now comes from the
     * theme's own rungs and the anchor inherits the colour, exactly as the
     * Entry Author card's byline link does.
     *
     * `linked` is false wherever the whole card is already the anchor: an
     * `<a>` inside an `<a>` is invalid markup that browsers silently unnest.
     */
    const titleNode = (entry: Aglyn.CollectionRelatedItem, linked: boolean) => (
      <Typography
        variant={(titleVariant || RELATED_DEFAULT_TITLE_VARIANT) as 'subtitle1'}
        component="h3"
      >
        {linked && !suppressNavigation && entry.url ? (
          <AppLink href={entry.url} sx={{ color: 'inherit' }} underline="hover">
            {entry.title}
          </AppLink>
        ) : (
          entry.title
        )}
      </Typography>
    )
    const dateNode = (entry: Aglyn.CollectionRelatedItem) =>
      showDate !== false && entry.date ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {entry.date}
        </Typography>
      ) : null
    const excerptNode = (entry: Aglyn.CollectionRelatedItem) =>
      showExcerpt && entry.excerpt ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {entry.excerpt}
        </Typography>
      ) : null
    /**
     * The cover, when the author asked for one AND the entry has one. An
     * entry without a cover gets no box at all rather than a placeholder:
     * the related list is a real feed, and a row of grey rectangles is worse
     * than a row of titles.
     *
     * The sample cards are the exception, and for the opposite reason: they
     * stand in for posts that do not exist yet, so the cover SLOT is what
     * the author is looking at. A card grid previewing without its images is
     * not the grid being styled.
     */
    const coverNode = (entry: Aglyn.CollectionRelatedItem) => {
      const src = showCover
        ? Aglyn.resolveMediaSrc(entry.coverImage, { hostId })
        : undefined
      if (!src) {
        if (!sample || !showCover) return null
        return (
          <Box
            aria-hidden
            sx={{
              height: RELATED_COVER_HEIGHT,
              borderRadius: 1,
              backgroundColor: 'action.hover',
            }}
          />
        )
      }
      return (
        <Box
          component="img"
          src={src}
          // The author's own description wins, and the title stays the
          // fallback (AGL-2418). Unlike the entry hero and the event
          // thumbnail — which render empty when nothing is authored — this
          // cover is the LINK's own content, so it must carry an accessible
          // name rather than go silent.
          alt={Aglyn.renderedMediaAlt(entry.coverImageAlt, entry.title)}
          sx={{
            display: 'block',
            width: '100%',
            height: RELATED_COVER_HEIGHT,
            objectFit: 'cover',
            borderRadius: 1,
          }}
          // `lazy` ALONE was the bug in miniature (AGL-2486): a lazy image
          // at default priority still outranks a lazy image at `low`, so
          // this related-entries rail — which sits at the bottom of an entry
          // by construction — was beating the deferred Image elements in the
          // body above it. The hint only works as a set.
          {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
        />
      )
    }

    /**
     * The notice that says these cards are not posts (AGL-2486). Editing
     * surfaces only, and outside the card markup rather than inside it, so
     * the author is styling the same tree the site will render.
     */
    const sampleNotice = sample ? (
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          p: 1,
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          color: 'text.secondary',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {'Sample posts — entries sharing this entry’s category or tags ' +
          'replace these on the published page'}
      </Typography>
    ) : null

    if (layout === 'cards') {
      // `toCount` rounds and rejects junk; `|| default` also rejects 0, which
      // it would otherwise accept as a column count and emit `repeat(0, …)`.
      const columnCount =
        toCount(columns, RELATED_DEFAULT_COLUMNS) || RELATED_DEFAULT_COLUMNS
      /**
       * One card's contents, always with a PLAIN title: the caller wraps the
       * whole card in the anchor, because a reader aiming at a 180px cover
       * should not have to hit the line of text under it — and a second
       * anchor around the title inside that one is markup browsers unnest.
       */
      const card = (entry: Aglyn.CollectionRelatedItem) => (
        <MuiStack spacing={1}>
          {coverNode(entry)}
          {showCategory !== false && entry.category ? (
            <Chip
              label={entry.category}
              size="small"
              variant="outlined"
              sx={relatedChipSx}
            />
          ) : null}
          {titleNode(entry, false)}
          {excerptNode(entry)}
          {dateNode(entry)}
        </MuiStack>
      )
      return (
        <Box
          ref={ref}
          {...rest}
          // MERGE, never replace (AGL-1450) — the node's slice arrives as the
          // ARRAY `mergeSxProps` builds in leaf.tsx, so folding it into an
          // object spreads numeric keys and discards every authored property
          // while these defaults still apply. Defaults first, node's after.
          sx={[
            {
              display: 'grid',
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              alignItems: 'start',
              columnGap: 3,
              rowGap: 4,
            },
            ...nodeSx,
          ]}
        >
          {headingNode ? (
            <Box sx={{ gridColumn: '1 / -1' }}>{headingNode}</Box>
          ) : null}
          {sampleNotice ? (
            <Box sx={{ gridColumn: '1 / -1' }}>{sampleNotice}</Box>
          ) : null}
          {items.map((entry, index) => {
            const linked = !suppressNavigation && Boolean(entry.url)
            return linked ? (
              <AppLink
                key={index}
                href={entry.url}
                underline="none"
                // A grid ITEM, so it has to be a block; `color: inherit`
                // keeps the cover, chip and date reading as themed content
                // rather than as the inside of a link.
                sx={{ color: 'inherit', display: 'block' }}
              >
                {card(entry)}
              </AppLink>
            ) : (
              <Box key={index}>{card(entry)}</Box>
            )
          })}
        </Box>
      )
    }
    return (
      <MuiStack ref={ref} spacing={1.5} {...rest}>
        {headingNode}
        {sampleNotice}
        {items.map((entry, index) => {
          const meta = [
            showDate !== false ? entry.date : '',
            showCategory !== false ? entry.category : '',
          ].filter(Boolean)
          return (
            <MuiStack key={index} spacing={0.25}>
              {coverNode(entry)}
              {titleNode(entry, true)}
              {excerptNode(entry)}
              {meta.length ? (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {meta.join(' · ')}
                </Typography>
              ) : null}
            </MuiStack>
          )
        })}
      </MuiStack>
    )
  },
)
CollectionRelated.displayName = 'AglynCollectionRelated'

export const collectionRelatedSchema: Aglyn.ComponentSchema<CollectionRelatedProps> =
  {
    $id: RELATED_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Related Posts',
    description: "Other entries sharing this one's category or tags.",
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiNewspaperVariantOutline.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'heading',
        label: 'Heading',
        description: 'Section heading (blank hides it).',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'limit',
        label: 'Limit',
        description: 'Most related posts listed (default 3).',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
      },
      {
        name: 'layout',
        label: 'Layout',
        description:
          'List keeps the plain links this block has always rendered. ' +
          'Cards is the article layout: cover, category, title, in a grid.',
        component: Aglyn.FieldComponentType.SELECT,
        // Both values are REAL (AGL-1451/AGL-1453): `''` cannot survive a
        // save, so an author who switched to Cards would have no route back.
        // `list` is also the value the render falls back to, so naming it is
        // the same choice, not a second one.
        options: [
          { value: 'list', label: 'List (default)' },
          { value: 'cards', label: 'Card grid' },
        ],
      },
      {
        name: 'columns',
        label: 'Columns',
        description: 'Cards per row in the card grid. Default 3.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
        // Meaningless on the list, where each post is its own row.
        condition: { when: 'layout', is: 'cards' },
      },
      {
        name: 'showCover',
        label: 'Show cover',
        description:
          'Show each post’s cover image. Posts without one show their ' +
          'title alone rather than an empty box.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'headingVariant',
        label: 'Heading style',
        description:
          'Which type step from the site theme the section heading above ' +
          'the posts reads at. Default Heading 5.',
        component: Aglyn.FieldComponentType.SELECT,
        // The theme's own rungs, shared with the Typography element rather
        // than a second list here: two lists is how a step added to the
        // theme becomes reachable in one place and not the other.
        options: [...typographyVariants],
      },
      {
        name: 'titleVariant',
        label: 'Title style',
        description:
          'Which type step from the site theme each post’s title reads at. ' +
          'Default Subtitle 1; the title takes the surrounding text colour ' +
          'rather than the link colour.',
        component: Aglyn.FieldComponentType.SELECT,
        options: [...typographyVariants],
      },
      {
        name: 'showDate',
        label: 'Show date',
        description:
          'Off drops each post’s published date. The posts stay in ' +
          'newest-first order either way — this is about the card, not the ' +
          'ordering.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'dateFormat',
        label: 'Date format',
        description:
          'How each post’s published date reads on its card. Site default ' +
          'is the format this block has always used.',
        component: Aglyn.FieldComponentType.SELECT,
        // The formats the pure layer knows how to produce, so the list
        // cannot offer a shape nothing renders. Every value is REAL,
        // including the do-nothing one (AGL-1451/AGL-1453).
        options: [...Aglyn.COLLECTION_ENTRY_DATE_FORMAT_OPTIONS],
      },
      {
        name: 'showCategory',
        label: 'Show category',
        description:
          'Off drops the category — the chip above each card title, or the ' +
          'second half of the line under each link on the list layout.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showExcerpt',
        label: 'Show excerpt',
        description:
          'Adds each post’s excerpt under its title. Posts with no excerpt ' +
          'are unchanged rather than leaving a gap.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
    ],
  }

/* ── Share bar (AGL-582) ────────────────────────────────────────────────── */

export interface CollectionShareProps extends StackProps {
  /** Heading before the buttons; empty string hides it. */
  heading?: string
}

const SHARE_TARGETS = [
  {
    label: 'Share on X',
    path: mdiTwitter.path,
    href: (url: string) =>
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}`,
  },
  {
    label: 'Share on LinkedIn',
    path: mdiLinkedin.path,
    href: (url: string) =>
      'https://www.linkedin.com/sharing/share-offsite/?url=' +
      encodeURIComponent(url),
  },
  {
    label: 'Share on Facebook',
    path: mdiFacebook.path,
    href: (url: string) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
]

/**
 * Share buttons for the CURRENT page URL (AGL-582): X, LinkedIn, Facebook,
 * and copy-link. Pure client behavior — the URL is read at click time so
 * SSR and besigner renders stay markup-identical; editing surfaces no-op.
 */
const CollectionShare = forwardRef<HTMLDivElement, CollectionShareProps>(
  (props, ref) => {
    const { heading, ...rest } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    const [copied, setCopied] = useState(false)
    const title = heading ?? 'Share'
    const open = (buildHref: (url: string) => string) => () => {
      if (suppressNavigation || typeof window === 'undefined') return
      window.open(
        buildHref(window.location.href),
        '_blank',
        'noopener,noreferrer',
      )
    }
    const copy = async () => {
      if (suppressNavigation || typeof window === 'undefined') return
      try {
        await navigator.clipboard.writeText(window.location.href)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Clipboard unavailable (permissions, http) — silently skip.
      }
    }
    return (
      <MuiStack
        ref={ref}
        direction="row"
        spacing={0.5}
        {...rest}
        // MERGE, never replace (AGL-1450) — see Entry Meta below.
        sx={[{ alignItems: 'center' }, ...nodeSx]}
      >
        {title ? (
          // `component="p"` because this labels a row of buttons; it is not a
          // section heading (AGL-2486). MUI's `defaultVariantMapping` sends
          // `subtitle2` to `<h6>`, so without this the Share Bar puts a level-6
          // heading into the document outline of every page carrying it. On a
          // blog post the nearest preceding heading is an `h2`, which makes it
          // a skipped level and a `heading-order` failure.
          //
          // Said here rather than as a theme-wide `variantMapping` override: a
          // default would silently change the element under every `subtitle2`
          // in the codebase, including surfaces where an `h6` is correct.
          <Typography component="p" variant="subtitle2" sx={{ mr: 1 }}>
            {title}
          </Typography>
        ) : null}
        {SHARE_TARGETS.map((target) => (
          <IconButton
            key={target.label}
            aria-label={target.label}
            size="small"
            onClick={open(target.href)}
          >
            <MdiIcon path={target.path} />
          </IconButton>
        ))}
        <IconButton
          aria-label={copied ? 'Link copied' : 'Copy link'}
          size="small"
          color={copied ? 'success' : 'default'}
          onClick={copy}
        >
          <MdiIcon path={mdiContentCopy.path} />
        </IconButton>
      </MuiStack>
    )
  },
)
CollectionShare.displayName = 'AglynCollectionShare'

export const collectionShareSchema: Aglyn.ComponentSchema<CollectionShareProps> =
  {
    $id: SHARE_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Share Bar',
    description: 'Share buttons for the current page, plus a copy link.',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiShareVariant.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'heading',
        label: 'Heading',
        description: 'Text before the buttons (blank hides it).',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
    ],
  }

/* ── Entry meta (AGL-582) ───────────────────────────────────────────────── */

export interface CollectionEntryMetaProps extends StackProps {
  /**
   * Published date. Server-filled from the routed entry on entry templates
   * (`expandCollectionEntryMeta`, AGL-1385); set it — or bind
   * `{{entry.date}}` — only to override.
   */
  date?: string
  /**
   * How {@link date} reads when the server fills it in (AGL-1459) — a
   * COMPOSE-TIME prop, like Related Posts' `limit`: it is answered where the
   * timestamp still exists (`expandCollectionEntryMeta`) and never reaches the
   * DOM. Blank, or `default`, is the locale date the block has always emitted.
   */
  dateFormat?: Aglyn.CollectionEntryDateFormat
  /**
   * Byline (AGL-1459). Server-filled from the entry's own author on entry
   * templates, exactly like {@link date}; set it — or bind `{{entry.author}}`
   * — only to override.
   */
  author?: string
  /** Category; server-filled, or bind `{{entry.category}}` to override. */
  category?: string
  /** Comma-joined tags; server-filled, or bind `{{entry.tags}}`. */
  tags?: string
  /**
   * Round avatar shown before the byline (AGL-1459) — a media-picker target,
   * so it holds a media reference (AGL-1215) as well as any URL form.
   *
   * A block-level pick, deliberately, and NOT a per-author image: entries
   * carry an author NAME (`authorName`) and no portrait field, so a per-author
   * avatar would need a schema decision on the entry model plus an editor
   * field to fill it. Until then this is the site's brand mark, chosen once on
   * the template — which is what the article frame actually asks for. Left
   * unset it renders nothing at all, never a broken image.
   */
  avatarImage?: string
  showDate?: boolean
  showAuthor?: boolean
  showCategory?: boolean
  showTags?: boolean
  showAvatar?: boolean
}

/**
 * THE SAMPLE VALUES THE ENTRY BLOCKS PREVIEW WITH (AGL-2486).
 *
 * Entry Meta and Entry Author resolve FROM the routed entry, and a besigner
 * canvas has no routed entry — so both drew a one-line dashed strip and an
 * author styling a byline or an author card was styling something they could
 * not see. Related Posts had the same gap and was answered the same way: the
 * block's REAL markup, at the author's own settings, on editing surfaces
 * only.
 *
 * These two need no "this is a sample" notice the way the related CARDS do.
 * A card carries a title, a cover and a category, which is what a real post
 * looks like; a byline reading `Sample author` says what it is in the words
 * themselves, and a notice above a single line of caption text would be
 * taller than the thing it labels.
 *
 * The date is a FIXED instant, never `Date.now()`: the canvas has to render
 * the same bytes every time it opens, and it is the same instant the related
 * sample uses, so two blocks on one template never disagree about what day
 * their example is.
 */
const ENTRY_SAMPLE_PUBLISHED_AT = RELATED_SAMPLE_PUBLISHED_AT

/** Byline name for the samples; names the field rather than a person. */
const ENTRY_SAMPLE_AUTHOR = 'Sample author'

/** Category text for the samples; names the field, not a taxonomy. */
const ENTRY_SAMPLE_CATEGORY = RELATED_SAMPLE_CATEGORY

/** Two chips, so the row previews its own wrapping and gap. */
const ENTRY_SAMPLE_TAGS = 'first tag, second tag'

/** Bio line for the author-card sample; one sentence, as a real one is. */
const ENTRY_SAMPLE_BIO =
  'The bio from this author’s record reads here, in a line or two.'

/**
 * The portrait STAND-IN, for a sample that has no image to resolve.
 *
 * A neutral plate rather than nothing, and for the reason the related sample
 * draws its cover slot: on an entry template the portrait arrives from the
 * author record at render, so the slot is exactly what the author is sizing
 * and spacing. `aria-hidden` because it depicts nothing.
 */
const samplePortraitSx = (size: number) => ({
  width: size,
  height: size,
  flexShrink: 0,
  borderRadius: '50%',
  backgroundColor: 'action.hover',
})

/** Byline avatar, from the article frame (Figma 170:190). */
const ENTRY_AVATAR_SIZE = 36

/** Unresolved tokens render empty on the site, literal in the besigner. */
const metaValue = (
  value: string | undefined,
  suppressNavigation: boolean | undefined,
): string => {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  if (UNRESOLVED_TOKEN.test(trimmed) && !suppressNavigation) return ''
  return trimmed
}

/**
 * "{{entry.date}} · {{entry.category}}" meta line plus tag chips
 * (AGL-582). Values arrive through entry tokens on entry renders; on other
 * surfaces unresolved tokens collapse to nothing instead of leaking.
 *
 * On an entry template the tenant now also FILLS the three values from the
 * routed entry when nothing is bound (`expandCollectionEntryMeta`, AGL-1385).
 * Before that, a block dragged from the palette rather than dropped as the
 * preset had no values at all — three "Show" switches gating nothing — and
 * rendered as the empty `<Box>` below, at height 0.
 */
const CollectionEntryMeta = forwardRef<
  HTMLDivElement,
  CollectionEntryMetaProps
>((props, ref) => {
  const {
    date,
    // Compose-time (AGL-1459): read by `expandCollectionEntryMeta`, which has
    // the timestamp. Destructured so it never reaches the DOM.
    dateFormat: _dateFormat,
    author,
    category,
    tags,
    avatarImage,
    showDate,
    showAuthor,
    showCategory,
    showTags,
    showAvatar,
    ...rest
  } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  // The resolver every other surface shares (AGL-1215), so one media
  // reference keeps working across sites. A hook — before any early return.
  const { hostId } = Aglyn.useSite()
  const dateValue = showDate !== false ? metaValue(date, suppressNavigation) : ''
  const authorValue =
    showAuthor !== false ? metaValue(author, suppressNavigation) : ''
  const categoryValue =
    showCategory !== false ? metaValue(category, suppressNavigation) : ''
  const tagsValue = showTags !== false ? metaValue(tags, suppressNavigation) : ''
  const tagList = tagsValue
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  // An unresolved token empties on EVERY surface here, unlike the text
  // fields: a literal `{{…}}` in a src is a broken image in the canvas, and a
  // byline that renders a broken avatar on every post is worse than no
  // avatar at all.
  const avatarRaw = (avatarImage ?? '').trim()
  const avatarSrc =
    showAvatar !== false && avatarRaw && !UNRESOLVED_TOKEN.test(avatarRaw)
      ? Aglyn.resolveMediaSrc(avatarRaw, { hostId })
      : ''
  // Author leads, so the frame's "The Aglyn Team · Jul 2026" reads in that
  // order. With no author the join is character-for-character what it was.
  const filledLine = [authorValue, dateValue, categoryValue]
    .filter(Boolean)
    .join(' · ')
  // Nothing to show and nothing to route from: an editing surface previews
  // the block's own markup at the author's own settings, and a published page
  // renders nothing at all (AGL-2486). The switches are honoured here exactly
  // as they are below, so a row with Show date off previews without one.
  const sample = !filledLine && !tagList.length && !avatarSrc && suppressNavigation
  const line = sample
    ? [
        showAuthor !== false ? ENTRY_SAMPLE_AUTHOR : '',
        showDate !== false
          ? Aglyn.formatCollectionEntryDate(
              ENTRY_SAMPLE_PUBLISHED_AT,
              Aglyn.normalizeCollectionEntryDateFormat(_dateFormat),
            )
          : '',
        showCategory !== false ? ENTRY_SAMPLE_CATEGORY : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : filledLine
  const chips = sample
    ? showTags !== false
      ? ENTRY_SAMPLE_TAGS.split(',').map((tag) => tag.trim())
      : []
    : tagList
  // The portrait an entry's own author record supplies arrives at compose
  // time, so on the canvas there is none to resolve — the slot is drawn
  // instead, which is what a byline's spacing is actually built around.
  const samplePortrait = sample && showAvatar !== false
  if (!line && !chips.length && !avatarSrc && !samplePortrait) {
    return <Box ref={ref} {...rest} />
  }
  return (
    <MuiStack
      ref={ref}
      direction="row"
      spacing={1}
      {...rest}
      // MERGE, never replace (AGL-1450, same class as AGL-1284). `rest.sx`
      // is the ARRAY `mergeSxProps` builds in leaf.tsx, so spreading it into
      // an object produced `{0: …, 1: …, 2: …}` — numeric keys emotion emits
      // as invalid selectors — and discarded EVERY authored property while
      // these two defaults still applied. The block looked deliberately
      // styled, so nothing suggested the value had been dropped. Defaults
      // go first; the node's slice comes after and can override them.
      sx={[{ alignItems: 'center', flexWrap: 'wrap' }, ...nodeSx]}
    >
      {avatarSrc ? (
        <Box
          component="img"
          src={avatarSrc}
          // Decorative: the byline names the author in text right beside it,
          // so a screen reader announcing the mark again is noise.
          alt=""
          sx={{
            display: 'block',
            width: ENTRY_AVATAR_SIZE,
            height: ENTRY_AVATAR_SIZE,
            borderRadius: '50%',
            objectFit: 'cover',
            // No background plate: a brand mark with a transparent ground
            // would sit on a grey disc nobody asked for.
          }}
          // `lazy` alone, same as the related rail above (AGL-2486). A
          // byline avatar is decorative and tiny; it has no business
          // outranking anything.
          {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
        />
      ) : samplePortrait ? (
        <Box aria-hidden sx={samplePortraitSx(ENTRY_AVATAR_SIZE)} />
      ) : null}
      {line ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {line}
        </Typography>
      ) : null}
      {chips.map((tag) => (
        <Chip key={tag} label={tag} size="small" variant="outlined" />
      ))}
    </MuiStack>
  )
})
CollectionEntryMeta.displayName = 'AglynCollectionEntryMeta'

export const collectionEntryMetaSchema: Aglyn.ComponentSchema<CollectionEntryMetaProps> =
  {
    $id: ENTRY_META_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Entry Meta',
    description:
      'The byline row for an entry — author, date, category and tags.',
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTagOutline.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'date',
        label: 'Date',
        description:
          'Blank shows the entry’s own published date on entry templates. ' +
          'Type here (or bind {{entry.date}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'dateFormat',
        label: 'Date format',
        description:
          'How the published date reads. Site default is the format this ' +
          'block has always used; it has no effect on a Date you typed in ' +
          'yourself.',
        component: Aglyn.FieldComponentType.SELECT,
        // The formats the pure layer knows how to produce, so the list cannot
        // offer a shape nothing renders. Every value is REAL — including the
        // do-nothing one (AGL-1451/AGL-1453): `''` cannot survive a save, so
        // an author who tried a format would have no route back.
        options: [...Aglyn.COLLECTION_ENTRY_DATE_FORMAT_OPTIONS],
      },
      {
        name: 'author',
        label: 'Author',
        description:
          'Blank shows the entry’s own author. Type here (or bind ' +
          '{{entry.author}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'category',
        label: 'Category',
        description:
          'Blank shows the entry’s own category. Type here (or bind ' +
          '{{entry.category}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'tags',
        label: 'Tags',
        description:
          'Comma-separated. Blank shows the entry’s own tags; type here (or ' +
          'bind {{entry.tags}}) only to override them.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'avatarImage',
        label: 'Avatar',
        description:
          'Round image before the byline — your brand mark, or any image ' +
          'from the media library. Blank shows no avatar.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'showDate',
        label: 'Show date',
        description:
          'Off hides the published date from the line without clearing what ' +
          'the Date field would have shown.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showCategory',
        label: 'Show category',
        description:
          'Off drops the category from the line. The entry keeps its ' +
          'category — this is about the byline, not the taxonomy.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showTags',
        label: 'Show tags',
        description:
          'Off hides the tag chips below the line. Leave it on and the ' +
          'other three off for a tags-only row.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showAuthor',
        label: 'Show author',
        description:
          'Off hides the byline. The avatar follows it: a block with no ' +
          'author shown never fills in the author’s portrait.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showAvatar',
        label: 'Show avatar',
        description:
          'Off hides the round image in front of the byline, including an ' +
          'author’s own portrait.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
    ],
  }

/* ── Entry author card (AGL-2486) ───────────────────────────────────────── */

export interface CollectionEntryAuthorProps extends StackProps {
  /**
   * The byline. Server-filled from the routed entry's author record on entry
   * templates (`expandCollectionEntryAuthor`), exactly like Entry Meta's
   * fields; set it — or bind `{{entry.author}}` — only to override.
   */
  name?: string
  /**
   * The author's blurb, from their record's `bio`; bind
   * `{{entry.authorBio}}` to override.
   */
  bio?: string
  /**
   * Portrait or logo — a media reference (AGL-1215) or any URL. Server-filled
   * from the author record, so the face changes with the byline instead of
   * being picked once on the template the way Entry Meta's avatar is.
   */
  image?: string
  /** The author's own page; blank renders the name as plain text. */
  url?: string
  showBio?: boolean
  showAvatar?: boolean
}

/** The card's portrait, larger than the byline's 36px mark (Figma 170:190). */
const AUTHOR_AVATAR_SIZE = 48

/**
 * What the byline may link to — an absolute `https:` page, or a route on this
 * site. The Social Links block guards its hrefs the same way and for the same
 * reason: the value comes from a stored record, so `javascript:` and friends
 * have to be unreachable rather than merely unlikely.
 */
const SAFE_AUTHOR_HREF = /^(https:\/\/|\/(?!\/))/i

/** An off-site author page opens in a new tab; a route on this site does not. */
const EXTERNAL_AUTHOR_HREF = /^https:\/\//i

/**
 * The author card that closes an article (AGL-2486) — portrait, byline, bio.
 *
 * Entry Meta prints a NAME beside a date, which is all an entry carried when
 * it was written: one free-typed string. Custom authors made the byline a
 * record with a portrait, a bio and a url, and a template that wanted the
 * card the article frame draws still had to type the name and the blurb in as
 * literal text — text that keeps saying whatever it said under posts somebody
 * else wrote, and that no edit to the author record can ever reach. This is
 * that card, filled from the record.
 *
 * Every field is independently overridable and every one of them collapses
 * when empty: an author with no portrait renders the text alone rather than a
 * gap where a face would be, and an entry with no author at all renders
 * nothing — never an empty bordered box.
 */
const CollectionEntryAuthor = forwardRef<
  HTMLDivElement,
  CollectionEntryAuthorProps
>((props, ref) => {
  // None of these are DOM attributes (`name` least of all), so they are
  // destructured rather than spread — the stack.ts pattern.
  const { name, bio, image, url, showBio, showAvatar, ...rest } = props
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  const { hostId } = Aglyn.useSite()
  const nameValue = metaValue(name, suppressNavigation)
  const bioValue = showBio !== false ? metaValue(bio, suppressNavigation) : ''
  const urlRaw = metaValue(url, suppressNavigation)
  const urlValue = SAFE_AUTHOR_HREF.test(urlRaw) ? urlRaw : ''
  // An unresolved token empties on EVERY surface, as in the byline: a literal
  // `{{…}}` in a src is a broken portrait in the canvas.
  const imageRaw = (image ?? '').trim()
  const imageSrc =
    showAvatar !== false && imageRaw && !UNRESOLVED_TOKEN.test(imageRaw)
      ? Aglyn.resolveMediaSrc(imageRaw, { hostId })
      : ''
  // Nothing to show and nothing to route from: an editing surface previews
  // the card's own markup at the author's own settings, and a published page
  // renders nothing at all (AGL-2486). Every part still answers its own
  // switch, so a card with Show bio off previews as portrait and name.
  const sample = !nameValue && !bioValue && !imageSrc && Boolean(suppressNavigation)
  const displayName = sample ? ENTRY_SAMPLE_AUTHOR : nameValue
  const displayBio = sample && showBio !== false ? ENTRY_SAMPLE_BIO : bioValue
  // The record's portrait arrives at compose time, so there is none to
  // resolve on the canvas — the card draws its slot, which is the thing its
  // spacing is built around.
  const samplePortrait = sample && showAvatar !== false
  if (!displayName && !displayBio && !imageSrc && !samplePortrait) {
    return <Box ref={ref} {...rest} />
  }
  return (
    <MuiStack
      ref={ref}
      direction="row"
      spacing={2}
      {...rest}
      // MERGE, never replace (AGL-1450): `rest.sx` is the array leaf.tsx
      // builds, and spreading it into an object drops every authored value.
      sx={[
        {
          alignItems: 'flex-start',
          p: 2.5,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
        },
        ...nodeSx,
      ]}
    >
      {imageSrc ? (
        <Box
          component="img"
          src={imageSrc}
          // Decorative: the card names the author in text right beside it.
          alt=""
          sx={{
            display: 'block',
            flexShrink: 0,
            width: AUTHOR_AVATAR_SIZE,
            height: AUTHOR_AVATAR_SIZE,
            borderRadius: '50%',
            objectFit: 'cover',
          }}
          {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
        />
      ) : samplePortrait ? (
        <Box aria-hidden sx={samplePortraitSx(AUTHOR_AVATAR_SIZE)} />
      ) : null}
      <MuiStack spacing={0.5} sx={{ minWidth: 0 }}>
        {displayName ? (
          <Typography component="p" variant="subtitle2">
            {urlValue ? (
              <AppLink
                href={urlValue}
                sx={{ color: 'inherit' }}
                underline="hover"
                {...(EXTERNAL_AUTHOR_HREF.test(urlValue)
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                {displayName}
              </AppLink>
            ) : (
              displayName
            )}
          </Typography>
        ) : null}
        {displayBio ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {displayBio}
          </Typography>
        ) : null}
      </MuiStack>
    </MuiStack>
  )
})
CollectionEntryAuthor.displayName = 'AglynCollectionEntryAuthor'

export const collectionEntryAuthorSchema: Aglyn.ComponentSchema<CollectionEntryAuthorProps> =
  {
    $id: ENTRY_AUTHOR_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Entry Author',
    description: 'The author card for an entry — portrait, byline and bio.',
    category: Aglyn.ComponentCategory.TEXT,
    icon: {
      path: mdiAccountCircleOutline.path,
      sx: { color: 'secondary.main' },
    },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'name',
        label: 'Name',
        description:
          'Blank shows the name from the entry’s author record. Type here ' +
          '(or bind {{entry.author}}) to sign this card differently from ' +
          'the byline above the article.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'bio',
        label: 'Bio',
        description:
          'Blank shows the bio from the author’s record. Type here (or bind ' +
          '{{entry.authorBio}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXTAREA,
      },
      {
        name: 'image',
        label: 'Portrait',
        description:
          'Blank shows the portrait from the author’s record. Pick from your ' +
          'media library with "Browse media" only to override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'url',
        label: 'Link',
        description:
          'Blank uses the author’s own url. The name links here; with no url ' +
          'it renders as plain text.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'showBio',
        label: 'Show bio',
        description:
          'Off leaves the card as a portrait and a name — for a masthead ' +
          'where the blurb would repeat what the page already says.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showAvatar',
        label: 'Show portrait',
        description:
          'Off leaves the text alone, with no space held for a picture.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
    ],
  }

/* ── Category pills (AGL-1321) ──────────────────────────────────────────── */

export interface CollectionCategoriesProps extends StackProps {
  /**
   * Collection whose taxonomy renders (compose-time). Blank = the collection
   * routed by the current URL on list-template screens.
   */
  collectionSlug?: string
  /**
   * Label for the unfiltered pill (default "All"). Clearing the field
   * persists `Aglyn.COLLECTION_ALL_PILL_NONE`, which omits the pill —
   * `''` cannot be stored at all (AGL-1336).
   */
  allLabel?: string
  /**
   * Server-stamped pill links (`expandCollectionCategories`); never set by
   * hand — the tenant builds them from the collection's categories and the
   * routed category.
   */
  items?: Aglyn.CollectionCategoryLink[]
}

/** Pill look, in palette tokens so it follows the site theme in both modes. */
const pillSx = (active: boolean) => ({
  px: 1.75,
  py: 0.75,
  borderRadius: 999,
  border: '1px solid',
  borderColor: active ? 'primary.main' : 'divider',
  bgcolor: active ? 'primary.main' : 'transparent',
  color: active ? 'primary.contrastText' : 'text.secondary',
  fontSize: 14,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  '&:hover': {
    borderColor: active ? 'primary.main' : 'text.primary',
    color: active ? 'primary.contrastText' : 'text.primary',
  },
})

/**
 * The category filter row for a collection listing (AGL-1321): "All" plus one
 * pill per category, each a REAL anchor to `/{collection}/category/{slug}`.
 *
 * Anchors, not click handlers, and that is the whole design. A JS-only toggle
 * would be invisible to crawlers, unopenable in a new tab, unlinkable, and
 * unreachable without hydration — and it could not exist anyway, since the
 * filter is resolved server-side before the page is composed. The pill the
 * current URL selected carries `aria-current="page"`, stamped on the server so
 * it is in the HTML rather than derived after hydration.
 */
const CollectionCategories = forwardRef<
  HTMLDivElement,
  CollectionCategoriesProps
>((props, ref) => {
  // `collectionSlug`/`allLabel` are compose-time: the tenant resolves them
  // while stamping `items`; strip so they never hit the DOM.
  const { collectionSlug, allLabel, items, ...rest } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  if (!items?.length) {
    if (!suppressNavigation) return <Box ref={ref} {...rest} />
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          {
            p: 2,
            border: '1px dashed',
            borderColor: 'divider',
            color: 'text.secondary',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
          },
          ...nodeSx,
        ]}
      >
        {'Category pills — All + one pill per collection category render here'}
      </Box>
    )
  }
  return (
    <MuiStack
      ref={ref}
      direction="row"
      spacing={1}
      {...rest}
      // MERGE, never replace (AGL-1450) — see Entry Meta above.
      sx={[{ flexWrap: 'wrap', rowGap: 1 }, ...nodeSx]}
    >
      {items.map((item) =>
        // Editing surfaces render the pill look without an href, so a click
        // in the besigner never navigates the canvas away.
        suppressNavigation ? (
          <Box key={item.href} sx={pillSx(item.active)}>
            {item.label}
          </Box>
        ) : (
          <AppLink
            key={item.href}
            href={item.href}
            underline="none"
            aria-current={item.active ? 'page' : undefined}
            sx={pillSx(item.active)}
          >
            {item.label}
          </AppLink>
        ),
      )}
    </MuiStack>
  )
})
CollectionCategories.displayName = 'AglynCollectionCategories'

export const collectionCategoriesSchema: Aglyn.ComponentSchema<CollectionCategoriesProps> =
  {
    $id: CATEGORIES_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Category Pills',
    description: 'A pill per collection category, each filtering the listing.',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiTagMultipleOutline.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'collectionSlug',
        label: 'Collection slug',
        description:
          'Content collection whose categories render as pills (e.g. ' +
          '"blog"). Leave blank on a list-template screen to use the ' +
          'collection from the URL.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'allLabel',
        label: 'All label',
        description:
          'Label for the unfiltered pill, which links to the collection ' +
          'root (default "All"). Clear the box to omit that pill — it then ' +
          'reads "none", which is what makes the omission stick. Typing ' +
          '"none" does the same thing.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        // Without this the emptied field persists NOTHING (AGL-1336): ddf
        // maps an emptied value to `clearedValue`, final-form's parse turns
        // `''` into `undefined`, and the missing key takes the runtime
        // default — so "clear it to omit that pill" was undoable by
        // clicking. Same shape as FIELD_COLOR_ALT1's `'default'` (AGL-1191):
        // a value that means something has to BE something.
        //
        // ddf only substitutes `clearedValue` when the field HAD an initial
        // value (`enhancedOnChange`'s `typeof initial !== 'undefined'`),
        // which is why the preset below seeds `allLabel` and why the
        // sentinel is a word an author can also type. A block that never
        // carried the prop has an already-empty box and nothing to clear.
        clearedValue: Aglyn.COLLECTION_ALL_PILL_NONE,
      },
    ],
  }

/* ── Collection Search (AGL-1516, Figma 494:1220) ───────────────────────── */

export interface CollectionSearchProps extends StackProps {
  /**
   * Collection whose entries this box searches (compose-time). Blank = the
   * collection routed by the current URL on list-template screens.
   */
  collectionSlug?: string
  /** Hint text inside the box (blank = "Search posts…"). */
  searchPlaceholder?: string
  /**
   * Server-stamped matchable text per entry (`expandCollectionSearch`);
   * never set by hand.
   */
  searchIndex?: Aglyn.CollectionEntrySearchItem[]
  /** How many entries the index was drawn from; never set by hand. */
  searchTotal?: number
  /** Whether that read reached its bound; never set by hand. */
  searchCapped?: boolean
}

/**
 * A search box for a collection that lives where the author puts it
 * (AGL-1516, Figma 494:1220).
 *
 * The entries block has had a search box since AGL-1516's first half, and it
 * renders inside that block — first child of its own stack. The frame puts
 * the field in the listing's TOOLBAR: category pills on the left, search and
 * RSS on the right, one row. That was unbuildable, and unbuildable in both
 * directions — a block's own child cannot be lifted out of it, and the pills
 * cannot be moved in, because every child of an entries block is cloned once
 * per entry. Three passes of authoring hit the same wall.
 *
 * So the field became its own block. It searches the collection the listing
 * beside it is drawn from, and answers with the suggestion panel (496:1218)
 * — the only behaviour a standalone box can honestly have, since it owns no
 * cards to hide. Enter submits to the site-wide results page, so the box
 * works with no JavaScript at all.
 *
 * Inert on editing surfaces, like Category Pills: the besigner has no index
 * to search, and a field that answered there would be answering about
 * nothing.
 */
const CollectionSearch = forwardRef<HTMLDivElement, CollectionSearchProps>(
  (props, ref) => {
    // Compose-time and search-only attributes: strip so they never hit the
    // DOM.
    const {
      collectionSlug,
      searchPlaceholder,
      searchIndex,
      searchTotal,
      searchCapped,
      ...rest
    } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    const fuzzy = useMemo(
      () =>
        searchIndex?.length
          ? new Fuse(searchIndex, { ...Aglyn.COLLECTION_SEARCH_FUSE_OPTIONS })
          : null,
      [searchIndex],
    )
    if (!suppressNavigation && !fuzzy) {
      // Nothing stamped on a live surface: an unknown collection, an empty
      // one, or a page composed before this block existed. Renders NOTHING
      // rather than a field that can only ever answer "no matches" — that
      // answer would read as a fact about the reader's query instead of
      // about the absent index behind it.
      return <Box ref={ref} {...rest} />
    }
    return (
      <MuiStack ref={ref} {...rest} sx={[{ alignItems: 'flex-end' }, ...nodeSx]}>
        <SuggestSearchBox
          fuzzy={fuzzy}
          {...(searchIndex ? { items: searchIndex } : {})}
          {...(searchPlaceholder === undefined
            ? {}
            : { placeholder: searchPlaceholder })}
          {...(suppressNavigation ? { inert: true } : {})}
          // The honest miss for THIS box. It searched one bounded read of the
          // collection — never "the collection", and on a category route not
          // even the whole of it, because the source arrives filtered. So it
          // reports the number it actually looked through, and says plainly
          // when that number was a ceiling rather than a total.
          emptyText={(text) =>
            searchCapped
              ? `No matches for “${text}” in the ${searchIndex?.length ?? 0} ` +
                'entries searched here — the collection holds more, which ' +
                'this box has not read.'
              : `No matches for “${text}” in the ${searchIndex?.length ?? 0} ` +
                'entries searched here.'
          }
        />
      </MuiStack>
    )
  },
)
CollectionSearch.displayName = 'AglynCollectionSearch'

export const collectionSearchSchema: Aglyn.ComponentSchema<CollectionSearchProps> =
  {
    $id: SEARCH_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Collection Search',
    description:
      'A search box for a content collection, with a suggestions dropdown.',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiMagnify.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'collectionSlug',
        label: 'Collection slug',
        description:
          'Content collection this box searches (e.g. "blog"). Leave blank ' +
          'on a list-template screen to use the collection from the URL.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'searchPlaceholder',
        label: 'Search placeholder',
        description:
          'Hint text inside this box. Blank shows "Search posts…", which is ' +
          'worth changing when the collection is not posts.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      // `searchIndex`, `searchTotal` and `searchCapped` are deliberately NOT
      // attributes: all three are server-stamped facts about a read, and an
      // author who could edit them could make the box lie about its own
      // reach.
    ],
  }

/* ── Presets ────────────────────────────────────────────────────────────── */

/**
 * Styling rides the node's own `sx`, never `props.sx` (AGL-1346): both
 * render, but only `node.sx` is the record the Styles panel can edit or
 * clear. `Leaf` composes `node.sx` last, so this is the same result.
 */
const entryText = (variant: string, children: string, extra?: object) => {
  const { sx, ...props } = (extra ?? {}) as Record<string, unknown>
  return {
    $id: null,
    componentId: 'muiTypography',
    pluginId: BUNDLE_ID,
    props: { variant, children, ...props },
    ...(sx ? { sx } : {}),
  }
}

export const collectionPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ENTRIES_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Collection Entries',
    pluginId: BUNDLE_ID,
    description:
      'Repeats a card (title, date, excerpt, Read more) per published ' +
      'entry of a content collection',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiPostOutline.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: ENTRIES_ID,
      pluginId: BUNDLE_ID,
      props: { spacing: 4 },
      nodes: [
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: BUNDLE_ID,
          props: { spacing: 0.5 },
          nodes: [
            entryText('h5', '{{entry.title}}', { component: 'h2' }),
            entryText('caption', '{{entry.date}}', {
              sx: { color: 'text.secondary' },
            }),
            entryText('body1', '{{entry.excerpt}}'),
            {
              $id: null,
              componentId: 'muiScreenLink',
              pluginId: BUNDLE_ID,
              props: {
                children: 'Read more',
                href: '{{entry.url}}',
                size: 'small',
              },
              sx: { alignSelf: 'flex-start' },
            },
          ],
        },
      ],
    },
  },
  {
    $id: generatePresetId(ENTRY_BODY_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Entry Body',
    pluginId: BUNDLE_ID,
    description: "Renders the current entry's markdown body, themed",
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTextLong.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: ENTRY_BODY_ID,
      pluginId: BUNDLE_ID,
      props: { markdown: '{{entry.body}}' },
    },
  },
  {
    $id: generatePresetId(RELATED_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Related Posts',
    pluginId: BUNDLE_ID,
    description:
      "Other entries sharing the current entry's category or tags",
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiNewspaperVariantOutline.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: RELATED_ID,
      pluginId: BUNDLE_ID,
      // `layout`, the two type steps and `dateFormat` are seeded rather than
      // left to the runtime fallback so each dropdown opens on the value the
      // block is actually rendering, and an author who tries another has a
      // named route back (AGL-1457/AGL-1459). The `show*` switches are
      // deliberately absent: their unset state IS the shipped behaviour.
      props: {
        heading: 'Related articles',
        limit: 3,
        layout: 'list',
        headingVariant: 'h5',
        titleVariant: 'subtitle1',
        dateFormat: Aglyn.COLLECTION_ENTRY_DATE_FORMAT_DEFAULT,
      },
    },
  },
  {
    $id: generatePresetId(SHARE_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Share Bar',
    pluginId: BUNDLE_ID,
    description: 'X, LinkedIn, Facebook, and copy-link buttons for the page',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiShareVariant.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: SHARE_ID,
      pluginId: BUNDLE_ID,
      props: { heading: 'Share' },
    },
  },
  {
    $id: generatePresetId(CATEGORIES_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Category Pills',
    pluginId: BUNDLE_ID,
    description:
      "Links to each of the collection's categories, filtering the listing",
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiTagMultipleOutline.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: CATEGORIES_ID,
      pluginId: BUNDLE_ID,
      // Seeded, not left to the runtime default: an explicit initial value
      // is what lets the attributes form substitute the cleared sentinel
      // when the author empties the box (AGL-1336).
      props: { allLabel: Aglyn.COLLECTION_ALL_PILL_DEFAULT },
    },
  },
  {
    // Every author-placeable component needs a preset: the element drawer is
    // built from PRESETS alone (`ComponentManager.schemasByCategory` iterates
    // `this.presets`), so a component with only a schema renders correctly
    // once a node exists but can never be put on a canvas by clicking.
    //
    // This one earns its place in the drawer because the entries block's own
    // search field cannot leave that block, and the toolbar row wants the
    // search beside the category pills rather than above the entries.
    $id: generatePresetId(SEARCH_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Collection Search',
    pluginId: BUNDLE_ID,
    description:
      'Search box for a collection, with a dropdown of matching entries',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiMagnify.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: SEARCH_ID,
      pluginId: BUNDLE_ID,
      // Deliberately no seeded props. Both attributes read blank as a real
      // choice — `collectionSlug` blank means "take the collection from the
      // URL", which is correct on the list templates this block is for, and
      // `searchPlaceholder` blank means the designed "Search posts…".
      props: {},
    },
  },
  {
    $id: generatePresetId(ENTRY_META_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Entry Meta',
    pluginId: BUNDLE_ID,
    description: 'Author · date · category line with tag chips for the entry',
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTagOutline.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: ENTRY_META_ID,
      pluginId: BUNDLE_ID,
      props: {
        date: '{{entry.date}}',
        // Named rather than left to the runtime fallback (AGL-1459): the
        // dropdown opens on the value the block is actually rendering, and
        // an author who tries a format has a named route back. `default` is
        // also the fallback, so naming it is the same choice, not a second.
        dateFormat: Aglyn.COLLECTION_ENTRY_DATE_FORMAT_DEFAULT,
        author: '{{entry.author}}',
        category: '{{entry.category}}',
        tags: '{{entry.tags}}',
      },
    },
  },
  {
    $id: generatePresetId(ENTRY_AUTHOR_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Entry Author',
    pluginId: BUNDLE_ID,
    description: 'Portrait, byline and bio card for the entry’s author',
    category: Aglyn.ComponentCategory.TEXT,
    icon: {
      path: mdiAccountCircleOutline.path,
      sx: { color: 'secondary.main' },
    },
    data: {
      $id: null,
      componentId: ENTRY_AUTHOR_ID,
      pluginId: BUNDLE_ID,
      // Seeded EMPTY, unlike Entry Meta's preset. Those bindings predate the
      // server fill and stay for compatibility; here the fill is the only
      // mechanism, and a seeded `{{entry.authorImage}}` would render a broken
      // portrait on every surface that is not an entry template.
      props: {},
    },
  },
]

export {
  CollectionCategories,
  CollectionEntries,
  CollectionEntryAuthor,
  CollectionEntryBody,
  CollectionEntryMeta,
  CollectionRelated,
  CollectionSearch,
  CollectionShare,
}
export default CollectionEntries
