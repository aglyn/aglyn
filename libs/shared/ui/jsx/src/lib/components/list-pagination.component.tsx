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

import TablePagination from '@mui/material/TablePagination'
import type { TablePaginationProps } from '@mui/material/TablePagination'
import {
  TABLE_PAGE_SIZE_OPTIONS,
  TABLE_ROWS_PER_PAGE_LABEL,
} from '../const/table-pagination'

export interface ListPaginationProps {
  /** Zero-based, like MUI's own. */
  page: number
  pageSize: number
  /** Rows rendered on the CURRENT page — not the collection's total. */
  rowCount: number
  onPageChange: (page: number) => void
  /** Omit to render the size menu read-only-ish; most lists should pass it. */
  onPageSizeChange?: (pageSize: number) => void
  /**
   * The collection's total, when the caller genuinely knows it — a
   * client-side list, or a server `count()`. Leave undefined for a cursor or
   * growing-window feed, where nobody knows it without paying for it.
   */
  count?: number
  /** Cursor/window feeds: whether a further page exists. */
  hasMore?: boolean
  /** Override the count line, e.g. the screens tree's "top-level screens". */
  labelDisplayedRows?: TablePaginationProps['labelDisplayedRows']
  pageSizeOptions?: number[]
  disabled?: boolean
}

/**
 * The footer under every paginated list, whatever is behind it.
 *
 * The console grew four pagination grammars — a MUI X `DataGrid` footer, a
 * hand-rolled `TablePagination`, a bare Previous/Next button pair, and a
 * "Load more" that only ever grew — so the same act took a different control
 * depending on which list a reader was standing in, and two of the four
 * offered no way to change the page size at all. This is the one control.
 *
 * ## Counting without a count
 *
 * A cursor feed cannot say how many rows exist without reading them, which is
 * the cost pagination is there to avoid. MUI already models this: `count={-1}`
 * renders "1–10 of more than 10" and leaves Next live.
 *
 * The trick is the LAST page, where the total stops being unknown — once no
 * further page exists, `page × pageSize + rowCount` IS the total. Handing MUI
 * the real number there is what disables Next, so the control needs no
 * per-version knowledge of how to reach inside and disable that button. The
 * count line also stops saying "more than" at exactly the point it would
 * become a lie.
 *
 * `DataGrid` keeps its own footer — it renders one internally and cannot be
 * given this — but it is fed the same options, default and label from
 * `const/table-pagination`, so the two read identically.
 */
export function ListPagination(props: ListPaginationProps) {
  const {
    page,
    pageSize,
    rowCount,
    onPageChange,
    onPageSizeChange,
    count,
    hasMore,
    labelDisplayedRows,
    pageSizeOptions = TABLE_PAGE_SIZE_OPTIONS,
    disabled,
  } = props

  const resolvedCount =
    count ?? (hasMore ? -1 : page * pageSize + rowCount)

  return (
    <TablePagination
      // These footers sit under Stacks and Lists as often as under a Table,
      // and a <td> outside a <table> is invalid markup the browser reparents.
      component="div"
      count={resolvedCount}
      page={page}
      rowsPerPage={pageSize}
      onPageChange={(_event, next) => onPageChange(next)}
      onRowsPerPageChange={
        onPageSizeChange
          ? (event) => {
              // Back to the first page: page 4 of a 10-row list does not
              // exist once the reader asks for 50 at a time, and MUI renders
              // an out-of-range page as an empty list with no explanation.
              onPageSizeChange(Number(event.target.value))
              onPageChange(0)
            }
          : undefined
      }
      rowsPerPageOptions={pageSizeOptions}
      labelRowsPerPage={TABLE_ROWS_PER_PAGE_LABEL}
      {...(labelDisplayedRows ? { labelDisplayedRows } : {})}
      disabled={disabled}
    />
  )
}
ListPagination.displayName = 'ListPagination'

export default ListPagination
