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
 * Contacts CRM v2 (AGL-2595): the records that sit BESIDE a contact.
 *
 * v1 is one collection — `contacts` — and everything a holder knows about a
 * person lives in that holder's facet on the shared row. That shape is right
 * for the person and wrong for everything a sales team keeps AROUND the
 * person: a company is known by several contacts, a deal moves through
 * stages on its own clock, a task is due whether or not anybody opens the
 * contact it hangs off, and an activity log grows past anything a facet
 * should carry. So each of those is a collection of its own under
 * `orgs/{orgId}/`, pointing back at the contact by id.
 *
 * ## One scope model, not a second one
 *
 * Every collection here carries `visibleTo`, the same array `contacts`
 * carries, and is stamped the same way — {@link crmScopeTokens} is the
 * contact create path's expression, exported so that no creator computes its
 * own. The rules gate all six on the contacts predicate (`canReadScopedPeople`,
 * `data.manage`), because a deal or a call log is a fact about a person and
 * discloses exactly what the contact row would.
 *
 * What these collections do NOT have is the facet map. A contact is shared
 * across holders because one human is one row; a company, deal or task is
 * one holder's record from the moment it is created, so `visibleTo` alone
 * says who may see it and there is nothing to split per holder.
 *
 * Pure data module: types, constants and the small helpers every surface
 * would otherwise write for itself. No Firestore, no React.
 */

import type { AglynPostalAddress, OrgCrmAssignmentRule } from '../foundation'
import { type ConsentGroup, consentGroupScope } from './consent-groups'
import {
  CONTACT_FACETS_FIELD,
  CONTACT_SOURCE_LABELS,
  type ContactInteraction,
  type ContactSegment,
  type ContactSource,
  normalizeContactEmail,
  readContactFacet,
} from './contacts'
import { MAX_SCOPE_HOSTS, ORG_SCOPE_TOKEN, type ScopeToken } from './scope-tokens'

/**
 * The CRM's collections, every one under `orgs/{orgId}/`.
 *
 * Named here rather than spelled at each call site because the rules, the
 * indexes and the console must agree on the string, and the three prefixed
 * ones are prefixed on purpose: `tasks`, `activities` and `views` are words
 * the org document will want for something else one day, and a collection
 * name is persisted in every document path that uses it.
 */
export const CRM_COLLECTIONS = {
  companies: 'companies',
  pipelines: 'pipelines',
  deals: 'deals',
  tasks: 'crmTasks',
  activities: 'crmActivities',
  contactFields: 'contactFields',
  views: 'crmViews',
} as const

export type CrmCollection = (typeof CRM_COLLECTIONS)[keyof typeof CRM_COLLECTIONS]

/**
 * The three collections the CRM RECORDS band counts (AGL-2611), in the order
 * the billing caption lists them. `contacts` is not in `CRM_COLLECTIONS`
 * because it predates the hub and is addressed through `orgDataCollection`,
 * so the band's own list has to name all three itself. Tasks, pipelines,
 * activities and field definitions are deliberately absent: a band that
 * counted what a rep does every hour would price the team's effort, not the
 * audience it holds.
 */
export const CRM_RECORD_COLLECTIONS = [
  'contacts',
  CRM_COLLECTIONS.companies,
  CRM_COLLECTIONS.deals,
] as const

/**
 * What a create says when the records band refused it, on every surface —
 * the contacts list's alert, the company and deal drawers, the plugin's
 * create routes and the lead conversion (AGL-2596, widened in AGL-2611).
 *
 * One sentence in one place, because a reader who is refused in the drawer
 * and then reads the list must be told the same thing, and the remedy is the
 * same wherever the refusal lands: only Free has a band with no rate, so
 * "upgrade" is the whole of the answer.
 */
export const CRM_RECORDS_BAND_FULL_MESSAGE =
  'CRM records limit reached — this record was not added. Upgrade in ' +
  'Billing to keep collecting.'

/**
 * The most logged activities ONE record may carry (AGL-2611) — a contact's,
 * a company's or a deal's own log, counted on the link the activity was
 * filed under.
 *
 * A platform ceiling and not a plan dimension, in the family of
 * `WEBHOOK_MAX_PER_HOST` and `NON_PAGE_SCREEN_MAX_PER_HOST`: activities are
 * not in the records band because they are bounded by human effort, and
 * this is the bound. Five thousand is a call a day for fourteen years on one
 * person, so nobody working a real relationship reaches it — what does is
 * an automation logging on every event, or an import replaying a history,
 * and either of those past this line is a document cost with no reader.
 *
 * Enforced where an activity is written: the console's log dialog, the
 * `logCrmActivity` automation step and `POST /v1/activities`, each with one
 * aggregate read on the record's link before the create. The timeline reads
 * a hundred at a time and is untouched by the number.
 */
export const CRM_ACTIVITIES_PER_RECORD_CEILING = 5_000

/**
 * What every writer says when a record's log is full — the console's log
 * dialog, the automation step's run history and `POST /v1/activities`.
 */
export const CRM_ACTIVITY_LOG_FULL_MESSAGE =
  `This record already has ${CRM_ACTIVITIES_PER_RECORD_CEILING.toLocaleString(
    'en-US',
  )} activities, which is the most one record can carry.`

/** The record an activity is filed under: its links, of which one leads. */
export interface CrmActivityLink {
  contactId?: string | null
  companyId?: string | null
  dealId?: string | null
  /**
   * `hosts/{hostId}/leads/{leadId}` — a person not yet converted (AGL-2615).
   * A lead is host-scoped by path and carries no `visibleTo` of its own, so
   * an activity filed under one is stamped with the site's scope like any
   * other record created from that site.
   */
  leadId?: string | null
}

/**
 * The field the per-record activity ceiling is counted on, or `null` for an
 * activity that names no record at all.
 *
 * The contact leads, then the company, then the deal: an activity logged
 * from a contact's page carries the company beside it (the automation step
 * copies the facet's `companyId` onto every record it creates), and a
 * ceiling counted on the company would let one busy account exhaust every
 * contact filed under it. The record whose PAGE the log is read on is the
 * one whose log has the limit. Shared by the client dialog and the two
 * server writers so they count the same thing.
 */
export function crmActivityCeilingLink(
  link: CrmActivityLink,
): { field: 'contactId' | 'companyId' | 'dealId' | 'leadId'; id: string } | null {
  if (link.contactId) return { field: 'contactId', id: String(link.contactId) }
  if (link.companyId) return { field: 'companyId', id: String(link.companyId) }
  if (link.dealId) return { field: 'dealId', id: String(link.dealId) }
  // Last, because a converted lead's activities carry the contact beside it
  // and the contact is the record whose page they are read on.
  if (link.leadId) return { field: 'leadId', id: String(link.leadId) }
  return null
}

/**
 * Whether ONE MORE activity fits under `CRM_ACTIVITIES_PER_RECORD_CEILING`.
 * Both halves of the boundary live here so no writer re-derives `>=`.
 */
export function crmActivityLogHasRoom(existing: number): boolean {
  const count = Number(existing)
  return !(Number.isFinite(count) && count >= CRM_ACTIVITIES_PER_RECORD_CEILING)
}

/**
 * Where a person sits in the relationship, as one of a fixed list.
 *
 * A fixed list rather than free text so that a report can count people per
 * stage and a filter can select one, and in the order a person usually moves
 * through them so a picker reads as a progression. `other` is the escape
 * hatch for a business whose funnel has a step none of these name; it is a
 * deliberate stage, not an absent one.
 */
export const CONTACT_LIFECYCLE_STAGES = [
  'subscriber',
  'lead',
  'marketing-qualified',
  'sales-qualified',
  'opportunity',
  'customer',
  'evangelist',
  'other',
] as const

export type ContactLifecycleStage = (typeof CONTACT_LIFECYCLE_STAGES)[number]

/** How a lifecycle stage reads on screen — typed so a stage cannot ship unlabeled. */
export const CONTACT_LIFECYCLE_STAGE_LABELS: Record<ContactLifecycleStage, string> = {
  subscriber: 'Subscriber',
  lead: 'Lead',
  'marketing-qualified': 'Marketing qualified',
  'sales-qualified': 'Sales qualified',
  opportunity: 'Opportunity',
  customer: 'Customer',
  evangelist: 'Evangelist',
  other: 'Other',
}

export function isContactLifecycleStage(
  value: unknown,
): value is ContactLifecycleStage {
  return (
    typeof value === 'string' &&
    (CONTACT_LIFECYCLE_STAGES as readonly string[]).includes(value)
  )
}

/**
 * The stage a person is in once a capture has happened that implies at least
 * `floor` (AGL-2612).
 *
 * The one ordering rule every capture door shares: a door names the EARLIEST
 * stage that describes what just happened — a form submission is a lead, a
 * newsletter opt-in is a subscriber, a purchase is a customer — and the
 * result is that stage for a person who had none or an earlier one, and the
 * stage they already had otherwise. "Never downgrades" is the whole contract:
 * a customer who fills in a contact form is still a customer, and `other` —
 * the deliberate stage a business picked for a funnel step none of the names
 * fit — sits after `customer` in the list precisely so no capture can
 * overwrite it. A stored value that is not a stage at all reads as absent,
 * because a capture door is not the place to preserve a typo.
 *
 * With no floor the answer is the current stage as it stands, or `undefined`
 * for one that is absent or unusable — so a writer can apply this
 * unconditionally and write only what comes back.
 */
export function advanceContactLifecycleStage(
  current: unknown,
  floor: ContactLifecycleStage | undefined,
): ContactLifecycleStage | undefined {
  const held = isContactLifecycleStage(current) ? current : undefined
  if (!floor) return held
  if (!held) return floor
  const order: readonly string[] = CONTACT_LIFECYCLE_STAGES
  return order.indexOf(held) < order.indexOf(floor) ? floor : held
}

/**
 * The stage a person is in once they have BOUGHT something (AGL-2596).
 *
 * `customer` when they had no stage or an earlier one; whatever they already
 * had otherwise — {@link advanceContactLifecycleStage} with `customer` as the
 * floor, kept under its own name because "after a purchase" is the question
 * the order paths and the reports ask.
 */
export function contactLifecycleStageAfterPurchase(
  current: unknown,
): ContactLifecycleStage {
  return advanceContactLifecycleStage(current, 'customer') ?? 'customer'
}

/**
 * What a custom contact field may hold.
 *
 * Scalars only. A field is something a merchant filters and exports on, and
 * a nested value is neither; `null` is the explicit "cleared" that a form
 * writes so the key stays present for a `where` clause to find.
 */
export type ContactCustomValue = string | number | boolean | null

/**
 * The fields every CRM document carries.
 *
 * `visibleTo` is the scope both enforcement layers evaluate — see
 * `scope-tokens.ts` for why an absent one is seen by NOBODY. `hostId` is
 * provenance: the site whose console created the record, never rewritten,
 * so a report can say where a deal came from after the scope has widened.
 * The timestamps are `unknown` because a client write carries a `Date` and a
 * read hands back a Firestore `Timestamp`; callers narrow at the edge.
 */
export interface CrmScoped {
  visibleTo: string[]
  /** The site that created it. */
  hostId: string
  createdAt?: unknown
  updatedAt?: unknown
}

