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
  CRM_FORECAST_CATEGORY_LABELS,
  CRM_TASK_KIND_LABELS,
  contactDisplayName,
  crmActivityDirection,
  crmLeadStatusLabel,
  DEAL_NEXT_STEP_MAX,
  dealContactRolesOf,
  dealForecastCategory,
  dealProbability,
  dealStageById,
  dealStageForecastCategory,
  interactionsForGroup,
  isContactLifecycleStage,
  isCrmEmailDeliveryState,
  readContactFacet,
  type ContactInteraction,
  type CrmActivity,
  type CrmDeal,
  type CrmPipeline,
  type CrmTask,
} from '@aglyn/aglyn/server'
import {
  CRM_FACTS_CONTACT_ROLES_MAX,
  CRM_FACTS_DEALS_MAX,
  CRM_FACTS_LABEL_MAX,
  CRM_FACTS_NOTES_MAX,
  CRM_FACTS_TAGS_MAX,
  CRM_FACTS_TASKS_MAX,
  CRM_FACTS_TEXT_MAX,
  crmFactDay,
  crmFactMillis,
  crmFactMoney,
  crmFactText,
  crmTimelineFacts,
  leadSourceFact,
  type CompanyFactsInput,
  type ContactFactsInput,
  type CrmCompanyFacts,
  type CrmContactFacts,
  type CrmContactRoleFact,
  type CrmDealFact,
  type CrmDealFacts,
  type CrmLeadFacts,
  type CrmTaskFact,
  type CrmTimelineFact,
  type DealFactsInput,
  type LeadFactsInput,
} from './record-facts'

/**
 * THE DISCLOSED FACTS: what CRM assistance sends while
 * `release_crm_assist_whole_record` is off.
 *
 * The published Privacy Policy (section 2) and the Anthropic row on
 * `/legal/subprocessors` promise that CRM assistance sends a record's name
 * and, by kind, its job title, company, lifecycle stage, tags, capture
 * history and counts, domain, industry, headcount, pipeline stages, status,
 * amount, dates, lost reason, parties and lead status, with its notes,
 * newest timeline entries and open tasks and deals — and never an email,
 * phone or postal field, marketing consent, custom field value, team member
 * or record id. These builders report exactly that, so production keeps the
 * promise until those pages are republished and the flag is turned on;
 * `record-facts.ts` builds the whole record for the flag's on side.
 *
 * ## What never leaves
 *
 * No email address, phone number or postal address of anyone; no birthdate;
 * no assistant and no reports-to; no marketing consent; no custom field
 * VALUE; no team member's name or id; no document id of any record; no
 * file; no order or payment detail beyond a count. A logged email carries its
 * subject and a cut of its body, never the address it went to or came from.
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
 * The bytes are as stable as the whole record's: one key order, UTC days,
 * money as a code and a fixed-point amount.
 */

export type CrmDisclosedContactFacts = Pick<
  CrmContactFacts,
  | 'record'
  | 'name'
  | 'salutation'
  | 'jobTitle'
  | 'department'
  | 'doNotCall'
  | 'company'
  | 'lifecycleStage'
  | 'tags'
  | 'sources'
  | 'orders'
  | 'lastPurchase'
  | 'since'
  | 'lastEmailEngagement'
  | 'notes'
  | 'timeline'
  | 'openTasks'
  | 'deals'
>

export type CrmDisclosedCompanyFacts = Pick<
  CrmCompanyFacts,
  | 'record'
  | 'name'
  | 'domain'
  | 'industry'
  | 'type'
  | 'rating'
  | 'ownership'
  | 'accountSource'
  | 'employees'
  | 'annualRevenue'
  | 'tags'
  | 'people'
  | 'since'
  | 'notes'
  | 'timeline'
  | 'openTasks'
  | 'deals'
>

