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
  TRANSFER_ID_FIELD,
  isBlankTransferValue,
  normalizeMatchValue,
  type MatchKeySpec,
  type PlannedTransferRow,
  type TransferCatalogInput,
  type TransferField,
  type TransferFieldType,
  type TransferPlan,
  type TransferWarning,
} from '@aglyn/aglyn/data-transfer'
import type { PicklistSpec, PicklistValueSet } from '@aglyn/aglyn/app-utils/picklists'
import type { TransferMatchKeyOffer } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  coerceDocumentValues,
  coerceListValue,
  datasetFilterTextKey,
  datasetFilterValuePath,
  humanizeDatasetFieldId,
  validateDocument,
  type DatasetFieldDefinition,
  type DatasetModel,
} from '../model/dataset-models'
import { fillRecordAddresses, isRecordAddressField } from '../record-pages/record-pages'
import { datasetTransferResourceKey } from './dataset-transfer-key'

/*==========================================
 * A DATASET AS A TRANSFER RESOURCE (AGL-3530) — the pure half.
 *
 * The import wizard and the export dialog speak in TRANSFER FIELDS and
 * TRANSFER VALUES (`@aglyn/aglyn/data-transfer`); a dataset speaks in its own
 * model and storage form (`dataset-models.ts`). This module is the one place
 * the two are translated, so the export, the dry run, the writes and undo all
 * read a record the same way:
 *
 *  - {@link datasetTransferCatalog}: the dataset's fields as the catalog the
 *    picker and the mapping list, plus the record's Aglyn ID and its created
 *    and updated times;
 *  - {@link datasetRecordTransferValues}: a stored record as transfer values
 *    — what an export writes, what the plan compares a file against, and what
 *    undo reads back;
 *  - {@link datasetStorageValues}: transfer values back into storage form,
 *    through the same `coerceDocumentValues` every record write uses;
 *  - {@link datasetMatchKeyOffer}: which fields a row may find its record by;
 *  - {@link refuseInvalidDatasetRows}: the dry run's rows held to the model's
 *    validation, so a row the write would refuse fails in the dry run instead.
 *
 * The two must be inverses on every value a record holds: an import of an
 * export changes nothing, and undo compares a record's values now with the
 * values the import wrote, in one form.
 *=========================================*/

/** The group a dataset's own fields are listed under. */
export const DATASET_TRANSFER_FIELDS_GROUP = 'fields'

/** The record's created time, exported and never written. */
export const DATASET_TRANSFER_CREATED_FIELD = 'record:createdAt'

/** The record's last-updated time, exported and never written. */
export const DATASET_TRANSFER_UPDATED_FIELD = 'record:updatedAt'

/**
 * A dataset field named `id` would be read as the record's Aglyn ID, which
 * every catalog carries under that id; it moves as `field:id` instead.
 */
const SHADOWED_PREFIX = 'field:'

/** A dataset field's id in the catalog. */
export function datasetTransferFieldId(fieldId: string): string {
  return fieldId === TRANSFER_ID_FIELD ? `${SHADOWED_PREFIX}${fieldId}` : fieldId
}

/** The dataset field a catalog id names, or `null` for the Aglyn ID and the record's times. */
export function datasetFieldIdOf(transferFieldId: string): string | null {
  if (transferFieldId === TRANSFER_ID_FIELD) return null
  if (transferFieldId === DATASET_TRANSFER_CREATED_FIELD || transferFieldId === DATASET_TRANSFER_UPDATED_FIELD) return null
  return transferFieldId === `${SHADOWED_PREFIX}${TRANSFER_ID_FIELD}` ? TRANSFER_ID_FIELD : transferFieldId
}

/** The picklist a text field with a fixed list of options is matched against. */
export function datasetOptionsPicklistId(fieldId: string): string {
  return `options:${fieldId}`
}

