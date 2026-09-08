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

/**
 * EVERY CRM CSV, WRITTEN ONCE (AGL-2662).
 *
 * ## Why these moved out of the plugin
 *
 * Each CRM section already wrote a file from the rows it had LOADED, and
 * the whole-collection export writes the same file from the server over
 * every row there is. The console app may not import a feature plugin —
 * plugins reach an app only through the generated loader manifests — so a
 * server route could not have called the plugin's writers, and writing a
 * second set would have given one feature two file formats, discovered by
 * whichever merchant opened both in a spreadsheet.
 *
 * So the columns and the cells live here, in the library both sides may
 * import. The plugin's `contacts-csv.ts`, `companies-csv.ts`,
 * `deals-csv.ts`, `tasks-csv.ts` and `leads-csv.ts` keep their names and
 * delegate: the sections import what they always did, and there is one
 * implementation under all of it. Their specs are unchanged and are the
 * proof that the move changed no byte of any file.
 *
 * ## What a resolver is for, and what an absent one means
 *
 * A stored document holds ids — an owner uid, a pipeline id, a linked
 * record id — and a spreadsheet cannot read an id. Each writer therefore
 * takes optional resolvers, and every one of them degrades the same way:
 * ABSENT resolver writes the id itself rather than an empty cell, because
 * a row whose owner is a uid is still a row whose owner can be found, and
 * a blank is a claim that nobody owns it.
 *
 * The owner columns carry an ADDRESS where they can, which is also what
 * the contacts and companies imports resolve an owner by — so an exported
 * file re-imports without a hand mapping.
 */

import type { AglynPostalAddress } from '../foundation'
import {
  CONTACT_SOURCE_LABELS,
  contactDisplayName,
  interactionsForGroup,
  readContactFacet,
} from './contacts'
import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CRM_LEAD_STATUS_LABELS,
  CRM_TASK_KIND_LABELS,
  type ContactCustomValue,
  type ContactFieldDefinition,
  type ContactLifecycleStage,
  type CrmCompany,
  type CrmLeadFields,
  type CrmTask,
  crmLeadStatus,
  isContactLifecycleStage,
} from './crm'
import { csvDocument } from './csv-import'

/*==========================================
 * CELLS EVERY FILE SHARES
 *=========================================*/

/** Cents as a major-unit decimal — `125000` → `1250.00`; `''` for none. */
export function csvAmount(cents: number | null | undefined): string {
  return typeof cents === 'number' && Number.isFinite(cents)
    ? (cents / 100).toFixed(2)
    : ''
}

/** An epoch as an ISO timestamp, or `''` for none. */
export function csvInstant(ms: number | null | undefined): string {
  return typeof ms === 'number' && Number.isFinite(ms)
    ? new Date(ms).toISOString()
    : ''
}

/**
 * An epoch as a local calendar DATE — `YYYY-MM-DD`.
 *
 * For the fields that are a day rather than a moment: an expected close is
 * stored at local noon precisely so the day survives a timezone round trip,
 * and writing it as an instant would hand a spreadsheet a time nobody
 * chose. The same arithmetic the deal drawer's date field uses, so the
 * file and the field read one day.
 */
export function csvLocalDate(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const offset = new Date(ms).getTimezoneOffset() * 60_000
  return new Date(ms - offset).toISOString().slice(0, 10)
}

/** Epoch millis or a Firestore timestamp as an ISO instant, or `''`. */
export function csvStoredInstant(value: unknown): string {
  if (typeof value === 'number') return csvInstant(value)
  const asDate = (value as { toDate?: () => Date } | null | undefined)?.toDate?.()
  return asDate ? asDate.toISOString() : ''
}

/** The one degradation rule: a resolved name, else the id, else empty. */
function named(id: string | undefined, resolve?: (id: string) => string | undefined) {
  return id ? (resolve?.(id) || id) : ''
}

/*==========================================
 * CONTACTS
 *=========================================*/

/** As much of a projected contact row as the file reads. */
export interface ContactCsvRow {
  email?: string
  name?: string
  phone?: string
  jobTitle?: string
  companyName?: string
  ownerUid?: string
  lifecycleStage?: ContactLifecycleStage | ''
  address?: AglynPostalAddress | null
  tags?: string[]
  sources?: Record<string, unknown>
  interactions?: Array<{ atMs: number }>
  /** The last open or click on one of the site's campaigns (AGL-2616). */
  lastEmailEngagementAtMs?: number
  notes?: string
  /** This holder's custom values, keyed by definition key. */
  custom?: Record<string, ContactCustomValue>
}

