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
  type DatasetFieldDefinition,
  type DatasetFieldType,
  type DatasetModel,
  formatDatasetValue,
} from './dataset-models'
import { humanizeDatasetFieldId } from './datasets'

/**
 * Reading a whole record, as opposed to skimming a row of it.
 *
 * `formatDatasetValue` is the GRID formatter and is right for a grid: it
 * answers one short string per cell, and every state that has no short string
 * collapses to `''`, which the table then prints as `--`. A cell is one line
 * tall and one column wide, so that collapse is the only affordable answer.
 *
 * A record view has room to be exact, and the difference matters as soon as
 * anybody acts on what they read:
 *
 *  * A field the record does not carry AT ALL, a field storing `null`, and a
 *    field storing a real empty string are three different facts. They all
 *    format to `''` and print as `--`. "The address is blank" and "this
 *    record predates the address field" are not the same finding, and a CSV
 *    export makes the difference visible where the table did not.
 *  * A reference whose target cannot be resolved formats as the raw target
 *    ID, which is indistinguishable from a resolved reference whose label
 *    happens to look like an ID. One is a working link, the other is a
 *    dangling one — a `setNull` that never ran, a target outside the picker's
 *    window, or a record pointing at a deleted document.
 *  * `bytes` reaches `String(value)`. A `Uint8Array` prints as its comma-
 *    joined byte values and a Firestore `Bytes` prints `[object Object]`.
 *    Neither is the value; both look like one.
 *  * A `map` whose value cannot be serialized (a cycle) falls through
 *    `JSON.stringify`'s throw to `String(value)`, which is `[object Object]`
 *    again — a placeholder wearing the costume of data.
 *
 * So this module answers with a DESCRIPTOR rather than a string, and the
 * renderer decides how each state should look. Nothing here formats a value
 * a second time: a real value's text still comes from `formatDatasetValue`,
 * so the record view and the table can never disagree about one.
 */

/** What a field slot actually holds — the four "no value" states are distinct. */
export type DatasetDisplayKind =
  /** The record has no such key. */
  | 'absent'
  /** The key is present and stores `null`. */
  | 'null'
  /** A real, stored empty string. */
  | 'empty-text'
  /** A real, stored empty array. */
  | 'empty-list'
  /** A real, stored empty object. */
  | 'empty-map'
  /** A value, rendered in `text`. */
  | 'value'
  /**
   * A value that exists and cannot be shown honestly as text — binary, or a
   * structure that will not serialize. `text` says which, and says so as a
   * description of the value rather than as the value.
   */
  | 'opaque'

/** One target of a reference field, and whether it could be resolved. */
export interface DatasetDisplayReference {
  id: string
  /**
   * The target's display label, or `null` when this ID resolved to nothing.
   * An unresolved reference is not an error to hide: the ID is still shown,
   * marked as unresolved, because the ID is the only fact available.
   */
  label: string | null
}

export interface DatasetDisplayValue {
  kind: DatasetDisplayKind
  /**
   * The rendered value for `value`, and the reason for `opaque`. Empty for
   * every other kind — those carry no text of their own, and the renderer
   * supplies the placeholder so a placeholder can never be mistaken for
   * stored content.
   */
  text: string
  /**
   * Pre-formatted across several lines. Nested JSON is pretty-printed, which
   * is only readable in a block that preserves its whitespace.
   */
  block: boolean
  /** Present only for a `reference` field, one entry per target ID. */
  references?: DatasetDisplayReference[]
}

/** A field slot in a record view: what it is called, and what it holds. */
export interface DatasetRecordField {
  fieldId: string
  /** Display label — the model's name, or a humanized ID for an extra. */
  label: string
  /** The declared type; absent for a stored value the model does not declare. */
  type?: DatasetFieldType
  description?: string
  required?: boolean
  /**
   * `extra` marks a stored value with no field in the model. It is not
   * corruption and not rare: a type or field removed from a model never
   * rewrites documents (the record editor strips orphans lazily, on the next
   * save), and the import and API legs accept any key the model names at the
   * time of the write. The table cannot show these — its columns come from
   * the model — which is exactly why a record view must.
   */
  source: 'model' | 'extra'
  value: DatasetDisplayValue
}

