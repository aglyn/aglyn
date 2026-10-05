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

import { createHash } from 'node:crypto'
import { pluginRecordFactsReader } from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import {
  AI_CRM_ANSWER_RETENTION_DAYS,
  AI_CRM_ANSWERS_COLLECTION,
  AI_CRM_EMAIL_REQUEST_MAX_CHARS,
  AI_CRM_OUTPUT_IDS,
  AI_CRM_PLUGIN_ID,
  aiCrmAnswerExpiry,
  parseAiCrmRequest,
  readAiCrmProposal,
  type AiCrmAnswerRecord,
  type AiCrmEmailProposal,
  type AiCrmMappingProposal,
  type AiCrmOutputRef,
  type AiCrmProposal,
  type AiCrmRecordKind,
  type AiCrmRecordProposal,
} from '../model/ai-crm'
import { AI_STEP_TIERS } from '../providers/catalog'
import type { AiTool } from '../providers/contract'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import { aiDoctrineScopeFor, aiDoctrineSystemBlocks, runValidatedGeneration } from '../runtime/ai-doctrine'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import {
  AI_CRM_EMAIL_TOOL,
  AI_CRM_EMAIL_TOOL_NAME,
  AI_CRM_MAPPING_TOOL,
  AI_CRM_MAPPING_TOOL_NAME,
  AI_CRM_RECORD_TOOL_NAME,
  aiCrmEmailMergeFields,
  aiCrmImportFields,
  aiCrmRecordCheckContext,
  aiCrmRecordTool,
  checkAiCrmEmail,
  checkAiCrmMapping,
  checkAiCrmRecord,
  type AiCrmImportField,
} from '../tools/ai-crm-tool'
import {
  AI_CRM_UNAVAILABLE_COPY,
  aiCrmAccessRefusal,
  aiCrmFactsResource,
  type AiCrmReaderLookup,
} from './ai-crm-access'
import { registerAiJobAdmission, type AiJobAdmission, type AiJobAdmissionRefusal } from './ai-job-admission'
import { aiJobStepBudget } from './ai-job-budget'
import { aiGenerationSpent, aiUnspentOutcome } from './ai-job-generation'
import type { AiJobStepContext, AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The `crm` step (AGL-2917): CRM by AI, as proposals.
 *
 * `inputs.task` says what the job is asked (`model/ai-crm.ts`):
 *
 * - `record` — one contact, company, deal or lead (`record`, `recordId`): a
 *   summary, the next step as a task, a deal's stage, a lead's standing;
 * - `email` — a draft for the CRM composer, from what the member asked for
 *   (the brief) and the record's facts;
 * - `mapping` — an import's columns (`collection`, `columns`) matched to the
 *   fields the CRM's import fills.
 *
 * ## The CRM decides what is read
 *
 * The step never reads a CRM document. It asks the CRM's readers on the core's
 * record-facts seam for the job's creator, and the CRM applies its own rules —
 * the member's reach and `data.manage`, the plan, the record's visibility on
 * the site — and reports the facts it chooses to. The admission below asks the
 * same reader before the job exists, beside what an in-process call skips of
 * the plugin API dispatcher: the CRM switched on and released where the job
 * runs. A mapping sends the file's headers and each column's shape, never a
 * cell.
 *
 * ## It writes no CRM record
 *
 * The CRM's task form, stage route, composer and import drawer are the
 * writes, and a member makes each one. No email is sent by a job.
 *
 * ## The answer is kept apart from the job
 *
 * Every member of a workspace may read its jobs, and not every member may
 * read every record. So a job's output names only the question — which
 * record, which import — and the answer is kept at
 * `orgs/{orgId}/aiCrmAnswers/{jobId}`, which no client may read, for two
 * weeks (`AI_CRM_ANSWER_RETENTION_DAYS`). The answer door
 * (`server/ai-crm-answer.ts`) serves it to a member the CRM still lets read
 * the record, asking the same reader again.
 *
 * ## A summary is asked once per timeline
 *
 * A record answer is keyed on the whole request — the record, the site, the
 * model, the rules, the tool and the facts as the CRM reported them — and a
 * later job whose key matches a kept answer reuses it and spends nothing.
 * The facts change exactly when something the model was told changes, so an
 * unchanged record is never asked twice while its answer is kept.
 */

/**
 * ASSUMED: the step's own round trips — the facts read (the record and its
 * three windowed queries, in parallel), a record's reuse lookup, and the
 * answer's write.
 */
export const AI_CRM_FACTS_READS_MS = 1_500

/**
 * The step's time (AGL-3035): one generation and its re-ask on the tier
 * `job.crm` is served from, after the facts read, with no site inventory and
 * so no lookup round. It fits an inline door's budget, so a member who asks on
 * a record page is answered in the request.
 */
export const AI_JOB_CRM_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.crm'],
  maxTokens: AI_ROUTING_TABLE['job.crm'].maxTokens,
  lookups: 0,
  ownReadsMs: AI_CRM_FACTS_READS_MS,
})

/** The least time one CRM step needs before it starts. */
export const AI_JOB_CRM_STEP_MINIMUM_MS = AI_JOB_CRM_STEP_BUDGET.minimumMs

/** Kept answers to one request a reuse lookup reads. */
export const AI_CRM_REUSE_CANDIDATES = 20

/** How long a record answer stays reusable, beside its facts being unchanged: as long as it is kept. */
export const AI_CRM_REUSE_WINDOW_MS = AI_CRM_ANSWER_RETENTION_DAYS * 24 * 60 * 60_000

export const AI_CRM_FACTS_FAILURE_COPY = 'The CRM record could not be read. Try again.'
export const AI_CRM_KEEP_FAILURE_COPY = 'The answer could not be kept. Try again.'