export type CrmDisclosedDealFacts = Pick<
  CrmDealFacts,
  | 'record'
  | 'title'
  | 'pipeline'
  | 'stages'
  | 'stageId'
  | 'stage'
  | 'status'
  | 'amount'
  | 'expectedClose'
  | 'inStageSince'
  | 'lostReason'
  | 'type'
  | 'leadSource'
  | 'nextStep'
  | 'probability'
  | 'forecastCategory'
  | 'contact'
  | 'contactRoles'
  | 'company'
  | 'since'
  | 'notes'
  | 'timeline'
  | 'openTasks'
> & {
  /** How many products the deal holds — a count, never their names or prices. */
  products: number
}

export type CrmDisclosedLeadFacts = Pick<
  CrmLeadFacts,
  | 'record'
  | 'name'
  | 'salutation'
  | 'company'
  | 'jobTitle'
  | 'leadSource'
  | 'industry'
  | 'rating'
  | 'employees'
  | 'annualRevenue'
  | 'doNotCall'
  | 'status'
  | 'sources'
  | 'captures'
  | 'firstSeen'
  | 'lastSeen'
  | 'assigned'
  | 'converted'
  | 'unqualifiedReason'
  | 'notes'
  | 'timeline'
>

/** An email address written inside free text. */
const EMAIL_IN_PROSE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
/** A run of digits and the separators a phone number is written with. */
const DIGIT_RUN_IN_PROSE = /\+?\(?\d[\d\s().-]{7,}\d/g
/** Calendar days, which a run of digits may be and a phone number is not. */
const DAYS_ONLY = /^\d{4}-\d{2}-\d{2}(?:\s+\d{4}-\d{2}-\d{2})*$/

export const CRM_FACTS_EMAIL_PLACEHOLDER = '[email address]'
export const CRM_FACTS_PHONE_PLACEHOLDER = '[phone number]'

const DAY_MS = 86_400_000

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

/** A logged activity as a timeline entry: never the address it went to or came from. */
export function crmDisclosedActivityFact(activity: Partial<CrmActivity>): CrmTimelineFact | null {
  const on = crmFactDay(activity.atMs)
  if (!on) return null
  const kind = activity.kind && CRM_ACTIVITY_KIND_LABELS[activity.kind] ? activity.kind : 'other'
  const fact: CrmTimelineFact = { on, kind: CRM_ACTIVITY_KIND_LABELS[kind] }
  const direction = crmActivityDirection(kind, activity.direction)
  if (direction) fact.direction = direction
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
export function crmDisclosedInteractionFact(interaction: Partial<ContactInteraction>): CrmTimelineFact | null {
  const on = crmFactDay(interaction.atMs)
  if (!on) return null
  const kind =
    interaction.type && CONTACT_SOURCE_LABELS[interaction.type] ? CONTACT_SOURCE_LABELS[interaction.type] : 'Capture'
  const text = crmFactProse(interaction.summary, CRM_FACTS_TEXT_MAX)
  return text ? { on, kind, text } : { on, kind }
}

/** The open tasks among `tasks`, soonest due first, undated last: never who holds one, nor its notes. */
export function crmDisclosedOpenTaskFacts(tasks: ReadonlyArray<Partial<CrmTask>>, nowMs: number): CrmTaskFact[] {
  return tasks
    .filter((task) => task.status !== 'done' && crmFactText(task.title, CRM_FACTS_LABEL_MAX))
    .map((task, index) => ({ task, index, due: crmFactMillis(task.dueAtMs) }))
    .sort((a, b) => (a.due ?? Number.POSITIVE_INFINITY) - (b.due ?? Number.POSITIVE_INFINITY) || a.index - b.index)
    .slice(0, CRM_FACTS_TASKS_MAX)
    .map(({ task, due }) => ({
      title: crmFactProse(task.title, CRM_FACTS_LABEL_MAX),
      kind:
        crmFactProse(task.typeLabel, CRM_FACTS_LABEL_MAX) ||
        (task.kind && CRM_TASK_KIND_LABELS[task.kind] ? CRM_TASK_KIND_LABELS[task.kind] : 'To-do'),
      priority: task.priority === 'high' || task.priority === 'low' ? task.priority : 'normal',
      ...(crmFactProse(task.statusLabel, CRM_FACTS_LABEL_MAX)
        ? { status: crmFactProse(task.statusLabel, CRM_FACTS_LABEL_MAX) }
        : {}),
      due: due === null ? null : crmFactDay(due),
      // Overdue by the UTC day: a task due today is not overdue until tomorrow.
      overdue: due !== null && Math.floor(due / DAY_MS) < Math.floor(nowMs / DAY_MS),
    }))
}

/** One deal, with its stage named by the pipeline it is in. */
function disclosedDealSummary(deal: Partial<CrmDeal>, pipeline: CrmPipeline | null | undefined): CrmDealFact {
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
function disclosedDealSummaries(
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
    .map(({ deal }) => disclosedDealSummary(deal, pipelines.get(String(deal.pipelineId ?? ''))))
}

export function disclosedContactFacts(input: ContactFactsInput): CrmDisclosedContactFacts {
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
    salutation: crmFactProse(facet.salutation, CRM_FACTS_LABEL_MAX),
    jobTitle: crmFactProse(facet.jobTitle, CRM_FACTS_LABEL_MAX),
    department: crmFactProse(facet.department, CRM_FACTS_LABEL_MAX),
    doNotCall: facet.doNotCall === true,
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
      ...input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmDisclosedActivityFact(activity) })),
      ...interactions.map((interaction) => ({ atMs: interaction.atMs, fact: crmDisclosedInteractionFact(interaction) })),
    ]),
    openTasks: crmDisclosedOpenTaskFacts(input.tasks, input.nowMs),
    deals: disclosedDealSummaries(input.deals, input.pipelines),
  }
}

