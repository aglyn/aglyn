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

import type { RepeatRowsModel } from '@aglyn/aglyn/app-utils/expand-repeatables'
import { validateCustomFieldValue } from '@aglyn/aglyn/plugin-manager/custom-fields'

/**
 * Dataset models (AGL-177): the runtime promotion of the type-level
 * blueprint in `libs/shared/data/types/src/lib/dod.ts` (kept as the
 * referenced design doc — this module is the single runtime source of
 * truth). A model lives on the dataset doc
 * (`orgs/{orgId}/datasets/{id}.model`) and drives the typed editor, import
 * and site-restore validation, and every record write — the console, `/v1`,
 * a bound form's submission and an automation step — through the shared
 * `validateDocument`/`coerceDocumentValues` pair so they can't disagree. The
 * form and the automation step reach the pair through
 * `prepareDatasetRecordWrite` (AGL-2773).
 *
 * Storage conventions (Firestore-safe): timestamps as epoch millis
 * numbers, coordinates as `{ latitude, longitude }`, `sorted` as arrays,
 * `map` as plain objects, references as target-document id strings.
 */

/**
 * A human field entry from the quick creator: the stable id plus the
 * display name shown in table headers and bindings pickers (AGL-558).
 */
export interface DatasetFieldEntry {
  id: string
  name: string
}

/** Display fallback for raw ids: "roast_preference" → "Roast preference". */
export function humanizeDatasetFieldId(id: string): string {
  const words = id.replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id
}

/** dod.ts `FT.Tag` vocabulary plus `reference` (AGL-180 builds on it). */
export type DatasetFieldType =
  | 'bool'
  | 'bytes'
  | 'timestamp'
  | 'float'
  | 'int32'
  | 'int64'
  | 'nil'
  | 'text'
  | 'coordinates'
  | 'map'
  | 'sorted'
  | 'reference'

export const DATASET_FIELD_TYPES: DatasetFieldType[] = [
  'text',
  'bool',
  'int32',
  'int64',
  'float',
  'timestamp',
  'coordinates',
  'map',
  'sorted',
  'bytes',
  'nil',
  'reference',
]

/** Display names, mirroring dod.ts `lbl`. */
export const DATASET_FIELD_TYPE_LABELS: Record<DatasetFieldType, string> = {
  text: 'Text',
  bool: 'Boolean',
  int32: 'Integer',
  int64: 'Big integer',
  float: 'Number',
  timestamp: 'Date & time',
  coordinates: 'Coordinates',
  map: 'Map',
  sorted: 'List',
  bytes: 'Bytes',
  nil: 'Null',
  reference: 'Reference',
}

/**
 * Plain-JSON validation vocabulary (the dod.ts `Eval` shape, extended
 * with min/max and options, serialized flat instead of enum-keyed).
 */
export interface DatasetFieldValidation {
  required?: boolean
  /** Source of a RegExp applied to text values. */
  regex?: string
  /** Numbers/timestamps: value bound. Text: length bound. */
  min?: number
  max?: number
  /** Enum: value must be one of these (text fields). */
  options?: string[]
}

export interface DatasetFieldDefinition {
  /**
   * Human-facing display label only. The stable reference id is the KEY in
   * `DatasetModel.fields` (and `order`), NOT this name — bindings resolve
   * `{{item.<fieldId>}}` against that key. The default id is derived from
   * this name once at creation but is user-overridable (AGL-578); renaming
   * the label afterwards never changes the id.
   */
  name: string
  type: DatasetFieldType
  /**
   * Plugin-declared custom type riding this base type (AGL-434) — see
   * plugin-manager/custom-fields. Unknown names degrade to the base type.
   */
  customType?: string
  /**
   * A page-address field's source (AGL-3475): the field an EMPTY address
   * fills in from, once — see `fillRecordAddresses` in `record-pages`.
   * Meaningful only on a field of the page-address custom type.
   */
  slugFrom?: string
  description?: string
  required?: boolean
  /** Default applied by editors when creating documents; never coerced. */
  default?: unknown
  validation?: DatasetFieldValidation
  /**
   * Reference fields (AGL-180): target collection + display field id.
   * `multiple` stores a `sorted` array of FKeys (small-cardinality
   * many-to-many per the dod.ts guidance); `onDelete` is the referenced-
   * document delete policy (default `setNull` — never cascade in v2).
   */
  reference?: {
    datasetId: string
    displayFieldId?: string
    multiple?: boolean
    onDelete?: 'restrict' | 'setNull'
  }
}

