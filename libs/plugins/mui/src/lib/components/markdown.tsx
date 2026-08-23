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
import { mdiLanguageMarkdown, mdiTableOfContents } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Box, { type BoxProps } from '@mui/material/Box'
import MuiLink from '@mui/material/Link'
import type { Theme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import { observer } from 'mobx-react-lite'
import type { MouseEvent, ReactNode } from 'react'
import { forwardRef, useContext, useMemo } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const MARKDOWN_ID: Aglyn.ComponentId = 'markdown'
/** A compose-time token the tenant has not substituted — never a document. */
const UNRESOLVED_TOKEN = /^\{\{[^}]+\}\}$/
export const TABLE_OF_CONTENTS_ID: Aglyn.ComponentId = 'tableOfContents'

/**
 * A long document's body type, which is NOT MUI's `body1` (AGL-1162).
 *
 * A privacy policy is read, not skimmed: the house measure for running prose
 * is 17px on a 1.75 leading, in `text.primary` rather than the softened
 * secondary a caption uses. MUI's default 16/1.5 sets the same words tighter
 * and lighter, and a page built from Typography defaults reads visibly
 * different from one built by hand next to it — which is how the legal pages
 * ended up hand-assembled from hundreds of Typography nodes in the first
 * place.
 */
const BODY_SX = {
  fontSize: 17,
  lineHeight: 1.75,
  color: 'text.primary',
} as const

/**
 * Heading ramp (AGL-1162). Sizes step across `{xs, sm, md}` and the tracking
 * steps WITH them: tracking is a function of size, so a single letterSpacing
 * that looks right at the desktop size is visibly loose on a phone. Negative
 * throughout — display sizes need the letters pulled together, which is the
 * opposite of the positive tracking small uppercase labels take.
 */
const HEADING_SX = {
  2: {
    fontSize: { xs: 26, sm: 30, md: 34 },
    letterSpacing: { xs: '-0.3px', sm: '-0.4px', md: '-0.5px' },
    lineHeight: 1.25,
    fontWeight: 700,
  },
  3: {
    fontSize: { xs: 19, sm: 20, md: 22 },
    letterSpacing: { xs: '-0.1px', sm: '-0.15px', md: '-0.2px' },
    lineHeight: 1.35,
    fontWeight: 700,
  },
} as const

/**
 * Breathing room a heading keeps above it when an anchor lands on it. Sites
 * built here usually have a sticky app bar, and without this the browser
 * scrolls the heading to y=0 — underneath the bar — so a working link looks
 * like a broken one.
 */
const ANCHOR_SCROLL_MARGIN = Aglyn.HEADING_ANCHOR_SCROLL_MARGIN

/**
 * Inline runs as elements (AGL-1162), following the entry-body renderer:
 * internal links route through AppLink for client-side navigation, external
 * ones stay plain anchors, and editing surfaces render the link look without
 * an href so clicking never leaves the canvas.
 */
const renderInlines = (
  inlines: Aglyn.MarkdownInline[],
  suppressNavigation?: boolean,
): ReactNode[] =>
  inlines.map((inline, index) => {
    if (inline.type === 'bold') return <strong key={index}>{inline.text}</strong>
    if (inline.type === 'italic') return <em key={index}>{inline.text}</em>
    if (inline.type === 'link') {
      if (suppressNavigation) {
        return (
          <MuiLink key={index} component="span" sx={{ cursor: 'default' }}>
            {inline.text}
          </MuiLink>
        )
      }
      return Aglyn.isInternalMarkdownHref(inline.href) ? (
        <AppLink key={index} href={inline.href}>
          {inline.text}
        </AppLink>
      ) : (
        <MuiLink key={index} href={inline.href}>
          {inline.text}
        </MuiLink>
      )
    }
    return <span key={index}>{inline.text}</span>
  })

export interface MarkdownProps extends BoxProps {
  /** The document, as markdown-lite source. */
  content?: string
}