/** `orgs/{orgId}/companies/{companyId}`. */
export interface CrmCompany extends CrmScoped {
  name: string
  /** `nameSearchFields` twins, for the prefix search the list runs. */
  nameLower?: string
  nameTokens?: string[]
  /** Lowercase hostname, no protocol — see {@link normalizeCompanyDomain}. */
  domain?: string
  website?: string
  /** E.164 — `normalizePhone` before writing. */
  phone?: string
  address?: AglynPostalAddress | null
  industry?: string
  ownerUid?: string
  notes?: string
  /**
   * Lowercased, deduplicated, capped at twenty — the same shape a contact's
   * tags take, so a bulk "Add tag" over companies and one over contacts
   * write the same kind of value (AGL-2621).
   */
  tags?: string[]
  createdByUid?: string
  /**
   * How many contacts name this company in their {@link CONTACT_COMPANY_IDS_FIELD}
   * mirror — see {@link COMPANY_CONTACTS_COUNT_FIELD}. Absent on a company
   * nobody has linked since the counter existed, which reads as zero.
   */
  contactsCount?: number
}

/** One step of a pipeline. */
export interface CrmDealStage {
  id: string
  name: string
  /** Position in the pipeline, ascending. */
  order: number
  /** Chance of closing from here, 0–100 — what a weighted forecast multiplies by. */
  probability: number
  /**
   * Whether landing in this stage closes the deal. A pipeline has exactly one
   * `won` and one `lost` stage in the default set; `open` is everything in
   * between.
   */
  kind: 'open' | 'won' | 'lost'
}

/** `orgs/{orgId}/pipelines/{pipelineId}`. */
export interface CrmPipeline extends CrmScoped {
  name: string
  stages: CrmDealStage[]
  /** The pipeline a new deal lands in when nobody picks one. */
  isDefault?: boolean
  /**
   * When the pipeline was retired, epoch ms. An archived pipeline takes no
   * new deal and is offered by no picker, but it is never deleted: the deals
   * it closed still name it, and a report that could not resolve their
   * stages would forecast them as orphans. Absent or `null` while active.
   */
  archivedAt?: number | null
}

/** Whether a pipeline has been retired — see {@link CrmPipeline.archivedAt}. */
export function isPipelineArchived(
  pipeline: Pick<CrmPipeline, 'archivedAt'> | null | undefined,
): boolean {
  return typeof pipeline?.archivedAt === 'number' && pipeline.archivedAt > 0
}

/**
 * The stages a fresh pipeline starts with.
 *
 * Readonly on purpose: a pipeline document stores its own COPY (`[...]`), so
 * a merchant editing their stages must not be editing the module's default,
 * and a second pipeline seeded later must start from the original set.
 */
export const DEFAULT_DEAL_STAGES: readonly CrmDealStage[] = [
  { id: 'qualified', name: 'Qualified', order: 0, probability: 10, kind: 'open' },
  { id: 'contact-made', name: 'Contact made', order: 1, probability: 20, kind: 'open' },
  { id: 'proposal-sent', name: 'Proposal sent', order: 2, probability: 40, kind: 'open' },
  { id: 'negotiation', name: 'Negotiation', order: 3, probability: 60, kind: 'open' },
  { id: 'won', name: 'Won', order: 4, probability: 100, kind: 'won' },
  { id: 'lost', name: 'Lost', order: 5, probability: 0, kind: 'lost' },
]

export type CrmDealStatus = 'open' | 'won' | 'lost'

/**
 * One product on a deal — what is being sold, how many, at what.
 *
 * `productId` names a catalog product when the line came from one; a line
 * typed by hand has none. The name is copied rather than joined, the way a
 * deal copies its contact's name: a catalog product can be renamed or
 * deleted after the deal was priced, and the deal has to keep saying what
 * it was for. `currency` is the deal's — every line on a deal is in one
 * currency, because their sum is the deal's amount and a sum across
 * currencies is a number with no unit.
 */
export interface CrmDealLineItem {
  productId?: string
  name: string
  /** A whole number of units, one or more. */
  quantity: number
  /** Per unit, in the currency's minor unit, zero or more. */
  unitAmountCents: number
  /** Lowercase ISO 4217. */
  currency: string
}

/** The most lines one deal carries — a quote, not a catalog. */
export const DEAL_LINE_ITEMS_MAX = 50
export const DEAL_LINE_ITEM_NAME_MAX = 120
/** Units per line; past this the number is a data-entry slip. */
export const DEAL_LINE_ITEM_QUANTITY_MAX = 1_000_000

/** `orgs/{orgId}/deals/{dealId}`. */
export interface CrmDeal extends CrmScoped {
  title: string
  titleLower?: string
  pipelineId: string
  stageId: string
  /**
   * Denormalized from the stage's `kind` at every stage move, because it is
   * what the list filters and the indexes sort on — a query cannot join the
   * pipeline to ask what the stage means.
   */
  status: CrmDealStatus
  /**
   * What the deal is worth. Typed by hand on a deal with no line items;
   * on a deal WITH them it is their sum, stored beside them by every
   * writer (`lineItemsTotalCents`), because the board, the reports and the
   * REST list all read this one field and none of them can afford to add
   * up fifty lines per row. A deal with line items refuses a typed amount.
   */
  amountCents?: number
  /** Lowercase ISO 4217; `'usd'` when absent. */
  currency?: string
  /** The products behind the amount — see {@link CrmDealLineItem}. */
  lineItems?: CrmDealLineItem[]
  expectedCloseAtMs?: number | null
  closedAtMs?: number | null
  /** When the deal last moved — what "stuck in stage" reports read. */
  stageChangedAtMs?: number
  ownerUid?: string
  contactId?: string
  companyId?: string
  lostReason?: string
  notes?: string
  createdByUid?: string
}

/**
 * What a task is, as a fixed list.
 *
 * A const array rather than a bare union because two surfaces have to
 * enumerate it — the task form's picker and the automation step that creates
 * a task without a form — and a union cannot be iterated at run time.
 */
export const CRM_TASK_KINDS = ['call', 'email', 'meeting', 'todo'] as const
export type CrmTaskKind = (typeof CRM_TASK_KINDS)[number]

export const CRM_TASK_KIND_LABELS: Record<CrmTaskKind, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  todo: 'To-do',
}

export function isCrmTaskKind(value: unknown): value is CrmTaskKind {
  return (
    typeof value === 'string' &&
    (CRM_TASK_KINDS as readonly string[]).includes(value)
  )
}

/**
 * How far ahead an automation may date a task, in days.
 *
 * A year, because the longest follow-up anybody schedules from a trigger is
 * an annual renewal check, and a task dated further out than that is one
 * nobody will find on the list when it comes due.
 */
export const CRM_TASK_MAX_DUE_DAYS = 365

export type CrmTaskPriority = 'low' | 'normal' | 'high'
export type CrmTaskStatus = 'open' | 'done'

/** `orgs/{orgId}/crmTasks/{taskId}`. */
export interface CrmTask extends CrmScoped {
  title: string
  notes?: string
  kind: CrmTaskKind
  priority: CrmTaskPriority
  status: CrmTaskStatus
  dueAtMs?: number | null
  completedAtMs?: number | null
  /**
   * Who ticked it off, which is not always the assignee: a manager closing
   * out a departed teammate's list completes tasks that were never theirs.
   * Stamped by the `crm/task-complete` route beside `completedAtMs`.
   */
  completedByUid?: string
  assigneeUid?: string
  /**
   * The person who made it, or `''` when no person did.
   *
   * An automation has no uid, and inventing one — the action's id, a
   * sentinel — would put a value into a field every reader resolves as a
   * member. The empty string says "nobody", and {@link sourceActionId}
   * beside it says what.
   */
  createdByUid: string
  /** The automation that created it (AGL-2605), when a person did not. */
  sourceActionId?: string
  contactId?: string
  companyId?: string
  dealId?: string
}

/**
 * What a person can log, in the order the picker offers them (AGL-2600).
 *
 * A fixed list rather than free text for the reason the lifecycle stages are
 * one: a report counts calls per week and a filter selects meetings, and
 * neither can be done over a string somebody typed. `note` is the plain
 * entry — something worth writing down that was not a conversation — and
 * `other` the escape hatch for the kind none of these name.
 */
export const CRM_ACTIVITY_KINDS = ['call', 'email', 'meeting', 'note', 'other'] as const

export type CrmActivityKind = (typeof CRM_ACTIVITY_KINDS)[number]

/** How an activity kind reads on screen — typed so a kind cannot ship unlabeled. */
export const CRM_ACTIVITY_KIND_LABELS: Record<CrmActivityKind, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  other: 'Other',
}

export function isCrmActivityKind(value: unknown): value is CrmActivityKind {
  return (
    typeof value === 'string' &&
    (CRM_ACTIVITY_KINDS as readonly string[]).includes(value)
  )
}

/**
 * Whether a kind takes an outcome and a duration.
 *
 * A call and a meeting are conversations: they end somewhere ("left a
 * voicemail", "agreed to a trial") and they take a measurable amount of
 * time, and both are what a manager reading the log wants to know. An email
 * has neither in any useful sense, a note is not an event at all, and
 * `other` is unknowable — so the dialog hides the two fields for those
 * rather than offering boxes that mean nothing.
 */
export function activityKindHasOutcome(kind: CrmActivityKind): boolean {
  return kind === 'call' || kind === 'meeting'
}

/**
 * Where a one-to-one email got to (AGL-2615), in the order it normally
 * happens — the vocabulary the delivery webhook maps its events onto an
 * `email` activity in, and the chip the timeline shows beside the entry.
 *
 * The first four are a progression: a message is sent, then delivered, then
 * opened, then clicked, and a later state implies the earlier ones. The last
 * two are terminal failures. A message the mailbox provider bounced or that
 * the recipient reported is never "opened" in any sense the timeline should
 * report, whatever a tracking pixel says afterwards.
 */
export const CRM_EMAIL_DELIVERY_STATES = [
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
] as const

export type CrmEmailDeliveryState = (typeof CRM_EMAIL_DELIVERY_STATES)[number]

/** How a delivery state reads on the chip — typed so a state cannot ship unlabeled. */
export const CRM_EMAIL_DELIVERY_STATE_LABELS: Record<CrmEmailDeliveryState, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  opened: 'Opened',
  clicked: 'Clicked',
  bounced: 'Bounced',
  complained: 'Marked as spam',
}

export function isCrmEmailDeliveryState(
  value: unknown,
): value is CrmEmailDeliveryState {
  return (
    typeof value === 'string' &&
    (CRM_EMAIL_DELIVERY_STATES as readonly string[]).includes(value)
  )
}

/** The two states that mean the message did not land. */
export function isCrmEmailDeliveryFailure(state: unknown): boolean {
  return state === 'bounced' || state === 'complained'
}

/**
 * The rank the webhook advances by. Higher wins; a failure outranks every
 * progression state, and a complaint outranks a bounce because it is the
 * one a sender is scored on.
 */
const CRM_EMAIL_DELIVERY_RANK: Record<CrmEmailDeliveryState, number> = {
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  bounced: 5,
  complained: 6,
}

/**
 * The state an activity holds after one more delivery event, from the state
 * it held before.
 *
 * MONOTONIC. Provider events arrive at least once and in no promised order
 * — an `opened` can reach the webhook before the `delivered` it implies, and
 * a replay can hand back yesterday's `delivered` after today's `clicked` —
 * so the row keeps whichever state is further along, and an event that says
 * less than the row already knows changes nothing. A stored value the
 * vocabulary does not name reads as nothing, so the incoming event stands.
 */
export function nextCrmEmailDeliveryState(
  current: unknown,
  incoming: CrmEmailDeliveryState,
): CrmEmailDeliveryState {
  if (!isCrmEmailDeliveryState(current)) return incoming
  return CRM_EMAIL_DELIVERY_RANK[incoming] > CRM_EMAIL_DELIVERY_RANK[current]
    ? incoming
    : current
}

/** The most a one-to-one email's subject may hold. */
export const CRM_EMAIL_SUBJECT_MAX = 200
/** The most a one-to-one email's body may hold — a letter, not a document. */
export const CRM_EMAIL_BODY_MAX = 10_000