/** The generation kinds the step asks under, which the doctrine states only its field rules to. */
export const AI_CRM_GENERATION_KINDS = {
  record: 'crm-record',
  email: 'crm-email',
  mapping: 'crm-mapping',
} as const

const OUTPUT_LABELS = {
  record: 'CRM summary',
  email: 'CRM email draft',
  mapping: 'Import column matches',
} as const

type Facts = Readonly<Record<string, unknown>>

/* ------------------------------------------------------------------------ *
 * The rules
 * ------------------------------------------------------------------------ */

const WRITE_ONLY_FROM_FACTS =
  'Write only from the facts. Never invent an event, a date, an amount, a name or a promise the facts do not state, and write dates as the facts do.'

const NEXT_STEP_RULE =
  'nextStep: the one task that should come next, or null when an open task already covers it or nothing is worth doing. Its title starts with a verb, and its reason names the fact behind it.'

const LANGUAGE_RULE = 'Write in the language of the facts’ notes and timeline.'

function rulesBlock(opening: string, toolName: string, rules: readonly string[]): AiSystemBlock[] {
  return [
    {
      text:
        `${opening}\n\n` +
        `Answer by calling ${toolName} exactly once. A reply in prose cannot be used.\n\n` +
        `Rules:\n${rules.map((rule) => `- ${rule}`).join('\n')}`,
      cacheBreakpoint: true,
    },
  ]
}

/**
 * The rules for a record of one kind. Each kind is sent the rules its tool can
 * be refused for, and no others: on a model that caches no prompt this short,
 * a rule a request cannot break is paid for on every request.
 */
export function aiCrmRecordInstructions(kind: AiCrmRecordKind): AiSystemBlock[] {
  const opening = `You help a small business's team work its customer records. You are given one ${kind} a team member opened, as facts read from their CRM.`
  const rules =
    kind === 'lead'
      ? [
          WRITE_ONLY_FROM_FACTS,
          'summary: two sentences at most: how the lead came in, what it did, and when it was last seen.',
          'standing: two sentences at most on why the lead stands where it does: its status, how it came in, and how often and how recently it was active. There is no lead score; never give one.',
          LANGUAGE_RULE,
        ]
      : [
          WRITE_ONLY_FROM_FACTS,
          `summary: two sentences at most: when the ${kind} was last in touch and how, and what is still open.`,
          NEXT_STEP_RULE,
          ...(kind === 'deal'
            ? [
                'stage: the open stage the deal should move to, by its id in the facts, only when the timeline shows the deal has moved there; otherwise null, and always null for a deal that is won or lost. Never propose winning or losing a deal.',
              ]
            : []),
          LANGUAGE_RULE,
        ]
  return rulesBlock(opening, AI_CRM_RECORD_TOOL_NAME, rules)
}

export const AI_CRM_EMAIL_INSTRUCTIONS: AiSystemBlock[] = rulesBlock(
  'You draft a one-to-one email that a team member reviews, edits and sends themselves from a customer record in their CRM. Nothing is sent until they press Send.',
  AI_CRM_EMAIL_TOOL_NAME,
  [
    'Write what the team member asks for, from the record’s facts. Never invent a price, a date, an offer, a meeting time or a promise that neither states.',
    'body: plain text in short paragraphs separated by a blank line, with no markdown, no links and no signature block beyond the sign-off.',
    'Greet the person and sign off only with the merge fields the request lists, written exactly as listed. Use no other merge field.',
    'Never write an email address or a phone number.',
    'Write in the language of the team member’s request.',
  ],
)

export const AI_CRM_MAPPING_INSTRUCTIONS: AiSystemBlock[] = rulesBlock(
  'You match the columns of a spreadsheet a team member is importing into their CRM to the fields the import fills. You are given each column’s header and the shape of its values, never the values.',
  AI_CRM_MAPPING_TOOL_NAME,
  [
    'Match a column only to a field the request lists, both by their numbers, and only when the column’s header says it holds that field. Leave out a column no field fits.',
    'A field takes at most one column, and a column one field.',
    'A column’s shape must suit its field: an email field takes an email column; a phone field a phone or number column; a number, date or yes-no field a column of that shape. Only an email field takes an email column. An empty column takes any field its header names.',
  ],
)

/* ------------------------------------------------------------------------ *
 * The facts, as the model reads them
 * ------------------------------------------------------------------------ */

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const list = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object') : []
const words = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter(Boolean) : [])

function line(label: string, value: unknown): string[] {
  const shown = typeof value === 'number' ? String(value) : text(value)
  return shown ? [`${label}: ${shown}`] : []
}

function timelineLines(value: unknown): string[] {
  const entries = list(value)
  if (!entries.length) return ['Timeline: nothing logged or captured yet']
  return [
    'Timeline, newest first:',
    ...entries.map((entry) => {
      const detail = [
        text(entry['direction']),
        entry['from'] ? `from ${text(entry['from'])}` : '',
        entry['to'] ? `to ${text(entry['to'])}` : '',
        text(entry['delivery']),
        text(entry['outcome']),
      ].filter(Boolean)
      const subject = text(entry['subject'])
      return (
        `- ${text(entry['on'])} ${text(entry['kind'])}` +
        (detail.length ? ` (${detail.join(', ')})` : '') +
        (subject || entry['text'] ? ':' : '') +
        (subject ? ` "${subject}"` : '') +
        (text(entry['text']) ? ` ${text(entry['text'])}` : '')
      )
    }),
  ]
}

