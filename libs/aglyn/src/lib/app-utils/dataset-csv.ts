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
 * Dataset CSV/JSON serialization (AGL-182). The predictable inverse of
 * `coerceDocumentValues`: ISO dates, `lat, lon` coordinates, comma-joined
 * lists, JSON maps, reference ids — so an export re-imports losslessly
 * through the same coercion.
 *
 * **Why this lives in core rather than in `@aglyn/plugins-data`** (AGL-2335).
 * AGL-413 moved dataset io out to the plugin, and the dataset-shaped half of
 * the import machinery — column mapping against a `DatasetModel` — is still
 * there, correctly: nothing outside that plugin maps a file onto a dataset.
 *
 * Writing one is different now. `/api/orgs/datasets/export` streams a
 * dataset from the server, and `scope:app` may not import a lib tagged
 * `aglyn:addons` — apps reach plugins only through the generated loader
 * manifests (AGL-417/419). The choice was a second copy of the escaper in
 * the console or one copy somewhere both may reach. There are already five
 * divergent hand-rolled CSV escapers in this repo; this is not becoming the
 * sixth. `dataset-io.ts` re-exports every name below, so the plugin's own
 * imports are unchanged.
 *
 * READING one is shared for the same reason. The email list importer parses
 * a merchant's contact file, and it lives in `@aglyn/plugins-email`, which
 * may not import `@aglyn/plugins-data` either. So {@link parseCsv} sits here
 * beside the escaper that is its inverse, and `dataset-io.ts` re-exports it
 * exactly as it re-exports the writing half.
 */

import type { DatasetFieldDefinition, DatasetModel } from './dataset-models'


/** Storage value → portable string (CSV cell / JSON value). */
export function serializeDatasetValue(
  field: DatasetFieldDefinition,
  value: unknown,
): string {
  if (value == null) return ''
  switch (field.type) {
    case 'timestamp':
      return typeof value === 'number' && Number.isFinite(value)
        ? new Date(value).toISOString()
        : String(value)
    case 'coordinates': {
      const coordinates = value as { latitude?: number; longitude?: number }
      return coordinates &&
        typeof coordinates.latitude === 'number' &&
        typeof coordinates.longitude === 'number'
        ? `${coordinates.latitude}, ${coordinates.longitude}`
        : String(value)
    }
    case 'sorted':
    case 'reference':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'map':
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    default:
      return String(value)
  }
}

const csvEscape = (cell: string): string =>
  /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell

/**
 * The header line — field ids, in model order (AGL-2335).
 *
 * Split out of {@link datasetRecordsToCsv} so a server export can emit the
 * file a page at a time. The whole point of that export is that it is not
 * bounded by what one process can hold in memory, and a helper that only
 * takes a complete `rows` array cannot serve it. Everything below shares
 * one escaper: there are already five divergent hand-rolled CSV escapers in
 * this repo and this is not becoming the sixth.
 */
export function datasetCsvHeader(model: DatasetModel): string {
  return model.order.map(csvEscape).join(',')
}

/** One record's values (storage form) → one CSV line, no terminator. */
export function datasetCsvRow(
  model: DatasetModel,
  row: Record<string, unknown>,
): string {
  return model.order
    .map((fieldId) => {
      const field = model.fields[fieldId]
      return csvEscape(field ? serializeDatasetValue(field, row[fieldId]) : '')
    })
    .join(',')
}

/** One record's values → the portable JSON object the JSON export emits. */
export function datasetRecordToJson(
  model: DatasetModel,
  row: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    model.order.map((fieldId) => {
      const field = model.fields[fieldId]
      return [fieldId, field ? serializeDatasetValue(field, row[fieldId]) : '']
    }),
  )
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

/** Rows (storage-form value maps) → CSV with a fieldId header row. */
export function datasetRecordsToCsv(
  model: DatasetModel,
  rows: Array<Record<string, unknown>>,
): string {
  return [
    datasetCsvHeader(model),
    ...rows.map((row) => datasetCsvRow(model, row)),
  ].join('\n')
}

/**
 * Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF).
 *
 * The inverse of the escaper above, and the one parser in the repo — see the
 * module note for why the email list importer reaches this rather than
 * writing its own.
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
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''))
}