export interface ContactCsvOptions {
  /**
   * The owner's address for a stored uid — what the import resolves an
   * owner by. Absent, the uid is written as it is.
   */
  ownerEmail?: (uid: string) => string
  /** The org's custom fields, one column each, headed by the field's label. */
  customFields?: readonly Pick<ContactFieldDefinition, 'key' | 'label'>[]
}

/**
 * The standard columns, in order, headed as the import reads them. A
 * custom field's column follows these, headed by its label.
 */
export const CONTACT_CSV_COLUMNS = [
  'Email',
  'Name',
  'Phone',
  'Job title',
  'Company',
  'Owner',
  'Lifecycle stage',
  'Address line 1',
  'Address line 2',
  'City',
  'State',
  'Postal code',
  'Country',
  'Tags',
  'Sources',
  'Last interaction',
  'Last engaged',
  'Notes',
] as const

/** The header row, with one column per custom field after the standard ones. */
export function contactCsvHeader(
  customFields: ContactCsvOptions['customFields'] = [],
): string[] {
  return [...CONTACT_CSV_COLUMNS, ...customFields.map((field) => field.label)]
}

/** A custom value as a cell: a boolean as yes/no, everything else as text. */
const customCell = (value: ContactCustomValue | undefined): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/** One contact's cells, in the header's order. */
export function contactCsvCells(
  contact: ContactCsvRow,
  options: ContactCsvOptions = {},
): unknown[] {
  const { ownerEmail, customFields = [] } = options
  return [
    contact.email ?? '',
    contact.name ?? '',
    contact.phone ?? '',
    contact.jobTitle ?? '',
    contact.companyName ?? '',
    contact.ownerUid ? (ownerEmail?.(contact.ownerUid) ?? contact.ownerUid) : '',
    contact.lifecycleStage
      ? CONTACT_LIFECYCLE_STAGE_LABELS[contact.lifecycleStage]
      : '',
    contact.address?.line1 ?? '',
    contact.address?.line2 ?? '',
    contact.address?.city ?? '',
    contact.address?.state ?? '',
    contact.address?.postalCode ?? '',
    contact.address?.country ?? '',
    (contact.tags ?? []).join('|'),
    Object.keys(contact.sources ?? {}).join('|'),
    contact.interactions?.[0]
      ? new Date(contact.interactions[0].atMs).toISOString()
      : '',
    contact.lastEmailEngagementAtMs
      ? new Date(contact.lastEmailEngagementAtMs).toISOString()
      : '',
    contact.notes ?? '',
    ...customFields.map((field) => customCell(contact.custom?.[field.key])),
  ]
}

/** The whole file, header first. */
export function contactsCsv(
  rows: readonly ContactCsvRow[],
  options: ContactCsvOptions = {},
): string {
  return csvDocument(
    contactCsvHeader(options.customFields),
    rows.map((contact) => contactCsvCells(contact, options)),
  )
}

/*==========================================
 * COMPANIES
 *=========================================*/

/** As much of a company row as the file reads. */
export type CompanyCsvRow = Partial<
  Pick<
    CrmCompany,
    | 'name'
    | 'domain'
    | 'website'
    | 'phone'
    | 'industry'
    | 'ownerUid'
    | 'tags'
    | 'notes'
    | 'contactsCount'
  >
> & { address?: AglynPostalAddress | null }

export interface CompanyCsvOptions {
  /** The owner's address for a stored uid; absent, the uid is written. */
  ownerEmail?: (uid: string) => string
}

/** The columns, in order, headed as the import reads them. */
export const COMPANY_CSV_COLUMNS = [
  'Company',
  'Domain',
  'Website',
  'Phone',
  'Industry',
  'Owner',
  'Address line 1',
  'Address line 2',
  'City',
  'State',
  'Postal code',
  'Country',
  'Tags',
  'Notes',
  'Contacts',
] as const

/** One company's cells, in the header's order. */
export function companyCsvCells(
  company: CompanyCsvRow,
  options: CompanyCsvOptions = {},
): unknown[] {
  const { ownerEmail } = options
  return [
    company.name ?? '',
    company.domain ?? '',
    company.website ?? '',
    company.phone ?? '',
    company.industry ?? '',
    company.ownerUid ? (ownerEmail?.(company.ownerUid) ?? company.ownerUid) : '',
    company.address?.line1 ?? '',
    company.address?.line2 ?? '',
    company.address?.city ?? '',
    company.address?.state ?? '',
    company.address?.postalCode ?? '',
    company.address?.country ?? '',
    (company.tags ?? []).join('|'),
    company.notes ?? '',
    Number(company.contactsCount ?? 0),
  ]
}

