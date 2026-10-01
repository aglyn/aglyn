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
 * This plugin's own: the export route that streams a dataset a page at a
 * time and the hub's client-side download both write through it. The
 * escaper, the parser and the row-count check are the platform's
 * (`app-utils/csv`), because the email, commerce and CRM imports read files
 * too and may not reach this plugin.
 */

import { escapeCsvCell as csvEscape } from '@aglyn/aglyn/app-utils/csv'
import type {
  DatasetFieldDefinition,
  DatasetModel,
} from '@aglyn/aglyn/app-utils/dataset-models'


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