export function disclosedCompanyFacts(input: CompanyFactsInput): CrmDisclosedCompanyFacts {
  const { company } = input
  return {
    record: 'company',
    name: crmFactProse(company.name, CRM_FACTS_LABEL_MAX),
    domain: crmFactText(company.domain, CRM_FACTS_LABEL_MAX),
    industry: crmFactProse(company.industry, CRM_FACTS_LABEL_MAX),
    type: crmFactProse(company.type, CRM_FACTS_LABEL_MAX),
    rating: crmFactProse(company.rating, CRM_FACTS_LABEL_MAX),
    ownership: crmFactProse(company.ownership, CRM_FACTS_LABEL_MAX),
    accountSource: crmFactProse(company.accountSource, CRM_FACTS_LABEL_MAX),
    employees:
      typeof company.numberOfEmployees === 'number' && company.numberOfEmployees >= 0
        ? Math.floor(company.numberOfEmployees)
        : null,
    annualRevenue: crmFactMoney(company.annualRevenueCents, company.currency),
    tags: tagsOf(company.tags),
    people:
      typeof company.contactsCount === 'number' && company.contactsCount > 0
        ? Math.floor(company.contactsCount)
        : 0,
    since: crmFactDay(company.createdAt),
    notes: crmFactProse(company.notes, CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts(
      input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmDisclosedActivityFact(activity) })),
    ),
    openTasks: crmDisclosedOpenTaskFacts(input.tasks, input.nowMs),
    deals: disclosedDealSummaries(input.deals, input.pipelines),
  }
}

/**
 * Every contact on a deal and the part each plays (AGL-3521), the Primary
 * first and at most {@link CRM_FACTS_CONTACT_ROLES_MAX}: each named as the
 * reader resolved them, with an address or a number in a name replaced. A
 * contact the reader could not see is left out rather than named by id.
 */
function disclosedContactRoleFacts(
  deal: { contactId?: unknown; contactRoles?: unknown },
  names: ReadonlyMap<string, string> = new Map(),
): CrmContactRoleFact[] {
  return dealContactRolesOf(deal)
    .sort((a, b) => Number(b.primary) - Number(a.primary))
    .filter((row) => names.has(row.contactId))
    .slice(0, CRM_FACTS_CONTACT_ROLES_MAX)
    .map((row) => ({
      name: crmFactProse(names.get(row.contactId), CRM_FACTS_LABEL_MAX),
      role: crmFactText(row.role, CRM_FACTS_LABEL_MAX),
      primary: row.primary,
    }))
}

