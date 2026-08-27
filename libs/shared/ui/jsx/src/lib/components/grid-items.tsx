/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { Box, Grid, type GridProps } from '@mui/material'
import { forwardRef } from 'react'

/* eslint-disable-next-line */
export interface GridItemsProps
  extends GridProps,
    ReplaceKey<JSX.OverrideableComponentProps, 'component', 'itemComponent'> {
  items: GridProps[]
  /**
   * Lay the items out as MASONRY instead of rigid rows.
   *
   * ## The bug this exists to kill
   *
   * A `<GridItems>` of cards is a twelve-column flex row that wraps, and every
   * item in a wrapped row is as tall as the tallest one in it. Two consequences,
   * both reported from real pages:
   *
   * 1. **Holes.** Billing puts `Current plan` (4) beside `Usage` (8). `Usage` is
   *    more than twice as tall, so the row is `Usage`-tall and the area under
   *    `Current plan` is dead — while `Metered usage estimate` (4), the card
   *    shaped to fill it, is pushed onto its own row far below with eight
   *    columns of nothing beside it.
   * 2. **The stranded sidebar.** The marketplace listing detail is `body` (8),
   *    `changelog` (8), `sidebar` (4). Two eights cannot share a row, so the
   *    changelog wraps — and the sidebar, which follows it in source order,
   *    wraps WITH it. `Install`, the point of the page, starts a screen below
   *    the top of the content with blank space above it.
   *
   * ## What it does instead
   *
   * Items are bucketed into COLUMNS by their `size`, and each column stacks its
   * own cards at their natural heights. `Current plan` and `Metered usage
   * estimate` are both 4-wide, so they become one 4-wide column beside the
   * 8-wide `Usage` column; `body` and `changelog` become one 8-wide column
   * beside the 4-wide sidebar. A full-width item (span 12) interrupts the
   * bucketing and takes a band of its own, so source order is preserved across
   * it — without that, billing's five full-width cards would collect at the
   * bottom in one column and reorder the page.
   *
   * ## Why bucketing rather than measured row spans
   *
   * The obvious implementation is a fine-grained row grid where each card's
   * MEASURED height becomes a `grid-row: span n`, packed `dense`. It was built
   * that way first and it is a trap: `n` is only correct until the card's
   * content changes size, and a card whose `n` is too small does not merely
   * leave a gap — the next card is placed UNDERNEATH IT. Overlapping cards are
   * a far worse defect than the holes this mode exists to close, and they
   * appear exactly when measurement is least reliable (data still arriving,
   * images still decoding). Keeping the whole thing in CSS means there is no
   * measurement to go stale: heights are whatever the browser computes, every
   * frame, and cards cannot overlap because nothing ever claims a height on
   * their behalf.
   *
   * It also costs nothing at hydration. A measured layout renders wrong on the
   * server and corrects on mount; this renders identically in both.
   *
   * ## The one behaviour change
   *
   * At a breakpoint where every item is full width (`xs: 12`, the phone case)
   * the columns stack, so cards are read column by column rather than in the
   * authored order — on billing, `Current plan` then `Metered usage estimate`
   * then `Usage`. Cards that share a column are the ones that share a width,
   * which in practice is what makes them belong together.
   */
  masonry?: boolean
}

/** A per-breakpoint column count, normalized from MUI's `size`. */
type SpanProfile = Record<string, number>

/** The breakpoint an item with no explicit `size` is sized at. */
const BASE_BREAKPOINT = 'xs'
const FULL_SPAN = 12

/**
 * MUI Grid props that describe the flex-row layout masonry replaces, and so
 * must not reach the masonry container.
 */
const FLEX_ROW_PROPS = [
  'container',
  'spacing',
  'rowSpacing',
  'columnSpacing',
  'columns',
  'direction',
  'wrap',
  'size',
  'offset',
] as const

/**
 * An item's `size` as a per-breakpoint column count.
 *
 * `'auto'`/`'grow'` have no column-count equivalent and become full width,
 * which is the safe reading: an item that wanted to size itself gets a band of
 * its own rather than being bucketed against a width it never declared.
 */