/** Resolves one reference target to its label, or `null` when unresolved. */
export type DatasetReferenceResolver = (
  fieldId: string,
  id: string,
) => string | null

const NO_TEXT = { text: '', block: false } as const

/** Firestore `Bytes`, `Uint8Array`, `Buffer` — anything holding raw octets. */
function byteLength(value: unknown): number | null {
  if (value instanceof Uint8Array) return value.byteLength
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return value.byteLength
  }
  // Firestore's `Bytes` wrapper exposes its octets only through a method.
  const asBytes = value as { toUint8Array?: () => Uint8Array }
  if (typeof asBytes?.toUint8Array === 'function') {
    try {
      return asBytes.toUint8Array().byteLength
    } catch {
      return null
    }
  }
  return null
}

function describeBytes(value: unknown): DatasetDisplayValue {
  const length = byteLength(value)
  return {
    kind: 'opaque',
    text: length == null ? 'Binary value' : `Binary value · ${length} bytes`,
    block: false,
  }
}

/**
 * Nested structures, pretty-printed.
 *
 * A one-line `JSON.stringify` is what the table shows; a record view has the
 * height to indent it, and an indented object is the difference between
 * reading a nested value and squinting at one. A structure that will not
 * serialize is reported as such rather than falling through to
 * `String(value)`.
 */
function describeStructure(value: unknown): DatasetDisplayValue {
  try {
    const text = JSON.stringify(value, null, 2)
    // `undefined` in, `undefined` out — `JSON.stringify` answers that for a
    // function or a symbol without throwing.
    if (typeof text !== 'string') {
      return { kind: 'opaque', text: 'Value cannot be displayed', block: false }
    }
    return { kind: 'value', text, block: text.includes('\n') }
  } catch {
    // A cycle, or a `toJSON` that throws.
    return { kind: 'opaque', text: 'Value cannot be displayed', block: false }
  }
}

/**
 * The reference field's targets, each carrying whether it resolved.
 *
 * Both storage shapes flatten to the same list — a single ID string, or the
 * `sorted` array a `multiple` reference holds — because the question asked of
 * each entry is the same one.
 */
function describeReference(
  fieldId: string,
  value: unknown,
  resolve: DatasetReferenceResolver | undefined,
): DatasetDisplayValue {
  const raw = Array.isArray(value) ? value : [value]
  const references: DatasetDisplayReference[] = raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((id) => id.length > 0)
    .map((id) => ({ id, label: resolve?.(fieldId, id) ?? null }))
  if (!references.length) {
    // An array that held nothing but blanks is an empty list, not a value;
    // a non-string entry never was a reference and is reported by
    // `validateDocument`, which the record view runs alongside this.
    return { kind: Array.isArray(value) ? 'empty-list' : 'null', ...NO_TEXT }
  }
  return {
    kind: 'value',
    // The label where there is one, the bare ID where there is not. The
    // renderer marks the unresolved entries; this text is the fallback for
    // anywhere the structure is flattened, such as a copy to the clipboard.
    text: references
      .map((reference) => reference.label ?? reference.id)
      .join(', '),
    block: false,
    references,
  }
}

/**
 * What one field of one record holds, as a descriptor the renderer can be
 * honest with.
 *
 * `values` and `fieldId` are taken separately rather than as one already-read
 * value because "the key is missing" and "the key is present and empty" are
 * two of the states being distinguished, and a read value cannot tell them
 * apart.
 *
 * `field` may be undefined — a stored value the model does not declare. The
 * value is then described from its own runtime shape, since there is no
 * declared type to describe it by.
 */
