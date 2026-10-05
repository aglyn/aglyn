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

import { escapeCsvCell, neutralizeCsvFormula, parseCsv, restoreCsvFormulaCell } from './csv'

describe('a CSV cell cannot run as a spreadsheet formula (AGL-3548)', () => {
  it('guards every formula lead with one leading quote', () => {
    for (const cell of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '\t=1', '\r=1']) {
      expect(neutralizeCsvFormula(cell)).toBe(`'${cell}`)
    }
    expect(neutralizeCsvFormula('Ada')).toBe('Ada')
    expect(neutralizeCsvFormula('a=b')).toBe('a=b')
    expect(neutralizeCsvFormula('')).toBe('')
    // A cell that already opens with the guard is guarded again, so the
    // reader can always take exactly one back off.
    expect(neutralizeCsvFormula("'=x")).toBe("''=x")
    expect(neutralizeCsvFormula("'quoted")).toBe("'quoted")
  })

  it('lets a genuine number through only when the cell is numeric', () => {
    expect(neutralizeCsvFormula('-5')).toBe("'-5")
    expect(neutralizeCsvFormula('-5', { numeric: true })).toBe('-5')
    expect(neutralizeCsvFormula('+1.5e3', { numeric: true })).toBe('+1.5e3')
    expect(neutralizeCsvFormula('-5+cmd|calc', { numeric: true })).toBe("'-5+cmd|calc")
    expect(neutralizeCsvFormula('=5', { numeric: true })).toBe("'=5")
  })

  it('quotes after guarding, so a guarded cell with a comma is one cell', () => {
    expect(escapeCsvCell('=A1,B1')).toBe(`"'=A1,B1"`)
    expect(escapeCsvCell('\r=1')).toBe(`"'\r=1"`)
    expect(escapeCsvCell('plain')).toBe('plain')
  })

  it('reads a guarded cell back as it was, and leaves any other quote alone', () => {
    expect(restoreCsvFormulaCell("'=x")).toBe('=x')
    expect(restoreCsvFormulaCell("''=x")).toBe("'=x")
    expect(restoreCsvFormulaCell("'tis")).toBe("'tis")
    expect(restoreCsvFormulaCell('-5')).toBe('-5')
  })

  it('round-trips through the parser unchanged', () => {
    const cells = ['=HYPERLINK("http://x")', '-5', "'=already", '@me, you', '\tindent', "'tis", 'plain']
    const text = `${cells.map((cell) => escapeCsvCell(cell)).join(',')}\r\n`
    expect(parseCsv(text)).toEqual([cells])
  })
})
