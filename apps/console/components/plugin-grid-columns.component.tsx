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

import type { GridColDef, GridRenderCellParams } from '@mui/x-data-grid'
import { type ComponentType, useCallback, useState } from 'react'
import type { PluginListColumn } from './plugin-list-columns.component'

type RowComparator<Row> = (a: Row, b: Row) => number

/** What a DataGrid list hands the columns a plugin contributed to it. */
export interface PluginGridTable<Row> {
  /** The zone's props, handed to every header and every cell. */
  slotProps: Readonly<Record<string, unknown>>
  /** The widget whose comparator orders the rows, or `null`. */
  sortedBy: string | null
  /** Takes a column's comparator, or `null` to hand the order back. */
  onSort: (widgetId: string, compare: RowComparator<Row> | null) => void
  /** The props a cell receives for its own row, beside the zone's. */
  rowProps: (row: Row) => Readonly<Record<string, unknown>>
}

/**
 * The columns a zone contributes, as DataGrid column definitions
 * (AGL-2984) — what `PluginListColumnHeaders` and `PluginListColumnCells`
 * are to a list that draws its own table.
 *
 * The grid neither sorts nor filters them. Their figures are the plugin's
 * and absent from the rows the grid holds, so a grid sort would order blanks
 * and a filter would match nothing; a column that sorts does it through its
 * own `Header`, which hands the list a comparator. A column without a
 * `Header` is titled by the grid from `header`, as every other column is.
 */
export function pluginGridColumns<Row>(
  columns: readonly PluginListColumn[],
  table: PluginGridTable<Row>,
): GridColDef[] {
  return columns.map((column) => {
    const { Component, Header, widgetId } = column
    return {
      field: `plugin-${widgetId}`,
      headerName: column.header,
      flex: 0.8,
      minWidth: 140,
      align: column.align,
      headerAlign: column.align,
      sortable: false,
      filterable: false,
      renderHeader: Header
        ? () => (
            <PluginGridColumnHeader
              Header={Header}
              widgetId={widgetId}
              slotProps={table.slotProps}
              sorted={table.sortedBy === widgetId}
              onSort={table.onSort}
            />
          )
        : undefined,
      renderCell: ({ row }: GridRenderCellParams) => (
        <Component {...table.slotProps} {...table.rowProps(row as Row)} />
      ),
    }
  })
}

/**
 * A column's own header, with an `onSort` bound to the column for as long as
 * the header is mounted. A header keys its effect on its own comparator, and
 * a handler minted each time the grid's columns are rebuilt would hand it a
 * new dependency on every rebuild.
 */
function PluginGridColumnHeader<Row>(props: {
  Header: ComponentType<any>
  widgetId: string
  slotProps: Readonly<Record<string, unknown>>
  sorted: boolean
  onSort: PluginGridTable<Row>['onSort']
}) {
  const { Header, widgetId, slotProps, sorted, onSort } = props
  const onColumnSort = useCallback(
    (compare: RowComparator<Row> | null) => onSort(widgetId, compare),
    [onSort, widgetId],
  )
  return <Header {...slotProps} sorted={sorted} onSort={onColumnSort} />
}

/**
 * A zone's columns as ONE array for as long as the same widgets contribute
 * them. `usePluginListColumns` maps the registry afresh on every render, and
 * a DataGrid handed new column definitions rebuilds its column state.
 */
export function useStablePluginColumns(
  columns: readonly PluginListColumn[],
): readonly PluginListColumn[] {
  const signature = columns.map((column) => column.widgetId).join('\n')
  const [held, setHeld] = useState({ signature, columns })
  if (held.signature !== signature) {
    setHeld({ signature, columns })
    return columns
  }
  return held.columns
}
