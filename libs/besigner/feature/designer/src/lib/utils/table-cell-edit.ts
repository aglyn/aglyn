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

import type * as Aglyn from '@aglyn/aglyn'
import { FieldComponentType } from '@aglyn/aglyn'
import {
  DATA_TABLE_EMPHASIS_PROP,
  type DataTableShapeEdit,
  dataTableCellText,
  dataTableStarterValue,
  editDataTableShape,
  emphasisAfterShapeEdit,
  isDataTableCellMarkup,
  normalizeEmphasisColumn,
  parseDataTableRows,
  readDataTableAlignments,
  serializeDataTable,
  withCellSet,
} from '@aglyn/shared-data-enums'
import {
  mdiTableColumnPlusAfter,
  mdiTableColumnPlusBefore,
  mdiTableColumnRemove,
  mdiTableRowPlusAfter,
  mdiTableRowPlusBefore,
  mdiTableRowRemove,
} from '@aglyn/shared-data-mdi'

/**
 * In-place editing of one Table cell on the canvas.
 *
 * The Table element stores its whole grid as ONE string attribute (see
 * `@aglyn/shared-data-enums`'s `data-table`), so a cell is not a canvas node
 * and has no `children` of its own to edit. A double-click on a cell opens
 * the same in-place text editor every text element uses, anchored on the
 * cell, and the commit rewrites that one cell inside the stored string —
 * through the same parser and serializer the attributes-panel grid uses, so
 * the two surfaces can never disagree about what a table string means.
 */

/**
 * The attribute holding the grid, or `undefined` when the component declares
 * none. Keyed on the schema's own `DATA_TABLE` field declaration — the same
 * declaration that gives the attributes panel its grid — rather than on a
 * component id, so any element that stores a grid this way is editable on
 * the canvas too.
 */
export function findDataTableAttributeName(
  node: Aglyn.NodeSchema<any> | undefined,
): string | undefined {
  for (const attribute of node?.componentSchema?.attributes ?? []) {
    if (attribute?.component === FieldComponentType.DATA_TABLE) {
      return attribute.name
    }
  }
  return undefined
}

/** The cell a point falls in, and where it sits in the stored grid. */
export interface DataTableCellHit {
  element: HTMLElement
  /** Row in the parsed grid — the header row, when there is one, is row 0. */
  row: number
  column: number
}

/**
 * The rendered cell under a client point inside `root`, if any.
 *
 * Geometric rather than `elementFromPoint`, for the reason instance leaves
 * are hit-tested that way: the canvas is a closed shadow root and the point
 * may come from a touch, so the event target is not something to rely on.
 *
 * The grid row is the cell's `<tr>` index across the whole table. The
 * renderer draws exactly one `<tr>` per parsed row, header included, so the
 * two indexes are the same thing.
 */
export function findDataTableCellAtPoint(
  root: Element,
  clientX: number,
  clientY: number,
): DataTableCellHit | undefined {
  const rows = Array.from(root.querySelectorAll('tr'))
  for (let row = 0; row < rows.length; row++) {
    const cells = Array.from(rows[row].children).filter(
      (cell): cell is HTMLElement =>
        cell.tagName === 'TD' || cell.tagName === 'TH',
    )
    for (let column = 0; column < cells.length; column++) {
      const rect = cells[column].getBoundingClientRect()
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return { element: cells[column], row, column }
      }
    }
  }
  return undefined
}

/** The text a stored grid holds at one cell, or `''` when it is outside it. */
export function readDataTableCell(
  value: unknown,
  row: number,
  column: number,
): string {
  return parseDataTableRows(value)[row]?.[column] ?? ''
}

/**
 * The stored grid with one cell replaced.
 *
 * A cell is one line — the storage is one row per line — so a line break
 * typed into the cell becomes a space instead of splitting the row. Column
 * alignments survive: they ride the same string as a divider row, and are
 * read back out and written again with the grid.
 */
export function writeDataTableCell(
  value: unknown,
  row: number,
  column: number,
  text: string,
): string {
  const grid = parseDataTableRows(value)
  const width = grid[0]?.length ?? 0
  const alignments = readDataTableAlignments(value, width)
  const cell = text.replace(/\s*\r?\n\s*/g, ' ').trim()
  return serializeDataTable(withCellSet(grid, row, column, cell), alignments)
}

