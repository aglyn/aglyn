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

import type { CrmViewSort } from '@aglyn/aglyn/app-utils/crm'
import { LIST_ACTIONS_FIELD } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  type ListColumnSort,
  useListColumnSort,
} from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import type {
  ListPageSort,
  ListSortValue,
} from '@aglyn/shared-util-tools/list-query/list-column-sort'
import type { ListQuerySort } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useMemo } from 'react'
import type { CrmSavedViewController } from './use-crm-saved-view'

/*
 * EVERY CRM TABLE SORTS BY ITS COLUMN HEADERS (AGL-3680).
 *
 * The five CRM lists — Leads, Contacts, Companies, Deals, Tasks — each page
 * a Firestore query, and their headers used to be switched off (a header
 * sort over one page reads as the whole list's order) or, on Companies and
 * Deals, left on over the page with nothing saying so. Each header now sorts
 * by the one strategy honest for it (`list-column-sort.ts` in
 * `@aglyn/shared-util-tools`):
 *
 *   - a column backed by a stored field sorts the QUERY: the list declares a
 *     `ListQuerySort` with that `column` beside its default order;
 *   - every other column — a name joined from the roster, a picklist label
 *     in the org's order, a holder's facet value — sorts the PAGE, and the
 *     header and a notice say so.
 *
 * The order a header asks is the saved VIEW'S (AGL-2617): a view stores
 * `{ field, direction }`, and `crmViewQuerySort` reads it back as one of the
 * list's declared orders before the query is built. A view saved sorted by a
 * column the query cannot order — a page column, or a column since removed
 * — opens in the list's default order and says so.
 */

const same = (a: ListQuerySort | null | undefined, b: ListQuerySort | null | undefined) =>
  Boolean(a && b && a.path === b.path && a.direction === b.direction)

export interface CrmViewQuerySort {
  /** The declared order the view asks, or the list's default. */
  sort: ListQuerySort
  /** The view's own sort when no declared order serves it — the list said so. */
  unserved: CrmViewSort | null
}

/**
 * A view's stored sort as one of the list's declared header orders, or the
 * list's default when it names none — `unserved` holds what it named.
 */
export function crmViewQuerySort(
  sorts: readonly ListQuerySort[],
  viewSort: CrmViewSort | null | undefined,
  defaultSort: ListQuerySort,
): CrmViewQuerySort {
  if (!viewSort) return { sort: defaultSort, unserved: null }
  const declared = sorts.find(
    (sort) => sort.column === viewSort.field && sort.direction === viewSort.direction,
  )
  return declared ? { sort: declared, unserved: null } : { sort: defaultSort, unserved: viewSort }
}

/** A cell value as a page sort compares it. */
function sortValueOf(raw: unknown): ListSortValue {
  if (raw === null || raw === undefined) return null
  if (
    typeof raw === 'string' ||
    typeof raw === 'number' ||
    typeof raw === 'boolean' ||
    raw instanceof Date
  ) {
    return raw
  }
  if (Array.isArray(raw)) return raw.map((entry) => String(entry ?? '')).join(', ')
  // A Firestore Timestamp, as a listener hands it over.
  const stamp = raw as { toMillis?: () => number; seconds?: number }
  if (typeof stamp.toMillis === 'function') return stamp.toMillis()
  if (typeof stamp.seconds === 'number') return stamp.seconds * 1000
  return null
}

/**
 * One page sort per column the query does not order (strategy 3), each
 * reading the cell the way the grid reads it — through the column's own
 * `valueGetter` — so a header sorts by what the reader sees. Skips the
 * query's columns, the actions column and `unsortable`.
 */
export function crmPageSorts<Row>(
  columns: readonly GridColDef[],
  skip: ReadonlySet<string>,
): Record<string, ListPageSort<Row>> {
  const sorts: Record<string, ListPageSort<Row>> = {}
  for (const column of columns) {
    if (skip.has(column.field) || column.field === LIST_ACTIONS_FIELD) continue
    const getter = column.valueGetter as
      | ((value: unknown, row: Row, column: GridColDef, apiRef: never) => unknown)
      | undefined
    sorts[column.field] = (row: Row) => {
      const raw = (row as Record<string, unknown>)[column.field]
      return sortValueOf(getter ? getter(raw, row, column, undefined as never) : raw)
    }
  }
  return sorts
}

export interface CrmColumnSortOptions<Row> {
  /** The view the sort is kept in. */
  views: Pick<CrmSavedViewController, 'setSort'>
  /** The list's declared orders; the ones with a `column` sort a header on the query. */
  sorts: readonly ListQuerySort[]
  /** The order asked while no header is. */
  defaultSort: ListQuerySort
  /** What the view asks — `crmViewQuerySort`. */
  asked: CrmViewQuerySort
  /** The order the query reads in: the plan's `orderBy`. */
  orderBy: ListQuerySort
  rows: readonly Row[]
  /** The grid's columns, whose other headers sort the page. */
  columns: readonly GridColDef[]
  /** A page sort a column needs other than its cell value — a picklist's rank. */
  pageSorts?: Readonly<Record<string, ListPageSort<Row>>>
  /** Columns that are row controls, like the actions column (a task's done box). */
  unsortable?: readonly string[]
}

/**
 * A CRM list's header sorts: `useListColumnSort` over the list's declared
 * orders and a page sort for every other column, the asked order kept in the
 * view. Hand the result to `ListTable` as `columnSort`, and its `notices` to
 * `ListQueryNotices` beside the plan's.
 */
export function useCrmColumnSort<Row>(options: CrmColumnSortOptions<Row>): ListColumnSort<Row> {
  const { views, sorts, defaultSort, asked, orderBy, rows, columns, pageSorts, unsortable } =
    options
  const { setSort } = views
  const queryColumns = useMemo(
    () => new Set(sorts.flatMap((sort) => (sort.column ? [sort.column] : []))),
    [sorts],
  )
  const allPageSorts = useMemo(
    () => ({
      ...crmPageSorts<Row>(columns, new Set([...queryColumns, ...(unsortable ?? [])])),
      ...pageSorts,
    }),
    [columns, queryColumns, unsortable, pageSorts],
  )
  const headers = useMemo(
    () =>
      Object.fromEntries(columns.map((column) => [column.field, column.headerName || column.field])),
    [columns],
  )
  // The view keeps a header's order; the default is kept as no sort at all.
  const onSortChange = useCallback(
    (next: ListQuerySort | null) =>
      setSort(
        next?.column && !same(next, defaultSort)
          ? { field: next.column, direction: next.direction }
          : null,
      ),
    [setSort, defaultSort],
  )
  const columnSort = useListColumnSort<Row>({
    sorts,
    defaultSort,
    sort: asked.sort,
    onSortChange,
    orderBy,
    rows,
    pageSorts: allPageSorts,
    headers,
  })
  const unserved = asked.unserved
  const notices = useMemo(
    () =>
      unserved
        ? [
            ...columnSort.notices,
            `This view is saved sorted by ${headers[unserved.field] ?? unserved.field}, which the list's query cannot order by: it is shown in the list's own order. Click the header to sort the rows on this page.`,
          ]
        : columnSort.notices,
    [columnSort.notices, unserved, headers],
  )
  return useMemo(() => ({ ...columnSort, notices }), [columnSort, notices])
}

export default useCrmColumnSort
