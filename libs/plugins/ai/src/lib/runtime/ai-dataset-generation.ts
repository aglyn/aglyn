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

import type { AiStepKind } from '../providers/catalog'
import type { AiProvider } from '../providers/contract'
import { AI_ROUTING_TABLE, type AiPluginSettings } from '../providers/routing'
import {
  AI_DATASET_LIMITS,
  AI_DATASET_LIST_SEPARATOR,
  AI_DATASET_TOOL,
  AI_DATASET_TOOL_NAME,
  checkAiDataset,
  type AiDataset,
} from '../tools/ai-dataset-tool'
import { runValidatedGeneration, type AiValidatedGeneration } from './ai-doctrine'
import type { AiSystemBlock } from './ai-runtime'

/**
 * A SITE'S DATASETS (AGL-3616): the typed fields and first records of one
 * dataset a site plan created, through the doctrine's generation call and the
 * strict `submit_dataset` tool. The data plugin's writer stores what it
 * answers; nothing here writes.
 *
 * Routed as `job.products`, the row a store's first products are proposed on
 * (no thinking, a structured list from a brief, held to the storefront claim
 * rules): one dataset of a dozen records is the same work. Its answer is held
 * to a ceiling of its own under that row's. The rules are cached and
 * byte-identical; the site's words, the dataset and the pages that show it
 * ride in the user turn.
 */

/** The step a dataset is routed as. */
export const AI_DATASET_STEP: AiStepKind = 'job.products'

/**
 * One dataset's answer ceiling: twelve fields and twelve records of a few
 * sentences each, written as JSON, about 9,000 characters at three a token
 * with room; under the routing row's.
 */
export const AI_DATASET_MAX_TOKENS = Math.min(4_000, AI_ROUTING_TABLE[AI_DATASET_STEP].maxTokens)

/** The generation kind a dataset is asked under, which the doctrine scopes. */
export const AI_DATASET_KIND = 'dataset'

/** The rules for one dataset. Byte-identical on every request. */
export const AI_DATASET_INSTRUCTIONS: AiSystemBlock[] = [
  {
    text:
      'You design one dataset of a new website: a list of like things — a menu, a team, services, portfolio pieces, events, questions and answers — kept as records the owner edits in one place, which the site’s pages list.\n\n' +
      `Answer by calling ${AI_DATASET_TOOL_NAME} exactly once. A reply in prose cannot be used.\n\n` +
      'Rules:\n' +
      [
        'Keep the planned fields, in order and named exactly as planned; the pages around the dataset already name them. Add a field only where the records clearly need it.',
        'Type each field: text for words, including a date or a time written the way a visitor reads it; number or integer only for a figure a visitor compares; boolean for yes or no; list for a few short tags. The first field names each record and is text.',
        `Write ${AI_DATASET_LIMITS.recordsMin} to ${AI_DATASET_LIMITS.recordsMax} records, as many as the brief supports: what the business actually offers, in its own words where the brief gives them, otherwise plain and general enough to be true of it.`,
        'Never invent a fact: no price, date, address, phone number, award, credential, client or number the brief does not give, and no review, testimonial, rating or quote from anyone. Leave a value "" rather than make one up.',
        'Never give a person a name the brief does not give: a team member the brief does not name is their role, such as "Head chef".',
        'Never say anything cures, treats, heals or prevents anything, and never promise a health, financial or legal result.',
        `Values are plain text with no links, markup, emoji or square brackets, at most ${AI_DATASET_LIMITS.valueMax} characters each; a description is one to three sentences.`,
        'Write in the language of the brief.',
      ]
        .map((rule) => `- ${rule}`)
        .join('\n'),
    cacheBreakpoint: true,
  },
]

export interface AiDatasetPromptInput {
  /** The site's words: the brief and its answers, as a unit's brief carries them. */
  brief: string
  /** The dataset as the plan named it, and why it has one. */
  name: string
  why: string
  /** The field names the plan gave it. */
  fields: readonly string[]
  /** The sections that list it, by page: "Menu › Our dishes (12 items)". */
  shownIn: readonly string[]
  /** Whether each record also gets a page of its own. */
  recordPages: boolean
}

/** The user turn: the site's words, the dataset, and where it is shown. */
export function aiDatasetPrompt(input: AiDatasetPromptInput): string {
  return [
    'Brief:',
    input.brief.trim(),
    `Dataset: “${input.name}” — ${input.why.trim() || 'the site’s structured content'}`,
    `Planned fields: ${input.fields.length ? input.fields.map((field) => `“${field}”`).join(', ') : '(none: choose them)'}`,
    input.shownIn.length ? `Listed on: ${input.shownIn.join('; ')}.` : 'Listed on the site’s pages.',
    input.recordPages
      ? 'Each record also gets a page of its own, so give each one enough to read: a sentence or two describing it.'
      : 'Each record is shown as a card, so keep its values short.',
  ].join('\n')
}

export interface GenerateAiDatasetInput extends AiDatasetPromptInput {
  /** What a claim or a price may be quoted from: the brief and the site's answers. */
  merchantWords: string
  settings?: AiPluginSettings
  model?: string
  maxTokens?: number
  signal?: AbortSignal
  provider?: AiProvider
}

/** Design one dataset. It writes nothing to the site. */
export function generateAiDataset(input: GenerateAiDatasetInput): Promise<AiValidatedGeneration<AiDataset>> {
  const row = AI_ROUTING_TABLE[AI_DATASET_STEP]
  return runValidatedGeneration(AI_DATASET_KIND, {
    step: AI_DATASET_STEP,
    ...(input.settings ? { settings: input.settings } : {}),
    ...(input.model ? { model: input.model } : {}),
    instructions: AI_DATASET_INSTRUCTIONS,
    messages: [{ role: 'user', content: aiDatasetPrompt(input) }],
    tool: AI_DATASET_TOOL,
    maxTokens: input.maxTokens ?? AI_DATASET_MAX_TOKENS,
    ...(row.thinking ? { thinking: row.thinking } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    check: (answer) => checkAiDataset(answer, { planned: input.fields, merchantWords: input.merchantWords }),
  }) as Promise<AiValidatedGeneration<AiDataset>>
}

/** A designed dataset as the data plugin's `dataset` writer takes it: values by field name. */
export function aiDatasetDraftContent(
  name: string,
  dataset: AiDataset,
  options: { recordPages: boolean },
): Record<string, unknown> {
  const records = dataset.records.map((values) => {
    const record: Record<string, unknown> = {}
    dataset.fields.forEach((field, column) => {
      const value = (values[column] ?? '').trim()
      if (!value) return
      if (field.type === 'list') {
        record[field.name] = value.split(AI_DATASET_LIST_SEPARATOR.trim()).map((part) => part.trim()).filter(Boolean)
      } else if (field.type === 'number' || field.type === 'integer') {
        record[field.name] = value.replace(/,/g, '')
      } else {
        record[field.name] = value
      }
    })
    return record
  })
  return {
    name,
    fields: dataset.fields.map((field) => ({ name: field.name, type: field.type })),
    records,
    // A record page shows each record at an address made from its name.
    ...(options.recordPages && dataset.fields[0] ? { pageAddressFrom: dataset.fields[0].name } : {}),
  }
}
