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
  type ContactSource,
  normalizeContactEmail,
  readContactFacet,
} from './contacts'
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
): { field: 'contactId' | 'companyId' | 'dealId'; id: string } | null {
  if (link.contactId) return { field: 'contactId', id: String(link.contactId) }
  if (link.companyId) return { field: 'companyId', id: String(link.companyId) }
  if (link.dealId) return { field: 'dealId', id: String(link.dealId) }
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
  outcome?: string
  durationMinutes?: number
}

/** An activity as a listener hands it back: the document plus its id. */
export type CrmActivityRow = CrmActivity & { $id: string }

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
  activity: Pick<CrmActivity, 'contactId' | 'companyId' | 'dealId'>,
): { record: 'contact' | 'deal' | 'company'; id: string } | null {
  if (activity.contactId) return { record: 'contact', id: activity.contactId }
  if (activity.dealId) return { record: 'deal', id: activity.dealId }
  if (activity.companyId) return { record: 'company', id: activity.companyId }
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
 * The field-path SEGMENTS of a site's default owner on the org document.
 *
 * Segments rather than a dotted string, because the host id is a document
 * id and a document id may contain a dot; joined with dots it would be read
 * as two path elements and the write would land beside the setting rather
 * than in it. A caller builds a `FieldPath` from these on either SDK.
 */
export function crmHostDefaultOwnerSegments(hostId: string): string[] {
  if (!hostId) throw new Error('a site default owner must name a site')
  return [ORG_CRM_SETTINGS_FIELD, 'hosts', hostId, 'defaultOwnerUid']
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
  const hosts =
    crm['hosts'] && typeof crm['hosts'] === 'object' && !Array.isArray(crm['hosts'])
      ? (crm['hosts'] as Record<string, unknown>)
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
