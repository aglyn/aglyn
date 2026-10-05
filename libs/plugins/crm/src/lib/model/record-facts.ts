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
  CONTACT_ALTERNATE_EMAILS_FIELD,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_SOURCE_LABELS,
  CRM_ACTIVITY_KIND_LABELS,
  CRM_EMAIL_DELIVERY_STATE_LABELS,
  CRM_TASK_KIND_LABELS,
  contactDisplayName,
  crmLeadStatusLabel,
  CRM_FORECAST_CATEGORY_LABELS,
  crmActivityDirection,
  customImportTarget,
  DEAL_NEXT_STEP_MAX,
  dealContactRolesOf,
  dealForecastCategory,
  dealProbability,
  dealStageById,
  dealStageForecastCategory,
  fieldDefinitionObject,
  interactionsForGroup,
  isContactLifecycleStage,
  isCrmEmailDeliveryState,
  readContactFacet,
  readMarketingBasis,
  type AglynPostalAddress,
  type ConsentGroup,
  type ContactFieldDefinition,
  type ContactInteraction,
  type CrmActivity,
  type CrmCompany,
  type CrmDeal,
  type CrmFieldObject,
  type CrmPicklist,
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
 * applies who may see them (`server/record-facts.ts`); this half shapes
 * them, so the list below is the whole of what a caller — an assistant
 * summarizing a record, an automation deciding on one — can pass on.
 *
 * ## The whole record (AGL-3520)
 *
 * These builders answer only for an organization with
 * `release_crm_assist_whole_record` on; with it off, the readers answer
 * `record-facts-disclosed.ts`, the fields the published pages promise.
 * A record is reported as the CRM shows it: every standard field —
 * Salesforce's included — with its email addresses, phone numbers, postal
 * addresses, birthdate, assistant and reports-to; the labels of its
 * picklists as the record holds them; its custom field values under their
 * labels; its marketing consent; its notes, newest timeline entries and
 * open tasks and deals. Text a person wrote is reported as written.
 *
 * ## What still never leaves
 *
 * No authentication token, no account identifier and no internal record
 * id. A related record — the company a person works for, the contact a deal
 * is with, the person someone reports to, a parent company, a campaign — is
 * named by its name; a team member by their display name. The one id a
 * caller is handed is a pipeline stage's, which a stage proposal must name.
 * An import catalog carries field keys, labels and types, never a row of
 * the file.
 *
 * ## Bounded
 *
 * Every list and every long text is cut — notes to
 * {@link CRM_FACTS_NOTES_MAX}, a timeline entry to {@link CRM_FACTS_TEXT_MAX},
 * at most {@link CRM_FACTS_CUSTOM_FIELDS_MAX} custom fields — so a record
 * holding everything still fits the request a caller builds from it.
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
/** How much of a logged activity's text, a capture's summary, a task's notes or a custom value is reported. */
export const CRM_FACTS_TEXT_MAX = 280
/** How much of a record's notes is reported. */
export const CRM_FACTS_NOTES_MAX = 600
/** How long a name, a title or a subject may run. */
export const CRM_FACTS_LABEL_MAX = 120
/** Custom fields an import catalog, or a record, reports. */
export const CRM_FACTS_CUSTOM_FIELDS_MAX = 40
/** Products a deal's facts list. */
export const CRM_FACTS_PRODUCTS_MAX = 20
/** Email addresses and campaigns a record's facts list. */
export const CRM_FACTS_LIST_MAX = 10

/** One thing that happened, as a record's timeline reports it. */
export interface CrmTimelineFact {
  /** The UTC day it happened, `YYYY-MM-DD`. */
  on: string
  /** What happened: a logged kind (Call, Email) or the capture it came through (Form, Booking). */
  kind: string
  /** `outbound` or `inbound` for an email; also `internal` for a call (AGL-3517); absent otherwise. */
  direction?: string
  /** Who an email came from and went to, as the activity recorded them (AGL-3520). */
  from?: string
  to?: string
  subject?: string
  text?: string
  outcome?: string
  /** How far a sent email got: Sent, Delivered, Opened, Clicked, Bounced, Complained. */
  delivery?: string
}

