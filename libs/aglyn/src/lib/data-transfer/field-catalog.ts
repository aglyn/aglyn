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

/*==========================================
 * FIELD CATALOG — every field a resource has, in the order a person picks them.
 *
 * Export offers ALL of a resource's fields: the standard ones it declares,
 * the custom ones the organization defined, and the derived and system ones
 * (the Aglyn id, created and updated times) that are read but never written.
 * The catalog is that list, grouped and ordered once, so the export picker,
 * the import mapping and the plan all name the same fields the same way.
 *
 * ## Presets
 *
 *  - `everything` — every field, in catalog order.
 *  - `reimportable` — the default for export: the Aglyn id, the resource's
 *    match keys and every writable field, so the file comes back in and
 *    finds the records it came from.
 *  - `minimal` — the id, the match keys, the required fields and whatever
 *    short list the resource names as its minimum.
 *
 * A saved preset is a list of field ids; resolving it drops the ids the
 * catalog no longer has (a deleted custom field) and says which.
 *=========================================*/

import { customImportTarget } from '../app-utils/csv-import'
import { PLATFORM_BRAND_NAME } from '../app-utils/platform-brand'
import { TRANSFER_ID_FIELD, isTransferFieldWritable } from './resource'
import type { TransferField, TransferFieldType } from './resource'

/** A heading fields are listed under. */
export interface TransferFieldGroup {
  id: string
  label: string
}

/** The group a field with no group, or an unknown one, is listed under. */
export const TRANSFER_OTHER_GROUP: TransferFieldGroup = { id: 'other', label: 'Other' }

/** The group custom fields are listed under unless they name their own. */
export const TRANSFER_CUSTOM_GROUP: TransferFieldGroup = { id: 'custom', label: 'Custom fields' }

/** The group system fields are listed under unless they name their own. */
export const TRANSFER_SYSTEM_GROUP: TransferFieldGroup = { id: 'system', label: 'System' }

/** A resource's fields, grouped and ordered. */
export interface TransferFieldCatalog {
  /** Every field, in picker order: group by group, declaration order within. */
  fields: TransferField[]
  byId: ReadonlyMap<string, TransferField>
  /** The groups that hold at least one field, in order. */
  groups: TransferFieldGroup[]
}

/** A custom field as the organization defined it. */
export interface TransferCustomFieldDefinition {
  key: string
  label: string
  type?: TransferFieldType
  picklistId?: string
  required?: boolean
  group?: string
}

/** A custom field definition as a catalog field, with id `custom:<key>`. */
export function customTransferField(definition: TransferCustomFieldDefinition): TransferField {
  return {
    id: customImportTarget(definition.key),
    label: definition.label || definition.key,
    group: definition.group ?? TRANSFER_CUSTOM_GROUP.id,
    type: definition.type ?? 'text',
    custom: true,
    aliases: definition.label && definition.label !== definition.key ? [definition.key] : [],
    ...(definition.picklistId ? { picklistId: definition.picklistId } : {}),
    ...(definition.required ? { required: true } : {}),
  }
}

/** What a catalog is built from. */
export interface TransferCatalogInput {
  /** The resource's own fields. */
  standard: readonly TransferField[]
  /** The organization's custom fields. */
  custom?: readonly TransferCustomFieldDefinition[]
  /** Computed fields, exported and never written. */
  derived?: readonly TransferField[]
  /** Platform-written fields; the Aglyn id is added when absent. */
  system?: readonly TransferField[]
  /** The groups, in order. Groups a field names but this list lacks are listed after these. */
  groups?: readonly TransferFieldGroup[]
}

/** The Aglyn id field every catalog carries, labeled with the configured brand. */
export function transferIdField(label = `${PLATFORM_BRAND_NAME} ID`): TransferField {
  return {
    id: TRANSFER_ID_FIELD,
    label,
    group: TRANSFER_SYSTEM_GROUP.id,
    type: 'text',
    system: true,
    readOnly: true,
    matchKey: true,
    aliases: [...new Set([`${PLATFORM_BRAND_NAME.toLowerCase()} id`, 'aglyn id', 'record id', 'id'])],
  }
}

/**
 * The catalog for a resource.
 *
 * Standard fields come first in their groups, then derived ones, then custom
 * ones, then system ones; within a group the declaration order holds. A
 * field id declared twice keeps its first declaration — a custom field can
 * never shadow a standard one because its id carries the `custom:` prefix.
 */
export function buildTransferFieldCatalog(input: TransferCatalogInput): TransferFieldCatalog {
  const declared: TransferField[] = [
    ...input.standard,
    ...(input.derived ?? []).map((field) => ({ ...field, derived: true })),
    ...(input.custom ?? []).map(customTransferField),
    ...(input.system ?? []).map((field) => ({
      ...field,
      system: true,
      group: field.group ?? TRANSFER_SYSTEM_GROUP.id,
    })),
  ]
  if (!declared.some((field) => field.id === TRANSFER_ID_FIELD)) declared.push(transferIdField())

  const byId = new Map<string, TransferField>()
  for (const field of declared) if (!byId.has(field.id)) byId.set(field.id, field)
  const unique = [...byId.values()]

  // The declared groups in their order, then any group a field names that
  // was not declared, then the built-in tail (custom, system, other) unless
  // the resource placed one of those itself.
  const ordered: TransferFieldGroup[] = []
  const known = new Set<string>()
  const addGroup = (group: TransferFieldGroup): void => {
    if (known.has(group.id)) return
    known.add(group.id)
    ordered.push(group)
  }
  const builtIn = [TRANSFER_CUSTOM_GROUP, TRANSFER_SYSTEM_GROUP, TRANSFER_OTHER_GROUP]
  for (const group of input.groups ?? []) addGroup(group)
  for (const field of unique) {
    const id = field.group
    if (id && !builtIn.some((group) => group.id === id)) addGroup({ id, label: id })
  }
  for (const group of builtIn) addGroup(group)

  const groupOf = (field: TransferField): string =>
    field.group && known.has(field.group) ? field.group : TRANSFER_OTHER_GROUP.id
  const fields = ordered.flatMap((group) => unique.filter((field) => groupOf(field) === group.id))
  return {
    fields,
    byId: new Map(fields.map((field) => [field.id, field])),
    groups: ordered.filter((group) => fields.some((field) => groupOf(field) === group.id)),
  }
}

