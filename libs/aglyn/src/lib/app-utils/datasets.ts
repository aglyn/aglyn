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
 * Datasets (AGL-102): tabular data at `hosts/{hostId}/datasets/{id}` with a
 * `records` subcollection, edited in the console Data card and consumed by
 * repeatable components (AGL-103) via `{{item.field}}` bindings.
 */

import {
  type DatasetModel,
  effectiveDatasetModel,
} from './dataset-models'

/** Dataset field name: starts with a letter; letters/digits/underscores. */
export const DATASET_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

export interface HostDataset {
  $id?: string
  displayName?: string
  /** Column names, in display order (v1; superseded by `model`). */
  fields?: string[]
  /** Typed model (AGL-177); when absent, derive from `fields`. */
  model?: import('./dataset-models').DatasetModel
  /** dod.ts Schema.Name shape (AGL-178). */
  names?: { singular?: string; plural?: string }
}

export interface HostDatasetRecord {
  $id?: string
  /** Field → display value. */
  values?: Record<string, string>
  /** Row position in the editor and in repeated output. */
  order?: number
}

/**
 * A human field entry from the quick creator: the stable id plus the
 * display name shown in table headers and bindings pickers (AGL-558).
 */
export interface DatasetFieldEntry {
  id: string
  name: string
}

/**
 * Stable field id from a human name: "Roast preference" → "roast_preference".
 * Mirrors DATASET_FIELD_PATTERN; returns '' when nothing salvageable.
 */
export function slugifyDatasetFieldId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^[0-9_]+/, '')
    .replace(/_+$/, '')
  return DATASET_FIELD_PATTERN.test(slug) ? slug : ''
}

/** Display fallback for raw ids: "roast_preference" → "Roast preference". */
export function humanizeDatasetFieldId(id: string): string {
  const words = id.replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id
}

/**
 * Parses a comma/newline separated list of HUMAN field names into
 * {id, name} entries — "Roast preference" keeps its pretty name and gets
 * the stable id `roast_preference` (AGL-558). Plain snake_case keys
 * still work and pick up a humanized display name. Duplicate ids and
 * unsalvageable entries are dropped rather than failing the set.
 */
export function parseDatasetFieldEntries(input: string): DatasetFieldEntry[] {
  const seen = new Set<string>()
  const entries: DatasetFieldEntry[] = []
  for (const raw of input.split(/[,\n]/)) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const id = slugifyDatasetFieldId(trimmed)
    if (!id || seen.has(id)) continue
    seen.add(id)
    entries.push({
      id,
      name: DATASET_FIELD_PATTERN.test(trimmed)
        ? humanizeDatasetFieldId(trimmed)
        : trimmed,
    })
  }
  return entries
}

/**
 * Parses a comma/newline separated field list into valid unique names;
 * invalid entries are dropped rather than failing the whole set.
 */
export function parseDatasetFields(input: string): string[] {
  const seen = new Set<string>()
  const fields: string[] = []
  for (const raw of input.split(/[,\n]/)) {
    const name = raw.trim()
    if (!DATASET_FIELD_PATTERN.test(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    fields.push(name)
  }
  return fields
}

/** Record values restricted to the dataset's declared fields. */
export function sanitizeRecordValues(
  fields: string[],
  input: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    const value = input?.[field]
    if (value == null) continue
    values[field] = String(value)
  }
  return values
}

/**
 * Record values for a dataset write (AGL-556). With a `fieldMap`
 * (submitted key → stable model fieldId), mapped values are stored under
 * the mapped fieldId — so renamed schema fields keep receiving data — and
 * entries whose fieldId isn't in the model are dropped (the map is
 * client-supplied and never trusted). Submitted keys without a mapping
 * (and calls without a map) fall back to the legacy name-intersection
 * against the model's field ids, matching `sanitizeRecordValues`.
 */
export function buildDatasetRecordValues(
  dataset: { model?: DatasetModel; fields?: string[] },
  input: Record<string, unknown> | null | undefined,
  fieldMap?: Record<string, string> | null,
): Record<string, string> {
  const model = effectiveDatasetModel(dataset)
  const map = fieldMap ?? {}
  const values: Record<string, string> = {}
  for (const fieldId of model.order) {
    if (!model.fields[fieldId]) continue
    // A submitted key with an explicit mapping never doubles as a
    // name-match — the mapping decides where it lands.
    if (fieldId in map) continue
    const value = input?.[fieldId]
    if (value == null) continue
    values[fieldId] = String(value)
  }
  for (const [submittedKey, fieldId] of Object.entries(map)) {
    if (typeof fieldId !== 'string' || !model.fields[fieldId]) continue
    const value = input?.[submittedKey]
    if (value == null) continue
    values[fieldId] = String(value)
  }
  return values
}

/** Records sorted by their editor order (then id for stability). */
export function sortDatasetRecords<T extends HostDatasetRecord>(
  records: T[],
): T[] {
  return [...records].sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER) ||
      String(a.$id ?? '').localeCompare(String(b.$id ?? '')),
  )
}