function spanProfile(size: GridProps['size']): SpanProfile {
  const one = (value: unknown) =>
    typeof value === 'number' && value > 0 ? Math.min(FULL_SPAN, Math.round(value)) : FULL_SPAN
  if (size == null) return { [BASE_BREAKPOINT]: FULL_SPAN }
  if (typeof size === 'number' || typeof size === 'string')
    return { [BASE_BREAKPOINT]: one(size) }
  if (Array.isArray(size)) return { [BASE_BREAKPOINT]: one(size[0]) }
  const entries = Object.entries(size).map(
    ([breakpoint, value]) => [breakpoint, one(value)] as const,
  )
  return entries.length ? Object.fromEntries(entries) : { [BASE_BREAKPOINT]: FULL_SPAN }
}

/** The profile as a `grid-column` value `sx` can resolve per breakpoint. */
const gridColumnFor = (profile: SpanProfile) =>
  Object.fromEntries(
    Object.entries(profile).map(([breakpoint, span]) => [breakpoint, `span ${span}`]),
  )

/** MUI's breakpoint keys, narrowest first. */
const BREAKPOINT_ORDER = ['xs', 'sm', 'md', 'lg', 'xl'] as const

/**
 * The column count at the WIDEST breakpoint the item declares — the width it is
 * bucketed by.
 *
 * Not `Math.max` over the profile, which was the first attempt and is wrong in
 * a way that silently disables the whole mode: essentially every item in this
 * codebase is written `{ xs: 12, md: 4 }`, so the maximum is 12 for all of them
 * and every card reads as full width. It has to be the value at the widest
 * declared breakpoint — 4 — because the multi-column arrangement only exists at
 * wide viewports in the first place.
 *
 * Read from the profile rather than from the current viewport on purpose:
 * measuring the breakpoint in JS would make the server and client renders
 * disagree. Bucketing is decided once; `sx` resolves the responsive
 * `grid-column` in CSS, so the narrow layout still collapses to a stack.
 */
const layoutSpan = (profile: SpanProfile) => {
  const declared = BREAKPOINT_ORDER.filter((breakpoint) => profile[breakpoint] != null)
  const widest = declared[declared.length - 1]
  return widest ? profile[widest] : FULL_SPAN
}

/** `sx` (which may already be an array or a function) as a flat array. */
const sxArray = (sx: unknown): any[] => (sx == null ? [] : Array.isArray(sx) ? sx : [sx])

interface MasonryColumn {
  key: string
  profile: SpanProfile
  entries: Array<{ item: GridProps; index: number }>
}

/**
 * A band of ONE width fans out; a band of mixed widths does not.
 *
 * Same-size items sharing a column is right when something else occupies the
 * rest of the row — billing's two 4-wide cards stacked beside its 8-wide
 * `Usage` is the case this mode was built for. It is wrong when the band is
 * ALL of that width: eight `md: 6` health probes then queue in one 6-wide
 * column with six columns of nothing beside them, which is a worse layout than
 * the rigid rows masonry replaced.
 *
 * So a single-width band spreads across the `12 / span` columns it was asking
 * for, round-robin, which keeps left-to-right reading order — item 0 top-left,
 * item 1 top-right — rather than the column-major order that filling one
 * column at a time would give.
 */
function fanOut(band: MasonryColumn[]): MasonryColumn[] {
  if (band.length !== 1) return band
  const [column] = band
  const span = layoutSpan(column.profile)
  const columns = Math.floor(FULL_SPAN / span)
  if (columns < 2 || column.entries.length < 2) return band
  const spread: MasonryColumn[] = Array.from({ length: columns }, (_, i) => ({
    key: `${column.key}#${i}`,
    profile: column.profile,
    // Typed, not inferred: an empty literal is `any[]` under the stricter
    // library tsconfigs even though the annotation above it is not enough to
    // narrow a property inside `Array.from`'s callback.
    entries: [] as MasonryColumn['entries'],
  }))
  column.entries.forEach((entry, index) => {
    spread[index % columns].entries.push(entry)
  })
  return spread.filter((candidate) => candidate.entries.length > 0)
}

