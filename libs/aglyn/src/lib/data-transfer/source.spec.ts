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
  detectCsvDelimiter,
  parseTransferCsv,
  readTransferSource,
  sniffTransferFormat,
  transferCellText,
  transferFormatFromFileName,
} from './source'

describe('reading an uploaded file', () => {
  it('reads a CSV with quotes, doubled quotes, CRLF, a byte-order mark and blank lines', () => {
    const read = readTransferSource('﻿Name,Note\r\n"Smith, Jo","said ""hi""\nthen left"\r\n\r\nAda,\r\n', 'csv')
    expect(read).toEqual({
      ok: true,
      table: {
        format: 'csv',
        delimiter: ',',
        headers: ['Name', 'Note'],
        rows: [
          ['Smith, Jo', 'said "hi"\nthen left'],
          ['Ada', ''],
        ],
      },
    })
  })

  it('detects a semicolon or tab delimiter from the header, outside quotes', () => {
    expect(detectCsvDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectCsvDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(detectCsvDelimiter('"a;b",c')).toBe(',')
    expect(parseTransferCsv('a;b\n1;2', ';')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('pads a short line and names a blank header', () => {
    const read = readTransferSource('Name,,Email\nAda', 'csv')
    expect(read.ok && read.table.headers).toEqual(['Name', 'Column 2', 'Email'])
    expect(read.ok && read.table.rows).toEqual([['Ada', '', '']])
  })

  it('reads JSON and NDJSON objects, keys in first-seen order, nested values kept', () => {
    const json = readTransferSource('[{"name":"Ada","meta":{"a":1}},{"email":"x@y.z"}]', 'json')
    expect(json).toEqual({
      ok: true,
      table: { format: 'json', headers: ['name', 'meta', 'email'], rows: [['Ada', { a: 1 }, ''], ['', '', 'x@y.z']] },
    })
    const wrapped = readTransferSource('{"rows":[{"a":1}]}', 'json')
    expect(wrapped.ok && wrapped.table.rows).toEqual([[1]])
    const lines = readTransferSource('{"a":1}\n\n{"a":2,"b":true}\n', 'ndjson')
    expect(lines.ok && lines.table).toEqual({ format: 'ndjson', headers: ['a', 'b'], rows: [[1, ''], [2, true]] })
  })

  it('says what is wrong with a file it cannot read', () => {
    expect(readTransferSource('  ', 'csv')).toEqual({ ok: false, problem: { code: 'empty', message: 'The file is empty.' } })
    expect(readTransferSource('[1,2]', 'json')).toMatchObject({ ok: false, problem: { code: 'notRows' } })
    expect(readTransferSource('{"a":1}\nnope', 'ndjson')).toMatchObject({ ok: false, problem: { code: 'invalidJson', line: 2 } })
  })

  it('names a format from the file name, then from the first characters', () => {
    expect(transferFormatFromFileName('people.TSV')).toBe('csv')
    expect(transferFormatFromFileName('dump.jsonl')).toBe('ndjson')
    expect(transferFormatFromFileName('notes')).toBeNull()
    expect(sniffTransferFormat(' [{"a":1}]')).toBe('json')
    expect(sniffTransferFormat('{"a":1}\n{"a":2}')).toBe('ndjson')
    expect(sniffTransferFormat('{\n "rows": []\n}')).toBe('json')
    expect(sniffTransferFormat('a,b')).toBe('csv')
    expect(transferCellText({ a: 1 })).toBe('{"a":1}')
  })
})
