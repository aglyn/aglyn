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
  parseDataTableRows,
  readDataTableAlignments,
  serializeDataTable,
  withCellSet,
} from '@aglyn/shared-data-enums'

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
