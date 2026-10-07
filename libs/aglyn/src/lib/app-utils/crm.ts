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

import {
  type AglynPostalAddress,
  normalizeAddress,
  normalizePhone,
  type OrgCrmAssignmentRule,
} from '../foundation'
import { type ConsentGroup, consentGroupScope } from './consent-groups'
import {
  CONTACT_LIFECYCLE_STAGES,
  type ContactLifecycleStage,
  type CrmActivityKind,
  CRM_TASK_KINDS,
  type CrmTaskKind,
  isContactLifecycleStage,
} from './crm-kinds'
import {
  CONTACT_ALTERNATE_EMAILS_FIELD,
  CONTACT_FACETS_FIELD,
  CONTACT_SOURCE_LABELS,
  type ContactInteraction,
  type ContactSegment,
  type ContactSource,
  composeContactName,
  normalizeContactEmail,
  readContactFacet,
} from './contacts'
import { type EmailState, isEmailStateStatus } from './email-state'
import {
  NAME_TOKEN_MAX_PREFIX,
  nameSearchKey,
  nameSearchTokens,
  SCOPED_SEARCH_JOIN,
  scopedSearchTokens,
} from './name-search'
import {
  effectivePicklistValueSet,
  isStandardPicklistValueId,
  judgePicklistValue,
  mintPicklistValueId,
  normalizePicklistLabel,
  normalizePicklistValueSet,
  PICKLIST_VALUES_MAX,
  picklistActiveValues,
  picklistDefaultLabel,
  picklistFromLabels,
  type PicklistJudgement,
  picklistOptions,
  type PicklistOption,
  picklistRank,
  picklistRefusalSentence,
  type PicklistSpec,
  type PicklistValue,
  picklistValueByLabel,
  type PicklistValueSet,
} from './picklists'
import { MAX_SCOPE_HOSTS, ORG_SCOPE_TOKEN, type ScopeToken } from './scope-tokens'

// The fixed vocabularies and their guards live in a leaf module; every name
// stays importable from here.
export * from './crm-kinds'

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
  emailTemplates: 'crmEmailTemplates',
  /** An org's value sets for its standard picklist fields (AGL-3298). */
  picklists: 'crmPicklists',
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
 * same wherever the refusal lands: a band refuses only on a plan that puts
 * no overage rate past it, so "upgrade" is the whole of the answer.
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
 * The same scalar, under the name the other objects use (AGL-2661).
 *
 * A company's and a deal's `custom` map hold exactly what a contact's
 * does — one definition, one coercion rule, one stored shape — so the
 * value type is one type with two names: the contact name it was born
 * with, and this one for code that is not about contacts.
 */
export type CrmCustomValue = ContactCustomValue

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
  /** The billing address — Salesforce's Billing Address, under its original name. */
  address?: AglynPostalAddress | null
  /**
   * Salesforce's Industry: a label of the `industry` picklist (AGL-3514).
   * A record written while it was free text keeps its text.
   */
  industry?: string
  ownerUid?: string
  notes?: string
  /*
   * SALESFORCE'S ACCOUNT FIELDS (AGL-3514) — see the company account block.
   * The picklist fields hold the value's LABEL, with the list's key beside
   * the ones the Companies list filters by.
   */
  /** Account Type: a label of the `accountType` picklist. */
  type?: string | null
  /** Rating: a label of the `rating` picklist. */
  rating?: string | null
  /** Ownership: a label of the `ownership` picklist. */
  ownership?: string | null
  /** Account Source: a label of the `leadSource` picklist. */
  accountSource?: string | null
  /** Annual revenue in the minor unit of {@link CrmCompany.currency}. */
  annualRevenueCents?: number | null
  /** Lowercase ISO 4217, the deals' convention; `'usd'` when absent. */
  currency?: string
  numberOfEmployees?: number | null
  /** E.164 — `normalizePhone`, like `phone`. */
  fax?: string | null
  accountNumber?: string | null
  /** Salesforce's Account Site: which of the company's locations this record is. */
  site?: string | null
  tickerSymbol?: string | null
  sicCode?: string | null
  shippingAddress?: AglynPostalAddress | null
  /** Another company of the same scope this one sits under; never itself or a descendant. */
  parentCompanyId?: string | null
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
  /**
   * Custom field values, keyed by the key of a definition whose `object`
   * is `company` — see {@link fieldDefinitionObject} (AGL-2661).
   */
  custom?: Record<string, CrmCustomValue>
  /**
   * When the earliest OPEN task filed against this company is due, epoch
   * ms, or `null` when none is — see {@link CrmDeal.nextTaskAtMs}.
   */
  nextTaskAtMs?: number | null
  /** Org-library files attached to the company (AGL-2662) — see {@link CRM_MEDIA_IDS_MAX}. */
  mediaIds?: string[]
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
  /**
   * The forecast category a deal takes on landing here (AGL-3516) — see
   * {@link CrmForecastCategory}. Absent on a stage written before the field
   * existed, which reads as its kind's: Closed for won, Omitted for lost,
   * Pipeline for open ({@link dealStageForecastCategory}).
   */
  forecastCategory?: CrmForecastCategory
}

/*==========================================
 * FORECAST CATEGORIES (AGL-3516).
 *
 * Salesforce's Opportunity forecast categories, a FIXED set — not a
 * picklist an org edits, as in Salesforce, because a forecast rolls up by
 * them and a renamed or added category would be one no forecast knows. A
 * stage names the category a deal takes on landing in it; the deal stores
 * its own copy, stamped at every stage move, which the deal page may then
 * change for that deal alone.
 *=========================================*/

export const CRM_FORECAST_CATEGORIES = [
  'omitted',
  'pipeline',
  'bestCase',
  'commit',
  'closed',
] as const

export type CrmForecastCategory = (typeof CRM_FORECAST_CATEGORIES)[number]

export const CRM_FORECAST_CATEGORY_LABELS: Record<CrmForecastCategory, string> = {
  omitted: 'Omitted',
  pipeline: 'Pipeline',
  bestCase: 'Best Case',
  commit: 'Commit',
  closed: 'Closed',
}

export function isCrmForecastCategory(value: unknown): value is CrmForecastCategory {
  return typeof value === 'string' && (CRM_FORECAST_CATEGORIES as readonly string[]).includes(value)
}

/**
 * A category as typed — the stored key or its label in any case and
 * spacing ("Best Case", "best case", `bestCase`) — or `null`.
 */
export function readCrmForecastCategory(value: unknown): CrmForecastCategory | null {
  if (isCrmForecastCategory(value)) return value
  const key = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
  if (!key) return null
  return (
    CRM_FORECAST_CATEGORIES.find(
      (category) =>
        category.toLowerCase() === key ||
        CRM_FORECAST_CATEGORY_LABELS[category].toLowerCase() === key,
    ) ?? null
  )
}

/** The category a stage stamps: its own, else its kind's. */
export function dealStageForecastCategory(
  stage: Pick<CrmDealStage, 'kind' | 'forecastCategory'>,
): CrmForecastCategory {
  if (isCrmForecastCategory(stage.forecastCategory)) return stage.forecastCategory
  return stage.kind === 'won' ? 'closed' : stage.kind === 'lost' ? 'omitted' : 'pipeline'
}

/**
 * A deal's forecast category as every reader takes it: the deal's own,
 * else its stage's, else its status's — a deal written before the field
 * existed forecasts where its stage puts it.
 */
export function dealForecastCategory(
  deal: Partial<Pick<CrmDeal, 'forecastCategory' | 'status'>>,
  stage: Pick<CrmDealStage, 'kind' | 'forecastCategory'> | null | undefined,
): CrmForecastCategory {
  if (isCrmForecastCategory(deal.forecastCategory)) return deal.forecastCategory
  if (stage) return dealStageForecastCategory(stage)
  return deal.status === 'won' ? 'closed' : deal.status === 'lost' ? 'omitted' : 'pipeline'
}

/** The longest Next step a deal keeps — Salesforce's own 255. */
export const DEAL_NEXT_STEP_MAX = 255

/**
 * A probability override as stored: a whole number 0–100, or `null` for
 * none (the stage's applies). Anything that is not a number in range is
 * `undefined` — unreadable, for the writer to refuse.
 */
export function readDealProbability(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = typeof value === 'number' ? value : Number(String(value).trim().replace(/%$/, ''))
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0 || number > 100) {
    return undefined
  }
  return number
}

/**
 * A deal's probability: its own override when it holds one, else its
 * stage's, else `null` for a stage the pipeline no longer has.
 */
export function dealProbability(
  deal: Partial<Pick<CrmDeal, 'probability'>>,
  stage: Pick<CrmDealStage, 'probability'> | null | undefined,
): number | null {
  const own = readDealProbability(deal.probability)
  if (typeof own === 'number') return own
  if (!stage) return null
  return Math.min(100, Math.max(0, Number(stage.probability) || 0))
}

/**
 * What a stage move writes besides the stage, the status and the clocks:
 * the new stage's forecast category, and the probability override CLEARED
 * — Salesforce re-defaults a probability when the stage changes, so an
 * override typed for the last stage does not follow the deal into the next.
 * A write that sets either field itself, in the same request, wins.
 */
export function dealStageMoveFields(
  stage: Pick<CrmDealStage, 'kind' | 'forecastCategory'>,
): { forecastCategory: CrmForecastCategory; probability: null } {
  return { forecastCategory: dealStageForecastCategory(stage), probability: null }
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
 * The stages a fresh pipeline starts with: Salesforce's standard
 * Opportunity stages, with its probabilities and forecast categories
 * (AGL-3516). A pipeline seeded before them keeps the stages it was seeded
 * with — nothing migrates a stored pipeline.
 *
 * The closing stages keep the ids `won` and `lost` every pipeline has had,
 * so an automation filter naming them reads the same on old pipelines and
 * new ones.
 *
 * Readonly on purpose: a pipeline document stores its own COPY (`[...]`), so
 * a merchant editing their stages must not be editing the module's default,
 * and a second pipeline seeded later must start from the original set.
 */
export const DEFAULT_DEAL_STAGES: readonly CrmDealStage[] = [
  { id: 'prospecting', name: 'Prospecting', order: 0, probability: 10, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'qualification', name: 'Qualification', order: 1, probability: 10, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'needs-analysis', name: 'Needs Analysis', order: 2, probability: 20, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'value-proposition', name: 'Value Proposition', order: 3, probability: 50, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'id-decision-makers', name: 'Id. Decision Makers', order: 4, probability: 60, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'perception-analysis', name: 'Perception Analysis', order: 5, probability: 70, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'proposal-price-quote', name: 'Proposal/Price Quote', order: 6, probability: 75, kind: 'open', forecastCategory: 'bestCase' },
  { id: 'negotiation-review', name: 'Negotiation/Review', order: 7, probability: 90, kind: 'open', forecastCategory: 'commit' },
  { id: 'won', name: 'Closed Won', order: 8, probability: 100, kind: 'won', forecastCategory: 'closed' },
  { id: 'lost', name: 'Closed Lost', order: 9, probability: 0, kind: 'lost', forecastCategory: 'omitted' },
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

/**
 * `orgs/{orgId}/deals/{dealId}`.
 *
 * A WON DEAL MAKES ITS CONTACT A CUSTOMER (AGL-2641). A win is the same
 * fact as a purchase — the business has decided this person bought — and an
 * order already floors a contact's lifecycle stage at `customer` on
 * capture. So every writer of `status` — the console's stage route at both
 * levels and the REST resource — applies the same floor to the contact
 * `contactId` names on the transition into `won`, in the facet of the site
 * the deal was made on (`hostId`), with `advanceContactLifecycleStage`'s
 * rule: an empty stage is filled, an earlier one advanced, and nobody is
 * ever moved back. Behind no setting, because a won deal is a customer by
 * definition; an automation on `dealWon` is for what happens NEXT.
 */
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
  /*
   * SALESFORCE'S OPPORTUNITY FIELDS (AGL-3516).
   */
  /**
   * Salesforce's Type — the LABEL of one of the org's `opportunityType`
   * values (New Business, Existing Business, …); `typeKey` beside it is
   * what the Deals list filters by.
   */
  type?: string
  /**
   * Salesforce's Lead Source — the LABEL of one of the org's `leadSource`
   * values, the picklist a lead's own lead source is; stamped from the
   * lead a conversion opens the deal for. `leadSourceKey` beside it.
   */
  leadSource?: string
  /** What happens next, at most {@link DEAL_NEXT_STEP_MAX} characters. */
  nextStep?: string
  /**
   * This deal's own chance of closing, a whole number 0–100, overriding
   * its stage's; `null` or absent means the stage's applies. Cleared by
   * every stage move ({@link dealStageMoveFields}).
   */
  probability?: number | null
  /**
   * Where the deal is forecast — stamped from the stage at every stage move
   * and changeable for this deal afterwards. See {@link dealForecastCategory}.
   */
  forecastCategory?: CrmForecastCategory
  /**
   * Salesforce's Primary Campaign Source: ONE of the org's campaigns (the
   * Marketing plugin's containers, which a lead's `campaignIds` name).
   */
  campaignId?: string
  /**
   * Salesforce's Opportunity Contact Roles (AGL-3521): the people on the
   * deal and the part each plays, at most one of them Primary — the one
   * `contactId` names. See {@link dealContactRolesOf}.
   */
  contactRoles?: CrmDealContactRole[]
  /**
   * Custom field values, keyed by the key of a definition whose `object`
   * is `deal` — see {@link fieldDefinitionObject} (AGL-2661).
   */
  custom?: Record<string, CrmCustomValue>
  /**
   * When the earliest OPEN task filed against this deal is due, epoch ms,
   * or `null` when no open task names it (AGL-2661).
   *
   * DENORMALIZED from `crmTasks`, because the question "which deals have
   * nothing scheduled" is asked of a LIST — a column, a filter, a report
   * tile — and a list cannot afford a task query per row. Every server
   * writer of a task recomputes it for the records the task names
   * (`recomputeCrmNextTaskAt` in the CRM's server), and a client-direct
   * task write asks the console route to do the same; the Fields section
   * offers a one-off recompute for the records written before the field
   * existed. Absent on such a record, which every reader treats as `null`.
   */
  nextTaskAtMs?: number | null
  /** Org-library files attached to the deal (AGL-2662) — see {@link CRM_MEDIA_IDS_MAX}. */
  mediaIds?: string[]
}

/*------------------------------------------
 * OPPORTUNITY CONTACT ROLES (AGL-3521).
 *
 * A deal names any number of contacts, each with the part they play — a
 * label of the org's `opportunityContactRole` picklist, or none — and at
 * most one of them Primary. The Primary is `contactId`, which every reader
 * that existed before roles keeps reading: the won-deal customer floor, the
 * send-email button, the CSV's Contact column, the REST filter. So the two
 * are written together by every door — setting a Primary sets `contactId`,
 * and a door that sets `contactId` the old way makes that contact Primary,
 * adding them without a role when the deal did not name them.
 *
 * A deal written before roles holds `contactId` alone, which reads as one
 * Primary row with no role; its first write through any door stores it.
 * Where the two disagree — a write from a door that knows only
 * `contactId` — `contactId` wins, because it is what every older reader
 * already acted on.
 *-----------------------------------------*/

/** The most contacts one deal names — a buying committee, not a mailing list. */
export const DEAL_CONTACT_ROLES_MAX = 50

/** One contact on a deal. */
export interface CrmDealContactRole {
  contactId: string
  /** The `opportunityContactRole` label, absent for a contact with no role yet. */
  role?: string
  primary: boolean
}

/**
 * Stored or sent roles, read defensively: a row without a usable contact
 * id is dropped, a contact named twice keeps its first row, only the first
 * Primary stays Primary, and the list stops at {@link DEAL_CONTACT_ROLES_MAX}.
 */
export function readDealContactRoles(raw: unknown): CrmDealContactRole[] {
  if (!Array.isArray(raw)) return []
  const roles: CrmDealContactRole[] = []
  const seen = new Set<string>()
  let primaryTaken = false
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const contactId = typeof row['contactId'] === 'string' ? row['contactId'].trim() : ''
    if (!contactId || contactId.length > 200 || contactId.includes('/') || seen.has(contactId)) {
      continue
    }
    seen.add(contactId)
    const role = typeof row['role'] === 'string' ? normalizePicklistLabel(row['role']) : ''
    const primary = row['primary'] === true && !primaryTaken
    if (primary) primaryTaken = true
    roles.push({ contactId, ...(role ? { role } : {}), primary })
    if (roles.length >= DEAL_CONTACT_ROLES_MAX) break
  }
  return roles
}

