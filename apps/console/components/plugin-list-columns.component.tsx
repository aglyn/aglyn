'use client'

import { TableCell } from '@mui/material'
import { type ComponentType, useCallback, useMemo, useState } from 'react'
import { useSlotWidgets, type EntitledSlotWidget } from './plugin-widget-slot.component'

/**
 * A column a plugin contributed to a shell-owned table (AGL-2940): the
 * entitled widgets of a column slot that declare a `column`, with the cell
 * renderer beside the header the table draws.
 */
export interface PluginListColumn {
  widgetId: string
  header: string
  align?: 'left' | 'right' | 'center'
  sortKey?: string
  Component: ComponentType<any>
  /** The column's own header, when it draws one (AGL-2939). */
  Header?: ComponentType<any>
}

/**
 * The columns a slot contributes to a table: registered for the slot,
 * enabled, entitled and permitted — the same gates `PluginWidgetSlot`
 * applies to a card — and declaring a `column`. A widget registered on a
 * column slot without one is not a column and is left out; a card belongs
 * beneath the table, on a card slot.
 */
export function usePluginListColumns(slot: string): {
  columns: PluginListColumn[]
  ready: boolean
} {
  const { widgets, ready } = useSlotWidgets([slot])
  return {
    columns: widgets
      .filter((widget): widget is EntitledSlotWidget & { column: NonNullable<EntitledSlotWidget['column']> } =>
        widget.column !== undefined,
      )
      .map((widget) => ({
        widgetId: widget.widgetId,
        header: widget.column.header,
        align: widget.column.align,
        sortKey: widget.column.sortKey,
        Component: widget.Component,
        Header: widget.column.Header,
      })),
    ready,
  }
}

type RowComparator<Row> = (a: Row, b: Row) => number

/**
 * A table's rows in the order a plugin column's header asked for (AGL-2939).
 *
 * One sort at a time: a column that hands over a comparator replaces
 * another's order, and `null` from the column that sorted restores the
 * table's own. `onSort` is stable, so a header may call it from an effect
 * keyed on its own comparator without re-running on every render.
 */
export function usePluginColumnSort<Row>(rows: readonly Row[]): {
  rows: readonly Row[]
  sortedBy: string | null
  onSort: (widgetId: string, compare: RowComparator<Row> | null) => void
} {
  const [active, setActive] = useState<{ widgetId: string; compare: RowComparator<Row> } | null>(
    null,
  )
  const onSort = useCallback((widgetId: string, compare: RowComparator<Row> | null) => {
    setActive((current) => {
      if (compare) {
        return current?.widgetId === widgetId && current.compare === compare
          ? current
          : { widgetId, compare }
      }
      return current?.widgetId === widgetId ? null : current
    })
  }, [])
  const sorted = useMemo(
    () => (active ? [...rows].sort(active.compare) : rows),
    [rows, active],
  )
  return { rows: sorted, sortedBy: active?.widgetId ?? null, onSort }
}

/**
 * The header cells, in registration order — one per contributed column. A
 * column with its own `Header` draws it with the slot's props, `sorted`, and
 * an `onSort` bound to that column; the rest draw their `header` text.
 */
export function PluginListColumnHeaders<Row>(
  props: {
    columns: readonly PluginListColumn[]
    onSort?: (widgetId: string, compare: RowComparator<Row> | null) => void
    sortedBy?: string | null
  } & Record<string, unknown>,
) {
  const { columns, onSort, sortedBy, ...slotProps } = props
  // One handler per column for the life of the table: a header keys its
  // effect on its comparator, and a fresh handler each render would hand it
  // a new dependency every paint.
  const columnIds = JSON.stringify(columns.map((column) => column.widgetId))
  const handlers = useMemo(() => {
    const byColumn = new Map<string, (compare: RowComparator<Row> | null) => void>()
    for (const widgetId of JSON.parse(columnIds) as string[]) {
      byColumn.set(widgetId, (compare) => onSort?.(widgetId, compare))
    }
    return byColumn
  }, [columnIds, onSort])
  return (
    <>
      {columns.map((column) => (
        <TableCell key={column.widgetId} align={column.align}>
          {column.Header ? (
            <column.Header
              {...slotProps}
              sorted={sortedBy === column.widgetId}
              onSort={handlers.get(column.widgetId)}
            />
          ) : (
            column.header
          )}
        </TableCell>
      ))}
    </>
  )
}

/**
 * The cells of one row, in the header's order. The slot's own props ride
 * beside the row so a cell renderer sees what the table knows.
 */
export function PluginListColumnCells(
  props: { columns: readonly PluginListColumn[] } & Record<string, unknown>,
) {
  const { columns, ...rowProps } = props
  return (
    <>
      {columns.map((column) => (
        <TableCell key={column.widgetId} align={column.align}>
          <column.Component {...rowProps} />
        </TableCell>
      ))}
    </>
  )
}
