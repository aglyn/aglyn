'use client'

import { TableCell } from '@mui/material'
import type { ComponentType } from 'react'
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
      })),
    ready,
  }
}

/** The header cells, in registration order — one per contributed column. */
export function PluginListColumnHeaders(props: { columns: readonly PluginListColumn[] }) {
  return (
    <>
      {props.columns.map((column) => (
        <TableCell key={column.widgetId} align={column.align}>
          {column.header}
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