/**
 * A whole document authored as markdown (AGL-1162).
 *
 * The elements that made a legal or policy page before this were hundreds of
 * Typography nodes, one per paragraph — which meant the page could not be
 * pasted from, or back into, the markdown file in Drive that is its actual
 * source. Here the source IS the element's content, so updating the page is
 * one paste.
 *
 * Rendered through the shared markdown-lite parser, which emits plain data
 * blocks and never an HTML string — so there is no `dangerouslySetInnerHTML`
 * anywhere on this path and nothing to sanitize. Parsing is pure, so the full
 * document server-renders and the text is in the crawled HTML.
 *
 * Child NODES are never rendered, in either branch (AGL-1388). The document
 * is the `content` prop; there is no position in a parsed block list that a
 * dropped element could occupy, so the schema turns dropping off and
 * `nodeAcceptsChildren` now honors that — a drop lands as a sibling instead.
 * `children` is destructured away rather than left in `rest` because the
 * empty-content branch spreads `rest` onto a childless Box: without this, a
 * Markdown element rendered exactly the child nodes it had swallowed a
 * moment earlier as soon as its content was cleared.
 */
const Markdown = forwardRef<HTMLDivElement, MarkdownProps>((props, ref) => {
  const { content, sx, children: _children, ...rest } = props
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  /**
   * The site being rendered, for image blocks (AGL-1686). Read once here
   * rather than per block: hooks cannot run inside the `blocks.map` below,
   * and a document may hold any number of images.
   */
  const { hostId } = Aglyn.useSite()
  const source = (content ?? '').trim()
  const blocks = useMemo(
    () => (source ? Aglyn.parseMarkdownLite(source) : []),
    [source],
  )
  // Slugs are derived rather than stored (see collectMarkdownHeadings), and
  // keyed by block index so the ids land on the right headings even when two
  // of them carry the same words. The map is built in `markdown-lite` now,
  // because every renderer needs exactly this and five of the six were not
  // getting it (AGL-1162).
  const slugs = useMemo(() => Aglyn.markdownHeadingSlugs(blocks), [blocks])

  if (!source) {
    // Editing surfaces get somewhere to click; the published page renders
    // nothing rather than a placeholder nobody meant to publish.
    if (!suppressNavigation) return <Box ref={ref} sx={sx} {...rest} />
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
          },
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
      >
        {'Markdown — paste the document into the Content attribute'}
      </Box>
    )
  }

  return (
    <Box ref={ref} sx={sx} {...rest}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Typography
              key={index}
              // The anchor a table of contents links to. `component` is set
              // explicitly because a Typography with only an `sx` fontSize
              // still renders a <p>: the page would screenshot correctly and
              // have no headings in it at all.
              id={slugs[index]}
              component={block.level === 2 ? 'h2' : 'h3'}
              sx={{
                ...HEADING_SX[block.level],
                color: 'text.primary',
                scrollMarginTop: `${ANCHOR_SCROLL_MARGIN}px`,
                mt: block.level === 2 ? 5 : 3.5,
                mb: 1.5,
                '&:first-of-type': { mt: 0 },
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
              // Resolved, exactly as `image.tsx` resolves its `src` prop
              // (AGL-1686). A document records WHICH ASSET; turning that into
              // a URL is the renderer's business, so the `/api/media/cdn/…`
              // route shape never has to be baked into a published document.
              // Every other value — a legacy storage URL, a legacy CDN path,
              // an author-typed hotlink — passes through untouched.
              src={Aglyn.resolveMediaSrc(block.src, { hostId })}
              alt={block.alt}
              sx={{ maxWidth: '100%', borderRadius: 1, my: 2 }}
              // `lazy` alone until AGL-2486. A markdown image is by
              // definition inside prose the reader scrolls through, so it
              // belongs in the same deferred rank as everything else that is
              // not the lead image.
              {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
            />
          )
        }
        if (block.type === 'list') {
          return (
            <Box
              key={index}
              component="ul"
              sx={{ ...BODY_SX, my: 2, pl: 3, '& li': { mb: 1 } }}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {renderInlines(item, suppressNavigation)}
                </li>
              ))}
            </Box>
          )
        }
        // A numbered list (AGL-1320): the same measure as the bullet list,
        // as a real `<ol>` carrying `start` — a legal document's enumerated
        // elements are the reason this block exists.
        if (block.type === 'orderedList') {
          return (
            <Box
              key={index}
              component="ol"
              start={block.start}
              sx={{ ...BODY_SX, my: 2, pl: 3, '& li': { mb: 1 } }}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {renderInlines(item, suppressNavigation)}
                </li>
              ))}
            </Box>
          )
        }
        // Code and tables scroll rather than wrap, like every other
        // markdown-lite renderer here (AGL-974): a wrapped command line
        // reads as two commands, and a squeezed table column loses the
        // structure that made it a table.
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
                  ...BODY_SX,
                  fontSize: 16,
                  borderCollapse: 'collapse',
                  width: '100%',
                  '& th, & td': {
                    border: '1px solid',
                    borderColor: 'divider',
                    px: 1.5,
                    py: 1,
                  },
                  '& th': { bgcolor: 'action.hover', fontWeight: 600 },
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
        // A pull-quote (AGL-1315): the document's body measure, one size up
        // and italic, behind a left accent — palette tokens keep it right in
        // both modes.
        if (block.type === 'quote') {
          return (
            <Typography
              key={index}
              component="blockquote"
              sx={{
                ...BODY_SX,
                my: 3,
                mx: 0,
                pl: 2.5,
                borderLeft: '3px solid',
                borderColor: 'primary.main',
                fontStyle: 'italic',
                fontSize: 21,
                lineHeight: 1.6,
              }}
            >
              {renderInlines(block.inlines, suppressNavigation)}
            </Typography>
          )
        }
        return (
          <Typography key={index} component="p" sx={{ ...BODY_SX, my: 2 }}>
            {renderInlines(block.inlines, suppressNavigation)}
          </Typography>
        )
      })}
    </Box>
  )
})
Markdown.displayName = 'AglynMarkdown'

