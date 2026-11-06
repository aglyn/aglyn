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
  findDataTableAttributeName,
  findDataTableCellAtPoint,
  readDataTableCell,
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