/** The whole file, header first. */
export function companiesCsv(
  rows: readonly CompanyCsvRow[],
  options: CompanyCsvOptions = {},
): string {
  return csvDocument(
    COMPANY_CSV_COLUMNS,
    rows.map((company) => companyCsvCells(company, options)),
  )
}

/*==========================================
 * DEALS
 *=========================================*/

/** The currency a deal with no code of its own is read in. */
export const CSV_DEFAULT_DEAL_CURRENCY = 'usd'

/** How a deal's `status` reads in a file. */
export const CSV_DEAL_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
}

/** As much of a deal row as the file reads. */
export interface DealCsvRow {
  title?: string
  pipelineId?: string
  stageId?: string
  status?: string
  amountCents?: number
  currency?: string
  ownerUid?: string
  expectedCloseAtMs?: number | null
  closedAtMs?: number | null
  contactName?: string
  companyName?: string
  lostReason?: string
  notes?: string
}

export interface DealCsvOptions {
  /** The pipeline's name for a stored id; absent, the id is written. */
  pipelineName?: (pipelineId: string) => string | undefined
  /** The stage's name within its pipeline; absent, the stage id is written. */
  stageName?: (pipelineId: string, stageId: string) => string | undefined
  /** The owner's address for a stored uid; absent, the uid is written. */
  ownerEmail?: (uid: string) => string
}

export const DEAL_CSV_COLUMNS = [
  'Title',
  'Pipeline',
  'Stage',
  'Amount',
  'Currency',
  'Owner',
  'Expected close',
  'Status',
  'Contact',
  'Company',
  'Closed',
  'Lost reason',
  'Notes',
] as const

/** One deal's cells, in the header's order. */
export function dealCsvCells(
  deal: DealCsvRow,
  options: DealCsvOptions = {},
): unknown[] {
  const { pipelineName, stageName, ownerEmail } = options
  const pipelineId = deal.pipelineId ?? ''
  const stageId = deal.stageId ?? ''
  return [
    deal.title ?? '',
    pipelineName?.(pipelineId) ?? pipelineId,
    stageName?.(pipelineId, stageId) ?? stageId,
    csvAmount(deal.amountCents),
    typeof deal.amountCents === 'number'
      ? String(deal.currency || CSV_DEFAULT_DEAL_CURRENCY).toUpperCase()
      : '',
    deal.ownerUid ? (ownerEmail?.(deal.ownerUid) ?? deal.ownerUid) : '',
    // A close DATE, in the reader's own zone — stored at local noon, so
    // the calendar day is what comes back out.
    csvLocalDate(deal.expectedCloseAtMs),
    deal.status ? (CSV_DEAL_STATUS_LABELS[deal.status] ?? deal.status) : '',
    deal.contactName ?? '',
    deal.companyName ?? '',
    csvInstant(deal.closedAtMs),
    deal.lostReason ?? '',
    deal.notes ?? '',
  ]
}

/** The whole file, header first. */
export function dealsCsv(
  rows: readonly DealCsvRow[],
  options: DealCsvOptions = {},
): string {
  return csvDocument(
    DEAL_CSV_COLUMNS,
    rows.map((deal) => dealCsvCells(deal, options)),
  )
}

/*==========================================
 * TASKS
 *=========================================*/

/** As much of a task row as the file reads. */
export type TaskCsvRow = Partial<
  Pick<
    CrmTask,
    | 'title'
    | 'kind'
    | 'priority'
    | 'status'
    | 'dueAtMs'
    | 'completedAtMs'
    | 'assigneeUid'
    | 'contactId'
    | 'companyId'
    | 'dealId'
    | 'notes'
  >
>

export interface TaskCsvOptions {
  /** The assignee's address for a stored uid; absent, the uid is written. */
  assigneeEmail?: (uid: string) => string
  /** What a linked record is called; absent, the id is written. */
  recordName?: (kind: 'contact' | 'company' | 'deal', id: string) => string | undefined
}

export const TASK_CSV_COLUMNS = [
  'Title',
  'Kind',
  'Priority',
  'Status',
  'Due',
  'Assignee',
  'Contact',
  'Company',
  'Deal',
  'Completed',
  'Notes',
] as const

const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
}

const TASK_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  done: 'Done',
}