export interface DatasetModel {
  fields: Record<string, DatasetFieldDefinition>
  /** Field ids in display order. */
  order: string[]
}

/**
 * Migration shim (v1 → v2): datasets created before models carry flat
 * `fields: string[]` — derive a model where every column is an optional
 * text field whose id is the column name, so the editor and AGL-103
 * bindings keep working on unmigrated docs during rollout.
 */
export function deriveModelFromFields(fields: string[]): DatasetModel {
  const model: DatasetModel = { fields: {}, order: [] }
  for (const name of fields) {
    // Raw snake_case ids read as titles in table headers and pickers;
    // the id stays the stable key (AGL-558).
    model.fields[name] = { name: humanizeDatasetFieldId(name), type: 'text' }
    model.order.push(name)
  }
  return model
}

/**
 * Model from quick-creator entries (AGL-558): stable slug ids with the
 * human display names preserved — "Roast preference" → id
 * `roast_preference`, name "Roast preference".
 */
export function modelFromFieldEntries(
  entries: readonly DatasetFieldEntry[],
): DatasetModel {
  const model: DatasetModel = { fields: {}, order: [] }
  for (const entry of entries) {
    model.fields[entry.id] = { name: entry.name, type: 'text' }
    model.order.push(entry.id)
  }
  return model
}

/**
 * The part of a dataset's model a repeat reads (AGL-180): each reference
 * field, by the id of the dataset it points into, which is a key the rows map
 * answers under. Every field the model declares, in `order` or not — a hop
 * resolves wherever its target's rows were loaded.
 */
export function repeatRowsModelOf(model: DatasetModel): RepeatRowsModel {
  const references: Record<string, string> = {}
  for (const [fieldId, field] of Object.entries(model.fields)) {
    const target = field?.type === 'reference' ? field.reference?.datasetId : undefined
    if (target) references[fieldId] = target
  }
  return { references }
}

