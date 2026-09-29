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
import { mdiNewspaperVariantOutline } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { forwardRef, useContext } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
// One coercion for every authored count in this bundle (AGL-1457) — number
// fields round-trip as strings, and a second parser here would drift.
import { toCount } from '../utils/to-count'
import {
  RELATED_SAMPLE_PUBLISHED_AT,
  RELATED_SAMPLE_CATEGORY,
} from './collection-common'
// The theme's own type steps (AGL-2486), shared with the Typography element
// rather than a second list here — one rung list, one place to extend.
import { typographyVariants } from './typography'

// Persisted component id (AGL-551/582); the compose pipeline references it
// through the @aglyn/aglyn constant. Never rename.
export const RELATED_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_RELATED_COMPONENT_ID

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

/**
 * The cover's PROPORTION in the card grid.
 *
 * ONE ratio for every card, rather than each record's own shape: the titles
 * under the covers only line up when the covers are the same height, and a
 * grid of honest shapes is a ragged grid.
 *
 * The ratio is the shape the console asks authors for — 1200 x 630, the same
 * image that heads the entry and doubles as its share card — so a cover
 * authored as instructed loses nothing to the crop. The frame's own card is
 * 445 x 180 (Figma 170:243), which is 2.47 against that art's 1.90: held
 * there, `objectFit: cover` discarded 23% of every card's picture at every
 * width. Cover art is usually a composed lockup, so what it discards is the
 * title set on it.
 *
 * Before the ratio it was a fixed 180px height, which was the frame's number
 * without the frame's shape: a card is 445 wide there, the grid's columns
 * grow with the viewport and 180 does not, so every extra pixel of width
 * flattened the box further — 3.57:1 by a 2000px viewport. A ratio holds the
 * shape at every width; this ratio holds the picture as well.
 */
const RELATED_COVER_ASPECT = '1200 / 630'

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
  '& .MuiChip-label': {
    // 9px, the frame's own inset on a 69 x 24 chip.
    px: 1.125,
    // The frame sets this label in the same uppercase, letter-spaced step as
    // the kicker above an article title, which is what `overline` IS in the
    // site theme. Naming the step keeps the chip on the theme's scale instead
    // of a hand-written size that drifts the moment the theme moves.
    typography: 'overline',
    // `size="small"` gives the chip the frame's 24px height, and `overline`
    // carries a 2.66 line-height meant for a standalone kicker with room
    // around it. Inside a fixed-height chip the box sets the height, so the
    // line collapses to it and the label centres.
    lineHeight: 1,
  },
}

/** The heading step the block has always emitted. */
const RELATED_DEFAULT_HEADING_VARIANT = 'h5'

/** The card-title step the block has always emitted. */
const RELATED_DEFAULT_TITLE_VARIANT = 'subtitle1'

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
              width: '100%',
              aspectRatio: RELATED_COVER_ASPECT,
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
            aspectRatio: RELATED_COVER_ASPECT,
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
        // 12px between cover, chip and title — the frame's rhythm (170:243
        // puts the chip at y=192 under a cover ending at 180, and the title
        // at y=228 under a chip ending at 216).
        <MuiStack spacing={1.5}>
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
          'Default Subtitle 1; the title takes the surrounding text color ' +
          'rather than the link color.',
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
        // Unset means SHOWN in the renderer above, so the switch has to
        // OPEN in that position or it lies about the block in front of
        // the author — and the first click, which writes the `true` that
        // was already in effect, changes nothing and reads as a dead
        // control (AGL-2506).
        initialValue: true,
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
        // Unset means SHOWN in the renderer above, so the switch has to
        // OPEN in that position or it lies about the block in front of
        // the author — and the first click, which writes the `true` that
        // was already in effect, changes nothing and reads as a dead
        // control (AGL-2506).
        initialValue: true,
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

export { CollectionRelated }
