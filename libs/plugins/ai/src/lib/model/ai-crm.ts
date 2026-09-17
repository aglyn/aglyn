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

import type {
  ConsoleImportColumn,
  ConsoleImportColumnShape,
} from '@aglyn/aglyn/plugin-manager/record-zone-props'
import type { AiJobOutput, AiJobSummary } from './ai-jobs.types'

/**
 * CRM by AI (AGL-2917): what a `crm` job is asked, and the proposals it
 * answers with, in the shape the job step writes and the console widgets
 * read. Pure data and readers, with no server import.
 *
 * ## Three questions, all proposals
 *
 * - `record` — a contact, company, deal or lead: a short summary of where the
 *   relationship stands, the next step as a task (never for a lead, which no
 *   task can link to), a stage for a deal, and a lead's standing. The member
 *   saves the task in the CRM's task form and confirms a stage move there.
 * - `email` — a subject and a plain-text message for the CRM composer, greeted
 *   and signed with merge fields. The member edits it and presses Send; a job
 *   never sends anything.
 * - `mapping` — which of a file's columns fill which fields of an import. The
 *   import drawer shows it in its own table and preview before anything is
 *   imported.
 *
 * ## What the model is given
 *
 * The CRM decides it: the facts its readers report on the core's record-facts
 * seam, never a document the AI plugin read itself. For an import, the
 * columns' headers and shapes — never a cell of the file.
 */

/** The plugin that owns every record a `crm` job reads, as `plugins.config.json` names it. */
export const AI_CRM_PLUGIN_ID = 'crm'

/** What the site's plugin list calls it, for the sentence a person reads. */
export const AI_CRM_PLUGIN_LABEL = 'CRM'

export type AiCrmTask = 'record' | 'email' | 'mapping'

export const AI_CRM_TASKS: readonly AiCrmTask[] = ['record', 'email', 'mapping']

export type AiCrmRecordKind = 'contact' | 'company' | 'deal' | 'lead'

export const AI_CRM_RECORD_KINDS: readonly AiCrmRecordKind[] = ['contact', 'company', 'deal', 'lead']

/** The records an email is written from: a person, a deal (its person) or a lead. */
export const AI_CRM_EMAIL_RECORD_KINDS: readonly AiCrmRecordKind[] = ['contact', 'deal', 'lead']

export type AiCrmImportCollection = 'contacts' | 'companies' | 'deals' | 'leads'

export const AI_CRM_IMPORT_COLLECTIONS: readonly AiCrmImportCollection[] = [
  'contacts',
  'companies',
  'deals',
  'leads',
]

/** The resource names the CRM's readers are registered under on the record-facts seam. */
export const AI_CRM_FACTS_RESOURCES: Readonly<Record<AiCrmRecordKind, string>> = {
  contact: 'crm.contact',
  company: 'crm.company',
  deal: 'crm.deal',
  lead: 'crm.lead',
}

/** The import catalogs' resource name; the collection is the record id. */
export const AI_CRM_IMPORT_FACTS_RESOURCE = 'crm.import'

export const AI_CRM_COLUMN_SHAPES: readonly ConsoleImportColumnShape[] = [
  'empty',
  'email',
  'phone',
  'number',
  'date',
  'yes-no',
  'url',
  'text',
]

/** The most columns one mapping request sends. */
export const AI_CRM_MAX_COLUMNS = 60

/** How much of a column header is sent. */
export const AI_CRM_HEADER_MAX_CHARS = 60

/** Lengths the CRM tools hold an answer to. */
export const AI_CRM_LIMITS = {
  summary: 320,
  standing: 280,
  taskTitle: 80,
  reason: 160,
  subject: 100,
  body: 1_200,
  /** The latest a proposed next step may be due, in days from today. */
  dueInDays: 30,
} as const

/** A task the job proposes as the record's next step. */
export interface AiCrmNextStep {
  title: string
  kind: 'call' | 'email' | 'meeting' | 'todo'
  priority: 'low' | 'normal' | 'high'
  dueInDays: number
  /** Why, pointing at the fact behind it. */
  reason: string
}

/** A stage the job proposes a deal move to. */
export interface AiCrmStageMove {
  stageId: string
  stageName: string
  reason: string
}

export interface AiCrmRecordProposal {
  kind: 'record'
  record: { kind: AiCrmRecordKind; id: string }
  summary: string
  nextStep: AiCrmNextStep | null
  stage: AiCrmStageMove | null
  /** Why a lead stands where it does; `null` for any other record. */
  standing: string | null
  /** The UTC day the facts were read. */
  asOf: string
  /** The request the answer was produced for; a later job whose request keys the same reuses it. */
  key: string
  /** The job the answer was reused from, when it was not asked for again. */
  reusedFrom?: string
}

export interface AiCrmEmailProposal {
  kind: 'email'
  record: { kind: AiCrmRecordKind; id: string }
  subject: string
  body: string
}

/** One column the job matched to a field. */
export interface AiCrmColumnMatch {
  column: number
  header: string
  field: string
  label: string
}

export interface AiCrmMappingProposal {
  kind: 'mapping'
  collection: AiCrmImportCollection
  matches: AiCrmColumnMatch[]
  /** How many columns the request sent. */
  columns: number
}

export type AiCrmProposal = AiCrmRecordProposal | AiCrmEmailProposal | AiCrmMappingProposal

/** The output ids a `crm` job writes: one per question. */
export const AI_CRM_OUTPUT_IDS = {
  record: (kind: AiCrmRecordKind, id: string) => `record:${kind}:${id}`,
  email: (kind: AiCrmRecordKind, id: string) => `email:${kind}:${id}`,
  mapping: (collection: AiCrmImportCollection) => `mapping:${collection}`,
} as const

