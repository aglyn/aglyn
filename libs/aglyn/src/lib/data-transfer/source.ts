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

/*==========================================
 * THE SOURCE FILE — an uploaded file read as a header and rows of cells.
 *
 * Every import reads its file the same way, in the browser (to show the
 * upload step's counts before anything is sent) and on the server (to plan
 * and apply), so the two can never disagree about which line is row 3.
 *
 *  - CSV: RFC 4180 (quoted cells, doubled quotes, CRLF or LF), a leading
 *    byte-order mark dropped, and the delimiter detected from the header
 *    line — comma, semicolon or tab, whichever splits it most outside
 *    quotes. A wholly blank line is not a row. A cell an export guarded
 *    against running as a formula (a `'` before `=`, `+`, `-`, `@`, a tab
 *    or a carriage return) loses that one `'`.
 *  - JSON: an array of objects (or `{ "rows": [...] }`). The header is
 *    every key in first-seen order; a cell keeps its JSON value, so a nested
 *    object reaches a `json` field intact.
 *  - NDJSON: one object per line, read the same way.
 *
 * Rows are numbered from 0 in file order, not counting the header; that
 * index is the row every plan, ledger entry and result names.
 *=========================================*/

import { restoreCsvFormulaCell } from '../app-utils/csv'
import type { TransferFormat } from './resource'

/** A delimiter a CSV may use. A pipe is read when the person names it; detection never guesses it. */
export type TransferCsvDelimiter = ',' | ';' | '\t' | '|'

/** The delimiters detection chooses among. */
export const TRANSFER_CSV_DELIMITERS: readonly TransferCsvDelimiter[] = [',', ';', '\t']

/** How the person confirmed a CSV is read, over what detection would guess. */
export interface TransferSourceOptions {
  /** The cell separator; detected from the header line when absent. */
  delimiter?: TransferCsvDelimiter
  /** `false` when the first line is a row, not names: the columns are then "Column 1", "Column 2"… Default `true`. */
  headerRow?: boolean
}

/** A file read into a header and rows. */
export interface TransferSourceTable {
  format: TransferFormat
  /** The delimiter a CSV was read with. */
  delimiter?: TransferCsvDelimiter
  headers: string[]
  /** Cells in header order; a short CSV line is padded with `''`. */
  rows: unknown[][]
}

/** A file that could not be read, with a sentence the person reads. */
export interface TransferSourceProblem {
  code: 'empty' | 'invalidJson' | 'notRows' | 'noHeader'
  message: string
  /** The 1-based line, where one is to blame. */
  line?: number
}

export type TransferSourceRead =
  | { ok: true; table: TransferSourceTable }
  | { ok: false; problem: TransferSourceProblem }

/** The format a file name says, or `null` when its extension says nothing. */
export function transferFormatFromFileName(fileName: string | null | undefined): TransferFormat | null {
  const extension = /\.([a-z0-9]+)$/i.exec(String(fileName ?? '').trim())?.[1]?.toLowerCase()
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') return 'csv'
  if (extension === 'json') return 'json'
  if (extension === 'ndjson' || extension === 'jsonl') return 'ndjson'
  return null
}

/** The format a file's first characters suggest: `[` is JSON, `{` NDJSON, anything else CSV. */
export function sniffTransferFormat(text: string): TransferFormat {
  const start = stripBom(text).trimStart()
  if (start.startsWith('[')) return 'json'
  if (start.startsWith('{')) {
    const firstLine = start.split(/\r?\n/, 1)[0] ?? ''
    // `{ "rows": [...] }` spread over lines is JSON; one object per line is NDJSON.
    try {
      JSON.parse(firstLine)
      return 'ndjson'
    } catch {
      return 'json'
    }
  }
  return 'csv'
}

/** The media type an upload of `format` is inspected and stored as. */
export function transferContentType(format: TransferFormat): string {
  if (format === 'json') return 'application/json'
  if (format === 'ndjson') return 'application/x-ndjson'
  return 'text/csv'
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** How many times `delimiter` splits `line` outside quotes. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0
  let quoted = false
  for (const char of line) {
    if (char === '"') quoted = !quoted
    else if (!quoted && char === delimiter) count += 1
  }
  return count
}

