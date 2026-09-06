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
 * The grid's column and sort models, as a saved view holds them (AGL-2617).
 *
 * A view stores the VISIBLE columns by field and one sort; the grid speaks
 * a visibility map and a sort array. This is the one translation, so all
 * five lists hand the grid the same controlled models and read the same
 * changes back. An empty column list means the list's own default — every
 * hideable column shown — and a change that shows everything is stored as
 * that empty list rather than as a copy of today's columns, so a view saved
 * before a column existed shows the new column too.
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
  columnVisibilityModel: GridColumnVisibilityModel
  onColumnVisibilityModelChange: (model: GridColumnVisibilityModel) => void
  sortModel: GridSortModel
  onSortModelChange: (model: GridSortModel) => void
} {
  const { state, setColumns, setSort } = controller
  const hideable = useMemo(
    () => columns.filter((column) => column.hideable !== false).map((column) => column.field),
    [columns],
  )

  const columnVisibilityModel = useMemo<GridColumnVisibilityModel>(() => {
    const model: GridColumnVisibilityModel = { ...hidden }
    if (!state.columns.length) return model
    for (const field of hideable) model[field] = state.columns.includes(field)
    return model
  }, [hidden, state.columns, hideable])

  /** The columns the list opens with: every hideable one not hidden by default. */
  const defaultVisible = useMemo(
    () => hideable.filter((field) => hidden[field] !== false),
    [hideable, hidden],
  )

  const onColumnVisibilityModelChange = useCallback(
    (model: GridColumnVisibilityModel) => {
      const visible = hideable.filter((field) => model[field] !== false)
      const isDefault =
        visible.length === defaultVisible.length &&
        visible.every((field, index) => field === defaultVisible[index])
      setColumns(isDefault ? [] : visible)
    },
    [hideable, defaultVisible, setColumns],
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
    columnVisibilityModel,
    onColumnVisibilityModelChange,
    sortModel,
    onSortModelChange,
  }
}

export default useCrmViewGrid
