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

import { CRM_MERGE_FIELDS, crmMergeFieldsIn } from '@aglyn/aglyn/app-utils/crm-email-templates'
import type { ConsoleImportColumn } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import {
  AI_CRM_LIMITS,
  type AiCrmColumnMatch,
  type AiCrmNextStep,
  type AiCrmRecordKind,
} from '../model/ai-crm'
import type { AiTool } from '../providers/contract'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'

/**
 * The strict tools CRM by AI answers through (AGL-2917), and the checks that
 * hold each answer to what the CRM can take.
 *
 * - `propose_record_insight` — a record's summary, and by kind: the next step
 *   as a task (a contact, company or deal), a stage (a deal), a lead's
 *   standing. One schema per kind, so no answer carries a field its record
 *   cannot use, and each keeps its nullable fields to the one or two a member
 *   may legitimately be offered nothing for.
 * - `propose_email_draft` — a subject and a plain-text message.
 * - `propose_column_matches` — the columns of a file matched to import fields.
 *
 * A strict schema forbids extra keys, requires every key, says "no value" with
 * `null`, and accepts no length keyword, so every length is stated in a
 * description and enforced here. A check returns a value only when nothing in
 * the answer is broken, and otherwise the violations and the parts at fault,
 * for the generation call's one re-ask.
 */

export const AI_CRM_RECORD_TOOL_NAME = 'propose_record_insight'
export const AI_CRM_EMAIL_TOOL_NAME = 'propose_email_draft'
export const AI_CRM_MAPPING_TOOL_NAME = 'propose_column_matches'

const TASK_KINDS = ['call', 'email', 'meeting', 'todo'] as const
const PRIORITIES = ['low', 'normal', 'high'] as const

const string = (description: string) => ({ type: 'string', description })

const NEXT_STEP_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      properties: {
        title: string(`The task, starting with a verb. At most ${AI_CRM_LIMITS.taskTitle} characters.`),
        kind: { type: 'string', enum: [...TASK_KINDS] },
        priority: { type: 'string', enum: [...PRIORITIES] },
        dueInDays: {
          type: 'integer',
          description: `Days from today it is due, from 0 to ${AI_CRM_LIMITS.dueInDays}.`,
        },
        reason: string(`Why, naming the fact behind it. At most ${AI_CRM_LIMITS.reason} characters.`),
      },
      required: ['title', 'kind', 'priority', 'dueInDays', 'reason'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
}

const STAGE_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      properties: {
        stageId: string('The id of an open stage the facts list, other than the current one.'),
        reason: string(`The fact that shows the deal moved. At most ${AI_CRM_LIMITS.reason} characters.`),
      },
      required: ['stageId', 'reason'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
}

/** The record tool for one kind of record. */
export function aiCrmRecordTool(kind: AiCrmRecordKind): AiTool {
  const summary = string(`Where the relationship stands. At most ${AI_CRM_LIMITS.summary} characters and two sentences.`)
  const properties: Record<string, unknown> =
    kind === 'lead'
      ? {
          summary,
          standing: string(
            `Why the lead stands where it does. At most ${AI_CRM_LIMITS.standing} characters and two sentences.`,
          ),
        }
      : kind === 'deal'
        ? { summary, nextStep: NEXT_STEP_SCHEMA, stage: STAGE_SCHEMA }
        : { summary, nextStep: NEXT_STEP_SCHEMA }
  return {
    name: AI_CRM_RECORD_TOOL_NAME,
    description: 'Propose what a team member reads about one CRM record, and what to do next. Every field is required.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  }
}

export const AI_CRM_EMAIL_TOOL: AiTool = {
  name: AI_CRM_EMAIL_TOOL_NAME,
  description: 'Propose one email for a team member to review, edit and send themselves.',
  strict: true,
  inputSchema: {
    type: 'object',
    properties: {
      subject: string(`One line. At most ${AI_CRM_LIMITS.subject} characters.`),
      body: string(
        `Plain text in short paragraphs separated by a blank line. At most ${AI_CRM_LIMITS.body.toLocaleString('en-US')} characters.`,
      ),
    },
    required: ['subject', 'body'],
    additionalProperties: false,
  },
}

export const AI_CRM_MAPPING_TOOL: AiTool = {
  name: AI_CRM_MAPPING_TOOL_NAME,
  description: 'Propose which columns of the file fill which fields. Leave out a column no field fits.',
  strict: true,
  inputSchema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            column: { type: 'integer', description: 'The column’s number, as the request lists it.' },
            field: { type: 'integer', description: 'The field’s number, as the request lists it.' },
          },
          required: ['column', 'field'],
          additionalProperties: false,
        },
      },
    },
    required: ['matches'],
    additionalProperties: false,
  },
}

