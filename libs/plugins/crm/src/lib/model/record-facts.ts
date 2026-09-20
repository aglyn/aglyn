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
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_SOURCE_LABELS,
  CRM_ACTIVITY_KIND_LABELS,
  CRM_EMAIL_DELIVERY_STATE_LABELS,
  CRM_LEAD_STATUS_LABELS,
  CRM_TASK_KIND_LABELS,
  contactDisplayName,
  crmLeadStatus,
  customImportTarget,
  dealStageById,
  fieldDefinitionObject,
  interactionsForGroup,
  isContactLifecycleStage,
  isCrmEmailDeliveryState,
  readContactFacet,
  type ConsentGroup,
  type ContactFieldDefinition,
  type ContactInteraction,
  type CrmActivity,
  type CrmCompany,
  type CrmDeal,
  type CrmFieldObject,
  type CrmPipeline,
  type CrmTask,
} from '@aglyn/aglyn/server'
import {
  COMPANY_IMPORT_FIELD_LABELS,
  COMPANY_IMPORT_FIELDS,
} from './crm-company-import'
import {
  CONTACT_IMPORT_FIELD_LABELS,
  CONTACT_IMPORT_FIELDS,
} from './crm-import'
import { DEAL_IMPORT_FIELD_LABELS, DEAL_IMPORT_FIELDS } from './crm-deal-import'
import { LEAD_IMPORT_FIELD_LABELS, LEAD_IMPORT_FIELDS } from './crm-lead-import'

/**
 * WHAT THE CRM TELLS ANOTHER PLUGIN ABOUT ONE OF ITS RECORDS (AGL-2917).
 *
 * The facts a reader on the core's record-facts seam reports: one contact,
 * company, deal or lead as a person on the team sees it, and the fields a
 * spreadsheet import may fill. The server half reads the documents and
 * applies who may see them (`server/record-facts.ts`); this half decides
 * which of their fields leave the CRM at all, so the list below is the whole
 * of what a caller — an assistant summarizing a record, an automation
 * deciding on one — can pass on.
 *
 * ## What never leaves
 *
 * No email address, phone number or postal address of anyone; no marketing
 * consent; no custom field VALUE; no team member's name or id; no document
 * id of any record; no file; no order or payment detail beyond a count. A
 * logged email carries its subject and a cut of its body, never the address
 * it went to or came from. An import catalog carries field keys, labels and
 * types, never a row of the file.
 *
 * Every text a person wrote into a record — a name, a job title, a tag, notes,
 * a logged activity, a capture's summary, a task's or a deal's title, a
 * reason — is reported as written, except that an email address or a phone
 * number inside it is replaced by a placeholder first ({@link crmFactProse}):
 * an import that put an address in the name column leaves no address behind.
 * What the workspace configured — pipeline, stage and field names — and a
 * company's domain are reported as they are. A postal address typed into a
 * note is not recognized and leaves as typed.
 *
 * ## Stable bytes
 *
 * Every builder writes its keys in one order, dates as UTC calendar days and
 * money as a currency code and a fixed-point amount, so the same records read
 * twice report the same facts — a caller may key a cache on them, and one
 * that does sees a change exactly when something it was told has changed.
 */

/** The records a reader is registered for, by the seam's resource name. */
export const CRM_RECORD_FACTS_RESOURCES = {
  contact: 'crm.contact',
  company: 'crm.company',
  deal: 'crm.deal',
  lead: 'crm.lead',
} as const

export type CrmRecordFactsKind = keyof typeof CRM_RECORD_FACTS_RESOURCES

/** The import catalogs, read by collection name as the record id. */
export const CRM_IMPORT_FACTS_RESOURCE = 'crm.import'

export const CRM_IMPORT_FACTS_COLLECTIONS = ['contacts', 'companies', 'deals', 'leads'] as const

export type CrmImportFactsCollection = (typeof CRM_IMPORT_FACTS_COLLECTIONS)[number]

export function isCrmImportFactsCollection(value: unknown): value is CrmImportFactsCollection {
  return typeof value === 'string' && (CRM_IMPORT_FACTS_COLLECTIONS as readonly string[]).includes(value)
}

