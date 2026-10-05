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
 * The upload step's guesses: each is shown and changeable, but a good guess
 * is what keeps a semicolon file from arriving as one column.
 */

import {
  decodeBytes,
  detectDelimiter,
  detectEncoding,
  detectFormat,
  detectHeaderRow,
  detectTransferFileSettings,
  parseDelimited,
  parseTransferText,
} from './transfer-file'

describe('transfer-file', () => {
  it('reads the separator the lines agree on', () => {
    expect(detectDelimiter('a;b;c\n1;2,5;3\n4;5;6')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(detectDelimiter('"x, y",b\n1,2')).toBe(',')
  })

  it('parses quotes, doubled quotes and line breaks inside quotes, and drops blank lines', () => {
    expect(parseDelimited('a,"b ""c""","d\ne"\r\n\r\n1,2,3')).toEqual([
      ['a', 'b "c"', 'd\ne'],
      ['1', '2', '3'],
    ])
  })

  it('takes a first line of names as the header and a first line of data as data', () => {
    expect(
      detectHeaderRow([
        ['Name', 'Email'],
        ['Ada', 'ada@example.com'],
      ]),
    ).toBe(true)
    expect(detectHeaderRow([['Ada', 'ada@example.com']])).toBe(false)
    expect(detectHeaderRow([['Name', 'Name']])).toBe(false)
    expect(
      parseTransferText('Ada,1\nBob,2', {
        format: 'csv',
        delimiter: ',',
        headerRow: false,
      }).headers,
    ).toEqual(['Column 1', 'Column 2'])
  })

  it('names the encoding a byte-order mark or invalid UTF-8 implies', () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe(
      'utf-8',
    )
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe(
      'utf-16le',
    )
    expect(detectEncoding(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe(
      'windows-1252',
    )
    expect(
      decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), 'windows-1252'),
    ).toBe('café')
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), 'utf-8')).toBe(
      'a',
    )
  })

  it('tells JSON and NDJSON from CSV, and reads their records as columns', () => {
    expect(detectFormat('people.json', '[]')).toBe('json')
    expect(detectFormat('', '{"a":1}\n{"a":2}')).toBe('ndjson')
    expect(detectFormat('x.txt', 'a,b')).toBe('csv')
    expect(
      parseTransferText('[{"a":1},{"b":"x"}]', {
        format: 'json',
        delimiter: ',',
        headerRow: true,
      }),
    ).toEqual({
      headers: ['a', 'b'],
      rows: [
        [1, ''],
        ['', 'x'],
      ],
    })
    expect(
      parseTransferText('[oops', {
        format: 'json',
        delimiter: ',',
        headerRow: true,
      }).error,
    ).toMatch(/not valid JSON/)
    expect(
      detectTransferFileSettings('x.csv', 'Name;Email\nAda;a@b.co'),
    ).toEqual({
      format: 'csv',
      encoding: 'utf-8',
      delimiter: ';',
      headerRow: true,
    })
  })
})