/**
 * The `context` a one-to-one email is sent under, which `sendEmail` stamps
 * as a provider tag on the message and the delivery log files it by.
 */
export const CRM_EMAIL_CONTEXT = 'crm'
/** The provider tag naming the activity row a one-to-one email belongs to. */
export const CRM_EMAIL_ACTIVITY_TAG = 'activityId'
/** The provider tag naming the org whose `crmActivities` holds that row. */
export const CRM_EMAIL_ORG_TAG = 'orgId'

/** What a provider tag value may be — anything else fails the whole send. */
const PROVIDER_TAG_VALUE = /^[A-Za-z0-9_-]{1,256}$/

/**
 * The tags a one-to-one email carries so the delivery webhook can find its
 * activity row (AGL-2615): the org, the activity, and the site for the
 * per-site suppression list a bounce lands on.
 *
 * Every value is checked against the provider's alphabet rather than
 * trusted, for the reason `contextTag` gives — a value the provider rejects
 * fails the send, and a failed send is worse than an untracked one. The
 * org and the activity are the pair the webhook needs, so an unusable
 * value for EITHER yields no tags at all: a tag set that named a row it
 * could not locate would be a promise the timeline cannot keep. The site
 * is stamped when it can be and dropped alone when it cannot.
 */
export function crmEmailDeliveryTags(input: {
  orgId: string
  hostId: string
  activityId: string
}): { name: string; value: string }[] {
  const orgId = String(input.orgId ?? '')
  const activityId = String(input.activityId ?? '')
  const hostId = String(input.hostId ?? '')
  if (!PROVIDER_TAG_VALUE.test(orgId) || !PROVIDER_TAG_VALUE.test(activityId)) {
    return []
  }
  return [
    { name: CRM_EMAIL_ORG_TAG, value: orgId },
    { name: CRM_EMAIL_ACTIVITY_TAG, value: activityId },
    ...(PROVIDER_TAG_VALUE.test(hostId) ? [{ name: 'hostId', value: hostId }] : []),
  ]
}

/**
 * `orgs/{orgId}/crmActivities/{activityId}` — one thing that happened.
 *
 * Distinct from a contact's `interactions`: those are what the PLATFORM
 * recorded (a form, an order, a booking) and live capped on the row. An
 * activity is what a PERSON logged — a call made, a meeting held — and can
 * hang off a company or a deal with no contact at all.
 */
export interface CrmActivity extends CrmScoped {
  kind: CrmActivityKind
  body: string
  /** When it happened, which is not when it was logged. */
  atMs: number
  /** Who logged it, or `''` for an automation — see `CrmTask.createdByUid`. */
  byUid: string
  /**
   * The author's display name as it read when the activity was logged.
   *
   * Denormalized because there is no lookup that could answer it later: a
   * member document is readable by its own subject and by org-wide members
   * only, so a scoped editor reading a colleague's call log could not
   * resolve the `byUid` beside it into a name. Stamped from the signed-in
   * user's resolved name at log time and never rewritten, so it can drift
   * from a later rename — the way a signed letter keeps the name it was
   * signed with.
   */
  byName?: string
  /** The automation that logged it (AGL-2605), when a person did not. */
  sourceActionId?: string
  contactId?: string
  companyId?: string
  dealId?: string
  /** The lead it was filed under (AGL-2615) — see {@link CrmActivityLink.leadId}. */
  leadId?: string
  outcome?: string
  durationMinutes?: number
  /**
   * An `email` the platform SENT (AGL-2615), as against one a person logged
   * by hand: the subject line, who it went to, and where delivery got to.
   * Absent on a hand-logged email, which has a body and nothing else.
   */
  subject?: string
  /** The address the message left for. */
  to?: string
  /** `outbound` for a message the platform sent. Nothing is inbound yet. */
  direction?: 'outbound'
  /** See {@link CrmEmailDeliveryState}; advanced by the delivery webhook. */
  deliveryState?: CrmEmailDeliveryState
  /** When the delivery state last moved, epoch ms. */
  deliveryAtMs?: number
}

/** An activity as a listener hands it back: the document plus its id. */
export type CrmActivityRow = CrmActivity & { $id: string }

/** What a sent one-to-one email is logged from — see {@link buildCrmEmailActivity}. */
export interface CrmEmailActivityInput {
  subject: string
  body: string
  /** The recipient, as the message was addressed. */
  to: string
  /** When it was sent. */
  atMs: number
  /** Who sent it, or `''` for an automation — see `CrmActivity.byUid`. */
  byUid: string
  byName?: string
  sourceActionId?: string
  link: CrmActivityLink
  hostId: string
  visibleTo: string[]
}

/**
 * The activity row a sent one-to-one email is logged as (AGL-2615).
 *
 * ONE builder for the two writers — the console's send route and the
 * `sendEmail` automation step — so a message a rep wrote and a message a
 * flow sent are the same kind of entry on the timeline: `kind: 'email'`,
 * outbound, starting at `sent` for the delivery webhook to advance. A
 * writer that assembled its own would be the one whose rows the chip did
 * not know how to read. Timestamps are the writer's: a server stamps
 * `serverTimestamp()` and this module has no Firestore.
 */
export function buildCrmEmailActivity(input: CrmEmailActivityInput): CrmActivity {
  const { link } = input
  return {
    kind: 'email',
    subject: String(input.subject ?? '').slice(0, CRM_EMAIL_SUBJECT_MAX),
    body: String(input.body ?? '').slice(0, CRM_EMAIL_BODY_MAX),
    to: input.to,
    direction: 'outbound',
    deliveryState: 'sent',
    deliveryAtMs: input.atMs,
    atMs: input.atMs,
    byUid: input.byUid,
    ...(input.byName ? { byName: input.byName } : {}),
    ...(input.sourceActionId ? { sourceActionId: input.sourceActionId } : {}),
    // Only the links the caller fixed: a key with no value is `undefined`,
    // which Firestore refuses.
    ...(link.contactId ? { contactId: String(link.contactId) } : {}),
    ...(link.companyId ? { companyId: String(link.companyId) } : {}),
    ...(link.dealId ? { dealId: String(link.dealId) } : {}),
    ...(link.leadId ? { leadId: String(link.leadId) } : {}),
    hostId: input.hostId,
    visibleTo: [...input.visibleTo],
  }
}

/**
 * One campaign email this person was sent, and what became of it (AGL-2616).
 *
 * The per-recipient delivery log — `emailDeliveries/{key}/messages` — keeps
 * one document per MESSAGE with a timestamp per lifecycle state and a count
 * of opens and clicks, and this is that document as a timeline reads it:
 * which email, when it went out, and how far it got. A message that bounced
 * or was complained about carries that state too, because "we mailed them
 * and it bounced" is part of the history of a relationship and a timeline
 * that showed only the successes would read as if nothing had been tried.
 *
 * The server answers with this shape, never the log record itself: the log
 * carries the recipient's address, the provider and the links they followed,
 * and none of that is the timeline's to show.
 */
export interface ContactCampaignEmail {
  /** The provider's message id — distinct per send, and the entry's key. */
  messageId: string
  /** The site the campaign went out from. */
  hostId: string
  /** `hosts/{hostId}/campaigns/{campaignId}` — the email, whose report the entry links to. */
  campaignId: string
  /**
   * The email as the team named it in the Emails console — its display name,
   * or its subject when it has none. `null` when the email has since been
   * deleted, in which case the entry still has the subject it was sent with.
   */
  campaignName: string | null
  /** The subject line the person received. */
  subject: string | null
  /** When it went out — the provider's `sent` instant, or the first event seen. */
  sentAtMs: number
  deliveredAtMs?: number
  openedAtMs?: number
  clickedAtMs?: number
  bouncedAtMs?: number
  complainedAtMs?: number
  openCount: number
  clickCount: number
}

/**
 * One entry of a contact's timeline (AGL-2600): something the platform
 * CAPTURED on the contact's facet, something a person LOGGED beside it, or
 * — since AGL-2616 — a CAMPAIGN email the person was sent.
 *
 * A tagged union rather than a flattened row, because the three are
 * different facts with different affordances — a captured interaction is
 * read-only and names the door it came through, a logged activity has an
 * author who may edit it, a campaign email is read-only and links to the
 * campaign's report — and a surface drawing the stream has to say which is
 * which. A logged activity of kind `email` and a campaign entry are two
 * different things on purpose: the first is a message a person on the team
 * sent or recorded, the second is a mailing the platform delivered, and the
 * two must never share a kind id or a glyph.
 */
export type ContactTimelineEntry =
  | {
      kind: 'captured'
      /** Distinct across the merged list, for a React key. */
      key: string
      atMs: number
      interaction: ContactInteraction
    }
  | {
      kind: 'logged'
      key: string
      atMs: number
      activity: CrmActivityRow
    }
  | {
      kind: 'campaign'
      key: string
      atMs: number
      email: ContactCampaignEmail
    }

/**
 * What became of one campaign email, as the words a timeline row prints
 * after the email's name: `sent · delivered · opened ×2 · clicked`.
 *
 * In lifecycle order, and only the states that happened. `sent` is always
 * first because the row exists; the counts appear only past one, because
 * "opened ×1" says nothing "opened" does not. A bounce or a complaint is
 * printed where it falls, after whatever succeeded before it — a message
 * delivered and then complained about reads as both, which is what
 * happened.
 */
export function campaignEmailSummary(email: ContactCampaignEmail): string[] {
  const counted = (word: string, count: number): string =>
    count > 1 ? `${word} ×${count}` : word
  const parts = ['sent']
  if (email.deliveredAtMs) parts.push('delivered')
  if (email.openedAtMs) parts.push(counted('opened', email.openCount))
  if (email.clickedAtMs) parts.push(counted('clicked', email.clickCount))
  if (email.bouncedAtMs) parts.push('bounced')
  if (email.complainedAtMs) parts.push('marked as spam')
  return parts
}

/** A time that can be sorted on; anything that is not one sinks to the bottom. */
const sortableMs = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number.NEGATIVE_INFINITY

/**
 * ONE newest-first stream from a contact's two histories.
 *
 * The captured interactions live on the contact's facet and the logged
 * activities in their own collection, and a page showing them as two lists
 * asks the reader to do the interleaving in their head — "did the call come
 * before or after the order?" is the question a timeline exists to answer.
 *
 * STABLE on purpose. The sort is on `atMs` alone, and at a tie the captured
 * entries keep their place ahead of the logged ones, each in the order it
 * arrived: a facet's interactions are already newest-first and a listener's
 * rows are already ordered, so the merge must not reshuffle what its inputs
 * settled. An entry with no usable time goes LAST, never first — a row that
 * cannot say when it happened must not read as the most recent thing.
 *
 * The key is what a list renders by. A captured interaction has no id of its
 * own, so its key is built from what it does carry; a logged activity's is
 * its document id; a campaign email's is the provider's message id.
 *
 * A campaign email is placed at the instant it was SENT, not at its latest
 * open. The row tells the whole story of that message in one line, and a
 * message that moved up the stream every time its reader re-opened it would
 * be a timeline that reorders itself under the reader.
 */