/** The dataset's model, deriving one from v1 `fields` when absent. */
export function effectiveDatasetModel(dataset: {
  model?: DatasetModel
  fields?: string[]
}): DatasetModel {
  if (dataset.model?.fields && dataset.model.order?.length) {
    return dataset.model
  }
  return deriveModelFromFields(dataset.fields ?? [])
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * Validates a document's values against a model, returning fieldId →
 * human-readable error (empty object = valid). Values are expected in
 * storage form (see the module doc); use `coerceDocumentValues` first
 * when starting from user input strings.
 */
export function validateDocument(
  model: DatasetModel,
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const fieldId of model.order) {
    const field = model.fields[fieldId]
    if (!field) continue
    const value = values[fieldId]
    const required = field.required || field.validation?.required
    if (value == null || value === '') {
      if (required) errors[fieldId] = `${field.name} is required`
      continue
    }
    const rules = field.validation ?? {}
    switch (field.type) {
      case 'text': {
        if (typeof value !== 'string') {
          errors[fieldId] = `${field.name} must be text`
          break
        }
        if (rules.min != null && value.length < rules.min) {
          errors[fieldId] = `${field.name} must be at least ${rules.min} characters`
        } else if (rules.max != null && value.length > rules.max) {
          errors[fieldId] = `${field.name} must be at most ${rules.max} characters`
        } else if (rules.regex) {
          try {
            if (!new RegExp(rules.regex).test(value)) {
              errors[fieldId] = `${field.name} has an invalid format`
            }
          } catch {
            // Broken pattern in the model never blocks writes.
          }
        }
        if (
          !errors[fieldId] &&
          rules.options?.length &&
          !rules.options.includes(value)
        ) {
          errors[fieldId] = `${field.name} must be one of: ${rules.options.join(', ')}`
        }
        break
      }
      case 'bool':
        if (typeof value !== 'boolean') {
          errors[fieldId] = `${field.name} must be true or false`
        }
        break
      case 'int32':
      case 'int64':
        if (!isFiniteNumber(value) || !Number.isInteger(value)) {
          errors[fieldId] = `${field.name} must be a whole number`
          break
        }
        if (rules.min != null && value < rules.min) {
          errors[fieldId] = `${field.name} must be ≥ ${rules.min}`
        } else if (rules.max != null && value > rules.max) {
          errors[fieldId] = `${field.name} must be ≤ ${rules.max}`
        }
        break
      case 'float':
      case 'timestamp':
        if (!isFiniteNumber(value)) {
          errors[fieldId] =
            field.type === 'timestamp'
              ? `${field.name} must be a date`
              : `${field.name} must be a number`
          break
        }
        if (rules.min != null && value < rules.min) {
          errors[fieldId] = `${field.name} must be ≥ ${rules.min}`
        } else if (rules.max != null && value > rules.max) {
          errors[fieldId] = `${field.name} must be ≤ ${rules.max}`
        }
        break
      case 'coordinates': {
        const coordinates = value as { latitude?: unknown; longitude?: unknown }
        if (
          !isFiniteNumber(coordinates?.latitude) ||
          !isFiniteNumber(coordinates?.longitude) ||
          Math.abs(coordinates.latitude) > 90 ||
          Math.abs(coordinates.longitude) > 180
        ) {
          errors[fieldId] = `${field.name} must be valid coordinates`
        }
        break
      }
      case 'sorted':
        if (!Array.isArray(value)) {
          errors[fieldId] = `${field.name} must be a list`
        }
        break
      case 'map':
        if (typeof value !== 'object' || Array.isArray(value)) {
          errors[fieldId] = `${field.name} must be a map`
        }
        break
      case 'reference':
        if (field.reference?.multiple) {
          if (
            !Array.isArray(value) ||
            value.some((entry) => typeof entry !== 'string' || !entry)
          ) {
            errors[fieldId] = `${field.name} must reference documents`
          }
        } else if (typeof value !== 'string' || !value) {
          errors[fieldId] = `${field.name} must reference a document`
        }
        break
      case 'bytes':
      case 'nil':
        break
    }
  }
  // Custom field types (AGL-434): plugin validators run after the base
  // checks, only on fields that passed them.
  for (const fieldId of model.order) {
    const field = model.fields[fieldId]
    if (!field?.customType || errors[fieldId]) continue
    const customError = validateCustomFieldValue(
      field.customType,
      values[fieldId],
    )
    if (customError) errors[fieldId] = `${field.name}: ${customError}`
  }
  return errors
}