/**
 * `roles` with `contactId` as the one Primary — added first, with no role,
 * when the list does not name them — or, for `null`, with no Primary.
 */
export function dealContactRolesWithPrimary(
  roles: readonly CrmDealContactRole[],
  contactId: string | null | undefined,
): CrmDealContactRole[] {
  const id = typeof contactId === 'string' ? contactId.trim() : ''
  const next = roles.map((row) => ({ ...row, primary: Boolean(id) && row.contactId === id }))
  if (id && !next.some((row) => row.contactId === id)) next.unshift({ contactId: id, primary: true })
  return next.slice(0, DEAL_CONTACT_ROLES_MAX)
}

/**
 * The roles a deal holds, in step with its `contactId`: the stored list
 * with the contact `contactId` names as its Primary — so a deal written
 * before roles reads as its one contact, Primary, with no role.
 */
export function dealContactRolesOf(deal: {
  contactId?: unknown
  contactRoles?: unknown
}): CrmDealContactRole[] {
  const contactId = typeof deal.contactId === 'string' ? deal.contactId : null
  return dealContactRolesWithPrimary(readDealContactRoles(deal.contactRoles), contactId)
}

/** The Primary's contact id, or `null` for a deal with none. */
export function dealPrimaryContactId(roles: readonly CrmDealContactRole[]): string | null {
  return roles.find((row) => row.primary)?.contactId ?? null
}

/** `roles` without one contact — a delete or an erasure of that person. */
export function dealContactRolesWithout(
  roles: readonly CrmDealContactRole[],
  contactId: string,
): CrmDealContactRole[] {
  return roles.filter((row) => row.contactId !== contactId)
}

/**
 * `roles` with every row naming `from` moved to `to` — a contact merge.
 * When both are on the deal the survivor keeps its own row, taking the
 * merged row's role where it has none and its Primary where it was.
 */
export function dealContactRolesRepointed(
  roles: readonly CrmDealContactRole[],
  from: string,
  to: string,
): CrmDealContactRole[] {
  const merged = roles.find((row) => row.contactId === from)
  if (!merged || from === to) return [...roles]
  if (!roles.some((row) => row.contactId === to)) {
    return roles.map((row) => (row.contactId === from ? { ...row, contactId: to } : row))
  }
  return roles
    .filter((row) => row.contactId !== from)
    .map((row) =>
      row.contactId === to
        ? {
            ...row,
            ...(!row.role && merged.role ? { role: merged.role } : {}),
            primary: row.primary || merged.primary,
          }
        : row,
    )
}

/**
 * What a deal stores for a list of roles: the list, and the `contactId`
 * its Primary names — `null` for none, which a writer turns into a delete.
 */
export function dealContactRoleFields(roles: readonly CrmDealContactRole[]): {
  contactRoles: CrmDealContactRole[]
  contactId: string | null
} {
  const contactRoles = readDealContactRoles(roles)
  return { contactRoles, contactId: dealPrimaryContactId(contactRoles) }
}

export const CRM_TASK_KIND_LABELS: Record<CrmTaskKind, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  todo: 'To-do',
}

export type CrmTaskPriority = 'low' | 'normal' | 'high'
export type CrmTaskStatus = 'open' | 'done'

/**
 * `orgs/{orgId}/crmTasks/{taskId}`.
 *
 * The one CRM record that may belong to NO site (AGL-2637): a task filed
 * from the organization's own hub carries `hostId: null` and the org scope
 * token alone, because a to-do owed by the organization — renew the
 * insurance, chase the agency's own invoice — is not captured by any brand.
 * Every other record is a fact about a person some site met, so
 * `CrmScoped` keeps its site required.
 */
export interface CrmTask extends Omit<CrmScoped, 'hostId'> {
  /** The site that created it, or `null` for the organization's own task. */
  hostId: string | null
  title: string
  notes?: string
  kind: CrmTaskKind
  priority: CrmTaskPriority
  status: CrmTaskStatus
  /**
   * The org's labels for `status`, `priority` and `kind` (AGL-3517) — a
   * value of the `taskStatus`, `taskPriority` and `taskType` picklists,
   * whose meaning is the field beside it. Absent or `null` shows the first
   * active value of that meaning; see `crmTaskPicklistLabels`.
   */
  statusLabel?: string | null
  priorityLabel?: string | null
  typeLabel?: string | null
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
  /**
   * The plugin that filed it on the record-timeline seam (AGL-2981) — a
   * sequence's call step, a reply to answer — when no person did.
   */
  sourcePluginId?: string
  contactId?: string
  companyId?: string
  dealId?: string
  /**
   * `hosts/{hostId}/leads/{leadId}` — a task filed on a lead not yet
   * converted (AGL-3233): a sequence's call step or a reply to answer. The
   * conversion stamps the contact beside it, so the task is the contact's
   * from then on and the lead's page still lists it.
   */
  leadId?: string
  /**
   * When the assignee is reminded (AGL-2659): the due time unless a person
   * moved it, `null` for no reminder. The hourly `/api/crm/task-reminders`
   * runner reads every open task whose reminder has come due, so a task
   * that should never remind carries `null` rather than no field — a
   * missing key and a null both fall outside the range, but the null says
   * it was decided.
   */
  remindAtMs?: number | null
  /**
   * When the runner handled the reminder — sent it, or found nobody to
   * send it to. Absent while the reminder is still owed, which is how a
   * rerun over the same hour sends nothing twice; cleared again when the
   * reminder moves, because a moved reminder is a new one.
   */
  reminderSentAtMs?: number
}

/** How an activity kind reads on screen — typed so a kind cannot ship unlabeled. */
export const CRM_ACTIVITY_KIND_LABELS: Record<CrmActivityKind, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  other: 'Other',
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
 * Which way an `email` activity's message traveled. `outbound` is every
 * message the workspace wrote — sent by the platform, or copied to the
 * capture address from a mailbox; `inbound` is one a correspondent wrote,
 * which only the capture route files (AGL-2657).
 */
export type CrmEmailDirection = 'outbound' | 'inbound'

/**
 * Which way a call went (AGL-3517) — Salesforce's Call Type: `inbound` for
 * one the contact placed, `outbound` for one the team placed, `internal`
 * for one between teammates about the record.
 */
export type CrmCallDirection = CrmEmailDirection | 'internal'

/** An activity's direction: a call's three, of which an email takes the first two. */
export type CrmActivityDirection = CrmCallDirection

/** The directions each kind takes, in the order a select lists them; none for the rest. */
export const CRM_ACTIVITY_DIRECTIONS: Readonly<Partial<Record<CrmActivityKind, readonly CrmActivityDirection[]>>> = {
  call: ['outbound', 'inbound', 'internal'],
  email: ['outbound', 'inbound'],
}

export const CRM_ACTIVITY_DIRECTION_LABELS: Record<CrmActivityDirection, string> = {
  outbound: 'Outbound',
  inbound: 'Inbound',
  internal: 'Internal',
}

/** `value` when `kind` takes it as a direction, else `null`. */
export function crmActivityDirection(
  kind: unknown,
  value: unknown,
): CrmActivityDirection | null {
  const allowed = CRM_ACTIVITY_DIRECTIONS[kind as CrmActivityKind] ?? []
  const text = String(value ?? '').trim().toLowerCase()
  return (allowed as readonly string[]).includes(text) ? (text as CrmActivityDirection) : null
}

/** "Inbound call", "Outbound email", "Internal call" — or the kind alone with no direction. */
export function crmActivityKindTitle(kind: CrmActivityKind, direction?: unknown): string {
  const known = crmActivityDirection(kind, direction)
  const noun = CRM_ACTIVITY_KIND_LABELS[kind] ?? String(kind)
  return known ? `${CRM_ACTIVITY_DIRECTION_LABELS[known]} ${noun.toLowerCase()}` : noun
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
  /**
   * The plugin that filed it on the record-timeline seam (AGL-2981) — an
   * email a sequence sent, a reply it read — or the CRM's own id on an
   * entry it wrote about a filing (AGL-3274), so a reader can tell the
   * bookkeeping entries from what a person logged.
   */
  sourcePluginId?: string
  /**
   * The campaign a filing entry is about (AGL-3274): "Filed under" and
   * "Removed from" name it in the body and carry the container's id here,
   * so a campaign's own page can one day list what happened under it
   * without parsing a sentence.
   */
  campaignId?: string
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
  /**
   * On an email: `outbound` for a message the platform sent or a teammate
   * copied to the capture address; `inbound` for one a correspondent wrote
   * (AGL-2657). On a call: inbound, outbound or internal (AGL-3517). See
   * {@link CRM_ACTIVITY_DIRECTIONS}.
   */
  direction?: CrmActivityDirection
  /** See {@link CrmEmailDeliveryState}; advanced by the delivery webhook. */
  deliveryState?: CrmEmailDeliveryState
  /** When the delivery state last moved, epoch ms. */
  deliveryAtMs?: number
  /**
   * What the receiving server said when the state moved to a failure
   * (AGL-3245): a bounce's diagnostic, scrubbed of the address. Absent on a
   * progression state.
   */
  deliveryDetail?: string
  /**
   * `hosts/{hostId}/bookings/{bookingId}` — the booking a `meeting` was
   * filed from (AGL-2660), on the rows filed before a booking reached the
   * record through the record-timeline seam. A booking's meeting is now an
   * entry keyed by the booking, and `sourcePluginId` names who filed it.
   */
  bookingId?: string
  /**
   * An email CAPTURED from a mailbox (AGL-2657) — forwarded or copied to
   * the workspace's capture address — as against one the platform sent:
   * who wrote it, the provider's `Message-ID` the row is deduplicated by,
   * the message it answered, and the subject with its reply and forward
   * prefixes removed, which is what groups a thread. Absent on every other
   * email row.
   */
  from?: string
  messageId?: string
  inReplyTo?: string
  threadSubject?: string
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
  /** The site the campaign went out from — the send's `hostId`. */
  hostId: string
  /** `orgs/{orgId}/campaigns/{campaignId}` — the email, whose report the entry links to. */
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
  /**
   * Which record the field describes (AGL-2661). ABSENT means `contact`,
   * because every definition written before companies and deals could carry
   * custom fields described a contact, and a backfill that stamped them
   * would touch every org for a fact the reader can infer. Read it through
   * {@link fieldDefinitionObject}, never directly, so that inference lives
   * in one place. Keys are unique PER OBJECT: a company field and a contact
   * field may both be called `region`.
   */
  object?: CrmFieldObject
}

/**
 * The records a custom field may describe, in the order the Fields
 * section tabs them (AGL-2661), with `lead` since AGL-3272.
 *
 * A lead is last because it is the record a person leaves: the three
 * before it are what a lead becomes, and the tabs read in that order.
 */
export const CRM_FIELD_OBJECTS = ['contact', 'company', 'deal', 'lead'] as const

export type CrmFieldObject = (typeof CRM_FIELD_OBJECTS)[number]

/** How each object reads on the Fields section's tabs and in a refusal. */
export const CRM_FIELD_OBJECT_LABELS: Record<CrmFieldObject, string> = {
  contact: 'Contacts',
  company: 'Companies',
  deal: 'Deals',
  lead: 'Leads',
}

export function isCrmFieldObject(value: unknown): value is CrmFieldObject {
  return (
    typeof value === 'string' &&
    (CRM_FIELD_OBJECTS as readonly string[]).includes(value)
  )
}

/**
 * Which record a definition describes — `contact` when the document says
 * nothing, or says something no reader understands.
 *
 * The one reader of {@link ContactFieldDefinition.object}. A stored value
 * outside the list is read as `contact` rather than refused, for the
 * reason an absent one is: the definition predates the field, or was
 * written by something that never learned it, and either way the values
 * under its key sit on contacts.
 */
export function fieldDefinitionObject(
  definition: Pick<ContactFieldDefinition, 'object'> | null | undefined,
): CrmFieldObject {
  return isCrmFieldObject(definition?.object) ? definition.object : 'contact'
}

/**
 * What the CRM › Fields table's query reads on a definition (AGL-3335):
 *
 *   object        which tab it belongs to, stored even for a contact's, because
 *                 a query cannot find a field's absence;
 *   required      a boolean on every definition, for the Required filter;
 *   searchTokens  every word prefix of its name and of its key, the key read
 *                 whole and split at `_`, `-` and `.`, so "plan" finds
 *                 `plan_interest` and "interest" does too.
 *
 * Its script-side twin is `crmFieldListFields` in
 * `tools/scripts/lib/org-record-list-fields.mjs`; both answer the
 * `fieldDefinitions` of `org-record-list-fields.fixtures.json`.
 */
export function crmFieldListFields(definition: Record<string, unknown> | null | undefined): {
  object: CrmFieldObject
  required: boolean
  searchTokens: string[]
} {
  const label = typeof definition?.['label'] === 'string' ? definition['label'] : ''
  const key = typeof definition?.['key'] === 'string' ? definition['key'] : ''
  return {
    object: fieldDefinitionObject(definition as Pick<ContactFieldDefinition, 'object'>),
    required: definition?.['required'] === true,
    searchTokens: nameSearchTokens([label, key, key.replace(/[_.-]+/g, ' ')].join(' ')),
  }
}

/**
 * The definition type under the name new code uses (AGL-2661). The type,
 * the collection (`contactFields`) and the rules match keep the contact
 * name: renaming them would ripple through the rules, the REST resources
 * and the docs for no change in what is stored.
 */
export type CrmFieldDefinition = ContactFieldDefinition

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
 *
 * An open deal's own probability override (AGL-3516) replaces its stage's
 * — see {@link dealProbability}.
 */
export function weightedDealAmountCents(
  deal: Pick<CrmDeal, 'amountCents' | 'status'> & Partial<Pick<CrmDeal, 'probability'>>,
  stage: Pick<CrmDealStage, 'probability'> | null | undefined,
): number {
  const amount = Math.max(0, Math.round(Number(deal.amountCents ?? 0) || 0))
  if (deal.status === 'won') return amount
  if (deal.status === 'lost' || !stage) return 0
  const probability = dealProbability(deal, stage) ?? 0
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

/*==========================================
 * A COMPANY'S ACCOUNT FIELDS (AGL-3514).
 *
 * Salesforce's Account carries more than a name and a domain: a Type, an
 * Industry, a Rating, an Ownership and an Account Source, each a picklist;
 * an annual revenue and a head count; a fax, an account number, a site, a
 * ticker symbol and an SIC code; a shipping address beside the billing one;
 * and a parent account. Every door that writes a company — the drawer, the
 * REST resource, the import, a lead's conversion — reads them through this
 * block, so a value one door refuses is refused by all of them.
 *
 * ## Each field's three answers
 *
 * A door reads what a request said about a field: not named (`undefined`)
 * leaves the record alone, `null` or a blank clears it, and anything else
 * is normalized or refused by name. A picklist field stores the value's
 * LABEL, judged against the org's list with the record's current value
 * kept (see the picklist block); the Companies list filters by the key of
 * Type, Industry and Rating, which `crmCompanyListFields` writes beside
 * the label.
 *=========================================*/

/** Each company picklist field: the list it holds a value of, and the key the list filters by. */
export const CRM_COMPANY_PICKLIST_FIELDS = [
  { field: 'type', picklistId: 'accountType', keyField: 'typeKey' },
  { field: 'industry', picklistId: 'industry', keyField: 'industryKey' },
  { field: 'rating', picklistId: 'rating', keyField: 'ratingKey' },
  { field: 'ownership', picklistId: 'ownership' },
  { field: 'accountSource', picklistId: 'leadSource', keyField: 'accountSourceKey' },
] as const

export type CrmCompanyPicklistField = (typeof CRM_COMPANY_PICKLIST_FIELDS)[number]['field']

/** The short text fields, each capped at Salesforce's own length. */
export const CRM_COMPANY_TEXT_MAX = {
  accountNumber: 40,
  site: 80,
  tickerSymbol: 20,
  sicCode: 20,
} as const

export type CrmCompanyTextField = keyof typeof CRM_COMPANY_TEXT_MAX

/** The most employees a company records — Salesforce's eight digits. */
export const CRM_COMPANY_EMPLOYEES_MAX = 99_999_999

/** The account fields that are not picklists, as every door names them. */
export const CRM_COMPANY_ACCOUNT_FIELDS = [
  'annualRevenueCents',
  'currency',
  'numberOfEmployees',
  'fax',
  'accountNumber',
  'site',
  'tickerSymbol',
  'sicCode',
  'shippingAddress',
] as const

export type CrmCompanyAccountField = (typeof CRM_COMPANY_ACCOUNT_FIELDS)[number]

/** A short text field as stored: trimmed, single-spaced. */
export function normalizeCompanyText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

const blank = (value: unknown): boolean =>
  value === null || (typeof value === 'string' && value.trim() === '')

/**
 * The account fields a request names, normalized, or the refusal of each
 * one that cannot be stored — see the block above. A value the door has
 * already parsed from text (the drawer's revenue, a file's head count)
 * arrives here as the number it parsed.
 */
export function readCrmCompanyAccountFields(input: Readonly<Record<string, unknown>>): {
  values: Partial<Pick<CrmCompany, CrmCompanyAccountField>>
  errors: Record<string, string>
} {
  const values: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  for (const field of CRM_COMPANY_ACCOUNT_FIELDS) {
    const raw = input[field]
    if (raw === undefined) continue
    if (blank(raw)) {
      values[field] = null
      continue
    }
    switch (field) {
      case 'annualRevenueCents':
        if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) values[field] = raw
        else errors[field] = 'Must be a whole number of cents, 0 or more'
        break
      case 'currency': {
        const code = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
        if (/^[a-z]{3}$/.test(code)) values[field] = code
        else errors[field] = 'Must be a three-letter ISO 4217 code, like usd'
        break
      }
      case 'numberOfEmployees':
        if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= CRM_COMPANY_EMPLOYEES_MAX) {
          values[field] = raw
        } else {
          errors[field] = `Must be a whole number from 0 to ${CRM_COMPANY_EMPLOYEES_MAX}`
        }
        break
      case 'fax': {
        const fax = typeof raw === 'string' ? normalizePhone(raw) : null
        if (fax) values[field] = fax
        else errors[field] = 'Must be a phone number with a country code, like +15125550123'
        break
      }
      case 'shippingAddress':
        if (typeof raw === 'object' && !Array.isArray(raw)) {
          values[field] = normalizeAddress(raw as AglynPostalAddress)
        } else {
          errors[field] = 'Must be an address object'
        }
        break
      default: {
        const max = CRM_COMPANY_TEXT_MAX[field]
        if (typeof raw !== 'string' && typeof raw !== 'number') {
          errors[field] = 'Must be text'
          break
        }
        const text = normalizeCompanyText(raw)
        if (text.length > max) errors[field] = `Must be at most ${max} characters`
        else values[field] = text
      }
    }
  }
  return { values: values as Partial<Pick<CrmCompany, CrmCompanyAccountField>>, errors }
}