/** The fields under each group, in catalog order; `fieldIds` narrows and keeps catalog order. */
export function groupTransferFields(
  catalog: TransferFieldCatalog,
  fieldIds?: readonly string[],
): { group: TransferFieldGroup; fields: TransferField[] }[] {
  const wanted = fieldIds ? new Set(fieldIds) : null
  const groupOf = (field: TransferField): string =>
    field.group && catalog.groups.some((group) => group.id === field.group) ? field.group : TRANSFER_OTHER_GROUP.id
  return catalog.groups
    .map((group) => ({
      group,
      fields: catalog.fields.filter(
        (field) => groupOf(field) === group.id && (!wanted || wanted.has(field.id)),
      ),
    }))
    .filter((entry) => entry.fields.length > 0)
}

/** The fields whose label, id or an alias contains every word of `query`. */
export function searchTransferFields(catalog: TransferFieldCatalog, query: string): TransferField[] {
  const words = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return [...catalog.fields]
  return catalog.fields.filter((field) => {
    const haystack = [field.label, field.id, ...(field.aliases ?? [])].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** The built-in presets. */
export type TransferPresetId = 'everything' | 'reimportable' | 'minimal'

export const TRANSFER_PRESET_IDS: readonly TransferPresetId[] = ['everything', 'reimportable', 'minimal']

/** A preset a person saved: a name and the fields in their chosen order. */
export interface TransferSavedPreset {
  id: string
  label: string
  fieldIds: readonly string[]
}

/** What a resource says about its own presets. */
export interface TransferPresetHints {
  /** The fields a re-import matches on (the id is always included). */
  matchKeyFieldIds?: readonly string[]
  /** Fields the minimal preset adds beyond the id, match keys and required ones. */
  minimalFieldIds?: readonly string[]
}

/** A resolved selection: the ids to export, in order, and the ids that no longer exist. */
export interface TransferFieldSelection {
  fieldIds: string[]
  unknown: string[]
}

/**
 * A list of field ids against the catalog: unknown ids dropped (and
 * reported), duplicates dropped, the given order kept, and every id in
 * `ensure` present — added in catalog order at the front when missing.
 */
export function resolveTransferFieldSelection(
  catalog: TransferFieldCatalog,
  selected: readonly string[],
  ensure: readonly string[] = [],
): TransferFieldSelection {
  const seen = new Set<string>()
  const fieldIds: string[] = []
  const unknown: string[] = []
  for (const id of selected) {
    if (seen.has(id)) continue
    seen.add(id)
    if (catalog.byId.has(id)) fieldIds.push(id)
    else unknown.push(id)
  }
  const missing = catalog.fields
    .filter((field) => ensure.includes(field.id) && !fieldIds.includes(field.id))
    .map((field) => field.id)
  return { fieldIds: [...missing, ...fieldIds], unknown }
}

/**
 * The fields a preset exports, in order. A built-in preset is computed from
 * the catalog; a saved one is resolved against it. The re-importable and
 * minimal presets lead with the id and the match keys.
 */
export function resolveTransferPreset(
  catalog: TransferFieldCatalog,
  preset: TransferPresetId | TransferSavedPreset,
  hints: TransferPresetHints = {},
): TransferFieldSelection {
  // The id leads once, whether or not the match keys name it too.
  const keys = [...new Set([TRANSFER_ID_FIELD, ...(hints.matchKeyFieldIds ?? [])])].filter((id) => catalog.byId.has(id))
  const lead = (ids: Iterable<string>): string[] => {
    const rest = new Set(ids)
    for (const key of keys) rest.delete(key)
    return [...keys, ...catalog.fields.filter((field) => rest.has(field.id)).map((field) => field.id)]
  }
  if (typeof preset !== 'string') return resolveTransferFieldSelection(catalog, preset.fieldIds)
  if (preset === 'everything') return { fieldIds: catalog.fields.map((field) => field.id), unknown: [] }
  if (preset === 'reimportable') {
    return {
      fieldIds: lead(catalog.fields.filter(isTransferFieldWritable).map((field) => field.id)),
      unknown: [],
    }
  }
  const minimal = new Set(hints.minimalFieldIds ?? [])
  return {
    fieldIds: lead(
      catalog.fields.filter((field) => field.required || minimal.has(field.id)).map((field) => field.id),
    ),
    unknown: (hints.minimalFieldIds ?? []).filter((id) => !catalog.byId.has(id)),
  }
}

/** `ids` with the entry at `from` moved to `to` — the picker's drag to reorder. */
export function moveTransferField(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids]
  if (from < 0 || from >= next.length) return next
  const [moved] = next.splice(from, 1)
  const at = Math.max(0, Math.min(next.length, to))
  next.splice(at, 0, moved as string)
  return next
}
