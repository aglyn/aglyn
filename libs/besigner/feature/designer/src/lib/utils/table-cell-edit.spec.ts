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

import { FieldComponentType } from '@aglyn/aglyn'
import {
  parseDataTableRows,
  readDataTableAlignments,
} from '@aglyn/shared-data-enums'
import {
  canvasContextMenuTableCell,
  clearCanvasContextMenu,
  requestCanvasContextMenu,
} from './canvas-context-menu'
import {
  dataTableAppendEdits,
  dataTableCellActions,
  dataTableCellValueFromEdit,
  findDataTableAttributeName,
  findDataTableCellAtPoint,
  readDataTableCell,
  readDataTableCellForEdit,
  withDataTableShapeEdit,
  withDataTableStarted,
  writeDataTableCell,
} from './table-cell-edit'

const GRID = [
  'Feature | Us | Them',
  '--- | :---: | ---:',
  'Open source | Yes | No',
  'Self-hostable | Yes | No',
].join('\n')

describe('table cell edit', () => {
  it('finds the grid attribute from the schema declaration', () => {
    const node = {
      componentSchema: {
        attributes: [
          { name: 'headerRow', component: FieldComponentType.CHECKBOX },
          { name: 'rows', component: FieldComponentType.DATA_TABLE },
        ],
      },
    } as never
    expect(findDataTableAttributeName(node)).toBe('rows')
    expect(findDataTableAttributeName({ componentSchema: {} } as never)).toBe(
      undefined,
    )
  })

  it('reads a cell, counting the header as row 0 and skipping the divider', () => {
    expect(readDataTableCell(GRID, 0, 1)).toBe('Us')
    expect(readDataTableCell(GRID, 2, 0)).toBe('Self-hostable')
    expect(readDataTableCell(GRID, 9, 9)).toBe('')
  })

  it('writes one cell and keeps the column alignments', () => {
    const next = writeDataTableCell(GRID, 1, 2, 'Partly')
    expect(next).toBe(
      [
        'Feature | Us | Them',
        '--- | :---: | ---:',
        'Open source | Yes | Partly',
        'Self-hostable | Yes | No',
      ].join('\n'),
    )
  })

  it('keeps a cell on one line and escapes a typed pipe', () => {
    const next = writeDataTableCell('A | B\nC | D', 1, 0, 'one\ntwo | three')
    expect(next).toBe('A | B\none two \\| three | D')
    expect(readDataTableCell(next, 1, 0)).toBe('one two | three')
  })

  it('maps a point to the cell under it, header row included', () => {
    const host = document.createElement('div')
    host.innerHTML =
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>C</td><td>D</td></tr></tbody></table>'
    document.body.appendChild(host)
    const cells = Array.from(host.querySelectorAll('th, td'))
    cells.forEach((cell, index) => {
      const left = (index % 2) * 100
      const top = Math.floor(index / 2) * 20
      cell.getBoundingClientRect = () =>
        ({ left, top, right: left + 100, bottom: top + 20 }) as DOMRect
    })
    const hit = findDataTableCellAtPoint(host, 150, 30)
    expect(hit?.row).toBe(1)
    expect(hit?.column).toBe(1)
    expect(hit?.element.textContent).toBe('D')
    expect(findDataTableCellAtPoint(host, 500, 500)).toBe(undefined)
    host.remove()
  })
})

