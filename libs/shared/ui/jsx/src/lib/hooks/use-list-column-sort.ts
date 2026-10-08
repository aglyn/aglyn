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

import type { GridSortDirection, GridSortModel } from '@mui/x-data-grid'
import { useCallback, useMemo, useState } from 'react'
import {
  type ListPageSort,
  listPageSortNotice,
  sortListRows,
} from '@aglyn/shared-util-tools/list-query/list-column-sort'
import type { ListQuerySort } from '@aglyn/shared-util-tools/list-query/list-query-plan'

/*
 * A LIST'S HEADER SORTS, ONE HOOK (AGL-3680).
 *
 * Bridges MUI's `GridSortModel` and the list's `ListQuerySort`s, the way the
 * staff Organizations list did by hand: a header backed by a query order asks
 * the QUERY for it (`sort`, which the caller hands its query or route), and
 * a header backed only by a value on the loaded rows sorts the PAGE
 * (`pageSorts`) and says so. The grid itself never sorts — `sortingMode` is
 * always `server` — so nothing on screen claims an order the query did not
 * give. See `list-column-sort.ts` in `@aglyn/shared-util-tools` for which
 * strategy a column takes.
 *
 *     const columnSort = useListColumnSort({ sorts, defaultSort, rows, pageSorts, headers })
 *     // ask the query for `columnSort.sort`; draw
 *     <ListTable columns={…} rows={columnSort.rows} columnSort={columnSort} … />
 */

/**
 * How a column's header sorts, as `ListTable` reads it: by the query, over
 * the loaded page (and says so), or over a list loaded WHOLE (`complete`),
 * where a value sort orders every row and is exact.
 */
export interface ListColumnSortColumn {
  mode: 'query' | 'page' | 'loaded'
  sortingOrder: GridSortDirection[]
}

export interface ListColumnSort<Row = any> {
  /** The order to ask the query for, or null for the list's own order. */
  sort: ListQuerySort | null
  sortModel: GridSortModel
  onSortModelChange: (model: GridSortModel) => void
  sortingMode: 'server'
  /** The rows to draw: the page, sorted while a page header is active. */
  rows: readonly Row[]
  /** What the reader is told about the order on screen. */
  notices: string[]
  /** Every column that sorts, by field. A column not here does not. */
  columns: Readonly<Record<string, ListColumnSortColumn>>
  /**
   * A page sort by a comparator a column hands over itself — a plugin column
   * that draws its own header. `null` clears it if it is still that column's.
   */
  sortPage: (id: string, compare: ((a: Row, b: Row) => number) | null) => void
  /** The comparator column sorting the page, or null. */
  pageSortedBy: string | null
}

export interface ListColumnSortOptions<Row> {
  /**
   * The orders the list's query serves. Each one with a `column` is a header
   * sort; the rest (the default id order) are ignored here. Usually the
   * declaration's `sorts`.
   */
  sorts: readonly ListQuerySort[]
  /** The order asked while no header is: one of `sorts`, or null. */
  defaultSort?: ListQuerySort | null
  /**
   * The asked order, CONTROLLED — for a list whose query is read before the
   * rows this hook sorts exist (the order feeds the read; the read feeds the
   * rows). Omitted, the hook holds it.
   */
  sort?: ListQuerySort | null
  onSortChange?: (sort: ListQuerySort | null) => void
  /**
   * The order the query WILL read in — the plan's `orderBy` — when that can
   * differ from the one asked (an `alone` fallback, a range filter). The
   * header shows that order, not the one clicked.
   */
  orderBy?: ListQuerySort | null
  rows: readonly Row[]
  /** Columns sorted over the loaded page (strategy 3): field → value. */
  pageSorts?: Readonly<Record<string, ListPageSort<Row>>>
  /** Headers, for the page-sort notice: field → label. */
  headers?: Readonly<Record<string, string>>
  /**
   * The rows are the WHOLE list, not a page of it (strategy 4) — a roster
   * read in full and paged by the grid's own footer. A `pageSorts` column
   * then orders every row, so its header is exact: mode `loaded`, no "this
   * page" description and no notice. Lets a fully loaded list sort its own
   * columns and a plugin column's comparator through ONE order.
   */
  complete?: boolean
}

