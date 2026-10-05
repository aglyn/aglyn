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
  type CrmPicklist,
  type CrmPicklistDefinition,
  type CrmPicklistId,
  type CrmPicklistObject,
  type CrmPicklistValue,
  CRM_PICKLIST_VALUES_MAX,
  crmPicklistValueByLabel,
  crmPicklistValueId,
  normalizeCrmPicklistLabel,
} from '@aglyn/aglyn/app-utils/crm'
import { isStandardPicklistValueId } from '@aglyn/aglyn/app-utils/picklists'

/**
 * A PICKLIST'S EDITS (AGL-3298, AGL-3510), as pure moves over a list.
 *
 * The Fields page applies the ones that touch only the list — add, reorder,
 * sort, activate, deactivate, group, default — as one client write of the
 * whole document. The two that change what RECORDS hold — a rename and a
 * delete with its replacement — go to `crm/picklist-values`, which rewrites
 * the list and every record the definition's targets name in one request;
 * this module is where both sides agree what each move does.
 *
 * Each move that depends on the field takes its definition: a standard
 * value cannot be deleted, an added value's id is minted clear of every
 * standard id, and on a definition with meanings a delete's replacement
 * must mean the same.
 */

/** The route the two record-changing moves are posted to. */
export const CRM_PICKLIST_VALUES_ROUTE = 'crm/picklist-values' as const

/**
 * The lead source's own address for the same route, from before every
 * picklist shared one; a request to it needs no `picklistId`.
 */
export const CRM_LEAD_SOURCE_VALUES_ROUTE = 'crm/lead-source-values' as const

export const crmPicklistValuesRouteUrl = (): string => `/api/${CRM_PICKLIST_VALUES_ROUTE}`

/** The record-changing move a request asks for. */
export type PicklistValuesAction =
  | { action: 'rename'; valueId: string; label: string }
  | {
      action: 'delete'
      valueId: string
      /** An active value's label the records move to, or `null` to clear them. */
      replaceWith: string | null
    }

/** What the route is asked. `hostId` or `orgId` names the org, as every CRM route's scope does. */
export type PicklistValuesRequest = {
  hostId?: string | null
  orgId?: string
  picklistId: CrmPicklistId
} & PicklistValuesAction

/** What the route answers. */
export interface PicklistValuesResponse {
  ok: true
  /**
   * How many records each target object had rewritten. A contact counts
   * once per FACET rewritten — one per holder that held the old label, so
   * a person two sites both filed under it counts twice.
   */
  updated: Partial<Record<CrmPicklistObject, number>>
}

/** Why a move is refused, in the sentence the page shows. */
export type PicklistMove = { ok: true; picklist: CrmPicklist } | { ok: false; error: string }

const DUPLICATE = (label: string) => `“${label}” is already in the list.`

/**
 * Append an added value. On a definition with groups it is filed under
 * `group` (or none); on one with meanings it must name one.
 */
export function addPicklistValue(
  definition: CrmPicklistDefinition,
  picklist: CrmPicklist,
  rawLabel: string,
  options: { group?: string | null; meaning?: string | null } = {},
): PicklistMove {
  const label = normalizeCrmPicklistLabel(rawLabel)
  if (!label) return { ok: false, error: 'Enter a name for the value.' }
  const existing = crmPicklistValueByLabel(picklist, label)
  if (existing) {
    return {
      ok: false,
      error: existing.active
        ? DUPLICATE(existing.label)
        : `“${existing.label}” is in the list, inactive — activate it instead.`,
    }
  }
  if (picklist.values.length >= CRM_PICKLIST_VALUES_MAX) {
    return { ok: false, error: `A list holds at most ${CRM_PICKLIST_VALUES_MAX} values.` }
  }
  const meanings = definition.meanings ?? []
  if (meanings.length && !meanings.includes(options.meaning ?? '')) {
    return { ok: false, error: 'Pick what the value means.' }
  }
  const groups = definition.groups ?? []
  const value: CrmPicklistValue = {
    id: crmPicklistValueId(label, [
      ...picklist.values.map((entry) => entry.id),
      ...definition.standardValues.map((entry) => entry.id),
    ]),
    label,
    active: true,
    ...(groups.length
      ? { group: groups.some((group) => group.id === options.group) ? (options.group as string) : null }
      : {}),
    ...(meanings.length ? { meaning: options.meaning as string } : {}),
  }
  return { ok: true, picklist: { ...picklist, values: [...picklist.values, value] } }
}

