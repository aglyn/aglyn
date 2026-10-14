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
  findInventedPrices,
  findStorefrontClaims,
  storefrontClaimViolations,
  type AiStorefrontCopySample,
} from '../model/ai-storefront-claims'
import type { AiTool } from '../providers/contract'
import type { AiGenerationCheckResult } from '../runtime/ai-doctrine'
import { AI_DATASET_SAID_NAME, detectOffVoiceCopy, type AiDoctrineViolation } from '../runtime/ai-doctrine-validators'

/**
 * The strict tool a site's datasets are designed through (AGL-3616), and the
 * check that holds each one to what the site publishes as its own words.
 *
 * A dataset is a menu, a team, a list of services or portfolio pieces: like
 * things, each a record a repeat shows on a page the day the site goes live.
 * So nothing in a record may mark a gap for later (no square brackets), link
 * anywhere, or say what nobody said: no review, testimonial, rating or quote,
 * no price the brief does not state, and the storefront copy rules hold every
 * value (no health, financial or legal promise; no award or certification the
 * brief does not give). The planned field names are kept, in order, because
 * the pages planned around the dataset already name them.
 */

export const AI_DATASET_TOOL_NAME = 'submit_dataset'

/** The field types a dataset's design may use: the data plugin writer's own words for them. */
export const AI_DATASET_FIELD_TYPES = ['text', 'number', 'integer', 'boolean', 'list'] as const
export type AiDatasetFieldType = (typeof AI_DATASET_FIELD_TYPES)[number]

/** A dataset's bounds, as the tool states them and its check holds them. */
export const AI_DATASET_LIMITS = {
  /** The most fields, the planned ones included. */
  fieldsMax: 12,
  /** The most fields it may add to the planned ones. */
  extraFieldsMax: 3,
  fieldNameMax: 40,
  recordsMin: 3,
  recordsMax: 12,
  /** The longest value; a description is a few sentences. */
  valueMax: 400,
} as const

/** What a list value's items are joined by inside one value. */
export const AI_DATASET_LIST_SEPARATOR = '; '

/** A designed dataset as its check reads it. */
export interface AiDataset {
  fields: Array<{ name: string; type: AiDatasetFieldType }>
  /** Each record's values in field order; an empty string is no value. */
  records: string[][]
}

const string = (description: string) => ({ type: 'string', description })

export const AI_DATASET_TOOL: AiTool = {
  name: AI_DATASET_TOOL_NAME,
  description: 'Design one dataset of this site: its typed fields and its first records. Every field is required.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['fields', 'records'],
    properties: {
      fields: {
        type: 'array',
        description: `The planned fields first, in order and named as planned, then at most ${AI_DATASET_LIMITS.extraFieldsMax} more; at most ${AI_DATASET_LIMITS.fieldsMax} in all.`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'type'],
          properties: {
            name: string(`Plain words, at most ${AI_DATASET_LIMITS.fieldNameMax} characters.`),
            type: {
              type: 'string',
              enum: [...AI_DATASET_FIELD_TYPES],
              description: 'text for words (a date or time too, written as a visitor reads it); number or integer for a figure; boolean for yes or no; list for a few short tags.',
            },
          },
        },
      },
      records: {
        type: 'array',
        description: `${AI_DATASET_LIMITS.recordsMin} to ${AI_DATASET_LIMITS.recordsMax} records.`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['values'],
          properties: {
            values: {
              type: 'array',
              description: `One value per field, in field order: "" where the brief gives nothing for it; a list's items joined by "${AI_DATASET_LIST_SEPARATOR}"; a boolean "yes" or "no".`,
              items: { type: 'string' },
            },
          },
        },
      },
    },
  },
}

interface Findings {
  violations: AiDoctrineViolation[]
  offending: Record<string, unknown>
}

function fail(findings: Findings, at: string, code: string, message: string, value: unknown): void {
  findings.violations.push({ rule: null, code, message, paths: [at] })
  if (!(at in findings.offending)) findings.offending[at] = value
}

const line = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

const HTML = /<\/?[a-z][^>]*>/i
const EMOJI = /\p{Extended_Pictographic}/u
const BRACKET = /[[\]]/
const URL = /\bhttps?:\/\/|\bwww\./i
/** A rating or review score nobody gave. */
const RATING = /\b\d(?:\.\d)?\s*(?:\/\s*(?:5|10)\b|out of (?:5|five|10|ten)\b|stars?\b)|\b(?:five|5|four|4)[- ]star\b|\brated\b/i
/** A field that would hold what customers said, which no job writes for them. */
const SAID_FIELD = AI_DATASET_SAID_NAME
/** A field holding a price, whose values must be the brief's own. */
const PRICE_FIELD = /\b(price|prices|cost|costs|fee|fees|rate|rates)\b/i
const NUMBER = /^-?\d+(?:\.\d+)?$/
const BOOLEAN = /^(yes|no|true|false)$/i

/** Where the records sit in the answer, as a violation names it. */
const RECORDS_AT = 'records'

/** A planned field name as names compare: case and spacing aside. */
const key = (name: string) => line(name).toLowerCase()

/**
 * A dataset's answer held to its plan and the copy rules. `planned` are the
 * field names the plan gave it; `merchantWords` are the brief and the site's
 * answers, the only source a stated claim or price may come from.
 */