/* ── Table of contents ──────────────────────────────────────────────────── */

export interface TableOfContentsProps extends BoxProps {
  /**
   * The Markdown element this lists the headings of. Empty means "the first
   * Markdown element on the screen", which is the answer on every page that
   * has exactly one — see {@link resolveMarkdownSource}.
   */
  forNodeId?: string
  /** Aside heading; an empty string renders no heading at all. */
  heading?: string
  /** Deepest heading level listed: `'2'` for top level only. */
  depth?: '2' | '3'
}

/**
 * Which Markdown element a table of contents speaks for (AGL-1162).
 *
 * Resolved through the NODE TREE, never the DOM: the besigner canvas renders
 * inside a closed shadow root, so a `document.querySelector` from a component
 * finds nothing there and the aside would be empty in the one place it is
 * being authored.
 *
 * The tree is walked from the root in document order, so "the first Markdown
 * element" means the first one a reader meets — not the first key of a node
 * map, whose order is storage detail.
 *
 * An explicit `forNodeId` wins, compared with `leafIdsMatch` because the
 * stored id is the raw canvas id while a composed tree namespaces layout and
 * reusable-component grafts (AGL-573/1229). A pick that no longer resolves —
 * the element was deleted and re-added, which is exactly what re-pasting a
 * document looks like — falls back to the first Markdown element rather than
 * leaving a published page with an empty aside.
 */
