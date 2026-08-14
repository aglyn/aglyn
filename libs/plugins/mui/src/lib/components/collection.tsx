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
import { Fuse } from '@aglyn/shared-util-vendor'
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
export const CATEGORIES_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_CATEGORIES_COMPONENT_ID

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
   * Show a search box that filters the RENDERED entries by title/excerpt as
   * the reader types (AGL-1516, Figma 494:1220). Opt-in and default off, so
   * every existing instance renders exactly as before.
   *
   * Client-evaluated over the entries this block already holds — the page is
   * ISR-cached, so a keystroke never costs a Firestore read. On a paginated
   * list that set is the CURRENT PAGE, and the empty state says so rather
   * than pretending global search.
   */
  search?: boolean
  /** Hint text inside the search box (blank = "Search posts…"). */
  searchPlaceholder?: string
  /**
   * Server-stamped matchable text per rendered entry
   * (`expandCollectionEntries`, AGL-1516); never set by hand.
   */
  searchIndex?: Aglyn.CollectionEntrySearchItem[]
}

/** The toolbar search field, from the frame (Figma 494:1220). */
const SEARCH_FIELD_WIDTH = 240

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
      search,
      searchPlaceholder,
      searchIndex,
      children,
      ...props
    },
    ref,
  ) => {
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    const [query, setQuery] = useState('')
    const items = search ? searchIndex : undefined
    const fuzzy = useMemo(
      () =>
        items?.length
          ? new Fuse(items, {
              // The icon picker's weighted-keys shape (use-mdi-icons-fuzzy):
              // the title names the post, the excerpt merely describes it.
              keys: [
                { name: 'title', weight: 0.7 },
                { name: 'excerpt', weight: 0.3 },
              ],
              includeScore: true,
              shouldSort: true,
              // Tuned for prose, MEASURED before shipping: the icon picker
              // fuzzes 2-word icon names, where Fuse's defaults are fine. On
              // sentence-long excerpts the default location scoring buries a
              // legitimate mid-sentence hit ("…and workflows into one…"),
              // and the default 0.6 threshold matches "media" against every
              // post on letter soup. Ignoring location and tightening to 0.3
              // keeps typo tolerance ("platfrom" still finds the post) while
              // a filtered-out card actually means something.
              ignoreLocation: true,
              threshold: 0.3,
            })
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
    const live = !suppressNavigation && Boolean(fuzzy) && groupSize > 0
    const trimmed = query.trim()
    let visible: ReactNode[] | ReactNode = children
    let emptyState: ReactNode = null
    if (live && trimmed && fuzzy) {
      const matched = new Set(
        fuzzy.search(trimmed).map((result) => result.refIndex),
      )
      visible = childArray.filter((_, index) =>
        matched.has(Math.floor(index / groupSize)),
      )
      if (!(visible as ReactNode[]).length) {
        // HONEST scope (AGL-1516): a paginated block holds one page window,
        // and pretending the search was global would turn every miss into a
        // false "this post does not exist".
        const paginated = (toCount(perPage, 0) ?? 0) > 0
        emptyState = (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {paginated
              ? `No matches for “${trimmed}” on this page — other pages ` +
                'are not searched.'
              : `No matches for “${trimmed}”.`}
          </Typography>
        )
      }
    }
    // The field renders when there is something to search, and as an inert
    // affordance on editing surfaces so the author sees what they enabled.
    // A live surface with nothing stamped (unknown collection, zero entries)
    // renders no field at all — a search box over nothing is a lie.
    const field =
      suppressNavigation || live ? (
        <Box role="search" sx={searchFieldSx}>
          <MdiIcon path={mdiMagnify.path} />
          <InputBase
            value={query}
            placeholder={
              (searchPlaceholder ?? '').trim() || 'Search posts…'
            }
            inputProps={{ 'aria-label': 'Search entries' }}
            sx={{ flex: 1, fontSize: 14, color: 'text.primary' }}
            // Inert in the canvas, like the pills: no onChange, so a click
            // or stray keystroke never edits state the surface cannot use.
            {...(suppressNavigation
              ? { readOnly: true }
              : {
                  onChange: (event) => setQuery(event.target.value),
                })}
          />
        </Box>
      ) : null
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
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiPostOutline.path, sx: { color: '#00796b' } },
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
        name: 'search',
        label: 'Search',
        description:
          'Show a search box that filters the rendered entries by title ' +
          'and excerpt as the reader types. It searches the entries this ' +
          'block rendered — on a paginated list, the current page only.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'searchPlaceholder',
        label: 'Search placeholder',
        description:
          'Hint text inside the search box (blank = "Search posts…").',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        // Meaningless while there is no search box to hint in.
        condition: { when: 'search', is: true },
      },
      // `searchIndex` is deliberately NOT an attribute: it is server-stamped
      // by expandCollectionEntries, like Category Pills' `items` and Related
      // Posts' `entries`.
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
  const source = (markdown ?? '').trim()
  const unresolved = !source || UNRESOLVED_TOKEN.test(source)
  const blocks = useMemo(
    () => (unresolved ? [] : Aglyn.parseMarkdownLite(source)),
    [source, unresolved],
  )
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
          return block.level === 2 ? (
            <Typography key={index} variant="h4" component="h2" gutterBottom>
              {renderInlines(block.inlines, suppressNavigation)}
            </Typography>
          ) : (
            <Typography key={index} variant="h5" component="h3" gutterBottom>
              {renderInlines(block.inlines, suppressNavigation)}
            </Typography>
          )
        }
        if (block.type === 'image') {
          return (
            <Box
              key={index}
              component="img"
              src={block.src}
              alt={block.alt}
              sx={{ maxWidth: '100%', borderRadius: 1, my: 1 }}
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
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTextLong.path, sx: { color: '#00796b' } },
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

/**
 * Lists other entries of the same collection sharing the current entry's
 * category or a tag (AGL-582). The tenant stamps `entries` at compose time
 * on entry renders; without them the besigner shows an affordance and the
 * published site renders nothing.
 *
 * Two layouts (AGL-1457). `list` is the plain-link list that has always
 * shipped and stays the default — the block is live on every blog entry, so
 * a new default would restyle published pages nobody asked about. `cards` is
 * the article frame's grid: cover, category chip, title, at an author-set
 * column count.
 */
const CollectionRelated = forwardRef<HTMLDivElement, CollectionRelatedProps>(
  (props, ref) => {
    // `limit` is compose-time: the tenant resolves it while stamping
    // `entries`; strip it so it never hits the DOM. `showCover`/`layout`/
    // `columns` are read here, so they must not reach it either.
    const { heading, limit, entries, showCover, layout, columns, ...rest } =
      props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    // The resolver every other surface shares (AGL-1215): a stamped `media:`
    // reference becomes a CDN URL HERE, not in the document, so one
    // reference keeps working across sites. Called before the early return —
    // it is a hook.
    const { hostId } = Aglyn.useSite()
    if (!entries?.length) {
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
          {'Related posts — entries sharing this entry’s category or ' +
            'tags render here'}
        </Box>
      )
    }
    const title = heading ?? 'Related articles'
    const headingNode = title ? (
      <Typography variant="h5" component="h2">
        {title}
      </Typography>
    ) : null
    const titleNode = (entry: Aglyn.CollectionRelatedItem) =>
      suppressNavigation ? (
        <Typography variant="subtitle1">{entry.title}</Typography>
      ) : (
        <AppLink href={entry.url} variant="subtitle1">
          {entry.title}
        </AppLink>
      )
    /**
     * The cover, when the author asked for one AND the entry has one. An
     * entry without a cover gets no box at all rather than a placeholder:
     * the related list is a real feed, and a row of grey rectangles is worse
     * than a row of titles.
     */
    const coverNode = (entry: Aglyn.CollectionRelatedItem) => {
      const src = showCover
        ? Aglyn.resolveMediaSrc(entry.coverImage, { hostId })
        : undefined
      if (!src) return null
      return (
        <Box
          component="img"
          src={src}
          alt={entry.title ?? ''}
          loading="lazy"
          sx={{
            display: 'block',
            width: '100%',
            height: RELATED_COVER_HEIGHT,
            objectFit: 'cover',
            borderRadius: 1,
          }}
        />
      )
    }

    if (layout === 'cards') {
      // `toCount` rounds and rejects junk; `|| default` also rejects 0, which
      // it would otherwise accept as a column count and emit `repeat(0, …)`.
      const columnCount =
        toCount(columns, RELATED_DEFAULT_COLUMNS) || RELATED_DEFAULT_COLUMNS
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
          {entries.map((entry, index) => (
            <MuiStack key={index} spacing={1}>
              {coverNode(entry)}
              {entry.category ? (
                <Chip
                  label={entry.category}
                  size="small"
                  variant="outlined"
                  sx={relatedChipSx}
                />
              ) : null}
              {titleNode(entry)}
              {entry.date ? (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {entry.date}
                </Typography>
              ) : null}
            </MuiStack>
          ))}
        </Box>
      )
    }
    return (
      <MuiStack ref={ref} spacing={1.5} {...rest}>
        {headingNode}
        {entries.map((entry, index) => (
          <MuiStack key={index} spacing={0.25}>
            {coverNode(entry)}
            {titleNode(entry)}
            {entry.date || entry.category ? (
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary' }}
              >
                {[entry.date, entry.category].filter(Boolean).join(' · ')}
              </Typography>
            ) : null}
          </MuiStack>
        ))}
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
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiNewspaperVariantOutline.path, sx: { color: '#00796b' } },
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
          <Typography variant="subtitle2" sx={{ mr: 1 }}>
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
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiShareVariant.path, sx: { color: '#00796b' } },
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
  const line = [authorValue, dateValue, categoryValue]
    .filter(Boolean)
    .join(' · ')
  if (!line && !tagList.length && !avatarSrc) {
    if (!suppressNavigation) return <Box ref={ref} {...rest} />
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          {
            p: 1,
            border: '1px dashed',
            borderColor: 'divider',
            color: 'text.secondary',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
          },
          ...nodeSx,
        ]}
      >
        {'Entry meta — date · category · tags render here'}
      </Box>
    )
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
          loading="lazy"
          sx={{
            display: 'block',
            width: ENTRY_AVATAR_SIZE,
            height: ENTRY_AVATAR_SIZE,
            borderRadius: '50%',
            objectFit: 'cover',
            // No background plate: a brand mark with a transparent ground
            // would sit on a grey disc nobody asked for.
          }}
        />
      ) : null}
      {line ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {line}
        </Typography>
      ) : null}
      {tagList.map((tag) => (
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
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTagOutline.path, sx: { color: '#00796b' } },
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
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showCategory',
        label: 'Show category',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showTags',
        label: 'Show tags',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showAuthor',
        label: 'Show author',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showAvatar',
        label: 'Show avatar',
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
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiTagMultipleOutline.path, sx: { color: '#00796b' } },
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
    icon: { path: mdiPostOutline.path, sx: { color: '#00796b' } },
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
    icon: { path: mdiTextLong.path, sx: { color: '#00796b' } },
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
    icon: { path: mdiNewspaperVariantOutline.path, sx: { color: '#00796b' } },
    data: {
      $id: null,
      componentId: RELATED_ID,
      pluginId: BUNDLE_ID,
      // `layout` is seeded rather than left to the runtime fallback so the
      // dropdown opens on the value the block is actually rendering, and an
      // author who tries Cards has a named route back (AGL-1457). `showCover`
      // is deliberately absent: OFF is the shipped behaviour.
      props: { heading: 'Related articles', limit: 3, layout: 'list' },
    },
  },
  {
    $id: generatePresetId(SHARE_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Share Bar',
    pluginId: BUNDLE_ID,
    description: 'X, LinkedIn, Facebook, and copy-link buttons for the page',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiShareVariant.path, sx: { color: '#00796b' } },
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
    icon: { path: mdiTagMultipleOutline.path, sx: { color: '#00796b' } },
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
    $id: generatePresetId(ENTRY_META_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Entry Meta',
    pluginId: BUNDLE_ID,
    description: 'Author · date · category line with tag chips for the entry',
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTagOutline.path, sx: { color: '#00796b' } },
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
]

export {
  CollectionCategories,
  CollectionEntries,
  CollectionEntryBody,
  CollectionEntryMeta,
  CollectionRelated,
  CollectionShare,
}
export default CollectionEntries