function taskLines(value: unknown): string[] {
  const tasks = list(value)
  if (!tasks.length) return ['Open tasks: none']
  return [
    'Open tasks:',
    ...tasks.map(
      (task) =>
        `- ${text(task['title'])} (${[
          text(task['kind']),
          `${text(task['priority']) || 'normal'} priority`,
          ...(task['status'] ? [text(task['status'])] : []),
          task['due'] ? `due ${text(task['due'])}` : 'no due date',
          ...(task['overdue'] === true ? ['overdue'] : []),
          ...(task['assignee'] ? [`assigned to ${text(task['assignee'])}`] : []),
        ].join(', ')})` + (task['notes'] ? `: ${text(task['notes'])}` : ''),
    ),
  ]
}

function dealLines(value: unknown): string[] {
  const deals = list(value)
  if (!deals.length) return ['Deals: none']
  return [
    'Deals:',
    ...deals.map(
      (deal) =>
        `- ${text(deal['title'])}: ${[
          text(deal['stage']),
          text(deal['status']),
          text(deal['amount']),
          deal['expectedClose'] ? `expected to close ${text(deal['expectedClose'])}` : '',
        ]
          .filter(Boolean)
          .join(', ')}`,
    ),
  ]
}

/** The record's custom field values under their labels (AGL-3520). */
function customLines(value: unknown): string[] {
  const fields = list(value).filter((field) => text(field['label']) && text(field['value']))
  return fields.length
    ? ['Custom fields:', ...fields.map((field) => `- ${text(field['label'])}: ${text(field['value'])}`)]
    : []
}

const yesNo = (label: string, value: unknown): string[] => (value === true ? [label] : [])

/**
 * A record's facts as the CRM's reader marks them when it answered the whole
 * record (AGL-3520): `wholeRecord: true`, set only while the organization has
 * `release_crm_assist_whole_record` on. Absent, the facts are the disclosed
 * ones and are written by {@link aiCrmDisclosedFactsLines}.
 */
export const AI_CRM_WHOLE_RECORD_FIELD = 'wholeRecord'

/** Keeps only `keys` of each entry: the disclosed writer's allow-list for nested rows. */
const only = (value: unknown, keys: readonly string[]): Array<Record<string, unknown>> =>
  list(value).map((entry) => Object.fromEntries(keys.filter((key) => key in entry).map((key) => [key, entry[key]])))

/** What the disclosed writer reads of a timeline entry: never who an email was from or to. */
const DISCLOSED_TIMELINE_KEYS = ['on', 'kind', 'direction', 'subject', 'text', 'outcome', 'delivery'] as const
/** What the disclosed writer reads of an open task: never its assignee, status or notes. */
const DISCLOSED_TASK_KEYS = ['title', 'kind', 'priority', 'due', 'overdue'] as const

/**
 * The facts as lines of text while the published pages describe the narrow
 * set: only the fields named here are written, whatever else a reader
 * reports, so what reaches a prompt is decided in two places that both have
 * to agree — the CRM's disclosed builders and this list. A company's account
 * fields beyond its headcount, and a lead's profile fields, stay out of the
 * prompt as they always have.
 */
export function aiCrmDisclosedFactsLines(kind: AiCrmRecordKind, facts: Facts): string[] {
  const timeline = timelineLines(only(facts['timeline'], DISCLOSED_TIMELINE_KEYS))
  const openTasks = taskLines(only(facts['openTasks'], DISCLOSED_TASK_KEYS))
  if (kind === 'contact') {
    const orders = Number(facts['orders']) || 0
    return [
      ...line('Contact', facts['name']),
      ...line('Salutation', facts['salutation']),
      ...line('Job title', facts['jobTitle']),
      ...line('Department', facts['department']),
      // A request the person made, which a drafted next step must respect (AGL-3515).
      ...yesNo('Do not call: they asked not to be phoned', facts['doNotCall']),
      ...line('Company', facts['company']),
      ...line('Lifecycle stage', facts['lifecycleStage']),
      ...line('Tags', words(facts['tags']).join(', ')),
      ...line('Came in through', words(facts['sources']).join(', ')),
      ...(orders ? [`Orders: ${orders}${facts['lastPurchase'] ? `, the last on ${text(facts['lastPurchase'])}` : ''}`] : []),
      ...line('In the CRM since', facts['since']),
      ...line('Last opened or clicked an email', facts['lastEmailEngagement']),
      ...line('Notes', facts['notes']),
      ...timeline,
      ...openTasks,
      ...dealLines(facts['deals']),
    ]
  }
  if (kind === 'company') {
    return [
      ...line('Company', facts['name']),
      ...line('Domain', facts['domain']),
      ...line('Industry', facts['industry']),
      ...line('Employees', facts['employees'] ?? ''),
      ...line('Tags', words(facts['tags']).join(', ')),
      ...line('People in the CRM', facts['people']),
      ...line('In the CRM since', facts['since']),
      ...line('Notes', facts['notes']),
      ...timeline,
      ...openTasks,
      ...dealLines(facts['deals']),
    ]
  }
  if (kind === 'deal') {
    const stages = list(facts['stages'])
    const withWhom = [text(facts['contact']), text(facts['company'])].filter(Boolean).join(' at ')
    return [
      ...line('Deal', facts['title']),
      ...line('Pipeline', facts['pipeline']),
      ...line('Status', facts['status']),
      ...line('Stage', facts['stage'] ? `${text(facts['stage'])} (id ${text(facts['stageId'])})` : ''),
      ...line('Stages in order', stages.map((stage) => `${text(stage['id'])} "${text(stage['name'])}" (${text(stage['kind'])})`).join('; ')),
      ...line('In this stage since', facts['inStageSince']),
      ...line('Amount', facts['amount']),
      // Salesforce's Opportunity fields (AGL-3516).
      ...line('Probability', typeof facts['probability'] === 'number' ? `${facts['probability']}%` : ''),
      ...line('Forecast category', facts['forecastCategory']),
      ...line('Type', facts['type']),
      ...line('Lead source', facts['leadSource']),
      ...line('Next step', facts['nextStep']),
      ...line('Expected to close', facts['expectedClose']),
      ...line('Lost reason', facts['lostReason']),
      ...line('With', withWhom),
      ...contactRoleLines(facts['contactRoles']),
      ...line('Products on the deal', typeof facts['products'] === 'number' ? facts['products'] || '' : ''),
      ...line('In the CRM since', facts['since']),
      ...line('Notes', facts['notes']),
      ...timeline,
      ...openTasks,
    ]
  }
  return [
    ...line('Lead', facts['name']),
    ...line('Status', facts['status']),
    ...line('Captured through', words(facts['sources']).join(', ')),
    ...line('Captures', Number(facts['captures']) || ''),
    ...line('First seen', facts['firstSeen']),
    ...line('Last seen', facts['lastSeen']),
    `Assigned to a teammate: ${facts['assigned'] === true ? 'yes' : 'no'}`,
    `Converted to a contact: ${facts['converted'] === true ? 'yes' : 'no'}`,
    ...line('Unqualified reason', facts['unqualifiedReason']),
    ...line('Notes', facts['notes']),
    ...timeline,
  ]
}