/**
 * The picklist fields a request names, judged against the org's lists —
 * `lists` holds each list the caller read, and a list it did not read is
 * judged as the standard values alone. `current` is the record as stored:
 * its value is kept even when the list no longer offers it, which is how
 * a company whose industry was typed before Industry became a picklist
 * keeps it. On a create (`created`), a field not named starts from its
 * list's default when the org set one.
 */
export function judgeCrmCompanyPicklists(
  lists: Readonly<Partial<Record<CrmPicklistId, CrmPicklist>>>,
  requested: Readonly<Partial<Record<string, unknown>>>,
  options: { current?: Readonly<Partial<Record<string, unknown>>>; created?: boolean } = {},
): {
  values: Partial<Record<CrmCompanyPicklistField, string | null>>
  errors: Record<string, string>
} {
  const values: Partial<Record<CrmCompanyPicklistField, string | null>> = {}
  const errors: Record<string, string> = {}
  for (const { field, picklistId } of CRM_COMPANY_PICKLIST_FIELDS) {
    const list = lists[picklistId] ?? effectiveCrmPicklist(picklistId, undefined)
    const raw = requested[field]
    if (raw === undefined) {
      const fallback = options.created ? picklistDefaultLabel(list) : null
      if (fallback) values[field] = fallback
      continue
    }
    if (blank(raw)) {
      values[field] = null
      continue
    }
    if (typeof raw !== 'string') {
      errors[field] = 'Must be text'
      continue
    }
    const judged = judgeCrmPicklistValue(picklistId, list, raw, options.current?.[field])
    if (judged.ok === false) errors[field] = judged.error
    else values[field] = judged.value
  }
  return { values, errors }
}

/** How deep a chain of parent companies may run. */
export const CRM_COMPANY_PARENT_DEPTH_MAX = 25

/**
 * What a parent lookup answers for one company id: its own parent, or
 * `null` when there is no such company the writer may see.
 */
export type CrmCompanyParentReader = (
  companyId: string,
) => Promise<{ parentCompanyId: string | null } | null>

/**
 * Why `parentId` cannot be the parent of `companyId` (`null` for a company
 * not yet created), or `null` when it can: a company is never its own
 * parent, the parent must be a company the writer can see, and a company
 * already UNDER this one cannot be put above it — the cycle Salesforce
 * refuses too. Walks up from the parent through `read`, at most
 * {@link CRM_COMPANY_PARENT_DEPTH_MAX} steps.
 */
export async function crmCompanyParentRefusal(
  companyId: string | null,
  parentId: string,
  read: CrmCompanyParentReader,
): Promise<string | null> {
  if (companyId && parentId === companyId) return 'A company cannot be its own parent.'
  const parent = await read(parentId)
  if (!parent) return 'There is no such parent company.'
  const seen = new Set<string>([parentId])
  let cursor = parent.parentCompanyId
  for (let depth = 1; cursor; depth += 1) {
    if (companyId && cursor === companyId) {
      return 'That company sits under this one, so it cannot be its parent.'
    }
    // A loop above that does not pass through this company is not this write's.
    if (seen.has(cursor)) return null
    if (depth >= CRM_COMPANY_PARENT_DEPTH_MAX) {
      return `A company can sit at most ${CRM_COMPANY_PARENT_DEPTH_MAX} levels under another.`
    }
    seen.add(cursor)
    cursor = (await read(cursor))?.parentCompanyId ?? null
  }
  return null
}

/** A stored parent id as a reader takes it, `null` for none. */
export function crmCompanyParentId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Mailbox domains that belong to people rather than to a business: the
 * providers anybody can sign up with, and the ones an internet provider
 * hands its subscribers.
 *
 * Auto-associating a contact with a company by email domain is the whole
 * reason {@link companyDomainForEmail} exists, and it is wrong for every
 * address at a public mailbox: `gmail.com` is not a company, and a rule
 * that treated it as one would file half of a consumer list under a single
 * phantom account. It is also the fact a cold email has to know — an
 * address here is a person's own, not their work address — which is why the
 * list is exported with {@link isPublicMailboxDomain}: a second list kept
 * for that question would drift from this one.
 *
 * Exact domains, not suffixes: a subscriber's regional host (`nc.rr.com`)
 * is not listed, and neither is a company that happens to end in `mail.com`.
 */
export const PUBLIC_MAILBOX_DOMAINS: ReadonlySet<string> = new Set([
  // Google, Yahoo, Microsoft, Apple, AOL.
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.ca',
  'yahoo.com.au',
  'yahoo.co.in',
  'yahoo.fr',
  'yahoo.de',
  'ymail.com',
  'rocketmail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'outlook.com',
  'live.com',
  'live.co.uk',
  'live.ca',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'aim.com',
  // Independent and privacy-first providers.
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
  'tutanota.com',
  'tuta.io',
  'hushmail.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'web.de',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
  'zohomail.com',
  'fastmail.com',
  'hey.com',
  // The largest consumer providers outside the US and Europe.
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'naver.com',
  'hanmail.net',
  'rediffmail.com',
  // US internet providers' subscriber mailboxes.
  'comcast.net',
  'att.net',
  'sbcglobal.net',
  'bellsouth.net',
  'pacbell.net',
  'verizon.net',
  'cox.net',
  'charter.net',
  'earthlink.net',
  'optonline.net',
  'frontier.com',
  'windstream.net',
  'centurylink.net',
  'juno.com',
  'netzero.net',
  // Subscriber mailboxes at the largest providers in Canada, the UK, France,
  // Germany, Italy and Australia.
  'shaw.ca',
  'sympatico.ca',
  'btinternet.com',
  'sky.com',
  'virginmedia.com',
  'orange.fr',
  'free.fr',
  'laposte.net',
  't-online.de',
  'libero.it',
  'bigpond.com',
])

/**
 * Whether a domain — or the domain of an address — is one of the
 * {@link PUBLIC_MAILBOX_DOMAINS}. Read the way a company domain is, so case,
 * a trailing dot and a pasted `www.` do not hide one.
 */
export function isPublicMailboxDomain(domainOrEmail: unknown): boolean {
  const value = String(domainOrEmail ?? '').trim()
  const domain = normalizeCompanyDomain(value.slice(value.lastIndexOf('@') + 1))
  return domain !== null && PUBLIC_MAILBOX_DOMAINS.has(domain)
}

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
 * Every holder whose facet names this company, in no order.
 *
 * What a company's DELETION clears. Unlike a link change, which is one
 * holder's, a deletion takes the record away from every holder at once: a
 * facet still naming it would be a link to nothing, on a surface its holder
 * has no reason to revisit. Nothing else about another holder's facet is
 * read.
 */
export function contactGroupsNamingCompany(
  contact: Record<string, unknown> | null | undefined,
  companyId: string,
): string[] {
  const facets = (contact ?? {})[CONTACT_FACETS_FIELD]
  if (!companyId || !facets || typeof facets !== 'object' || Array.isArray(facets)) {
    return []
  }
  return Object.entries(facets as Record<string, unknown>)
    .filter(([, facet]) =>
      Boolean(
        facet &&
          typeof facet === 'object' &&
          !Array.isArray(facet) &&
          (facet as Record<string, unknown>)['companyId'] === companyId,
      ),
    )
    .map(([groupId]) => groupId)
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

/** Where the CRM's default sharing for new records is stored (AGL-3662). */
export const CRM_DEFAULT_RECORD_SCOPE_PATH = `${ORG_CRM_SETTINGS_FIELD}.defaultRecordScope`

/**
 * The org's default sharing for new CRM records (AGL-3662): `'org'` shares a
 * new contact, company, deal or task with every site, `'host'` keeps it to
 * the site it came in on and the sites that present as one sender with it.
 *
 * `crm.defaultRecordScope` when the org has set it. Before AGL-3662 the CRM
 * read the org's dataset default, `defaultResourceScope`, so an org that set
 * that to All sites keeps CRM records org-wide until it chooses separately.
 * Neither set reads `undefined`, which every caller treats as `'host'`.
 */
export function crmDefaultScopeOf(
  orgDocument: Record<string, unknown> | null | undefined,
): 'org' | 'host' | undefined {
  const settings = (orgDocument ?? {})[ORG_CRM_SETTINGS_FIELD]
  const own =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)['defaultRecordScope']
      : undefined
  if (own === 'org' || own === 'host') return own
  const legacy = (orgDocument ?? {})['defaultResourceScope']
  return legacy === 'org' || legacy === 'host' ? legacy : undefined
}

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
 * whole org when the org's CRM default (`crmDefaultScopeOf`) is `'org'`, and
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
  return crmDefaultScopeOf(org) === 'org'
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
 * A roster row as a PICKER lists it: the name, and the address in
 * parentheses when the roster holds one that the name does not already
 * spell. Two teammates can share a display name — a workspace with two
 * "Zach Gover" rows cannot tell them apart by name alone, and the address is
 * the one thing the roster guarantees is unique. A column keeps `label`,
 * because a column is read at a glance and a picker is chosen from.
 */
export function crmMemberPickerLabel(
  member: Pick<CrmMemberOption, 'label' | 'email'>,
): string {
  const label = String(member.label ?? '').trim()
  const email = String(member.email ?? '').trim()
  if (!email || email.toLowerCase() === label.toLowerCase()) return label || email
  return `${label} (${email})`
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
 * `nurturing` is the stage automated email holds a lead in: a sequence step
 * or a campaign email has reached it and no person has engaged yet. It is
 * open — the lead still needs somebody — but it is not untouched, so the
 * digest's unworked list leaves it out. Automation writes it only over
 * `new` (a person may also set it by hand), and a reply moves it on to
 * `working`.
 *
 * `qualified` is the CONVERTED state — a lead becomes a contact by being
 * qualified, and the conversion stamps `convertedContactId` beside it — and
 * `unqualified` is the closed-without-conversion state with its reason. A
 * fixed list rather than free text for the reason the lifecycle stages are:
 * the section filters on it and a report counts by it.
 */
export const CRM_LEAD_STATUSES = [
  'new',
  'nurturing',
  'working',
  'qualified',
  'unqualified',
] as const

export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number]

/** How a lead status reads on screen — typed so a status cannot ship unlabeled. */
export const CRM_LEAD_STATUS_LABELS: Record<CrmLeadStatus, string> = {
  new: 'New',
  nurturing: 'Nurturing',
  working: 'Working',
  qualified: 'Qualified',
  unqualified: 'Unqualified',
}

/**
 * The statuses a lead still needs somebody's attention in — what the Leads
 * section shows by default, so the list opens on the work rather than on
 * the history.
 */
export const CRM_LEAD_OPEN_STATUSES: readonly CrmLeadStatus[] = [
  'new',
  'nurturing',
  'working',
]

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

/**
 * The leads still needing somebody, from two server counts: every lead,
 * less the ones closed one way or the other.
 *
 * Subtraction rather than a count of the open statuses because a lead
 * nobody has touched carries NO status field — see `crmLeadStatus` — and
 * Firestore cannot select a document by a field's absence. The closed
 * statuses are always written, so they can be counted; what remains is
 * open. Clamped at zero for the moment between the two counts in which a
 * lead was closed.
 */
export function openLeadsFromCounts(total: number, closed: number): number {
  return Math.max(0, Math.round(Number(total) || 0) - Math.round(Number(closed) || 0))
}

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
export interface CrmLeadFields extends CrmLeadProfile {
  status?: CrmLeadStatus
  /**
   * Which of the org's Lead status values of `status`'s meaning the lead
   * holds (AGL-3512); absent, the lead shows its meaning's default label —
   * see `crmLeadStatusLabel`.
   */
  statusLabel?: string
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
  /**
   * The last verdict on the lead's address (AGL-3245) — bounced, blocked,
   * unsubscribed, do-not-contact — written by the platform's senders only,
   * never by a form or the lead's editor. Absent means nothing is known.
   */
  emailState?: EmailState
  /**
   * The campaigns the lead is filed under (AGL-3254): container ids from
   * `orgs/{orgId}/emailCampaigns`, at the top of the document the way a
   * form carries them (`container-membership.ts`), never names. Written by
   * the New lead drawer, the import, the bulk bar and a sequence's enroll;
   * handed to the contact's facet when the lead converts.
   */
  campaignIds?: string[]
  /**
   * The org's custom LEAD fields, keyed by each definition's `key`
   * (AGL-3272) — the same map a contact facet, a company and a deal keep,
   * judged against the definitions whose `object` is `lead`.
   *
   * It does NOT travel to the contact on convert. Keys are unique per
   * object, so a lead's `budget` and a contact's `budget` are two
   * definitions that may hold two types, and copying one map into the
   * other would write a value the receiving definition never agreed to.
   * Salesforce answers this with an explicit lead field mapping; until
   * there is one here the values stay on the lead, which a converted lead
   * is still read back for.
   */
  custom?: Record<string, CrmCustomValue>
}

/*==========================================
 * THE LEAD'S OWN PROFILE (AGL-3231).
 *
 * A Salesforce lead is a record of its own: it carries the person AND
 * their company as text — company, title, phone, website, address, the
 * source that produced it — and none of it is a contact until the lead
 * converts, when the convert step hands every field to the contact and the
 * account it creates. A lead that held only an address and a name could
 * not be worked without a contact beside it, which is how one person came
 * to sit in both lists; these fields are what let the lead stand alone.
 *
 * ## Text, not links
 *
 * `company` is the company's NAME, never a company id. A lead has not been
 * qualified, so the account it names may not deserve a record yet — a
 * thousand imported leads must not mint a thousand companies — and the
 * conversion is where the text becomes a link: it finds the company by
 * that name or by the address's domain, or creates it. The `companyId` on
 * `CrmLeadFields` is the conversion's stamp, written once, and never what
 * a lead carries while it is open.
 *
 * ## The same shapes the contact keeps
 *
 * The phone is E.164 through `normalizePhone`, the address is
 * `AglynPostalAddress` through `normalizeAddress`, tags are lower-cased and
 * capped as the contact's are, and the website is normalized as a
 * company's is — so the conversion copies values rather than translating
 * them, and a lead typed in the drawer and a contact typed in its drawer
 * refuse the same phone number in the same sentence.
 *
 * ## `leadSource` beside `sources`
 *
 * `sources` is the capture door's record of which SURFACES met the person
 * — `signup`, `booking`, `form:{id}`, `import` — and no file may rewrite
 * it. `leadSource` is what Salesforce calls Lead Source: one of the org's
 * own picklist values ("Trade show", "Webinar" — see THE CRM'S PICKLISTS
 * below), reported on and filtered by, and never derived. Two
 * fields because they answer two questions, and a file that could write
 * the first would be rewriting the site's own history.
 *=========================================*/

