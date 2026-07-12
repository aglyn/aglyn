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

import { validateCustomFieldValue } from '../plugin-manager/custom-fields'

/**
 * Dataset models (AGL-177): the runtime promotion of the type-level
 * blueprint in `libs/shared/data/types/src/lib/dod.ts` (kept as the
 * referenced design doc — this module is the single runtime source of
 * truth). A model lives on the dataset doc
 * (`hosts/{hostId}/datasets/{id}.model`) and drives the typed editor,
 * import validation, and any server-side writes through the shared
 * `validateDocument`/`coerceDocumentValues` pair so they can't disagree.
 *
 * Storage conventions (Firestore-safe): timestamps as epoch millis
 * numbers, coordinates as `{ latitude, longitude }`, `sorted` as arrays,
 * `map` as plain objects, references as target-document id strings.
 */

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
  /** Display name; doubles as the binding key for `{{item.name}}`. */
  name: string
  type: DatasetFieldType
  /**
   * Plugin-declared custom type riding this base type (AGL-434) — see
   * plugin-manager/custom-fields. Unknown names degrade to the base type.
   */
  customType?: string
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
    model.fields[name] = { name, type: 'text' }
    model.order.push(name)
  }
  return model
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
      case 'bool':
        values[fieldId] =
          raw === 'true' ? true : raw === 'false' ? false : raw
        break
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
