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

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type ListRowsFilter,
  type ListRowsFilterOptions,
  useListRowsFilter,
} from './use-list-rows-filter'

/** How many rows a paged list reads while it is filtered — see below. */
export const PAGED_FILTER_WINDOW = 100

/**
 * A paged window over a live list — the shape `usePagedCollection` returns:
 * every row from the first page to the one being read (plus, possibly, one
 * probe row past it), the page, and whether more exist.
 */
export interface PagedRowsWindow<Row> {
  /** Every row read so far, page 0 to the current page; may hold a probe row. */
  data?: readonly Row[] | null
  /** The current page's rows, when nothing narrows the list. */
  rows: readonly Row[]
  hasMore: boolean
  page: number
  setPage: (page: number) => void
  pageSize: number
  setPageSize: (pageSize: number) => void
}

/** What the list's grid, chips and footer take while it is paged. */
export interface PagedRowsFilter<Row> extends Omit<ListRowsFilter<Row>, 'rows'> {
  /** The rows the grid shows: the page, or the page of the matches. */
  rows: Row[]
  /** How many rows the window read — what a filter has looked through. */
  read: number
  /** Spread onto `ListPagination`. */
  pagination: {
    page: number
    pageSize: number
    rowCount: number
    hasMore: boolean
    onPageChange: (page: number) => void
    onPageSizeChange: (pageSize: number) => void
  }
}

/**
 * The grid's Filters panel and quick search over a PAGED live list
 * (AGL-3317), one that reads a window growing a page at a time rather than
 * every row.
 *
 * Unfiltered it is the pager it wraps: the grid shows the page, and the
 * footer turns it. While a clause or a search word is in force the list
 * matches over EVERYTHING the window has read — every page up to the
 * current one, not the page on screen — and pages the matches instead;
 * turning past the last match widens the window by one more page, so a
 * filter reaches further the further the reader goes. `read` says how far
 * it has looked, for the list to say so while more exist.
 *
 * ## The first filter widens the window once
 *
 * A window of one ten-row page is too little to filter: a search would look
 * through ten rows and call the rest "no match". So the first clause or word
 * widens the window to `filterWindow` rows (default
 * {@link PAGED_FILTER_WINDOW}) — one listener that much wider, for as long as
 * the list is narrowed — and clearing the last one puts the reader back on
 * the page they left.
 */
export function usePagedRowsFilter<Row extends object>(
  paged: PagedRowsWindow<Row>,
  options: Omit<ListRowsFilterOptions<Row>, 'rows'> & { filterWindow?: number },
): PagedRowsFilter<Row> {
  const { pageSize } = paged
  const { filterWindow = PAGED_FILTER_WINDOW, ...filterOptions } = options
  const windowRows = useMemo(
    () => (paged.data ?? paged.rows).slice(0, pageSize * (paged.page + 1)),
    [paged.data, paged.rows, pageSize, paged.page],
  )
  const filter = useListRowsFilter({ ...filterOptions, rows: windowRows })
  const [matchPage, setMatchPage] = useState(0)
  const searchKey = filter.gridFilter.searchWords.join(' ')
  // A narrowed list starts again at its first page.
  useEffect(() => setMatchPage(0), [filter.gridFilter.clauses, searchKey])

  /** The page the reader was on before the list was narrowed. */
  const before = useRef<number | null>(null)
  const { filtering } = filter
  useEffect(() => {
    if (filtering && before.current === null) {
      before.current = paged.page
      const widened = Math.max(0, Math.ceil(filterWindow / pageSize) - 1)
      if (widened > paged.page) paged.setPage(widened)
    } else if (!filtering && before.current !== null) {
      paged.setPage(before.current)
      before.current = null
    }
    // Only the transition into and out of a filter moves the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtering])

  if (!filter.filtering) {
    return {
      ...filter,
      rows: [...paged.rows],
      read: windowRows.length,
      pagination: {
        page: paged.page,
        pageSize,
        rowCount: paged.rows.length,
        hasMore: paged.hasMore,
        onPageChange: paged.setPage,
        onPageSizeChange: paged.setPageSize,
      },
    }
  }
  const matches = filter.rows
  const shown = matches.slice(matchPage * pageSize, (matchPage + 1) * pageSize)
  const lastMatchPage = Math.max(0, Math.ceil(matches.length / pageSize) - 1)
  return {
    ...filter,
    rows: shown,
    read: windowRows.length,
    pagination: {
      page: matchPage,
      pageSize,
      rowCount: shown.length,
      hasMore: paged.hasMore || matchPage < lastMatchPage,
      onPageChange: (next) => {
        // Past the matches read so far, the window reads another page first.
        if ((next + 1) * pageSize > matches.length && paged.hasMore) {
          paged.setPage(paged.page + 1)
        }
        setMatchPage(next)
      },
      onPageSizeChange: (next) => {
        paged.setPageSize(next)
        setMatchPage(0)
      },
    },
  }
}

export default usePagedRowsFilter
