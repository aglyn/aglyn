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

import type { AglynPostalAddress } from '../foundation'
import { type ConsentGroup, consentGroupScope } from './consent-groups'
import type { ContactInteraction } from './contacts'
import { MAX_SCOPE_HOSTS, ORG_SCOPE_TOKEN, type ScopeToken } from './scope-tokens'

/**
 * The CRM's collections, every one under `orgs/{orgId}/`.
 *
 * Named here rather than spelled at each call site because the rules, the
 * indexes and the console must agree on the string, and the two prefixed
 * ones are prefixed on purpose: `tasks` and `activities` are words the org
 * document will want for something else one day, and a collection name is
 * persisted in every document path that uses it.
 */
export const CRM_COLLECTIONS = {
  companies: 'companies',
  pipelines: 'pipelines',
  deals: 'deals',
  tasks: 'crmTasks',
  activities: 'crmActivities',
  contactFields: 'contactFields',
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
 * The stage a person is in once they have BOUGHT something (AGL-2596).
 *
 * `customer` when they had no stage or an earlier one; whatever they already
 * had otherwise. The order door asks this on every purchase, and "never
 * downgrades" is the whole contract: an `evangelist` who buys again is still
 * an evangelist, and `other` — the deliberate stage a business picked for a
 * funnel step none of the names fit — sits after `customer` in the list
 * precisely so a sale cannot overwrite it. A value that is not a stage at all
 * reads as absent, because a checkout is not the place to preserve a typo.
 */
export function contactLifecycleStageAfterPurchase(
  current: unknown,
): ContactLifecycleStage {
  if (!isContactLifecycleStage(current)) return 'customer'
  const order: readonly string[] = CONTACT_LIFECYCLE_STAGES
  return order.indexOf(current) < order.indexOf('customer')
    ? 'customer'
    : current
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
  createdByUid?: string
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
  amountCents?: number
  /** Lowercase ISO 4217; `'usd'` when absent. */
  currency?: string
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
 * One entry of a contact's timeline (AGL-2600): something the platform
 * CAPTURED on the contact's facet, or something a person LOGGED beside it.
 *
 * A tagged union rather than a flattened row, because the two are different
 * facts with different affordances — a captured interaction is read-only and
 * names the door it came through, a logged activity has an author who may
 * edit it — and a surface drawing the stream has to say which is which.
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
 * its document id.
 */
export function mergeContactTimeline(
  interactions: readonly ContactInteraction[] | null | undefined,
  activities: readonly CrmActivityRow[] | null | undefined,
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
