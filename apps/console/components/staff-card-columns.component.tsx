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

export interface StaffCardColumnsProps {
  /** The cards, in reading order. */
  items: Array<{ key?: string; children: ReactNode }>
  /** Columns at the wide breakpoint. Always one below `md`. */
  columns?: number
  /** Gutter, in theme spacing units. */
  spacing?: number
}

/**
 * A BALANCED multi-column card flow for the staff detail screens (AGL-2486).
 *
 * ## The bug
 *
 * The org detail page laid twelve cards out as six rigid rows of two. Every
 * item in a flex row is as tall as the tallest one in it, so `Effective
 * entitlements` — a long table — made its whole row entitlements-tall and
 * left the area beside it dead. On a real org the hole was most of a screen,
 * and `Metered usage`, the card sitting in it, was pushed to the bottom of
 * that void with nothing above it.
 *
 * ## Why not `GridItems masonry`
 *
 * `GridItems` already carries a `masonry` mode built for exactly this, and it
 * is the right answer on billing and on the marketplace listing — but it
 * buckets items into columns BY THEIR `size`, and every card here declares
 * the same `{ xs: 12, md: 6 }`. One bucket is one column, so turning the flag
 * on would have collapsed all twelve cards into a single half-width column
 * with the other half of the page empty: a worse layout than the one being
 * fixed, arrived at by using the fix. The mode needs items of differing
 * widths to have anything to arrange.
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
export default function StaffCardColumns({
  items,
  columns = 2,
  spacing = 3,
}: StaffCardColumnsProps) {
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
      }}
    >
      {items.map((item, index) => (
        <Box key={item.key ?? index}>{item.children}</Box>
      ))}
    </Box>
  )
}