export function mergeContactTimeline(
  interactions: readonly ContactInteraction[] | null | undefined,
  activities: readonly CrmActivityRow[] | null | undefined,
  campaignEmails?: readonly ContactCampaignEmail[] | null,
): ContactTimelineEntry[] {
  const entries: ContactTimelineEntry[] = [
    ...(interactions ?? []).map(
      (interaction, index): ContactTimelineEntry => ({
        kind: 'captured',
        key: `captured:${interaction.type}:${interaction.refId ?? index}:${interaction.atMs}:${index}`,
        atMs: interaction.atMs,
        interaction,
      }),
    ),
    ...(activities ?? []).map(
      (activity): ContactTimelineEntry => ({
        kind: 'logged',
        key: `logged:${activity.$id}`,
        atMs: activity.atMs,
        activity,
      }),
    ),
    ...(campaignEmails ?? []).map(
      (email): ContactTimelineEntry => ({
        kind: 'campaign',
        key: `campaign:${email.messageId}`,
        atMs: email.sentAtMs,
        email,
      }),
    ),
  ]
  // `Array.prototype.sort` is stable, which is what keeps the tie rule above
  // true without a secondary comparison on the entry's kind or position.
  return entries.sort((a, b) => sortableMs(b.atMs) - sortableMs(a.atMs))
}

/**
 * Which record an activity is ABOUT, for a surface that links to it, or
 * `null` when it was filed against nothing.
 *
 * A contact outranks a deal outranks a company. An activity can name all
 * three — a call with a person about a deal at their company — and the
 * contact is the one a reader means when they ask "who was this with"; the
 * deal is next because it is the thing with a clock on it; the company is
 * the widest and so the last resort.
 */
export function crmActivityRecordLink(
  activity: Pick<CrmActivity, 'contactId' | 'companyId' | 'dealId' | 'leadId'>,
): { record: 'contact' | 'deal' | 'company' | 'lead'; id: string } | null {
  if (activity.contactId) return { record: 'contact', id: activity.contactId }
  if (activity.dealId) return { record: 'deal', id: activity.dealId }
  if (activity.companyId) return { record: 'company', id: activity.companyId }
  // A lead is the narrowest: once converted, the contact it became leads.
  if (activity.leadId) return { record: 'lead', id: activity.leadId }
  return null
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * How long ago something happened, in the words a list row uses.
 *
 * Coarse on purpose. A row reads "3 days ago" and carries the full timestamp
 * in its tooltip; the sentence exists so that a reader scanning a log can
 * tell this week from last month without parsing dates. Past a week the
 * relative form stops helping — "412 days ago" is a date the reader has to
 * compute — so it becomes one. A time AHEAD of now is a date too: a call
 * logged for tomorrow is a scheduling mistake the page should show plainly
 * rather than dress as "in 14 hours". An unusable time reads as nothing.
 *
 * English rather than `Intl.RelativeTimeFormat` because the console is
 * English-only, and the thresholds are what the spec pins.
 */
export function activityTimeLabel(atMs: number, nowMs: number): string {
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) return ''
  const elapsed = nowMs - atMs
  if (elapsed < -MINUTE_MS || elapsed >= 7 * DAY_MS) {
    return new Date(atMs).toLocaleDateString()
  }
  if (elapsed < MINUTE_MS) return 'just now'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`
  if (elapsed < 2 * DAY_MS) return 'yesterday'
  return `${Math.floor(elapsed / DAY_MS)} days ago`
}

export type ContactFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'url'

/**
 * `orgs/{orgId}/contactFields/{fieldId}` — a custom field a holder defined.
 *
 * The `key` is the map key under a facet's `custom`, so it is IMMUTABLE once
 * a value has been written under it; a rename is a new field and a retire.
 * `retiredAt` rather than a delete for the same reason: values written under
 * the key survive, and a retired field still has to be able to read them
 * back on an export.
 */
export interface ContactFieldDefinition extends CrmScoped {
  /** `^[a-z][a-z0-9_]{0,39}$` — see {@link normalizeContactFieldKey}. */
  key: string
  label: string
  type: ContactFieldType
  /** The choices, for `select`. */
  options?: string[]
  required?: boolean
  /** Position in the form and the export, ascending. */
  order: number
  retiredAt?: number | null
}

/** What a stored field key must look like — a letter, then up to 39 of `[a-z0-9_]`. */
export const CONTACT_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

/**
 * A typed label, as the key it would be stored under, or `null` when nothing
 * usable survives.
 *
 * Lowercased and snake-cased rather than refused, because the key is derived
 * from the label a merchant typed ("Annual revenue" → `annual_revenue`) and
 * they should not have to learn the grammar. Anything outside `[a-z0-9_]` is
 * dropped after separators become underscores, runs collapse, and a leading
 * run of digits or underscores goes — a key has to start with a letter so it
 * can never collide with an array index or read as a number in a filter.
 */
export function normalizeContactFieldKey(input: unknown): string | null {
  const key = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 40)
  return CONTACT_FIELD_KEY_PATTERN.test(key) ? key : null
}

/** The stage a deal is in, or `null` when the pipeline no longer has it. */
export function dealStageById(
  pipeline: Pick<CrmPipeline, 'stages'> | null | undefined,
  stageId: string,
): CrmDealStage | null {
  return pipeline?.stages?.find((stage) => stage.id === stageId) ?? null
}

/**
 * What a deal is worth to a forecast, in cents.
 *
 * STATUS wins over the stage. A deal marked won is worth its full amount
 * whatever stage it happens to sit in, and a lost one is worth nothing —
 * the stage's probability is the odds of an OPEN deal, and applying it to a
 * closed one would forecast a sale that has already happened as a fraction
 * of itself. An open deal with no resolvable stage is worth nothing rather
 * than everything: the pipeline lost the stage, and a forecast that filled
 * the gap with 100% would be the most optimistic number available.
 */
export function weightedDealAmountCents(
  deal: Pick<CrmDeal, 'amountCents' | 'status'>,
  stage: Pick<CrmDealStage, 'probability'> | null | undefined,
): number {
  const amount = Math.max(0, Math.round(Number(deal.amountCents ?? 0) || 0))
  if (deal.status === 'won') return amount
  if (deal.status === 'lost' || !stage) return 0
  const probability = Math.min(100, Math.max(0, Number(stage.probability) || 0))
  return Math.round((amount * probability) / 100)
}

/** Whether a deal's amount is derived — it has at least one line item. */
export function dealHasLineItems(
  deal: Pick<CrmDeal, 'lineItems'> | null | undefined,
): boolean {
  return Array.isArray(deal?.lineItems) && deal.lineItems.length > 0
}

/**
 * What a set of line items adds up to, in cents — the amount a deal with
 * line items stores. Whole cents, never negative: a line's quantity and
 * unit amount have both been through `readDealLineItems`, but a stored
 * document from an older writer is trusted no further than that.
 */
export function lineItemsTotalCents(
  items: readonly Pick<CrmDealLineItem, 'quantity' | 'unitAmountCents'>[] | null | undefined,
): number {
  let total = 0
  for (const item of items ?? []) {
    const quantity = Math.max(0, Math.round(Number(item.quantity) || 0))
    const unit = Math.max(0, Math.round(Number(item.unitAmountCents) || 0))
    total += quantity * unit
  }
  return total
}

/**
 * Line items as a client typed or sent them, validated into the stored
 * shape, or the one reason they were refused.
 *
 * The one reader for both writers — the products card on a deal's page
 * and `POST`/`PATCH /v1/deals` — so a line the console accepts is a line
 * the API accepts and the other way round. The rules: at most
 * {@link DEAL_LINE_ITEMS_MAX} lines; every line a name, a whole quantity
 * of one or more, a whole unit amount of zero or more; every line in the
 * DEAL's currency (`currency`), which a line may omit and may not
 * contradict. An empty list is valid and means "no line items" — the
 * amount goes back to being typed.
 */
export function readDealLineItems(
  input: unknown,
  currency: string,
): { items: CrmDealLineItem[] } | { error: string } {
  if (input === undefined || input === null) return { items: [] }
  if (!Array.isArray(input)) return { error: 'Line items must be a list' }
  if (input.length > DEAL_LINE_ITEMS_MAX) {
    return { error: `A deal carries at most ${DEAL_LINE_ITEMS_MAX} line items` }
  }
  const dealCurrency = String(currency || 'usd').trim().toLowerCase()
  const items: CrmDealLineItem[] = []
  for (const [index, raw] of input.entries()) {
    const at = `Line ${index + 1}`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: `${at} must be an object` }
    }
    const line = raw as Record<string, unknown>
    const name = String(line.name ?? '')
      .trim()
      .slice(0, DEAL_LINE_ITEM_NAME_MAX)
    if (!name) return { error: `${at} needs a name` }
    const quantity = Number(line.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > DEAL_LINE_ITEM_QUANTITY_MAX) {
      return {
        error: `${at}: the quantity must be a whole number from 1 to ${DEAL_LINE_ITEM_QUANTITY_MAX.toLocaleString()}`,
      }
    }
    const unitAmountCents = Number(line.unitAmountCents)
    if (!Number.isInteger(unitAmountCents) || unitAmountCents < 0) {
      return { error: `${at}: the unit amount must be a whole number of cents, 0 or more` }
    }
    const lineCurrency =
      line.currency === undefined || line.currency === null || line.currency === ''
        ? dealCurrency
        : String(line.currency).trim().toLowerCase()
    if (lineCurrency !== dealCurrency) {
      return { error: `${at} is in ${lineCurrency.toUpperCase()}; every line must be in the deal's currency, ${dealCurrency.toUpperCase()}` }
    }
    const productId =
      typeof line.productId === 'string' && line.productId.trim()
        ? line.productId.trim().slice(0, 200)
        : undefined
    items.push({
      ...(productId ? { productId } : {}),
      name,
      quantity,
      unitAmountCents,
      currency: dealCurrency,
    })
  }
  return { items }
}

export type TaskDueState = 'overdue' | 'today' | 'upcoming' | 'none' | 'done'

/**
 * Where a task stands against the clock.
 *
 * `today` is decided on the LOCAL calendar day and beats `overdue`: a task
 * due at nine this morning is today's work until midnight, not something the
 * list should paint red at 9:01. Overdue is yesterday or earlier. `done`
 * comes first because a completed task's due date is history whichever side
 * of now it fell on.
 */
export function taskDueState(
  task: Pick<CrmTask, 'status' | 'dueAtMs'>,
  nowMs: number,
): TaskDueState {
  if (task.status === 'done') return 'done'
  const dueAtMs = task.dueAtMs
  if (typeof dueAtMs !== 'number' || !Number.isFinite(dueAtMs)) return 'none'
  const due = new Date(dueAtMs)
  const now = new Date(nowMs)
  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate()
  if (sameDay) return 'today'
  return dueAtMs < nowMs ? 'overdue' : 'upcoming'
}

/**
 * A hostname label: `[a-z0-9-]`, not starting or ending with a hyphen, at
 * most 63 characters — RFC 1123 as far as a company domain needs it.
 */
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * A typed or pasted domain, reduced to the bare lowercase hostname a company
 * is keyed by, or `null` when what is left is not one.
 *
 * Strips what people paste along with a domain — the protocol, a `www.`, a
 * path, a query, a port — because the value is a KEY: two contacts at
 * `https://www.acme.com/about` and `acme.com` work for one company, and the
 * match is only findable if both reduce to the same string. The last label
 * has to be letters because a company's domain has a TLD; a bare IP address
 * or a single word is not one and answers `null` rather than being stored as
 * something a later match will never hit.
 */
export function normalizeCompanyDomain(input: unknown): string | null {
  let value = String(input ?? '')
    .trim()
    .toLowerCase()
  if (!value) return null
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.replace(/^www\./, '')
  value = value.split(/[/?#]/, 1)[0]
  value = value.split(':', 1)[0]
  value = value.replace(/\.+$/, '')
  if (!value || value.length > 253) return null
  const labels = value.split('.')
  if (labels.length < 2) return null
  if (!labels.every((label) => DOMAIN_LABEL.test(label))) return null
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return null
  return value
}

/** The longest website URL a company stores. */
const COMPANY_WEBSITE_MAX = 500

/**
 * The typed website, as a URL; `''` for a blank; `null` when it cannot be
 * one.
 *
 * People type `acme.com` where a URL is asked for, and refusing that is
 * pedantry — it becomes `https://acme.com`. What IS refused is anything the
 * URL parser cannot read or a scheme other than http(s): a `javascript:` link
 * on a record that renders as an anchor is not a website. One function for
 * the company drawer and the companies import, so a website typed and a
 * website imported are stored the same way.
 */
export function normalizeCompanyWebsite(input: unknown): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return ''
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href.length > COMPANY_WEBSITE_MAX ? null : url.href
  } catch {
    return null
  }
}