describe('table rows, columns and formatted cells on the canvas (AGL-4203)', () => {
  it('opens a formatted cell with its words and its markup', () => {
    const grid = 'A | B\n<b>Yes</b> &amp; more | plain'
    expect(readDataTableCellForEdit(grid, 1, 0)).toEqual({
      text: 'Yes & more',
      html: '<b>Yes</b> &amp; more',
    })
    expect(readDataTableCellForEdit(grid, 1, 1)).toEqual({
      text: 'plain',
      html: '',
    })
  })

  it('stores markup only when there is formatting, or text that reads as markup', () => {
    expect(dataTableCellValueFromEdit('Yes', 'Yes')).toBe('Yes')
    expect(dataTableCellValueFromEdit('Yes', '<b>Yes</b>')).toBe('<b>Yes</b>')
    // Typed literally, `&amp;` must not render as `&`.
    expect(dataTableCellValueFromEdit('AT&amp;T', 'AT&amp;amp;T')).toBe(
      'AT&amp;amp;T',
    )
    // Ordinary text with a `<` or an `&` stays plain.
    expect(dataTableCellValueFromEdit('a < b & c', 'a &lt; b &amp; c')).toBe(
      'a < b & c',
    )
  })

  it('writes a formatted cell into the grid without breaking the row', () => {
    const next = writeDataTableCell(
      GRID,
      2,
      1,
      '<a href="https://x.test/?a|b" rel="noopener noreferrer">Yes</a>',
    )
    // Row 2 of the parsed grid: the divider is not a row.
    expect(parseDataTableRows(next)[2]).toEqual([
      'Self-hostable',
      '<a href="https://x.test/?a|b" rel="noopener noreferrer">Yes</a>',
      'No',
    ])
  })

  it('moves the emphasized column with its column', () => {
    const props = { rows: GRID, emphasizeColumn: 2, headerRow: true }
    const inserted = withDataTableShapeEdit(props, 'rows', {
      kind: 'insertColumn',
      at: 0,
    })
    expect(inserted['emphasizeColumn']).toBe(3)
    expect(inserted['headerRow']).toBe(true)
    expect(readDataTableAlignments(inserted['rows'], 4)).toEqual([
      'left',
      'left',
      'center',
      'right',
    ])
    const removed = withDataTableShapeEdit(props, 'rows', {
      kind: 'removeColumn',
      at: 1,
    })
    expect(removed['emphasizeColumn']).toBe(0)
    // A row edit leaves the emphasis exactly as stored.
    const row = withDataTableShapeEdit(
      { rows: GRID, emphasizeColumn: '2' },
      'rows',
      { kind: 'insertRow', at: 1 },
    )
    expect(row['emphasizeColumn']).toBe('2')
    expect(parseDataTableRows(row['rows'])).toHaveLength(4)
  })

  it('offers the six cell actions, with the last row and column kept', () => {
    const labels = dataTableCellActions(GRID, 1, 2).map((a) => a.label)
    expect(labels).toEqual([
      'Insert row above',
      'Insert row below',
      'Insert column left',
      'Insert column right',
      'Delete row',
      'Delete column',
    ])
    const below = dataTableCellActions(GRID, 1, 2)[1]
    expect(below.edit).toEqual({ kind: 'insertRow', at: 2 })
    const single = dataTableCellActions('Only', 0, 0)
    expect(single.find((a) => a.key === 'row-delete')?.disabled).toBe(true)
    expect(single.find((a) => a.key === 'column-delete')?.disabled).toBe(true)
  })

  it('starts an empty table with the Attributes grid\'s starter', () => {
    const started = withDataTableStarted({ rows: '', headerRow: true }, 'rows')
    expect(parseDataTableRows(started['rows'])[0]).toEqual([
      'Feature',
      'Us',
      'Them',
    ])
    expect(started['headerRow']).toBe(true)
  })

  it('appends a row and a column from the edge bars, keeping alignments (AGL-4216)', () => {
    const edits = dataTableAppendEdits(GRID)
    expect(edits).toEqual({
      row: { kind: 'insertRow', at: 3 },
      column: { kind: 'insertColumn', at: 3 },
    })
    const withRow = withDataTableShapeEdit({ rows: GRID }, 'rows', edits!.row)
    expect(parseDataTableRows(withRow['rows'])).toHaveLength(4)
    expect(parseDataTableRows(withRow['rows'])[3]).toEqual(['', '', ''])
    const withColumn = withDataTableShapeEdit(
      { rows: GRID },
      'rows',
      edits!.column,
    )
    expect(parseDataTableRows(withColumn['rows'])[0]).toEqual([
      'Feature',
      'Us',
      'Them',
      '',
    ])
    expect(readDataTableAlignments(withColumn['rows'], 4)).toEqual([
      'left',
      'center',
      'right',
      'left',
    ])
    // An empty grid has no edge; its table is started from the menu instead.
    expect(dataTableAppendEdits('')).toBe(null)
  })

  it('remembers the right-clicked cell for that node only, until the menu closes', () => {
    requestCanvasContextMenu('table-1', { row: 2, column: 1 })
    expect(canvasContextMenuTableCell('table-1')).toEqual({ row: 2, column: 1 })
    expect(canvasContextMenuTableCell('other')).toBe(null)
    requestCanvasContextMenu('table-1')
    expect(canvasContextMenuTableCell('table-1')).toBe(null)
    requestCanvasContextMenu('table-1', { row: 0, column: 0 })
    clearCanvasContextMenu()
    expect(canvasContextMenuTableCell('table-1')).toBe(null)
  })
})
