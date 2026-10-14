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

// Modules by their own paths, never the `@aglyn/aglyn` barrel: the console
// server's boot reaches this file through the CRM's setup writers.
import { fieldDefinitionsForObject } from '@aglyn/aglyn/app-utils/contact-custom-fields'
import {
  CRM_FIELD_OBJECT_LABELS,
  CRM_FIELD_OBJECTS,
  CRM_PICKLIST_IDS,
  CRM_PICKLIST_OBJECT_LABELS,
  type CrmFieldObject,
  type CrmPicklist,
  type CrmPicklistDefinition,
  type CrmPicklistId,
  crmPicklistDefinition,
  crmPicklistValueByLabel,
  isCrmFieldObject,
  normalizeContactFieldKey,
  normalizeCrmPicklistLabel,
} from '@aglyn/aglyn/app-utils/crm'
import type { PluginDraftCheck } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import {
  CRM_FIELD_OPTION_MAX_LENGTH,
  CRM_FIELD_OPTIONS_MAX,
  type CrmFieldDefinitionDoc,
} from './crm-setup-content'
import { addPicklistValue, picklistAddableMeanings, picklistMeaningLabel } from './picklist-values'

/**
 * VALUES ADDED TO A CRM PICKLIST (AGL-3756): what a person adds in CRM →
 * Fields with a picklist's **Add value**, or by typing another line into a
 * Choice field's choices — as pure rules, for Aglyn AI's build.
 *
 * Two kinds of list take values, and the console extends both:
 *
 *  - every STANDARD picklist in `CRM_PICKLIST_DEFINITIONS` — lead status,
 *    lead source, a deal's type and contact role, a company's type,
 *    industry, rating and ownership, the salutation, and a task's status,
 *    priority, type and subject. An added value is `addPicklistValue`'s, the
 *    console's own move: a lead status or task status names its MEANING
 *    (never one the platform reserves, such as Qualified), a lead source may
 *    name its GROUP (Inbound or Outbound);
 *  - a custom CHOICE field's options, on the object it describes.
 *
 * ONLY ADDS. Nothing is removed, renamed, reordered, deactivated or
 * reactivated: a value already in the list, in any capitals, is left as it
 * is — an inactive one included, which the console would have the person
 * activate, so it is reported rather than touched. Asked twice, nothing is
 * added twice.
 */

/** The resource the CRM's picklist values writer is registered under. */
export const CRM_PICKLIST_VALUES_SETUP_RESOURCE = 'crm-picklist-values'

/** The `list` that names a custom Choice field rather than a standard picklist. */
export const CRM_CUSTOM_CHOICE_LIST = 'custom'

/** The most values one ask adds. */
export const CRM_PICKLIST_VALUES_SETUP_MAX = 50

/** Every `list` an ask may name: the standard picklists, then a custom Choice field. */
export const CRM_PICKLIST_VALUES_LISTS: readonly string[] = [...CRM_PICKLIST_IDS, CRM_CUSTOM_CHOICE_LIST]

/** Which list an ask adds to. */
export type CrmPicklistValuesTarget =
  | { kind: 'picklist'; id: CrmPicklistId }
  | { kind: 'custom'; object: CrmFieldObject; field: string }