/**
 * Mailbox providers whose domain names nobody's company.
 *
 * Auto-associating a contact with a company by email domain is the whole
 * reason {@link companyDomainForEmail} exists, and it is wrong for every
 * address at a public mailbox: `gmail.com` is not a company, and a rule
 * that treated it as one would file half of a consumer list under a single
 * phantom account.
 */
const PUBLIC_MAILBOX_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'zoho.com',
  'fastmail.com',
  'hey.com',
])

/**
 * The company domain an email address implies, or `null` when it implies
 * none — a malformed address, or one at a public mailbox provider.
 */
export function companyDomainForEmail(email: unknown): string | null {
  const value = String(email ?? '')
    .trim()
    .toLowerCase()
  const at = value.lastIndexOf('@')
  if (at < 1 || at === value.length - 1) return null
  if (/[\s@]/.test(value.slice(0, at))) return null
  const domain = normalizeCompanyDomain(value.slice(at + 1))
  if (!domain || PUBLIC_MAILBOX_DOMAINS.has(domain)) return null
  return domain
}

/**
 * The name a company minted from a domain starts with: the first label with
 * a capital — `acme.com` → `Acme`, `initech.co.uk` → `Initech`.
 *
 * A starting point and not a claim about what the business is called: the
 * lead-convert dialog offers it for editing, and a company the capture door
 * creates on its own carries it until somebody renames the record. The
 * domain itself would be an honest name too, but a list of companies that
 * reads `acme.com`, `globex.example` looks like a list of websites, and the
 * domain is on the row beside the name anyway.
 */
export function companyNameForDomain(domain: string): string {
  const label = domain.split('.')[0] || domain
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/*==========================================
 * THE CONTACT–COMPANY LINK (AGL-2597, AGL-2613).
 *
 * The association proper is `facets.{groupId}.companyId` — one company per
 * holder, inside that holder's facet like the notes and the tags, and for
 * the same reason: which account a person belongs to is one business's
 * knowledge of them. But a facet path is per group, and Firestore cannot
 * answer "every contact whose facet, whichever group's, names company X" —
 * a `where` needs one field path, and the group id is part of the path. So
 * the facet is MIRRORED into a top-level array an `array-contains` can
 * query, and the company carries a COUNT of the contacts whose mirror names
 * it, so a list of companies can say how many people are at each without
 * reading a person.
 *
 * Three fields, kept in step by ONE planner. Every writer — the picker on a
 * contact's page, the company page's link control, the bulk bar, the server
 * doors that link on capture — asks {@link planContactCompanyLink} what
 * changes and applies the answer with its own SDK's sentinels. None of them
 * decides for itself whether the old id leaves the mirror, which is the rule
 * a second copy would get wrong: another business filing the same person
 * under the same account is THEIR link, and this holder letting go must not
 * take it away.
 *=========================================*/

/**
 * The top-level field on a CONTACT naming every company it is linked to.
 *
 * It carries the union of every holder's link, so removing an id from it is
 * only correct when no other holder's facet still names that id — the rule
 * the planner enforces, and the reason nothing writes this field without
 * going through it. The facet is the truth and this is its index: a reader
 * answering "which company is this person at" reads the facet; only a QUERY
 * reads this.
 */
export const CONTACT_COMPANY_IDS_FIELD = 'companyIds'

/**
 * The field on a COMPANY counting the contacts whose mirror names it.
 *
 * Denormalized because the honest figure is an aggregate over every contact
 * in the org, which a list of two hundred companies cannot afford to take
 * per row. Moved by `increment` in the same batch as the link that changes
 * it, so the two cannot disagree by a failed second write; a company's own
 * page still takes the live aggregate, which is what corrects a count that
 * predates the counter.
 */
export const COMPANY_CONTACTS_COUNT_FIELD = 'contactsCount'

/** What the planner needs to know about a contact's links, and nothing else. */
export interface ContactCompanyLinkState {
  /** This holder's link, or `null` when the facet names no company. */
  companyId: string | null
  /** The mirror as stored, in no order. */
  companyIds: string[]
  /**
   * Ids named by OTHER holders' facets — what keeps an id in the mirror
   * when this holder lets go of it.
   */
  heldElsewhere: string[]
}

/** The link state of a stored contact, read for one holder. */
export function readContactCompanyLink(
  contact: Record<string, unknown> | null | undefined,
  groupId: string,
): ContactCompanyLinkState {
  const document = contact ?? {}
  const facets = document[CONTACT_FACETS_FIELD]
  const heldElsewhere = new Set<string>()
  if (facets && typeof facets === 'object' && !Array.isArray(facets)) {
    for (const [holder, facet] of Object.entries(
      facets as Record<string, unknown>,
    )) {
      if (holder === groupId) continue
      const named =
        facet && typeof facet === 'object' && !Array.isArray(facet)
          ? (facet as Record<string, unknown>)['companyId']
          : undefined
      if (typeof named === 'string' && named) heldElsewhere.add(named)
    }
  }
  const mirror = document[CONTACT_COMPANY_IDS_FIELD]
  return {
    companyId: readContactFacet(document, groupId).companyId ?? null,
    companyIds: Array.isArray(mirror)
      ? mirror.filter((id): id is string => typeof id === 'string' && !!id)
      : [],
    heldElsewhere: [...heldElsewhere],
  }
}

/**
 * How the mirror changes. Three shapes because Firestore takes ONE transform
 * per field per write: an `arrayUnion` and an `arrayRemove` on the same
 * field cannot share an update, so a move rewrites the array whole.
 */
export type ContactCompanyMirrorChange =
  | { op: 'union'; companyId: string }
  | { op: 'remove'; companyId: string }
  | { op: 'set'; companyIds: string[] }

export interface ContactCompanyLinkPlan {
  /** The facet's new value: the id, or `null` meaning delete the field. */
  companyId: string | null
  /** What happens to the mirror, or `null` when it already carries the right ids. */
  mirror: ContactCompanyMirrorChange | null
  /**
   * Per company, how its contacts count moves. A company enters the list
   * only when the mirror actually gains or loses it, so a link some other
   * holder already made is not counted twice and a mirror that never carried
   * an id is not decremented for it.
   */
  counts: Array<{ companyId: string; delta: 1 | -1 }>
}

/**
 * What linking a contact to a company FOR ONE HOLDER changes — or unlinking
 * them, with `null`. `null` when the document already says what was asked.
 *
 * Three cases, and the mirror is handled differently in each because it is
 * shared across holders while the facet is not:
 *
 *  - A first link `union`s the id in, which is safe against a concurrent
 *    writer adding another holder's id.
 *  - A MOVE from one company to another rewrites the mirror as a whole. The
 *    old id is dropped only if no other holder's facet still names it.
 *  - An unlink `remove`s the old id, on the same condition, and leaves the
 *    mirror alone when another holder still needs it there.
 *
 * The counts follow the mirror, not the facet: the company's figure is "how
 * many contacts name me in the mirror", and that is the quantity the
 * company page's live aggregate measures.
 */
export function planContactCompanyLink(
  state: ContactCompanyLinkState,
  companyId: string | null,
): ContactCompanyLinkPlan | null {
  const previous = state.companyId
  if (previous === companyId) return null
  const mirror = new Set(state.companyIds)
  const previousLeaves =
    previous !== null && !state.heldElsewhere.includes(previous)
  const counts: ContactCompanyLinkPlan['counts'] = []
  let change: ContactCompanyMirrorChange | null = null
  if (companyId && !previous) {
    change = { op: 'union', companyId }
    if (!mirror.has(companyId)) counts.push({ companyId, delta: 1 })
  } else if (companyId && previous) {
    const kept = state.companyIds.filter(
      (id) => id !== previous || !previousLeaves,
    )
    change = { op: 'set', companyIds: [...new Set([...kept, companyId])] }
    if (previousLeaves && mirror.has(previous)) {
      counts.push({ companyId: previous, delta: -1 })
    }
    if (!mirror.has(companyId)) counts.push({ companyId, delta: 1 })
  } else if (previous && previousLeaves) {
    change = { op: 'remove', companyId: previous }
    if (mirror.has(previous)) counts.push({ companyId: previous, delta: -1 })
  }
  return { companyId, mirror: change, counts }
}

/*==========================================
 * THE CRM's ORGANIZATION SETTINGS (AGL-2613).
 *
 * One map under `crm` on the org document, so the CRM → Settings section
 * can grow a key per setting without a rules change each time: the org
 * document's client branch is a deny-list, and `crm` is declared
 * client-writable in `ORG_CLIENT_WRITABLE_FIELDS` with its reason.
 *=========================================*/

/** The org-document key the CRM's settings live under. */
export const ORG_CRM_SETTINGS_FIELD = 'crm'

/** The dotted path an `update()` writes the auto-create switch by. */
export const CRM_AUTO_CREATE_COMPANIES_PATH = `${ORG_CRM_SETTINGS_FIELD}.autoCreateCompanies`

/**
 * Whether a capture from a work email domain no visible company carries
 * should CREATE the company. Off unless the org document says `true`: a
 * company minted from every domain that ever submitted a form is a list
 * nobody asked for, so the default is the quiet one.
 *
 * Read off the raw document rather than a typed field, because the capture
 * door holds a `Partial<AglynOrganization>` and the console a
 * `Partial<AglynOrgBilling>`, and one reader has to answer both.
 */
export function orgAutoCreatesCompanies(
  orgDocument: Record<string, unknown> | null | undefined,
): boolean {
  const settings = (orgDocument ?? {})[ORG_CRM_SETTINGS_FIELD]
  return Boolean(
    settings &&
      typeof settings === 'object' &&
      !Array.isArray(settings) &&
      (settings as Record<string, unknown>)['autoCreateCompanies'] === true,
  )
}

/*==========================================
 * WHO A NEW RECORD BELONGS TO (AGL-2618).
 *
 * Salesforce calls these assignment rules and HubSpot rotates to an owner;
 * either way they are the first thing a sales team configures, because a
 * record with no owner is one nobody follows up. The shape here is what the
 * CRM → Settings section writes onto the org document under `crm`, what the
 * capture door's assignment pass reads, and what the `assignContactOwner`
 * automation step's round-robin mode reads — one vocabulary, three readers.
 *
 * ## The order of decision
 *
 * The rules are tried in their stored order and the FIRST match assigns; a
 * rule that names a member the roster no longer has, or a round-robin rule
 * over an empty pool, is passed over rather than stopping the pass. When no
 * rule claims the capture, the capturing site's default owner does; when
 * the site has none, the record stays unassigned, which is what the product
 * did before any of this existed and is the honest answer to "nobody has
 * said".
 *
 * ## Only a record with no owner
 *
 * The capture pass runs when a record is CREATED and never overwrites an
 * owner: a door that named one (the console's drawer, an import column, a
 * conversion with a picked owner) has expressed a person's choice, and a
 * returning visitor's contact already belongs to somebody. The automation
 * step is the deliberate exception — an author who put "assign an owner"
 * on a stage change means to reassign.
 *
 * ## Why the pointer is a uid, and why the server moves it
 *
 * See `OrgCrmRoundRobin`. The pool is edited in the console and the pointer
 * is advanced by the Admin SDK inside the transaction that writes the owner,
 * so concurrent captures take distinct turns and an edit to the pool never
 * skips or repeats a member.
 *=========================================*/

/** Where the ordered rules live on the org document. */
export const CRM_ASSIGNMENT_RULES_PATH = `${ORG_CRM_SETTINGS_FIELD}.assignmentRules`

/** The round-robin pool's member list, in rotation order. */
export const CRM_ROUND_ROBIN_POOL_PATH = `${ORG_CRM_SETTINGS_FIELD}.roundRobin.memberUids`

/** The member handed the most recent round-robin record. */
export const CRM_ROUND_ROBIN_LAST_ASSIGNED_PATH = `${ORG_CRM_SETTINGS_FIELD}.roundRobin.lastAssignedUid`

/**
 * The most rules an org may keep. A first-match list longer than this is
 * one nobody can reason about, and the section refuses the fifty-first
 * rather than letting the document grow unbounded.
 */
export const CRM_ASSIGNMENT_RULES_MAX = 50

/** The most members a round-robin pool may hold. */
export const CRM_ROUND_ROBIN_POOL_MAX = 50

/**
 * The map of per-site CRM settings under `crm` on the ORG document, keyed
 * by host id. A field on the org, not a subcollection of the host: the
 * host-subcollection guards read a quoted `'hosts'` beside a site id as a
 * client path under `hosts/{hostId}`, which this is not, so the key is
 * named here and spelled nowhere else.
 */
const CRM_HOST_SETTINGS_KEY = 'hosts'

/**
 * The field-path SEGMENTS of a site's default owner on the org document.
 *
 * Segments rather than a dotted string, because the host id is a document
 * id and a document id may contain a dot; joined with dots it would be read
 * as two path elements and the write would land beside the setting rather
 * than in it. A caller builds a `FieldPath` from these on either SDK.
 */
export function crmHostDefaultOwnerSegments(hostId: string): string[] {
  if (!hostId) throw new Error('a site default owner must name a site')
  return [ORG_CRM_SETTINGS_FIELD, CRM_HOST_SETTINGS_KEY, hostId, 'defaultOwnerUid']
}

/** The conditions a rule may name — every one present must hold. */
export interface CrmAssignmentRuleWhen {
  /** The capture door: `form`, `booking`, `order`, `manual`… */
  source?: ContactSource
  /** The form the capture came through, by its document id. */
  formId?: string
  /** The captured address's domain, lowercased, without a leading `@`. */
  emailDomain?: string
  /** A tag the capture carries or the contact already wears. */
  tag?: string
}

/** How a matching rule assigns: one member, or the next in the pool. */
export type CrmAssignmentTarget = { memberUid: string } | { roundRobin: true }

/**
 * One rule as the CRM reads it — `OrgCrmAssignmentRule` with the source
 * narrowed to the capture vocabulary.
 */
export interface CrmAssignmentRule extends OrgCrmAssignmentRule {
  when: CrmAssignmentRuleWhen
  assign: CrmAssignmentTarget
}

/** The pool as the CRM reads it: never absent, possibly empty. */
export interface CrmRoundRobinPool {
  memberUids: string[]
  lastAssignedUid: string | null
}

/**
 * The org's assignment settings, read tolerantly off the raw document.
 *
 * Every field is optional on the document and the section writes each on
 * its own, so a reader that trusted the shape would throw on the first org
 * that has set the pool but never a rule. Malformed entries are dropped
 * rather than refused wholesale: one hand-edited rule must not stop the
 * others from assigning.
 */
export interface CrmAssignmentSettings {
  rules: CrmAssignmentRule[]
  pool: CrmRoundRobinPool
  /** Site id → default owner uid, for the sites that set one. */
  hostDefaultOwners: Record<string, string>
}

function isContactSourceValue(value: unknown): value is ContactSource {
  return typeof value === 'string' && value in CONTACT_SOURCE_LABELS
}

function cleanText(value: unknown, max: number): string | undefined {
  const text = typeof value === 'string' ? value.trim().slice(0, max) : ''
  return text || undefined
}

/** A rule as the document holds it, or `null` for one that cannot assign. */
export function readCrmAssignmentRule(raw: unknown): CrmAssignmentRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>
  const id = cleanText(entry['id'], 64)
  if (!id) return null
  const whenRaw =
    entry['when'] && typeof entry['when'] === 'object' && !Array.isArray(entry['when'])
      ? (entry['when'] as Record<string, unknown>)
      : {}
  const when: CrmAssignmentRuleWhen = {}
  if (isContactSourceValue(whenRaw['source'])) when.source = whenRaw['source']
  const formId = cleanText(whenRaw['formId'], 128)
  if (formId) when.formId = formId
  // A person types a domain the way they see one in an address — `@acme.com`
  // — so the `@` is what the field means, not part of the domain.
  const emailDomain = normalizeCompanyDomain(
    String(whenRaw['emailDomain'] ?? '')
      .trim()
      .replace(/^@/, ''),
  )
  if (emailDomain) when.emailDomain = emailDomain
  const tag = cleanText(whenRaw['tag'], 60)?.toLowerCase()
  if (tag) when.tag = tag
  const assignRaw =
    entry['assign'] &&
    typeof entry['assign'] === 'object' &&
    !Array.isArray(entry['assign'])
      ? (entry['assign'] as Record<string, unknown>)
      : null
  if (!assignRaw) return null
  if (assignRaw['roundRobin'] === true) {
    return { id, when, assign: { roundRobin: true } }
  }
  const memberUid = cleanText(assignRaw['memberUid'], 128)
  return memberUid ? { id, when, assign: { memberUid } } : null
}