/** Newest timeline entries reported for a record. */
export const CRM_FACTS_TIMELINE_MAX = 12
/** Open tasks reported for a record. */
export const CRM_FACTS_TASKS_MAX = 8
/** Deals reported for a contact or a company. */
export const CRM_FACTS_DEALS_MAX = 5
/** Tags reported for a record. */
export const CRM_FACTS_TAGS_MAX = 10
/** How much of a logged activity's text, or a platform capture's summary, is reported. */
export const CRM_FACTS_TEXT_MAX = 280
/** How much of a record's notes is reported. */
export const CRM_FACTS_NOTES_MAX = 600
/** How long a name, a title or a subject may run. */
export const CRM_FACTS_LABEL_MAX = 120
/** Custom fields an import catalog reports. */
export const CRM_FACTS_CUSTOM_FIELDS_MAX = 40

/** One thing that happened, as a record's timeline reports it. */
export interface CrmTimelineFact {
  /** The UTC day it happened, `YYYY-MM-DD`. */
  on: string
  /** What happened: a logged kind (Call, Email) or the capture it came through (Form, Booking). */
  kind: string
  /** `outbound` or `inbound` for an email; absent otherwise. */
  direction?: string
  subject?: string
  text?: string
  outcome?: string
  /** How far a sent email got: Sent, Delivered, Opened, Clicked, Bounced, Complained. */
  delivery?: string
}

/** One task still to do. */
export interface CrmTaskFact {
  title: string
  kind: string
  priority: string
  /** The UTC day it is due, or `null` for a task with no due date. */
  due: string | null
  overdue: boolean
}

/** One deal, as a contact's or a company's facts report it. */
export interface CrmDealFact {
  title: string
  stage: string
  status: string
  amount: string | null
  expectedClose: string | null
}

export interface CrmContactFacts {
  record: 'contact'
  name: string
  jobTitle: string
  company: string
  lifecycleStage: string
  tags: string[]
  /** The captures that met the person: Form, Booking, Customer. */
  sources: string[]
  orders: number
  lastPurchase: string | null
  since: string | null
  lastEmailEngagement: string | null
  notes: string
  timeline: CrmTimelineFact[]
  openTasks: CrmTaskFact[]
  deals: CrmDealFact[]
}

export interface CrmCompanyFacts {
  record: 'company'
  name: string
  domain: string
  industry: string
  tags: string[]
  people: number
  since: string | null
  notes: string
  timeline: CrmTimelineFact[]
  openTasks: CrmTaskFact[]
  deals: CrmDealFact[]
}

/** One stage of a deal's pipeline, in order. */
export interface CrmStageFact {
  id: string
  name: string
  kind: 'open' | 'won' | 'lost'
}

export interface CrmDealFacts {
  record: 'deal'
  title: string
  pipeline: string
  stages: CrmStageFact[]
  stageId: string
  stage: string
  status: string
  amount: string | null
  expectedClose: string | null
  inStageSince: string | null
  lostReason: string
  /** The name of the person the deal is with, as the deal copied it. */
  contact: string
  company: string
  products: number
  since: string | null
  notes: string
  timeline: CrmTimelineFact[]
  openTasks: CrmTaskFact[]
}

export interface CrmLeadFacts {
  record: 'lead'
  name: string
  status: string
  /** Where the lead was captured: Form, Booking, Sign-up, Import. */
  sources: string[]
  captures: number
  firstSeen: string | null
  lastSeen: string | null
  assigned: boolean
  converted: boolean
  unqualifiedReason: string
  notes: string
  timeline: CrmTimelineFact[]
}

export type CrmRecordFacts = CrmContactFacts | CrmCompanyFacts | CrmDealFacts | CrmLeadFacts

/** What a column of a file may hold, as an import field expects it. */
export type CrmImportFieldType = 'email' | 'phone' | 'number' | 'date' | 'yes-no' | 'url' | 'text'

/** One field an import may fill. */
export interface CrmImportFieldFact {
  /** The mapping target: a standard field's key, or `custom:<key>`. */
  key: string
  label: string
  type: CrmImportFieldType
  required: boolean
}

export interface CrmImportFacts {
  record: 'import'
  collection: CrmImportFactsCollection
  fields: CrmImportFieldFact[]
}

const DAY_MS = 86_400_000

/** A value as trimmed, single-spaced text of at most `max` characters. */
export function crmFactText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Epoch millis, a `Date` or a stored timestamp, as epoch millis; `null` for anything else. */
export function crmFactMillis(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  const toMillis = (value as { toMillis?: () => number } | null | undefined)?.toMillis
  if (typeof toMillis === 'function') {
    const millis = toMillis.call(value)
    return Number.isFinite(millis) ? millis : null
  }
  return null
}