/** One task's cells, in the header's order. */
export function taskCsvCells(
  task: TaskCsvRow,
  options: TaskCsvOptions = {},
): unknown[] {
  const { assigneeEmail, recordName } = options
  const link = (kind: 'contact' | 'company' | 'deal', id: string | undefined) =>
    named(id, (value) => recordName?.(kind, value))
  return [
    task.title ?? '',
    task.kind ? (CRM_TASK_KIND_LABELS[task.kind] ?? task.kind) : '',
    task.priority ? (TASK_PRIORITY_LABELS[task.priority] ?? task.priority) : '',
    task.status ? (TASK_STATUS_LABELS[task.status] ?? task.status) : '',
    csvInstant(task.dueAtMs),
    task.assigneeUid ? (assigneeEmail?.(task.assigneeUid) ?? task.assigneeUid) : '',
    link('contact', task.contactId),
    link('company', task.companyId),
    link('deal', task.dealId),
    csvInstant(task.completedAtMs),
    task.notes ?? '',
  ]
}

/** The whole file, header first. */
export function tasksCsv(
  rows: readonly TaskCsvRow[],
  options: TaskCsvOptions = {},
): string {
  return csvDocument(
    TASK_CSV_COLUMNS,
    rows.map((task) => taskCsvCells(task, options)),
  )
}

/*==========================================
 * LEADS
 *=========================================*/

/** How one capture surface reads in a file. */
export function csvLeadSourceLabel(source: string): string {
  if (source === 'signup') return 'Sign-up'
  if (source === 'booking') return 'Booking'
  if (source === 'import') return CONTACT_SOURCE_LABELS.import
  if (source === 'form') return CONTACT_SOURCE_LABELS.form
  if (source.startsWith('form:')) return `Form ${source.slice('form:'.length)}`
  return source
}

/** Every surface that produced a capture — the array, or the older single field. */
export function csvLeadSources(lead: Record<string, unknown>): string[] {
  const sources = lead['sources']
  if (Array.isArray(sources) && sources.length) {
    return sources.map((source) => String(source))
  }
  return typeof lead['source'] === 'string' && lead['source'] ? [lead['source']] : []
}

/** As much of a lead row as the file reads. */
export type LeadCsvRow = Record<string, unknown> &
  Pick<
    CrmLeadFields,
    'status' | 'ownerUid' | 'notes' | 'unqualifiedReason' | 'convertedAtMs'
  > & {
    /** The site the lead lives under — what the `Site` column names. */
    hostId?: string
  }

export interface LeadCsvOptions {
  /** The owner's address for a stored uid; absent, the uid is written. */
  ownerEmail?: (uid: string) => string
  /**
   * The site's name for a row's `hostId`. Given, the file carries a `Site`
   * column — the organization-level file; absent, it does not.
   */
  siteName?: (hostId: string) => string | undefined
}

/** The columns every leads file carries, in the list's order. */
export const LEAD_CSV_COLUMNS = [
  'Email',
  'Name',
  'Status',
  'Owner',
  'Sources',
  'First seen',
  'Last seen',
  'Captures',
  'Unqualified reason',
  'Converted',
  'Notes',
] as const

/** The header row: the standard columns, with `Site` after `Owner` at the org level. */
export function leadCsvHeader(options: LeadCsvOptions = {}): string[] {
  const columns: string[] = [...LEAD_CSV_COLUMNS]
  if (options.siteName) columns.splice(columns.indexOf('Owner') + 1, 0, 'Site')
  return columns
}

/** One lead's cells, in the header's order. */
export function leadCsvCells(
  lead: LeadCsvRow,
  options: LeadCsvOptions = {},
): unknown[] {
  const { ownerEmail, siteName } = options
  const hostId = String(lead.hostId ?? '')
  const captures = Number(lead['submissionCount'] ?? 0)
  return [
    String(lead['email'] ?? ''),
    String(lead['name'] ?? ''),
    CRM_LEAD_STATUS_LABELS[crmLeadStatus(lead)],
    lead.ownerUid ? (ownerEmail?.(lead.ownerUid) ?? lead.ownerUid) : '',
    ...(siteName ? [siteName(hostId) ?? hostId] : []),
    csvLeadSources(lead).map(csvLeadSourceLabel).join('|'),
    csvStoredInstant(lead['firstSeenAtMs'] ?? lead['createdAt']),
    csvStoredInstant(lead['lastSeenAtMs'] ?? lead['createdAt']),
    Number.isFinite(captures) && captures > 0 ? String(captures) : '',
    lead.unqualifiedReason ?? '',
    csvInstant(lead.convertedAtMs),
    lead.notes ?? '',
  ]
}