export function readCrmAssignmentSettings(
  orgDocument: Record<string, unknown> | null | undefined,
): CrmAssignmentSettings {
  const settings = (orgDocument ?? {})[ORG_CRM_SETTINGS_FIELD]
  const crm =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {}
  const rules = (Array.isArray(crm['assignmentRules']) ? crm['assignmentRules'] : [])
    .map(readCrmAssignmentRule)
    .filter((rule): rule is CrmAssignmentRule => rule !== null)
    .slice(0, CRM_ASSIGNMENT_RULES_MAX)
  const roundRobin =
    crm['roundRobin'] && typeof crm['roundRobin'] === 'object'
      ? (crm['roundRobin'] as Record<string, unknown>)
      : {}
  const memberUids = [
    ...new Set(
      (Array.isArray(roundRobin['memberUids']) ? roundRobin['memberUids'] : [])
        .map((uid) => cleanText(uid, 128))
        .filter((uid): uid is string => Boolean(uid)),
    ),
  ].slice(0, CRM_ROUND_ROBIN_POOL_MAX)
  const hostSettings = crm[CRM_HOST_SETTINGS_KEY]
  const hosts =
    hostSettings && typeof hostSettings === 'object' && !Array.isArray(hostSettings)
      ? (hostSettings as Record<string, unknown>)
      : {}
  const hostDefaultOwners: Record<string, string> = {}
  for (const [hostId, value] of Object.entries(hosts)) {
    const owner =
      value && typeof value === 'object'
        ? cleanText((value as Record<string, unknown>)['defaultOwnerUid'], 128)
        : undefined
    if (owner) hostDefaultOwners[hostId] = owner
  }
  return {
    rules,
    pool: {
      memberUids,
      lastAssignedUid: cleanText(roundRobin['lastAssignedUid'], 128) ?? null,
    },
    hostDefaultOwners,
  }
}

/** The member a site hands unclaimed captures to, or `null` for nobody. */
export function crmHostDefaultOwner(
  orgDocument: Record<string, unknown> | null | undefined,
  hostId: string,
): string | null {
  return readCrmAssignmentSettings(orgDocument).hostDefaultOwners[hostId] ?? null
}

/** What a rule is matched against: the capture, as its door described it. */
export interface CrmAssignmentCapture {
  source: ContactSource
  email: string
  formId?: string | null
  /** The capture's own tags and whatever the contact already wears. */
  tags?: readonly string[]
}

/**
 * The domain a rule's `emailDomain` is compared with — the address's own,
 * lowercased. Not `companyDomainForEmail`, which answers `null` for a public
 * mailbox: a team may well route every `gmail.com` sign-up to one rep, and
 * a rule that could not name a consumer domain could not say so.
 */
export function assignmentEmailDomain(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at < 0) return null
  return normalizeCompanyDomain(email.slice(at + 1))
}

/**
 * Whether every condition the rule names holds for this capture. A rule
 * with no condition matches every capture — the catch-all.
 */
export function assignmentRuleMatches(
  when: CrmAssignmentRuleWhen,
  capture: CrmAssignmentCapture,
): boolean {
  if (when.source && when.source !== capture.source) return false
  if (when.formId && when.formId !== (capture.formId ?? '')) return false
  if (when.emailDomain && when.emailDomain !== assignmentEmailDomain(capture.email)) {
    return false
  }
  if (when.tag) {
    const worn = (capture.tags ?? []).map((tag) => String(tag).trim().toLowerCase())
    if (!worn.includes(when.tag)) return false
  }
  return true
}

/**
 * The pool in the order the next record should try it: the member after
 * the last recipient first, wrapping round, and the last recipient
 * themselves at the end — so a pool of one still assigns, and a pointer
 * naming somebody no longer in the pool starts from the top.
 */
export function roundRobinOrder(
  memberUids: readonly string[],
  lastAssignedUid: string | null | undefined,
): string[] {
  if (!memberUids.length) return []
  const at = lastAssignedUid ? memberUids.indexOf(lastAssignedUid) : -1
  if (at < 0) return [...memberUids]
  return [...memberUids.slice(at + 1), ...memberUids.slice(0, at + 1)]
}

/**
 * How a rule reads in the settings list — its conditions in words and
 * where it sends the record — so a reader can tell two rules apart without
 * opening either. `memberLabel` turns a uid into a name; the section passes
 * the roster's.
 */
export function describeAssignmentRule(
  rule: CrmAssignmentRule,
  memberLabel: (uid: string) => string,
): { when: string; assign: string } {
  const parts: string[] = []
  if (rule.when.source) parts.push(`source is ${CONTACT_SOURCE_LABELS[rule.when.source]}`)
  if (rule.when.formId) parts.push(`form is ${rule.when.formId}`)
  if (rule.when.emailDomain) parts.push(`email domain is ${rule.when.emailDomain}`)
  if (rule.when.tag) parts.push(`tagged ${rule.when.tag}`)
  return {
    when: parts.length ? parts.join(' and ') : 'Every capture',
    assign:
      'roundRobin' in rule.assign ? 'Round robin' : memberLabel(rule.assign.memberUid),
  }
}

/**
 * A fresh rule id, unique among the ones the org already holds. Time and
 * entropy rather than a counter, so two admins adding a rule in two tabs
 * do not mint the same id and have one reorder clobber the other's rule.
 */
