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
 * A dictionary or collection variable, as rows an author fills in rather than
 * JSON they type (AGL-3757). The stored value is unchanged — the same JSON
 * string `formatVariableValue` and a function's `name.member` read — so this
 * module only translates between that string and the rows the editor shows.
 */

/** What one entry holds; `kept` is a nested value the rows cannot edit. */
export type StructuredValueKind = 'text' | 'number' | 'boolean' | 'kept'

export interface StructuredValueRow {
  /** The dictionary key; ignored for a collection. */
  key: string
  kind: StructuredValueKind
  /** Text as shown in the box; `'true'`/`'false'` for a true/false entry. */
  value: string
  /** The original nested value, carried through untouched for a `kept` row. */
  kept?: unknown
}

export interface ParsedStructuredValue {
  rows: StructuredValueRow[]
  /**
   * True when a stored value could not be read as the expected shape — an
   * old hand-typed value with a stray comma, or a list stored on a
   * dictionary. The editor starts from what it could read and says so.
   */
  unreadable: boolean
}

function rowFor(key: string, value: unknown): StructuredValueRow {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { key, kind: 'number', value: String(value) }
  }
  if (typeof value === 'boolean') {
    return { key, kind: 'boolean', value: value ? 'true' : 'false' }
  }
  if (typeof value === 'string') return { key, kind: 'text', value }
  if (value === null || value === undefined) {
    return { key, kind: 'text', value: '' }
  }
  return { key, kind: 'kept', value: JSON.stringify(value), kept: value }
}

/** The rows a stored dictionary or collection value reads as. */
export function parseStructuredValue(
  raw: string | undefined,
  shape: 'dictionary' | 'collection',
): ParsedStructuredValue {
  const text = String(raw ?? '').trim()
  if (!text) return { rows: [], unreadable: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { rows: [], unreadable: true }
  }
  if (shape === 'collection') {
    if (!Array.isArray(parsed)) return { rows: [], unreadable: true }
    return { rows: parsed.map((item) => rowFor('', item)), unreadable: false }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { rows: [], unreadable: true }
  }
  return {
    rows: Object.entries(parsed as Record<string, unknown>).map(
      ([key, value]) => rowFor(key, value),
    ),
    unreadable: false,
  }
}

/**
 * One row's stored value. A number box that does not hold a number stores
 * nothing rather than a string a calculation would then trip over.
 */
function rowValue(row: StructuredValueRow): unknown {
  switch (row.kind) {
    case 'number': {
      const text = row.value.trim()
      const parsed = Number(text)
      return text !== '' && Number.isFinite(parsed) ? parsed : null
    }
    case 'boolean':
      return row.value === 'true'
    case 'kept':
      return row.kept
    case 'text':
    default:
      return row.value
  }
}

/**
 * The JSON string rows store as. A dictionary drops rows without a key and
 * keeps the LAST row of a repeated key, as reading the JSON back would.
 */
export function serializeStructuredValue(
  rows: readonly StructuredValueRow[],
  shape: 'dictionary' | 'collection',
): string {
  if (shape === 'collection') return JSON.stringify(rows.map(rowValue))
  const entries: Record<string, unknown> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key) entries[key] = rowValue(row)
  }
  return JSON.stringify(entries)
}

/** The dictionary keys used more than once, which the editor flags. */
export function duplicateStructuredKeys(
  rows: readonly StructuredValueRow[],
): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  return duplicates
}