/** The longest text one profile field holds — the contact's own cap. */
export const CRM_LEAD_TEXT_MAX = 120
/** The most tags one lead keeps — the contact's own cap. */
export const CRM_LEAD_TAGS_MAX = 20
/** The longest note a lead keeps — the lead page's own cap. */
export const CRM_LEAD_NOTES_MAX = 4000

export interface CrmLeadProfile {
  /** The company's name, as text — see the block header. */
  company?: string
  jobTitle?: string
  /** E.164 — `normalizePhone` before writing. */
  phone?: string
  /** An http(s) URL — `normalizeCompanyWebsite` before writing. */
  website?: string
  address?: AglynPostalAddress | null
  /** Lower-cased, deduplicated, at most {@link CRM_LEAD_TAGS_MAX}. */
  tags?: string[]
  /**
   * Where the lead came from — Salesforce's Lead Source: the LABEL of one
   * of the org's lead source values (see {@link CrmPicklist}).
   */
  leadSource?: string
  /*
   * SALESFORCE'S STANDARD LEAD FIELDS (AGL-3513), in the shapes the contact
   * and the company keep them, so a conversion copies values rather than
   * translating them.
   */
  /** One of the org's salutation values, by label (`Mr.`, `Dr.` …) — the contact's list. */
  salutation?: string
  /**
   * The person's given and family names. While either is set, the lead's
   * `name` is their composition ({@link crmLeadComposedName}), so the name
   * the list shows and searches is the person the structured fields name. A
   * lead holding only `name` keeps it as captured: nothing splits a stored
   * name into parts after the fact.
   */
  firstName?: string
  lastName?: string
  /** E.164, like {@link phone}. */
  mobilePhone?: string
  /** E.164. */
  fax?: string
  /** A label of the `industry` picklist — the list companies keep (AGL-3514). */
  industry?: string
  /** A label of the `rating` picklist — the list companies keep. */
  rating?: string
  /** Annual revenue in the minor unit of {@link currency}, the company's convention. */
  annualRevenueCents?: number
  /** Lowercase ISO 4217 of the revenue; `'usd'` when absent. */
  currency?: string
  numberOfEmployees?: number
  /**
   * The person asked not to be phoned. Stored only as `true`; absent is
   * "may be called". A hint beside every number and on the Call button,
   * never a block — the contact's rule.
   */
  doNotCall?: boolean
}

/** The profile's keys, in the order a card lists them. */
export const CRM_LEAD_PROFILE_KEYS = [
  'salutation',
  'firstName',
  'lastName',
  'company',
  'jobTitle',
  'phone',
  'mobilePhone',
  'fax',
  'doNotCall',
  'website',
  'address',
  'tags',
  'leadSource',
  'industry',
  'rating',
  'annualRevenueCents',
  'currency',
  'numberOfEmployees',
] as const satisfies readonly (keyof CrmLeadProfile)[]

export type CrmLeadProfileKey = (typeof CRM_LEAD_PROFILE_KEYS)[number]

/**
 * A profile as a writer receives it: a key present is a value to store, a
 * key present and `null` is a field to clear, a key absent is left alone.
 * The PATCH semantics every CRM write has.
 */
export type CrmLeadProfilePatch = {
  [K in CrmLeadProfileKey]?: NonNullable<CrmLeadProfile[K]> | null
}

/** Why one field of a profile could not be read, under the field. */
export type CrmLeadProfileErrors = Partial<Record<CrmLeadProfileKey, string>>

/** The sentence an unreadable phone number is refused with, under the field. */
export const CRM_LEAD_PHONE_REFUSAL =
  'That phone number could not be read. Enter it with its country code, like ' +
  '+1 512 555 0107.'

/** The sentence an unreadable website is refused with, under the field. */
export const CRM_LEAD_WEBSITE_REFUSAL = 'Enter a web address, like acme.com'

/**
 * Tags as a lead stores them: lower-cased, trimmed, deduplicated, capped —
 * from an array or a comma-separated string, so a file cell and a form
 * field are one input.
 */
