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
 * CSV, read and written the one way the platform does it (AGL-2335).
 *
 * There were five divergent hand-rolled CSV escapers in this repo; this is
 * the one escaper and the one parser every plugin and app reaches — the data
 * plugin's dataset export and import, the email list import, the commerce
 * catalog import, the CRM's contact import — and the check a download runs
 * against the row count its server promised. Nothing here knows what the rows
 * are; a plugin that writes its own records into a file formats each value
 * itself and escapes it here.
 */

/**
 * A cell a spreadsheet would run as a formula: one that opens with `=`, `+`,
 * `-` or `@`, or with a tab or carriage return (which some spreadsheets strip
 * before reading the rest as a formula). Leading `'`s are looked through, so
 * a cell that already starts with the guard is guarded again and the reader
 * below can always take exactly one back off.
 */
const CSV_FORMULA_LEAD = /^'*[=+\-@\t\r]/

/** A plain number as text: `-5`, `+1.5`, `.25`, `1e-3`. */
const CSV_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/

export interface CsvCellOptions {
  /**
   * The cell holds a number (a number value, or a number, currency or
   * percent field). A cell that reads as a plain number is then written as
   * is — `-5` stays a negative number in the spreadsheet — and anything else
   * is still guarded.
   */
  numeric?: boolean
}

/**
 * A cell that cannot run as a spreadsheet formula (AGL-3548).
 *
 * Every CSV the platform writes may hold text a stranger typed — a form
 * answer, a lead's company name — and a spreadsheet that opens the file runs
 * `=HYPERLINK(...)` or `@SUM(...)` as a formula. A leading `'` makes the
 * spreadsheet show the cell as text instead. Only the CSV gets this; a JSON
 * or NDJSON file is read by programs, so it keeps the value as it is.
 * {@link restoreCsvFormulaCell} takes the `'` back off on import.
 */
export function neutralizeCsvFormula(cell: string, options?: CsvCellOptions): string {
  if (!CSV_FORMULA_LEAD.test(cell)) return cell
  if (options?.numeric && CSV_NUMBER.test(cell)) return cell
  return `'${cell}`
}

/**
 * A CSV cell as it was before {@link neutralizeCsvFormula}: one leading `'`
 * dropped when it guards a formula character (or another guard), so a file
 * exported and imported again holds the same text. A `'` before anything
 * else is part of the value and stays.
 */
export function restoreCsvFormulaCell(cell: string): string {
  return /^'+[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell
}

/**
 * One cell: guarded against running as a formula (see
 * {@link neutralizeCsvFormula}), then quoted when it has to be — a comma, a
 * quote or a line break. Every CSV writer goes through this.
 */
export const escapeCsvCell = (cell: string, options?: CsvCellOptions): string => {
  const safe = neutralizeCsvFormula(cell, options)
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/**
 * Data rows in a CSV document — the header excluded, quoted newlines not
 * counted as row breaks (AGL-2335).
 *
 * This exists so a download can be CHECKED against the row count the server
 * promised, rather than trusted. A truncated export is the defect this whole
 * area is about, and a stream that dies halfway produces a perfectly
 * well-formed shorter file: nothing about the bytes says they are short.
 *
 * Single pass, no array building — {@link parseCsv} answers the same
 * question but materializes every cell, which is the wrong trade when the
 * file may be hundreds of thousands of rows and the only thing wanted is
 * how many there are.
 */
export function countCsvDataRows(text: string): number {
  const source = String(text ?? '')
  if (!source) return 0
  let rows = 0
  let quoted = false
  let cellsSeen = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') index += 1
        else quoted = false
      }
      cellsSeen = true
      continue
    }
    if (char === '"') {
      quoted = true
      cellsSeen = true
      continue
    }
    if (char === '\n') {
      rows += 1
      cellsSeen = false
      continue
    }
    if (char !== '\r') cellsSeen = true
  }
  // A file that does not end in a newline still has a final row.
  if (cellsSeen) rows += 1
  // The header is not data.
  return Math.max(0, rows - 1)
}

/**
 * Did a downloaded export arrive whole? (AGL-2335)
 *
 * The server streams and reports its `count()` aggregate in a header, so the
 * client can CHECK rather than trust. This is the check, kept here as a pure
 * function because a guard living inline in a component is a guard nobody
 * can force red — and this one exists precisely to catch a silent shortfall.
 *
 * `short` is only true when the count is both KNOWN and lower. A missing or
 * unparseable header is not evidence of truncation, and refusing a download
 * on the strength of a header that never arrived would fail the user for the
 * server's bookkeeping. More rows than promised is not short either — the
 * count is a snapshot taken before the first page, so a concurrent insert
 * can legitimately overtake it.
 */
export function exportShortfall(
  promisedHeader: string | null | undefined,
  body: string,
  format: 'csv' | 'json',
): { promised: number; received: number; short: boolean } {
  const promised = Number(promisedHeader)
  let received: number
  if (format === 'csv') {
    received = countCsvDataRows(body)
  } else {
    try {
      const parsed = JSON.parse(body) as unknown
      received = Array.isArray(parsed) ? parsed.length : 0
    } catch {
      // A body that is not JSON at all did not arrive whole.
      return { promised, received: 0, short: true }
    }
  }
  return {
    promised,
    received,
    short: Number.isFinite(promised) && promisedHeader != null && received < promised,
  }
}

/**
 * Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF).
 *
 * The inverse of the escaper above, and the one parser in the repo — see the
 * module note for why the email list importer reaches this rather than
 * writing its own. A cell the escaper guarded against running as a formula
 * comes back without its guard ({@link restoreCsvFormulaCell}).
 *
 * A wholly blank row is dropped. Every spreadsheet writes a trailing newline
 * and a row of empty cells is not a record; carrying it through would give
 * every caller the same off-by-one to remember.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const source = String(text ?? '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(restoreCsvFormulaCell(cell))
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(restoreCsvFormulaCell(cell))
      cell = ''
      rows.push(row)
      row = []
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length) {
    row.push(restoreCsvFormulaCell(cell))
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''))
}
