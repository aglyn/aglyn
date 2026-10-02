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
 * Datasets (AGL-102): tabular data at `orgs/{orgId}/datasets/{id}` with a
 * `records` subcollection, edited in the console Data card and consumed by
 * repeatable components (AGL-103) via `{{item.field}}` bindings.
 */

import type { ScopeToken } from '@aglyn/aglyn/foundation/definitions/platform.types'
import {
  coerceDocumentValues,
  type DatasetFieldEntry,
  type DatasetModel,
  effectiveDatasetModel,
  humanizeDatasetFieldId,
  validateDocument,
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
  /**
   * Which sites may see this dataset (AGL-1037). Absent = org-wide, until
   * the AGL-1040 backfill stamps it. See `app-utils/scope-tokens`.
   */
  visibleTo?: ScopeToken[]
}

export interface HostDatasetRecord {
  $id?: string
  /**
   * Field → value, in storage form per the field's type (see
   * `dataset-models`). Rows written by a form or an automation step before
   * AGL-2773 hold every value as text; readers accept both.
   */
  values?: Record<string, unknown>
  /** Row position in the editor and in repeated output. */
  order?: number
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

/**
 * Default reference id for a new field (AGL-578): the `slugifyDatasetFieldId`
 * slug, suffixed (`_2`, `_3`, …) to stay unique within the dataset. `taken`
 * holds the ids already in use (compared case-insensitively). Returns '' when
 * the name yields nothing valid. The user can override the result.
 */
export function defaultDatasetFieldId(
  name: string,
  taken: ReadonlySet<string>,
): string {
  const base = slugifyDatasetFieldId(name)
  if (!base) return ''
  const used = new Set([...taken].map((id) => id.toLowerCase()))
  let candidate = base
  let suffix = 2
  while (used.has(candidate.toLowerCase())) candidate = `${base}_${suffix++}`
  return candidate
}

/**
 * Validate a user-entered reference id (AGL-578): non-empty, matches
 * `DATASET_FIELD_PATTERN`, and unique within the dataset (`taken` = ids already
 * used, compared case-insensitively). Returns an error message, or null when
 * the id is usable.
 */
export function validateDatasetFieldId(
  id: string,
  taken: ReadonlySet<string>,
): string | null {
  const trimmed = id.trim()
  if (!trimmed) return 'A reference ID is required'
  if (!DATASET_FIELD_PATTERN.test(trimmed))
    return 'Start with a letter; use only letters, numbers, and underscores'
  const used = new Set([...taken].map((existing) => existing.toLowerCase()))
  if (used.has(trimmed.toLowerCase()))
    return 'Another field already uses this reference ID'
  return null
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
 * The submitted values a dataset write would store, picked by field id and
 * left as they arrived (AGL-556). With a `fieldMap` (submitted key → stable
 * model fieldId), mapped values land under the mapped fieldId — so renamed
 * schema fields keep receiving data — and entries whose fieldId isn't in the
 * model are dropped. Submitted keys without a mapping (and calls without a
 * map) fall back to the legacy name-intersection against the model's field
 * ids, matching `sanitizeRecordValues`.
 */
export function pickDatasetRecordInput(
  dataset: { model?: DatasetModel; fields?: string[] },
  input: Record<string, unknown> | null | undefined,
  fieldMap?: Record<string, string> | null,
): Record<string, unknown> {
  const model = effectiveDatasetModel(dataset)
  const map = fieldMap ?? {}
  const values: Record<string, unknown> = {}
  for (const fieldId of model.order) {
    if (!model.fields[fieldId]) continue
    // A submitted key with an explicit mapping never doubles as a
    // name-match — the mapping decides where it lands.
    if (fieldId in map) continue
    const value = input?.[fieldId]
    if (value == null) continue
    values[fieldId] = value
  }
  for (const [submittedKey, fieldId] of Object.entries(map)) {
    if (typeof fieldId !== 'string' || !model.fields[fieldId]) continue
    const value = input?.[submittedKey]
    if (value == null) continue
    values[fieldId] = value
  }
  return values
}

/** A dataset record write, checked against the dataset's model. */
export interface DatasetRecordWrite {
  /**
   * The model fields this write supplied a value for, before coercion. Empty
   * means nothing submitted matched a field of the dataset.
   */
  matched: string[]
  /**
   * The values to store, in storage form (see `dataset-models`): numbers,
   * booleans, epoch millis and so on per the field's type. For a merge, the
   * existing values with this write's laid over them.
   */
  values: Record<string, unknown>
  /** fieldId → the reason it was refused. Empty when the write may land. */
  errors: Record<string, string>
}

/**
 * A text field takes what an event payload carries as a number or a boolean
 * as the text it reads as, which is what these writes always stored.
 */
function asTextInput(
  model: DatasetModel,
  picked: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [fieldId, value] of Object.entries(picked)) {
    const type = model.fields[fieldId]?.type
    values[fieldId] =
      (type === 'text' || type === 'reference') &&
      (typeof value === 'number' || typeof value === 'boolean')
        ? String(value)
        : value
  }
  return values
}

/**
 * A record write from a form submission or an automation step, coerced and
 * validated against the dataset's model (AGL-2773, option B).
 *
 * These writes used to store `String(value)` for every field and check
 * nothing, so a form could put `abc` in a number column and skip a required
 * one. They now run the same `coerceDocumentValues` + `validateDocument` pair
 * the console and `/v1` do: a value is stored in its field's type, and a
 * record with any refused field is not written at all. The caller decides
 * what a refusal costs — a form keeps the Inbox submission, a run records a
 * failed step.
 *
 * `existing` makes it a merge (update-or-append's update leg): this write's
 * values are laid over the stored ones, and only the fields THIS write
 * supplied are held to the model. A stored row written as text before this
 * change keeps its text values and is not refused for them — the reads have
 * always rendered them, and a merge that touched `email` must not fail over a
 * legacy `price` of `"12"` it never sent.
 *
 * Custom field types validate only once registered: call
 * `ensureDeclaredCustomFieldTypes(model)` before this on a server path.
 */
export function prepareDatasetRecordWrite(
  dataset: { model?: DatasetModel; fields?: string[] },
  input: Record<string, unknown> | null | undefined,
  options: {
    fieldMap?: Record<string, string> | null
    existing?: Record<string, unknown> | null
  } = {},
): DatasetRecordWrite {
  const model = effectiveDatasetModel(dataset)
  const picked = pickDatasetRecordInput(dataset, input, options.fieldMap)
  const matched = Object.keys(picked)
  const coerced = coerceDocumentValues(model, asTextInput(model, picked))
  if (!options.existing) {
    return {
      matched,
      values: coerced,
      errors: validateDocument(model, coerced),
    }
  }
  const values = { ...options.existing, ...coerced }
  const errors: Record<string, string> = {}
  for (const [fieldId, error] of Object.entries(
    validateDocument(model, values),
  )) {
    if (fieldId in coerced) errors[fieldId] = error
  }
  return { matched, values, errors }
}

/**
 * A refused write's errors as one line, in the model's field order:
 * `Stars must be a whole number; Email is required`.
 */
export function describeDatasetRecordErrors(
  errors: Record<string, string>,
): string {
  return Object.values(errors).join('; ')
}

/**
 * The name a dataset is shown under: `displayName`, which is what every create
 * path writes (AGL-536), then the pre-migration `name`. Blank when the document
 * carries neither.
 */
export function datasetDisplayName(
  dataset: { displayName?: unknown; name?: unknown } | null | undefined,
): string {
  for (const candidate of [dataset?.displayName, dataset?.name]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return ''
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