/** The field a picklist id from {@link datasetOptionsPicklistId} belongs to, or `null`. */
export function datasetFieldOfPicklist(picklistId: string): string | null {
  return picklistId.startsWith('options:') ? picklistId.slice('options:'.length) || null : null
}

/** A text field whose values must be one of its options. */
export function isOptionsField(field: DatasetFieldDefinition | undefined): boolean {
  return field?.type === 'text' && (field.validation?.options?.length ?? 0) > 0
}

/** A field a file may write: everything but the bytes and null placeholders, which hold nothing a cell can say. */
export function isWritableDatasetField(field: DatasetFieldDefinition | undefined): boolean {
  return Boolean(field) && field?.type !== 'bytes' && field?.type !== 'nil'
}

/** What a dataset field means to the wizard. */
export function datasetTransferType(field: DatasetFieldDefinition): TransferFieldType {
  switch (field.type) {
    case 'bool':
      return 'boolean'
    case 'int32':
    case 'int64':
      return 'integer'
    case 'float':
      return 'number'
    case 'timestamp':
      return 'datetime'
    case 'map':
      return 'json'
    case 'sorted':
      return 'list'
    case 'reference':
      return field.reference?.multiple ? 'list' : 'lookup'
    case 'text':
      return isOptionsField(field) ? 'picklist' : 'text'
    default:
      // Coordinates read and write as `latitude, longitude`; bytes and nil
      // export as text and are never written.
      return 'text'
  }
}

/** Whether a new record needs this field — a page address fills itself in from its source field, so it never does. */
function isRequiredField(field: DatasetFieldDefinition): boolean {
  if (isRecordAddressField(field) && field.slugFrom) return false
  return Boolean(field.required || field.validation?.required)
}

/** One dataset field as the catalog lists it. */
export function datasetTransferField(fieldId: string, field: DatasetFieldDefinition): TransferField {
  const id = datasetTransferFieldId(fieldId)
  const label = String(field.name ?? '').trim() || humanizeDatasetFieldId(fieldId)
  const type = datasetTransferType(field)
  const description =
    field.type === 'reference'
      ? `${field.reference?.multiple ? 'Records' : 'A record'} of another dataset, by its ID or its name.`
      : field.type === 'coordinates'
        ? 'Latitude and longitude, separated by a comma.'
        : String(field.description ?? '').trim()
  const target = field.type === 'reference' ? field.reference?.datasetId : undefined
  return {
    id,
    label,
    group: DATASET_TRANSFER_FIELDS_GROUP,
    type,
    ...(isRequiredField(field) ? { required: true } : {}),
    ...(isWritableDatasetField(field) ? {} : { readOnly: true }),
    // An export from before AGL-3530 headed every column with the field's id,
    // so a file like that still maps itself.
    ...(label.toLowerCase() !== fieldId.toLowerCase() ? { aliases: [fieldId] } : {}),
    ...(type === 'picklist' ? { picklistId: datasetOptionsPicklistId(fieldId) } : {}),
    ...(type === 'lookup' && target
      ? {
          lookup: {
            resource: datasetTransferResourceKey(target),
            by: [
              TRANSFER_ID_FIELD,
              ...(field.reference?.displayFieldId ? [datasetTransferFieldId(field.reference.displayFieldId)] : []),
            ],
          },
        }
      : {}),
    ...(description ? { description } : {}),
  }
}

/**
 * The dataset's catalog: its fields in the dataset's order under one group
 * (named after the dataset when `label` is given), then the record's Aglyn ID (added by the core) and its created and updated
 * times.
 */
export function datasetTransferCatalog(model: DatasetModel, label = 'Fields'): TransferCatalogInput {
  return {
    standard: (model.order ?? [])
      .filter((fieldId) => model.fields?.[fieldId])
      .map((fieldId) => datasetTransferField(fieldId, model.fields[fieldId] as DatasetFieldDefinition)),
    system: [
      { id: DATASET_TRANSFER_CREATED_FIELD, label: 'Created', type: 'datetime', readOnly: true },
      { id: DATASET_TRANSFER_UPDATED_FIELD, label: 'Updated', type: 'datetime', readOnly: true },
    ],
    groups: [{ id: DATASET_TRANSFER_FIELDS_GROUP, label }],
  }
}