export function normalizeCrmLeadTags(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  return [
    ...new Set(
      items
        .map((tag) =>
          String(tag ?? '')
            .trim()
            .slice(0, 40)
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  ].slice(0, CRM_LEAD_TAGS_MAX)
}

/**
 * Read a profile off an untrusted body, one field at a time.
 *
 * Every key the body names is answered: as a normalized value, as `null`
 * when the body cleared it (an empty string, `null`, an empty list, a blank
 * address), or as an error under the field when the value cannot be
 * stored as typed. Keys the body does not name are not in the answer, so
 * a caller can write exactly what was asked. A `website` is normalized the
 * way a company's is; a phone the way a contact's is; both refuse rather
 * than store a value the record would then render as a link to nowhere.
 */
export function normalizeCrmLeadProfile(
  input: Record<string, unknown> | null | undefined,
): { patch: CrmLeadProfilePatch; errors: CrmLeadProfileErrors } {
  const body = input ?? {}
  const patch: CrmLeadProfilePatch = {}
  const errors: CrmLeadProfileErrors = {}
  const text = (
    key: 'company' | 'jobTitle' | 'leadSource' | 'salutation' | 'industry' | 'rating',
  ) => {
    if (!(key in body)) return
    const value = String(body[key] ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, CRM_LEAD_TEXT_MAX)
    patch[key] = value || null
  }
  text('company')
  text('jobTitle')
  text('leadSource')
  text('salutation')
  text('industry')
  text('rating')
  // A name part as the contact's facet keeps one — see `composeContactName`.
  for (const key of ['firstName', 'lastName'] as const) {
    if (!(key in body)) continue
    const value = composeContactName(body[key], '')
    patch[key] = value || null
  }
  for (const key of ['phone', 'mobilePhone', 'fax'] as const) {
    if (!(key in body)) continue
    const raw = String(body[key] ?? '').trim()
    if (!raw) patch[key] = null
    else {
      const phone = normalizePhone(raw)
      if (phone) patch[key] = phone
      else errors[key] = CRM_LEAD_PHONE_REFUSAL
    }
  }
  if ('doNotCall' in body) {
    // Stored only as `true`: anything else is "may be called", a clear.
    patch.doNotCall = body['doNotCall'] === true ? true : null
  }
  /*
   * The revenue, its currency and the head count, read by the company's
   * own reader so a value one record refuses the other refuses in the same
   * words. A head count typed as digits is read as the number it spells.
   */
  const account: Record<string, unknown> = {}
  if ('annualRevenueCents' in body) account['annualRevenueCents'] = body['annualRevenueCents'] ?? null
  if ('currency' in body) account['currency'] = body['currency'] ?? null
  if ('numberOfEmployees' in body) {
    const raw = body['numberOfEmployees']
    const digits = typeof raw === 'string' ? raw.replace(/[\s,]/g, '') : null
    account['numberOfEmployees'] =
      digits === null ? (raw ?? null) : digits === '' ? null : /^\d+$/.test(digits) ? Number(digits) : raw
  }
  if (Object.keys(account).length) {
    const read = readCrmCompanyAccountFields(account)
    const into = patch as Record<string, unknown>
    for (const key of ['annualRevenueCents', 'currency', 'numberOfEmployees'] as const) {
      if (read.errors[key]) errors[key] = read.errors[key]
      else if (key in read.values) into[key] = read.values[key] ?? null
    }
  }
  if ('website' in body) {
    const raw = String(body['website'] ?? '').trim()
    if (!raw) patch.website = null
    else {
      const website = normalizeCompanyWebsite(raw)
      if (website) patch.website = website
      else errors.website = CRM_LEAD_WEBSITE_REFUSAL
    }
  }
  if ('address' in body) {
    const raw = body['address']
    patch.address =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? normalizeAddress(raw as AglynPostalAddress)
        : null
  }
  if ('tags' in body) {
    const tags = normalizeCrmLeadTags(body['tags'])
    patch.tags = tags.length ? tags : null
  }
  return { patch, errors }
}

/**
 * The `name` a write must store beside a lead's first and last names
 * (AGL-3513), the contact's rule: while either part is set the name is
 * their composition, written whenever either moves. `undefined` when the
 * write names neither part, or when it leaves both blank — a name-only
 * lead keeps its name, and clearing both parts leaves the name as it
 * stands.
 */
export function crmLeadComposedName(
  stored: Readonly<Record<string, unknown>> | null | undefined,
  patch: Readonly<Pick<CrmLeadProfilePatch, 'firstName' | 'lastName'>>,
): string | undefined {
  if (patch.firstName === undefined && patch.lastName === undefined) return undefined
  const part = (key: 'firstName' | 'lastName') =>
    patch[key] === undefined ? stored?.[key] : (patch[key] ?? '')
  return composeContactName(part('firstName'), part('lastName')) || undefined
}

/**
 * Each lead picklist field beside the lead source (AGL-3513): the list it
 * holds a value of, and the key the Leads list filters by. The lists are
 * the contact's and the company's own — one Salutation, one Industry, one
 * Rating per org — so a lead converts into the same values.
 */
export const CRM_LEAD_PICKLIST_FIELDS = [
  { field: 'salutation', picklistId: 'salutation' },
  { field: 'industry', picklistId: 'industry', keyField: 'industryKey' },
  { field: 'rating', picklistId: 'rating', keyField: 'ratingKey' },
] as const

export type CrmLeadPicklistField = (typeof CRM_LEAD_PICKLIST_FIELDS)[number]['field']

/**
 * The lead picklist fields a write names, judged against the org's lists
 * — the company's {@link judgeCrmCompanyPicklists} over the lead's fields:
 * `lists` holds each list the caller read (a list it did not read is
 * judged as the standard values alone), the lead's `current` value is kept
 * even when the list no longer offers it, and on a create a field not
 * named starts from its list's default.
 */
export function judgeCrmLeadPicklists(
  lists: Readonly<Partial<Record<CrmPicklistId, CrmPicklist>>>,
  requested: Readonly<Partial<Record<string, unknown>>>,
  options: { current?: Readonly<Partial<Record<string, unknown>>> | null; created?: boolean } = {},
): {
  values: Partial<Record<CrmLeadPicklistField, string | null>>
  errors: Partial<Record<CrmLeadPicklistField, string>>
} {
  const values: Partial<Record<CrmLeadPicklistField, string | null>> = {}
  const errors: Partial<Record<CrmLeadPicklistField, string>> = {}
  for (const { field, picklistId } of CRM_LEAD_PICKLIST_FIELDS) {
    const list = lists[picklistId] ?? effectiveCrmPicklist(picklistId, undefined)
    const raw = requested[field]
    if (raw === undefined) {
      const fallback = options.created ? picklistDefaultLabel(list) : null
      if (fallback) values[field] = fallback
      continue
    }
    if (raw === null || (typeof raw === 'string' && !raw.trim())) {
      values[field] = null
      continue
    }
    if (typeof raw !== 'string') {
      errors[field] = 'Must be text'
      continue
    }
    const judged = judgeCrmPicklistValue(picklistId, list, raw, options.current?.[field])
    if (judged.ok === false) errors[field] = judged.error
    else values[field] = judged.value
  }
  return { values, errors }
}

/*==========================================
 * THE CRM'S PICKLISTS (AGL-3298, AGL-3510).
 *
 * Salesforce gives every object standard picklist fields — Lead Source,
 * Lead Status, Industry, Stage — each shipping a STANDARD set of values
 * every org has, to which an admin adds the org's own. Here each such field
 * is one {@link CrmPicklistDefinition} in {@link CRM_PICKLIST_DEFINITIONS},
 * and the org's list for it is one document,
 * `orgs/{orgId}/crmPicklists/{picklistId}`, holding the values in order as
 * `{ id, label, active, group?, meaning? }` and an optional default for new
 * records. The engine under it — the merge with the standard values, the
 * judge, the options — is the platform's `picklists` module; this block is
 * the CRM's registry and the names every CRM reader already uses.
 *
 * ## Records store the LABEL
 *
 * A lead carries `leadSource: "Trade show"`, not an id. Every reader that
 * existed before the picklist — the CSV export, the REST resource, the
 * record facts, a saved view's filter, a report grouped by the field —
 * reads the text and keeps working, and a file exported from here
 * re-imports as is. What an id would have bought is a free rename; here a
 * rename (and a delete) REPLACES the old label on every record the
 * definition's `targets` name in the same operation, the way Salesforce's
 * own Replace does, so a report grouped by the field follows the rename
 * rather than splitting in two. The value's `id` is what the list itself is
 * keyed by — the default, a reorder, the manage page's rows — and it never
 * changes.
 *
 * ## Standard values, and the org's own
 *
 * A standard value is in every org's effective list whether or not the org
 * stored one; the org may relabel, reorder, regroup, deactivate or default
 * it — stored under the standard id — but not delete it. A stored value
 * whose id is a standard id is that standard value overridden, which is why
 * a list written down from the earlier starter set (whose slugs `web`,
 * `phone-inquiry`, `purchased-list`, `trade-show` and `other` are standard
 * ids) needs no record rewritten. Its `referral` and `partner` are not
 * standard, and stay as the org's own values. An org with NO document reads
 * the standard values only, so a record such an org holds as "Referral" or
 * "Partner" shows as not in the list until that value is written down as
 * the org's own.
 *
 * ## Inactive, not gone
 *
 * A deactivated value leaves every picker but stays on the records that
 * hold it, shown with an "(inactive)" hint, and a write that keeps a
 * record's current value is never refused for it. An added value is
 * removed only by Delete, which names the value its records move to — of
 * the same meaning, on a definition with meanings.
 *=========================================*/

/** The CRM objects a picklist's values are kept on. */
export type CrmPicklistObject = CrmFieldObject | 'task'

/**
 * The Fields tabs, in order: every object with custom fields, then Tasks,
 * which has standard picklists and no custom fields (AGL-3517).
 */
export const CRM_PICKLIST_OBJECTS: readonly CrmPicklistObject[] = [...CRM_FIELD_OBJECTS, 'task']

/** How each object reads on the Fields tabs and in a refusal. */
export const CRM_PICKLIST_OBJECT_LABELS: Record<CrmPicklistObject, string> = {
  ...CRM_FIELD_OBJECT_LABELS,
  task: 'Tasks',
}

export function isCrmPicklistObject(value: unknown): value is CrmPicklistObject {
  return typeof value === 'string' && (CRM_PICKLIST_OBJECTS as readonly string[]).includes(value)
}

/**
 * One place records hold a picklist's label. `field` is the record's own
 * field; `keyField`, when set, is the query key written beside it
 * ({@link crmPicklistKey}); `facet` means the label lives in each holder's
 * facet on a contact rather than on the record itself.
 *
 * `arrayKey` (AGL-3521) means `field` is a LIST of objects and the label is
 * each entry's `arrayKey` — a deal's contact roles, `{ contactId, role }`.
 * Such a target always names a `keyField`, which is then the list of the
 * keys its entries hold: the one array a query can find the records by.
 */
export interface CrmPicklistTarget {
  object: CrmPicklistObject
  field: string
  keyField?: string
  facet?: true
  arrayKey?: string
  /**
   * The field holding the GROUP of the value the record holds (AGL-3577) —
   * a lead's `leadSourceDirection` — which every move that can change a
   * label's group (a regroup, an add, a rename, a delete) rewrites.
   */
  groupField?: string
}

/** A standard picklist field of the CRM. */
export interface CrmPicklistDefinition extends PicklistSpec {
  /** The document id under `crmPicklists`, and the field's name in code. */
  id: string
  /** The field's name in a sentence's subject: "Lead source must be one of: …". */
  label: string
  /** The values in a sentence: "no active lead sources". */
  plural: string
  /** The Fields tab its values are managed on. */
  object: CrmPicklistObject
  /** Every place records hold its label — what a rename and a delete rewrite. */
  targets: readonly CrmPicklistTarget[]
  /** How each of `meanings` reads on screen — the Fields page's Means column (AGL-3512). */
  meaningLabels?: Readonly<Record<string, string>>
  /**
   * Meanings only the platform sets, which an org-added value may not take
   * (AGL-3512): a lead is Qualified by its conversion alone.
   */
  reservedMeanings?: readonly string[]
}

/**
 * Lead Source, with Salesforce's standard values and Aglyn's own (AGL-3519).
 * Each carries the group a report splits pipeline by: Inbound for a lead
 * who came to the org, Outbound for one the org went to, and Other in
 * neither. Aglyn's are the doors and the outreach the platform runs itself
 * — a website form, a booking, a sequence — stamped on a record the door
 * met first ({@link CRM_LEAD_SOURCE_ORIGINS}); a vendor the platform does
 * not run (a data provider, a sending tool) is an org's own value.
 */
const LEAD_SOURCE_DEFINITION = {
  id: 'leadSource',
  label: 'Lead source',
  plural: 'lead sources',
  object: 'lead',
  restricted: true,
  groups: [
    { id: 'inbound', label: 'Inbound' },
    { id: 'outbound', label: 'Outbound' },
  ],
  standardValues: [
    { id: 'web', label: 'Web', group: 'inbound' },
    { id: 'phone-inquiry', label: 'Phone inquiry', group: 'inbound' },
    { id: 'email-inquiry', label: 'Email inquiry', group: 'inbound' },
    { id: 'partner-referral', label: 'Partner referral', group: 'inbound' },
    { id: 'employee-referral', label: 'Employee referral', group: 'inbound' },
    { id: 'external-referral', label: 'External referral', group: 'inbound' },
    { id: 'advertisement', label: 'Advertisement', group: 'inbound' },
    { id: 'trade-show', label: 'Trade show', group: 'inbound' },
    { id: 'webinar', label: 'Webinar', group: 'inbound' },
    { id: 'word-of-mouth', label: 'Word of mouth', group: 'inbound' },
    // Aglyn's own doors (AGL-3519), each stamped by the door that met the person.
    { id: 'website-form', label: 'Website form', group: 'inbound' },
    { id: 'booking', label: 'Booking', group: 'inbound' },
    { id: 'newsletter-sign-up', label: 'Newsletter sign-up', group: 'inbound' },
    { id: 'site-member-sign-up', label: 'Site member sign-up', group: 'inbound' },
    { id: 'online-purchase', label: 'Online purchase', group: 'inbound' },
    { id: 'account-sign-up', label: 'Account sign-up', group: 'inbound' },
    { id: 'purchased-list', label: 'Purchased list', group: 'outbound' },
    // Aglyn's own outreach (AGL-3519).
    { id: 'sequence', label: 'Sequence', group: 'outbound' },
    { id: 'email-campaign', label: 'Email campaign', group: 'outbound' },
    { id: 'other', label: 'Other' },
  ],
  targets: [
    // The key the Leads list filters by moves with the label (AGL-3321).
    // So is its direction, the value's group (AGL-3577).
    {
      object: 'lead',
      field: 'leadSource',
      keyField: 'leadSourceKey',
      groupField: 'leadSourceDirection',
    },
    // A contact's lead source is each holder's own, like the rest of its profile.
    { object: 'contact', field: 'leadSource', facet: true },
    // A company's Account Source is a lead source value (AGL-3514).
    { object: 'company', field: 'accountSource', keyField: 'accountSourceKey' },
    // A deal's, stamped by the conversion that opened it (AGL-3516).
    { object: 'deal', field: 'leadSource', keyField: 'leadSourceKey' },
  ],
} as const satisfies CrmPicklistDefinition

/*------------------------------------------
 * LEAD STATUS (AGL-3512) — a SEMANTIC picklist.
 *
 * Every value MEANS one of {@link CRM_LEAD_STATUSES}, and the meaning stays
 * on the lead as `status`, which every query, count, index, automation and
 * rule reads exactly as before. The value's label sits beside it as
 * `statusLabel` — see {@link crmLeadStatusLabel}. Salesforce ships one
 * standard value per meaning; an org adds its own ("Contacted", "Meeting
 * set") under a meaning, never under Qualified, which only a conversion
 * sets.
 *-----------------------------------------*/
const LEAD_STATUS_DEFINITION = {
  id: 'leadStatus',
  label: 'Lead status',
  plural: 'lead statuses',
  object: 'lead',
  restricted: true,
  meanings: CRM_LEAD_STATUSES,
  meaningLabels: CRM_LEAD_STATUS_LABELS,
  reservedMeanings: ['qualified'],
  standardValues: [
    { id: 'new', label: CRM_LEAD_STATUS_LABELS.new, meaning: 'new' },
    { id: 'nurturing', label: CRM_LEAD_STATUS_LABELS.nurturing, meaning: 'nurturing' },
    { id: 'working', label: CRM_LEAD_STATUS_LABELS.working, meaning: 'working' },
    { id: 'qualified', label: CRM_LEAD_STATUS_LABELS.qualified, meaning: 'qualified' },
    { id: 'unqualified', label: CRM_LEAD_STATUS_LABELS.unqualified, meaning: 'unqualified' },
  ],
  targets: [{ object: 'lead', field: 'statusLabel' }],
} as const satisfies CrmPicklistDefinition

/*------------------------------------------
 * THE COMPANY PICKLISTS (AGL-3514).
 *
 * Salesforce's Account Type, Industry, Rating and Ownership, each kept on
 * the Companies tab. Industry and Rating are shared with leads, whose
 * targets join these definitions rather than repeating them. Account
 * Source is not a list of its own: it holds a lead source value, so it is
 * a target of the lead source definition above.
 *-----------------------------------------*/

/** Salesforce's Account Type. */
const ACCOUNT_TYPE_DEFINITION = {
  id: 'accountType',
  label: 'Type',
  plural: 'account types',
  object: 'company',
  restricted: true,
  standardValues: [
    { id: 'analyst', label: 'Analyst' },
    { id: 'press', label: 'Press' },
    { id: 'competitor', label: 'Competitor' },
    { id: 'prospect', label: 'Prospect' },
    { id: 'customer', label: 'Customer' },
    { id: 'reseller', label: 'Reseller' },
    { id: 'integrator', label: 'Integrator' },
    { id: 'investor', label: 'Investor' },
    { id: 'partner', label: 'Partner' },
    { id: 'consulting', label: 'Consulting' },
    { id: 'other', label: 'Other' },
  ],
  targets: [{ object: 'company', field: 'type', keyField: 'typeKey' }],
} as const satisfies CrmPicklistDefinition

/**
 * Salesforce's Industry. A company written while the field was free text
 * keeps its text; a write that keeps it is never refused.
 */
const INDUSTRY_DEFINITION = {
  id: 'industry',
  label: 'Industry',
  plural: 'industries',
  object: 'company',
  restricted: true,
  standardValues: [
    { id: 'agriculture', label: 'Agriculture' },
    { id: 'apparel', label: 'Apparel' },
    { id: 'banking', label: 'Banking' },
    { id: 'biotechnology', label: 'Biotechnology' },
    { id: 'chemicals', label: 'Chemicals' },
    { id: 'communications', label: 'Communications' },
    { id: 'construction', label: 'Construction' },
    { id: 'consulting', label: 'Consulting' },
    { id: 'education', label: 'Education' },
    { id: 'electronics', label: 'Electronics' },
    { id: 'energy', label: 'Energy' },
    { id: 'engineering', label: 'Engineering' },
    { id: 'entertainment', label: 'Entertainment' },
    { id: 'environmental', label: 'Environmental' },
    { id: 'finance', label: 'Finance' },
    { id: 'food-and-beverage', label: 'Food & Beverage' },
    { id: 'government', label: 'Government' },
    { id: 'healthcare', label: 'Healthcare' },
    { id: 'hospitality', label: 'Hospitality' },
    { id: 'insurance', label: 'Insurance' },
    { id: 'machinery', label: 'Machinery' },
    { id: 'manufacturing', label: 'Manufacturing' },
    { id: 'media', label: 'Media' },
    { id: 'not-for-profit', label: 'Not For Profit' },
    { id: 'recreation', label: 'Recreation' },
    { id: 'retail', label: 'Retail' },
    { id: 'shipping', label: 'Shipping' },
    { id: 'technology', label: 'Technology' },
    { id: 'telecommunications', label: 'Telecommunications' },
    { id: 'transportation', label: 'Transportation' },
    { id: 'utilities', label: 'Utilities' },
    { id: 'other', label: 'Other' },
  ],
  targets: [
    { object: 'company', field: 'industry', keyField: 'industryKey' },
    // Leads (AGL-3513): the same list, so a lead converts into its value.
    { object: 'lead', field: 'industry', keyField: 'industryKey' },
  ],
} as const satisfies CrmPicklistDefinition

/** Salesforce's Rating. */
const RATING_DEFINITION = {
  id: 'rating',
  label: 'Rating',
  plural: 'ratings',
  object: 'company',
  restricted: true,
  standardValues: [
    { id: 'hot', label: 'Hot' },
    { id: 'warm', label: 'Warm' },
    { id: 'cold', label: 'Cold' },
  ],
  targets: [
    { object: 'company', field: 'rating', keyField: 'ratingKey' },
    // Leads (AGL-3513).
    { object: 'lead', field: 'rating', keyField: 'ratingKey' },
  ],
} as const satisfies CrmPicklistDefinition

/** Salesforce's Ownership. */
const OWNERSHIP_DEFINITION = {
  id: 'ownership',
  label: 'Ownership',
  plural: 'ownership values',
  object: 'company',
  restricted: true,
  standardValues: [
    { id: 'public', label: 'Public' },
    { id: 'private', label: 'Private' },
    { id: 'subsidiary', label: 'Subsidiary' },
    { id: 'other', label: 'Other' },
  ],
  targets: [{ object: 'company', field: 'ownership' }],
} as const satisfies CrmPicklistDefinition

/*------------------------------------------
 * CONTACT picklists (AGL-3515).
 *-----------------------------------------*/

/**
 * Salutation, with Salesforce's standard values. Shared by every object
 * that addresses a person: defined here with the contact target, where the
 * label lives in each holder's facet like the rest of the profile.
 */
const SALUTATION_DEFINITION = {
  id: 'salutation',
  label: 'Salutation',
  plural: 'salutations',
  object: 'contact',
  restricted: true,
  standardValues: [
    { id: 'mr', label: 'Mr.' },
    { id: 'ms', label: 'Ms.' },
    { id: 'mrs', label: 'Mrs.' },
    { id: 'dr', label: 'Dr.' },
    { id: 'prof', label: 'Prof.' },
  ],
  targets: [
    { object: 'contact', field: 'salutation', facet: true },
    // Leads (AGL-3513): on the lead itself, carried to the facet on convert.
    { object: 'lead', field: 'salutation' },
  ],
} as const satisfies CrmPicklistDefinition

/*------------------------------------------
 * DEALS (AGL-3516).
 *-----------------------------------------*/

/**
 * Salesforce's Opportunity Type. Plain: the deal stores the label, and
 * `typeKey` beside it for the Deals list's filter.
 */
const OPPORTUNITY_TYPE_DEFINITION = {
  id: 'opportunityType',
  label: 'Type',
  plural: 'deal types',
  object: 'deal',
  restricted: true,
  standardValues: [
    { id: 'existing-business', label: 'Existing Business' },
    { id: 'new-business', label: 'New Business' },
  ],
  targets: [{ object: 'deal', field: 'type', keyField: 'typeKey' }],
} as const satisfies CrmPicklistDefinition

/**
 * Salesforce's Opportunity Contact Role (AGL-3521): the part a contact
 * plays on a deal. Plain; the label sits in each entry of the deal's
 * `contactRoles`, and `contactRoleKeys` lists their keys, which is how a
 * rename or a delete finds the deals to rewrite.
 */
const OPPORTUNITY_CONTACT_ROLE_DEFINITION = {
  id: 'opportunityContactRole',
  label: 'Contact role',
  plural: 'contact roles',
  object: 'deal',
  restricted: true,
  standardValues: [
    { id: 'business-user', label: 'Business User' },
    { id: 'decision-maker', label: 'Decision Maker' },
    { id: 'economic-buyer', label: 'Economic Buyer' },
    { id: 'economic-decision-maker', label: 'Economic Decision Maker' },
    { id: 'evaluator', label: 'Evaluator' },
    { id: 'executive-sponsor', label: 'Executive Sponsor' },
    { id: 'influencer', label: 'Influencer' },
    { id: 'technical-buyer', label: 'Technical Buyer' },
    { id: 'other', label: 'Other' },
  ],
  targets: [{ object: 'deal', field: 'contactRoles', arrayKey: 'role', keyField: 'contactRoleKeys' }],
} as const satisfies CrmPicklistDefinition

/*
 * TASKS (AGL-3517) — Salesforce's Task Status, Priority, Type and Subject.
 *
 * Status, Priority and Type are SEMANTIC: each value means one of the
 * task's existing `status`, `priority` or `kind` values, which stay on the
 * document untouched for every query, reminder, due state, digest and
 * automation. The value's LABEL sits beside it in `statusLabel`,
 * `priorityLabel` or `typeLabel`; a task with no label shows the first
 * active value of its meaning (see `crmTaskPicklistLabel`). Subject is an
 * unrestricted combobox over the title: its values are suggestions, the
 * title stays free text, and no record holds a subject "value", so a
 * rename or a delete rewrites nothing.
 */
const TASK_STATUS_DEFINITION = {
  id: 'taskStatus',
  label: 'Status',
  plural: 'task statuses',
  object: 'task',
  restricted: true,
  meanings: ['open', 'done'],
  standardValues: [
    { id: 'not-started', label: 'Not Started', meaning: 'open' },
    { id: 'in-progress', label: 'In Progress', meaning: 'open' },
    { id: 'waiting', label: 'Waiting on someone else', meaning: 'open' },
    { id: 'deferred', label: 'Deferred', meaning: 'open' },
    { id: 'completed', label: 'Completed', meaning: 'done' },
  ],
  defaultValueId: 'not-started',
  targets: [{ object: 'task', field: 'statusLabel' }],
} as const satisfies CrmPicklistDefinition

const TASK_PRIORITY_DEFINITION = {
  id: 'taskPriority',
  label: 'Priority',
  plural: 'task priorities',
  object: 'task',
  restricted: true,
  meanings: ['low', 'normal', 'high'],
  standardValues: [
    { id: 'high', label: 'High', meaning: 'high' },
    { id: 'normal', label: 'Normal', meaning: 'normal' },
    { id: 'low', label: 'Low', meaning: 'low' },
  ],
  defaultValueId: 'normal',
  targets: [{ object: 'task', field: 'priorityLabel' }],
} as const satisfies CrmPicklistDefinition

const TASK_TYPE_DEFINITION = {
  id: 'taskType',
  label: 'Type',
  plural: 'task types',
  object: 'task',
  restricted: true,
  meanings: CRM_TASK_KINDS,
  standardValues: [
    { id: 'call', label: 'Call', meaning: 'call' },
    { id: 'email', label: 'Email', meaning: 'email' },
    { id: 'meeting', label: 'Meeting', meaning: 'meeting' },
    // Salesforce's "Other": a task that is none of the three conversations.
    { id: 'todo', label: 'To-do', meaning: 'todo' },
  ],
  defaultValueId: 'todo',
  targets: [{ object: 'task', field: 'typeLabel' }],
} as const satisfies CrmPicklistDefinition

const TASK_SUBJECT_DEFINITION = {
  id: 'taskSubject',
  label: 'Subject',
  plural: 'task subjects',
  object: 'task',
  restricted: false,
  standardValues: [
    { id: 'call', label: 'Call' },
    { id: 'send-letter', label: 'Send Letter' },
    { id: 'send-quote', label: 'Send Quote' },
    { id: 'other', label: 'Other' },
  ],
  // Suggestions for a free-text title: nothing holds them, nothing moves.
  targets: [],
} as const satisfies CrmPicklistDefinition

/** Every standard picklist field the CRM keeps, one document each. */
export const CRM_PICKLIST_DEFINITIONS = [
  LEAD_SOURCE_DEFINITION,
  LEAD_STATUS_DEFINITION,
  // Companies (AGL-3514).
  ACCOUNT_TYPE_DEFINITION,
  INDUSTRY_DEFINITION,
  RATING_DEFINITION,
  OWNERSHIP_DEFINITION,
  // Contacts (AGL-3515).
  SALUTATION_DEFINITION,
  // Deals (AGL-3516).
  OPPORTUNITY_TYPE_DEFINITION,
  // Deal contact roles (AGL-3521).
  OPPORTUNITY_CONTACT_ROLE_DEFINITION,
  // Tasks (AGL-3517).
  TASK_STATUS_DEFINITION,
  TASK_PRIORITY_DEFINITION,
  TASK_TYPE_DEFINITION,
  TASK_SUBJECT_DEFINITION,
] as const satisfies readonly CrmPicklistDefinition[]

export type CrmPicklistId = (typeof CRM_PICKLIST_DEFINITIONS)[number]['id']

/** The picklists an org keeps, by document id. */
export const CRM_PICKLIST_IDS: readonly CrmPicklistId[] = CRM_PICKLIST_DEFINITIONS.map(
  (definition) => definition.id,
)

/** The lead source value set's document id. */
export const CRM_LEAD_SOURCE_PICKLIST: CrmPicklistId = 'leadSource'

/** The salutation value set's document id (AGL-3515). */
export const CRM_SALUTATION_PICKLIST: CrmPicklistId = 'salutation'
/** A deal's Type value set's document id (AGL-3516). */
export const CRM_OPPORTUNITY_TYPE_PICKLIST: CrmPicklistId = 'opportunityType'
/** A deal contact's role value set's document id (AGL-3521). */
export const CRM_OPPORTUNITY_CONTACT_ROLE_PICKLIST: CrmPicklistId = 'opportunityContactRole'

/**
 * The built-in Lead source value each first-party door stamps (AGL-3519), by
 * the door's word for how it met a person — a capture's source, or the
 * outreach that reached them. `api`, `import` and `manual` are ways a record
 * was ADDED, not where a person came from, and stamp nothing.
 */
export const CRM_LEAD_SOURCE_ORIGINS: Readonly<Record<string, string>> = {
  form: 'website-form',
  booking: 'booking',
  newsletter: 'newsletter-sign-up',
  member: 'site-member-sign-up',
  order: 'online-purchase',
  account: 'account-sign-up',
  sequence: 'sequence',
  emailCampaign: 'email-campaign',
}

export function isCrmPicklistId(value: unknown): value is CrmPicklistId {
  return typeof value === 'string' && (CRM_PICKLIST_IDS as readonly string[]).includes(value)
}

/** The definition an id names, or `null` for one the registry does not hold. */
export function crmPicklistDefinition(id: unknown): CrmPicklistDefinition | null {
  return CRM_PICKLIST_DEFINITIONS.find((definition) => definition.id === id) ?? null
}

/** The definitions whose values are managed on one Fields tab, in registry order. */
export function crmPicklistDefinitionsFor(object: CrmPicklistObject): CrmPicklistDefinition[] {
  return CRM_PICKLIST_DEFINITIONS.filter((definition) => definition.object === object)
}

/** The definition behind a registered id — total, because the id is typed. */
function definitionOf(id: CrmPicklistId): CrmPicklistDefinition {
  return crmPicklistDefinition(id) as CrmPicklistDefinition
}

/** The most values one picklist holds — a menu, not a table. */
export const CRM_PICKLIST_VALUES_MAX = PICKLIST_VALUES_MAX

/** One value of a picklist. `id` never changes; `label` is what records store. */
export type CrmPicklistValue = PicklistValue

/** A picklist as stored and as every reader takes it. */
export type CrmPicklist = PicklistValueSet

/** One option of a picklist select. */
export type CrmPicklistOption = PicklistOption

/**
 * The values an org without a lead source document offered before the
 * standard set was built in. "Referral" and "Partner" are not standard: a
 * record holding one, in an org that never stored its list, reads as not in
 * the list until the value is written down as the org's own.
 */
export const CRM_LEAD_SOURCE_STARTER_LABELS: readonly string[] = [
  'Web',
  'Phone inquiry',
  'Referral',
  'Partner',
  'Purchased list',
  'Trade show',
  'Other',
]

/** A label as a picklist stores it: trimmed, single-spaced, capped. */
export const normalizeCrmPicklistLabel = normalizePicklistLabel

/** A new value's id — see `mintPicklistValueId`. */
export const crmPicklistValueId = mintPicklistValueId

/** A picklist of active values from labels, in order, with no default. */
export const crmPicklistFromLabels = picklistFromLabels

/**
 * A stored document as a picklist, or `null` for one that holds none —
 * tolerant, as `normalizePicklistValueSet` reads it, and without the
 * standard values merged in. {@link effectiveCrmPicklist} is what a reader
 * judges against.
 */
export function normalizeCrmPicklist(raw: unknown): CrmPicklist | null {
  return normalizePicklistValueSet(raw)
}

/** An org's list for one picklist as every reader should take it — see the block header. */
export function effectiveCrmPicklist(id: CrmPicklistId, raw: unknown): CrmPicklist {
  return effectivePicklistValueSet(definitionOf(id), raw)
}

/** The org's lead source list as every reader should take it. */
export function effectiveCrmLeadSourcePicklist(raw: unknown): CrmPicklist {
  return effectiveCrmPicklist(CRM_LEAD_SOURCE_PICKLIST, raw)
}

/**
 * The label a door stamps for `origin` (AGL-3519): its built-in value as the
 * org spells it, while that value is ACTIVE — an org that deactivated it has
 * said not to file people under it — else `null`, as for a word with none.
 */
export function crmLeadSourceForOrigin(picklist: CrmPicklist, origin: unknown): string | null {
  const id = typeof origin === 'string' ? CRM_LEAD_SOURCE_ORIGINS[origin] : undefined
  if (!id || !Object.hasOwn(CRM_LEAD_SOURCE_ORIGINS, origin as string)) return null
  const value = picklist.values.find((entry) => entry.id === id)
  return value?.active ? value.label : null
}

/** Whether a value is one of a picklist's standard values — computed from its id, never stored. */
export function isStandardCrmPicklistValue(id: CrmPicklistId, valueId: string): boolean {
  return isStandardPicklistValueId(definitionOf(id), valueId)
}

/** The value a label names, in any case or spacing — `null` for none. */
export const crmPicklistValueByLabel = picklistValueByLabel

/** The values a picker offers. */
export const crmPicklistActiveValues = picklistActiveValues

/** The label a new record starts with — only while the default value is active. */
export const crmPicklistDefaultLabel = picklistDefaultLabel

/**
 * The sentence a value outside a restricted picklist is refused with,
 * naming what the list allows, and where to add one when it allows none.
 */
export function crmPicklistRefusal(id: CrmPicklistId, picklist: CrmPicklist): string {
  const definition = definitionOf(id)
  return picklistRefusalSentence(picklist, {
    field: definition.label,
    empty:
      `This organization has no active ${definition.plural}. Add one under ` +
      `CRM › Fields › ${CRM_PICKLIST_OBJECT_LABELS[definition.object]}.`,
  })
}

/** The sentence a lead source outside the list is refused with. */
export function crmLeadSourceRefusal(picklist: CrmPicklist): string {
  return crmPicklistRefusal(CRM_LEAD_SOURCE_PICKLIST, picklist)
}

/**
 * Whether a write may store `value` as a record's value of picklist `id`,
 * and the label it stores — `judgePicklistValue` under the definition's
 * restriction: blank clears, an active value stores the list's spelling,
 * the record's `current` value is always kept, and on a restricted
 * picklist anything else is refused with {@link crmPicklistRefusal}.
 */
export function judgeCrmPicklistValue(
  id: CrmPicklistId,
  picklist: CrmPicklist,
  value: unknown,
  current?: unknown,
): PicklistJudgement {
  return judgePicklistValue(picklist, value, {
    restricted: definitionOf(id).restricted,
    current,
    refusal: () => crmPicklistRefusal(id, picklist),
  })
}

/**
 * A deal's contact roles with each role judged against the org's
 * `opportunityContactRole` list (AGL-3521): an active value stored as the
 * list spells it, a blank cleared, and the role a contact already holds on
 * the deal (`current`) kept — or the first refusal, naming what the list
 * allows.
 */
export function judgeDealContactRoles(
  picklist: CrmPicklist,
  roles: readonly CrmDealContactRole[],
  current: readonly CrmDealContactRole[] = [],
): { ok: true; roles: CrmDealContactRole[] } | { ok: false; error: string } {
  const judged: CrmDealContactRole[] = []
  for (const row of roles) {
    const held = current.find((entry) => entry.contactId === row.contactId)?.role
    const verdict = judgeCrmPicklistValue(
      'opportunityContactRole',
      picklist,
      row.role ?? '',
      held,
    )
    if (verdict.ok === false) return verdict
    judged.push({
      contactId: row.contactId,
      ...(verdict.value ? { role: verdict.value } : {}),
      primary: row.primary,
    })
  }
  return { ok: true, roles: judged }
}

/** {@link judgeCrmPicklistValue} for the lead source. */
export function judgeCrmLeadSource(
  picklist: CrmPicklist,
  value: unknown,
  current?: unknown,
): PicklistJudgement {
  return judgeCrmPicklistValue(CRM_LEAD_SOURCE_PICKLIST, picklist, value, current)
}

/**
 * What a select offers for a record holding `current`: every active value
 * in order, then the record's own value when the list would not otherwise
 * show it, so the select keeps what the record holds until it is changed.
 */
export const crmPicklistOptions = picklistOptions

/**
 * Where a label sorts: its value's position in the list, unlisted values
 * after every listed one, and a record with none last. The order the admin
 * chose is the order a sort by the field reads in, as Salesforce's does.
 */
export const crmPicklistRank = picklistRank

/*------------------------------------------
 * A LEAD'S STATUS LABEL (AGL-3512).
 *
 * `status` is the meaning and stays the truth: a writer that knows only the
 * meaning — an automation, an inbox reply, a rule — sets `status` alone and
 * the lead still reads right. `statusLabel` names which of the org's values
 * of that meaning the lead holds, and is believed only while it IS one of
 * that meaning; otherwise, or when absent, the lead shows the default value
 * when it is active and of that meaning, else the first active value of
 * that meaning, else the standard label.
 *-----------------------------------------*/

/** The lead status value set's document id. */
export const CRM_LEAD_STATUS_PICKLIST: CrmPicklistId = 'leadStatus'

/** The field a lead's status label is stored in, beside `status`. */
export const CRM_LEAD_STATUS_LABEL_FIELD = 'statusLabel'

/** The org's lead status list as every reader should take it. */
export function effectiveCrmLeadStatusPicklist(raw: unknown): CrmPicklist {
  return effectiveCrmPicklist(CRM_LEAD_STATUS_PICKLIST, raw)
}

/** The standard lead statuses alone — what a reader answers before the org's list is read. */
export const STANDARD_CRM_LEAD_STATUS_PICKLIST: CrmPicklist = effectiveCrmLeadStatusPicklist(null)

/**
 * The value a lead with `status` shows when it names none of its own: the
 * default when active and of that meaning, else the first active value of
 * that meaning, else the first of that meaning at all.
 */
export function crmLeadStatusValueFor(
  picklist: CrmPicklist,
  status: CrmLeadStatus,
): CrmPicklistValue | null {
  const ofMeaning = picklist.values.filter((value) => value.meaning === status)
  const preferred = ofMeaning.find((value) => value.id === picklist.defaultValueId && value.active)
  return preferred ?? ofMeaning.find((value) => value.active) ?? ofMeaning[0] ?? null
}

/** The label a writer stamps beside `status` when it sets a meaning and names no value. */
export function crmLeadStatusLabelFor(picklist: CrmPicklist, status: CrmLeadStatus): string {
  return crmLeadStatusValueFor(picklist, status)?.label ?? CRM_LEAD_STATUS_LABELS[status]
}

/**
 * How a lead's status reads: its own `statusLabel` while that is a value of
 * its `status`'s meaning (as the list spells it), else the meaning's label
 * by {@link crmLeadStatusLabelFor}. A label the list no longer holds is shown
 * as stored while nothing contradicts it — a value deleted without moving
 * every lead off it reads as what the lead was given.
 */
export function crmLeadStatusLabel(
  lead: Pick<CrmLeadFields, 'status' | 'statusLabel'> | null | undefined,
  picklist: CrmPicklist = STANDARD_CRM_LEAD_STATUS_PICKLIST,
): string {
  const status = crmLeadStatus(lead)
  const held = normalizeCrmPicklistLabel(lead?.statusLabel)
  if (held) {
    const value = picklistValueByLabel(picklist, held)
    if (value?.meaning === status) return value.label
    if (!value) return held
  }
  return crmLeadStatusLabelFor(picklist, status)
}

/** A status write, as both fields a lead stores — or why it is refused. */
export type CrmLeadStatusWrite =
  | { ok: true; status: CrmLeadStatus; statusLabel: string }
  | { ok: false; error: string }

/**
 * What a write naming a lead status stores (AGL-3512): an ACTIVE value's
 * label, in any case or spacing, stores its meaning and its label; one of
 * the meanings themselves (`working`) stores that meaning and the label
 * {@link crmLeadStatusLabelFor} gives it; the lead's `current` label is
 * kept even when inactive. `allowed` narrows the meanings this door may
 * set — every door but a conversion leaves Qualified out — and anything
 * else is refused naming what the door accepts.
 */
export function resolveCrmLeadStatusWrite(
  picklist: CrmPicklist,
  requested: unknown,
  options: {
    allowed?: readonly CrmLeadStatus[]
    current?: Pick<CrmLeadFields, 'status' | 'statusLabel'> | null
  } = {},
): CrmLeadStatusWrite {
  const allowed = options.allowed ?? CRM_LEAD_STATUSES
  const text = normalizeCrmPicklistLabel(requested)
  const refuse = (): CrmLeadStatusWrite => {
    const labels = picklist.values
      .filter((value) => value.active && allowed.includes(value.meaning as CrmLeadStatus))
      .map((value) => value.label)
    return { ok: false, error: `Lead status must be one of: ${labels.join(', ')}.` }
  }
  if (!text) return refuse()
  const value = picklistValueByLabel(picklist, text)
  const current = options.current ? normalizeCrmPicklistLabel(options.current.statusLabel) : ''
  const keeps = Boolean(value && current && picklistLabelKeyOf(current) === picklistLabelKeyOf(value.label))
  if (value && isCrmLeadStatus(value.meaning) && (value.active || keeps)) {
    return allowed.includes(value.meaning)
      ? { ok: true, status: value.meaning, statusLabel: value.label }
      : refuse()
  }
  const meaning = text.toLowerCase()
  if (isCrmLeadStatus(meaning) && allowed.includes(meaning)) {
    return { ok: true, status: meaning, statusLabel: crmLeadStatusLabelFor(picklist, meaning) }
  }
  return refuse()
}

const picklistLabelKeyOf = (label: string): string => normalizeCrmPicklistLabel(label).toLowerCase()

/**
 * The values a lead status select offers for a lead holding `current`:
 * every active value whose meaning `allowed` admits, in the list's order,
 * then the lead's own value when the list would not otherwise show it.
 */
export function crmLeadStatusOptions(
  picklist: CrmPicklist,
  allowed: readonly CrmLeadStatus[] = CRM_LEAD_STATUSES,
  current?: Pick<CrmLeadFields, 'status' | 'statusLabel'> | null,
): Array<{ label: string; status: CrmLeadStatus; inactive: boolean }> {
  const options = picklist.values
    .filter((value) => value.active && allowed.includes(value.meaning as CrmLeadStatus))
    .map((value) => ({ label: value.label, status: value.meaning as CrmLeadStatus, inactive: false }))
  if (current) {
    const label = crmLeadStatusLabel(current, picklist)
    if (!options.some((option) => option.label === label)) {
      options.push({ label, status: crmLeadStatus(current), inactive: true })
    }
  }
  return options
}

/*==========================================
 * SEMANTIC PICKLISTS ON A TASK (AGL-3517).
 *
 * Status, Priority and Type keep the task's own `status`, `priority` and
 * `kind` as the MEANING every query, reminder and automation reads, and
 * store the org's label beside it. These helpers are the two directions:
 * what a task shows for its meaning and label, and what a write stores for
 * a label or a meaning a person, a file or an API caller named.
 *=========================================*/

/** The label a value of `meaning` reads as: the first active one, else the first at all. */
export function crmPicklistMeaningLabel(picklist: CrmPicklist, meaning: unknown): string | null {
  if (typeof meaning !== 'string' || !meaning) return null
  const held = picklist.values.filter((value) => value.meaning === meaning)
  return (held.find((value) => value.active) ?? held[0])?.label ?? null
}

/**
 * What a record shows for a semantic field: its own label when it holds
 * one, else the first active value of its meaning, else the meaning itself.
 */
export function crmPicklistShownLabel(
  picklist: CrmPicklist,
  meaning: unknown,
  label: unknown,
): string {
  const own = normalizeCrmPicklistLabel(label)
  if (own) return own
  return crmPicklistMeaningLabel(picklist, meaning) ?? String(meaning ?? '')
}

/**
 * The label a NEW record of `meaning` starts with: the list's default when
 * it means that, else the first active value that does.
 */
export function crmPicklistLabelForNew(picklist: CrmPicklist, meaning: unknown): string | null {
  const fallback = crmPicklistDefaultLabel(picklist)
  const value = fallback ? crmPicklistValueByLabel(picklist, fallback) : null
  return value && value.meaning === meaning ? value.label : crmPicklistMeaningLabel(picklist, meaning)
}

/** What a semantic write stores: the meaning and the label beside it. */
export type CrmSemanticPicklistWrite =
  | { ok: true; meaning: string; label: string | null }
  | { ok: false; error: string }

/**
 * A label OR a meaning, as a write names it, resolved against picklist `id`:
 *
 *  - an active value's label (any case or spacing) stores that value's
 *    label and its meaning;
 *  - the record's `current` label is kept, with its value's meaning, even
 *    when the value has since been deactivated;
 *  - one of the definition's meanings (`high`, `done`, `call`) stores that
 *    meaning with the first active value's label — or the record's current
 *    label when that already means it;
 *  - anything else is refused naming the values the list allows.
 *
 * `null` answers a blank input: the caller keeps its own default.
 */
export function resolveCrmSemanticPicklistWrite(
  id: CrmPicklistId,
  picklist: CrmPicklist,
  input: unknown,
  current?: unknown,
): CrmSemanticPicklistWrite | null {
  const text = normalizeCrmPicklistLabel(input)
  if (!text) return null
  const definition = definitionOf(id)
  const meanings = (definition.meanings ?? []) as readonly string[]
  const held = normalizeCrmPicklistLabel(current)
  const byLabel = crmPicklistValueByLabel(picklist, text)
  const keeps = held && held.toLowerCase() === text.toLowerCase()
  if (byLabel?.meaning && (byLabel.active || keeps)) {
    return { ok: true, meaning: byLabel.meaning, label: keeps ? held : byLabel.label }
  }
  const meaning = meanings.find((entry) => entry === text.toLowerCase())
  if (meaning) {
    const heldValue = held ? crmPicklistValueByLabel(picklist, held) : null
    return {
      ok: true,
      meaning,
      label: heldValue?.meaning === meaning ? held : crmPicklistMeaningLabel(picklist, meaning),
    }
  }
  return { ok: false, error: crmPicklistRefusal(id, picklist) }
}

/** A task's three semantic picklists, as every task surface reads them. */
export interface CrmTaskPicklists {
  status: CrmPicklist
  priority: CrmPicklist
  type: CrmPicklist
}

/** The picklist id behind each of a task's semantic fields. */
export const CRM_TASK_PICKLIST_IDS = {
  status: 'taskStatus',
  priority: 'taskPriority',
  type: 'taskType',
} as const satisfies Record<keyof CrmTaskPicklists, CrmPicklistId>

/** The org's three task lists from their stored documents — standard values alone for none. */
export function effectiveCrmTaskPicklists(
  raw: Partial<Record<keyof CrmTaskPicklists, unknown>> = {},
): CrmTaskPicklists {
  return {
    status: effectiveCrmPicklist(CRM_TASK_PICKLIST_IDS.status, raw.status),
    priority: effectiveCrmPicklist(CRM_TASK_PICKLIST_IDS.priority, raw.priority),
    type: effectiveCrmPicklist(CRM_TASK_PICKLIST_IDS.type, raw.type),
  }
}

/** What a task shows for its status, priority and type — see `crmPicklistShownLabel`. */
export function crmTaskPicklistLabels(
  task: Partial<Pick<CrmTask, 'status' | 'statusLabel' | 'priority' | 'priorityLabel' | 'kind' | 'typeLabel'>>,
  picklists: CrmTaskPicklists,
): { status: string; priority: string; type: string } {
  return {
    status: crmPicklistShownLabel(picklists.status, task.status ?? 'open', task.statusLabel),
    priority: crmPicklistShownLabel(picklists.priority, task.priority ?? 'normal', task.priorityLabel),
    type: crmPicklistShownLabel(picklists.type, task.kind ?? 'todo', task.typeLabel),
  }
}

/**
 * The status a tick or an untick writes: done with the first active done
 * value's label ("Completed"), or open with the label a new task starts
 * with ("Not Started").
 */
export function crmTaskStatusWrite(
  picklist: CrmPicklist,
  done: boolean,
): { status: CrmTaskStatus; statusLabel: string | null } {
  return done
    ? { status: 'done', statusLabel: crmPicklistMeaningLabel(picklist, 'done') }
    : { status: 'open', statusLabel: crmPicklistLabelForNew(picklist, 'open') }
}

/** The labels a new task of these meanings starts with. */
export function crmTaskLabelsForNew(
  picklists: CrmTaskPicklists,
  meanings: Pick<CrmTask, 'kind' | 'priority'> & { status?: CrmTaskStatus },
): { statusLabel: string | null; priorityLabel: string | null; typeLabel: string | null } {
  return {
    statusLabel: crmPicklistLabelForNew(picklists.status, meanings.status ?? 'open'),
    priorityLabel: crmPicklistLabelForNew(picklists.priority, meanings.priority),
    typeLabel: crmPicklistLabelForNew(picklists.type, meanings.kind),
  }
}

/** The name a lead is listed under: the name it carries, else its address. */
export function crmLeadDisplayName(
  lead: Record<string, unknown> | null | undefined,
): string {
  const name = String(lead?.['name'] ?? '').trim()
  return name || String(lead?.['email'] ?? '').trim()
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

/**
 * A stored phone number as the `href` of a click-to-call link, or `null`
 * when the value is not one (AGL-2661).
 *
 * The console stores E.164 (`normalizePhone` runs before every write), and
 * a `tel:` URL wants exactly that: digits with a leading `+`, nothing else.
 * Spaces, dots, dashes and parentheses are dropped rather than refused
 * because a value written before normalization existed may carry them;
 * anything that is not a run of digits after that — a word, an extension
 * typed as `x123` — is refused, because a dialer handed it would ring
 * nothing and the link would be a lie.
 */
export function crmTelHref(phone: unknown): string | null {
  const text = String(phone ?? '').trim()
  if (!text) return null
  const compact = text.replace(/[\s().-]/g, '')
  return /^\+?\d{3,20}$/.test(compact) ? `tel:${compact}` : null
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

/*==========================================
 * FILES ON A RECORD (AGL-2662)
 *=========================================*/

/** The field a record's attached files are stored under, on all three. */
export const CRM_MEDIA_IDS_FIELD = 'mediaIds'

/**
 * The most files one record may carry.
 *
 * A platform ceiling in the family of {@link CRM_ACTIVITIES_PER_RECORD_CEILING}
 * rather than a plan dimension: attachments are bounded by human effort, and
 * this is the bound. It is also what the Firestore rules can actually check
 * — a rule can assert a list and its size, and cannot walk one — so the
 * number is enforced rather than merely documented.
 */
export const CRM_MEDIA_IDS_MAX = 20

/**
 * A stored or submitted attachment list, cleaned.
 *
 * Ids rather than URLs, deduplicated, trimmed, non-empty and capped. Written
 * through by every path that sets the field — the console card, the REST
 * write — so a record cannot hold a list one of them would refuse.
 *
 * An id is a media DOCUMENT id, resolved against the organization's library
 * (`orgs/{orgId}/media/{mediaId}`) at read time. Storing the id and not the
 * URL is what lets a file move between folders, and what keeps a private
 * asset behind the signed CDN door rather than pinned to a raw storage URL
 * that names its current location.
 */
export function normalizeCrmMediaIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .map((id) => String(id ?? '').trim())
        .filter((id) => id.length > 0 && id.length <= 200),
    ),
  ].slice(0, CRM_MEDIA_IDS_MAX)
}

/*==========================================
 * WHAT A CRM LIST QUERIES BY (AGL-3321).
 *
 * Every filter and every search word on the Leads, Contacts, Companies,
 * Deals and Tasks lists is a predicate on the list's Firestore query, and a
 * query can only ask about a field a WRITER stored in the shape the query
 * asks for. Three kinds of field exist for that and for nothing else:
 *
 *   `searchTokens`        word prefixes of what the list's search box reads
 *                         (a lead's name, address, company, title and tags;
 *                         a deal's title), for `array-contains` on one typed
 *                         word — see `nameSearchTokens`.
 *   `scopedSearchTokens`  the same tokens behind each of the record's
 *                         `visibleTo` tokens (`host:abc~acme`). A list under
 *                         a site already spends its one array clause on
 *                         `visibleTo array-contains-any`, so its search asks
 *                         `array-contains-any` over the site's tokens joined
 *                         to the word — one clause answering both.
 *   keys                  a normalized scalar where the stored value cannot
 *                         be asked as it is: a lead's status (absent on a
 *                         capture), its lead source (compared the way the
 *                         picklist compares labels), a verdict on the
 *                         address (`none` when there is none) and a contact's
 *                         per-holder facet values (`facetKeys`).
 *
 * All of them are DERIVED: a pure function of the document — save a lead's
 * `leadSourceDirection`, which is the document and the org's lead source
 * list (see `crmLeadSourceDirection`) — computed here and nowhere else,
 * and written by every path that writes one of its inputs — see
 * `CRM_LIST_FIELD_INPUTS` — so a record a list cannot find is a writer
 * that forgot, never a second formula that disagrees. A server writer that
 * holds the whole document spreads `crmListFields`; one that patched a field
 * restamps the record from what was stored (`restampCrmListFields` in the
 * admin library); the one-time backfill (`backfill-crm-list-fields.mjs`)
 * restates them for a plain Node script and is held to the same worked
 * examples (`tools/scripts/lib/org-record-list-fields.fixtures.json`), which this
 * library's spec asserts too.
 *=========================================*/

/** The search box's word-prefix tokens, on every CRM record a list searches. */
export const CRM_SEARCH_TOKENS_FIELD = 'searchTokens'
/** The same tokens behind each `visibleTo` token — see the block header. */
export const CRM_SCOPED_SEARCH_TOKENS_FIELD = 'scopedSearchTokens'
/** What joins a scope token to a search token — the platform's one join (`SCOPED_SEARCH_JOIN`). */
export const CRM_SCOPED_SEARCH_JOIN = SCOPED_SEARCH_JOIN
/**
 * The most search tokens one record keeps. A name, an address, a company
 * and a title are a few dozen prefixes; the cap is what keeps a record with
 * twenty long tags from spending hundreds of index entries on them.
 */
export const CRM_SEARCH_TOKENS_MAX = 200

/** The collections whose lists query the fields below. */
export type CrmListCollection = 'leads' | 'contacts' | 'companies' | 'deals' | 'crmTasks'

const SEARCH_KEY = nameSearchKey

/**
 * The word-prefix tokens of several values, merged: every prefix (up to
 * twelve characters) of every whitespace-separated word, lower-cased —
 * exactly `nameSearchTokens` per value — plus, for an email address, the
 * words it is made of, so `acme` finds `dana@acme.com` and `dana` does too.
 */
export function crmSearchTokens(values: readonly unknown[]): string[] {
  const tokens = new Set<string>()
  const addWord = (word: string) => {
    const capped = word.slice(0, NAME_TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      if (tokens.size >= CRM_SEARCH_TOKENS_MAX) return
      tokens.add(capped.slice(0, end))
    }
  }
  const addText = (text: string) => {
    const key = SEARCH_KEY(text)
    if (!key) return
    for (const word of key.split(' ')) {
      if (!word) continue
      addWord(word)
      // An address, a domain or a hyphenated name is also its parts.
      if (/[@.+_-]/.test(word)) {
        for (const part of word.split(/[@.+_-]+/)) if (part) addWord(part)
      }
    }
  }
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === 'string') addText(entry)
    } else if (typeof value === 'string') {
      addText(value)
    }
  }
  return [...tokens]
}