/** What a `crm` job's inputs say it is asked, read and bounded. */
export type AiCrmRequest =
  | { task: 'record'; record: { kind: AiCrmRecordKind; id: string } }
  | { task: 'email'; record: { kind: AiCrmRecordKind; id: string } }
  | { task: 'mapping'; collection: AiCrmImportCollection; columns: ConsoleImportColumn[] }

const RECORD_ID = /^[A-Za-z0-9_.:@+-]{1,128}$/

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value)

/** The columns a mapping request sends, as the job's inputs carry them (a JSON string). */
export function aiCrmColumnsInput(columns: readonly ConsoleImportColumn[]): string {
  return JSON.stringify(
    columns.slice(0, AI_CRM_MAX_COLUMNS).map((column) => ({
      header: String(column.header ?? '').replace(/\s+/g, ' ').trim().slice(0, AI_CRM_HEADER_MAX_CHARS),
      shape: column.shape,
    })),
  )
}

function readColumns(raw: unknown): ConsoleImportColumn[] | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > AI_CRM_MAX_COLUMNS) return null
  const columns: ConsoleImportColumn[] = []
  for (const entry of parsed) {
    const column = entry as Record<string, unknown> | null
    if (!column || typeof column['header'] !== 'string' || !oneOf(AI_CRM_COLUMN_SHAPES, column['shape'])) return null
    columns.push({
      header: column['header'].replace(/\s+/g, ' ').trim().slice(0, AI_CRM_HEADER_MAX_CHARS),
      shape: column['shape'],
    })
  }
  return columns
}

/** What a `crm` job is asked, or the sentence naming what its inputs lack. */
export function parseAiCrmRequest(inputs: Readonly<Record<string, unknown>> | null | undefined): AiCrmRequest | string {
  const task = inputs?.['task']
  if (task === 'record' || task === 'email') {
    const kind = inputs?.['record']
    const id = String(inputs?.['recordId'] ?? '').trim()
    const kinds = task === 'email' ? AI_CRM_EMAIL_RECORD_KINDS : AI_CRM_RECORD_KINDS
    if (!oneOf(kinds, kind) || !RECORD_ID.test(id)) return 'Open the CRM record this is about first'
    return { task, record: { kind, id } }
  }
  if (task === 'mapping') {
    const collection = inputs?.['collection']
    if (!oneOf(AI_CRM_IMPORT_COLLECTIONS, collection)) return 'Open the import this is for first'
    const columns = readColumns(inputs?.['columns'])
    if (!columns) return `Choose a file with between 1 and ${AI_CRM_MAX_COLUMNS} columns first`
    return { task, collection, columns }
  }
  return 'This CRM request does not say what it is for'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A stored proposal read back, or `null` when it is not one a `crm` job writes. */
export function readAiCrmProposal(raw: unknown): AiCrmProposal | null {
  if (!isRecord(raw)) return null
  if (raw['kind'] === 'record' || raw['kind'] === 'email') {
    const record = raw['record']
    if (!isRecord(record) || !oneOf(AI_CRM_RECORD_KINDS, record['kind']) || typeof record['id'] !== 'string') {
      return null
    }
    if (raw['kind'] === 'email') {
      return typeof raw['subject'] === 'string' && typeof raw['body'] === 'string'
        ? (raw as unknown as AiCrmEmailProposal)
        : null
    }
    return typeof raw['summary'] === 'string' ? (raw as unknown as AiCrmRecordProposal) : null
  }
  if (raw['kind'] === 'mapping') {
    return oneOf(AI_CRM_IMPORT_COLLECTIONS, raw['collection']) && Array.isArray(raw['matches'])
      ? (raw as unknown as AiCrmMappingProposal)
      : null
  }
  return null
}

/** The `crm` proposals a job's outputs carry. */
export function aiCrmProposalsOf(job: Pick<AiJobSummary, 'outputs'> | null | undefined): AiCrmProposal[] {
  return (job?.outputs ?? [])
    .filter((output: AiJobOutput) => output.resource === 'crm')
    .map((output) => readAiCrmProposal(output.proposal))
    .filter((proposal): proposal is AiCrmProposal => proposal !== null)
}

/** A job's proposal about one record, of one kind of question, or `null`. */
export function aiCrmRecordProposalOf(
  job: Pick<AiJobSummary, 'outputs'> | null | undefined,
  record: { kind: string; id: string },
): AiCrmRecordProposal | null {
  const found = aiCrmProposalsOf(job).find(
    (proposal) => proposal.kind === 'record' && proposal.record.kind === record.kind && proposal.record.id === record.id,
  )
  return (found as AiCrmRecordProposal | undefined) ?? null
}

/** A job's email draft for one record, or `null`. */
export function aiCrmEmailProposalOf(
  job: Pick<AiJobSummary, 'outputs'> | null | undefined,
  record: { kind: string; id: string },
): AiCrmEmailProposal | null {
  const found = aiCrmProposalsOf(job).find(
    (proposal) => proposal.kind === 'email' && proposal.record.kind === record.kind && proposal.record.id === record.id,
  )
  return (found as AiCrmEmailProposal | undefined) ?? null
}

/** A job's column matches for one import, or `null`. */
export function aiCrmMappingProposalOf(
  job: Pick<AiJobSummary, 'outputs'> | null | undefined,
  collection: string,
): AiCrmMappingProposal | null {
  const found = aiCrmProposalsOf(job).find(
    (proposal) => proposal.kind === 'mapping' && proposal.collection === collection,
  )
  return (found as AiCrmMappingProposal | undefined) ?? null
}