/** One task still to do. */
export interface CrmTaskFact {
  title: string
  /** The org's Type label when the task holds one, else its kind's name (AGL-3517). */
  kind: string
  /** The meaning — `high`, `normal` or `low` — whatever the org calls it. */
  priority: string
  /** The org's Status label ("In Progress"), when the task holds one (AGL-3517). */
  status?: string
  /** The UTC day it is due, or `null` for a task with no due date. */
  due: string | null
  overdue: boolean
  /** Who it is assigned to, by name (AGL-3520). */
  assignee?: string
  /** What the task says beyond its title (AGL-3520). */
  notes?: string
}

/** One deal, as a contact's or a company's facts report it. */
export interface CrmDealFact {
  title: string
  stage: string
  status: string
  amount: string | null
  expectedClose: string | null
}

/** One custom field's value, under the label the org gave the field (AGL-3520). */
export interface CrmCustomFact {
  label: string
  value: string
}

/** One product on a deal (AGL-3520). */
export interface CrmProductFact {
  name: string
  quantity: number
  unitAmount: string | null
}

export interface CrmContactFacts {
  record: 'contact'
  name: string
  salutation: string
  firstName: string
  lastName: string
  /** Every address the person is reached at: the canonical one first (AGL-3520). */
  emails: string[]
  phone: string
  mobilePhone: string
  homePhone: string
  otherPhone: string
  fax: string
  jobTitle: string
  department: string
  /** A `YYYY-MM-DD` day, or `''`. */
  birthdate: string
  assistant: string
  assistantPhone: string
  /** The name of the contact the person reports to (AGL-3515). */
  reportsTo: string
  mailingAddress: string
  otherAddress: string
  /** They asked not to be phoned — a fact an assistant drafting a next step must respect. */
  doNotCall: boolean
  company: string
  lifecycleStage: string
  leadSource: string
  owner: string
  /** Whether the person agreed to marketing email from this site, and since when. */
  marketingConsent: string
  tags: string[]
  /** The captures that met the person: Form, Booking, Customer. */
  sources: string[]
  orders: number
  lastPurchase: string | null
  since: string | null
  lastEmailEngagement: string | null
  custom: CrmCustomFact[]
  notes: string
  timeline: CrmTimelineFact[]
  openTasks: CrmTaskFact[]
  deals: CrmDealFact[]
}

export interface CrmCompanyFacts {
  record: 'company'
  name: string
  domain: string
  website: string
  phone: string
  fax: string
  industry: string
  /** Salesforce's Account fields (AGL-3514). */
  type: string
  rating: string
  ownership: string
  accountSource: string
  employees: number | null
  annualRevenue: string | null
  accountNumber: string
  site: string
  tickerSymbol: string
  sicCode: string
  billingAddress: string
  shippingAddress: string
  /** The name of the company this one sits under. */
  parentCompany: string
  owner: string
  tags: string[]
  people: number
  since: string | null
  custom: CrmCustomFact[]
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
  /** Chance of closing from the stage, 0–100 (AGL-3516). */
  probability: number
  /** The forecast category a deal takes in the stage, as its label. */
  forecastCategory: string
}

/** One contact on a deal, as the facts name them (AGL-3521). */
export interface CrmContactRoleFact {
  /** The person's name, or `''` where it could not be read. */
  name: string
  /** The role's label, or `''` for none. */
  role: string
  primary: boolean
}

/** The contacts a deal's facts name — the committee, not the whole list. */
export const CRM_FACTS_CONTACT_ROLES_MAX = 10

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
  /*
   * Salesforce's Opportunity fields (AGL-3516).
   */
  type: string
  leadSource: string
  nextStep: string
  /** The deal's own odds when it overrides the stage's, else the stage's; `null` for neither. */
  probability: number | null
  /** The forecast category's label. */
  forecastCategory: string
  /** The campaign the deal is credited to, by name (AGL-3520). */
  campaign: string
  /** The name of the person the deal is with, as the deal copied it. */
  contact: string
  /**
   * Every contact on the deal and the part each plays (AGL-3521), the
   * Primary first — named as the reader resolved them, at most
   * {@link CRM_FACTS_CONTACT_ROLES_MAX}.
   */
  contactRoles: CrmContactRoleFact[]
  company: string
  owner: string
  products: CrmProductFact[]
  since: string | null
  custom: CrmCustomFact[]
  notes: string
  timeline: CrmTimelineFact[]
  openTasks: CrmTaskFact[]
}