/**
 * The two search fields for a record whose search reads `values`: the
 * tokens, and the same tokens behind each of its scope tokens through the
 * platform's one scoped writer (`scopedSearchTokens`).
 */
export function crmSearchFields(
  visibleTo: unknown,
  values: readonly unknown[],
): { searchTokens: string[]; scopedSearchTokens: string[] } {
  const searchTokens = crmSearchTokens(values)
  return { searchTokens, scopedSearchTokens: scopedSearchTokens(visibleTo, searchTokens) }
}

/**
 * The address verdict as a list asks it (AGL-3245): the state's status, or
 * `none` when nothing is known — stored rather than left absent, because a
 * query cannot find a field's absence and "Nothing known" is a filter.
 */
export const CRM_EMAIL_STATUS_FIELD = 'emailStatus'
export const CRM_EMAIL_STATUS_NONE = 'none'

export function crmEmailStatusKey(record: Record<string, unknown> | null | undefined): string {
  const raw = record?.['emailState']
  const status =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['status'] : undefined
  // A status outside the vocabulary reads as nothing known, as `readEmailState` reads it.
  return isEmailStateStatus(status) ? status : CRM_EMAIL_STATUS_NONE
}

/**
 * A picklist label as a list query compares it — the key a target's
 * `keyField` holds beside the label — `null` for none.
 */
