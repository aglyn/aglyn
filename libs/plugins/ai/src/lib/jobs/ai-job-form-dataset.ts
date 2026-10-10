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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  collectFormFieldNodeIds,
  FORM_COMPONENT_ID,
  isMarketingConsentFieldName,
} from '@aglyn/aglyn/app-utils/forms'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { AI_DATASET_DRAFT_RESOURCE } from './ai-build-unit-outcome'

/**
 * A FORM THAT WRITES TO A DATASET (AGL-3616; Zach, 2026-10-10: Aglyn AI's
 * forms can write to datasets — a volunteer sign-up into a Volunteers
 * dataset, an RSVP into an event's attendees, a catering enquiry into
 * Enquiries).
 *
 * The plan says which dataset a form writes to (`writesTo` on its creation);
 * it is never inferred from what a section places. The dataset is built
 * first — a site start's dataset unit, a build's dataset item, or one the
 * site already has — and the form step binds the form it generated the way a
 * person binds one on the Form element: the form node's `datasetId`, and
 * each Form Field's `datasetFieldId` where the dataset has a field of the
 * same name and a type the submitted value can be stored as. A field the
 * dataset lacks is left unbound, as the Form element's mapping leaves one:
 * its value stays in the Inbox copy, and a form never adds a field to a
 * dataset.
 *
 * The gates are the platform's. The binding is made only where the plan
 * includes the data store (`dataStore`), the data plugin's writer is loaded
 * here and reads the dataset, and the dataset is one this job made or one the
 * site's inventory shows. Records, their allowance and storage are held at
 * each submission by the data plugin's own record target. Anywhere else the
 * form is the form it always was, its submissions in the Inbox.
 */

/** The unit input a dataset this job made for the form rides in, by id. */
export const AI_FORM_DATASET_MADE_INPUT = 'formDatasetMade'

/** One field of the dataset a form writes to, as its writer reports it: storage type words. */
export interface AiFormDatasetField {
  id: string
  name: string
  type: string
}

/** The dataset a form writes to, with the fields a submission may fill. */
export interface AiFormDataset {
  id: string
  name: string
  fields: AiFormDatasetField[]
}