export function resolveMarkdownSource(
  root: Aglyn.NodeSchema | undefined,
  forNodeId?: string,
): string {
  const found: Array<{ $id: string; content: string }> = []
  const walk = (node: Aglyn.NodeSchema | undefined): void => {
    if (!node) return
    // Two element types hold a markdown-lite document, and an aside beside a
    // blog article is the case this issue was opened for (AGL-1162): the
    // Collection Entry Body carries the post, under `markdown` rather than
    // `content`, and used to be invisible here — so "On this page" on an
    // article template rendered its authoring affordance forever.
    const source =
      node.componentId === MARKDOWN_ID
        ? 'content'
        : node.componentId === Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID
          ? 'markdown'
          : undefined
    if (source) {
      const props = (node.resolvedProps ?? node.props ?? {}) as Record<
        string,
        unknown
      >
      const content = String(props[source] ?? '')
      // An entry body on an unresolved surface is the literal
      // `{{entry.body}}` token. It is not a document, and treating it as one
      // would let it win over a real Markdown element further down the page
      // and empty the aside on the canvas.
      if (!UNRESOLVED_TOKEN.test(content.trim())) {
        found.push({ $id: node.$id, content })
      }
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  if (forNodeId) {
    const picked = found.find((entry) => Aglyn.leafIdsMatch(entry.$id, forNodeId))
    if (picked) return picked.content
  }
  return found[0]?.content ?? ''
}

/**
 * Scrolls to a heading in the cases the browser cannot reach, and ONLY those
 * (AGL-1162). Returns whether it handled the click.
 *
 * In `document` it deliberately does nothing and lets the plain `#slug`
 * anchor work: native fragment navigation updates the address bar, adds a
 * history entry the back button understands, and honours the site's CSS
 * `scroll-behavior` — none of which a hand-rolled `scrollIntoView` gives
 * back. It is also the only version that works with JavaScript off.
 *
 * (`behavior: 'smooth'` was the first attempt at the whole job, and it is
 * exactly the wrong shape: a browser that declines to animate — a background
 * tab, reduced-motion — leaves the click prevented and the page unmoved, so
 * a working link reads as a broken one.)
 *
 * The besigner canvas renders inside a CLOSED shadow root, where the heading
 * is not in `document` at all and a fragment navigation finds nothing. There
 * the link's own `getRootNode()` is the shadow root holding both ends, and
 * `ShadowRoot.getElementById` finds the heading.
 */
export function scrollToHeading(anchor: Element, slug: string): boolean {
  const root = anchor.getRootNode()
  if (root === anchor.ownerDocument || !(root as ShadowRoot).getElementById) {
    return false
  }
  const target = (root as ShadowRoot).getElementById(slug)
  if (!target) return false
  // No explicit `behavior`: 'auto' follows the scrolling box's CSS
  // `scroll-behavior`, so a site that asked for smooth still gets it.
  target.scrollIntoView({ block: 'start' })
  return true
}

/**
 * What the sidebar's chrome costs, above and below the list (AGL-2486).
 *
 * The list's bound is `100dvh` MINUS this, so it is a function of the window
 * rather than a height somebody picked. Measured on the live
 * `/legal/marketplace-publisher-agreement` sidebar, which is the shape every
 * legal page uses: the card is `position: sticky; top: 96px` under the app
 * bar, then 24px of card padding and 31px of "ON THIS PAGE" label sit above
 * the list and 31px of padding below it — 182px of chrome. 200 leaves the
 * card's bottom BORDER inside the window rather than flush against it, so
 * the card reads as a card and not as a page that ran out.
 *
 * It is an allowance, not a contract: this component renders inside whatever
 * the author built around it, and it cannot read that card's `top` offset.
 * Being a MAX height, an allowance a little too generous only means a few
 * pixels of the card sit below the fold; one a little too tight only means
 * the scroll box starts a line sooner. Both are recoverable, which is the
 * whole reason this is a `max-height` and not a `height`.
 */
const TOC_VIEWPORT_ALLOWANCE = '200px'

/**
 * The list is its own scroll box once it outgrows the window (AGL-2486).
 *
 * The bug: nothing here was bounded, and the card the author wraps this in is
 * `position: sticky`. A sticky box taller than the viewport does not scroll
 * into view — it pins at its `top` offset and everything past the window's
 * bottom edge is simply unreachable. Measured on the Marketplace Publisher
 * Agreement (14 `h2`s) in a 1100x480 window: the card stood 502px tall from
 * `top: 96px` and overhung the fold by 118px, entry 11 was cut through the
 * middle of its own text at the window edge, and 12 to 14 could not be
 * reached by any scroll — `ol.scrollTop` stayed 0, because the list was not a
 * scroll box at all. Which row gets cut moves with the window height and the
 * browser zoom; the reported sighting was entry 8. Either way it did not read
 * as "there is more", it read as a document with fewer sections than it has.
 *
 * Three things this deliberately is NOT:
 *
 * - NOT a `height`. A `max-height` is inert until the content exceeds it, so
 *   the four-item TOCs (`/legal/dmca`, `/legal/subprocessors`) keep their
 *   exact present box: no scroll region, no reserved gutter, no dead space.
 *   That is also why `overflow-y` is `auto` and never `scroll`.
 *
 * - NOT applied below `md`. The bound only makes sense for a sidebar. In the
 *   stacked narrow layout the TOC is a full-width block in the page flow, and
 *   bounding it there would plant a scroll trap in the middle of an article
 *   to solve a clipping problem that layout does not have.
 *
 * - NOT silent, and the FADE is the part that carries that. A scroll box a
 *   reader cannot see is the same bug wearing a scrollbar: measured in Chrome
 *   on macOS, `offsetWidth - clientWidth` on this list is 0 even with
 *   `scrollbar-color` set — the platform draws an OVERLAY scrollbar, which is
 *   invisible until you have already guessed to scroll. So the thumb styling
 *   is the secondary cue, for the platforms that draw one at rest, and the
 *   primary cue is a bottom fade: the cut stops being a slice through the
 *   middle of a word and becomes an edge that visibly continues.
 *
 * The fade rides a scroll-driven animation on purpose: a `scroll()` timeline
 * on a box with nothing to scroll is INACTIVE, so its animation applies no
 * styles at all. That is the only way to say "fade only when overflowing" in
 * CSS with no measuring and no JavaScript, and it degrades to plain
 * unfaded-but-scrollable in a browser that lacks it. Verified both ways at
 * 1100x480: the 14-entry list fades and scrolls, the 4-entry
 * `/legal/subprocessors` list computes `mask-image: none` and does not.
 *
 * NO new attribute goes with this, deliberately. The three the element has —
 * `forNodeId`, `heading`, `depth` — all answer "which headings does this
 * list", and a "list height" field would hand the author back the very
 * decision this bug is made of. The right answer is "as much of the window as
 * there is", which is a thing CSS can work out and an author cannot type.
 */
const TABLE_OF_CONTENTS_LIST_SX = (theme: Theme) => ({
  listStyle: 'none',
  m: 0,
  p: 0,
  [theme.breakpoints.up('md')]: {
    maxHeight: `calc(100vh - ${TOC_VIEWPORT_ALLOWANCE})`,
    // `dvh` over `vh` where it exists: `vh` is the LARGEST viewport, so a
    // window with a visible toolbar gets a bound taller than the space it
    // has — which is the bug again, in miniature.
    '@supports (height: 100dvh)': {
      maxHeight: `calc(100dvh - ${TOC_VIEWPORT_ALLOWANCE})`,
    },
    overflowY: 'auto',
    // Reaching the end of the list must not then throw the page down a
    // screen — the reader was navigating the sidebar, not the document.
    overscrollBehavior: 'contain',
    scrollbarWidth: 'thin',
    // `text.disabled`, not `divider`: a 12%-black thumb is one you have to
    // already know is there. `3px` is QUOTED because a bare 3 is a theme
    // radius STEP and lands as 12px on a 6px-wide thumb.
    scrollbarColor: `${theme.palette.text.disabled} transparent`,
    '&::-webkit-scrollbar': { width: 6 },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: theme.palette.text.disabled,
      borderRadius: '3px',
    },
    '@supports (animation-timeline: scroll())': {
      animation: 'aglyn-toc-overflow-fade linear',
      animationTimeline: 'scroll(self block)',
    },
  },
  // Held at the fade until the list is all but scrolled out, then dropped, so
  // the final entry is never the one the affordance obscures. `none` does not
  // interpolate with a gradient, so that last step is a clean switch.
  '@keyframes aglyn-toc-overflow-fade': {
    '0%, 92%': {
      maskImage:
        'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)',
    },
    '100%': { maskImage: 'none' },
  },
})

/**
 * "On this page" (AGL-1162) — the headings of a Markdown element on the same
 * screen, as working anchor links.
 *
 * A mobx `observer` because it reads ANOTHER node's props: the renderer's
 * Leaf re-renders on changes to the node it is rendering, and nothing else,
 * so without this the aside in the besigner would keep listing the headings
 * of the document as it was when the aside mounted.
 */
const TableOfContents = observer(
  forwardRef<HTMLElement, TableOfContentsProps>((props, ref) => {
    const { forNodeId, heading, depth, sx, ...rawRest } = props
    /**
     * The cleared-prop guard, applied to the props that LEAVE this
     * component rather than to all of them (AGL-1451).
     *
     * A props-wide `dropClearedProps` would be wrong here, and this is the
     * component that shows why the wrapper is not a reflex: `heading` reads
     * an EMPTY value as a real author choice — "clear it to render no
     * label", which is what its help text promises and what the `heading
     * === undefined ? 'On this page' : heading` line below implements. A
     * guard over the whole props object would strip the cleared heading and
     * put the default label back, i.e. eat the choice the author made. So
     * `heading` and `depth` are read as authored, and the guard covers only
     * what is spread onto the Box.
     */
    const rest = dropClearedProps(rawRest)
    const source = resolveMarkdownSource(Aglyn.canvas.rootNode, forNodeId)
    const entries = useMemo(() => {
      const headings = Aglyn.collectMarkdownHeadings(
        Aglyn.parseMarkdownLite(source),
      )
      return depth === '2'
        ? headings.filter((entry) => entry.level === 2)
        : headings
    }, [source, depth])
    const title = heading === undefined ? 'On this page' : heading

    if (!entries.length) {
      // Same split as the Markdown element: an affordance while authoring,
      // nothing at all on the published page.
      return (
        <Box
          ref={ref}
          component="nav"
          sx={[
            {
              p: 2,
              border: '1px dashed',
              borderColor: 'divider',
              color: 'text.secondary',
              fontSize: 12,
              // A page whose Markdown element has no headings yet should not
              // publish an empty box where an aside was meant to be.
              '@media print': { display: 'none' },
            },
            ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
          ]}
          {...rest}
        >
          {'Table of contents — add ## headings to the Markdown element'}
        </Box>
      )
    }

    return (
      <Box
        ref={ref}
        component="nav"
        aria-label={title || 'Table of contents'}
        sx={sx}
        {...rest}
      >
        {title ? (
          <Typography
            component="p"
            sx={{
              fontSize: 12,
              fontWeight: 700,
              // Positive tracking here, unlike the document headings: this is
              // a small uppercase label, where the letters need pushing apart
              // rather than pulling together.
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
              color: 'text.secondary',
              mb: 1.5,
            }}
          >
            {title}
          </Typography>
        ) : null}
        <Box component="ol" sx={TABLE_OF_CONTENTS_LIST_SX}>
          {entries.map((entry) => (
            <Box component="li" key={entry.slug} sx={{ mb: 0.75 }}>
              <MuiLink
                // A real href, so the entry is a link to a crawler, works
                // with no JavaScript, and can be copied out of the page.
                href={`#${entry.slug}`}
                underline="hover"
                color="text.secondary"
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  // Prevented ONLY when this actually moved the page — on a
                  // published page it does nothing and the anchor works the
                  // way anchors do.
                  if (scrollToHeading(event.currentTarget, entry.slug)) {
                    event.preventDefault()
                  }
                }}
                sx={{
                  display: 'block',
                  fontSize: 15,
                  lineHeight: 1.5,
                  // Sub-headings indent; nothing else distinguishes them, so
                  // a flat list of both levels reads as one long list.
                  pl: entry.level === 3 ? 2 : 0,
                  '&:hover': { color: 'text.primary' },
                }}
              >
                {entry.text}
              </MuiLink>
            </Box>
          ))}
        </Box>
      </Box>
    )
  }),
)
TableOfContents.displayName = 'AglynTableOfContents'

