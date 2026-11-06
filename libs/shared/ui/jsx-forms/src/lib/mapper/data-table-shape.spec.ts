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

import {
  dataTableCellText,
  dataTableStarterValue,
  editDataTableShape,
  emphasisAfterShapeEdit,
  isDataTableCellMarkup,
  parseDataTableRows,
  readDataTableAlignments,
  serializeDataTable,
} from '@aglyn/shared-data-enums'

/*
  Specced from a consumer for the reason `data-table-grid.spec.ts` gives: the
  enums lib has no test runner.
*/
const TABLE = [
  'Feature | Us | Them',
  '--- | :---: | ---:',
  'Open source | Yes | No',
].join('\n')

describe('table shape edits keep each column its alignment (AGL-4203)', () => {
  it('inserts a column with the alignments moving with their columns', () => {
    const next = editDataTableShape(TABLE, { kind: 'insertColumn', at: 1 })
    expect(parseDataTableRows(next)[0]).toEqual(['Feature', '', 'Us', 'Them'])
    expect(readDataTableAlignments(next, 4)).toEqual([
      'left',
      'left',
      'center',
      'right',
    ])
  })

  it('removes a column and its alignment together', () => {
    const next = editDataTableShape(TABLE, { kind: 'removeColumn', at: 1 })
    expect(parseDataTableRows(next)).toEqual([
      ['Feature', 'Them'],
      ['Open source', 'No'],
    ])
    expect(readDataTableAlignments(next, 2)).toEqual(['left', 'right'])
  })

  it('never removes the last column', () => {
    const one = 'A\nB'
    expect(
      parseDataTableRows(editDataTableShape(one, { kind: 'removeColumn', at: 0 })),
    ).toEqual([['A'], ['B']])
  })

  it('inserts and removes rows at a position, keeping the divider', () => {
    const above = editDataTableShape(TABLE, { kind: 'insertRow', at: 1 })
    expect(parseDataTableRows(above)).toEqual([
      ['Feature', 'Us', 'Them'],
      ['', '', ''],
      ['Open source', 'Yes', 'No'],
    ])
    expect(readDataTableAlignments(above, 3)).toEqual([
      'left',
      'center',
      'right',
    ])
    const removed = editDataTableShape(TABLE, { kind: 'removeRow', at: 0 })
    expect(parseDataTableRows(removed)).toEqual([['Open source', 'Yes', 'No']])
  })

  it('keeps the highlight on the column it was put on', () => {
    expect(emphasisAfterShapeEdit(2, 3, { kind: 'insertColumn', at: 0 })).toBe(3)
    expect(emphasisAfterShapeEdit(2, 3, { kind: 'insertColumn', at: 2 })).toBe(2)
    expect(emphasisAfterShapeEdit(3, 3, { kind: 'removeColumn', at: 0 })).toBe(2)
    expect(emphasisAfterShapeEdit(2, 3, { kind: 'removeColumn', at: 1 })).toBe(0)
    expect(emphasisAfterShapeEdit(2, 3, { kind: 'insertRow', at: 0 })).toBe(2)
    expect(emphasisAfterShapeEdit(0, 3, { kind: 'insertColumn', at: 0 })).toBe(0)
  })

  it('starts a table the same way everywhere', () => {
    const start = dataTableStarterValue()
    expect(parseDataTableRows(start)).toEqual([
      ['Feature', 'Us', 'Them'],
      ['', '', ''],
    ])
    expect(readDataTableAlignments(start, 3)).toEqual([
      'left',
      'center',
      'center',
    ])
  })
})

describe('formatted table cells (AGL-4203)', () => {
  it('tells a formatted cell from a plain one', () => {
    expect(isDataTableCellMarkup('<b>Yes</b>')).toBe(true)
    expect(isDataTableCellMarkup('a &lt; b')).toBe(true)
    expect(isDataTableCellMarkup('Yes')).toBe(false)
    expect(isDataTableCellMarkup('a < b')).toBe(false)
    expect(isDataTableCellMarkup('Q&A')).toBe(false)
  })

  it('reads the words of a formatted cell for a plain-text field', () => {
    expect(
      dataTableCellText('<b>Yes</b>, <a href="https://x.test">see docs</a>'),
    ).toBe('Yes, see docs')
    expect(dataTableCellText('one<br>two')).toBe('one two')
    expect(dataTableCellText('a &lt; b &amp; c&#33;')).toBe('a < b & c!')
    expect(dataTableCellText('Plain')).toBe('Plain')
  })

  it('round-trips markup with a pipe inside it through the grid', () => {
    const cell = '<a href="https://x.test/?a|b">x</a>'
    // Stored the way the grid stores it: the pipe inside the cell escaped.
    const next = editDataTableShape(serializeDataTable([[cell, 'B']]), {
      kind: 'insertRow',
      at: 1,
    })
    expect(parseDataTableRows(next)[0]).toEqual([cell, 'B'])
  })
})