/** Rename a value, keeping its id — the list half of the route's rename. */
export function renamePicklistValue(
  picklist: CrmPicklist,
  valueId: string,
  rawLabel: string,
): PicklistMove {
  const label = normalizeCrmPicklistLabel(rawLabel)
  if (!label) return { ok: false, error: 'Enter a name for the value.' }
  if (!picklist.values.some((value) => value.id === valueId)) {
    return { ok: false, error: 'That value is no longer in the list.' }
  }
  const clash = crmPicklistValueByLabel(picklist, label)
  if (clash && clash.id !== valueId) return { ok: false, error: DUPLICATE(clash.label) }
  return {
    ok: true,
    picklist: {
      ...picklist,
      values: picklist.values.map((value) => (value.id === valueId ? { ...value, label } : value)),
    },
  }
}

/**
 * Remove an added value — the list half of the route's delete. A standard
 * value is refused: every org has it, so it can be deactivated and not
 * removed. The replacement, when there is one, must be another ACTIVE
 * value — records are not moved onto a value the pickers no longer offer —
 * and, on a definition with meanings, one of the SAME meaning, so a record
 * never changes what it means by losing a label. A default that named the
 * deleted value is cleared.
 */
export function deletePicklistValue(
  definition: CrmPicklistDefinition,
  picklist: CrmPicklist,
  valueId: string,
  replaceWith: string | null,
): PicklistMove {
  const value = picklist.values.find((entry) => entry.id === valueId)
  if (!value) return { ok: false, error: 'That value is no longer in the list.' }
  if (isStandardPicklistValueId(definition, valueId)) {
    return {
      ok: false,
      error: `“${value.label}” is a standard value and cannot be deleted. Deactivate it instead.`,
    }
  }
  if (replaceWith !== null) {
    const target = crmPicklistValueByLabel(picklist, replaceWith)
    if (!target || target.id === valueId || !target.active) {
      return { ok: false, error: 'Pick an active value to move its records to, or none.' }
    }
    if (definition.meanings?.length && (target.meaning ?? null) !== (value.meaning ?? null)) {
      return {
        ok: false,
        error: `Pick a value that means the same as “${value.label}” to move its records to.`,
      }
    }
  }
  return {
    ok: true,
    picklist: {
      values: picklist.values.filter((entry) => entry.id !== valueId),
      defaultValueId: picklist.defaultValueId === valueId ? null : picklist.defaultValueId,
    },
  }
}

/**
 * The values a deleted value's records may move to: every other active
 * value, of the same meaning on a definition with meanings.
 */
export function picklistReplacements(
  definition: CrmPicklistDefinition,
  picklist: CrmPicklist,
  valueId: string,
): CrmPicklistValue[] {
  const deleted = picklist.values.find((entry) => entry.id === valueId)
  return picklist.values.filter(
    (entry) =>
      entry.active &&
      entry.id !== valueId &&
      (!definition.meanings?.length || (entry.meaning ?? null) === (deleted?.meaning ?? null)),
  )
}

/** Turn a value on or off. Deactivating the default clears the default. */
export function setPicklistValueActive(
  picklist: CrmPicklist,
  valueId: string,
  active: boolean,
): CrmPicklist {
  return {
    values: picklist.values.map((value) => (value.id === valueId ? { ...value, active } : value)),
    defaultValueId:
      !active && picklist.defaultValueId === valueId ? null : picklist.defaultValueId,
  }
}

/** File a value under one of the definition's groups, or none with `null`. */
export function setPicklistValueGroup(
  definition: CrmPicklistDefinition,
  picklist: CrmPicklist,
  valueId: string,
  group: string | null,
): CrmPicklist {
  const known = definition.groups?.some((entry) => entry.id === group) ? group : null
  return {
    ...picklist,
    values: picklist.values.map((value) =>
      value.id === valueId ? { ...value, group: known } : value,
    ),
  }
}

/** Make a value the default for new records, or clear the default with `null`. */
export function setPicklistDefault(picklist: CrmPicklist, valueId: string | null): CrmPicklist {
  const value = picklist.values.find((entry) => entry.id === valueId)
  return { ...picklist, defaultValueId: value?.active ? value.id : null }
}

/** Move the value at `from` to `to`, the drag and the arrows alike. */
export function movePicklistValue(picklist: CrmPicklist, from: number, to: number): CrmPicklist {
  const size = picklist.values.length
  if (from === to || from < 0 || to < 0 || from >= size || to >= size) return picklist
  const values = [...picklist.values]
  const [moved] = values.splice(from, 1)
  values.splice(to, 0, moved)
  return { ...picklist, values }
}

/** Every value in A–Z order by label, as Salesforce's "Sort alphabetically" does. */
export function sortPicklistValues(picklist: CrmPicklist): CrmPicklist {
  return {
    ...picklist,
    values: [...picklist.values].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    ),
  }
}