/** Every contact on a deal and the part each plays (AGL-3521), by name. */
function contactRoleLines(value: unknown): string[] {
  return line(
    'Contact roles',
    list(value)
      .map((row) => {
        const part = [text(row['role']), row['primary'] === true ? 'Primary' : ''].filter(Boolean).join(', ')
        return part ? `${text(row['name'])} (${part})` : text(row['name'])
      })
      .join('; '),
  )
}

/**
 * The facts as lines of text: the WHOLE record the CRM reports (AGL-3520) —
 * every standard field, its contact details and addresses, its picklist
 * labels, its custom fields under their labels, its consent, notes,
 * timeline, open tasks and deals. A field the record does not hold writes
 * no line. The CRM's builders decide what a record is; nothing here drops a
 * field they report, and no reader reports a token, an account identifier
 * or a record id beyond a stage's.
 */
export function aiCrmFactsLines(kind: AiCrmRecordKind, facts: Facts): string[] {
  if (kind === 'contact') {
    const orders = Number(facts['orders']) || 0
    return [
      ...line('Contact', facts['name']),
      ...line('Salutation', facts['salutation']),
      ...line('First name', facts['firstName']),
      ...line('Last name', facts['lastName']),
      ...line('Email', words(facts['emails']).join(', ')),
      ...line('Phone', facts['phone']),
      ...line('Mobile phone', facts['mobilePhone']),
      ...line('Home phone', facts['homePhone']),
      ...line('Other phone', facts['otherPhone']),
      ...line('Fax', facts['fax']),
      // A request the person made, which a drafted next step must respect (AGL-3515).
      ...yesNo('Do not call: they asked not to be phoned', facts['doNotCall']),
      ...line('Job title', facts['jobTitle']),
      ...line('Department', facts['department']),
      ...line('Company', facts['company']),
      ...line('Reports to', facts['reportsTo']),
      ...line('Assistant', facts['assistant']),
      ...line('Assistant phone', facts['assistantPhone']),
      ...line('Birthdate', facts['birthdate']),
      ...line('Mailing address', facts['mailingAddress']),
      ...line('Other address', facts['otherAddress']),
      ...line('Lifecycle stage', facts['lifecycleStage']),
      ...line('Lead source', facts['leadSource']),
      ...line('Owner', facts['owner']),
      ...line('Marketing email consent', facts['marketingConsent']),
      ...line('Tags', words(facts['tags']).join(', ')),
      ...line('Came in through', words(facts['sources']).join(', ')),
      ...(orders ? [`Orders: ${orders}${facts['lastPurchase'] ? `, the last on ${text(facts['lastPurchase'])}` : ''}`] : []),
      ...line('In the CRM since', facts['since']),
      ...line('Last opened or clicked an email', facts['lastEmailEngagement']),
      ...customLines(facts['custom']),
      ...line('Notes', facts['notes']),
      ...timelineLines(facts['timeline']),
      ...taskLines(facts['openTasks']),
      ...dealLines(facts['deals']),
    ]
  }
  if (kind === 'company') {
    return [
      ...line('Company', facts['name']),
      ...line('Domain', facts['domain']),
      ...line('Website', facts['website']),
      ...line('Phone', facts['phone']),
      ...line('Fax', facts['fax']),
      // Salesforce's Account fields (AGL-3514).
      ...line('Type', facts['type']),
      ...line('Industry', facts['industry']),
      ...line('Rating', facts['rating']),
      ...line('Ownership', facts['ownership']),
      ...line('Account source', facts['accountSource']),
      ...line('Employees', facts['employees'] ?? ''),
      ...line('Annual revenue', facts['annualRevenue']),
      ...line('Account number', facts['accountNumber']),
      ...line('Account site', facts['site']),
      ...line('Ticker symbol', facts['tickerSymbol']),
      ...line('SIC code', facts['sicCode']),
      ...line('Billing address', facts['billingAddress']),
      ...line('Shipping address', facts['shippingAddress']),
      ...line('Parent company', facts['parentCompany']),
      ...line('Owner', facts['owner']),
      ...line('Tags', words(facts['tags']).join(', ')),
      ...line('People in the CRM', facts['people']),
      ...line('In the CRM since', facts['since']),
      ...customLines(facts['custom']),
      ...line('Notes', facts['notes']),
      ...timelineLines(facts['timeline']),
      ...taskLines(facts['openTasks']),
      ...dealLines(facts['deals']),
    ]
  }
  if (kind === 'deal') {
    const stages = list(facts['stages'])
    const products = list(facts['products'])
    const withWhom = [text(facts['contact']), text(facts['company'])].filter(Boolean).join(' at ')
    return [
      ...line('Deal', facts['title']),
      ...line('Pipeline', facts['pipeline']),
      ...line('Status', facts['status']),
      ...line('Stage', facts['stage'] ? `${text(facts['stage'])} (id ${text(facts['stageId'])})` : ''),
      ...line('Stages in order', stages.map((stage) => `${text(stage['id'])} "${text(stage['name'])}" (${text(stage['kind'])})`).join('; ')),
      ...line('In this stage since', facts['inStageSince']),
      ...line('Amount', facts['amount']),
      // Salesforce's Opportunity fields (AGL-3516).
      ...line('Probability', typeof facts['probability'] === 'number' ? `${facts['probability']}%` : ''),
      ...line('Forecast category', facts['forecastCategory']),
      ...line('Type', facts['type']),
      ...line('Lead source', facts['leadSource']),
      ...line('Campaign', facts['campaign']),
      ...line('Next step', facts['nextStep']),
      ...line('Expected to close', facts['expectedClose']),
      ...line('Lost reason', facts['lostReason']),
      ...line('With', withWhom),
      ...line('Owner', facts['owner']),
      ...contactRoleLines(facts['contactRoles']),
      ...(products.length
        ? [
            'Products:',
            ...products.map(
              (product) =>
                `- ${text(product['name'])} × ${Number(product['quantity']) || 0}` +
                (product['unitAmount'] ? ` at ${text(product['unitAmount'])}` : ''),
            ),
          ]
        : []),
      ...line('In the CRM since', facts['since']),
      ...customLines(facts['custom']),
      ...line('Notes', facts['notes']),
      ...timelineLines(facts['timeline']),
      ...taskLines(facts['openTasks']),
    ]
  }
  return [
    ...line('Lead', facts['name']),
    ...line('Salutation', facts['salutation']),
    ...line('First name', facts['firstName']),
    ...line('Last name', facts['lastName']),
    ...line('Email', facts['email']),
    ...line('Phone', facts['phone']),
    ...line('Mobile phone', facts['mobilePhone']),
    ...line('Fax', facts['fax']),
    ...yesNo('Do not call: they asked not to be phoned', facts['doNotCall']),
    ...line('Company', facts['company']),
    ...line('Job title', facts['jobTitle']),
    ...line('Website', facts['website']),
    ...line('Address', facts['address']),
    ...line('Industry', facts['industry']),
    ...line('Rating', facts['rating']),
    ...line('Employees', facts['employees'] ?? ''),
    ...line('Annual revenue', facts['annualRevenue']),
    ...line('Lead source', facts['leadSource']),
    ...line('Status', facts['status']),
    ...line('Owner', facts['owner']),
    ...line('Campaigns', words(facts['campaigns']).join(', ')),
    ...line('Marketing email consent', facts['marketingConsent']),
    ...line('Tags', words(facts['tags']).join(', ')),
    ...line('Captured through', words(facts['sources']).join(', ')),
    ...line('Captures', Number(facts['captures']) || ''),
    ...line('First seen', facts['firstSeen']),
    ...line('Last seen', facts['lastSeen']),
    `Assigned to a teammate: ${facts['assigned'] === true ? 'yes' : 'no'}`,
    `Converted to a contact: ${facts['converted'] === true ? 'yes' : 'no'}`,
    ...line('Unqualified reason', facts['unqualifiedReason']),
    ...customLines(facts['custom']),
    ...line('Notes', facts['notes']),
    ...timelineLines(facts['timeline']),
    ...(list(facts['openTasks']).length ? taskLines(facts['openTasks']) : []),
  ]
}

