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

import { readTransferSource } from './source'
import {
  countTransferExportRows,
  normalizeTransferPrefs,
  transferExportCellText,
  transferExportCsvCell,
  transferExportCsvHeader,
  transferExportCsvLine,
  transferExportFileName,
  transferExportRecord,
} from './export-file'

describe('the export file', () => {
  it('writes a cell as text a spreadsheet and the import both read', () => {
    expect(transferExportCellText(null)).toBe('')
    expect(transferExportCellText(['a', '', 'b'])).toBe('a; b')
    expect(transferExportCellText({ a: 1 })).toBe('{"a":1}')
    expect(transferExportCellText(false)).toBe('false')
    expect(transferExportCsvHeader(['id', 'name'], (id) => (id === 'name' ? 'Full, name' : ''))).toBe('id,"Full, name"')
    expect(transferExportCsvLine({ name: 'Ada "L"', id: 'r1' }, ['id', 'name'])).toBe('r1,"Ada ""L"""')
    expect(transferExportRecord({ b: 2 }, ['a', 'b'])).toEqual({ a: null, b: 2 })
    expect(transferExportFileName('crm.contacts', 'ndjson', new Date(Date.UTC(2026, 9, 5)))).toBe('crm-contacts-2026-10-05.ndjson')
  })

  it('writes a cell a spreadsheet would run as a formula as text, a number in a number field as a number (AGL-3548)', () => {
    expect(transferExportCsvCell('=cmd|calc')).toBe("'=cmd|calc")
    expect(transferExportCsvCell('-5', 'text')).toBe("'-5")
    expect(transferExportCsvCell('-5', 'number')).toBe('-5')
    expect(transferExportCsvCell('-12.5', 'currency')).toBe('-12.5')
    expect(transferExportCsvCell('-5 off', 'number')).toBe("'-5 off")
    expect(transferExportCsvCell(-5)).toBe('-5')
    expect(transferExportCsvCell(['@a', 'b'], 'tags')).toBe("'@a; b")
    expect(transferExportCsvHeader(['f'], () => '=Label')).toBe("'=Label")
    const types: Record<string, 'text' | 'number'> = { note: 'text', delta: 'number' }
    expect(transferExportCsvLine({ note: '+1 555', delta: '-3' }, ['note', 'delta'], (id) => types[id])).toBe("'+1 555,-3")
  })

  it('reads its own CSV back unchanged, guard and all', () => {
    const rows = [{ answer: '=HYPERLINK("http://x","y")', score: -2, note: "'=kept" }]
    const fieldIds = ['answer', 'score', 'note']
    const csv = [transferExportCsvHeader(fieldIds, (id) => id), ...rows.map((row) => transferExportCsvLine(row, fieldIds))].join('\r\n')
    const read = readTransferSource(csv, 'csv')
    expect(read.ok && read.table.rows).toEqual([['=HYPERLINK("http://x","y")', '-2', "'=kept"]])
  })

    it('counts a download’s rows in each format, so a short file is caught', () => {
    expect(countTransferExportRows('﻿Name\r\n"A\r\nB"\r\nC\r\n', 'csv')).toBe(2)
    expect(countTransferExportRows('{"a":1}\n\n{"a":2}\n', 'ndjson')).toBe(2)
    expect(countTransferExportRows('[{"a":1}]', 'json')).toBe(1)
    expect(countTransferExportRows('[{"a":1},', 'json')).toBeNull()
  })

  it('keeps only well-formed remembered choices', () => {
    expect(normalizeTransferPrefs(null)).toEqual({ presets: [] })
    expect(
      normalizeTransferPrefs({
        presets: [{ id: 'p', label: 'P', fieldIds: ['a', 1, ''] }, 'junk'],
        export: { presetId: null, fieldIds: ['a'], format: 'xml', bom: true, scope: 'all' },
      }),
    ).toEqual({ presets: [{ id: 'p', label: 'P', fieldIds: ['a'] }] })
  })
})
