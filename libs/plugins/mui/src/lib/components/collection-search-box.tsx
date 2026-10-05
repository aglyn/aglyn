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
import { mdiMagnify } from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSoftGetSubmit } from '@aglyn/shared-ui-jsx/hooks/use-soft-get-submit'
// The icon picker's fuzzy matcher (use-mdi-icons-fuzzy), not a re-implementation
// (AGL-1516): search here has to feel like search does everywhere else in the
// product, and two matchers is how they drift. A TYPE here: the matcher itself
// is fetched on a reader's first keystroke — see `loadCollectionFuse`.
import type { Fuse } from '@aglyn/shared-util-vendor/fuse'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import InputBase from '@mui/material/InputBase'
import MuiStack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { type FormEvent, useMemo, useState } from 'react'

/**
 * The search box the Collection Entries block and the standalone Collection
 * Search block both draw (AGL-1516/AGL-1525), and the fuzzy matcher behind
 * it. Its own module so the other collection elements carry neither the MUI
 * input nor the panel (AGL-3401); the matcher itself is fetched only when a
 * reader types.
 */

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

/** The matcher's constructor, once something has asked for it. */
let loadedFuse: typeof Fuse | undefined
let fuseLoad: Promise<typeof Fuse> | undefined

/**
 * The fuzzy matcher, fetched the first time a reader types into a collection
 * search box (AGL-3401) — one fetch per visit, however many boxes ask.
 *
 * It was a static import, and `fuse.js` is 26 KB of the 68 KB this module
 * weighed: every page that placed ANY collection element downloaded and
 * parsed it, including the many whose entries block has no search at all and
 * the rest, where most visitors never type. The box itself still renders on
 * the server; only the matcher waits for a query.
 *
 * A failed fetch (offline, a deploy mid-visit) is forgotten rather than
 * cached, so the next keystroke tries again instead of the box going dead.
 */
export const loadCollectionFuse = (): Promise<typeof Fuse> =>
  (fuseLoad ??= import('./collection-search-fuse').then(
    (module) => (loadedFuse = module.Fuse),
    (error: unknown) => {
      fuseLoad = undefined
      throw error
    },
  ))

/**
 * The Fuse index over `items`, and the call that asks for the matcher.
 *
 * `fuzzy` is null until the first `requestFuzzy()` has resolved — a box
 * nobody typed into never builds an index. A box mounted after another one
 * loaded the matcher starts with it, so a second search on the page answers
 * its first keystroke synchronously.
 */
export const useEntryFuse = (
  items: readonly Aglyn.CollectionEntrySearchItem[] | undefined,
): { fuzzy: EntryFuse | null; requestFuzzy: () => void } => {
  const [FuseConstructor, setFuseConstructor] = useState<
    typeof Fuse | undefined
  >(() => loadedFuse)
  const fuzzy = useMemo(
    () =>
      FuseConstructor && items?.length
        ? // The ONE matcher config (AGL-1525), shared with the site-wide
          // results page the suggestion panel links to — a query the panel
          // forgave must not come back empty from "View all results".
          new FuseConstructor(items, { ...Aglyn.COLLECTION_SEARCH_FUSE_OPTIONS })
        : null,
    [FuseConstructor, items],
  )
  const requestFuzzy = () => {
    if (FuseConstructor) return
    loadCollectionFuse().then(
      (loaded) => setFuseConstructor(() => loaded),
      // The box keeps working as a form that submits to `/search`; the next
      // keystroke asks again.
      () => undefined,
    )
  }
  return { fuzzy, requestFuzzy }
}

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
export const SearchField = ({
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
export const SuggestSearchBox = ({
  fuzzy,
  requestFuzzy,
  items,
  placeholder,
  inert,
  emptyText,
}: {
  /** Null until the matcher has loaded; see {@link useEntryFuse}. */
  fuzzy: EntryFuse | null
  /** Asks for the matcher; called on every query, a no-op once it is here. */
  requestFuzzy: () => void
  items?: readonly Aglyn.CollectionEntrySearchItem[]
  placeholder?: string
  inert?: boolean
  /** The honest miss for the set THIS box searched. */
  emptyText: (query: string) => string
}) => {
  const [query, setQuery] = useState('')
  /** Escape dismissed THIS answer (AGL-1525); typing brings it back. */
  const [closed, setClosed] = useState(false)
  const softSubmit = useSoftGetSubmit()
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
        requestFuzzy()
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
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        // The client router keeps this box mounted when it sits in the
        // site's chrome, so the panel is shut here rather than left open
        // over the results page it just opened.
        setClosed(true)
        softSubmit(event)
      }}
      sx={suggestionAnchorSx}
    >
      {field}
      {/*
        Not until the matcher is here: a panel drawn in the moment it takes
        to arrive would say "No matches" about a query nothing has searched.
      */}
      {trimmed && !closed && fuzzy ? (
        <SuggestionPanel
          suggestions={suggestions}
          trimmed={trimmed}
          emptyText={emptyText(trimmed)}
        />
      ) : null}
    </Box>
  )
}