/** An options field's values as a picklist the values step can match against. */
export function datasetOptionsPicklist(field: DatasetFieldDefinition): { spec: PicklistSpec; set: PicklistValueSet } {
  const options = [...new Set((field.validation?.options ?? []).map((option) => String(option)).filter(Boolean))]
  return {
    // Restricted: `validateDocument` refuses a value the options do not hold.
    spec: { restricted: true, standardValues: options.map((option) => ({ id: option, label: option })) },
    set: { values: options.map((option) => ({ id: option, label: option, active: true })), defaultValueId: null },
  }
}

/*------------------------------------------
 * Values: storage form ↔ transfer form
 *-----------------------------------------*/

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** A stored time — epoch milliseconds, a Firestore Timestamp, a date string — as ISO-8601, or `null`. */
function isoOf(value: unknown): string | null {
  if (finite(value)) return new Date(value).toISOString()
  const timestamp = value as { toMillis?: () => number } | null
  if (timestamp && typeof timestamp.toMillis === 'function') return new Date(timestamp.toMillis()).toISOString()
  if (typeof value === 'string' && value.trim()) {
    const millis = Date.parse(value)
    return Number.isFinite(millis) ? new Date(millis).toISOString() : null
  }
  return null
}

/** One stored value as the wizard reads it, or `undefined` for a value the record does not hold. */
function transferValueOf(field: DatasetFieldDefinition, stored: unknown): unknown {
  if (stored === null || stored === undefined || stored === '') return undefined
  switch (field.type) {
    case 'timestamp':
      return isoOf(stored) ?? String(stored)
    case 'bool':
      return stored === 'true' ? true : stored === 'false' ? false : stored
    case 'int32':
    case 'int64':
    case 'float': {
      // A form or an automation stored numbers as text before AGL-2773.
      const number = typeof stored === 'string' && stored.trim() ? Number(stored) : stored
      return finite(number) ? number : stored
    }
    case 'coordinates': {
      const point = stored as { latitude?: unknown; longitude?: unknown }
      return finite(point?.latitude) && finite(point?.longitude) ? `${point.latitude}, ${point.longitude}` : stored
    }
    case 'sorted':
    case 'reference': {
      if (field.type === 'reference' && !field.reference?.multiple) return stored
      const list = coerceListValue(stored)
      return Array.isArray(list) ? (list.length ? list : undefined) : stored
    }
    case 'text':
      return finite(stored) || typeof stored === 'boolean' ? String(stored) : stored
    default:
      return stored
  }
}

/**
 * A stored record as transfer values, by catalog id: every field the model
 * lists that the record holds, its Aglyn ID, and its created and updated
 * times when it carries them. A field the record does not hold is absent,
 * which the plan reads as blank.
 */
export function datasetRecordTransferValues(
  model: DatasetModel,
  record: { id?: string; values?: Readonly<Record<string, unknown>> | null; createdAt?: unknown; updatedAt?: unknown },
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (record.id) out[TRANSFER_ID_FIELD] = record.id
  const values = record.values ?? {}
  for (const fieldId of model.order ?? []) {
    const field = model.fields?.[fieldId]
    if (!field) continue
    const value = transferValueOf(field, values[fieldId])
    if (value !== undefined) out[datasetTransferFieldId(fieldId)] = value
  }
  const created = isoOf(record.createdAt)
  const updated = isoOf(record.updatedAt)
  if (created) out[DATASET_TRANSFER_CREATED_FIELD] = created
  if (updated) out[DATASET_TRANSFER_UPDATED_FIELD] = updated
  return out
}

/**
 * Transfer values in storage form, through `coerceDocumentValues` — the
 * coercion every record write runs. `values` holds what is written and
 * `cleared` the fields a blank value empties. The Aglyn ID, the record's
 * times, unknown ids and fields a file never writes are ignored.
 */
