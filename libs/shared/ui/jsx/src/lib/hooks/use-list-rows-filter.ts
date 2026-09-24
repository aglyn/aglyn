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

import type { GridColDef, GridFilterModel } from '@mui/x-data-grid'
import { useCallback, useMemo } from 'react'
import type { ListFilterField } from '../const/list-filter'
import {
  filterListRows,
  type ListFilterClause,
  type ListFilterOption,
  listFilterGridColumns,
} from '../const/list-grid-filter'
import { type ListGridFilter, useListGridFilter } from './use-list-grid-filter'

export interface ListRowsFilterOptions<Row extends object> {
  /** Every row the list read — the whole set, or the window its query capped. */
  rows: readonly Row[]
  /** What the panel offers, in the `ListFilterField` grammar. */
  fields: readonly ListFilterField[]
  /** Choices per picked field; each field named here is shown as a select. */
  options?: Readonly<Record<string, readonly ListFilterOption[]>>
  /** How a field reads on a chip and as a hidden column's header. */
  headers?: Readonly<Record<string, string>>
  /** The row paths the quick search reads. */
  search: readonly string[]
  /** A clause the list's query already served, not matched again. */
  served?: (clause: ListFilterClause) => boolean
  /** A saved view's clauses, when the list keeps them; held here otherwise. */
  clauses?: readonly ListFilterClause[]
  onChange?: (clauses: ListFilterClause[]) => void
}

/** What a list that holds its rows hands its grid and its chips. */
export interface ListRowsFilter<Row> {
  /** The rows that answer every clause and the search. */
  rows: Row[]
  /** Whether anything narrows the list — a clause or a search word. */
  filtering: boolean
  gridFilter: ListGridFilter
  /** Spread onto `ListTable`: the controlled panel, answered by the list. */
  gridProps: {
    filterMode: 'server'
    filterModel: GridFilterModel
    onFilterModelChange: (model: GridFilterModel) => void
    quickFilter: true
  }
  /** Spread onto `ListFilterChips`. */
  chipsProps: {
    fields: readonly ListFilterField[]
    headers: Readonly<Record<string, string>>
    clauses: readonly ListFilterClause[]
    onChange: (clauses: ListFilterClause[]) => void
    options: Readonly<Record<string, readonly ListFilterOption[]>>
  }
  /** The list's columns, typed for the panel (`listFilterGridColumns`). */
  filterColumns: (columns: readonly GridColDef[]) => GridColDef[]
}

const NO_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {}
const NO_HEADERS: Readonly<Record<string, string>> = {}

/**
 * The grid's Filters panel and quick search for a list that HOLDS its rows
 * (AGL-3317) — every row it read, or the window its query capped — and so
 * answers both over that whole set rather than the page on screen.
 *
 * It is `useListGridFilter` with the rest of the recipe every such list
 * repeated: the rows matched through `filterListRows`, the columns typed
 * through `listFilterGridColumns`, and the props the grid and the chips
 * take. A list whose query can serve a clause names it in `served`, puts it
 * on the query, and the rows here are not matched against it again.
 */
export function useListRowsFilter<Row extends object>(
  options: ListRowsFilterOptions<Row>,
): ListRowsFilter<Row> {
  const {
    rows,
    fields,
    options: choices = NO_OPTIONS,
    headers = NO_HEADERS,
    search,
    served,
  } = options
  const selectFields = useMemo(() => Object.keys(choices), [choices])
  const gridFilter = useListGridFilter({
    clauses: options.clauses,
    onChange: options.onChange,
    selectFields,
  })
  const searchKey = gridFilter.searchWords.join(' ')
  const matched = useMemo(
    () =>
      filterListRows(
        rows,
        fields,
        gridFilter.clauses,
        { paths: search, words: gridFilter.searchWords },
        served,
      ),
    // `searchKey` stands for the words, which are a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, fields, gridFilter.clauses, searchKey, search, served],
  )
  const filterColumns = useCallback(
    (columns: readonly GridColDef[]) =>
      listFilterGridColumns(columns, fields, choices, headers),
    [fields, choices, headers],
  )
  return {
    rows: matched,
    filtering: gridFilter.clauses.length > 0 || gridFilter.searchWords.length > 0,
    gridFilter,
    gridProps: {
      filterMode: 'server',
      filterModel: gridFilter.filterModel,
      onFilterModelChange: gridFilter.onFilterModelChange,
      quickFilter: true,
    },
    chipsProps: {
      fields,
      headers,
      clauses: gridFilter.clauses,
      onChange: gridFilter.setClauses,
      options: choices,
    },
    filterColumns,
  }
}

export default useListRowsFilter