/* ------------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------------ */

export interface AiCrmCheckResult<T> {
  value: T | null
  violations: AiDoctrineViolation[]
  offending?: Record<string, unknown>
}

const violation = (code: string, message: string, path?: string): AiDoctrineViolation => ({
  rule: null,
  code,
  message,
  ...(path ? { paths: [path] } : {}),
})

const collapse = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/** A required text field held to its length; the value, or a violation. */
function textField(
  answer: Record<string, unknown>,
  key: string,
  label: string,
  max: number,
  violations: AiDoctrineViolation[],
  offending: Record<string, unknown>,
): string {
  const raw = answer[key]
  if (typeof raw !== 'string') {
    violations.push(violation('type', `${label} must be text.`, key))
    offending[key] = raw
    return ''
  }
  const text = collapse(raw)
  if (!text) {
    violations.push(violation('missing', `${label} is empty.`, key))
    offending[key] = raw
  } else if (text.length > max) {
    violations.push(violation('too-long', `${label} is ${text.length} characters; at most ${max}.`, key))
    offending[key] = raw
  }
  return text
}

type Facts = Readonly<Record<string, unknown>>

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')
const asList = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : []

/** What the record facts say a check needs: a deal's stages and status, and every record's open tasks. */
export interface AiCrmRecordCheckContext {
  kind: AiCrmRecordKind
  /** The deal's stage, and its pipeline's stages in order. */
  stageId?: string
  status?: string
  stages?: ReadonlyArray<{ id: string; name: string; kind: string }>
  /** The titles of the record's open tasks, which a next step may not repeat. */
  openTaskTitles?: readonly string[]
}

export interface AiCrmRecordAnswer {
  summary: string
  nextStep: AiCrmNextStep | null
  stage: { stageId: string; stageName: string; reason: string } | null
  standing: string | null
}

function checkNextStep(
  raw: unknown,
  context: AiCrmRecordCheckContext,
  violations: AiDoctrineViolation[],
  offending: Record<string, unknown>,
): AiCrmNextStep | null {
  if (raw === null) return null
  const step = raw as Record<string, unknown>
  if (typeof step !== 'object' || Array.isArray(step)) {
    violations.push(violation('type', 'The next step must be a task or null.', 'nextStep'))
    offending['nextStep'] = raw
    return null
  }
  const before = violations.length
  const title = textField(step, 'title', 'The next step’s title', AI_CRM_LIMITS.taskTitle, violations, {})
  const reason = textField(step, 'reason', 'The next step’s reason', AI_CRM_LIMITS.reason, violations, {})
  const kind = TASK_KINDS.find((entry) => entry === step['kind'])
  const priority = PRIORITIES.find((entry) => entry === step['priority'])
  if (!kind || !priority) violations.push(violation('type', 'The next step’s kind or priority is not one the CRM has.', 'nextStep'))
  const due = step['dueInDays']
  if (typeof due !== 'number' || !Number.isInteger(due) || due < 0 || due > AI_CRM_LIMITS.dueInDays) {
    violations.push(
      violation('next-step-due', `The next step must be due in 0 to ${AI_CRM_LIMITS.dueInDays} days.`, 'nextStep.dueInDays'),
    )
  }
  const open = new Set((context.openTaskTitles ?? []).map((entry) => collapse(entry).toLowerCase()))
  if (title && open.has(title.toLowerCase())) {
    violations.push(
      violation('next-step-open', 'The next step repeats a task that is already open. Propose another, or null.', 'nextStep.title'),
    )
  }
  if (violations.length > before) {
    offending['nextStep'] = raw
    return null
  }
  return { title, kind: kind as AiCrmNextStep['kind'], priority: priority as AiCrmNextStep['priority'], dueInDays: due as number, reason }
}

function checkStage(
  raw: unknown,
  context: AiCrmRecordCheckContext,
  violations: AiDoctrineViolation[],
  offending: Record<string, unknown>,
): AiCrmRecordAnswer['stage'] {
  if (raw === null) return null
  const stage = raw as Record<string, unknown>
  if (typeof stage !== 'object' || Array.isArray(stage)) {
    violations.push(violation('type', 'The stage must be a move or null.', 'stage'))
    offending['stage'] = raw
    return null
  }
  const before = violations.length
  const reason = textField(stage, 'reason', 'The stage’s reason', AI_CRM_LIMITS.reason, violations, {})
  const target = (context.stages ?? []).find((entry) => entry.id === stage['stageId'])
  if (context.status && context.status !== 'open') {
    violations.push(violation('stage-closed', 'The deal is already closed, so its stage must be null.', 'stage'))
  } else if (!target) {
    violations.push(violation('stage-unknown', 'The stage is not one the deal’s pipeline lists.', 'stage.stageId'))
  } else if (target.kind !== 'open') {
    violations.push(
      violation('stage-won-lost', 'Winning or losing a deal is the team’s call. Propose an open stage, or null.', 'stage.stageId'),
    )
  } else if (target.id === context.stageId) {
    violations.push(violation('stage-current', 'The deal is already in that stage. Propose another, or null.', 'stage.stageId'))
  }
  if (violations.length > before || !target) {
    offending['stage'] = raw
    return null
  }
  return { stageId: target.id, stageName: target.name, reason }
}