/**
 * What the cell editor opens with (AGL-4203): the cell's words, and its
 * markup when it was formatted. A plain cell has no markup, and the editor
 * builds its surface from the words as it does for unformatted text.
 */
export function readDataTableCellForEdit(
  value: unknown,
  row: number,
  column: number,
): { text: string; html: string } {
  const raw = readDataTableCell(value, row, column)
  return isDataTableCellMarkup(raw)
    ? { text: dataTableCellText(raw), html: raw }
    : { text: raw, html: '' }
}

/**
 * What a cell edit stores (AGL-4203): the sanitized markup when the author
 * formatted something, the plain words otherwise — so a table nobody formats
 * stays the plain grid it always was.
 *
 * One case keeps the markup without any formatting: plain words that would
 * READ as markup (`a &lt; b` typed out literally, or a tag spelled in text).
 * Stored plain, the renderer would draw them as a tag; stored escaped, they
 * draw as typed.
 */
export function dataTableCellValueFromEdit(
  plain: string,
  sanitized: string,
): string {
  if (/<[a-z]/i.test(sanitized)) return sanitized
  if (isDataTableCellMarkup(plain)) return sanitized
  return plain
}

/**
 * `props` after one change to the table's shape: the grid, and the
 * emphasized column moved with its column (AGL-4203). The emphasis is
 * written only when it moves, so a row edit never touches it.
 */
export function withDataTableShapeEdit(
  props: Record<string, unknown>,
  attribute: string,
  edit: DataTableShapeEdit,
): Record<string, unknown> {
  const stored = props[attribute]
  const width = parseDataTableRows(stored)[0]?.length ?? 0
  const next: Record<string, unknown> = {
    ...props,
    [attribute]: editDataTableShape(stored, edit),
  }
  if (DATA_TABLE_EMPHASIS_PROP in props) {
    const before = normalizeEmphasisColumn(props[DATA_TABLE_EMPHASIS_PROP], width)
    const after = emphasisAfterShapeEdit(
      props[DATA_TABLE_EMPHASIS_PROP],
      width,
      edit,
    )
    if (after !== before) next[DATA_TABLE_EMPHASIS_PROP] = after
  }
  return next
}

/** `props` with an empty table started — the same starter the Attributes grid writes. */
export function withDataTableStarted(
  props: Record<string, unknown>,
  attribute: string,
): Record<string, unknown> {
  return { ...props, [attribute]: dataTableStarterValue() }
}

/** One row or column action offered on a cell. */
export interface DataTableCellAction {
  key: string
  label: string
  icon: string
  edit: DataTableShapeEdit
  disabled: boolean
}

/**
 * The row and column actions for one cell, in the order both the right-click
 * menu and the cell editor's toolbar list them (AGL-4203). Deleting the last
 * row or the last column is offered but disabled, as the Attributes grid
 * does: a table with no cells left has nothing to click to get one back.
 */
export function dataTableCellActions(
  value: unknown,
  row: number,
  column: number,
): DataTableCellAction[] {
  const grid = parseDataTableRows(value)
  const rows = grid.length
  const columns = grid[0]?.length ?? 0
  return [
    {
      key: 'row-above',
      label: 'Insert row above',
      icon: mdiTableRowPlusBefore.path,
      edit: { kind: 'insertRow', at: row },
      disabled: false,
    },
    {
      key: 'row-below',
      label: 'Insert row below',
      icon: mdiTableRowPlusAfter.path,
      edit: { kind: 'insertRow', at: row + 1 },
      disabled: false,
    },
    {
      key: 'column-left',
      label: 'Insert column left',
      icon: mdiTableColumnPlusBefore.path,
      edit: { kind: 'insertColumn', at: column },
      disabled: false,
    },
    {
      key: 'column-right',
      label: 'Insert column right',
      icon: mdiTableColumnPlusAfter.path,
      edit: { kind: 'insertColumn', at: column + 1 },
      disabled: false,
    },
    {
      key: 'row-delete',
      label: 'Delete row',
      icon: mdiTableRowRemove.path,
      edit: { kind: 'removeRow', at: row },
      disabled: rows <= 1,
    },
    {
      key: 'column-delete',
      label: 'Delete column',
      icon: mdiTableColumnRemove.path,
      edit: { kind: 'removeColumn', at: column },
      disabled: columns <= 1,
    },
  ]
}