/** Storage value → grid display string (AGL-179). */
export function formatDatasetValue(
  field: DatasetFieldDefinition,
  value: unknown,
): string {
  if (value == null || value === '') return ''
  switch (field.type) {
    case 'bool':
      return value === true ? '✓' : value === false ? '—' : String(value)
    case 'timestamp':
      return isFiniteNumber(value)
        ? new Date(value).toISOString().slice(0, 16).replace('T', ' ')
        : String(value)
    case 'coordinates': {
      const coordinates = value as { latitude?: number; longitude?: number }
      return isFiniteNumber(coordinates?.latitude) &&
        isFiniteNumber(coordinates?.longitude)
        ? `${coordinates.latitude}, ${coordinates.longitude}`
        : String(value)
    }
    case 'sorted':
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
 * Storage value → form-input string (AGL-179): the inverse of
 * `coerceDocumentValues` for populating type-appropriate inputs
 * (timestamps as `datetime-local` values, coordinates as "lat, lon").
 */
export function datasetValueToInput(
  field: DatasetFieldDefinition,
  value: unknown,
): string {
  if (value == null) return ''
  if (field.type === 'timestamp' && isFiniteNumber(value)) {
    return new Date(value).toISOString().slice(0, 16)
  }
  if (field.type === 'bool') {
    return value === true ? 'true' : value === false ? 'false' : String(value)
  }
  if (field.type === 'coordinates' || field.type === 'sorted') {
    return formatDatasetValue(field, value)
  }
  if (field.type === 'map') return formatDatasetValue(field, value)
  return String(value)
}

const BOOL_TRUE_WORDS = new Set(['true', 'yes', 'on', '1'])
const BOOL_FALSE_WORDS = new Set(['false', 'no', 'off', '0'])

/**
 * Coerces user-input strings (form fields, CSV cells) into storage form
 * per the field type. Unparseable input is passed through untouched so
 * `validateDocument` reports it instead of silently mangling it.
 */
export function coerceDocumentValues(
  model: DatasetModel,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const fieldId of model.order) {
    const field = model.fields[fieldId]
    const raw = input[fieldId]
    if (!field || raw == null || raw === '') continue
    if (typeof raw !== 'string') {
      values[fieldId] = raw
      continue
    }
    switch (field.type) {
      case 'bool': {
        // The words a form control or a CSV cell says yes and no with: a
        // lone checkbox posts `on`, a spreadsheet exports `TRUE` or `1`.
        const word = raw.trim().toLowerCase()
        values[fieldId] = BOOL_TRUE_WORDS.has(word)
          ? true
          : BOOL_FALSE_WORDS.has(word)
            ? false
            : raw
        break
      }
      case 'int32':
      case 'int64': {
        const parsed = Number(raw)
        values[fieldId] = Number.isInteger(parsed) ? parsed : raw
        break
      }
      case 'float': {
        const parsed = Number(raw)
        values[fieldId] = Number.isFinite(parsed) ? parsed : raw
        break
      }
      case 'timestamp': {
        const millis = Date.parse(raw)
        values[fieldId] = Number.isFinite(millis) ? millis : raw
        break
      }
      case 'coordinates': {
        const [latitude, longitude] = raw.split(',').map((part) => Number(part.trim()))
        values[fieldId] =
          Number.isFinite(latitude) && Number.isFinite(longitude)
            ? { latitude, longitude }
            : raw
        break
      }
      case 'sorted':
        values[fieldId] = raw
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
        break
      case 'map':
        try {
          values[fieldId] = JSON.parse(raw)
        } catch {
          values[fieldId] = raw
        }
        break
      case 'reference':
        values[fieldId] = field.reference?.multiple
          ? raw
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)
          : raw
        break
      default:
        values[fieldId] = raw
    }
  }
  return values
}

/**
 * Every reference id a record holds, flattened out of its `reference` fields
 * into one de-duplicated list.
 *
 * A reference field stores either a single target id or — when
 * `reference.multiple` is set — an array of them, and a model may declare
 * several. Both shapes flatten into the same list because the question asked
 * of it is never "which field", it is "does this record still point at that
 * document".
 *
 * Fields are read from `order` UNIONED with the keys of `fields`. Every other
 * pass over a model walks `order` alone, which is right for anything the user
 * sees — but a reference declared without a display slot still holds a real
 * FKey, and an integrity index that skipped it would under-report.
 */