export interface CrmLeadFacts {
  record: 'lead'
  name: string
  /*
   * The lead's own profile and Salesforce's standard lead fields
   * (AGL-3231, AGL-3513), with how to reach the person (AGL-3520).
   */
  salutation: string
  firstName: string
  lastName: string
  email: string
  phone: string
  mobilePhone: string
  fax: string
  website: string
  address: string
  company: string
  jobTitle: string
  leadSource: string
  industry: string
  rating: string
  employees: number | null
  annualRevenue: string | null
  /** They asked not to be phoned — a fact an assistant drafting a next step must respect. */
  doNotCall: boolean
  status: string
  owner: string
  /** The campaigns the lead is filed under, by name. */
  campaigns: string[]
  marketingConsent: string
  tags: string[]
  /** Where the lead was captured: Form, Booking, Sign-up, Import. */
  sources: string[]
  captures: number
  firstSeen: string | null
  lastSeen: string | null
  assigned: boolean
  converted: boolean
  unqualifiedReason: string
  custom: CrmCustomFact[]
  notes: string
  timeline: CrmTimelineFact[]
  openTasks: CrmTaskFact[]
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

/**
 * What the server half resolves for a builder, because a fact names a
 * related record or a person and the builder reads no document: a team
 * member's display name, the record's custom field definitions, and the
 * names of the records it points at.
 */
export interface CrmFactsNames {
  /** A team member's display name for a uid; `''` when the roster has none. */
  member?: (uid: string) => string
  /** The org's custom field definitions, every object's; each builder takes its own. */
  customFields?: ReadonlyArray<Partial<ContactFieldDefinition>>
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

/** A postal address on one line, its parts in the order an envelope writes them; `''` for none. */
export function crmFactAddress(address: Partial<AglynPostalAddress> | null | undefined): string {
  if (!address || typeof address !== 'object') return ''
  const part = (value: unknown) => crmFactText(value, CRM_FACTS_LABEL_MAX)
  const cityLine = [part(address.city), [part(address.state), part(address.postalCode)].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  return [part(address.line1), part(address.line2), cityLine, part(address.country)].filter(Boolean).join(', ')
}

/** A marketing basis as a sentence's worth: opted in (and since when), declined, or nothing recorded. */
export function crmFactConsent(record: Record<string, unknown>, group: ConsentGroup | null | undefined): string {
  if (!group) return ''
  const consent = readMarketingBasis(record, group)
  if (consent.basis === 'granted') {
    const since = crmFactDay(consent.basisAtMs)
    return since ? `opted in on ${since}` : 'opted in'
  }
  return consent.basis === 'declined' ? 'declined' : 'none recorded'
}

/** A custom value as text: a day for a date, yes or no for a checkbox. */
function customValueText(value: unknown, type: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (type === 'date') return crmFactDay(typeof value === 'string' ? Date.parse(value) : value) ?? crmFactText(String(value), CRM_FACTS_TEXT_MAX)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return crmFactText(String(value), CRM_FACTS_TEXT_MAX)
}

/**
 * A record's custom values under their fields' labels, in the fields'
 * order — the active fields of `object` first, then a value whose field was
 * retired or never defined, under its key.
 */
export function crmCustomFacts(
  custom: unknown,
  object: CrmFieldObject,
  definitions: ReadonlyArray<Partial<ContactFieldDefinition>> = [],
): CrmCustomFact[] {
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) return []
  const values = custom as Record<string, unknown>
  const own = definitions
    .filter((field) => field.key && fieldDefinitionObject(field as ContactFieldDefinition) === object)
    .sort(
      (a, b) =>
        Number(Boolean(a.retiredAt)) - Number(Boolean(b.retiredAt)) ||
        Number(a.order ?? 0) - Number(b.order ?? 0) ||
        String(a.key).localeCompare(String(b.key)),
    )
  const facts: CrmCustomFact[] = []
  const seen = new Set<string>()
  for (const field of own) {
    const key = String(field.key)
    seen.add(key)
    const value = customValueText(values[key], field.type)
    if (value) facts.push({ label: crmFactText(field.label, CRM_FACTS_LABEL_MAX) || key, value })
  }
  for (const key of Object.keys(values).sort()) {
    if (seen.has(key)) continue
    const value = customValueText(values[key], undefined)
    if (value) facts.push({ label: key, value })
  }
  return facts.slice(0, CRM_FACTS_CUSTOM_FIELDS_MAX)
}

function tagsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((tag) => crmFactText(tag, 40))
        .filter(Boolean)
        .slice(0, CRM_FACTS_TAGS_MAX)
    : []
}

const memberName = (names: CrmFactsNames | undefined, uid: unknown): string =>
  typeof uid === 'string' && uid ? crmFactText(names?.member?.(uid) ?? '', CRM_FACTS_LABEL_MAX) : ''

/** A logged activity as a timeline entry. */
export function crmActivityFact(activity: Partial<CrmActivity>): CrmTimelineFact | null {
  const on = crmFactDay(activity.atMs)
  if (!on) return null
  const kind = activity.kind && CRM_ACTIVITY_KIND_LABELS[activity.kind] ? activity.kind : 'other'
  const fact: CrmTimelineFact = { on, kind: CRM_ACTIVITY_KIND_LABELS[kind] }
  const direction = crmActivityDirection(kind, activity.direction)
  if (direction) fact.direction = direction
  const from = crmFactText(activity.from, CRM_FACTS_LABEL_MAX)
  if (from) fact.from = from
  const to = crmFactText(activity.to, CRM_FACTS_LABEL_MAX)
  if (to) fact.to = to
  const subject = crmFactText(activity.subject ?? activity.threadSubject, CRM_FACTS_LABEL_MAX)
  if (subject) fact.subject = subject
  const text = crmFactText(activity.body, CRM_FACTS_TEXT_MAX)
  if (text) fact.text = text
  const outcome = crmFactText(activity.outcome, CRM_FACTS_LABEL_MAX)
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
  const text = crmFactText(interaction.summary, CRM_FACTS_TEXT_MAX)
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
export function crmOpenTaskFacts(
  tasks: ReadonlyArray<Partial<CrmTask>>,
  nowMs: number,
  names?: CrmFactsNames,
): CrmTaskFact[] {
  return tasks
    .filter((task) => task.status !== 'done' && crmFactText(task.title, CRM_FACTS_LABEL_MAX))
    .map((task, index) => ({ task, index, due: crmFactMillis(task.dueAtMs) }))
    .sort((a, b) => (a.due ?? Number.POSITIVE_INFINITY) - (b.due ?? Number.POSITIVE_INFINITY) || a.index - b.index)
    .slice(0, CRM_FACTS_TASKS_MAX)
    .map(({ task, due }) => {
      const assignee = memberName(names, task.assigneeUid)
      const notes = crmFactText(task.notes, CRM_FACTS_TEXT_MAX)
      return {
        title: crmFactText(task.title, CRM_FACTS_LABEL_MAX),
        kind:
          crmFactText(task.typeLabel, CRM_FACTS_LABEL_MAX) ||
          (task.kind && CRM_TASK_KIND_LABELS[task.kind] ? CRM_TASK_KIND_LABELS[task.kind] : 'To-do'),
        priority: task.priority === 'high' || task.priority === 'low' ? task.priority : 'normal',
        ...(crmFactText(task.statusLabel, CRM_FACTS_LABEL_MAX)
          ? { status: crmFactText(task.statusLabel, CRM_FACTS_LABEL_MAX) }
          : {}),
        due: due === null ? null : crmFactDay(due),
        // Overdue by the UTC day: a task due today is not overdue until tomorrow.
        overdue: due !== null && Math.floor(due / DAY_MS) < Math.floor(nowMs / DAY_MS),
        ...(assignee ? { assignee } : {}),
        ...(notes ? { notes } : {}),
      }
    })
}

/** One deal, with its stage named by the pipeline it is in. */
export function crmDealFact(deal: Partial<CrmDeal>, pipeline: CrmPipeline | null | undefined): CrmDealFact {
  const stage = dealStageById(pipeline ?? undefined, String(deal.stageId ?? ''))
  return {
    title: crmFactText(deal.title, CRM_FACTS_LABEL_MAX),
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

const label = (value: unknown) => crmFactText(value, CRM_FACTS_LABEL_MAX)

export interface ContactFactsInput {
  row: Record<string, unknown>
  /** The holder whose facet the person is read through. */
  group: ConsentGroup
  activities: ReadonlyArray<Partial<CrmActivity>>
  tasks: ReadonlyArray<Partial<CrmTask>>
  deals: ReadonlyArray<Partial<CrmDeal>>
  pipelines: ReadonlyMap<string, CrmPipeline>
  nowMs: number
  names?: CrmFactsNames
  /** The name of the contact the holder's reports-to names, when the reader could see it. */
  reportsToName?: string
}

export function contactFacts(input: ContactFactsInput): CrmContactFacts {
  const { row, group, names } = input
  const facet = readContactFacet(row, group.groupId)
  const sources = Object.entries(facet.sources ?? {})
    .filter(([, on]) => on === true)
    .map(([source]) => CONTACT_SOURCE_LABELS[source as keyof typeof CONTACT_SOURCE_LABELS] ?? '')
    .filter(Boolean)
  const interactions = interactionsForGroup(facet.interactions, group.hostIds)
  const alternates = Array.isArray(row[CONTACT_ALTERNATE_EMAILS_FIELD])
    ? (row[CONTACT_ALTERNATE_EMAILS_FIELD] as unknown[])
    : []
  const emails = [...new Set([row['email'], ...alternates].map(label).filter(Boolean))].slice(0, CRM_FACTS_LIST_MAX)
  return {
    record: 'contact',
    name: label(contactDisplayName(row, group.groupId)),
    salutation: label(facet.salutation),
    firstName: label(facet.firstName),
    lastName: label(facet.lastName),
    emails,
    phone: label(facet.phone ?? row['phone']),
    mobilePhone: label(facet.mobilePhone),
    homePhone: label(facet.homePhone),
    otherPhone: label(facet.otherPhone),
    fax: label(facet.fax),
    jobTitle: label(facet.jobTitle),
    department: label(facet.department),
    birthdate: label(facet.birthdate),
    assistant: label(facet.assistantName),
    assistantPhone: label(facet.assistantPhone),
    reportsTo: label(input.reportsToName),
    mailingAddress: crmFactAddress(facet.address),
    otherAddress: crmFactAddress(facet.otherAddress),
    doNotCall: facet.doNotCall === true,
    company: label(facet.companyName),
    lifecycleStage: isContactLifecycleStage(facet.lifecycleStage)
      ? CONTACT_LIFECYCLE_STAGE_LABELS[facet.lifecycleStage]
      : '',
    leadSource: label(facet.leadSource),
    owner: memberName(names, facet.ownerUid),
    marketingConsent: crmFactConsent(row, group),
    tags: tagsOf(facet.tags),
    sources: [...new Set(sources)].sort(),
    orders: typeof facet.ordersCount === 'number' && facet.ordersCount > 0 ? Math.floor(facet.ordersCount) : 0,
    lastPurchase: crmFactDay(facet.lastPurchaseAtMs),
    since: crmFactDay(row['createdAt']),
    lastEmailEngagement: crmFactDay(facet.lastEmailEngagementAtMs),
    custom: crmCustomFacts(facet.custom, 'contact', names?.customFields),
    notes: crmFactText(facet.notes, CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts([
      ...input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmActivityFact(activity) })),
      ...interactions.map((interaction) => ({ atMs: interaction.atMs, fact: crmInteractionFact(interaction) })),
    ]),
    openTasks: crmOpenTaskFacts(input.tasks, input.nowMs, names),
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
  names?: CrmFactsNames
  /** The parent company's name, when the reader could see it. */
  parentCompanyName?: string
}

export function companyFacts(input: CompanyFactsInput): CrmCompanyFacts {
  const { company, names } = input
  return {
    record: 'company',
    name: label(company.name),
    domain: label(company.domain),
    website: label(company.website),
    phone: label(company.phone),
    fax: label(company.fax),
    industry: label(company.industry),
    type: label(company.type),
    rating: label(company.rating),
    ownership: label(company.ownership),
    accountSource: label(company.accountSource),
    employees:
      typeof company.numberOfEmployees === 'number' && company.numberOfEmployees >= 0
        ? Math.floor(company.numberOfEmployees)
        : null,
    annualRevenue: crmFactMoney(company.annualRevenueCents, company.currency),
    accountNumber: label(company.accountNumber),
    site: label(company.site),
    tickerSymbol: label(company.tickerSymbol),
    sicCode: label(company.sicCode),
    billingAddress: crmFactAddress(company.address),
    shippingAddress: crmFactAddress(company.shippingAddress),
    parentCompany: label(input.parentCompanyName),
    owner: memberName(names, company.ownerUid),
    tags: tagsOf(company.tags),
    people:
      typeof company.contactsCount === 'number' && company.contactsCount > 0
        ? Math.floor(company.contactsCount)
        : 0,
    since: crmFactDay(company.createdAt),
    custom: crmCustomFacts(company.custom, 'company', names?.customFields),
    notes: crmFactText(company.notes, CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts(
      input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmActivityFact(activity) })),
    ),
    openTasks: crmOpenTaskFacts(input.tasks, input.nowMs, names),
    deals: crmDealFacts(input.deals, input.pipelines),
  }
}

export interface DealFactsInput {
  deal: Partial<CrmDeal> & { contactName?: unknown; companyName?: unknown }
  /** The names of the deal's contacts, by id, as the reader may see them (AGL-3521). */
  contactNames?: ReadonlyMap<string, string>
  pipeline: CrmPipeline | null
  activities: ReadonlyArray<Partial<CrmActivity>>
  tasks: ReadonlyArray<Partial<CrmTask>>
  nowMs: number
  names?: CrmFactsNames
  /** The name of the campaign the deal is credited to, when the reader could see it. */
  campaignName?: string
}

export function dealFacts(input: DealFactsInput): CrmDealFacts {
  const { deal, pipeline, names } = input
  const summary = crmDealFact(deal, pipeline)
  const stages = [...(pipeline?.stages ?? [])]
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((stage) => ({
      id: String(stage.id),
      name: crmFactText(stage.name, CRM_FACTS_LABEL_MAX),
      kind: stage.kind === 'won' || stage.kind === 'lost' ? stage.kind : ('open' as const),
      probability: Math.min(100, Math.max(0, Number(stage.probability) || 0)),
      forecastCategory: CRM_FORECAST_CATEGORY_LABELS[dealStageForecastCategory(stage)],
    }))
  const stage = dealStageById(pipeline ?? undefined, String(deal.stageId ?? ''))
  const products = (Array.isArray(deal.lineItems) ? deal.lineItems : [])
    .slice(0, CRM_FACTS_PRODUCTS_MAX)
    .map((item) => ({
      name: label(item?.name),
      quantity: Number(item?.quantity) || 0,
      unitAmount: crmFactMoney(item?.unitAmountCents, item?.currency ?? deal.currency),
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
    lostReason: label(deal.lostReason),
    type: label(deal.type),
    leadSource: label(deal.leadSource),
    nextStep: crmFactText(deal.nextStep, DEAL_NEXT_STEP_MAX),
    probability: dealProbability(deal, stage),
    forecastCategory: CRM_FORECAST_CATEGORY_LABELS[dealForecastCategory(deal, stage)],
    campaign: label(input.campaignName),
    contact: label(deal.contactName),
    contactRoles: dealContactRoleFacts(deal, input.contactNames),
    company: label(deal.companyName),
    owner: memberName(names, deal.ownerUid),
    products,
    since: crmFactDay(deal.createdAt),
    custom: crmCustomFacts(deal.custom, 'deal', names?.customFields),
    notes: crmFactText(deal.notes, CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts(
      input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmActivityFact(activity) })),
    ),
    openTasks: crmOpenTaskFacts(input.tasks, input.nowMs, names),
  }
}

/**
 * A deal's contact roles as facts (AGL-3521): the Primary first, each by the
 * name the reader resolved — a contact the reader may not see, or could
 * not read, is left out rather than named by id.
 */
export function dealContactRoleFacts(
  deal: { contactId?: unknown; contactRoles?: unknown },
  names: ReadonlyMap<string, string> = new Map(),
): CrmContactRoleFact[] {
  return dealContactRolesOf(deal)
    .sort((a, b) => Number(b.primary) - Number(a.primary))
    .filter((row) => names.has(row.contactId))
    .slice(0, CRM_FACTS_CONTACT_ROLES_MAX)
    .map((row) => ({
      name: label(names.get(row.contactId)),
      role: crmFactText(row.role, CRM_FACTS_LABEL_MAX),
      primary: row.primary,
    }))
}

/** What a lead's capture surfaces are called, the lead history card's words. */
export function leadSourceFact(source: string): string {
  if (source === 'signup') return 'Sign-up'
  if (source === 'booking') return 'Booking'
  if (source === 'import') return CONTACT_SOURCE_LABELS.import
  if (source === 'form' || source.startsWith('form:')) return CONTACT_SOURCE_LABELS.form
  return 'Other'
}

export interface LeadFactsInput {
  lead: Record<string, unknown>
  activities: ReadonlyArray<Partial<CrmActivity>>
  /** The tasks filed against the lead (AGL-3520); none when the reader read none. */
  tasks?: ReadonlyArray<Partial<CrmTask>>
  nowMs?: number
  /** The org's Lead status list, whose label the status fact reads (AGL-3512); the standard ones without it. */
  leadStatuses?: CrmPicklist
  /** The site's consent group, which the lead's marketing consent is read under. */
  group?: ConsentGroup | null
  names?: CrmFactsNames
  /** The names of the campaigns the lead is filed under, as the reader resolved them. */
  campaignNames?: readonly string[]
}

export function leadFacts(input: LeadFactsInput): CrmLeadFacts {
  const { lead, leadStatuses, names } = input
  const rawSources = Array.isArray(lead['sources'])
    ? lead['sources']
    : typeof lead['source'] === 'string'
      ? [lead['source']]
      : []
  const captures = Number(lead['submissionCount'])
  return {
    record: 'lead',
    name: label(lead['name']),
    salutation: label(lead['salutation']),
    firstName: label(lead['firstName']),
    lastName: label(lead['lastName']),
    email: label(lead['email']),
    phone: label(lead['phone']),
    mobilePhone: label(lead['mobilePhone']),
    fax: label(lead['fax']),
    website: label(lead['website']),
    address: crmFactAddress(lead['address'] as Partial<AglynPostalAddress> | null),
    company: label(lead['company']),
    jobTitle: label(lead['jobTitle']),
    leadSource: label(lead['leadSource']),
    industry: label(lead['industry']),
    rating: label(lead['rating']),
    employees:
      typeof lead['numberOfEmployees'] === 'number' && lead['numberOfEmployees'] >= 0
        ? Math.floor(lead['numberOfEmployees'])
        : null,
    annualRevenue: crmFactMoney(lead['annualRevenueCents'], lead['currency']),
    doNotCall: lead['doNotCall'] === true,
    status: crmLeadStatusLabel(lead as { status?: never; statusLabel?: string }, leadStatuses),
    owner: memberName(names, lead['ownerUid']),
    campaigns: (input.campaignNames ?? []).map(label).filter(Boolean).slice(0, CRM_FACTS_LIST_MAX),
    marketingConsent: crmFactConsent(lead, input.group),
    tags: tagsOf(lead['tags']),
    sources: [...new Set(rawSources.map((source) => leadSourceFact(String(source))))].sort(),
    captures: Number.isFinite(captures) && captures > 0 ? Math.floor(captures) : 0,
    firstSeen: crmFactDay(lead['firstSeenAtMs']),
    lastSeen: crmFactDay(lead['lastSeenAtMs']),
    assigned: typeof lead['ownerUid'] === 'string' && lead['ownerUid'] !== '',
    converted: typeof lead['convertedContactId'] === 'string' && lead['convertedContactId'] !== '',
    unqualifiedReason: label(lead['unqualifiedReason']),
    custom: crmCustomFacts(lead['custom'], 'lead', names?.customFields),
    notes: crmFactText(lead['notes'], CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts(
      input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmActivityFact(activity) })),
    ),
    openTasks: crmOpenTaskFacts(input.tasks ?? [], input.nowMs ?? Date.now(), names),
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
    types: {
      email: 'email',
      phone: 'phone',
      mobilePhone: 'phone',
      homePhone: 'phone',
      otherPhone: 'phone',
      fax: 'phone',
      assistantPhone: 'phone',
      birthdate: 'date',
      doNotCall: 'yes-no',
      ownerEmail: 'email',
      marketingConsent: 'yes-no',
    },
  },
  companies: {
    keys: COMPANY_IMPORT_FIELDS,
    labels: COMPANY_IMPORT_FIELD_LABELS,
    required: 'name',
    types: {
      phone: 'phone',
      fax: 'phone',
      ownerEmail: 'email',
      website: 'url',
      numberOfEmployees: 'number',
      annualRevenue: 'number',
    },
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
    types: {
      email: 'email',
      ownerEmail: 'email',
      phone: 'phone',
      mobilePhone: 'phone',
      fax: 'phone',
      doNotCall: 'yes-no',
      website: 'url',
      numberOfEmployees: 'number',
      annualRevenue: 'number',
    },
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