export function datasetStorageValues(
  model: DatasetModel,
  transfer: Readonly<Record<string, unknown>>,
): { values: Record<string, unknown>; cleared: string[] } {
  const input: Record<string, unknown> = {}
  const cleared: string[] = []
  for (const [transferId, value] of Object.entries(transfer)) {
    const fieldId = datasetFieldIdOf(transferId)
    const field = fieldId ? model.fields?.[fieldId] : undefined
    if (!fieldId || !field || !isWritableDatasetField(field)) continue
    if (isBlankTransferValue(value)) {
      cleared.push(fieldId)
      continue
    }
    // Text read from a JSON file's number is still the text it spells.
    input[fieldId] = field.type === 'text' && (finite(value) || typeof value === 'boolean') ? String(value) : value
  }
  return { values: coerceDocumentValues(model, input), cleared }
}

/*------------------------------------------
 * Matching
 *-----------------------------------------*/

/** How a dataset field compares as a match key, or `null` for one no query can find a record by. */
export function datasetMatchKeyFor(fieldId: string, field: DatasetFieldDefinition | undefined): MatchKeySpec | null {
  if (!field || !datasetFilterValuePath(fieldId)) return null
  const id = datasetTransferFieldId(fieldId)
  if (field.type === 'text') return { fieldId: id, normalizer: isOptionsField(field) ? 'trim' : 'caseless' }
  if (field.type === 'int32' || field.type === 'int64' || field.type === 'float') return { fieldId: id, normalizer: 'exact' }
  return null
}

/**
 * The keys a row may find its record by: the Aglyn ID, then every text and
 * number field the records' filter values can be asked by, in the dataset's
 * order. A person starts with the Aglyn ID and the dataset's page address —
 * the one field a dataset holds unique — and may add any other.
 */