/**
 * The most characters a record's facts take in a request (AGL-3520) —
 * about six thousand tokens at the three characters a token the routing
 * ceilings are measured with. The CRM's own cuts keep a record well under
 * it; a record that holds everything at once is fitted by
 * {@link aiCrmFitFacts}, which shortens its long texts and drops no field.
 */
export const AI_CRM_FACTS_MAX_CHARS = 18_000

/** The cuts {@link aiCrmFitFacts} tries in turn: notes, then each timeline text, then each custom value and task note. */
const FIT_STEPS = [
  { notes: 300, text: 160, custom: 160 },
  { notes: 160, text: 80, custom: 80 },
  { notes: 80, text: 40, custom: 40 },
] as const

const cut = (value: unknown, max: number): unknown =>
  typeof value === 'string' && value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value

/**
 * The facts, fitted to {@link AI_CRM_FACTS_MAX_CHARS} as lines: unchanged
 * when they fit, otherwise with the long texts — the notes, each timeline
 * entry's text, each task's notes and each custom value — cut shorter step
 * by step. Every field stays; only how much of a long text is sent changes.
 */
export function aiCrmFitFacts(kind: AiCrmRecordKind, facts: Facts): Facts {
  const size = (candidate: Facts) => aiCrmFactsLines(kind, candidate).join('\n').length
  if (size(facts) <= AI_CRM_FACTS_MAX_CHARS) return facts
  let fitted: Facts = facts
  for (const step of FIT_STEPS) {
    fitted = {
      ...facts,
      notes: cut(facts['notes'], step.notes),
      timeline: list(facts['timeline']).map((entry) => ({ ...entry, text: cut(entry['text'], step.text) })),
      openTasks: list(facts['openTasks']).map((task) => ({ ...task, notes: cut(task['notes'], step.text) })),
      custom: list(facts['custom']).map((field) => ({ ...field, value: cut(field['value'], step.custom) })),
    }
    if (size(fitted) <= AI_CRM_FACTS_MAX_CHARS) return fitted
  }
  return fitted
}

