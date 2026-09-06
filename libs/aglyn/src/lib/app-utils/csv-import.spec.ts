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

import { csvCell, csvDocument } from './csv-import'

describe('csvCell', () => {
  it('quotes only a cell that holds a comma, a quote or a line break', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('Ada, Countess')).toBe('"Ada, Countess"')
    expect(csvCell('Said "hello"')).toBe('"Said ""hello"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('old\r\nmac')).toBe('"old\r\nmac"')
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