/** A UTC calendar day, `YYYY-MM-DD`, or `null`. */
export function crmFactDay(value: unknown): string | null {
  const millis = crmFactMillis(value)
  return millis === null ? null : new Date(millis).toISOString().slice(0, 10)
}

/** An amount as a currency code and a fixed-point figure: `USD 1250.00`. */
export function crmFactMoney(cents: unknown, currency: unknown): string | null {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null
  const code = (typeof currency === 'string' && /^[a-z]{3}$/i.test(currency) ? currency : 'usd').toUpperCase()
  return `${code} ${(cents / 100).toFixed(2)}`
}

/** An email address written inside free text. */
const EMAIL_IN_PROSE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
/** A run of digits and the separators a phone number is written with. */
const DIGIT_RUN_IN_PROSE = /\+?\(?\d[\d\s().-]{7,}\d/g
/** Calendar days, which a run of digits may be and a phone number is not. */
const DAYS_ONLY = /^\d{4}-\d{2}-\d{2}(?:\s+\d{4}-\d{2}-\d{2})*$/

export const CRM_FACTS_EMAIL_PLACEHOLDER = '[email address]'
export const CRM_FACTS_PHONE_PLACEHOLDER = '[phone number]'

/**
 * Free text the team wrote, as {@link crmFactText} reports it, with every
 * email address, and every run of ten digits or more that is not a list of
 * days, replaced by a placeholder. The fields that hold an address or a number
 * are never reported, and this keeps one typed into a note from leaving
 * either. Replaced before the cut, so a cut never halves an address into
 * something unrecognized.
 */
export function crmFactProse(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const scrubbed = value
    .replace(EMAIL_IN_PROSE, CRM_FACTS_EMAIL_PLACEHOLDER)
    .replace(DIGIT_RUN_IN_PROSE, (run) =>
      DAYS_ONLY.test(run.trim()) || run.replace(/\D/g, '').length < 10 ? run : CRM_FACTS_PHONE_PLACEHOLDER,
    )
  return crmFactText(scrubbed, max)
}

function tagsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((tag) => crmFactProse(tag, 40))
        .filter(Boolean)
        .slice(0, CRM_FACTS_TAGS_MAX)
    : []
}

/** A logged activity as a timeline entry. */
export function crmActivityFact(activity: Partial<CrmActivity>): CrmTimelineFact | null {
  const on = crmFactDay(activity.atMs)
  if (!on) return null
  const kind = activity.kind && CRM_ACTIVITY_KIND_LABELS[activity.kind] ? activity.kind : 'other'
  const fact: CrmTimelineFact = { on, kind: CRM_ACTIVITY_KIND_LABELS[kind] }
  if (kind === 'email' && (activity.direction === 'outbound' || activity.direction === 'inbound')) {
    fact.direction = activity.direction
  }
  const subject = crmFactProse(activity.subject ?? activity.threadSubject, CRM_FACTS_LABEL_MAX)
  if (subject) fact.subject = subject
  const text = crmFactProse(activity.body, CRM_FACTS_TEXT_MAX)
  if (text) fact.text = text
  const outcome = crmFactProse(activity.outcome, CRM_FACTS_LABEL_MAX)
  if (outcome) fact.outcome = outcome
  if (kind === 'email' && isCrmEmailDeliveryState(activity.deliveryState)) {
    fact.delivery = CRM_EMAIL_DELIVERY_STATE_LABELS[activity.deliveryState]
  }
  return fact
}

/** A capture the platform recorded on a contact, as a timeline entry. */
export function crmInteractionFact(interaction: Partial<ContactInteraction>): CrmTimelineFact | null {
  const on = crmFactDay(interaction.atMs)
  if (!on) return null
  const kind =
    interaction.type && CONTACT_SOURCE_LABELS[interaction.type] ? CONTACT_SOURCE_LABELS[interaction.type] : 'Capture'
  const text = crmFactProse(interaction.summary, CRM_FACTS_TEXT_MAX)
  return text ? { on, kind, text } : { on, kind }
}

/**
 * Timeline entries newest first, at most {@link CRM_FACTS_TIMELINE_MAX}. A
 * tie keeps the order the entries arrived in, so the same reads report the
 * same list.
 */
