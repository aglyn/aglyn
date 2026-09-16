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

import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  Table,
  TableContainer,
  type TableContainerProps,
  type TableProps,
} from '@mui/material'
import { forwardRef } from 'react'
import { scrollableTableWrapperSx } from '../utils/scroll-overflow'

export interface ScrollTableProps extends TableProps {
  /**
   * The scroll box around the table. Its `sx` is merged AFTER the box's own,
   * so a caller can bound the box's height or space it out without taking
   * the scroll away. `role`, `aria-label` and `tabIndex` belong here when a
   * surface has to name the box (the customer-page Table element does).
   */
  ContainerProps?: TableContainerProps & {
    [attribute: `data-${string}`]: unknown
  }
}

/**
 * EVERY TABLE THAT IS NOT A RECORD LIST (AGL-3045).
 *
 * ## Why a table needs a box of its own
 *
 * A MUI `Card` clips what leaves it (`overflow: hidden`), and a `Table` is at
 * least as wide as its widest unbreakable content — an id, a date, a figure.
 * A bare table whose content outgrows its card is cut off at the card's edge,
 * and nothing on the page can reach the columns past it.
 *
 * `DataTableComponent` and `ListTable` scroll their own columns, so a record
 * list — rows of jobs, people, orders, anything paged or sorted — belongs
 * there. What is left is drawn here: a breakdown by kind, month or
 * jurisdiction, a key/value readout, a preview inside a dialog, a row of
 * inputs.
 *
 * ## What it does
 *
 * The table sits in MUI's `TableContainer` (`width: 100%`, `overflow-x:
 * auto`), so content wider than the card scrolls inside the card instead of
 * being cut by it. The box carries the house overflow fade from
 * `scroll-overflow`, which is how an overlay-scrollbar platform — macOS, by
 * default — admits the table continues: a scroll-driven animation that is
 * inactive, and paints nothing, while there is nothing to scroll.
 *
 * ## Why the table keeps `width: 100%` here
 *
 * The customer-page Table element sizes its table to `max-content`, capped at
 * 560px, so a comparison matrix of prose cells scrolls rather than wrapping
 * each cell into six lines (AGL-2568). That cap is safe on a full-width page
 * section, which is never narrower than 560px from a tablet up. A console card
 * is: two-column card flows put cards well under 560px at tablet and laptop
 * widths, so the same sizing would put a scrollbar on tables that fit today.
 * The console's defect is the unbreakable cell, and a `width: 100%` table
 * overflows on exactly that — so the table fills its card, wraps what can
 * wrap, and scrolls when what cannot wrap does not fit. A surface that wants
 * the prose sizing passes it as the table's `sx`, as the Table element does.
 *
 * ## Keyboard
 *
 * Chromium (130+) and Firefox make a scroll box with no focusable content
 * keyboard-reachable on their own, and a table of links or buttons scrolls to
 * whichever one takes focus. A surface that must also NAME the box — a region
 * a screen reader announces — passes `role`, `aria-label` and `tabIndex`
 * through `ContainerProps` (see `scrollRegionProps`).
 *
 * ## Shape
 *
 * Every `Table` prop goes to the table; `ContainerProps` go to the box; `ref`
 * is the box, the element that holds the table's place on the page.
 * `aglyn/no-raw-mui-table` refuses a MUI `Table` or `TableContainer` anywhere
 * but this file.
 */
export const ScrollTable = forwardRef<HTMLDivElement, ScrollTableProps>(
  function ScrollTable(props, ref) {
    const { ContainerProps, ...tableProps } = props
    const { sx: containerSx, ...container } = ContainerProps ?? {}
    return (
      <TableContainer
        ref={ref}
        {...container}
        sx={mergeSxProps(scrollableTableWrapperSx, containerSx)}
      >
        <Table {...tableProps} />
      </TableContainer>
    )
  },
)
ScrollTable.displayName = 'ScrollTable'

export default ScrollTable