export function datasetMatchKeyOffer(model: DatasetModel): TransferMatchKeyOffer {
  const keys: MatchKeySpec[] = [{ fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId' }]
  const defaults = [TRANSFER_ID_FIELD]
  for (const fieldId of model.order ?? []) {
    const field = model.fields?.[fieldId]
    const key = datasetMatchKeyFor(fieldId, field)
    if (!key) continue
    keys.push(key)
    if (isRecordAddressField(field)) defaults.push(key.fieldId)
  }
  return { keys, defaults }
}

/**
 * The `filterValues` equality that finds the records holding a normalized
 * key value: the path, and the value as the records store it. Plain text is
 * stored as its lower-cased key clipped to 64 characters, so two long values
 * can share it; the caller compares what it found against the whole value.
 */
export function datasetMatchKeyQuery(
  model: DatasetModel,
  key: MatchKeySpec,
  normalized: string,
): { path: string; value: string | number } | null {
  const fieldId = datasetFieldIdOf(key.fieldId)
  const field = fieldId ? model.fields?.[fieldId] : undefined
  const path = fieldId ? datasetFilterValuePath(fieldId) : null
  if (!field || !path) return null
  if (field.type === 'int32' || field.type === 'int64' || field.type === 'float') {
    const number = Number(normalized)
    return Number.isFinite(number) ? { path, value: number } : null
  }
  if (field.type !== 'text') return null
  return { path, value: isOptionsField(field) ? normalized : datasetFilterTextKey(normalized) }
}

/** Whether a record's transfer values hold a normalized key value — the check a clipped query answer is held to. */
export function datasetHoldsKey(view: Readonly<Record<string, unknown>>, key: MatchKeySpec, normalized: string): boolean {
  return normalizeMatchValue(key.normalizer, view[key.fieldId]) === normalized
}

/*------------------------------------------
 * The dry run, held to the model
 *-----------------------------------------*/

/** Field id → message, for the fields a write of these values would refuse. */
export function datasetWriteErrors(
  model: DatasetModel,
  values: Record<string, unknown>,
  only?: ReadonlySet<string>,
): Record<string, string> {
  const errors = validateDocument(model, values)
  if (!only) return errors
  return Object.fromEntries(Object.entries(errors).filter(([fieldId]) => only.has(fieldId)))
}

/**
 * The values a planned row leaves a record holding, in storage form: a new
 * record's from the row alone, an existing one's from what it holds now
 * (`before`, transfer values) with the row's changes over it. Page addresses
 * are filled in as every record write fills them. `changed` names the dataset
 * fields the row writes.
 */
export function datasetPlannedValues(
  model: DatasetModel,
  row: Pick<PlannedTransferRow, 'verdict' | 'diff'>,
  before: Readonly<Record<string, unknown>> | null | undefined,
): { values: Record<string, unknown>; changed: Set<string> } {
  const after: Record<string, unknown> = row.verdict === 'update' ? { ...(before ?? {}) } : {}
  const changed = new Set<string>()
  for (const change of row.diff) {
    after[change.fieldId] = change.after
    const fieldId = datasetFieldIdOf(change.fieldId)
    if (fieldId) changed.add(fieldId)
  }
  const { values } = datasetStorageValues(model, after)
  return { values: fillRecordAddresses(model, values), changed }
}

/**
 * The plan with every row the model would refuse failed, naming the fields
 * (`missing`, read with the reason "A value refuses the row"): a value outside
 * a field's options, past its bounds, not matching its pattern, or refused by
 * a custom field type's validator. An update is held only on the fields it
 * writes, so a record stored before a rule existed is not refused for a value
 * the file never touched.
 */
export function refuseInvalidDatasetRows(
  model: DatasetModel,
  plan: TransferPlan,
  existing: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): TransferPlan {
  let refused = 0
  const rows = plan.rows.map((row): PlannedTransferRow => {
    if (row.verdict !== 'create' && row.verdict !== 'update') return row
    const before = row.recordId ? existing.get(row.recordId) : null
    const { values, changed } = datasetPlannedValues(model, row, before)
    const errors = datasetWriteErrors(model, values, row.verdict === 'update' ? changed : undefined)
    const fields = Object.keys(errors)
    if (!fields.length) return row
    refused += 1
    return { ...row, verdict: 'fail', reason: 'refusedValue', missing: fields.map(datasetTransferFieldId), diff: [] }
  })
  if (!refused) return plan
  const summary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  return { ...plan, rows, summary }
}

/**
 * The plan with every new record past `maxCreates` failed as past what the
 * plan allows, under the `planLimit` warning the person acknowledges. Run
 * after {@link refuseInvalidDatasetRows}, so a row the model refuses never
 * takes the room a valid row could have had.
 */
export function limitDatasetCreates(plan: TransferPlan, maxCreates: number | undefined): TransferPlan {
  if (maxCreates === undefined || plan.summary.create <= maxCreates) return plan
  let room = Math.max(0, maxCreates)
  const over: number[] = []
  const rows = plan.rows.map((row): PlannedTransferRow => {
    if (row.verdict !== 'create') return row
    if (room > 0) {
      room -= 1
      return row
    }
    over.push(row.index)
    return { ...row, verdict: 'fail', reason: 'planLimit', diff: [], warnings: [...new Set([...row.warnings, 'planLimit' as const])] }
  })
  const summary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  const limit: TransferWarning = {
    class: 'planLimit',
    count: over.length,
    rows: over.length,
    fieldIds: [],
    samples: over.slice(0, 5).map((row) => ({ row, detail: 'Past the records this plan allows in a dataset' })),
    requiresAcknowledgement: true,
  }
  const warnings = [...plan.warnings.filter((warning) => warning.class !== 'planLimit'), limit]
  return {
    rows,
    summary,
    warnings,
    acknowledgementsRequired: [...new Set([...plan.acknowledgementsRequired, 'planLimit' as const])],
  }
}