export function crmTimelineFacts(
  entries: ReadonlyArray<{ atMs: unknown; fact: CrmTimelineFact | null }>,
): CrmTimelineFact[] {
  return entries
    .map((entry, index) => ({ at: crmFactMillis(entry.atMs) ?? 0, index, fact: entry.fact }))
    .filter((entry): entry is { at: number; index: number; fact: CrmTimelineFact } => entry.fact !== null)
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .slice(0, CRM_FACTS_TIMELINE_MAX)
    .map((entry) => entry.fact)
}

/** The open tasks among `tasks`, soonest due first, undated last. */
export function crmOpenTaskFacts(tasks: ReadonlyArray<Partial<CrmTask>>, nowMs: number): CrmTaskFact[] {
  return tasks
    .filter((task) => task.status !== 'done' && crmFactText(task.title, CRM_FACTS_LABEL_MAX))
    .map((task, index) => ({ task, index, due: crmFactMillis(task.dueAtMs) }))
    .sort((a, b) => (a.due ?? Number.POSITIVE_INFINITY) - (b.due ?? Number.POSITIVE_INFINITY) || a.index - b.index)
    .slice(0, CRM_FACTS_TASKS_MAX)
    .map(({ task, due }) => ({
      title: crmFactProse(task.title, CRM_FACTS_LABEL_MAX),
      kind: task.kind && CRM_TASK_KIND_LABELS[task.kind] ? CRM_TASK_KIND_LABELS[task.kind] : 'To-do',
      priority: task.priority === 'high' || task.priority === 'low' ? task.priority : 'normal',
      due: due === null ? null : crmFactDay(due),
      // Overdue by the UTC day: a task due today is not overdue until tomorrow.
      overdue: due !== null && Math.floor(due / DAY_MS) < Math.floor(nowMs / DAY_MS),
    }))
}

/** One deal, with its stage named by the pipeline it is in. */
export function crmDealFact(deal: Partial<CrmDeal>, pipeline: CrmPipeline | null | undefined): CrmDealFact {
  const stage = dealStageById(pipeline ?? undefined, String(deal.stageId ?? ''))
  return {
    title: crmFactProse(deal.title, CRM_FACTS_LABEL_MAX),
    stage: crmFactText(stage?.name, CRM_FACTS_LABEL_MAX),
    status: deal.status === 'won' || deal.status === 'lost' ? deal.status : 'open',
    amount: crmFactMoney(deal.amountCents, deal.currency),
    expectedClose: crmFactDay(deal.expectedCloseAtMs),
  }
}

/** Deals, open ones first, then most recently updated. */
export function crmDealFacts(
  deals: ReadonlyArray<Partial<CrmDeal>>,
  pipelines: ReadonlyMap<string, CrmPipeline>,
): CrmDealFact[] {
  return deals
    .map((deal, index) => ({ deal, index, updated: crmFactMillis(deal.updatedAt) ?? 0 }))
    .sort(
      (a, b) =>
        Number(a.deal.status !== 'open') - Number(b.deal.status !== 'open') ||
        b.updated - a.updated ||
        a.index - b.index,
    )
    .slice(0, CRM_FACTS_DEALS_MAX)
    .map(({ deal }) => crmDealFact(deal, pipelines.get(String(deal.pipelineId ?? ''))))
}

export interface ContactFactsInput {
  row: Record<string, unknown>
  /** The holder whose facet the person is read through. */
  group: ConsentGroup
  activities: ReadonlyArray<Partial<CrmActivity>>
  tasks: ReadonlyArray<Partial<CrmTask>>
  deals: ReadonlyArray<Partial<CrmDeal>>
  pipelines: ReadonlyMap<string, CrmPipeline>
  nowMs: number
}

export function contactFacts(input: ContactFactsInput): CrmContactFacts {
  const { row, group } = input
  const facet = readContactFacet(row, group.groupId)
  const sources = Object.entries(facet.sources ?? {})
    .filter(([, on]) => on === true)
    .map(([source]) => CONTACT_SOURCE_LABELS[source as keyof typeof CONTACT_SOURCE_LABELS] ?? '')
    .filter(Boolean)
  const interactions = interactionsForGroup(facet.interactions, group.hostIds)
  return {
    record: 'contact',
    name: crmFactProse(contactDisplayName(row, group.groupId), CRM_FACTS_LABEL_MAX),
    jobTitle: crmFactProse(facet.jobTitle, CRM_FACTS_LABEL_MAX),
    company: crmFactProse(facet.companyName, CRM_FACTS_LABEL_MAX),
    lifecycleStage: isContactLifecycleStage(facet.lifecycleStage)
      ? CONTACT_LIFECYCLE_STAGE_LABELS[facet.lifecycleStage]
      : '',
    tags: tagsOf(facet.tags),
    sources: [...new Set(sources)].sort(),
    orders: typeof facet.ordersCount === 'number' && facet.ordersCount > 0 ? Math.floor(facet.ordersCount) : 0,
    lastPurchase: crmFactDay(facet.lastPurchaseAtMs),
    since: crmFactDay(row['createdAt']),
    lastEmailEngagement: crmFactDay(facet.lastEmailEngagementAtMs),
    notes: crmFactProse(facet.notes, CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts([
      ...input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmActivityFact(activity) })),
      ...interactions.map((interaction) => ({ atMs: interaction.atMs, fact: crmInteractionFact(interaction) })),
    ]),
    openTasks: crmOpenTaskFacts(input.tasks, input.nowMs),
    deals: crmDealFacts(input.deals, input.pipelines),
  }
}