/**
 * The lines a prompt carries for a record: the whole record, fitted, when
 * the reader marked it {@link AI_CRM_WHOLE_RECORD_FIELD}; otherwise the
 * disclosed lines alone.
 */
export function aiCrmPromptFactsLines(kind: AiCrmRecordKind, facts: Facts): string[] {
  return facts[AI_CRM_WHOLE_RECORD_FIELD] === true
    ? aiCrmFactsLines(kind, aiCrmFitFacts(kind, facts))
    : aiCrmDisclosedFactsLines(kind, facts)
}

/** The user turn for a record. */
export function aiCrmRecordPrompt(kind: AiCrmRecordKind, facts: Facts): string {
  return [`Record: ${kind}`, ...aiCrmPromptFactsLines(kind, facts)].join('\n')
}

/** The user turn for an email draft. */
export function aiCrmEmailPrompt(input: { kind: AiCrmRecordKind; facts: Facts; request: string }): string {
  return [
    `Record: ${input.kind}`,
    `Merge fields: ${aiCrmEmailMergeFields(input.kind).map((key) => `{{${key}}}`).join(', ')}`,
    `The team member asks: ${input.request.replace(/\s+/g, ' ').trim().slice(0, AI_CRM_EMAIL_REQUEST_MAX_CHARS)}`,
    '',
    'Facts:',
    ...aiCrmPromptFactsLines(input.kind, input.facts),
  ].join('\n')
}

/** The user turn for an import's columns. */
export function aiCrmMappingPrompt(input: {
  collection: string
  fields: readonly AiCrmImportField[]
  columns: ReadonlyArray<{ header: string; shape: string }>
}): string {
  return [
    `Import: ${input.collection}`,
    'Fields (number: label, type):',
    ...input.fields.map(
      (field, index) => `- ${index}: ${field.label}, ${field.type}${field.required ? ', required' : ''}`,
    ),
    'Columns (number: header, shape):',
    ...input.columns.map((column, index) => `- ${index}: ${column.header || '(no header)'}, ${column.shape}`),
  ].join('\n')
}

/* ------------------------------------------------------------------------ *
 * A record answer, asked once per timeline
 * ------------------------------------------------------------------------ */

/**
 * A digest of the whole request a record answer is produced for. A hash of the
 * request, never of the answer, and nothing of the facts is recoverable from
 * it. The version tag strands every old key when what a key means changes.
 */
export function aiCrmRecordKey(input: {
  kind: AiCrmRecordKind
  id: string
  hostId: string | null
  model: string
  prompt: string
  system: readonly AiSystemBlock[]
  tool: AiTool
}): string {
  const digest = createHash('sha256')
  for (const part of [
    'crm-record.v1',
    input.kind,
    input.id,
    input.hostId ?? '',
    input.model,
    input.prompt,
    ...input.system.map((block) => block.text),
    JSON.stringify(input.tool),
  ]) {
    digest.update(`${part.length}:${part}\u0000`)
  }
  return digest.digest('hex')
}

/** A kept answer about a record, as the reuse lookup reads it. */
export interface AiCrmAnswerCandidate {
  jobId: string
  hostId: string | null
  task: string
  key: string | null
  createdAtMs: number | null
  proposal: AiCrmProposal | null
}

export type AiCrmAnswerFinder = (
  orgId: string,
  key: string,
  firestore?: FirebaseFirestore.Firestore,
) => Promise<AiCrmAnswerCandidate[]>

const millis = (value: unknown): number | null => {
  if (value instanceof Date) return value.getTime()
  const toMillis = (value as { toMillis?: () => number } | null)?.toMillis
  return typeof toMillis === 'function' ? toMillis.call(value) : null
}

/**
 * The finder the step uses in production: one equality on the request key
 * inside the org's kept answers. Firestore's automatic single-field index
 * answers it, so no composite index is deployed; the site and the window are
 * applied in memory.
 */
export const findAiCrmAnswersByKey: AiCrmAnswerFinder = async (orgId, key, firestore) => {
  if (!firestore) return []
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(AI_CRM_ANSWERS_COLLECTION)
    .where('key', '==', key)
    .limit(AI_CRM_REUSE_CANDIDATES)
    .get()
  return snapshot.docs.map((doc) => {
    const data = (doc.data() ?? {}) as Partial<AiCrmAnswerRecord>
    return {
      jobId: doc.id,
      hostId: data.hostId ?? null,
      task: String(data.task ?? ''),
      key: data.key ?? null,
      createdAtMs: millis(data.createdAt),
      proposal: readAiCrmProposal(data.proposal),
    }
  })
}

/** The newest answer another job kept for the same request, inside the window. */
export function aiReusableCrmRecord(
  candidates: readonly AiCrmAnswerCandidate[],
  context: { jobId: string; hostId: string | null; key: string; now: Date },
): { jobId: string; proposal: AiCrmRecordProposal } | null {
  const floor = context.now.getTime() - AI_CRM_REUSE_WINDOW_MS
  let best: { jobId: string; proposal: AiCrmRecordProposal; at: number } | null = null
  for (const candidate of candidates) {
    if (candidate.jobId === context.jobId || candidate.task !== 'record') continue
    if (candidate.hostId !== context.hostId || candidate.key !== context.key) continue
    if (candidate.proposal?.kind !== 'record') continue
    const at = candidate.createdAtMs ?? 0
    if (at < floor) continue
    if (!best || at > best.at) best = { jobId: candidate.jobId, proposal: candidate.proposal, at }
  }
  return best ? { jobId: best.jobId, proposal: best.proposal } : null
}