export function datasetReferencedIds(
  model: DatasetModel,
  values: Record<string, unknown> | undefined,
): string[] {
  const ids = new Set<string>()
  const fieldIds = new Set([
    ...(model.order ?? []),
    ...Object.keys(model.fields ?? {}),
  ])
  for (const fieldId of fieldIds) {
    if (model.fields?.[fieldId]?.type !== 'reference') continue
    const stored = values?.[fieldId]
    for (const entry of Array.isArray(stored) ? stored : [stored]) {
      const id = typeof entry === 'string' ? entry.trim() : ''
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

/**
 * The integrity index a record write carries, so referential integrity can be
 * decided by a QUERY rather than by the rows a listener happened to fetch.
 *
 * Deleting a record has to answer "is anything still pointing at this?", and
 * `restrict` refuses the delete on a yes while `setNull` strips the FKey. That
 * question cannot be asked where the answer is stored: dataset fields are
 * user-defined, so `records.values` carries a deliberate index exemption in
 * `cloud/firebase-firestore.indexes.json` — auto-indexing an unbounded map
 * blows Firestore's per-document index-entry limit — and
 * `where('values.<fieldId>', '==', id)` is therefore FAILED_PRECONDITION.
 * Reading a page of records and filtering them in the browser answers only for
 * the rows in that page, which is a browse window standing in for a
 * correctness check: a reference held outside it reads as no reference at all,
 * the delete proceeds, and `restrict` silently fails to restrict.
 *
 * `referencedIds` is that same reference, denormalized to a top-level array
 * Firestore will index, so one `array-contains` reaches every record.
 *
 * ⚠️ OMITTED when a record references nothing, rather than written as `[]`.
 * `isNotEmpty` is served as `!= null` and an empty array is not null, so a
 * record stamped `[]` answers "holds a reference" for a dataset that holds
 * none.
 *
 * ⚠️ Spread this at EVERY write that sets a record's `values`. A write that
 * sets values without it leaves the index describing the PREVIOUS values, and
 * a stale integrity index is the exact failure it exists to prevent — with the
 * UI reporting the record as safe to delete. On a merging write use
 * `datasetIntegrityUpdate` instead: omission leaves a stale array in place
 * where clearing the last reference has to remove the field.
 */
export function datasetIntegrityFields(
  model: DatasetModel,
  values: Record<string, unknown> | undefined,
): {
  referencedIds?: string[]
  filterKeys?: string[]
  filterValues?: DatasetFilterValues
} {
  const referencedIds = datasetReferencedIds(model, values)
  // The records table's filter fields (`datasetFilterKeys`,
  // `datasetFilterValues`) travel on the same writes for the same reason: a
  // record written without them is invisible to every filter the query
  // serves. Omitted when empty, like `referencedIds`.
  const filterKeys = datasetFilterKeys(model, values)
  const filterValues = datasetFilterValues(model, values)
  return {
    ...(referencedIds.length ? { referencedIds } : {}),
    ...(filterKeys.length ? { filterKeys } : {}),
    ...(Object.keys(filterValues).length ? { filterValues } : {}),
  }
}

/**
 * `datasetIntegrityFields` for a MERGING write (`update`, `set` with
 * `mergeFields`), where leaving the field out preserves what is stored
 * rather than clearing it.
 *
 * A record whose last reference is cleared has to have the field REMOVED, or
 * it goes on answering the `array-contains` for a document it no longer points
 * at — a `restrict` that refuses a delete nothing is holding. `clear` is the
 * caller's delete sentinel: `deleteField()` in the web SDK,
 * `FieldValue.delete()` in the Admin SDK. It is passed in rather than imported
 * because this module is shared by both and must stay SDK-free. The filter
 * fields are cleared the same way, so a record emptied of every filterable
 * value stops answering the filters its old values did.
 *
 * ⚠️ `filterValues` is a MAP, and it is written WHOLE: `update` and
 * `mergeFields` replace a field outright, so a value cleared since the last
 * write leaves the map with it. `set(…, { merge: true })` does NOT — it merges
 * maps key by key and would keep the cleared value answering its old
 * equality — so a record write never uses it; list the fields in
 * `mergeFields` instead.
 */
export function datasetIntegrityUpdate<TClear>(
  model: DatasetModel,
  values: Record<string, unknown> | undefined,
  clear: TClear,
): {
  referencedIds: string[] | TClear
  filterKeys: string[] | TClear
  filterValues: DatasetFilterValues | TClear
} {
  const referencedIds = datasetReferencedIds(model, values)
  const filterKeys = datasetFilterKeys(model, values)
  const filterValues = datasetFilterValues(model, values)
  return {
    referencedIds: referencedIds.length ? referencedIds : clear,
    filterKeys: filterKeys.length ? filterKeys : clear,
    filterValues: Object.keys(filterValues).length ? filterValues : clear,
  }
}

/**
 * A dataset record's FILTER TOKENS: every word-level question the records
 * table can ask of a record, flattened into one array of strings Firestore
 * indexes on its own. Its twin, {@link datasetFilterValues}, holds the
 * equalities.
 *
 * ## Why these fields, and not the values
 *
 * A record's fields live under `values`, a user-defined, unbounded map that
 * the index configuration exempts from indexing — auto-indexing it can exceed
 * Firestore's per-document index-entry limit — so `where('values.<field>', …)`
 * is refused. A composite index per dataset would need an admin call per
 * dataset, runs into the project's composite-index cap, and is deleted by the
 * next `firestore:indexes` deploy of a file that does not list it.
 *
 * `filterKeys` and `filterValues` need none of that. Firestore's AUTOMATIC
 * single-field indexes serve `where('filterKeys', 'array-contains', token)`
 * and `where('filterValues.<field>', '==', value)`, and every automatic index
 * ends in the document name — so any number of those equalities and ONE
 * `array-contains`, under `orderBy(documentId())`, compose by index merging,
 * with no composite index and no index deploy, on any dataset of any project
 * (AGL-3321).
 *
 * ## The token grammar
 *
 *   `f:<fieldId>=<value>`   a field equals a value. Enum (a text field with
 *                           `validation.options`) values are kept exactly;
 *                           plain text is lower-cased, trimmed and clipped to
 *                           {@link DATASET_FILTER_VALUE_MAX} characters;
 *                           booleans are `true`/`false`; numbers are
 *                           `String(number)`; a `sorted` list contributes one
 *                           token per member.
 *   `f:<fieldId>^<prefix>`  a word of a plain text field starts with this.
 *   `s:<prefix>`            a word of ANY text value (enums and list members
 *                           included) starts with this — the quick search.
 *
 * Timestamps, references, maps, bytes, coordinates and nil fields carry no
 * field tokens: a timestamp is asked in ranges, which one token cannot serve,
 * and the rest are not asked about by value.
 *
 * The array is sorted, de-duplicated and capped at
 * {@link DATASET_FILTER_KEYS_MAX}. Past the cap, the `=` tokens are kept
 * first, then the per-field word prefixes, then the search prefixes, so a
 * very long record loses search reach before it loses exact matches.
 */
export const DATASET_FILTER_KEYS_MAX = 500

/** Plain text values are clipped to this many characters in an `=` token. */
export const DATASET_FILTER_VALUE_MAX = 64
/** Word prefixes run from 1 to this many characters. */
export const DATASET_FILTER_PREFIX_MAX = 12
/** Only the first this-many words of a value contribute prefixes. */
export const DATASET_FILTER_WORDS_MAX = 40

/** One clause of the records table's filter: `{ field, op, value }`. */
export interface DatasetFilterClause {
  field: string
  op: string
  value: string
}

/**
 * The words of a text value: split on anything that is not a letter or a
 * digit, lower-cased, at most {@link DATASET_FILTER_WORDS_MAX} of them.
 */
export function datasetFilterWords(text: string): string[] {
  return String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, DATASET_FILTER_WORDS_MAX)
}

/** A word's prefixes, 1 to {@link DATASET_FILTER_PREFIX_MAX} characters. */
function prefixes(word: string): string[] {
  const chars = Array.from(word).slice(0, DATASET_FILTER_PREFIX_MAX)
  return chars.map((_char, at) => chars.slice(0, at + 1).join(''))
}

/** A word clipped the way its stored prefixes are. */
function clipWord(word: string): string {
  return Array.from(word).slice(0, DATASET_FILTER_PREFIX_MAX).join('')
}

const isEnum = (field: DatasetFieldDefinition): boolean =>
  field.type === 'text' && (field.validation?.options?.length ?? 0) > 0

const isNumeric = (field: DatasetFieldDefinition): boolean =>
  field.type === 'int32' || field.type === 'int64' || field.type === 'float'

/**
 * A stored value as text, or null. Numbers are accepted because a form or an
 * automation stores every value as text and an import may do the reverse.
 */
function asText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/**
 * Plain text as its stored key — its `=` token's value and its
 * `filterValues` entry: lower-cased, trimmed, clipped to
 * {@link DATASET_FILTER_VALUE_MAX} characters. What the records table asks a
 * typed value to equal.
 */
export function datasetFilterTextKey(value: string): string {
  return Array.from(value.trim().toLowerCase())
    .slice(0, DATASET_FILTER_VALUE_MAX)
    .join('')
}
const textKey = datasetFilterTextKey

/** A stored number (or its text form) as its `=` token's value. */
function numberKey(value: unknown): string | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  return Number.isFinite(number) ? String(number) : null
}

/** A stored boolean (or its text form) as its `=` token's value. */
function boolKey(value: unknown): string | null {
  if (typeof value === 'boolean') return String(value)
  if (value === 'true' || value === 'false') return value
  return null
}

/** Every field a model declares, in display order and then the rest. */
function modelFieldIds(model: DatasetModel): string[] {
  return [...new Set([...(model.order ?? []), ...Object.keys(model.fields ?? {})])]
}

/** The tokens described in {@link DATASET_FILTER_KEYS_MAX}'s comment. */
export function datasetFilterKeys(
  model: DatasetModel,
  values: Record<string, unknown> | undefined,
): string[] {
  const exact: string[] = []
  const fieldWords: string[] = []
  const search: string[] = []
  const searchable = (text: string) => {
    for (const word of datasetFilterWords(text)) {
      for (const prefix of prefixes(word)) search.push(`s:${prefix}`)
    }
  }
  for (const fieldId of modelFieldIds(model)) {
    const field = model.fields?.[fieldId]
    const stored = values?.[fieldId]
    if (!field || stored == null) continue
    if (field.type === 'text') {
      const text = asText(stored)
      if (text == null || !text.trim()) continue
      if (isEnum(field)) {
        exact.push(`f:${fieldId}=${text}`)
      } else {
        exact.push(`f:${fieldId}=${textKey(text)}`)
        for (const word of datasetFilterWords(text)) {
          for (const prefix of prefixes(word)) {
            fieldWords.push(`f:${fieldId}^${prefix}`)
          }
        }
      }
      searchable(text)
    } else if (field.type === 'bool') {
      const key = boolKey(stored)
      if (key) exact.push(`f:${fieldId}=${key}`)
    } else if (isNumeric(field)) {
      const key = numberKey(stored)
      if (key) exact.push(`f:${fieldId}=${key}`)
    } else if (field.type === 'sorted') {
      for (const member of Array.isArray(stored) ? stored : [stored]) {
        const text = asText(member)?.trim()
        if (!text) continue
        exact.push(`f:${fieldId}=${text}`)
        searchable(text)
      }
    }
  }
  const kept = [...new Set([...exact, ...fieldWords, ...search])].slice(
    0,
    DATASET_FILTER_KEYS_MAX,
  )
  return kept.sort()
}

/** A record's `filterValues`: field id → the value an equality asks for. */
export type DatasetFilterValues = Record<string, string | number | boolean>

/**
 * Field ids a query can name as `filterValues.<id>`. A path string splits on
 * `.`, and the SDKs refuse `~ * / [ ]` in one; the model editor allows only
 * letters, digits and underscores, but a v1 dataset's column names were
 * never checked. Backticks are refused too, as the escape a path would need.
 */
const FILTER_VALUE_ID = /^[^.~*/[\]`]+$/

/**
 * The query path of a field's `filterValues` entry, or null for a field id
 * no path can name — such a field is stamped no entry, and the records table
 * offers it no equality (its `contains`, served by `filterKeys`, stands).
 */
export function datasetFilterValuePath(fieldId: string): string | null {
  return FILTER_VALUE_ID.test(fieldId) && !/^__.*__$/.test(fieldId)
    ? `filterValues.${fieldId}`
    : null
}

/**
 * A dataset record's FILTER VALUES: `{ [fieldId]: value }`, one scalar per
 * field an equality can be asked of, so the records table puts every
 * equality on its query (AGL-3321).
 *
 *   enum text (`validation.options`)  the value exactly, as its `=` token;
 *   plain text                        {@link datasetFilterTextKey};
 *   bool                              a boolean;
 *   int32 / int64 / float             a number.
 *
 * A form or an automation stores every value as text, so `'19.50'` is the
 * number 19.5 and `'true'` the boolean, as in {@link datasetFilterKeys}.
 * Fields with no value, and timestamps, lists, references, maps, bytes,
 * coordinates and nil fields, carry no entry: a list is asked by member
 * (`f:<id>=<member>` in `filterKeys`), and the rest are not asked about by
 * value.
 *
 * ## What it costs
 *
 * Unlike `values`, this map is NOT exempt from indexing — that is its whole
 * point. Each entry is a scalar and costs two automatic index entries
 * (ascending, descending), so a record costs at most two per model field —
 * bounded by the model's field count (the `/v1` API caps a model at 100
 * fields), far inside Firestore's 40,000 entries per document, where
 * `values` was unbounded because a `map` or `sorted` value may hold anything.
 */
export function datasetFilterValues(
  model: DatasetModel,
  values: Record<string, unknown> | undefined,
): DatasetFilterValues {
  const out: DatasetFilterValues = {}
  for (const fieldId of modelFieldIds(model)) {
    const field = model.fields?.[fieldId]
    const stored = values?.[fieldId]
    if (!field || stored == null || !datasetFilterValuePath(fieldId)) continue
    if (field.type === 'text') {
      const text = asText(stored)
      if (text == null || !text.trim()) continue
      out[fieldId] = isEnum(field) ? text : textKey(text)
    } else if (field.type === 'bool') {
      const key = boolKey(stored)
      if (key) out[fieldId] = key === 'true'
    } else if (isNumeric(field)) {
      const key = numberKey(stored)
      if (key) out[fieldId] = Number(key)
    }
  }
  return out
}

/**
 * The `filterKeys` token a word-level clause asks for, or null when it is
 * not one:
 *
 *  - plain text `contains` → the `^` token of the value's FIRST word, so a
 *    `contains` is a word-prefix match, not a mid-string one, and one word
 *    of several is asked (the records table says so);
 *  - list `contains` (and `equals`) → the member's `=` token;
 *  - enum, boolean, number and plain text `equals` → the `=` token of the
 *    value. The records table asks these of `filterValues` instead, which
 *    composes with a `contains`; the token remains what the quick search and
 *    older readers match.
 *  - everything else — ranges, dates, `isEmpty`, `isAnyOf`, negations — null.
 *
 * `clause.field` is the field id. The operator names are the grid's: a
 * select's `equals`, a number's `=`, a boolean's `is`, a list's `contains`.
 */
export function datasetFilterToken(
  model: DatasetModel,
  clause: DatasetFilterClause,
): string | null {
  const field = model.fields?.[clause.field]
  if (!field) return null
  const { op } = clause
  const value = String(clause.value ?? '')
  if (!value.trim()) return null
  const equals = op === 'equals' || op === '=' || op === 'is'
  if (field.type === 'text') {
    if (isEnum(field)) return equals ? `f:${clause.field}=${value}` : null
    if (equals) return `f:${clause.field}=${textKey(value)}`
    if (op === 'contains') {
      const [first] = datasetFilterWords(value)
      return first ? `f:${clause.field}^${clipWord(first)}` : null
    }
    return null
  }
  if (field.type === 'bool') {
    const key = boolKey(value.trim())
    return equals && key ? `f:${clause.field}=${key}` : null
  }
  if (isNumeric(field)) {
    const key = numberKey(value)
    return equals && key ? `f:${clause.field}=${key}` : null
  }
  if (field.type === 'sorted') {
    return equals || op === 'contains' ? `f:${clause.field}=${value.trim()}` : null
  }
  return null
}

/**
 * The quick-search token for one typed word, or null for a word with no
 * letters or digits. A word with punctuation inside it is asked by its first
 * run — split the search text with {@link datasetFilterWords} to ask for
 * every run.
 */
export function datasetSearchToken(word: string): string | null {
  const [first] = datasetFilterWords(word)
  return first ? `s:${clipWord(first)}` : null
}