/** One ask, read. */
export interface CrmPicklistValuesSetup {
  target: CrmPicklistValuesTarget
  /** The labels, normalized, without duplicates in any capitals, in the asked order. */
  values: string[]
  /** What each value means, on a picklist with meanings; `null` otherwise. */
  meaning: string | null
  /** The group each value is filed under, on a picklist with groups; `null` for none. */
  group: string | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

const lower = (value: string) => value.trim().toLowerCase()

/** A meaning named by its id or by how it reads ("Nurturing"), or `null`. */
function meaningNamed(definition: CrmPicklistDefinition, asked: string): string | null {
  const key = lower(asked)
  return (
    (definition.meanings ?? []).find(
      (meaning) => lower(meaning) === key || lower(picklistMeaningLabel(definition, meaning)) === key,
    ) ?? null
  )
}

/** A group named by its id or its label ("Inbound"), or `null`. */
function groupNamed(definition: CrmPicklistDefinition, asked: string): string | null {
  const key = lower(asked)
  return (definition.groups ?? []).find((group) => lower(group.id) === key || lower(group.label) === key)?.id ?? null
}

/** An ask's content, read and judged. Pure. */
export function readCrmPicklistValuesSetup(
  content: Readonly<Record<string, unknown>>,
): { ok: true; value: CrmPicklistValuesSetup } | { ok: false; problems: string[] } {
  const problems: string[] = []
  const list = text(content['list'])
  const definition = list === CRM_CUSTOM_CHOICE_LIST ? null : crmPicklistDefinition(list)
  if (list !== CRM_CUSTOM_CHOICE_LIST && !definition) {
    problems.push(`A list is one of ${CRM_PICKLIST_VALUES_LISTS.join(', ')}.`)
  }

  let target: CrmPicklistValuesTarget | null = definition ? { kind: 'picklist', id: definition.id as CrmPicklistId } : null
  if (list === CRM_CUSTOM_CHOICE_LIST) {
    const object = content['object']
    const field = text(content['field'])
    if (!isCrmFieldObject(object)) problems.push(`A custom Choice field is on one of ${CRM_FIELD_OBJECTS.join(', ')}.`)
    if (!field) problems.push('Name the custom Choice field the values go on.')
    if (isCrmFieldObject(object) && field) target = { kind: 'custom', object, field }
  }

  const maxLength = target?.kind === 'custom' ? CRM_FIELD_OPTION_MAX_LENGTH : 120
  const listed = Array.isArray(content['values']) ? content['values'] : []
  const values: string[] = []
  for (const entry of listed) {
    if (typeof entry !== 'string') {
      problems.push('Each value is a name.')
      break
    }
    const label = normalizeCrmPicklistLabel(entry).slice(0, maxLength)
    if (!label || values.some((one) => lower(one) === lower(label))) continue
    values.push(label)
  }
  if (!values.length) problems.push('Name at least one value to add.')
  if (values.length > CRM_PICKLIST_VALUES_SETUP_MAX) {
    problems.push(`One ask adds at most ${CRM_PICKLIST_VALUES_SETUP_MAX} values.`)
  }

  let meaning: string | null = null
  let group: string | null = null
  if (definition) {
    const addable = picklistAddableMeanings(definition)
    if (definition.meanings?.length) {
      const askedMeaning = text(content['meaning'])
      meaning = askedMeaning ? meaningNamed(definition, askedMeaning) : null
      const names = addable.map((one) => picklistMeaningLabel(definition, one)).join(', ')
      if (meaning && definition.reservedMeanings?.includes(meaning)) {
        problems.push(`Only the platform sets ${picklistMeaningLabel(definition, meaning)}; an added ${definition.label.toLowerCase()} means one of: ${names}.`)
      } else if (!meaning) {
        problems.push(`Each ${definition.label.toLowerCase()} value means one of: ${names}. Say which.`)
      }
    }
    const askedGroup = text(content['group'])
    if (askedGroup && definition.groups?.length) {
      group = groupNamed(definition, askedGroup)
      if (!group) problems.push(`A ${definition.label.toLowerCase()} group is one of: ${definition.groups.map((one) => one.label).join(', ')}.`)
    }
  }

  if (problems.length || !target) return { ok: false, problems: problems.length ? problems : ['Name a list.'] }
  return { ok: true, value: { target, values, meaning, group } }
}

/** The writer's check: whether the content is an ask, with the list and values it adds. Pure. */
export function checkCrmPicklistValuesSetup(content: Readonly<Record<string, unknown>>): PluginDraftCheck {
  const read = readCrmPicklistValuesSetup(content)
  if (read.ok === false) return { ok: false, problems: read.problems }
  const { target, values } = read.value
  return {
    ok: true,
    facts: target.kind === 'picklist' ? { list: target.id, values } : { list: CRM_CUSTOM_CHOICE_LIST, object: target.object, field: target.field, values },
  }
}

/** What adding to a list comes to: the values added, those it already held, and those it holds inactive. */
export interface CrmPicklistValuesOutcome {
  added: string[]
  existing: string[]
  inactive: string[]
}

/**
 * The values a standard picklist gains, as the console's Add value adds them
 * one by one at the end of the list. Pure. A value the list holds, in any
 * capitals, is left as it is; the list's ceiling refuses the whole ask
 * rather than adding part of it.
 */
export function planCrmPicklistValues(
  definition: CrmPicklistDefinition,
  picklist: CrmPicklist,
  setup: Pick<CrmPicklistValuesSetup, 'values' | 'meaning' | 'group'>,
): ({ ok: true; picklist: CrmPicklist } & CrmPicklistValuesOutcome) | { ok: false; error: string } {
  let next = picklist
  const outcome: CrmPicklistValuesOutcome = { added: [], existing: [], inactive: [] }
  for (const label of setup.values) {
    const held = crmPicklistValueByLabel(next, label)
    if (held) {
      ;(held.active ? outcome.existing : outcome.inactive).push(held.label)
      continue
    }
    const move = addPicklistValue(definition, next, label, { group: setup.group, meaning: setup.meaning })
    if (move.ok === false) return { ok: false, error: move.error }
    next = move.picklist
    outcome.added.push(label)
  }
  return { ok: true, picklist: next, ...outcome }
}

/** What adding choices to a custom Choice field comes to. */
export type CrmCustomChoiceValuesPlan =
  | ({ ok: true; id: string; label: string; options: string[] } & CrmPicklistValuesOutcome)
  | { ok: false; status: 404 | 409; error: string }

/**
 * The choices a custom Choice field gains, appended as the drawer appends a
 * typed line. Pure. The field is the active one on the object with that
 * label or key, in any capitals; a choice it holds in any capitals is left
 * as it is, and the drawer's 50-choice ceiling refuses the whole ask.
 */
export function planCrmCustomChoiceValues(
  setup: Pick<CrmPicklistValuesSetup, 'values'> & { target: Extract<CrmPicklistValuesTarget, { kind: 'custom' }> },
  definitions: readonly CrmFieldDefinitionDoc[],
): CrmCustomChoiceValuesPlan {
  const { object, field } = setup.target
  const key = normalizeContactFieldKey(field)
  const noun = CRM_FIELD_OBJECT_LABELS[object].toLowerCase()
  const match = fieldDefinitionsForObject(definitions, object).find(
    (one) => !one.retiredAt && (lower(String(one.label ?? '')) === lower(field) || (key !== null && one.key === key)),
  )
  if (!match) {
    return {
      ok: false,
      status: 404,
      error: `There is no custom field “${field}” on ${noun}. Add it as a Choice field first.`,
    }
  }
  if (match.type !== 'select') {
    return { ok: false, status: 409, error: `“${match.label}” on ${noun} is not a Choice field, so it has no choices to add to.` }
  }
  const options = [...(match.options ?? [])]
  const outcome: CrmPicklistValuesOutcome = { added: [], existing: [], inactive: [] }
  for (const label of setup.values) {
    const held = options.find((one) => lower(one) === lower(label))
    if (held) {
      outcome.existing.push(held)
      continue
    }
    options.push(label)
    outcome.added.push(label)
  }
  if (options.length > CRM_FIELD_OPTIONS_MAX) {
    return {
      ok: false,
      status: 409,
      error: `“${match.label}” holds at most ${CRM_FIELD_OPTIONS_MAX} choices; it has ${match.options?.length ?? 0}.`,
    }
  }
  return { ok: true, id: match.$id, label: match.label, options, ...outcome }
}

/** Where a picklist's values are kept, for a refusal and a record's name: "Lead status (Leads)". */
export function crmPicklistValuesName(definition: CrmPicklistDefinition): string {
  return `${definition.label} (${CRM_PICKLIST_OBJECT_LABELS[definition.object]})`
}