export function crmPicklistKey(value: unknown): string | null {
  const key = SEARCH_KEY(normalizeCrmPicklistLabel(value))
  return key || null
}

/** A lead's lead source as the list compares it: the picklist's key, `null` for none. */
export const CRM_LEAD_SOURCE_KEY_FIELD = 'leadSourceKey'

export function crmLeadSourceKey(value: unknown): string | null {
  return crmPicklistKey(value)
}

/*------------------------------------------
 * A LEAD'S LEAD SOURCE DIRECTION (AGL-3577).
 *
 * The group of the Lead source picklist its value sits in — Inbound for a
 * person who came to the organization, Outbound for one it went to — or
 * `null` for no lead source, a value in no group, or a label the list does
 * not hold. STORED on the lead as `leadSourceDirection`, so the Leads list
 * asks `leadSourceDirection == inbound` — one equality, however many values
 * the group holds. (It was asked as `leadSourceKey in [...]` over the
 * group's values, and Inbound holds more than one `in` may.)
 *
 * The one list field that is not a function of the record alone: it is
 * read off the org's list. So a writer passes that list
 * ({@link CrmListFieldsContext}) or, without it, writes the direction only
 * where it needs no list — `null` for a lead with no lead source — and
 * leaves a held value's direction as stored. Every move of the list that
 * can change a label's group rewrites the leads holding it (the
 * `groupField` of the picklist's lead target).
 *-----------------------------------------*/

export const CRM_LEAD_SOURCE_DIRECTION_FIELD = 'leadSourceDirection'

/** The directions a lead source can have: the Lead source picklist's groups. */
export const CRM_LEAD_SOURCE_DIRECTIONS = ['inbound', 'outbound'] as const

export type CrmLeadSourceDirection = (typeof CRM_LEAD_SOURCE_DIRECTIONS)[number]

export function isCrmLeadSourceDirection(value: unknown): value is CrmLeadSourceDirection {
  return (CRM_LEAD_SOURCE_DIRECTIONS as readonly unknown[]).includes(value)
}

/** The direction `label` has in the org's lead source list — `null` for none. */
export function crmLeadSourceDirection(
  leadSources: PicklistValueSet,
  label: unknown,
): CrmLeadSourceDirection | null {
  const group = picklistValueByLabel(leadSources, label)?.group
  return isCrmLeadSourceDirection(group) ? group : null
}

/** What a list-field writer knows beyond the record. */
export interface CrmListFieldsContext {
  /**
   * The org's Lead source list as every reader takes it
   * (`effectiveCrmLeadSourcePicklist`), which a lead's direction is read
   * off. Without it a lead holding a lead source keeps the direction it has.
   */
  leadSources?: PicklistValueSet | null
}