/* ------------------------------------------------------------------------ *
 * Admission
 * ------------------------------------------------------------------------ */

export interface AiCrmAdmissionDeps {
  readerFor?: AiCrmReaderLookup
  now?: () => Date
}

/**
 * Whether a `crm` job may start here for this member; `null` admits it: its
 * inputs name a record or an import, and the CRM would let the member read it
 * ({@link aiCrmAccessRefusal}). Asked at the create door before the job
 * exists, so a refusal spends nothing. A door that names no member asks
 * nothing of the reader.
 */
export async function aiCrmAdmissionRefusal(
  context: Parameters<AiJobAdmission>[0],
  deps: AiCrmAdmissionDeps = {},
): Promise<AiJobAdmissionRefusal | null> {
  const request = parseAiCrmRequest(context.inputs)
  if (typeof request === 'string') return { status: 400, error: request }
  return aiCrmAccessRefusal({
    firestore: context.firestore,
    orgId: context.orgId,
    hostId: context.hostId ?? null,
    ...aiCrmFactsResource(request),
    org: context.org,
    uid: context.uid,
    ...(deps.readerFor ? { readerFor: deps.readerFor } : {}),
    now: deps.now?.() ?? new Date(),
  })
}

export const aiCrmJobAdmission: AiJobAdmission = (context) => aiCrmAdmissionRefusal(context)

/* ------------------------------------------------------------------------ *
 * The runner
 * ------------------------------------------------------------------------ */

export interface AiJobCrmStepDeps {
  readerFor?: AiCrmReaderLookup
  /** The reuse lookup; specs hand in a fake, and `null` turns reuse off. */
  findAnswersByKey?: AiCrmAnswerFinder | null
}

function modelOf(context: AiJobStepContext): string {
  return context.modelFor?.('job.crm') ?? aiModelForStep('job.crm')
}

/** An answer as the step hands it to be kept; the job's ids and the clock are added. */
type AiCrmAnswerToKeep = Pick<AiCrmAnswerRecord, 'task' | 'resource' | 'recordId' | 'proposal' | 'key'>

/** What a step spent, whatever outputs it goes on to name. */
type AiCrmSpent = Omit<AiJobStepOutcome, 'outputs'>

/**
 * Keeps an answer at `orgs/{orgId}/aiCrmAnswers/{jobId}`, which no client may
 * read, on its own clock.
 */
async function keepAiCrmAnswer(context: AiJobStepContext, answer: AiCrmAnswerToKeep): Promise<void> {
  const { job, now, firestore } = context
  const record = JSON.parse(
    JSON.stringify({ jobId: job.$id, orgId: job.orgId, hostId: job.hostId ?? null, createdBy: job.createdBy, ...answer }),
  ) as AiCrmAnswerRecord
  await firestore
    .collection('orgs')
    .doc(job.orgId)
    .collection(AI_CRM_ANSWERS_COLLECTION)
    .doc(job.$id)
    .set({ ...record, createdAt: now, expiresAt: aiCrmAnswerExpiry(now) })
}