/** A field name as two spellings of it compare: `fullName`, `full_name` and "Full name" are one. */
export function aiFormFieldKey(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

const NUMBER_TYPES = new Set(['float', 'int32', 'int64', 'number', 'integer'])

/**
 * Whether a submitted value of this form field type can be stored in a
 * dataset field of this storage type. Every value a form submits is text, so
 * a text field takes any of them and a number field takes a rating; any
 * other pairing is left unbound rather than refused at every submission.
 */
export function aiFormFieldFitsDataset(fieldType: string, datasetType: string): boolean {
  if (datasetType === 'text') return true
  if (NUMBER_TYPES.has(datasetType)) return fieldType === 'rating'
  return false
}

/** What a binding came to: the fields bound, and the fields the dataset has no place for. */
export interface AiFormDatasetBinding {
  bound: string[]
  unbound: string[]
}

/**
 * Binds a form design to a dataset, in place: the form node's `datasetId`,
 * and `datasetFieldId` on each Form Field the dataset has a field for, by its
 * `fieldName` or its label, each dataset field taken once. The platform's
 * consent field is never bound. A binding the design already carried is
 * replaced, so what the model drew never chooses where a record lands.
 */
export function aiBindFormToDataset(
  nodes: NodesMap,
  formNodeId: string,
  dataset: AiFormDataset,
): AiFormDatasetBinding {
  const result: AiFormDatasetBinding = { bound: [], unbound: [] }
  const form = nodes[formNodeId]
  if (form?.componentId !== FORM_COMPONENT_ID) return result
  const props = { ...((form.props ?? {}) as Record<string, unknown>) }
  delete props['datasetName']
  props['datasetId'] = dataset.id
  form.props = props as never
  const taken = new Set<string>()
  for (const id of collectFormFieldNodeIds(nodes as never, formNodeId)) {
    const field = nodes[id]
    if (!field) continue
    const fieldProps = { ...((field.props ?? {}) as Record<string, unknown>) }
    delete fieldProps['datasetFieldId']
    field.props = fieldProps as never
    const fieldName = String(fieldProps['fieldName'] ?? '').trim()
    if (!fieldName || isMarketingConsentFieldName(fieldName)) continue
    const label = String(fieldProps['label'] ?? '').trim()
    const fieldType = String(fieldProps['fieldType'] ?? 'text')
    // Its name first, then its label: `fullName` is "Full name" before "Your name" is.
    const matching = (key: string) =>
      key
        ? dataset.fields.find((one) => !taken.has(one.id) && aiFormFieldKey(one.name) === key && aiFormFieldFitsDataset(fieldType, one.type))
        : undefined
    const match = matching(aiFormFieldKey(fieldName)) ?? matching(aiFormFieldKey(label))
    if (!match) {
      result.unbound.push(label || fieldName)
      continue
    }
    taken.add(match.id)
    fieldProps['datasetFieldId'] = match.id
    result.bound.push(fieldName)
  }
  return result
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export interface AiFormDatasetReadDeps {
  writerFor?: typeof pluginResourceDraftWriter
}

/**
 * The dataset a form may write to, or `null` where it may not: the plan
 * includes no data store, the data plugin's writer is not loaded here, the
 * dataset is neither one this job made nor one the site's inventory shows,
 * or it has no field a submission could fill.
 */
export async function aiReadFormDataset(
  input: {
    hostId: string
    id: string | null | undefined
    org: object | null
    inventory: Pick<AiSiteInventory, 'datasets'> | null
    /** The dataset this job made for the form, by id. */
    madeId?: unknown
  },
  deps: AiFormDatasetReadDeps = {},
): Promise<AiFormDataset | null> {
  const id = str(input.id)
  if (!id) return null
  if (!checkEntitlement(input.org as never, 'dataStore')) return null
  const known = id === str(input.madeId) || (input.inventory?.datasets ?? []).some((row) => row.id === id)
  if (!known) return null
  const keeper = (deps.writerFor ?? pluginResourceDraftWriter)(AI_DATASET_DRAFT_RESOURCE)
  if (!keeper) return null
  const record = await keeper.writer.read({ hostId: input.hostId, id }).catch((error: unknown) => {
    console.error('ai form: the dataset it writes to could not be read', { hostId: input.hostId, id, error })
    return null
  })
  if (!record) return null
  const facts = (record.facts ?? {}) as { fields?: unknown; addressField?: unknown }
  const address = str(facts.addressField)
  const fields = (Array.isArray(facts.fields) ? (facts.fields as unknown[]) : [])
    .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
    .map((raw) => ({ id: str(raw['id']), name: str(raw['name']), type: str(raw['type']) || 'text' }))
    .filter((field) => field.id && field.name && field.id !== address)
  if (!fields.length) return null
  return { id, name: str(record.name) || 'dataset', fields }
}

/** What the form's generation is told about the dataset it writes to. */
export function aiFormDatasetPromptLine(dataset: AiFormDataset): string {
  const fields = dataset.fields.map((field) => `${field.name} (${NUMBER_TYPES.has(field.type) ? 'a number' : 'text'})`)
  return `Each submission is also saved as a record of the dataset “${dataset.name}”, whose fields are: ${fields.join(', ')}. Draw a field for each one a visitor can answer, labelled with the field's name.`
}

/** What the form's row says about where its submissions are also saved. */
export function aiFormDatasetNote(dataset: AiFormDataset, binding: AiFormDatasetBinding): string {
  const kept = `Each submission is also saved as a record of the “${dataset.name}” dataset, in Data.`
  if (!binding.unbound.length) return kept
  const one = binding.unbound.length === 1
  return `${kept} The dataset has no field for ${binding.unbound.map((name) => `“${name}”`).join(', ')}, so ${
    one ? 'that answer stays' : 'those answers stay'
  } in the Inbox only.`
}