export function checkAiDataset(
  answer: Record<string, unknown>,
  context: { planned: readonly string[]; merchantWords: string },
): AiGenerationCheckResult<AiDataset> {
  const findings: Findings = { violations: [], offending: {} }
  const limits = AI_DATASET_LIMITS
  const fields: AiDataset['fields'] = []
  const rawFields = Array.isArray(answer['fields']) ? (answer['fields'] as unknown[]) : []
  if (!rawFields.length) fail(findings, 'fields', 'missing', 'The dataset needs its fields.', answer['fields'])
  rawFields.forEach((raw, index) => {
    const entry = (raw ?? {}) as Record<string, unknown>
    const name = line(entry['name'])
    const type = entry['type'] as AiDatasetFieldType
    const at = `fields[${index}]`
    if (!name) return fail(findings, at, 'missing', 'Each field needs a name.', raw)
    if (name.length > limits.fieldNameMax) fail(findings, at, 'too-long', `The field "${name}" has a name longer than ${limits.fieldNameMax} characters.`, raw)
    if (!AI_DATASET_FIELD_TYPES.includes(type)) fail(findings, at, 'type', `The field "${name}" is one of ${AI_DATASET_FIELD_TYPES.join(', ')}.`, raw)
    if (fields.some((field) => key(field.name) === key(name))) fail(findings, at, 'duplicate', `Two fields are both called "${name}".`, raw)
    if (SAID_FIELD.test(name)) {
      fail(findings, at, 'said-field', `A dataset holds no "${name}": what customers say is theirs to write, never the site's.`, raw)
    }
    fields.push({ name, type })
  })
  if (fields.length > limits.fieldsMax) fail(findings, 'fields', 'too-many', `A dataset has at most ${limits.fieldsMax} fields.`, answer['fields'])
  const planned = context.planned.map(line).filter(Boolean)
  const missing = planned.filter((name) => !fields.some((field) => key(field.name) === key(name)))
  if (missing.length) {
    fail(findings, 'fields', 'planned-field', `Keep the planned fields, named as planned: ${missing.map((name) => `"${name}"`).join(', ')}.`, answer['fields'])
  } else if (fields.length - planned.length > limits.extraFieldsMax) {
    fail(findings, 'fields', 'too-many', `Add at most ${limits.extraFieldsMax} fields to the planned ones.`, answer['fields'])
  }
  if (fields[0] && fields[0].type !== 'text') {
    fail(findings, 'fields[0]', 'first-field', 'The first field names each record, so it is text.', rawFields[0])
  }

  const rawRecords = Array.isArray(answer['records']) ? (answer['records'] as unknown[]) : []
  if (rawRecords.length < limits.recordsMin || rawRecords.length > limits.recordsMax) {
    fail(findings, RECORDS_AT, 'count', `Write ${limits.recordsMin} to ${limits.recordsMax} records; this has ${rawRecords.length}.`, answer['records'])
  }
  const records: string[][] = []
  const samples: AiStorefrontCopySample[] = []
  const names = new Set<string>()
  rawRecords.forEach((raw, index) => {
    const at = `records[${index}]`
    const values = Array.isArray((raw as Record<string, unknown> | null)?.['values'])
      ? ((raw as Record<string, unknown>)['values'] as unknown[]).map((value) => line(value))
      : []
    if (values.length !== fields.length) {
      fail(findings, at, 'values', `Record ${index + 1} has ${values.length} values for ${fields.length} fields; give one per field, "" where there is none.`, raw)
    }
    const first = values[0] ?? ''
    if (!first) fail(findings, at, 'unnamed', `Record ${index + 1} has no ${fields[0]?.name ?? 'name'}.`, raw)
    else if (names.has(first.toLowerCase())) fail(findings, at, 'duplicate', `Two records are both "${first}".`, raw)
    names.add(first.toLowerCase())
    values.forEach((value, column) => {
      const field = fields[column]
      if (!value || !field) return
      const where = `${at}.values[${column}]`
      if (value.length > limits.valueMax) fail(findings, where, 'too-long', `"${field.name}" of record ${index + 1} is longer than ${limits.valueMax} characters.`, value)
      if (HTML.test(value) || EMOJI.test(value) || URL.test(value)) {
        fail(findings, where, 'markup', `"${field.name}" of record ${index + 1} is plain words, with no link, markup or emoji.`, value)
      }
      if (BRACKET.test(value)) {
        fail(findings, where, 'bracket', `"${field.name}" of record ${index + 1} is published as written, so it marks no missing fact: leave the value "" instead.`, value)
      }
      if ((field.type === 'number' || field.type === 'integer') && !NUMBER.test(value.replace(/,/g, ''))) {
        fail(findings, where, 'number', `"${field.name}" of record ${index + 1} is a number, or "".`, value)
      }
      if (field.type === 'boolean' && !BOOLEAN.test(value)) fail(findings, where, 'boolean', `"${field.name}" of record ${index + 1} is "yes", "no" or "".`, value)
      if (PRICE_FIELD.test(field.name) && !context.merchantWords.includes(value.replace(/[^\d.]/g, '') || '\u0000')) {
        fail(findings, where, 'price-invented', `"${field.name}" of record ${index + 1} states a price the brief does not give; leave it "".`, value)
      }
      const rating = RATING.exec(value)
      if (rating && !context.merchantWords.toLowerCase().includes(rating[0].toLowerCase())) {
        fail(findings, where, 'rating-invented', `Record ${index + 1} gives a rating or review nobody gave. Remove: "${rating[0]}".`, value)
      }
      if (field.type === 'text') samples.push({ at: where, text: value })
    })
    records.push(values)
  })
  findings.violations.push(
    ...storefrontClaimViolations(
      findStorefrontClaims(samples, context.merchantWords),
      findInventedPrices(samples, context.merchantWords),
    ),
    ...detectOffVoiceCopy(samples, null),
  )
  return {
    value: findings.violations.length ? null : { fields, records },
    violations: findings.violations,
    offending: findings.offending,
  }
}
