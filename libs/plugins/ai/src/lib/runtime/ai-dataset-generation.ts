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
import { runValidatedGeneration, type AiGenerationCheckResult, type AiValidatedGeneration } from './ai-doctrine'
import type { AiDoctrineViolation } from './ai-doctrine-validators'
import { aiLayoutArticles } from '../layout-language/ai-layout-copy'
import { aiTextNamesBrand } from '../model/ai-products'
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

/**
 * ZACH'S Q2 (AGL-4065): what a list the brief gives no entries for starts
 * with. `samples` (decided 2026-10-28): complete-looking SAMPLE records the
 * owner replaces, each marked a sample in Data, a dated list's dates set by
 * the platform (`aiDatasetSampleDates`), so the site looks complete and no
 * row is a placeholder. `empty`: the fields and no records, and the pages
 * say the entries are on the way. The rules, the tool's answer and the
 * pages' brief all follow this one switch.
 */
export const AI_DATASET_LIST_WITHOUT_ENTRIES: 'samples' | 'empty' = 'samples'

/** What a list the brief gives no entries for is told to hold (AGL-4065). */
const WITHOUT_ENTRIES_RULE =
  AI_DATASET_LIST_WITHOUT_ENTRIES === 'samples'
    ? 'Where the brief gives no entries for the list, write sample records the owner replaces, each marked sample: a complete entry of its kind, named in the brief’s own words (such as "Series Round 1 at Mill Creek" for a race team that rides at Mill Creek), its other values typical of it. This is the one place a record may give a value the brief does not, and a sample still gives no price, phone number, email, address, real person’s name or brand. Leave a date "" in a sample, for the platform to set, and name no month or date in it.'
    : 'Where the brief gives no entries for the list, give the fields and no records: an empty list is an answer, a numbered placeholder is not.'

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
        // AGL-4065: a race schedule with no dates came back as ten numbered placeholders.
        WITHOUT_ENTRIES_RULE,
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
  /**
   * The sections of one page that each list part of it (AGL-4065), and the
   * value of its planned field each lists: "Upcoming races" the records whose
   * Status is "Upcoming", "Past results" those whose Status is "Past".
   */
  split?: AiDatasetSplit
}

/** A page's lists of one dataset, each the records of one value of one field (AGL-4065). */
export interface AiDatasetSplit {
  /** The planned field, by name: "Status". */
  field: string
  /** The sections, in page order. */
  sections: string[]
  /** The value each section lists, by position. */
  values: string[]
}