export function disclosedDealFacts(input: DealFactsInput): CrmDisclosedDealFacts {
  const { deal, pipeline } = input
  const summary = disclosedDealSummary(deal, pipeline)
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
    type: crmFactText(deal.type, CRM_FACTS_LABEL_MAX),
    leadSource: crmFactText(deal.leadSource, CRM_FACTS_LABEL_MAX),
    nextStep: crmFactProse(deal.nextStep, DEAL_NEXT_STEP_MAX),
    probability: dealProbability(deal, stage),
    forecastCategory: CRM_FORECAST_CATEGORY_LABELS[dealForecastCategory(deal, stage)],
    contact: crmFactProse(deal.contactName, CRM_FACTS_LABEL_MAX),
    contactRoles: disclosedContactRoleFacts(deal, input.contactNames),
    company: crmFactProse(deal.companyName, CRM_FACTS_LABEL_MAX),
    products: Array.isArray(deal.lineItems) ? deal.lineItems.length : 0,
    since: crmFactDay(deal.createdAt),
    notes: crmFactProse(deal.notes, CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts(
      input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmDisclosedActivityFact(activity) })),
    ),
    openTasks: crmDisclosedOpenTaskFacts(input.tasks, input.nowMs),
  }
}

export function disclosedLeadFacts(input: LeadFactsInput): CrmDisclosedLeadFacts {
  const { lead, leadStatuses } = input
  const rawSources = Array.isArray(lead['sources'])
    ? lead['sources']
    : typeof lead['source'] === 'string'
      ? [lead['source']]
      : []
  const captures = Number(lead['submissionCount'])
  return {
    record: 'lead',
    name: crmFactProse(lead['name'], CRM_FACTS_LABEL_MAX),
    salutation: crmFactProse(lead['salutation'], CRM_FACTS_LABEL_MAX),
    company: crmFactProse(lead['company'], CRM_FACTS_LABEL_MAX),
    jobTitle: crmFactProse(lead['jobTitle'], CRM_FACTS_LABEL_MAX),
    leadSource: crmFactText(lead['leadSource'], CRM_FACTS_LABEL_MAX),
    industry: crmFactText(lead['industry'], CRM_FACTS_LABEL_MAX),
    rating: crmFactText(lead['rating'], CRM_FACTS_LABEL_MAX),
    employees:
      typeof lead['numberOfEmployees'] === 'number' && lead['numberOfEmployees'] >= 0
        ? Math.floor(lead['numberOfEmployees'])
        : null,
    annualRevenue: crmFactMoney(lead['annualRevenueCents'], lead['currency']),
    doNotCall: lead['doNotCall'] === true,
    status: crmLeadStatusLabel(lead as { status?: never; statusLabel?: string }, leadStatuses),
    sources: [...new Set(rawSources.map((source) => leadSourceFact(String(source))))].sort(),
    captures: Number.isFinite(captures) && captures > 0 ? Math.floor(captures) : 0,
    firstSeen: crmFactDay(lead['firstSeenAtMs']),
    lastSeen: crmFactDay(lead['lastSeenAtMs']),
    assigned: typeof lead['ownerUid'] === 'string' && lead['ownerUid'] !== '',
    converted: typeof lead['convertedContactId'] === 'string' && lead['convertedContactId'] !== '',
    unqualifiedReason: crmFactProse(lead['unqualifiedReason'], CRM_FACTS_LABEL_MAX),
    notes: crmFactProse(lead['notes'], CRM_FACTS_NOTES_MAX),
    timeline: crmTimelineFacts(
      input.activities.map((activity) => ({ atMs: activity.atMs, fact: crmDisclosedActivityFact(activity) })),
    ),
  }
}
