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

import type {
  GridColDef,
  GridColumnVisibilityModel,
  GridSortModel,
} from '@mui/x-data-grid'
import { useCallback, useMemo } from 'react'
import type { CrmSavedViewController } from './use-crm-saved-view'

/**
 * The visible columns as the view orders them, and the one way to move one.
 *
 * What the column menu's Move left / Move right read and call — see
 * `crm-column-menu.tsx`. The grid itself cannot reorder a column (the MIT
 * grid forces `disableColumnReorder`), so the order is the view's to keep
 * and the hook's to apply.
 */
export interface CrmColumnOrder {
  /** The visible, hideable columns by field, first to last as the grid shows them. */
  order: readonly string[]
  /** Swap a column with its visible neighbor: `-1` toward the front, `1` toward the end. */
  move: (field: string, delta: -1 | 1) => void
}

/**
 * Every hideable field in the view's order: the ones the view names, as it
 * names them, then the rest in the list's own order.
 *
 * A column the view does not name is a hidden one (or one that did not
 * exist when the view was saved), so its place is invisible until it is
 * shown — and then it joins after the named ones, which is where the
 * Manage columns panel listed it. A name the list no longer has is dropped
 * rather than kept as a phantom slot.
 */
function orderFields(listFields: readonly string[], named: readonly string[]): string[] {
  const known = new Set(listFields)
  const placed = named.filter((field) => known.has(field))
  if (!placed.length) return [...listFields]
  const taken = new Set(placed)
  return [...placed, ...listFields.filter((field) => !taken.has(field))]
}

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((field, index) => field === b[index])

/**
 * The grid's columns, column and sort models, as a saved view holds them
 * (AGL-2617).
 *
 * A view stores the VISIBLE columns by field, in order, and one sort; the
 * grid speaks a column array, a visibility map and a sort array. This is
 * the one translation, so all five lists hand the grid the same controlled
 * models and read the same changes back. An empty column list means the
 * list's own default — every hideable column shown, in the list's order —
 * and a change that arrives back at that default is stored as the empty
 * list rather than as a copy of today's columns, so a view saved before a
 * column existed shows the new column too.
 *
 * ## The order is the view's
 *
 * `columns` is the caller's list re-arranged: the hideable columns take
 * the view's order, and a column the list pins (`hideable: false`, an
 * actions column) keeps the slot it was given. The grid rebuilds its own
 * order from the array whenever it changes, so handing it the arranged
 * array IS the reorder — and a change to the visible set keeps the order
 * the reader had, rather than falling back to the list's.
 *
 * `hidden` is what the list keeps out of sight by default — the
 * filter-only columns the contacts grammar declares, and an optional column
 * a reader turns on when they want it — and is folded into the default
 * model, so the empty list means the columns the list opens with rather than
 * every column it has, and a view that shows an optional column stores it
 * by name.
 */
export function useCrmViewGrid(
  controller: Pick<CrmSavedViewController, 'state' | 'setColumns' | 'setSort'>,
  columns: readonly GridColDef[],
  hidden: Readonly<Record<string, boolean>> = {},
): {
  /** The caller's columns, in the view's order. */
  columns: GridColDef[]
  columnVisibilityModel: GridColumnVisibilityModel
  onColumnVisibilityModelChange: (model: GridColumnVisibilityModel) => void
  columnOrder: CrmColumnOrder
  sortModel: GridSortModel
  onSortModelChange: (model: GridSortModel) => void
} {
  const { state, setColumns, setSort } = controller
  const hideable = useMemo(
    () => columns.filter((column) => column.hideable !== false).map((column) => column.field),
    [columns],
  )

  /** Every hideable field, in the view's order. */
  const ordered = useMemo(() => orderFields(hideable, state.columns), [hideable, state.columns])

  const orderedColumns = useMemo(() => {
    const byField = new Map(columns.map((column) => [column.field, column]))
    let next = 0
    // A pinned column keeps its slot; each hideable slot is refilled in order.
    return columns.map((column) =>
      column.hideable === false ? column : (byField.get(ordered[next++]) ?? column),
    )
  }, [columns, ordered])

  const columnVisibilityModel = useMemo<GridColumnVisibilityModel>(() => {
    const model: GridColumnVisibilityModel = { ...hidden }
    if (!state.columns.length) return model
    for (const field of hideable) model[field] = state.columns.includes(field)
    return model
  }, [hidden, state.columns, hideable])

  /** The columns the list opens with: every hideable one not hidden by default, in list order. */
  const defaultVisible = useMemo(
    () => hideable.filter((field) => hidden[field] !== false),
    [hideable, hidden],
  )

  /** The visible columns in the view's order — what a store writes back. */
  const visibleInOrder = useMemo(
    () => ordered.filter((field) => columnVisibilityModel[field] !== false),
    [ordered, columnVisibilityModel],
  )

  const store = useCallback(
    (visible: string[]) => setColumns(sameOrder(visible, defaultVisible) ? [] : visible),
    [setColumns, defaultVisible],
  )

  const onColumnVisibilityModelChange = useCallback(
    (model: GridColumnVisibilityModel) => {
      store(ordered.filter((field) => model[field] !== false))
    },
    [ordered, store],
  )

  const move = useCallback(
    (field: string, delta: -1 | 1) => {
      const from = visibleInOrder.indexOf(field)
      const to = from + delta
      if (from === -1 || to < 0 || to >= visibleInOrder.length) return
      const next = [...visibleInOrder]
      next[from] = visibleInOrder[to]
      next[to] = field
      store(next)
    },
    [visibleInOrder, store],
  )

  const columnOrder = useMemo<CrmColumnOrder>(
    () => ({ order: visibleInOrder, move }),
    [visibleInOrder, move],
  )

  const sortModel = useMemo<GridSortModel>(
    () => (state.sort ? [{ field: state.sort.field, sort: state.sort.direction }] : []),
    [state.sort],
  )

  const onSortModelChange = useCallback(
    (model: GridSortModel) => {
      const first = model[0]
      setSort(
        first && first.sort
          ? { field: first.field, direction: first.sort === 'desc' ? 'desc' : 'asc' }
          : null,
      )
    },
    [setSort],
  )

  return {
    columns: orderedColumns,
    columnVisibilityModel,
    onColumnVisibilityModelChange,
    columnOrder,
    sortModel,
    onSortModelChange,
  }
}

export default useCrmViewGrid
