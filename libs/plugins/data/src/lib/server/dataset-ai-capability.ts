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
  registerPluginAiCapability,
  type PluginAiCapability,
  type PluginAiCapabilityArgs,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  DATASET_DRAFT_FIELD_NAME_MAX,
  DATASET_DRAFT_FIELD_TYPES,
  DATASET_DRAFT_FIELDS_MAX,
  DATASET_DRAFT_NAME_MAX,
  DATASET_DRAFT_RECORDS_MAX,
  DATASET_DRAFT_RESOURCE,
  type DatasetDraftFieldType,
} from './dataset-drafts'

/**
 * WHAT AN AI BUILD CAN MAKE IN DATA (AGL-3616): a dataset with typed fields
 * and its first records.
 *
 * The capability the AI plugin's build planner offers for "add a menu page"
 * or "list our team": structured content kept as records rather than written
 * into a page, so the owner edits one row and every page listing it follows.
 * Its item is written by this plugin's `dataset` draft writer, so every rule
 * is the writer's: `dataStore` (Starter and up), `datasetsPerOrg`,
 * `release_data_store`, the member's role, and the model every record is
 * held to.
 *
 * The arguments are flat, as the contract requires: each field as
 * `Name:type`, and each record as its values in field order joined by ` | `,
 * which `draftContent` turns into the writer's records. The planner fills
 * them in, so no model runs (`estimateCredits` 0).
 */

/** The operation's name in a build plan. */
export const DATASET_AI_OP = 'dataset'

/** What separates one value of a record from the next in its argument. */
export const DATASET_AI_VALUE_SEPARATOR = ' | '

/** What separates the items of a list value inside one record value. */
const LIST_SEPARATOR = /\s*;\s*/

/** The longest one record's argument may be. */
const DATASET_AI_RECORD_MAX = 600

const TYPES = Object.keys(DATASET_DRAFT_FIELD_TYPES) as DatasetDraftFieldType[]

/** `"Price:number"` → `{ name: 'Price', type: 'number' }`; a type it does not know reads as text. */
export function datasetAiFieldOf(spec: string): { name: string; type: DatasetDraftFieldType } {
  const at = spec.lastIndexOf(':')
  const type = at > 0 ? spec.slice(at + 1).trim().toLowerCase() : ''
  if (at > 0 && (TYPES as readonly string[]).includes(type)) {
    return { name: spec.slice(0, at).trim(), type: type as DatasetDraftFieldType }
  }
  return { name: spec.trim(), type: 'text' }
}

/** The writer's content for an item. Pure. */
export function datasetDraftContentFromArgs(args: PluginAiCapabilityArgs): Readonly<Record<string, unknown>> {
  const specs = Array.isArray(args['fields']) ? (args['fields'] as readonly string[]) : []
  const fields = specs.map(datasetAiFieldOf).filter((field) => field.name)
  const rows = Array.isArray(args['records']) ? (args['records'] as readonly string[]) : []
  const records = rows.map((row) => {
    const values = row.split(DATASET_AI_VALUE_SEPARATOR.trim()).map((value) => value.trim())
    const record: Record<string, unknown> = {}
    fields.forEach((field, index) => {
      const value = values[index] ?? ''
      if (!value) return
      record[field.name] = field.type === 'list' ? value.split(LIST_SEPARATOR).filter(Boolean) : value
    })
    return record
  })
  const address = typeof args['pageAddressFrom'] === 'string' ? args['pageAddressFrom'].trim() : ''
  return {
    ...(typeof args['name'] === 'string' ? { name: args['name'] } : {}),
    fields,
    records: records.filter((record) => Object.keys(record).length),
    ...(address ? { pageAddressFrom: address } : {}),
  }
}

export const datasetAiCapability: PluginAiCapability = {
  op: DATASET_AI_OP,
  noun: 'dataset',
  where: 'Data, as a dataset with its first records',
  intents: [
    'a list of like things kept as records the owner edits in one place — a menu, a team, services, portfolio pieces, events, FAQs, locations — with typed fields and its first records from the request',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'What the dataset is called, e.g. "Menu" or "Team".', maxLength: DATASET_DRAFT_NAME_MAX },
      fields: {
        type: 'array',
        description: `Each field as Name:type, type one of ${TYPES.join('|')}; a date or time is text, written the way a visitor reads it. The first text field names each record.`,
        items: { type: 'string', maxLength: DATASET_DRAFT_FIELD_NAME_MAX + 10 },
        maxItems: DATASET_DRAFT_FIELDS_MAX,
      },
      records: {
        type: 'array',
        description:
          `The first records, each its values in field order joined by "${DATASET_AI_VALUE_SEPARATOR}" (a list's items joined by "; "), from what the request says. ` +
          'Leave a value empty rather than invent it: never a review, testimonial, rating, quote, price or person’s name the request does not give.',
        items: { type: 'string', maxLength: DATASET_AI_RECORD_MAX },
        maxItems: DATASET_DRAFT_RECORDS_MAX,
      },
      pageAddressFrom: {
        type: 'string',
        description: 'Only where a page shows each record at its own address: the text field its address is made from, e.g. "Name".',
        maxLength: DATASET_DRAFT_FIELD_NAME_MAX,
      },
    },
    required: ['name', 'fields'],
    additionalProperties: false,
  },
  maxPerPlan: 3,
  // Free includes no data store (`datasetsPerOrg: 0`).
  freeAllowed: false,
  feature: 'dataStore',
  quota: 'datasetsPerOrg',
  draftResource: DATASET_DRAFT_RESOURCE,
  // Written without a model: the planner already filled the arguments.
  estimateCredits: () => 0,
  degrade: 'omit',
  draftContent: (item) => datasetDraftContentFromArgs(item.args),
}

/**
 * Registers the capability; the console surface calls it beside the writer,
 * since only the console runs AI jobs (AGL-3026). Idempotent.
 */
export function registerDatasetAiCapability(): void {
  registerPluginAiCapability(datasetAiCapability, { pluginId: BUNDLE_ID })
}
