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
 * THE EXPORT FILE — rows of chosen fields written as CSV, JSON or NDJSON.
 *
 * The export route writes it a page at a time and the console's client
 * counts what arrived against the row count the route promised, so both
 * sides use these functions and cannot disagree about what a row is.
 *
 *  - CSV: the header is each field's label, so the file maps straight back
 *    in on import; a list is written as its items joined by `; ` (the list
 *    reader splits on it), an object as JSON, a blank as an empty cell.
 *  - JSON: one array of objects keyed by field id; NDJSON: one object per
 *    line. Values are written as they are.
 *=========================================*/

import { countCsvDataRows, escapeCsvCell } from '../app-utils/csv'
import type { TransferFormat } from './resource'
import type { TransferExportPrefs, TransferExportScopeKind, TransferPrefs } from './transfer-api'

/** A value as one CSV cell's text. */
export function transferExportCellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
    return value.filter((item) => item !== null && item !== '').join('; ')
  }
  return JSON.stringify(value)
}

/** One row's chosen fields, in order, keyed by field id. */
export function transferExportRecord(
  row: Readonly<Record<string, unknown>>,
  fieldIds: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(fieldIds.map((fieldId) => [fieldId, row[fieldId] ?? null]))
}

/** The CSV header line: each field's label (its id when it has none). */
export function transferExportCsvHeader(fieldIds: readonly string[], labelOf: (fieldId: string) => string): string {
  return fieldIds.map((fieldId) => escapeCsvCell(labelOf(fieldId) || fieldId)).join(',')
}

/** One row as a CSV line. */
export function transferExportCsvLine(row: Readonly<Record<string, unknown>>, fieldIds: readonly string[]): string {
  return fieldIds.map((fieldId) => escapeCsvCell(transferExportCellText(row[fieldId]))).join(',')
}

const EXTENSIONS: Readonly<Record<TransferFormat, string>> = { csv: 'csv', json: 'json', ndjson: 'ndjson' }

/** The file's name: the resource key and the day, `people-2026-10-05.csv`. */
export function transferExportFileName(resource: string, format: TransferFormat, at: Date): string {
  const base = resource.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'export'
  return `${base}-${at.toISOString().slice(0, 10)}.${EXTENSIONS[format]}`
}

/**
 * The rows a downloaded export holds, to check against the count the route
 * promised. `null` for a JSON body that does not parse — it did not arrive
 * whole.
 */
export function countTransferExportRows(text: string, format: TransferFormat): number | null {
  if (format === 'csv') return countCsvDataRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  if (format === 'ndjson') return text.split(/\r?\n/).filter((line) => line.trim()).length
  try {
    const parsed = JSON.parse(text) as unknown
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

const FORMATS: readonly TransferFormat[] = ['csv', 'json', 'ndjson']
const SCOPES: readonly TransferExportScopeKind[] = ['selection', 'filter', 'all']
const PRESETS_MAX = 50
const FIELDS_MAX = 500

const stringList = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0).slice(0, max) : []

/**
 * A stored or sent `TransferPrefs`, as far as it can be trusted: whatever
 * is not the right shape is dropped, so a hand-edited document never breaks
 * the dialog that reads it.
 */
export function normalizeTransferPrefs(raw: unknown): TransferPrefs {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const presets: TransferPrefs['presets'] = []
  for (const entry of Array.isArray(source['presets']) ? source['presets'] : []) {
    const preset = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    if (typeof preset['id'] !== 'string' || !preset['id'] || typeof preset['label'] !== 'string') continue
    presets.push({ id: preset['id'], label: preset['label'].slice(0, 120), fieldIds: stringList(preset['fieldIds'], FIELDS_MAX) })
    if (presets.length >= PRESETS_MAX) break
  }
  const prefs: TransferPrefs = { presets }
  const last = (source['export'] && typeof source['export'] === 'object' ? source['export'] : null) as Record<string, unknown> | null
  if (last && FORMATS.includes(last['format'] as TransferFormat)) {
    const exported: TransferExportPrefs = {
      presetId: typeof last['presetId'] === 'string' ? last['presetId'] : null,
      fieldIds: stringList(last['fieldIds'], FIELDS_MAX),
      format: last['format'] as TransferFormat,
      bom: last['bom'] === true,
      scope: SCOPES.includes(last['scope'] as TransferExportScopeKind) ? (last['scope'] as TransferExportScopeKind) : 'all',
    }
    prefs.export = exported
  }
  return prefs
}