/** What a record's facts say its check needs. */
export function aiCrmRecordCheckContext(kind: AiCrmRecordKind, facts: Facts): AiCrmRecordCheckContext {
  return {
    kind,
    openTaskTitles: asList(facts['openTasks']).map((task) => asText(task['title'])),
    ...(kind === 'deal'
      ? {
          stageId: asText(facts['stageId']),
          status: asText(facts['status']),
          stages: asList(facts['stages']).map((stage) => ({
            id: asText(stage['id']),
            name: asText(stage['name']),
            kind: asText(stage['kind']),
          })),
        }
      : {}),
  }
}

/** A record answer held to the record it is about. */
export function checkAiCrmRecord(
  answer: Record<string, unknown>,
  context: AiCrmRecordCheckContext,
): AiCrmCheckResult<AiCrmRecordAnswer> {
  const violations: AiDoctrineViolation[] = []
  const offending: Record<string, unknown> = {}
  const summary = textField(answer, 'summary', 'The summary', AI_CRM_LIMITS.summary, violations, offending)
  let nextStep: AiCrmNextStep | null = null
  let stage: AiCrmRecordAnswer['stage'] = null
  let standing: string | null = null
  if (context.kind === 'lead') {
    standing = textField(answer, 'standing', 'The standing', AI_CRM_LIMITS.standing, violations, offending)
  } else {
    nextStep = checkNextStep(answer['nextStep'], context, violations, offending)
    if (context.kind === 'deal') stage = checkStage(answer['stage'], context, violations, offending)
  }
  return violations.length
    ? { value: null, violations, offending }
    : { value: { summary, nextStep, stage, standing }, violations: [] }
}

/** The merge fields an email from a record may use: never an address. */
export function aiCrmEmailMergeFields(kind: AiCrmRecordKind): string[] {
  const groups = kind === 'lead' ? ['Lead'] : kind === 'deal' ? ['Contact', 'Deal'] : ['Contact']
  return CRM_MERGE_FIELDS.filter(
    (field) => (groups.includes(field.group) || field.group === 'You' || field.group === 'Site') && !field.key.endsWith('.email'),
  ).map((field) => field.key)
}

const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+/
/** A run of digits and the separators a phone number is written with. */
const DIGIT_RUN = /\+?\d[\d\s().-]{7,}\d/g
/** Calendar days, which the facts write and a draft may repeat. */
const DAYS_ONLY = /^\d{4}-\d{2}-\d{2}(?:\s+\d{4}-\d{2}-\d{2})*$/

/** Whether text writes a phone number: a run of ten digits or more that is not a list of days. */
export function aiCrmWritesPhoneNumber(text: string): boolean {
  for (const [run] of text.matchAll(DIGIT_RUN)) {
    if (DAYS_ONLY.test(run.trim())) continue
    if (run.replace(/\D/g, '').length >= 10) return true
  }
  return false
}
const MARKDOWN = /\*\*|__|^#{1,6}\s|\[[^\]]+\]\([^)]+\)|```/m

export interface AiCrmEmailAnswer {
  subject: string
  body: string
}