export function createAiJobCrmStep(deps: AiJobCrmStepDeps = {}): AiJobStepRunner {
  const readerFor = deps.readerFor ?? pluginRecordFactsReader
  const findAnswersByKey = deps.findAnswersByKey === undefined ? findAiCrmAnswersByKey : deps.findAnswersByKey
  return async (context): Promise<AiJobStepOutcome> => {
    const { job, now, signal, firestore } = context
    const model = modelOf(context)
    const request = parseAiCrmRequest(job.inputs)
    if (typeof request === 'string') return { ...aiUnspentOutcome(model), failure: request }
    const { resource, id } = aiCrmFactsResource(request)
    const found = readerFor(resource)
    if (!found || found.pluginId !== AI_CRM_PLUGIN_ID) {
      return { ...aiUnspentOutcome(model), failure: AI_CRM_UNAVAILABLE_COPY }
    }
    let facts: Facts
    try {
      const read = await found.reader.read({
        orgId: job.orgId,
        hostId: job.hostId ?? null,
        id,
        // The job's creator: the CRM reads the record as the member who asked.
        uid: job.createdBy,
        org: (context.org as Record<string, unknown> | null | undefined) ?? null,
        now,
      })
      if (read.ok === false) return { ...aiUnspentOutcome(model), failure: read.error }
      facts = read.facts
    } catch (error) {
      console.error('ai crm facts read failed', { orgId: job.orgId, jobId: job.$id, resource, error })
      return { ...aiUnspentOutcome(model), failure: AI_CRM_FACTS_FAILURE_COPY }
    }
    const maxTokens = AI_JOB_CRM_STEP_BUDGET.maxTokens(model)
    const hostId = job.hostId ?? null

    // Keeps the answer, then names it on the job. A keep that fails fails the
    // step as spent: the tokens were used, and there is nothing to show.
    const keep = async (
      spent: AiCrmSpent,
      answer: AiCrmAnswerToKeep,
      output: { id: string; label: string; ref: AiCrmOutputRef },
    ): Promise<AiJobStepOutcome> => {
      try {
        await keepAiCrmAnswer(context, answer)
      } catch (error) {
        console.error('ai crm answer keep failed', { orgId: job.orgId, jobId: job.$id, error })
        return { ...spent, outputs: [], failure: AI_CRM_KEEP_FAILURE_COPY }
      }
      return {
        ...spent,
        outputs: [{ resource: 'crm', id: output.id, hostId, label: output.label, proposal: { ...output.ref } }],
      }
    }

    if (request.task === 'record') {
      const { kind } = request.record
      if (facts['record'] !== kind) return { ...aiUnspentOutcome(model), failure: AI_CRM_FACTS_FAILURE_COPY }
      const instructions = aiCrmRecordInstructions(kind)
      const tool = aiCrmRecordTool(kind)
      const prompt = aiCrmRecordPrompt(kind, facts)
      const key = aiCrmRecordKey({
        kind,
        id,
        hostId,
        model,
        prompt,
        system: aiDoctrineSystemBlocks(undefined, {
          instructions,
          scope: aiDoctrineScopeFor(AI_CRM_GENERATION_KINDS.record),
        }),
        tool,
      })
      const output = { id: AI_CRM_OUTPUT_IDS.record(kind, id), label: OUTPUT_LABELS.record, ref: { kind: 'record', record: { kind, id } } } as const
      // Reuse before asking: an answer kept for the same key is the same
      // request, so the member reads it again at no cost.
      const reused = findAnswersByKey
        ? aiReusableCrmRecord(await findAnswersByKey(job.orgId, key, firestore).catch(() => []), {
            jobId: job.$id,
            hostId,
            key,
            now,
          })
        : null
      if (reused) {
        return keep(
          aiUnspentOutcome(model),
          { task: 'record', resource, recordId: id, key, proposal: { ...reused.proposal, reusedFrom: reused.jobId } },
          output,
        )
      }
      const generation = await runValidatedGeneration(AI_CRM_GENERATION_KINDS.record, {
        step: 'job.crm',
        model,
        instructions,
        messages: [{ role: 'user', content: prompt }],
        tool,
        maxTokens,
        ...(signal ? { signal } : {}),
        check: (answer) => checkAiCrmRecord(answer, aiCrmRecordCheckContext(kind, facts)),
      })
      const spent = aiGenerationSpent(generation)
      if (generation.status === 'refused') return { ...spent, refused: true }
      if (generation.status === 'needs_input') return { ...spent, failure: generation.message }
      const proposal: AiCrmRecordProposal = {
        kind: 'record',
        record: { kind, id },
        summary: generation.value.summary,
        nextStep: generation.value.nextStep,
        stage: generation.value.stage,
        standing: generation.value.standing,
        asOf: now.toISOString().slice(0, 10),
      }
      return keep(spent, { task: 'record', resource, recordId: id, key, proposal }, output)
    }

    if (request.task === 'email') {
      const { kind } = request.record
      if (facts['record'] !== kind) return { ...aiUnspentOutcome(model), failure: AI_CRM_FACTS_FAILURE_COPY }
      const mergeFields = aiCrmEmailMergeFields(kind)
      const generation = await runValidatedGeneration(AI_CRM_GENERATION_KINDS.email, {
        step: 'job.crm',
        model,
        instructions: AI_CRM_EMAIL_INSTRUCTIONS,
        messages: [{ role: 'user', content: aiCrmEmailPrompt({ kind, facts, request: job.brief }) }],
        tool: AI_CRM_EMAIL_TOOL,
        maxTokens,
        ...(signal ? { signal } : {}),
        check: (answer) => checkAiCrmEmail(answer, { mergeFields }),
      })
      const spent = aiGenerationSpent(generation)
      if (generation.status === 'refused') return { ...spent, refused: true }
      if (generation.status === 'needs_input') return { ...spent, failure: generation.message }
      const proposal: AiCrmEmailProposal = {
        kind: 'email',
        record: { kind, id },
        subject: generation.value.subject,
        body: generation.value.body,
      }
      return keep(
        spent,
        { task: 'email', resource, recordId: id, key: null, proposal },
        { id: AI_CRM_OUTPUT_IDS.email(kind, id), label: OUTPUT_LABELS.email, ref: { kind: 'email', record: { kind, id } } },
      )
    }

    const fields = aiCrmImportFields(facts)
    if (facts['record'] !== 'import' || !fields.length) {
      return { ...aiUnspentOutcome(model), failure: AI_CRM_FACTS_FAILURE_COPY }
    }
    const generation = await runValidatedGeneration(AI_CRM_GENERATION_KINDS.mapping, {
      step: 'job.crm',
      model,
      instructions: AI_CRM_MAPPING_INSTRUCTIONS,
      messages: [
        {
          role: 'user',
          content: aiCrmMappingPrompt({ collection: request.collection, fields, columns: request.columns }),
        },
      ],
      tool: AI_CRM_MAPPING_TOOL,
      maxTokens,
      ...(signal ? { signal } : {}),
      check: (answer) => checkAiCrmMapping(answer, { columns: request.columns, fields }),
    })
    const spent = aiGenerationSpent(generation)
    if (generation.status === 'refused') return { ...spent, refused: true }
    if (generation.status === 'needs_input') return { ...spent, failure: generation.message }
    const proposal: AiCrmMappingProposal = {
      kind: 'mapping',
      collection: request.collection,
      matches: generation.value,
      columns: request.columns.length,
    }
    return keep(
      spent,
      { task: 'mapping', resource, recordId: request.collection, key: null, proposal },
      {
        id: AI_CRM_OUTPUT_IDS.mapping(request.collection),
        label: OUTPUT_LABELS.mapping,
        ref: { kind: 'mapping', collection: request.collection },
      },
    )
  }
}

export const runAiJobCrmStep = createAiJobCrmStep()

/** Registers the CRM step and the check a `crm` job passes before it is created. */
export function registerAiCrmJob(): void {
  registerAiJobStep('crm', runAiJobCrmStep, { minimumMs: AI_JOB_CRM_STEP_MINIMUM_MS })
  registerAiJobAdmission('crm', aiCrmJobAdmission)
}
