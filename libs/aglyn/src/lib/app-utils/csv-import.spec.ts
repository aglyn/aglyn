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

/**
 * The one CSV serializer (AGL-2621, AGL-2624): every section export, the
 * skipped-rows file and each report table's export quote the same way.
 */

import {
  csvCell,
  csvDocument,
  emptyImportResult,
  importNoMailServerSentence,
  mergeImportResults,
} from './csv-import'

describe('csvCell', () => {
  it('quotes only a cell that holds a comma, a quote or a line break', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('Ada, Countess')).toBe('"Ada, Countess"')
    expect(csvCell('Said "hello"')).toBe('"Said ""hello"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('old\r\nmac')).toBe('"old\r\nmac"')
  })

  it('writes a text cell a spreadsheet would run as a formula as text, a negative number as a number (AGL-3548)', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"')
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('-5')).toBe("'-5")
    expect(csvCell(-5)).toBe('-5')
  })

  it('writes an absent cell as nothing and a number as its digits', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(3)).toBe('3')
  })
})

describe('csvDocument', () => {
  it('writes the header first, then one line per row, quoting only what needs it', () => {
    expect(
      csvDocument(
        ['name', 'count', 'note'],
        [
          ['Ada, Countess', 3, 'Said "hello"'],
          ['plain', null, undefined],
          ['two\nlines', 0, ''],
        ],
      ),
    ).toBe(
      'name,count,note\n' +
        '"Ada, Countess",3,"Said ""hello"""\n' +
        'plain,,\n' +
        '"two\nlines",0,',
    )
  })

  it('is the header alone over no rows', () => {
    expect(csvDocument(['a', 'b'], [])).toBe('a,b')
  })
})

describe('the addresses an import found with no mail server (AGL-3328)', () => {
  it('is summed across chunks, and absent where no chunk counted', () => {
    const empty = emptyImportResult()
    expect('noMailServer' in mergeImportResults(empty, { created: 2 })).toBe(false)
    const once = mergeImportResults(empty, { created: 2, noMailServer: 1 })
    expect(once.noMailServer).toBe(1)
    expect(mergeImportResults(once, { created: 1, noMailServer: 2 }).noMailServer).toBe(3)
    expect(mergeImportResults(once, { created: 1 }).noMailServer).toBe(1)
  })

  it('says so only when there is something to say', () => {
    expect(importNoMailServerSentence(0)).toBeNull()
    expect(importNoMailServerSentence(undefined)).toBeNull()
    expect(importNoMailServerSentence(1)).toBe(
      '1 address has no mail server. Its record reads "Would bounce", and campaigns and sequences skip it.',
    )
    expect(importNoMailServerSentence(1200)).toMatch(/^1,200 addresses have no mail server\. Their records read/)
  })
})