export function describeDatasetValue(
  field: DatasetFieldDefinition | undefined,
  values: Record<string, unknown> | undefined,
  fieldId: string,
  resolve?: DatasetReferenceResolver,
): DatasetDisplayValue {
  const present =
    values != null &&
    Object.prototype.hasOwnProperty.call(values, fieldId) &&
    values[fieldId] !== undefined
  if (!present) return { kind: 'absent', ...NO_TEXT }
  const value = values[fieldId]
  if (value === null) return { kind: 'null', ...NO_TEXT }
  if (value === '') return { kind: 'empty-text', ...NO_TEXT }
  if (Array.isArray(value) && value.length === 0) {
    return { kind: 'empty-list', ...NO_TEXT }
  }

  if (field?.type === 'reference') {
    return describeReference(fieldId, value, resolve)
  }
  if (field?.type === 'bytes') return describeBytes(value)

  // An object with no keys is an empty map whether or not the model says
  // `map` — an undeclared field has no declared type to consult.
  const plainObject =
    typeof value === 'object' &&
    !Array.isArray(value) &&
    byteLength(value) == null
  if (plainObject && Object.keys(value as object).length === 0) {
    return { kind: 'empty-map', ...NO_TEXT }
  }
  // Raw octets stored against a field the model does not declare as `bytes`.
  if (typeof value === 'object' && byteLength(value) != null) {
    return describeBytes(value)
  }

  if (field) {
    // `map` is the only declared type `formatDatasetValue` serializes, and it
    // serializes to one line. Everything else it formats is already the short
    // form a record view wants.
    if (field.type === 'map') return describeStructure(value)
    const text = formatDatasetValue(field, value)
    // A non-empty value that formats to nothing would print as a blank line
    // and read as an empty string. `formatDatasetValue` returns `''` only for
    // the states already handled above, so this is a guard against a future
    // formatter, not a state reachable today.
    if (text === '')
      return { kind: 'opaque', text: 'Value cannot be displayed', block: false }
    return { kind: 'value', text, block: false }
  }

  // Undeclared: describe the runtime shape rather than guessing a type.
  if (typeof value === 'object') return describeStructure(value)
  if (typeof value === 'boolean') {
    return { kind: 'value', text: value ? 'true' : 'false', block: false }
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return { kind: 'value', text: String(value), block: false }
  }
  return { kind: 'opaque', text: 'Value cannot be displayed', block: false }
}

/**
 * Every field of a record, in reading order: the model's declared order
 * first, then anything the model declares but does not display, then every
 * stored value the model does not declare at all.
 *
 * The union is the point. `model.order` is what the table's columns are built
 * from, so a view built from `order` alone would be a wider row rather than
 * the record — it would silently omit a reference field declared without a
 * display slot, and every value left behind by a field the model no longer
 * has. Both are real states of a stored document, and a viewer that drops
 * them tells the reader the record is smaller than it is.
 */
export function datasetRecordFields(
  model: DatasetModel,
  values: Record<string, unknown> | undefined,
  resolve?: DatasetReferenceResolver,
): DatasetRecordField[] {
  const order = model.order ?? []
  const declared = model.fields ?? {}
  const seen = new Set<string>()
  const fields: DatasetRecordField[] = []

  const pushDeclared = (fieldId: string) => {
    if (seen.has(fieldId)) return
    const field = declared[fieldId]
    if (!field) return
    seen.add(fieldId)
    fields.push({
      fieldId,
      label: field.name || humanizeDatasetFieldId(fieldId),
      type: field.type,
      ...(field.description ? { description: field.description } : {}),
      ...(field.required || field.validation?.required
        ? { required: true }
        : {}),
      source: 'model',
      value: describeDatasetValue(field, values, fieldId, resolve),
    })
  }

  for (const fieldId of order) pushDeclared(fieldId)
  for (const fieldId of Object.keys(declared)) pushDeclared(fieldId)

  for (const fieldId of Object.keys(values ?? {})) {
    if (seen.has(fieldId)) continue
    seen.add(fieldId)
    fields.push({
      fieldId,
      label: humanizeDatasetFieldId(fieldId),
      source: 'extra',
      value: describeDatasetValue(undefined, values, fieldId, resolve),
    })
  }
  return fields
}