export interface CompanyFactsInput {
  company: Partial<CrmCompany>
  activities: ReadonlyArray<Partial<CrmActivity>>
  tasks: ReadonlyArray<Partial<CrmTask>>
  deals: ReadonlyArray<Partial<CrmDeal>>
  pipelines: ReadonlyMap<string, CrmPipeline>
  nowMs: number
}

export function companyFacts(input: CompanyFactsInput): CrmCompanyFacts {
  const { company } = input
  return {
    record: 'company',
    name: crmFactProse(company.name, CRM_FACTS_LABEL_MAX),
    domain: crmFactText(company.domain, CRM_FACTS_LABEL_MAX),
    industry: crmFactProse(company.industry, CRM_FACTS_LABEL_MAX),
    tags: tagsOf(company.tags),
    people:
      typeof company.contactsCount === 'number' && company.contactsCount > 0
        ? Math.floor(company.contactsCount)
        : 0,
    since: crmFactDay(company.createdAt),
    notes: crmFactProse(company.notes, CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts(
      input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmActivityFact(activity) })),
    ),
    openTasks: crmOpenTaskFacts(input.tasks, input.nowMs),
    deals: crmDealFacts(input.deals, input.pipelines),
  }
}

export interface DealFactsInput {
  deal: Partial<CrmDeal> & { contactName?: unknown; companyName?: unknown }
  pipeline: CrmPipeline | null
  activities: ReadonlyArray<Partial<CrmActivity>>
  tasks: ReadonlyArray<Partial<CrmTask>>
  nowMs: number
}

export function dealFacts(input: DealFactsInput): CrmDealFacts {
  const { deal, pipeline } = input
  const summary = crmDealFact(deal, pipeline)
  const stages = [...(pipeline?.stages ?? [])]
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((stage) => ({
      id: String(stage.id),
      name: crmFactText(stage.name, CRM_FACTS_LABEL_MAX),
      kind: stage.kind === 'won' || stage.kind === 'lost' ? stage.kind : ('open' as const),
    }))
  return {
    record: 'deal',
    title: summary.title,
    pipeline: crmFactText(pipeline?.name, CRM_FACTS_LABEL_MAX),
    stages,
    stageId: String(deal.stageId ?? ''),
    stage: summary.stage,
    status: summary.status,
    amount: summary.amount,
    expectedClose: summary.expectedClose,
    inStageSince: crmFactDay(deal.stageChangedAtMs),
    lostReason: crmFactProse(deal.lostReason, CRM_FACTS_LABEL_MAX),
    contact: crmFactProse(deal.contactName, CRM_FACTS_LABEL_MAX),
    company: crmFactProse(deal.companyName, CRM_FACTS_LABEL_MAX),
    products: Array.isArray(deal.lineItems) ? deal.lineItems.length : 0,
    since: crmFactDay(deal.createdAt),
    notes: crmFactProse(deal.notes, CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts(
      input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmActivityFact(activity) })),
    ),
    openTasks: crmOpenTaskFacts(input.tasks, input.nowMs),
  }
}

/** What a lead's capture surfaces are called, the lead history card's words. */
function leadSourceFact(source: string): string {
  if (source === 'signup') return 'Sign-up'
  if (source === 'booking') return 'Booking'
  if (source === 'import') return CONTACT_SOURCE_LABELS.import
  if (source === 'form' || source.startsWith('form:')) return CONTACT_SOURCE_LABELS.form
  return 'Other'
}

export interface LeadFactsInput {
  lead: Record<string, unknown>
  activities: ReadonlyArray<Partial<CrmActivity>>
}