/** An email answer held to the composer and to what a person may be sent. */
export function checkAiCrmEmail(
  answer: Record<string, unknown>,
  context: { mergeFields: readonly string[] },
): AiCrmCheckResult<AiCrmEmailAnswer> {
  const violations: AiDoctrineViolation[] = []
  const offending: Record<string, unknown> = {}
  const subject = textField(answer, 'subject', 'The subject', AI_CRM_LIMITS.subject, violations, offending)
  const rawBody = typeof answer['body'] === 'string' ? answer['body'] : null
  const body = rawBody === null ? '' : rawBody.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (rawBody === null) {
    violations.push(violation('type', 'The message must be text.', 'body'))
    offending['body'] = answer['body']
  } else if (!body) {
    violations.push(violation('missing', 'The message is empty.', 'body'))
    offending['body'] = rawBody
  } else if (body.length > AI_CRM_LIMITS.body) {
    violations.push(violation('too-long', `The message is ${body.length} characters; at most ${AI_CRM_LIMITS.body}.`, 'body'))
    offending['body'] = rawBody
  }
  if (typeof answer['subject'] === 'string' && /[\r\n]/.test(answer['subject'].trim())) {
    violations.push(violation('subject-lines', 'The subject must be one line.', 'subject'))
    offending['subject'] = answer['subject']
  }
  const allowed = new Set(context.mergeFields)
  const unknown = [...new Set([...crmMergeFieldsIn(subject), ...crmMergeFieldsIn(body)])].filter((key) => !allowed.has(key))
  if (unknown.length) {
    violations.push(
      violation('merge-field-unknown', `The draft uses merge fields this record cannot fill: ${unknown.join(', ')}.`),
    )
  }
  const text = `${subject}\n${body}`
  if (EMAIL_ADDRESS.test(text) || aiCrmWritesPhoneNumber(text)) {
    violations.push(violation('contact-detail', 'The draft writes an email address or a phone number. Leave them out.'))
  }
  if (MARKDOWN.test(body)) {
    violations.push(violation('markdown', 'The message uses markdown. Write plain text.', 'body'))
    offending['body'] = rawBody
  }
  return violations.length ? { value: null, violations, offending } : { value: { subject, body }, violations: [] }
}

/** One field an import may fill, as the CRM's catalog lists it. */
export interface AiCrmImportField {
  key: string
  label: string
  type: string
  required: boolean
}

/** An import catalog's fields as the facts report them, in the order they are numbered. */
export function aiCrmImportFields(facts: Facts): AiCrmImportField[] {
  return asList(facts['fields'])
    .map((field) => ({
      key: asText(field['key']),
      label: asText(field['label']),
      type: asText(field['type']) || 'text',
      required: field['required'] === true,
    }))
    .filter((field) => field.key && field.label)
}

/** The column shapes each field type takes; a field type absent here takes any shape. */
const SHAPES_FOR_TYPE: Readonly<Record<string, readonly string[]>> = {
  email: ['email', 'empty'],
  phone: ['phone', 'number', 'empty'],
  number: ['number', 'empty'],
  date: ['date', 'empty'],
  'yes-no': ['yes-no', 'empty'],
}

/** A mapping answer held to the file's columns and the import's fields. */
export function checkAiCrmMapping(
  answer: Record<string, unknown>,
  context: { columns: readonly ConsoleImportColumn[]; fields: readonly AiCrmImportField[] },
): AiCrmCheckResult<AiCrmColumnMatch[]> {
  const violations: AiDoctrineViolation[] = []
  const raw = answer['matches']
  if (!Array.isArray(raw)) {
    return { value: null, violations: [violation('type', 'The matches must be a list.', 'matches')], offending: { matches: raw } }
  }
  const columns = new Set<number>()
  const taken = new Set<string>()
  const matches: AiCrmColumnMatch[] = []
  const offending: unknown[] = []
  for (const entry of raw) {
    const match = (entry ?? {}) as Record<string, unknown>
    const column = match['column']
    const number = match['field']
    const field = typeof number === 'number' && Number.isInteger(number) ? context.fields[number] : undefined
    const at = typeof column === 'number' && Number.isInteger(column) ? context.columns[column] : undefined
    if (!at) {
      violations.push(violation('column-unknown', `Column ${String(column)} is not one the file has.`))
    } else if (!field) {
      violations.push(violation('field-unknown', `Field ${String(number)} is not one this import fills.`))
    } else if (columns.has(column as number)) {
      violations.push(violation('column-twice', `Column ${String(column)} is matched twice.`))
    } else if (taken.has(field.key)) {
      violations.push(violation('field-twice', `${field.label} takes one column, and two were matched to it.`))
    } else if (SHAPES_FOR_TYPE[field.type] && !SHAPES_FOR_TYPE[field.type].includes(at.shape)) {
      violations.push(
        violation('shape-mismatch', `Column ${String(column)} holds ${at.shape} values, which ${field.label} cannot take.`),
      )
    } else if (at.shape === 'email' && field.type !== 'email') {
      violations.push(violation('shape-mismatch', `Column ${String(column)} holds email addresses, which ${field.label} is not.`))
    } else {
      columns.add(column as number)
      taken.add(field.key)
      matches.push({ column: column as number, header: at.header, field: field.key, label: field.label })
      continue
    }
    offending.push(entry)
  }
  return violations.length
    ? { value: null, violations, offending: { matches: offending } }
    : { value: matches.sort((a, b) => a.column - b.column), violations: [] }
}
