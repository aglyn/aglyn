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

import { Box } from '@mui/material'
import type { ReactNode } from 'react'

export interface CardColumnsProps {
  /** The cards, in reading order. */
  items: Array<{ key?: string; children: ReactNode }>
  /**
   * Columns at the wide breakpoint. Always one below `md`.
   *
   * Two is right far more often than it looks, and a third column is not a
   * free improvement: multicol may not REORDER, so one card taller than its
   * share of the flow strands the columns after it. Measured while this
   * component was briefly tried on the screen version view — five cards, one
   * of them 764px — Chrome balanced three columns to 988/764/278px, 932px of
   * raggedness, against 210px at two. More columns means less room to even
   * them out. Raise this only against a measurement.
   *
   * When a page genuinely wants columns of DIFFERENT widths, this is the wrong
   * component: multicol cannot span. `GridItems masonry` can, and that is what
   * the screen version view ended up using.
   */
  columns?: number
  /** Gutter, in theme spacing units. */
  spacing?: number
}

/**
 * A BALANCED multi-column card flow for a page of cards (AGL-2486).
 *
 * ## The bug it was built for
 *
 * The staff org detail page laid twelve cards out as six rigid rows of two. Every
 * item in a flex row is as tall as the tallest one in it, so `Effective
 * entitlements` — a long table — made its whole row entitlements-tall and
 * left the area beside it dead. On a real org the hole was most of a screen,
 * and `Metered usage`, the card sitting in it, was pushed to the bottom of
 * that void with nothing above it.
 *
 * ## Why not `GridItems masonry`
 *
 * `GridItems` already carries a `masonry` mode, and it is the right answer
 * when a page's cards declare DIFFERENT widths — the billing page's top band
 * (`md: 4` beside `md: 8`) is exactly its case, and still uses it. But within
 * a band it groups items by their `size`: one width is one column. A run of
 * cards that all declare the same width therefore collapses into a single
 * column with the rest of the page empty — a worse layout than the one being
 * fixed, arrived at by using the fix.
 *
 * That is why this exists alongside it rather than replacing it, and why the
 * two are used together on `/[orgSlug]/billing`: masonry for the band whose
 * cards differ, this for the run whose cards do not.
 *
 * ## What this does instead
 *
 * CSS multi-column. The browser is told the column count and left to place
 * the fragmentation breaks, which is the one mechanism that BALANCES: column
 * heights come out near-equal by construction, whatever the cards weigh
 * today, because `column-fill: balance` is the default and the browser
 * re-solves it on every layout.
 *
 * That is deliberately not a measured layout. A JS masonry assigns each card
 * a row span from its measured height, and the span is only right until the
 * content changes size — a span that is too small does not leave a gap, it
 * places the next card UNDERNEATH the one before it. Overlapping cards are a
 * far worse defect than the hole this exists to close, and they appear
 * exactly when measurement is least reliable: data still arriving, images
 * still decoding. Here nothing claims a height on any card's behalf, so
 * nothing can go stale and nothing can overlap.
 *
 * `break-inside: avoid` on each item is what keeps a card whole rather than
 * split across the column boundary; without it multicol would happily saw a
 * table in half. Below `md` the count drops to one and the cards read in
 * their authored order, which is the same collapse the flex grid had.
 */
export default function CardColumns({
  items,
  columns = 2,
  spacing = 3,
}: CardColumnsProps) {
  return (
    <Box
      sx={{
        columnCount: { xs: 1, md: columns },
        columnGap: spacing,
        // A card is never sawn across the boundary. The `-webkit-` and legacy
        // page-break aliases are still what older WebKit reads.
        '& > *': {
          breakInside: 'avoid',
          WebkitColumnBreakInside: 'avoid',
          pageBreakInside: 'avoid',
          // The gutter BETWEEN stacked cards. A multicol child cannot use the
          // parent's row gap — there are no rows — so the spacing is its own
          // bottom margin, and the last one in a column keeps it too, which
          // is why the container carries no extra padding.
          mb: spacing,
          // Multicol boxes are fragment containers; a card that establishes
          // its own block formatting context is the reliably-measured one.
          display: 'block',
          // A wide child (a table, a long unbroken id) must not push the
          // column track past the edge.
          minWidth: 0,
        },
        // A card that renders NOTHING must not weigh on the balance. A plugin
        // widget slot renders an empty fragment when no plugin is entitled for
        // it, leaving a wrapper that carries only its bottom margin — which
        // multicol counts as real content and balances the columns around.
        // `:empty` is exact here: the wrapper has no element and no text node
        // in that case and only in that case.
        // More specific than the `& > *` above (`:empty` adds a class-level
        // component), so `display: none` wins over `display: block`.
        '& > *:empty': { display: 'none' },
      }}
    >
      {items.map((item, index) => (
        <Box key={item.key ?? index}>{item.children}</Box>
      ))}
    </Box>
  )
}