/** The delimiter that splits the header line most; comma on a tie or a one-column file. */
export function detectCsvDelimiter(text: string): TransferCsvDelimiter {
  const header = stripBom(text).split(/\r?\n/, 1)[0] ?? ''
  let best: TransferCsvDelimiter = ','
  let bestCount = countOutsideQuotes(header, ',')
  for (const delimiter of TRANSFER_CSV_DELIMITERS) {
    const count = countOutsideQuotes(header, delimiter)
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

/**
 * CSV text into rows of cells (header included), wholly blank lines dropped.
 * A cell an export guarded against running as a spreadsheet formula (`'=…`)
 * reads back as it was (`=…`), so an export imported again is unchanged.
 */
export function parseTransferCsv(text: string, delimiter: TransferCsvDelimiter = ','): string[][] {
  const source = stripBom(String(text ?? ''))
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const endRow = () => {
    row.push(restoreCsvFormulaCell(cell))
    if (row.some((entry) => entry.trim() !== '')) rows.push(row)
    row = []
    cell = ''
  }
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at]
    if (quoted) {
      if (char === '"') {
        if (source[at + 1] === '"') {
          cell += '"'
          at += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"' && cell === '') quoted = true
    else if (char === delimiter) {
      row.push(restoreCsvFormulaCell(cell))
      cell = ''
    } else if (char === '\n') endRow()
    else if (char === '\r') {
      if (source[at + 1] !== '\n') endRow()
    } else cell += char
  }
  if (cell !== '' || row.length) endRow()
  return rows
}

/** Objects into a header (keys in first-seen order) and rows. */
function tableFromObjects(format: TransferFormat, objects: readonly unknown[]): TransferSourceRead {
  const headers: string[] = []
  const seen = new Set<string>()
  for (const [index, object] of objects.entries()) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      return {
        ok: false,
        problem: { code: 'notRows', message: `Entry ${index + 1} is not an object with named values.` },
      }
    }
    for (const key of Object.keys(object)) {
      if (seen.has(key)) continue
      seen.add(key)
      headers.push(key)
    }
  }
  if (!headers.length) return { ok: false, problem: { code: 'noHeader', message: 'The file names no fields.' } }
  const rows = objects.map((object) =>
    headers.map((key) => {
      const value = (object as Record<string, unknown>)[key]
      return value === undefined || value === null ? '' : value
    }),
  )
  return { ok: true, table: { format, headers, rows } }
}

/**
 * A file's text read as `format` (see the block header). For a CSV,
 * `options` carries what the person confirmed in the upload step — the
 * delimiter, and whether the first line names the columns — so the server
 * reads the file exactly as the browser previewed it.
 */
export function readTransferSource(
  text: string,
  format: TransferFormat,
  options: TransferSourceOptions = {},
): TransferSourceRead {
  const source = stripBom(String(text ?? ''))
  if (!source.trim()) return { ok: false, problem: { code: 'empty', message: 'The file is empty.' } }

  if (format === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch {
      return { ok: false, problem: { code: 'invalidJson', message: 'The file is not valid JSON.' } }
    }
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['rows'])
        ? ((parsed as Record<string, unknown>)['rows'] as unknown[])
        : null
    if (!list) {
      return {
        ok: false,
        problem: { code: 'notRows', message: 'The file is not a list of records (an array, or an object with "rows").' },
      }
    }
    return tableFromObjects('json', list)
  }

  if (format === 'ndjson') {
    const objects: unknown[] = []
    const lines = source.split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue
      try {
        objects.push(JSON.parse(line))
      } catch {
        return {
          ok: false,
          problem: { code: 'invalidJson', message: `Line ${index + 1} is not valid JSON.`, line: index + 1 },
        }
      }
    }
    return tableFromObjects('ndjson', objects)
  }

  const delimiter = options.delimiter ?? detectCsvDelimiter(source)
  if (options.headerRow === false) {
    const lines = parseTransferCsv(source, delimiter)
    const width = lines.reduce((most, line) => Math.max(most, line.length), 0)
    const headers = Array.from({ length: width }, (_unused, index) => `Column ${index + 1}`)
    const rows = lines.map((cells) =>
      cells.length >= width ? cells : [...cells, ...new Array<string>(width - cells.length).fill('')],
    )
    return { ok: true, table: { format: 'csv', delimiter, headers, rows } }
  }
  const [header, ...body] = parseTransferCsv(source, delimiter)
  if (!header || !header.some((cell) => cell.trim())) {
    return { ok: false, problem: { code: 'noHeader', message: 'The file has no header row.', line: 1 } }
  }
  const headers = header.map((cell, index) => cell.trim() || `Column ${index + 1}`)
  const rows = body.map((cells) =>
    cells.length >= headers.length ? cells : [...cells, ...new Array<string>(headers.length - cells.length).fill('')],
  )
  return { ok: true, table: { format: 'csv', delimiter, headers, rows } }
}

/** A cell as the text a sample, a result file or a preview shows. */
export function transferCellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
