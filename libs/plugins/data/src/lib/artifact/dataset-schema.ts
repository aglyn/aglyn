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

import { stableStringify } from '@aglyn/aglyn/app-utils/artifact-provenance'
import {
  PORTABLE_DATASET_FIELD_TYPES,
  PORTABLE_DEFINITION_MAX_BYTES,
} from '@aglyn/aglyn/app-utils/node-definition-sanitizer'

/**
 * A dataset's schema as it travels between workspaces (AGL-657): what a
 * publisher's dataset is reduced to, what an installing workspace's new
 * dataset is made from, and what an update compares. The data plugin's,
 * because only it knows a dataset's model (AGL-3080); the installer stores and
 * diffs it as content it does not read.
 *
 * Pure and context-free, so the owner's server answers
 * (`dataset-schema-artifact.server.ts`) and their specs share one shape.
 */

/** Field cap on a published schema, mirroring the console's create limit. */
export const DATASET_SCHEMA_MAX_FIELDS = 100

/** A published dataset schema: the model, with no records. */
export interface PublishedDatasetSchema {
  fields: Record<string, PublishedDatasetField>
  order: string[]
}

export interface PublishedDatasetField {
  name: string
  type: string
  customType?: string
  description?: string
  required?: boolean
  default?: unknown
  validation?: Record<string, unknown>
  /**
   * Kept so an install into an org that HAS the referenced dataset can relink
   * it. `datasetId` is the publisher's id and is meaningless in another org,
   * so `datasetLabel` carries the human name the installer matches on.
   */
  reference?: {
    datasetId?: string
    datasetLabel?: string
    displayFieldId?: string
    multiple?: boolean
    onDelete?: string
  }
}

const KEPT_VALIDATION_KEYS = ['required', 'regex', 'min', 'max', 'options']

/**
 * Validates and strips a `DatasetModel` for publishing as a dataset schema
 * (AGL-657).
 *
 * Publishes STRUCTURE ONLY: records never travel. That is the whole safety
 * story for this artifact type: a dataset's rows are the org's customer data,
 * so the publish path reads the model and nothing else, and there is no code
 * path here that can reach the `records` subcollection.
 *
 * Two cross-org hazards the issue called out, handled by carrying enough
 * context for the INSTALLER to decide rather than by rejecting at publish:
 * - `reference` FKs point at a dataset id that only exists in the publisher's
 *   org. The id is kept alongside the referenced dataset's label so the
 *   installer can relink by name and degrade the field when it can't (see
 *   `resolveInstalledDatasetSchema`).
 * - `customType` names a plugin-declared field type (AGL-434) whose plugin the
 *   installing org may not have. Unknown custom types already degrade to their
 *   base type at render, so the name rides along untouched.
 */
export function sanitizeDatasetSchema(model: {
  fields?: Record<string, any>
  order?: unknown
}):
  | { ok: true; schema: PublishedDatasetSchema }
  | { ok: false; error: string } {
  const fields = model?.fields
  if (!fields || typeof fields !== 'object') {
    return { ok: false, error: 'Dataset has no field model to publish' }
  }
  // Order is the display contract; fall back to key order for models written
  // before `order` was required so older datasets stay publishable.
  const order = Array.isArray(model.order)
    ? model.order.map(String)
    : Object.keys(fields)
  const kept = order.filter((id) => fields[id])
  if (!kept.length) {
    return { ok: false, error: 'Dataset has no fields to publish' }
  }
  if (kept.length > DATASET_SCHEMA_MAX_FIELDS) {
    return {
      ok: false,
      error: `Dataset schemas are limited to ${DATASET_SCHEMA_MAX_FIELDS} fields`,
    }
  }
  const schema: PublishedDatasetSchema = { fields: {}, order: kept }
  for (const id of kept) {
    const field = fields[id] ?? {}
    const type = String(field.type ?? 'text')
    if (!PORTABLE_DATASET_FIELD_TYPES.includes(type)) {
      return { ok: false, error: `Field "${id}" has an unsupported type` }
    }
    const safe: PublishedDatasetField = {
      name: String(field.name ?? id).slice(0, 120),
      type,
    }
    if (field.customType) safe.customType = String(field.customType).slice(0, 60)
    if (field.description) {
      safe.description = String(field.description).slice(0, 500)
    }
    if (field.required === true) safe.required = true
    // Defaults are publisher-authored values, not data. Keep only primitives
    // so a default can't smuggle a nested object into the installing org.
    if (
      field.default !== undefined &&
      (typeof field.default === 'string' ||
        typeof field.default === 'number' ||
        typeof field.default === 'boolean')
    ) {
      safe.default = field.default
    }
    if (field.validation && typeof field.validation === 'object') {
      const validation: Record<string, unknown> = {}
      for (const key of KEPT_VALIDATION_KEYS) {
        if (field.validation[key] !== undefined) {
          validation[key] = field.validation[key]
        }
      }
      if (Object.keys(validation).length) safe.validation = validation
    }
    if (field.reference && typeof field.reference === 'object') {
      safe.reference = {
        ...(field.reference.datasetId && {
          datasetId: String(field.reference.datasetId),
        }),
        ...(field.reference.datasetLabel && {
          datasetLabel: String(field.reference.datasetLabel).slice(0, 120),
        }),
        ...(field.reference.displayFieldId && {
          displayFieldId: String(field.reference.displayFieldId),
        }),
        ...(field.reference.multiple === true && { multiple: true }),
        ...(field.reference.onDelete && {
          onDelete: String(field.reference.onDelete),
        }),
      }
    }
    schema.fields[id] = safe
  }
  const serialized = JSON.stringify(schema)
  if (serialized.length > PORTABLE_DEFINITION_MAX_BYTES) {
    return { ok: false, error: 'Dataset schema is too large to publish' }
  }
  return { ok: true, schema }
}

