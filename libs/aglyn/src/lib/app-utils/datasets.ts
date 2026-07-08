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

/** Dataset field name: starts with a letter; letters/digits/underscores. */
export const DATASET_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

export interface HostDataset {
  $id?: string
  displayName?: string
  /** Column names, in display order (v1; superseded by `model`). */
  fields?: string[]
  /** Typed model (AGL-177); when absent, derive from `fields`. */
  model?: import('./dataset-models').DatasetModel
}

export interface HostDatasetRecord {
  $id?: string
  /** Field → display value. */
  values?: Record<string, string>
  /** Row position in the editor and in repeated output. */
  order?: number
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