export const markdownSchema: Aglyn.ComponentSchema<MarkdownProps> = {
  $id: MARKDOWN_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Markdown',
  description:
    'A whole document written as markdown. It takes no child elements.',
  category: Aglyn.ComponentCategory.TEXT,
  icon: { path: mdiLanguageMarkdown.path, sx: { color: '#455a64' } },
  flags: {
    // The document is the `content` attribute; dropping elements inside a
    // rendered document would put them somewhere the markdown cannot say.
    dropping: Aglyn.FEATURE_FLAG.DISABLED,
  },
  attributes: [
    {
      name: 'content',
      label: 'Content',
      description:
        'The document, as markdown. Headings (## and ###), paragraphs, ' +
        'bold/italic, links, bullet and 1. numbered lists, images, fenced ' +
        'code, pipe tables and > quotes. Paste the whole source file — a ' +
        'Table of contents element on the same screen lists the ## and ### ' +
        'headings automatically.',
      // The WYSIWYG rather than a raw textarea (AGL-1616): this attribute is
      // a whole document — the published Privacy Policy body is one of them —
      // and editing it as raw markdown-lite meant a 13 KB paste (AGL-1594).
      // The stored value is unchanged, so every renderer is untouched.
      component: Aglyn.FieldComponentType.MARKDOWN,
    },
  ],
}

