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

import {
  type DatasetFieldDefinition,
  type DatasetFilterValues,
  type DatasetModel,
  datasetFilterKeys,
  datasetFilterValues,
} from './dataset-model-core'

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

export * from './dataset-model-core'

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
    // An empty list holds nothing, so it answers "required" as an empty
    // string does: `,,` typed into a list field coerces to `[]` (AGL-3496).
    const empty =
      value == null ||
      value === '' ||
      (Array.isArray(value) && !value.length && isListField(field))
    if (empty) {
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
        // A list of values: an entry that is itself an object or a list is
        // not one, and `coerceListValue` leaves it here to be refused.
        if (
          !Array.isArray(value) ||
          value.some((entry) => entry !== null && typeof entry === 'object')
        ) {
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
/**
 * Whether a field stores a list: `sorted`, and a `reference` that may point at
 * more than one record. Both go through {@link coerceListValue}.
 */
export function isListField(field: DatasetFieldDefinition): boolean {
  return (
    field.type === 'sorted' ||
    (field.type === 'reference' && Boolean(field.reference?.multiple))
  )
}

/**
 * The entries of a list given as an array, each a trimmed string with the
 * empty ones dropped — or `null` when an entry is not a scalar (an object, a
 * nested list), which is not a list of values and is left for
 * `validateDocument` to refuse rather than flattened into `[object Object]`.
 */
function listEntries(input: readonly unknown[]): string[] | null {
  const entries: string[] = []
  for (const entry of input) {
    if (entry == null) continue
    if (
      typeof entry !== 'string' &&
      typeof entry !== 'number' &&
      typeof entry !== 'boolean'
    ) {
      return null
    }
    const text = String(entry).trim()
    if (text) entries.push(text)
  }
  return entries
}

/**
 * A list field's value in storage form (AGL-3496) — the ONE coercion every
 * writer of a `sorted` or multiple-`reference` field reaches through
 * {@link coerceDocumentValues}: the console's record form and its CSV/JSON
 * import, `/api/orgs/datasets`, `/v1` record create and update, form
 * submissions and workflow steps (`prepareDatasetRecordWrite`).
 *
 * - An array is taken as the list: entries stringified and trimmed, empty
 *   ones dropped.
 * - A string that parses as a JSON array of scalars is that array. A JSON
 *   import hands a list cell over as `["Residential","Commercial"]`, and so
 *   does any API client that serialized one; split on commas, it was stored
 *   as `["[\"Residential\"", "\"Commercial\"]"]` and no filter matched it.
 *   The console form round-trips such a record too: it shows the stored
 *   fragments joined, which reads back as the JSON array, so re-saving a
 *   record written that way repairs it.
 * - Any other string is comma-separated, as typed into the form.
 * - Anything else (a number, an object, an array holding objects) passes
 *   through untouched for `validateDocument` to refuse.
 */
export function coerceListValue(raw: unknown): unknown {
  if (Array.isArray(raw)) return listEntries(raw) ?? raw
  if (typeof raw !== 'string') return raw
  const text = raw.trim()
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(text)
      const entries = Array.isArray(parsed) ? listEntries(parsed) : null
      if (entries) return entries
    } catch {
      // Bracketed but not JSON — `[draft], final` — is a comma list.
    }
  }
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

const BOOL_TRUE_WORDS = new Set(['true', 'yes', 'on', '1'])
const BOOL_FALSE_WORDS = new Set(['false', 'no', 'off', '0'])

/**
 * Coerces user-input strings (form fields, CSV cells) into storage form
 * per the field type. Unparseable input is passed through untouched so
 * `validateDocument` reports it instead of silently mangling it.
 *
 * A list field is coerced whatever shape it arrives in — array or string —
 * through {@link coerceListValue}; every other non-string value is already
 * in storage form and passes through.
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
    if (isListField(field)) {
      values[fieldId] = coerceListValue(raw)
      continue
    }
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
      case 'map':
        try {
          values[fieldId] = JSON.parse(raw)
        } catch {
          values[fieldId] = raw
        }
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