/**
 * Items → bands → columns.
 *
 * A band is a maximal run of items that are not full width; a full-width item
 * is a band on its own. Within a band, items that declare the same `size` share
 * a column, in source order — unless the band is entirely one width, which
 * {@link fanOut} spreads.
 */
function buildBands(items: GridProps[]): MasonryColumn[][] {
  const bands: MasonryColumn[][] = []
  let current: MasonryColumn[] | null = null

  items.forEach((item, index) => {
    const profile = spanProfile(item.size)
    const key = JSON.stringify(profile)
    if (layoutSpan(profile) >= FULL_SPAN) {
      bands.push([{ key, profile, entries: [{ item, index }] }])
      current = null
      return
    }
    if (!current) {
      current = []
      bands.push(current)
    }
    const column = current.find((candidate) => candidate.key === key)
    if (column) column.entries.push({ item, index })
    else current.push({ key, profile, entries: [{ item, index }] })
  })

  return bands.map(fanOut)
}

export const GridItems = forwardRef<any, GridItemsProps>((props, ref) => {
  const {
    items = [],
    itemComponent: ItemComponent = Grid,
    masonry,
    spacing = 0,
    sx,
    ...rest
  } = props

  if (!masonry) {
    return (
      <Grid ref={ref} container spacing={spacing} sx={sx as any} {...rest}>
        {items.map(
          ({ key: itemKey, id, ...item }: GridProps & { id?: unknown }, index: number) => (
            <ItemComponent key={itemKey ?? id ?? index} {...item} />
          ),
        )}
      </Grid>
    )
  }

  const gap = spacing
  const containerProps = Object.fromEntries(
    Object.entries(rest).filter(([key]) => !FLEX_ROW_PROPS.includes(key as any)),
  )

  return (
    <Box
      ref={ref}
      {...(containerProps as any)}
      sx={[
        {
          display: 'grid',
          // Twelve fractional tracks with a zero minimum. A `span` can never
          // resolve wider than its share of the container, and `minmax(0, 1fr)`
          // stops a wide child (a table, a long unbroken string) from pushing a
          // track past the edge — which is what used to shove the listing
          // page's sidebar out of the viewport.
          gridTemplateColumns: `repeat(${FULL_SPAN}, minmax(0, 1fr))`,
          // Columns are as tall as their own contents, never as tall as the
          // tallest column beside them.
          alignItems: 'start',
          gap,
        },
        ...sxArray(sx),
      ]}
    >
      {buildBands(items).map((band, bandIndex) =>
        band.map((column) => (
          <Box
            key={`${bandIndex}:${column.key}`}
            sx={{
              gridColumn: gridColumnFor(column.profile),
              display: 'flex',
              flexDirection: 'column',
              gap,
              // Without this a flex column refuses to shrink below its content's
              // intrinsic width and the grid track overflows with it.
              minWidth: 0,
              // An item whose children rendered NOTHING must not leave a gap.
              // A plugin widget slot renders an empty fragment when no plugin
              // is entitled for it, and the wrapper it leaves behind is still
              // a flex child — so the column's `gap` is applied on both sides
              // of a zero-height box, drawing a hole exactly where the absent
              // card was. `:empty` is exact: the wrapper has no element and no
              // text node in that case and only in that case.
              '& > *:empty': { display: 'none' },
            }}
          >
            {column.entries.map(({ item, index }) => {
              const { key: itemKey, id, size, sx: itemSx, ...itemRest } = item as GridProps & {
                id?: unknown
              }
              return (
                <ItemComponent
                  key={itemKey ?? id ?? index}
                  {...itemRest}
                  sx={[{ minWidth: 0 }, ...sxArray(itemSx)]}
                />
              )
            })}
          </Box>
        )),
      )}
    </Box>
  )
})

GridItems.displayName = 'GridItems'
GridItems.aglyn = true

export default GridItems