/** The whole file, header first. */
export function leadsCsv(
  rows: readonly LeadCsvRow[],
  options: LeadCsvOptions = {},
): string {
  return csvDocument(
    leadCsvHeader(options),
    rows.map((lead) => leadCsvCells(lead, options)),
  )
}

/*==========================================
 * WHAT THE WHOLE-COLLECTION EXPORT WRITES
 *=========================================*/

/** The five tables a whole-collection export can be asked for. */
export const CRM_EXPORT_RESOURCES = [
  'contacts',
  'companies',
  'deals',
  'tasks',
  'leads',
] as const

export type CrmExportResource = (typeof CRM_EXPORT_RESOURCES)[number]

export function isCrmExportResource(value: unknown): value is CrmExportResource {
  return (
    typeof value === 'string' &&
    (CRM_EXPORT_RESOURCES as readonly string[]).includes(value)
  )
}

/** Every resolver any of the five writers takes, in one bag. */
export type CrmExportOptions = ContactCsvOptions &
  DealCsvOptions &
  TaskCsvOptions &
  LeadCsvOptions & { assigneeEmail?: (uid: string) => string }

/** The header row one resource's file carries. */
export function crmExportHeader(
  resource: CrmExportResource,
  options: CrmExportOptions = {},
): string[] {
  switch (resource) {
    case 'contacts':
      return contactCsvHeader(options.customFields)
    case 'companies':
      return [...COMPANY_CSV_COLUMNS]
    case 'deals':
      return [...DEAL_CSV_COLUMNS]
    case 'tasks':
      return [...TASK_CSV_COLUMNS]
    default:
      return leadCsvHeader(options)
  }
}

/**
 * One stored document's cells for one resource's file.
 *
 * The bridge the server route stands on: it holds a raw document rather
 * than the projected row a list built, and this is the one place that
 * turns the first into the second — so the streamed file and the file the
 * Export button writes are the same columns filled the same way.
 */
export function crmExportCells(
  resource: CrmExportResource,
  document: Record<string, unknown>,
  options: CrmExportOptions = {},
): unknown[] {
  switch (resource) {
    case 'contacts':
      return contactCsvCells(document as ContactCsvRow, options)
    case 'companies':
      return companyCsvCells(document as CompanyCsvRow, options)
    case 'deals':
      return dealCsvCells(document as DealCsvRow, options)
    case 'tasks':
      return taskCsvCells(document as TaskCsvRow, options)
    default:
      return leadCsvCells(document as LeadCsvRow, options)
  }
}

/** What the contacts file needs to know about the holder it is written for. */
export interface CrmExportContactHolder {
  /** The consent group whose facet the file reads — a facet is per holder. */
  groupId: string
  /** The sites in that group, which bound the timeline the file reads. */
  hostIds: readonly string[]
}

/**
 * A stored contact document as the contacts file reads it.
 *
 * The projection the Contacts list makes before it writes its own file,
 * spelled here so the server can make the same one: a contact document
 * holds one facet per HOLDER, and every field the file writes but the
 * address itself — the phone, the company, the tags, the notes, the
 * lifecycle stage, the custom values — lives in the viewing holder's facet.
 * Reading them off the top of the document is how one business's file ends
 * up carrying another's notes.
 */
export function contactCsvRowFromDoc(
  document: Record<string, unknown>,
  holder: CrmExportContactHolder,
): ContactCsvRow {
  const facet = readContactFacet(document, holder.groupId)
  return {
    email: typeof document['email'] === 'string' ? document['email'] : '',
    name: contactDisplayName(document, holder.groupId),
    phone: facet.phone ?? '',
    jobTitle: facet.jobTitle ?? '',
    companyName: facet.companyName ?? '',
    ownerUid: facet.ownerUid ?? '',
    lifecycleStage: isContactLifecycleStage(facet.lifecycleStage)
      ? facet.lifecycleStage
      : '',
    address: facet.address ?? null,
    tags: facet.tags ?? [],
    sources: facet.sources,
    interactions: interactionsForGroup(facet.interactions, holder.hostIds),
    ...(typeof facet.lastEmailEngagementAtMs === 'number' &&
    Number.isFinite(facet.lastEmailEngagementAtMs) &&
    facet.lastEmailEngagementAtMs > 0
      ? { lastEmailEngagementAtMs: facet.lastEmailEngagementAtMs }
      : {}),
    notes: facet.notes ?? '',
    custom: facet.custom ?? {},
  }
}