type Active<Row> =
  | { kind: 'page'; field: string; direction: 'asc' | 'desc' }
  | { kind: 'compare'; id: string; compare: (a: Row, b: Row) => number }
  | null

const same = (a: ListQuerySort | null | undefined, b: ListQuerySort | null | undefined) =>
  Boolean(a && b && a.path === b.path && a.direction === b.direction)

export function useListColumnSort<Row>(options: ListColumnSortOptions<Row>): ListColumnSort<Row> {
  const {
    sorts,
    defaultSort = null,
    orderBy,
    rows,
    pageSorts,
    headers,
    onSortChange,
    complete = false,
  } = options
  const [heldSort, setHeldSort] = useState<ListQuerySort | null>(defaultSort)
  const controlled = options.sort !== undefined
  const querySort = controlled ? (options.sort ?? null) : heldSort
  const setQuerySort = useCallback(
    (next: ListQuerySort | null) => {
      if (!controlled) setHeldSort(next)
      onSortChange?.(next)
    },
    [controlled, onSortChange],
  )
  const [active, setActive] = useState<Active<Row>>(null)

  const columns = useMemo(() => {
    const byField: Record<string, ListColumnSortColumn> = {}
    for (const sort of sorts) {
      if (!sort.column) continue
      const entry = (byField[sort.column] ??= { mode: 'query', sortingOrder: [] })
      if (!entry.sortingOrder.includes(sort.direction)) entry.sortingOrder.push(sort.direction)
    }
    for (const entry of Object.entries(byField)) {
      // A header that IS the default order has nowhere to clear to.
      if (entry[0] !== defaultSort?.column) entry[1].sortingOrder.push(null)
    }
    for (const field of Object.keys(pageSorts ?? {})) {
      byField[field] ??= {
        mode: complete ? 'loaded' : 'page',
        sortingOrder: ['asc', 'desc', null],
      }
    }
    return byField
  }, [sorts, pageSorts, defaultSort, complete])

  const shown = orderBy ?? querySort
  const sortModel = useMemo<GridSortModel>(() => {
    if (active?.kind === 'page') return [{ field: active.field, sort: active.direction }]
    if (active?.kind === 'compare') return []
    const header = sorts.find((sort) => sort.column && same(sort, shown))
    return header?.column ? [{ field: header.column, sort: header.direction }] : []
  }, [active, sorts, shown])

  const onSortModelChange = useCallback(
    (model: GridSortModel) => {
      const [first] = model
      const direction = first?.sort
      const mode = first ? columns[first.field]?.mode : undefined
      if (first && direction && (mode === 'page' || mode === 'loaded')) {
        // The query's order stands: a page sort re-reads nothing.
        setActive({ kind: 'page', field: first.field, direction })
        return
      }
      setActive(null)
      setQuerySort(
        (first &&
          direction &&
          sorts.find((sort) => sort.column === first.field && sort.direction === direction)) ||
          defaultSort,
      )
    },
    [columns, sorts, defaultSort, setQuerySort],
  )

  const sortPage = useCallback((id: string, compare: ((a: Row, b: Row) => number) | null) => {
    setActive((current) => {
      if (compare) {
        return current?.kind === 'compare' && current.id === id && current.compare === compare
          ? current
          : { kind: 'compare', id, compare }
      }
      return current?.kind === 'compare' && current.id === id ? null : current
    })
  }, [])

  const sorted = useMemo(() => {
    if (active?.kind === 'compare') return [...rows].sort(active.compare)
    if (active?.kind === 'page') {
      const value = pageSorts?.[active.field]
      return value ? sortListRows(rows, value, active.direction) : rows
    }
    return rows
  }, [rows, active, pageSorts])

  const notices = useMemo(
    () =>
      active?.kind === 'page' && !complete
        ? [listPageSortNotice(headers?.[active.field] ?? active.field)]
        : [],
    [active, headers, complete],
  )

  return {
    sort: querySort,
    sortModel,
    onSortModelChange,
    sortingMode: 'server',
    rows: sorted,
    notices,
    columns,
    sortPage,
    pageSortedBy: active?.kind === 'compare' ? active.id : null,
  }
}