export const tableOfContentsSchema: Aglyn.ComponentSchema<TableOfContentsProps> =
  {
    $id: TABLE_OF_CONTENTS_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Table of Contents',
    description:
      "An on-this-page list linking to a Markdown element's headings.",
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiTableOfContents.path, sx: { color: '#455a64' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'forNodeId',
        label: 'Markdown element',
        description:
          'The Markdown element to list the headings of. Leave empty on a ' +
          'page with one Markdown element — the first one on the screen is ' +
          'used, and a pick that no longer exists falls back to it too.',
        component: Aglyn.FieldComponentType.NODE_SELECT,
      },
      {
        name: 'heading',
        label: 'Heading',
        description: 'Label above the list. Clear it to render no label.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'depth',
        label: 'Levels',
        description: 'How deep the list goes.',
        component: Aglyn.FieldComponentType.SELECT,
        // `depth` never reaches MUI — it is read here, as `depth === '2'`.
        // So the `''` was not a rendering defect; it was an option that
        // could not survive a save (AGL-1191), which meant an author who
        // set "## headings only" and then changed their mind could not put
        // it back. `'3'` states the same thing as a real, persistable
        // value — and is what `TableOfContentsProps.depth` has declared
        // all along, so the option list was the half that had drifted.
        // Both levels remain what an unset field means (AGL-1451).
        options: [
          { value: '3', label: '## and ### headings' },
          { value: '2', label: '## headings only' },
        ],
      },
    ],
  }

export const markdownPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(MARKDOWN_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Markdown',
    pluginId: BUNDLE_ID,
    description: 'A whole document, authored as markdown',
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiLanguageMarkdown.path, sx: { color: '#455a64' } },
    data: {
      $id: null,
      componentId: MARKDOWN_ID,
      pluginId: BUNDLE_ID,
      props: {
        content:
          '## First section\n\nReplace this with your document. Paste ' +
          'markdown straight from the source file.\n\n' +
          '### A sub-section\n\nHeadings become anchors, and a Table of ' +
          'contents element on the same screen links to them.',
      },
    },
  },
  {
    $id: generatePresetId(TABLE_OF_CONTENTS_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Table of Contents',
    pluginId: BUNDLE_ID,
    description: 'On this page — links to a Markdown element’s headings',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiTableOfContents.path, sx: { color: '#455a64' } },
    data: {
      $id: null,
      componentId: TABLE_OF_CONTENTS_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export { Markdown, TableOfContents }
export default Markdown