export function leadFacts(input: LeadFactsInput): CrmLeadFacts {
  const { lead } = input
  const rawSources = Array.isArray(lead['sources'])
    ? lead['sources']
    : typeof lead['source'] === 'string'
      ? [lead['source']]
      : []
  const captures = Number(lead['submissionCount'])
  return {
    record: 'lead',
    name: crmFactProse(lead['name'], CRM_FACTS_LABEL_MAX),
    status: CRM_LEAD_STATUS_LABELS[crmLeadStatus(lead as { status?: never })],
    sources: [...new Set(rawSources.map((source) => leadSourceFact(String(source))))].sort(),
    captures: Number.isFinite(captures) && captures > 0 ? Math.floor(captures) : 0,
    firstSeen: crmFactDay(lead['firstSeenAtMs']),
    lastSeen: crmFactDay(lead['lastSeenAtMs']),
    assigned: typeof lead['ownerUid'] === 'string' && lead['ownerUid'] !== '',
    converted: typeof lead['convertedContactId'] === 'string' && lead['convertedContactId'] !== '',
    unqualifiedReason: crmFactProse(lead['unqualifiedReason'], CRM_FACTS_LABEL_MAX),
    notes: crmFactProse(lead['notes'], CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts(
      input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmActivityFact(activity) })),
    ),
  }
}

/** The standard fields of each import, with the type a column must hold for each. */
const STANDARD_IMPORT_FIELDS: Record<
  CrmImportFactsCollection,
  { keys: readonly string[]; labels: Record<string, string>; required: string; types: Record<string, CrmImportFieldType> }
> = {
  contacts: {
    keys: CONTACT_IMPORT_FIELDS,
    labels: CONTACT_IMPORT_FIELD_LABELS,
    required: 'email',
    types: { email: 'email', phone: 'phone', ownerEmail: 'email', marketingConsent: 'yes-no' },
  },
  companies: {
    keys: COMPANY_IMPORT_FIELDS,
    labels: COMPANY_IMPORT_FIELD_LABELS,
    required: 'name',
    types: { phone: 'phone', ownerEmail: 'email', website: 'url' },
  },
  deals: {
    keys: DEAL_IMPORT_FIELDS,
    labels: DEAL_IMPORT_FIELD_LABELS,
    required: 'title',
    types: { amount: 'number', ownerEmail: 'email', expectedClose: 'date' },
  },
  leads: {
    keys: LEAD_IMPORT_FIELDS,
    labels: LEAD_IMPORT_FIELD_LABELS,
    required: 'email',
    types: { email: 'email', ownerEmail: 'email' },
  },
}

/** The object a collection's custom fields describe; leads and deals import none. */
const CUSTOM_FIELD_OBJECT: Partial<Record<CrmImportFactsCollection, CrmFieldObject>> = {
  contacts: 'contact',
  companies: 'company',
}

const CUSTOM_FIELD_TYPES: Record<string, CrmImportFieldType> = {
  number: 'number',
  date: 'date',
  checkbox: 'yes-no',
  url: 'url',
}

/**
 * The fields an import of `collection` may fill: the standard ones in the
 * mapping menu's order, then the org's active custom fields for the record
 * the collection holds, in their own order.
 */
export function importFacts(
  collection: CrmImportFactsCollection,
  customFields: ReadonlyArray<Partial<ContactFieldDefinition>>,
): CrmImportFacts {
  const standard = STANDARD_IMPORT_FIELDS[collection]
  const object = CUSTOM_FIELD_OBJECT[collection]
  const custom = object
    ? customFields
        .filter((field) => field.key && !field.retiredAt && fieldDefinitionObject(field as ContactFieldDefinition) === object)
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.key).localeCompare(String(b.key)))
        .slice(0, CRM_FACTS_CUSTOM_FIELDS_MAX)
        .map((field) => ({
          key: customImportTarget(String(field.key)),
          label: crmFactText(field.label, CRM_FACTS_LABEL_MAX) || String(field.key),
          type: CUSTOM_FIELD_TYPES[String(field.type)] ?? ('text' as const),
          required: false,
        }))
    : []
  return {
    record: 'import',
    collection,
    fields: [
      ...standard.keys.map((key) => ({
        key,
        label: standard.labels[key] ?? key,
        type: standard.types[key] ?? ('text' as const),
        required: key === standard.required,
      })),
      ...custom,
    ],
  }
}