/**
 * Rewrites a published schema for the installing org (AGL-657).
 *
 * `reference` fields are the only part of a schema that can't cross an org
 * boundary as-is: they name a dataset id in the PUBLISHER's org. Relink by the
 * referenced dataset's label when the installing org has one by that name;
 * otherwise degrade the field to plain `text` and report it, because a
 * reference field pointing at a dataset that doesn't exist renders as a broken
 * picker. Silently keeping the dead id would install something visibly
 * broken and blame the installer for it.
 *
 * `existingDatasets` maps lowercased display name → dataset id in the target.
 */
export function resolveInstalledDatasetSchema(
  schema: PublishedDatasetSchema,
  existingDatasets: Readonly<Record<string, string>>,
): { schema: PublishedDatasetSchema; degradedFieldIds: string[] } {
  const degradedFieldIds: string[] = []
  const fields: Record<string, PublishedDatasetField> = {}
  for (const id of schema.order) {
    const field = schema.fields[id]
    if (!field) continue
    if (field.type !== 'reference' && !field.reference) {
      fields[id] = field
      continue
    }
    const label = String(field.reference?.datasetLabel ?? '').toLowerCase()
    const relinked = label ? existingDatasets[label] : undefined
    if (relinked) {
      fields[id] = {
        ...field,
        reference: { ...field.reference, datasetId: relinked },
      }
      continue
    }
    const { reference: _dropped, ...rest } = field
    fields[id] = { ...rest, type: 'text' }
    degradedFieldIds.push(id)
  }
  return { schema: { fields, order: schema.order }, degradedFieldIds }
}

/**
 * Dataset schemas, classified by what an update would do to EXISTING RECORDS
 * (AGL-1018).
 *
 * The sharp edge of updating an installed copy: adding a field is inert, but
 * removing or retyping one reinterprets data that is already there. So the
 * schema plan is not "safe vs conflict" but "additive vs destructive", and
 * destructive changes are never taken without a count of the records at stake.
 */
export interface SchemaChangeSummary {
  /** Field ids the new version adds. Applying these cannot harm a record. */
  added: string[]
  /** Field ids it removes: the values in existing records become orphaned. */
  removed: string[]
  /** Field ids whose TYPE changed: existing values may not survive a re-read. */
  retyped: string[]
  /** Anything else (labels, options, ordering). */
  edited: string[]
  /** True when nothing removes or retypes a field. */
  additiveOnly: boolean
}

interface SchemaShape {
  order?: unknown
  fields?: Record<string, { type?: unknown } | undefined>
}

const same = (a: unknown, b: unknown): boolean =>
  stableStringify(a) === stableStringify(b)

/**
 * Compares two dataset schemas field by field.
 *
 * Deliberately ignores the base: for a schema the question is not "who edited
 * this" but "what happens to the rows", and that is answered by the current
 * schema against the incoming one regardless of who moved which field.
 */
export function summarizeSchemaChange(
  current: SchemaShape | null | undefined,
  incoming: SchemaShape | null | undefined,
): SchemaChangeSummary {
  const currentFields = (current?.fields ?? {}) as Record<string, { type?: unknown }>
  const incomingFields = (incoming?.fields ?? {}) as Record<string, { type?: unknown }>
  const added: string[] = []
  const removed: string[] = []
  const retyped: string[] = []
  const edited: string[] = []
  for (const id of Object.keys(incomingFields)) {
    if (!(id in currentFields)) {
      added.push(id)
      continue
    }
    if (String(currentFields[id]?.type) !== String(incomingFields[id]?.type)) {
      retyped.push(id)
    } else if (!same(currentFields[id], incomingFields[id])) {
      edited.push(id)
    }
  }
  for (const id of Object.keys(currentFields)) {
    if (!(id in incomingFields)) removed.push(id)
  }
  return {
    added,
    removed,
    retyped,
    edited,
    additiveOnly: !removed.length && !retyped.length,
  }
}
