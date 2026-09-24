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
  type CrmPicklistValue,
  crmPicklistValueByLabel,
  crmPicklistValueId,
  normalizeCrmPicklistLabel,
} from '@aglyn/aglyn/app-utils/crm'

/**
 * THE LEAD SOURCE LIST'S EDITS (AGL-3298), as pure moves over a picklist.
 *
 * The Fields page applies the ones that touch only the list — add, reorder,
 * sort, activate, deactivate, default — as one client write of the whole
 * document. The two that change what RECORDS hold — a rename and a delete
 * with its replacement — go to `crm/lead-source-values`, which rewrites the
 * list and every lead and contact holding the old label in one request;
 * this module is where both sides agree what each move does.
 */

/** The route the two record-changing moves are posted to. */
export const CRM_LEAD_SOURCE_VALUES_ROUTE = 'crm/lead-source-values' as const

export const crmLeadSourceValuesRouteUrl = (): string => `/api/${CRM_LEAD_SOURCE_VALUES_ROUTE}`

/** What the route is asked. `hostId` or `orgId` names the org, as every CRM route's scope does. */
export type LeadSourceValuesRequest = { hostId?: string | null; orgId?: string } & (
  | { action: 'rename'; valueId: string; label: string }
  | {
      action: 'delete'
      valueId: string
      /** An active value's label the records move to, or `null` to clear them. */
      replaceWith: string | null
    }
)

/** What the route answers. */
export interface LeadSourceValuesResponse {
  ok: true
  /** How many leads now hold the new label (or none). */
  leads: number
  /**
   * How many contact FACETS were rewritten — one per holder that held the
   * old label, so a person two sites both filed under it counts twice.
   */
  contacts: number
}

/** Why a move is refused, in the sentence the page shows. */
export type PicklistMove = { ok: true; picklist: CrmPicklist } | { ok: false; error: string }

const DUPLICATE = (label: string) => `“${label}” is already in the list.`

/** Append a value. */
export function addPicklistValue(picklist: CrmPicklist, rawLabel: string): PicklistMove {
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
  const value: CrmPicklistValue = {
    id: crmPicklistValueId(
      label,
      picklist.values.map((entry) => entry.id),
    ),
    label,
    active: true,
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
 * Remove a value — the list half of the route's delete. The replacement,
 * when there is one, must be another ACTIVE value: records are not moved
 * onto a value the pickers no longer offer. A default that named the
 * deleted value is cleared.
 */
export function deletePicklistValue(
  picklist: CrmPicklist,
  valueId: string,
  replaceWith: string | null,
): PicklistMove {
  if (!picklist.values.some((value) => value.id === valueId)) {
    return { ok: false, error: 'That value is no longer in the list.' }
  }
  if (replaceWith !== null) {
    const target = crmPicklistValueByLabel(picklist, replaceWith)
    if (!target || target.id === valueId || !target.active) {
      return { ok: false, error: 'Pick an active value to move its records to, or none.' }
    }
  }
  return {
    ok: true,
    picklist: {
      values: picklist.values.filter((value) => value.id !== valueId),
      defaultValueId: picklist.defaultValueId === valueId ? null : picklist.defaultValueId,
    },
  }
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