export function newAssignmentRuleId(existing: readonly string[]): string {
  for (;;) {
    const id = `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    if (!existing.includes(id)) return id
  }
}

/**
 * The `visibleTo` every CRM creator stamps — client or server, whichever
 * door the record comes in through.
 *
 * The contact create path's own expression (`upsertHostContact`), lifted
 * here so that a company, a deal or a task created from a site's console
 * lands in exactly the scope a contact captured on that site would: the
 * whole org when the org has chosen `defaultResourceScope: 'org'`, and
 * otherwise the sites that present as one sender — which, undeclared, is
 * this site alone. That is the agency's isolation, arrived at with nothing
 * configured, and the reason this is a function rather than a convention
 * eight creators are asked to remember.
 *
 * Widening past the group is an ACT — an org-wide member editing the scope
 * on the record — never a default. The rules refuse a scoped member creating
 * a record outside their own tokens, so a creator that bypassed this could
 * only make its record invisible to itself, never wider.
 */
export function crmScopeTokens(
  org: Record<string, unknown> | null | undefined,
  group: ConsentGroup,
): ScopeToken[] {
  return (org ?? {})['defaultResourceScope'] === 'org'
    ? [ORG_SCOPE_TOKEN]
    : consentGroupScope(group)
}

/**
 * The `visibleTo` tokens a reader of this group may LIST, for the
 * `array-contains-any` every CRM listener filters by.
 *
 * The other half of {@link crmScopeTokens}: that is what a creator stamps,
 * this is what a reader asks for, and the two differ by exactly one token.
 * `'org'` leads because an org-wide record is visible to every site — an org
 * that widened its default deliberately still sees its own rows — and the
 * group's sites follow. The contacts list computes this inline; every other
 * CRM reader takes it from here so that none of them can drop the org token
 * and lose the org-wide rows, or forget the cap and have Firestore refuse
 * the query outright.
 *
 * Capped at {@link MAX_SCOPE_HOSTS}: a group wider than the operator's limit
 * is listed as far as the limit reaches, which is the contacts list's
 * behavior and the only one short of an error.
 */
export function crmReadTokens(group: ConsentGroup): ScopeToken[] {
  return [ORG_SCOPE_TOKEN, ...consentGroupScope(group)].slice(0, MAX_SCOPE_HOSTS)
}

/*==========================================
 * THE TEAM, AS A RECORD NAMES THEM (AGL-2614).
 *
 * An owner and an assignee are stored by uid — `orgs/{orgId}/members/{uid}`
 * is keyed by it, and a uid outlives every address change. But the people
 * who NAME an owner do not think in uids: an automation step is typed, a
 * CSV column is an address, and a picker lists names. So a reference
 * arrives as one of two things, and every reader that turns a reference
 * into a person has to accept both or the roster splits into the members
 * who can be named and the members who cannot.
 *
 * The member documents make the second case real. Two production paths
 * create a member document WITHOUT its `email` — a host-access re-grant,
 * and an add whose auth record carried none — and such a member was
 * unnameable everywhere a surface asked for an address: an automation
 * could not assign to them, and a roster mapper that dropped a row with no
 * address could not even list them. A name they still have (the roster's
 * `displayName`), and a uid they always have, so a label falls through to
 * the uid rather than to nothing, and a reference is resolved by uid first
 * and by address second.
 *
 * Roster-only, deliberately. The project's Auth records could resolve an
 * address the roster cannot, and would resolve people who are not on this
 * organization at all (AGL-1122); a reference that names nobody on the
 * roster names nobody.
 *=========================================*/

/** One person on the team, as a picker lists them and a reference resolves to them. */
export interface CrmMemberOption {
  /** The account uid — what `ownerUid` and `assigneeUid` store. */
  uid: string
  /** The name a colleague recognizes: display name, else address, else the uid. */
  label: string
  /** The roster's address, when the member document carries one. */
  email?: string
}

/**
 * How a step or a column names somebody on the team: an address when the
 * text is one, otherwise a uid. `null` for a blank, which every caller
 * treats as "nobody named" rather than as a member called "".
 */
export type CrmMemberRef =
  | { kind: 'uid'; uid: string }
  | { kind: 'email'; email: string }

export function parseCrmMemberRef(value: unknown): CrmMemberRef | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.includes('@')) {
    const email = normalizeContactEmail(text)
    return email ? { kind: 'email', email } : null
  }
  return { kind: 'uid', uid: text }
}

/**
 * A roster row as every CRM picker and column shows it.
 *
 * One mapping rather than four, because four is what the CRM had — and one
 * of them dropped a member whose document had neither a display name nor an
 * address, which is precisely the member the uid fallback exists for.
 */
export function crmMemberOption(
  member: Record<string, unknown>,
): CrmMemberOption | null {
  const uid = String(member['$id'] ?? member['uid'] ?? '').trim()
  if (!uid) return null
  const displayName = String(member['displayName'] ?? '').trim()
  const email = String(member['email'] ?? '').trim()
  return {
    uid,
    label: displayName || email || uid,
    ...(email ? { email } : {}),
  }
}

/**
 * The member a stored reference names: by uid first — the stored shape —
 * and by address second, so a record that carries an address where a uid
 * belongs (an older import, a hand edit) still names the person the roster
 * has under it. Undefined for nobody, which the caller renders honestly as
 * "former member" or as the reference itself rather than as unassigned.
 */
export function findOrgMember<T extends { uid: string; email?: string | null }>(
  members: readonly T[],
  ref: string | null | undefined,
): T | undefined {
  const parsed = parseCrmMemberRef(ref)
  if (!parsed) return undefined
  if (parsed.kind === 'uid') {
    return members.find((member) => member.uid === parsed.uid)
  }
  return members.find(
    (member) => normalizeContactEmail(member.email) === parsed.email,
  )
}

/*==========================================
 * LEADS (AGL-2608).
 *
 * A lead is NOT one of the six collections above. It lives at
 * `hosts/{hostId}/leads/{personKey}`, written by `addHostLead` when a
 * visitor signs up, books or submits a form, and it is host-scoped by PATH:
 * no `visibleTo`, no facet map, private to the site that captured it. What
 * the CRM adds is the working state a sales team keeps on such a capture —
 * a status, an owner, notes — and the record of its conversion into the
 * contact, company and deal that live in the org collections.
 *
 * These fields are typed here rather than beside `addHostLead` because the
 * writer of the capture and the reader of the working state are different
 * programs: the capture door stamps none of them, and a lead that predates
 * this block carries none of them, which is why every field is optional and
 * {@link crmLeadStatus} reads an absent status as `new`.
 *=========================================*/

/**
 * Where a lead stands, in the order a person works one.
 *
 * `qualified` is the CONVERTED state — a lead becomes a contact by being
 * qualified, and the conversion stamps `convertedContactId` beside it — and
 * `unqualified` is the closed-without-conversion state with its reason. A
 * fixed list rather than free text for the reason the lifecycle stages are:
 * the section filters on it and a report counts by it.
 */
export const CRM_LEAD_STATUSES = [
  'new',
  'working',
  'qualified',
  'unqualified',
] as const

export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number]

/** How a lead status reads on screen — typed so a status cannot ship unlabeled. */
export const CRM_LEAD_STATUS_LABELS: Record<CrmLeadStatus, string> = {
  new: 'New',
  working: 'Working',
  qualified: 'Qualified',
  unqualified: 'Unqualified',
}

/**
 * The statuses a lead still needs somebody's attention in — what the Leads
 * section shows by default, so the list opens on the work rather than on
 * the history.
 */
export const CRM_LEAD_OPEN_STATUSES: readonly CrmLeadStatus[] = ['new', 'working']

/**
 * The statuses that mean nobody needs to work the lead any more — the
 * operand of the `in` clause an open-lead figure subtracts with. Subtracts,
 * because an untouched lead carries no status field at all and Firestore
 * cannot select on a field's absence; the closed statuses are always
 * written, so they can be counted, and what remains is open. See
 * `openLeadsFromCounts`.
 */
export const CRM_LEAD_CLOSED_STATUSES: readonly CrmLeadStatus[] =
  CRM_LEAD_STATUSES.filter((status) => !CRM_LEAD_OPEN_STATUSES.includes(status))

export function isCrmLeadStatus(value: unknown): value is CrmLeadStatus {
  return (
    typeof value === 'string' &&
    (CRM_LEAD_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * The working state the CRM writes onto a lead document, beside what the
 * capture door wrote (`email`, `name`, `sources`, `submissionCount`,
 * `firstSeenAtMs`, `lastSeenAtMs`, the consent map).
 *
 * The four `converted*`/`dealId`/`companyId` fields are stamped ONLY by the
 * `crm/lead-convert` server route, in one write after the contact exists, so
 * a lead that carries `convertedContactId` names a contact that was really
 * created and a lead without it was never converted, whatever its status
 * says. `unqualifiedReason` travels with `status: 'unqualified'` and is the
 * one free-text field a report will want to read back.
 */
export interface CrmLeadFields {
  status?: CrmLeadStatus
  /** The team member working the lead. */
  ownerUid?: string
  notes?: string
  unqualifiedReason?: string
  /** `orgs/{orgId}/contacts/{contactId}` — the person this lead became. */
  convertedContactId?: string
  convertedAtMs?: number
  /** The deal the conversion opened, when the converter asked for one. */
  dealId?: string
  /** The company the conversion created or linked, when it named one. */
  companyId?: string
}

/**
 * A lead's status as the list and the filter should read it.
 *
 * `new` for a lead that carries no status at all — every lead captured
 * before the CRM existed, and every lead the capture door writes today,
 * because `addHostLead` stamps none. Reading the absence as `new` is what
 * lets the section open on the leads a site already holds rather than on an
 * empty list until each one has been touched once. A stored value the union
 * does not name also reads as `new`: it is a document some other writer
 * produced, and refusing to list it would hide a person.
 */
export function crmLeadStatus(
  lead: Pick<CrmLeadFields, 'status'> | null | undefined,
): CrmLeadStatus {
  const status = lead?.status
  return isCrmLeadStatus(status) ? status : 'new'
}

/** Whether a lead still needs working — see {@link CRM_LEAD_OPEN_STATUSES}. */
export function isCrmLeadOpen(
  lead: Pick<CrmLeadFields, 'status'> | null | undefined,
): boolean {
  return CRM_LEAD_OPEN_STATUSES.includes(crmLeadStatus(lead))
}

/*==========================================
 * SAVED VIEWS (AGL-2617) — a list the way one person works it.
 *
 * "My open leads in Texas" is a list a rep opens every morning, and it is
 * three things at once: the filters that pick the people, the columns they
 * want to see about them, and the order they want them in. A `ContactSegment`
 * kept the first of those for two dimensions — tags and capture sources —
 * and nothing kept the rest, so every reload put the reader back at the
 * whole list. A view keeps all three, for every list in the CRM, under a
 * name, and is addressable: `?view=<id>` on the section's own URL opens it.
 *
 * ## The filters are the LIST'S grammar, not a second one
 *
 * A clause here is `{ field, op, value }` — structurally the
 * `ListFilterRequest` the shared list-filter grammar already speaks, the
 * request a grid's filter panel produces and the one the query translator
 * and the in-memory matcher both read. A view stores a list of them and
 * nothing more, so a view can only ask what the list can already answer,
 * and a list that gains a filterable field gains it for its views at no
 * cost. The type is restated here rather than imported because this module
 * is pure data and the grammar's home is a UI library; the shape is the
 * contract, and `normalizeCrmViewFilters` is what holds a stored document
 * to it.
 *
 * ## Mine, and shared
 *
 * A view is one person's working arrangement until they say otherwise, so
 * it lists only for its owner; `shared` puts it in front of everyone who
 * can read the section. Both are stamped `visibleTo` like every CRM row,
 * because a view is a description of the people it selects and answers to
 * the same authority they do — a private view is hidden by the LISTING, not
 * by the rules, and the rules let the creator or an org-wide member change
 * or remove it.
 *
 * ## The default is the reader's, not the view's
 *
 * Which view a section opens on is a preference of one person for one
 * organization, so it lives on the reader's own profile document beside
 * their notification mutes rather than on the view — a shared view somebody
 * else made their default must not become everybody's.
 *=========================================*/

/** The lists a view can be saved for — every CRM section that has one. */
export const CRM_VIEW_SECTIONS = [
  'contacts',
  'companies',
  'deals',
  'tasks',
  'leads',
] as const

export type CrmViewSection = (typeof CRM_VIEW_SECTIONS)[number]

export function isCrmViewSection(value: unknown): value is CrmViewSection {
  return (
    typeof value === 'string' &&
    (CRM_VIEW_SECTIONS as readonly string[]).includes(value)
  )
}

/**
 * One filter a view carries: a field, an operator and a value, exactly as a
 * list's own filter panel would send them to its query.
 *
 * `label` is the human reading of an OPAQUE value — a team member's name
 * beside their uid, a company's name beside its id — kept on the clause so
 * the chip that shows it can say "Owner is Dana" without a read. Display
 * only: nothing matches on it, and a clause without one shows its value.
 */
export interface CrmViewFilterClause {
  field: string
  op: string
  value: string
  label?: string
}

/** The column a view orders by, and which way. */
export interface CrmViewSort {
  field: string
  direction: 'asc' | 'desc'
}

/**
 * What a view holds about a list — the part a section reads and writes,
 * without the name and the ownership around it.
 *
 * `columns` is the VISIBLE set, by column field, or empty for the list's
 * own default; `sort` is one column or none, because a table sorts by one.
 */
export interface CrmViewState {
  filters: CrmViewFilterClause[]
  columns: string[]
  sort: CrmViewSort | null
}

/** `orgs/{orgId}/crmViews/{viewId}`. */
export interface CrmSavedView extends CrmScoped, CrmViewState {
  section: CrmViewSection
  name: string
  /** Whose working arrangement this is — the creator, and the one member the rules let change it. */
  ownerUid: string
  createdByUid: string
  /** Listed for everybody who can read the section, rather than the owner alone. */
  shared: boolean
}

export const CRM_VIEW_NAME_MAX = 60
/**
 * The most clauses one view carries. A bound on the predicate, not the
 * audience: the list matches most of them in memory over a bounded window,
 * and a stored array has no natural end.
 */
export const CRM_VIEW_MAX_FILTERS = 20
export const CRM_VIEW_MAX_COLUMNS = 60
/** Filter operators that carry no value, so an empty `value` is not a dropped clause. */
const VALUELESS_VIEW_OPS: ReadonlySet<string> = new Set(['isEmpty', 'isNotEmpty'])

export const EMPTY_CRM_VIEW_STATE: CrmViewState = Object.freeze({
  filters: [],
  columns: [],
  sort: null,
}) as CrmViewState

const asViewText = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/**
 * A stored view's filters, held to the clause shape.
 *
 * Strict about what it keeps: a clause with no field or no operator is not
 * a filter, and a valued operator with no value would read as a filter
 * that matches nothing — so both are dropped rather than kept, for the same
 * reason the dynamic-list rule drops an empty branch: a view must not
 * quietly select a different population than the one it reads as.
 */
export function normalizeCrmViewFilters(value: unknown): CrmViewFilterClause[] {
  if (!Array.isArray(value)) return []
  const clauses: CrmViewFilterClause[] = []
  for (const raw of value) {
    const entry = (raw ?? {}) as Record<string, unknown>
    const field = asViewText(entry['field'], 80)
    const op = asViewText(entry['op'], 40)
    const text = asViewText(entry['value'], 500)
    if (!field || !op) continue
    if (!text && !VALUELESS_VIEW_OPS.has(op)) continue
    const label = asViewText(entry['label'], 120)
    clauses.push({ field, op, value: text, ...(label ? { label } : {}) })
    if (clauses.length >= CRM_VIEW_MAX_FILTERS) break
  }
  return clauses
}

export function normalizeCrmViewColumns(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const raw of value) {
    const column = asViewText(raw, 80)
    if (column) seen.add(column)
    if (seen.size >= CRM_VIEW_MAX_COLUMNS) break
  }
  return [...seen]
}

export function normalizeCrmViewSort(value: unknown): CrmViewSort | null {
  const entry = (value ?? null) as Record<string, unknown> | null
  const field = entry ? asViewText(entry['field'], 80) : ''
  if (!field) return null
  return { field, direction: entry?.['direction'] === 'desc' ? 'desc' : 'asc' }
}

/** A stored document's three list-facing fields, held to their shapes. */
export function normalizeCrmViewState(value: unknown): CrmViewState {
  const entry = (value ?? {}) as Record<string, unknown>
  return {
    filters: normalizeCrmViewFilters(entry['filters']),
    columns: normalizeCrmViewColumns(entry['columns']),
    sort: normalizeCrmViewSort(entry['sort']),
  }
}

/**
 * Whether two states describe the same list — what "unsaved changes" means.
 *
 * Clause order matters (a list applies them in order, and the first one the
 * query can serve is the one it serves); the label on a clause does not,
 * because nothing matches on it.
 */
export function crmViewStateEquals(a: CrmViewState, b: CrmViewState): boolean {
  if (a.filters.length !== b.filters.length) return false
  for (let index = 0; index < a.filters.length; index += 1) {
    const left = a.filters[index]
    const right = b.filters[index]
    if (
      left.field !== right.field ||
      left.op !== right.op ||
      left.value !== right.value
    ) {
      return false
    }
  }
  if (a.columns.length !== b.columns.length) return false
  if (a.columns.some((column, index) => column !== b.columns[index])) {
    return false
  }
  if (!a.sort || !b.sort) return a.sort === b.sort
  return a.sort.field === b.sort.field && a.sort.direction === b.sort.direction
}

/**
 * Whether a view belongs in this reader's menu: their own, or one somebody
 * shared. The rules admit the read either way — see the module note — so
 * this is what keeps one person's private arrangement out of another's
 * list.
 */
export function crmViewIsListed(
  view: Pick<CrmSavedView, 'shared' | 'ownerUid'>,
  uid: string | null | undefined,
): boolean {
  return view.shared === true || (Boolean(uid) && view.ownerUid === uid)
}

/**
 * The Contacts list's filterable fields, by the names a view clause carries.
 *
 * A contract between three readers that cannot import one another: the
 * list's own filter grammar (which declares these as its columns), a saved
 * view (which stores them), and the dynamic-list translator below in
 * `dynamic-list-rule.ts` (which turns them into audience dimensions). Named
 * once so a rename on the list cannot silently stop an audience matching.
 * `custom` is a PREFIX: a custom field's column is the prefix and its key.
 */
export const CRM_CONTACT_VIEW_FIELDS = {
  tags: 'tags',
  source: 'source',
  owner: 'ownerUid',
  stage: 'lifecycleStage',
  company: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  orders: 'ordersCount',
  ltv: 'ltvCents',
  custom: 'custom_',
} as const

/** The column a custom contact field filters and shows as. */
export const crmContactCustomColumn = (key: string): string =>
  `${CRM_CONTACT_VIEW_FIELDS.custom}${key}`

/** The field key a custom column stands for, or `null` for any other column. */
export function crmContactCustomKey(column: string): string | null {
  const prefix = CRM_CONTACT_VIEW_FIELDS.custom
  return column.startsWith(prefix) && column.length > prefix.length
    ? column.slice(prefix.length)
    : null
}

const CRM_VIEW_TAGS_FIELD = CRM_CONTACT_VIEW_FIELDS.tags
const CRM_VIEW_SOURCE_FIELD = CRM_CONTACT_VIEW_FIELDS.source

/**
 * A saved segment, as the filters of a contacts view.
 *
 * A segment is "any of these tags AND any of these sources", so each
 * becomes one `isAnyOf` clause — OR within, AND across, which is the
 * reading `contactMatchesSegment` gives it. A single tag is emitted as
 * `contains` instead: that operator is the one the contacts query can serve
 * from the index, so a one-tag segment opened as a view reaches the whole
 * collection rather than the loaded window. The values are the segment's
 * own, joined the way the grammar's `isAnyOf` splits them.
 */
export function crmViewFiltersFromSegment(
  segment: Pick<ContactSegment, 'tags' | 'sources'>,
): CrmViewFilterClause[] {
  const tags = (segment.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  const sources = (segment.sources ?? []).filter(
    (source) => source in CONTACT_SOURCE_LABELS,
  )
  return [
    ...(tags.length === 1
      ? [{ field: CRM_VIEW_TAGS_FIELD, op: 'contains', value: tags[0] }]
      : tags.length
        ? [{ field: CRM_VIEW_TAGS_FIELD, op: 'isAnyOf', value: tags.join(',') }]
        : []),
    ...(sources.length === 1
      ? [{ field: CRM_VIEW_SOURCE_FIELD, op: 'equals', value: sources[0] }]
      : sources.length
        ? [
            {
              field: CRM_VIEW_SOURCE_FIELD,
              op: 'isAnyOf',
              value: sources.join(','),
            },
          ]
        : []),
  ]
}

/**
 * The other direction: the segment a view's filters describe, or `null`
 * when the view carries no tag or source clause a segment could hold.
 *
 * Only the two dimensions a segment has are read, and only through the
 * operators that mean "has one of these"; a `name startsWith` or an owner
 * clause is not a segment's to keep. What comes back is what "Save as
 * segment" writes, so a campaign audience built from it selects exactly the
 * tags and sources the reader could see on the chips.
 */
export function crmViewSegmentFilters(
  filters: readonly CrmViewFilterClause[],
): Pick<ContactSegment, 'tags' | 'sources'> | null {
  const tags = new Set<string>()
  const sources = new Set<ContactSource>()
  const split = (value: string) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  for (const clause of filters) {
    if (clause.field === CRM_VIEW_TAGS_FIELD) {
      if (clause.op === 'contains') tags.add(clause.value.trim().toLowerCase())
      else if (clause.op === 'isAnyOf') {
        for (const tag of split(clause.value)) tags.add(tag.toLowerCase())
      }
    } else if (clause.field === CRM_VIEW_SOURCE_FIELD) {
      const values = clause.op === 'equals' ? [clause.value.trim()] : clause.op === 'isAnyOf' ? split(clause.value) : []
      for (const source of values) {
        if (source in CONTACT_SOURCE_LABELS) sources.add(source as ContactSource)
      }
    }
  }
  tags.delete('')
  if (!tags.size && !sources.size) return null
  return {
    ...(tags.size ? { tags: [...tags] } : {}),
    ...(sources.size ? { sources: [...sources] } : {}),
  }
}

/**
 * `users/{uid}.crmDefaultViews` — `{ [orgId]: { [section]: viewId } }`.
 *
 * On the reader's own profile document, beside `notificationPrefs`, because
 * it is the same kind of fact: how one person wants their console to
 * behave, owned and written by them alone. Keyed by org first because one
 * account sits on several organizations and a view id is only meaningful
 * inside the one that holds it.
 */
export const CRM_DEFAULT_VIEWS_FIELD = 'crmDefaultViews'

/** The view a section opens on for this reader in this org, or none. */
export function crmDefaultViewId(
  profile: Record<string, unknown> | null | undefined,
  orgId: string | null | undefined,
  section: CrmViewSection,
): string | null {
  if (!profile || !orgId) return null
  const byOrg = profile[CRM_DEFAULT_VIEWS_FIELD]
  if (!byOrg || typeof byOrg !== 'object' || Array.isArray(byOrg)) return null
  const bySection = (byOrg as Record<string, unknown>)[orgId]
  if (!bySection || typeof bySection !== 'object' || Array.isArray(bySection)) {
    return null
  }
  const viewId = (bySection as Record<string, unknown>)[section]
  return typeof viewId === 'string' && viewId.trim() ? viewId : null
}

/**
 * The merge patch that sets — or, with `null`, clears — one default.
 *
 * Shaped for a merged write so the other organizations' and sections'
 * defaults on the same document survive it; `null` rather than a delete
 * sentinel because this module carries no Firestore, and the reader above
 * treats a null as no default.
 */
export function crmDefaultViewPatch(
  orgId: string,
  section: CrmViewSection,
  viewId: string | null,
): Record<string, unknown> {
  return { [CRM_DEFAULT_VIEWS_FIELD]: { [orgId]: { [section]: viewId } } }
}