/** Names as a sentence lists them: “A”, “B” and “C”. */
function listed(names: readonly string[], last: 'and' | 'or'): string {
  const quoted = names.map((name) => `“${name}”`)
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} ${last} ${quoted[quoted.length - 1]}` : (quoted[0] ?? '')
}

/** What a dataset is told of the sections that each list part of it (AGL-4065). */
export function aiDatasetSplitLine(split: AiDatasetSplit): string {
  return `Sections ${listed(split.sections, 'and')} list this dataset: its “${split.field}” field takes exactly ${listed(split.values, 'or')}.`
}

/** The user turn: the site's words, the dataset, and where it is shown. */
export function aiDatasetPrompt(input: AiDatasetPromptInput): string {
  return [
    'Brief:',
    input.brief.trim(),
    `Dataset: “${input.name}” — ${input.why.trim() || 'the site’s structured content'}`,
    `Planned fields: ${input.fields.length ? input.fields.map((field) => `“${field}”`).join(', ') : '(none: choose them)'}`,
    input.shownIn.length ? `Listed on: ${input.shownIn.join('; ')}.` : 'Listed on the site’s pages.',
    ...(input.split ? [aiDatasetSplitLine(input.split)] : []),
    input.recordPages
      ? 'Each record also gets a page of its own, so give each one enough to read: a sentence or two describing it.'
      : 'Each record is shown as a card, so keep its values short.',
  ].join('\n')
}

// ── No placeholder rows (AGL-4065) ─────────────────────────────────────

/**
 * The re-ask a dataset whose records are placeholders is answered with
 * (AGL-4065): the 2026-10-25 Rut Runners Racing start's "Race events" came
 * back as "Upcoming race 1 (details to be added)" to "Past race 5 (details to
 * be added)", because the rules forbid inventing a date and the first field
 * may not be empty.
 */
export const AI_DATASET_PLACEHOLDER_REASK =
  AI_DATASET_LIST_WITHOUT_ENTRIES === 'samples'
    ? "Every record names a real thing the brief gives, or is a sample marked sample: a complete entry of its kind in the brief's own words. Never a placeholder such as 'Upcoming race 1 (details to be added)', 'TBD', 'coming soon' or 'Item 1'."
    : "Every record names a real thing the brief gives. Where the brief gives no entries for this list — no dates, no names, no results — answer with the fields and ZERO records; never number placeholders like 'Upcoming race 1 (details to be added)'."

/** The code a dataset's placeholder records are refused under. */
export const AI_DATASET_PLACEHOLDER_CODE = 'placeholder-records'

/** A value that marks a gap for later rather than saying anything: in a name, a date or anywhere else. */
const PLACEHOLDER_TEXT =
  /\b(?:details?|dates?|info|information|names?)\s+(?:(?:to be|will be)\s+)?(?:added|confirmed|announced|determined|decided|filled)\b|\bto be (?:added|confirmed|announced|determined|decided)\b|\b(?:tbd|tba|t\.b\.[ad])(?![a-z])|\bcoming soon\b|\bplaceholder\b|\blorem\b|\b(?:sample|example|test|dummy) (?:record|entry|row|item|name)s?\b/i

/** A name that ends in a number, with any aside after it: "Upcoming race 1 (details to be added)". */
const NUMBERED_NAME = /^(.*?)\s*(?:#|no\.?\s*)?\d+\s*(?:\([^)]*\))?$/i

/** Words a numbered placeholder is made of besides the list's own: "Item 1", "Upcoming event 2", "New entry 3". */
const STAND_IN_WORDS = new Set(
  'item entry record row event name product thing option sample example test placeholder untitled new upcoming past next previous future current recent old'.split(' '),
)

/** A name's words as a stem compares them: lowercase, a plural's "-s" dropped. */
const stemWords = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))

/**
 * The records of a designed dataset that are placeholders (AGL-4065), by
 * position, which no site shows:
 *  - any value that marks a gap: "details to be added", "TBD", "coming soon";
 *  - a name that is a number after nothing but the list's own words and
 *    stand-in words: "Item 1", "Race 2", "Upcoming race 3", "New entry 4".
 * A course's "Level 1" to "Level 3" and a series' "Series Round 1 at
 * Lockhart" name things, and are kept. Pure.
 */
export function aiDatasetPlaceholderRecords(
  dataset: { fields: ReadonlyArray<{ name: string }>; records: ReadonlyArray<ReadonlyArray<string | undefined>> },
  name = '',
): number[] {
  const own = new Set([...stemWords(name), ...dataset.fields.flatMap((field) => stemWords(field.name))])
  return dataset.records.flatMap((values, index) => {
    if (values.some((value) => PLACEHOLDER_TEXT.test(value ?? ''))) return [index]
    const match = NUMBERED_NAME.exec((values[0] ?? '').replace(/\s+/g, ' ').trim())
    if (!match) return []
    const words = stemWords(match[1] ?? '')
    return words.every((word) => own.has(word) || STAND_IN_WORDS.has(word)) ? [index] : []
  })
}

/** An answer's fields and records as the placeholder test reads them, whatever else is wrong with it. */
function answerShape(answer: Record<string, unknown> | null | undefined): {
  fields: Array<{ name: string }>
  records: string[][]
} {
  const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
  const fields = (Array.isArray(answer?.['fields']) ? (answer?.['fields'] as unknown[]) : []).map((field) => ({
    name: text((field as Record<string, unknown> | null)?.['name']),
  }))
  const records = (Array.isArray(answer?.['records']) ? (answer?.['records'] as unknown[]) : []).map((record) => {
    const values = (record as Record<string, unknown> | null)?.['values']
    return Array.isArray(values) ? values.map(text) : []
  })
  return { fields, records }
}

/** Where a dataset is checked: its plan's fields, the words a claim may come from, and its name. */
export interface AiDatasetCheckContext {
  planned: readonly string[]
  merchantWords: string
  name: string
}

/**
 * A dataset's answer held to the tool's check and to naming real things
 * (AGL-4065): one with placeholder records is refused, with
 * {@link AI_DATASET_PLACEHOLDER_REASK} for the one re-ask. Pure.
 */
export function checkAiDatasetRecords(answer: Record<string, unknown>, context: AiDatasetCheckContext): AiGenerationCheckResult<AiDataset> {
  const checked = checkAiDataset(answer, context)
  const shape = answerShape(answer)
  const placeholders = aiDatasetPlaceholderRecords(shape, context.name)
  // A sample is of its kind, never of a make the brief does not name (AGL-4065).
  const rawRecords = Array.isArray(answer['records']) ? (answer['records'] as unknown[]) : []
  const branded = shape.records.flatMap((values, index) => {
    const sample = (rawRecords[index] as Record<string, unknown> | null)?.['sample'] === true
    const brand = sample ? values.map((value) => aiTextNamesBrand(value, context.merchantWords)).find(Boolean) : null
    return brand ? [{ index, brand }] : []
  })
  if (!placeholders.length && !branded.length) return checked
  const violations = [...checked.violations]
  const offending: Record<string, unknown> = { ...(checked.offending ?? {}) }
  if (placeholders.length) {
    violations.push({
      rule: null,
      code: AI_DATASET_PLACEHOLDER_CODE,
      message: AI_DATASET_PLACEHOLDER_REASK,
      paths: placeholders.map((index) => `records[${index}]`),
    } satisfies AiDoctrineViolation)
    for (const index of placeholders.slice(0, 3)) offending[`records[${index}]`] = shape.records[index]?.[0] ?? ''
  }
  for (const { index, brand } of branded) {
    violations.push({
      rule: null,
      code: 'sample-brand',
      message: `Sample record ${index + 1} names the make "${brand}", which the brief does not: a sample is of its kind, never of a brand.`,
      paths: [`records[${index}]`],
    })
  }
  return { value: null, violations, offending }
}

/**
 * A dataset answered with placeholders after its one re-ask, kept with the
 * records that name real things (AGL-4065) — however few, none included —
 * where nothing else in it breaks a rule; `null` otherwise. Pure.
 */
export function aiDatasetWithoutPlaceholders(answer: Record<string, unknown> | null | undefined, context: AiDatasetCheckContext): AiDataset | null {
  if (!answer) return null
  const drop = new Set(aiDatasetPlaceholderRecords(answerShape(answer), context.name))
  const records = Array.isArray(answer['records']) ? (answer['records'] as unknown[]) : []
  const kept = { ...answer, records: records.filter((_record, index) => !drop.has(index)) }
  // The fewest records a list is asked for is for one the brief fills; what is left of this one is what it gave.
  const checked = checkAiDataset(kept, { ...context, recordsMin: 1 })
  return checked.value && !checked.violations.length ? checked.value : null
}

/**
 * A designed dataset with any placeholder record taken out (AGL-4065), and
 * where the list starts with no samples (`AI_DATASET_LIST_WITHOUT_ENTRIES`
 * is `empty`), every sample too. Pure.
 */
export function aiDatasetRealRecords(dataset: AiDataset, name: string): AiDataset {
  const drop = new Set(aiDatasetPlaceholderRecords(dataset, name))
  if (AI_DATASET_LIST_WITHOUT_ENTRIES === 'empty') dataset.samples?.forEach((sample, index) => sample && drop.add(index))
  if (!drop.size) return dataset
  const keep = (_entry: unknown, index: number) => !drop.has(index)
  const { samples: all, ...rest } = dataset
  const samples = all?.filter(keep)
  return { ...rest, records: dataset.records.filter(keep), ...(samples?.some(Boolean) ? { samples } : {}) }
}

// ── A sample row's date (AGL-4065) ──────────────────────────────────────

/** A field whose name says it holds when a record happens. */
const DATE_FIELD = /\b(?:date|dates|day|when)\b/i

/** A field a record has only once it has happened: a race's result, a match's score. */
const OUTCOME_FIELD = /\b(?:results?|finish(?:ed)?|placings?|placed|winners?|scores?|outcome)\b/i

/** A value or a section's name that says its records are behind us. */
const PAST_WORDS = /\b(?:past|previous|completed|finished|results?|earlier|archived?|last season)\b/i

/** The days a sample's date steps by, and how far from the job's day the first falls: a season of weekends. */
export const AI_DATASET_SAMPLE_DATES = { stepDays: 21, leadDays: 14 } as const

const DAY_MS = 86_400_000

/** The Saturday on or after (`ahead`) or on or before a day, at noon UTC. */
function saturday(from: Date, ahead: boolean): Date {
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12))
  const shift = ahead ? (6 - day.getUTCDay() + 7) % 7 : -((day.getUTCDay() + 1) % 7)
  return new Date(day.getTime() + shift * DAY_MS)
}

/**
 * A dated list's SAMPLE records given real dates (AGL-4065): a sample the
 * brief gave no date for falls on a weekend of a season from the job's day —
 * the first Saturday at least two weeks out, then every three weeks — and a
 * sample that is behind us (its split value or the list says past: "Past
 * results") on the Saturdays as far back, the latest first, with no result
 * left on one still to come. Written as a visitor reads a date, in the
 * site's language. A record from the brief keeps its own date. Pure.
 */
export function aiDatasetSampleDates(
  dataset: AiDataset,
  options: { now: Date; language?: string | null; split?: AiDatasetSplit | null; pastOnly?: boolean },
): AiDataset {
  const samples = dataset.samples ?? []
  const dates = dataset.fields.flatMap((field, column) => (column > 0 && field.type === 'text' && DATE_FIELD.test(field.name) ? [column] : []))
  if (!samples.some(Boolean) || !dates.length) return dataset
  const splitColumn = options.split
    ? dataset.fields.findIndex((field) => field.name.trim().toLowerCase() === (options.split as AiDatasetSplit).field.trim().toLowerCase())
    : -1
  const outcomes = dataset.fields.flatMap((field, column) => (column > 0 && OUTCOME_FIELD.test(field.name) ? [column] : []))
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat(options.language || 'en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  } catch {
    format = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }
  const { stepDays, leadDays } = AI_DATASET_SAMPLE_DATES
  const firstAhead = saturday(new Date(options.now.getTime() + leadDays * DAY_MS), true)
  const firstBehind = saturday(new Date(options.now.getTime() - leadDays * DAY_MS), false)
  let ahead = 0
  let behind = 0
  return {
    ...dataset,
    records: dataset.records.map((values, index) => {
      if (!samples[index]) return [...values]
      const past = options.pastOnly || (splitColumn > 0 && PAST_WORDS.test(values[splitColumn] ?? ''))
      const at = past
        ? new Date(firstBehind.getTime() - behind++ * stepDays * DAY_MS)
        : new Date(firstAhead.getTime() + ahead++ * stepDays * DAY_MS)
      const said = format.format(at)
      return values.map((value, column) => (dates.includes(column) ? said : !past && outcomes.includes(column) ? '' : value))
    }),
  }
}

/** Whether every section that lists a dataset says its records are behind us ("Past results", "Race results"). */
export function aiDatasetListedAsPast(sections: readonly string[]): boolean {
  return sections.length > 0 && sections.every((section) => PAST_WORDS.test(section))
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
    check: (answer) => checkAiDatasetRecords(answer, { planned: input.fields, merchantWords: input.merchantWords, name: input.name }),
  }) as Promise<AiValidatedGeneration<AiDataset>>
}

/**
 * A designed dataset as the data plugin's `dataset` writer takes it: values by
 * field name. Its words' "a" and "an" agree with what follows them in English
 * (`aiLayoutArticles`, AGL-3988), as a page's do: the beta.270 Sugar Hollow
 * packages said "A easygoing session" in their records and on every page
 * that listed them.
 */
export function aiDatasetDraftContent(
  name: string,
  dataset: AiDataset,
  options: { recordPages: boolean; language?: string | null },
): Record<string, unknown> {
  const said = (value: string) => aiLayoutArticles(value, options.language)
  const records = dataset.records.map((values) => {
    const record: Record<string, unknown> = {}
    dataset.fields.forEach((field, column) => {
      const value = (values[column] ?? '').trim()
      if (!value) return
      if (field.type === 'list') {
        record[field.name] = value.split(AI_DATASET_LIST_SEPARATOR.trim()).map((part) => said(part.trim())).filter(Boolean)
      } else if (field.type === 'number' || field.type === 'integer') {
        record[field.name] = value.replace(/,/g, '')
      } else if (field.type === 'text') {
        record[field.name] = said(value)
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
    // Which records are samples for the owner to replace (AGL-4065), which Data marks.
    ...(dataset.samples?.some(Boolean) ? { samples: dataset.records.map((_values, index) => dataset.samples?.[index] === true) } : {}),
    // A record page shows each record at an address made from its name.
    ...(options.recordPages && dataset.fields[0] ? { pageAddressFrom: dataset.fields[0].name } : {}),
  }
}