/** A lead's direction field — see the block above. */
function leadSourceDirectionField(
  lead: Record<string, unknown>,
  context: CrmListFieldsContext,
): { leadSourceDirection?: CrmLeadSourceDirection | null } {
  if (!crmLeadSourceKey(lead['leadSource'])) return { leadSourceDirection: null }
  return context.leadSources
    ? { leadSourceDirection: crmLeadSourceDirection(context.leadSources, lead['leadSource']) }
    : {}
}

/** What a lead's search box reads (AGL-3246). */
export const CRM_LEAD_SEARCH_SOURCES = ['name', 'email', 'company', 'jobTitle', 'tags'] as const

/**
 * A lead's campaigns behind each of its `visibleTo` tokens
 * (`host:abc~{campaignId}`), for the Leads list's Campaign filter under a
 * site: there the scope clause is the query's one array clause, and a
 * campaign asked of these keys answers both at once — the way the search
 * folds into the scope through `scopedSearchTokens`.
 */
export const CRM_LEAD_SCOPED_CAMPAIGNS_FIELD = 'scopedCampaignIds'

function leadCampaignIds(lead: Record<string, unknown>): string[] {
  const raw = lead['campaignIds']
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
}

/**
 * Every field the Leads list queries by, from the lead as stored (or as it
 * will be once written): the search tokens, its campaigns behind its scope,
 * the status — `new` for a lead nobody has touched, written so `status in
 * [new, working]` finds it — the lead source key and the address verdict.
 */
export function crmLeadListFields(
  record: object,
  context: CrmListFieldsContext = {},
): {
  searchTokens: string[]
  scopedSearchTokens: string[]
  scopedCampaignIds: string[]
  status: CrmLeadStatus
  leadSourceKey: string | null
  /** Absent when the lead holds a lead source and no list was given. */
  leadSourceDirection?: CrmLeadSourceDirection | null
  emailStatus: string
  industryKey: string | null
  ratingKey: string | null
} {
  const lead = record as Record<string, unknown>
  return {
    ...crmSearchFields(
      lead['visibleTo'],
      CRM_LEAD_SEARCH_SOURCES.map((field) => lead[field]),
    ),
    scopedCampaignIds: scopedSearchTokens(lead['visibleTo'], leadCampaignIds(lead)),
    status: crmLeadStatus(lead as Pick<CrmLeadFields, 'status'>),
    leadSourceKey: crmLeadSourceKey(lead['leadSource']),
    // Its group in the org's list (AGL-3577).
    ...leadSourceDirectionField(lead, context),
    emailStatus: crmEmailStatusKey(lead),
    // The Industry and Rating the Leads list filters by (AGL-3513).
    industryKey: crmPicklistKey(lead['industry']),
    ratingKey: crmPicklistKey(lead['rating']),
  }
}

/** What a company's search box reads: its name and its domain. */
export const CRM_COMPANY_SEARCH_SOURCES = ['name', 'domain'] as const

/**
 * Every field the Companies list queries by: the search tokens, and the
 * key of each picklist field that names one (AGL-3514) — `null` for none,
 * so "no value" is a value a query can ask for.
 */
export function crmCompanyListFields(record: object): {
  searchTokens: string[]
  scopedSearchTokens: string[]
  typeKey: string | null
  industryKey: string | null
  ratingKey: string | null
  accountSourceKey: string | null
} {
  const company = record as Record<string, unknown>
  return {
    ...crmSearchFields(
      company['visibleTo'],
      CRM_COMPANY_SEARCH_SOURCES.map((field) => company[field]),
    ),
    typeKey: crmPicklistKey(company['type']),
    industryKey: crmPicklistKey(company['industry']),
    ratingKey: crmPicklistKey(company['rating']),
    accountSourceKey: crmPicklistKey(company['accountSource']),
  }
}

/**
 * What a deal's search box reads: its title (AGL-3315) — as word prefixes,
 * and as `titleLower`, the whole title's key, which a reader whose access
 * is some sites searches by its start. And the keys the Deals list filters
 * its Type and Lead source by (AGL-3516): each label as the picklist
 * compares it, `null` for none.
 */
export function crmDealListFields(record: object): {
  searchTokens: string[]
  scopedSearchTokens: string[]
  titleLower: string
  typeKey: string | null
  leadSourceKey: string | null
  contactRoleContactIds: string[]
  scopedContactRoleContactIds: string[]
  contactRoleKeys: string[]
} {
  const deal = record as Record<string, unknown>
  return {
    ...crmSearchFields(deal['visibleTo'], [deal['title']]),
    titleLower: SEARCH_KEY(typeof deal['title'] === 'string' ? deal['title'] : ''),
    typeKey: crmPicklistKey(deal['type']),
    leadSourceKey: crmPicklistKey(deal['leadSource']),
    ...crmDealContactRoleListFields(deal),
  }
}

/**
 * The arrays a deal's contact roles are found by (AGL-3521): every contact
 * on it — `contactRoleContactIds`, which a contact's page asks
 * `array-contains` at the organization level, and the same ids behind each
 * scope token (`scopedContactRoleContactIds`, `host:x~contactId`), which it
 * asks under a site in the one array clause a query has — and the keys of
 * the roles they hold, which a rename of a role finds the deals by.
 */
export function crmDealContactRoleListFields(deal: Record<string, unknown>): {
  contactRoleContactIds: string[]
  scopedContactRoleContactIds: string[]
  contactRoleKeys: string[]
} {
  const roles = dealContactRolesOf(deal)
  const contactRoleContactIds = roles.map((row) => row.contactId)
  const keys = new Set<string>()
  for (const row of roles) {
    const key = crmPicklistKey(row.role)
    if (key) keys.add(key)
  }
  return {
    contactRoleContactIds,
    scopedContactRoleContactIds: scopedSearchTokens(deal['visibleTo'], contactRoleContactIds),
    contactRoleKeys: [...keys],
  }
}

/** What a task's search box reads: its title. */
export function crmTaskListFields(record: object): {
  searchTokens: string[]
  scopedSearchTokens: string[]
} {
  const task = record as Record<string, unknown>
  return crmSearchFields(task['visibleTo'], [task['title']])
}

/*------------------------------------------
 * A CONTACT'S FACET KEYS.
 *
 * An owner, a stage, a source, a company, a tag and a custom value live on
 * a holder's facet — `facets.{groupId}` — so a `where` on one would be a path
 * per holder and an index per holder. `facetKeys` flattens them into one
 * array a query can ask `array-contains` of:
 *
 *   `{groupId}:{field}={value}`   this holder's value
 *   `{groupId}:{field}`           this holder has one (for "is set")
 *   `*:{field}={value}`, `*:{field}`   any holder's, for the organization level
 *
 * `field` is `owner`, `stage`, `source`, `company`, `tag`, `custom.{key}` or
 * `leadSource` (AGL-3511), plus two presence-only fields: `orders` for a holder the person has bought
 * from, and `ltv` for one they are worth something to — the per-holder
 * figures a range cannot reach, asked only whether there are any.
 * A text value is keyed lower-cased and single-spaced; a number or a flag
 * as its string. Under a site the viewing group's keys are asked; at the
 * organization level, where no group is viewing, the `*` keys are.
 *-----------------------------------------*/

export const CRM_CONTACT_FACET_KEYS_FIELD = 'facetKeys'
/** The group a key names at the organization level: any holder. */
export const CRM_FACET_KEY_ANY_GROUP = '*'
/** The most facet keys one contact keeps. */
export const CRM_FACET_KEYS_MAX = 600

/** The facet fields a contact list filters by, as their keys name them. */
export type CrmFacetKeyField =
  | 'owner'
  | 'stage'
  | 'source'
  | 'company'
  | 'tag'
  | 'orders'
  | 'ltv'
  | `custom.${string}`
  // A holder's lead source, by its label (AGL-3511).
  | 'leadSource'

/** A facet value as its key spells it, or `null` for a value a key cannot hold. */
export function crmFacetKeyValue(value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value !== 'string') return null
  const key = SEARCH_KEY(value).slice(0, 120)
  return key || null
}

/** One facet key: `{group}:{field}` for presence, `{group}:{field}={value}` for a value. */
export function crmFacetKey(group: string, field: CrmFacetKeyField, value?: string): string {
  return value === undefined ? `${group}:${field}` : `${group}:${field}=${value}`
}

/** The keys one holder's facet contributes, under `group`. */
function facetKeysOf(group: string, facet: Record<string, unknown>, into: Set<string>): void {
  const add = (field: CrmFacetKeyField, raw: unknown) => {
    const value = crmFacetKeyValue(raw)
    if (value === null) return
    into.add(crmFacetKey(group, field))
    into.add(crmFacetKey(group, field, value))
  }
  add('owner', facet['ownerUid'])
  if (isContactLifecycleStage(facet['lifecycleStage'])) add('stage', facet['lifecycleStage'])
  add('company', facet['companyId'])
  const sources = facet['sources']
  if (sources && typeof sources === 'object' && !Array.isArray(sources)) {
    for (const [source, on] of Object.entries(sources as Record<string, unknown>)) {
      if (on) add('source', source)
    }
  }
  if (Array.isArray(facet['tags'])) {
    for (const tag of facet['tags']) add('tag', tag)
  }
  // Presence only: a holder's commercial figures are asked "any?", never ranged.
  if (typeof facet['ordersCount'] === 'number' && facet['ordersCount'] > 0) {
    into.add(crmFacetKey(group, 'orders'))
  }
  if (typeof facet['ltvCents'] === 'number' && facet['ltvCents'] > 0) {
    into.add(crmFacetKey(group, 'ltv'))
  }
  const custom = facet['custom']
  if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
    for (const [key, value] of Object.entries(custom as Record<string, unknown>)) {
      if (/^[A-Za-z0-9_-]{1,64}$/.test(key)) add(`custom.${key}`, value)
    }
  }
  // Keyed as `crmPicklistKey` compares a label, so a rename's rewrite restamps it.
  add('leadSource', facet['leadSource'])
}

/** Every facet key a contact carries — see the block above. */
export function crmContactFacetKeys(record: object): string[] {
  const facets = (record as Record<string, unknown>)[CONTACT_FACETS_FIELD]
  if (!facets || typeof facets !== 'object' || Array.isArray(facets)) return []
  const groups = new Set<string>()
  const any = new Set<string>()
  for (const [groupId, facet] of Object.entries(facets as Record<string, unknown>)) {
    if (!groupId || !facet || typeof facet !== 'object' || Array.isArray(facet)) continue
    facetKeysOf(groupId, facet as Record<string, unknown>, groups)
    facetKeysOf(CRM_FACET_KEY_ANY_GROUP, facet as Record<string, unknown>, any)
  }
  return [...any, ...groups].slice(0, CRM_FACET_KEYS_MAX)
}

/**
 * What a contact's search box reads: the shared identity — the canonical
 * name and every address — and the two profile values a person is looked
 * up by, through their top-level search echoes (`HostContact.phone`,
 * `HostContact.companyName`): the company's words, and the phone's digits.
 */
export const CRM_CONTACT_SEARCH_SOURCES = [
  'name',
  'email',
  CONTACT_ALTERNATE_EMAILS_FIELD,
  'companyName',
] as const

/**
 * A phone number as the words a search box finds it by: its digits whole,
 * without a leading country code of one to three digits, and its last seven
 * and last four — so `5551234`, `555123` and `4567` all find +1 555 123 4567.
 * Typed as digits: a search reads one word, and `(555)` is not one of these.
 */
export function crmPhoneSearchWords(phone: unknown): string[] {
  const digits = typeof phone === 'string' ? phone.replace(/\D/g, '') : ''
  if (digits.length < 4) return []
  const words = new Set<string>([digits])
  for (let strip = 1; strip <= 3; strip += 1) {
    if (digits.length - strip >= 7) words.add(digits.slice(strip))
  }
  if (digits.length > 7) words.add(digits.slice(-7))
  words.add(digits.slice(-4))
  return [...words]
}

export function crmContactListFields(record: object): {
  searchTokens: string[]
  scopedSearchTokens: string[]
  facetKeys: string[]
  emailStatus: string
} {
  const contact = record as Record<string, unknown>
  return {
    ...crmSearchFields(contact['visibleTo'], [
      ...CRM_CONTACT_SEARCH_SOURCES.map((field) => contact[field]),
      crmPhoneSearchWords(contact['phone']),
    ]),
    facetKeys: crmContactFacetKeys(contact),
    emailStatus: crmEmailStatusKey(contact),
  }
}

/**
 * The stored fields each collection's list fields are computed from. A
 * write that sets one of them must restamp the record — or spread
 * {@link crmListFields} over the document it wrote.
 */
export const CRM_LIST_FIELD_INPUTS: Readonly<Record<CrmListCollection, readonly string[]>> = {
  leads: [
    'visibleTo',
    ...CRM_LEAD_SEARCH_SOURCES,
    'status',
    'leadSource',
    'emailState',
    'campaignIds',
    // AGL-3513.
    'industry',
    'rating',
  ],
  contacts: ['visibleTo', ...CRM_CONTACT_SEARCH_SOURCES, 'phone', CONTACT_FACETS_FIELD, 'emailState'],
  companies: ['visibleTo', ...CRM_COMPANY_SEARCH_SOURCES, 'type', 'industry', 'rating', 'accountSource'],
  deals: ['visibleTo', 'title', 'type', 'leadSource', 'contactRoles', 'contactId'],
  crmTasks: ['visibleTo', 'title'],
}

/**
 * Every list field of one record, from the record as stored — and, for a
 * lead's direction, the org's lead source list when `context` holds it.
 */
export function crmListFields(
  collection: CrmListCollection,
  record: object,
  context: CrmListFieldsContext = {},
): Record<string, unknown> {
  switch (collection) {
    case 'leads':
      return crmLeadListFields(record, context)
    case 'contacts':
      return crmContactListFields(record)
    case 'companies':
      return crmCompanyListFields(record)
    case 'deals':
      return crmDealListFields(record)
    case 'crmTasks':
      return crmTaskListFields(record)
  }
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, at) => entry === b[at])
  }
  return a === b
}

/**
 * The list fields a stored record carries WRONGLY — the patch that brings
 * it level, `{}` when it already is. What a restamp and a backfill write.
 */
export function crmListFieldsPatch(
  collection: CrmListCollection,
  record: object,
  context: CrmListFieldsContext = {},
): Record<string, unknown> {
  const fields = crmListFields(collection, record, context)
  const stored = record as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(fields)) {
    if (!sameValue(stored[field], value)) patch[field] = value
  }
  return patch
}

/**
 * The field each collection's list ORDERS or asks `null` of, which a record
 * must therefore carry even when it has no value: a contact, a company and a
 * deal carry `nextTaskAtMs` ("No next activity" asks `== null`), and a task
 * carries `dueAtMs` (every task view orders by it, and Firestore leaves a
 * document without the ordered field out of the answer). An absent field is
 * neither `null` nor anything else a query can ask for.
 */
export const CRM_LIST_NULLABLE_FIELD: Readonly<Record<CrmListCollection, string | null>> = {
  leads: null,
  contacts: 'nextTaskAtMs',
  companies: 'nextTaskAtMs',
  deals: 'nextTaskAtMs',
  crmTasks: 'dueAtMs',
}

/**
 * The list fields a NEW record is written with: {@link crmListFields}, and
 * the collection's {@link CRM_LIST_NULLABLE_FIELD} as `null` when the record
 * does not set it — nothing is scheduled against a record that did not
 * exist, and a task created undated is still one its views must reach.
 */
export function crmNewRecordListFields(
  collection: CrmListCollection,
  record: object,
  context: CrmListFieldsContext = {},
): Record<string, unknown> {
  const fields = crmListFields(collection, record, context)
  const nullable = CRM_LIST_NULLABLE_FIELD[collection]
  const stored = (record as Record<string, unknown>)[nullable ?? '']
  if (!nullable || (nullable in record && stored !== undefined)) return fields
  return { ...fields, [nullable]: null }
}

/** Whether a patch touches a field the collection's list fields are computed from. */
export function crmListFieldsTouched(
  collection: CrmListCollection,
  patch: Record<string, unknown>,
): boolean {
  const inputs = CRM_LIST_FIELD_INPUTS[collection]
  return Object.keys(patch).some((key) =>
    inputs.some((input) => key === input || key.startsWith(`${input}.`)),
  )
}
