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
 * The rule behind a dynamic list (`docs/specs/email-overhaul.md` §3b/§3c).
 *
 * A list has held manually enrolled members only. A dynamic one stores this
 * rule instead and materializes into the same `members` subcollection, so the
 * send path keeps reading one deterministic collection rather than running an
 * unbounded scan per campaign.
 *
 * ## It extends the segment vocabulary rather than inventing one
 *
 * `tags` and `captureSources` mean exactly what they mean in
 * `contactMatchesSegment`, which this module reuses rather than restating:
 * two filter languages over the same contact document would drift, and the
 * one that drifts is whichever the merchant is not looking at. What is new is
 * a SOURCE dimension, because a list must be able to draw from silos that are
 * not `contacts` at all.
 *
 * ## Every field reads a value that is already written
 *
 * Nothing here collects anything new. `tags`, `captureSources` and the
 * `behavior` figures are contact fields; `formNames` is the `formName` a
 * submission already stores; `createdAfterMs`/`createdBeforeMs` read the
 * `createdAt` all three person silos already stamp; `campaignIds` reads the
 * membership `campaign-membership.ts` defines, which the forms console writes
 * and the submit route propagates.
 *
 * ⚠️ A rule selects an AUDIENCE. It does not grant consent — a person matched
 * by "submitted a form" has not opted in by submitting it. Membership and
 * basis are separate joins and `marketing-consent.ts` owns the second one.
 */

import { normalizeCampaignIds } from './campaign-membership'
import {
  CONTACT_SOURCE_LABELS,
  contactMatchesSegment,
  type ContactSource,
} from './contacts'
import {
  isContactLifecycleStage,
  normalizeContactFieldKey,
  type ContactCustomValue,
  type ContactLifecycleStage,
  CRM_CONTACT_VIEW_FIELDS,
  crmContactCustomKey,
  type CrmViewFilterClause,
} from './crm'

/** The silos a dynamic list may draw people from. */
export type DynamicListSource =
  | 'contacts'
  | 'leads'
  | 'siteMembers'
  /**
   * `hosts/{hostId}/formSubmissions`, which is what answers "everyone who
   * submitted form X" — the form's NAME is on the submission and on nothing
   * else. A contact captured by a form records only that some form produced
   * it (`sources.form`), so `captureSources` cannot express the question.
   */
  | 'formSubmissions'

/**
 * The silos whose rows can be filed under a campaign.
 *
 * A contact carries the membership inside the holder's own facet and a form
 * submission carries the membership its form had when it arrived. A lead and a
 * site member carry none — nothing writes one — so the campaign dimension is
 * SKIPPED for them rather than failed, which is the same discipline every
 * silo-specific dimension here follows.
 *
 * Stated as a value because both the matcher and the materializer's enrichment
 * decide off it, and two lists would drift into a rule that selects a silo the
 * scan never reads the field for.
 */
export const CAMPAIGN_MEMBER_SILOS: DynamicListSource[] = [
  'contacts',
  'formSubmissions',
]

/** Purchase-history filters. Contacts only — no other silo stores RFM. */
export interface DynamicListBehavior {
  ordersCountAtLeast?: number
  ltvCentsAtLeast?: number
  lastPurchaseWithinDays?: number
  /**
   * Lapsed customers. A person who has NEVER purchased does not match: the
   * question is "bought once and stopped", and answering it with everybody
   * who never bought would put the whole audience in a win-back campaign.
   */
  noPurchaseForDays?: number
}

/**
 * Engagement filters, read from the per-person rollup the delivery webhook
 * maintains on `emailDeliveries/{personKey}`.
 *
 * ## Why the "for N days" arms count people with no record, and
 * `noPurchaseForDays` beside them does not
 *
 * A purchase is an act the person performed, so "no purchase on file" is
 * strong evidence they did not buy — and somebody who never bought is not a
 * LAPSED customer. An open is not like that. We learn of one only if we
 * mailed them, the message arrived, and their client loaded the tracking
 * pixel, so "no open on file" and "did not open" rest on the same evidence.
 * A merchant asking for people who are not engaging means the silent ones
 * too, and the sentences the console reads back say which lean applies rather
 * than leaving it to be inferred.
 *
 * ## Opens are the weaker signal, and the field names keep them apart
 *
 * Apple's Mail Privacy Protection prefetches images, so an open is partly a
 * statement about a mail client; a click is a statement about a person. Both
 * are offered because both are stored, and they are never merged into one
 * "engaged" number that would hide which of the two a rule rests on.
 */
export interface DynamicListEngagement {
  /** Opened any of our mail within the last N days. */
  openedWithinDays?: number
  /** Clicked a link in any of our mail within the last N days. */
  clickedWithinDays?: number
  /** No open on record for at least N days — never opened counts. */
  notOpenedForDays?: number
  /** No click on record for at least N days — never clicked counts. */
  notClickedForDays?: number
}

/**
 * How a custom-field clause compares the stored value to the one it names.
 *
 * Seven operators and no more, because each one has to be readable back as
 * a sentence and each one has to state what it does with a BLANK value —
 * see {@link customValueMatches} for the lean every operator takes.
 */
export const DYNAMIC_LIST_CUSTOM_OPS = [
  'eq',
  'neq',
  'contains',
  'gt',
  'lt',
  'set',
  'unset',
] as const

export type DynamicListCustomOp = (typeof DYNAMIC_LIST_CUSTOM_OPS)[number]

/** The operators that compare against a value the clause carries. */
const VALUED_CUSTOM_OPS: ReadonlySet<DynamicListCustomOp> = new Set([
  'eq',
  'neq',
  'contains',
  'gt',
  'lt',
])

/**
 * One condition on one custom contact field (AGL-2603).
 *
 * `key` is the {@link ContactFieldDefinition.key} the value is stored under
 * in the holder's facet, `op` says how to compare and `value` is what to
 * compare with — absent for `set` and `unset`, which ask about presence
 * rather than content. Scalars only, because that is all a custom field may
 * hold.
 */
export interface DynamicListCustomClause {
  key: string
  op: DynamicListCustomOp
  value?: string | number | boolean
}

/**
 * The most custom-field clauses one block may carry.
 *
 * A bound on the predicate rather than on the audience — every clause is
 * evaluated in memory against a candidate already read — kept small for the
 * reason the branch cap is: the rule is merchant-authored and a stored array
 * has no natural end.
 */
export const DYNAMIC_LIST_MAX_CUSTOM_CLAUSES = 20

/**
 * One AND-block of filters.
 *
 * Everything except `sources` and `segmentId`, which stay on the rule itself
 * — see {@link DynamicListRule.sources} for why the source list may not move
 * into a branch and may not be negated.
 */
export interface DynamicListDimensions {
  /** Contacts only: at least one of these tags. */
  tags?: string[]
  /** Contacts only: captured by at least one of these surfaces. */
  captureSources?: ContactSource[]
  /** `formSubmissions` only: at least one of these form names, case-insensitive. */
  formNames?: string[]
  /**
   * {@link CAMPAIGN_MEMBER_SILOS} only: filed under at least one of these
   * campaigns, by campaign id.
   *
   * ⚠️ NOT the campaign a person's browser was attributed TO. A campaign
   * TOUCH says which ad or link brought somebody in and lives on the
   * attribution record; this says which campaign the merchant FILED the
   * record under. The two are different facts about different acts and a
   * single dimension over both would answer neither question — see
   * `campaign-attribution.ts` for the other one.
   *
   * ⛔ And membership is not consent. A person selected by this dimension has
   * opted in to nothing: they are here because a merchant put a form in a
   * campaign, which is the merchant's own act. The materializer enrolls with
   * no basis at all, and this dimension does not change that.
   */
  campaignIds?: string[]
  /** Any silo: the record was created at or after this instant. */
  createdAfterMs?: number
  /** Any silo: the record was created strictly before this instant. */
  createdBeforeMs?: number
  /** Contacts only. */
  behavior?: DynamicListBehavior
  /** Any silo — engagement is a fact about an address, not about a silo row. */
  engagement?: DynamicListEngagement
  /** Already a member of every one of these lists. */
  inListIds?: string[]
  /** A member of none of these lists — the "not in list X" every rival has. */
  notInListIds?: string[]
  /*
   * THE CRM DIMENSIONS (AGL-2603) — contacts only, every one of them.
   *
   * All four read the holder's FACET on the shared contact row, beside the
   * tags: an owner, a lifecycle stage, a company and a custom field are one
   * business's knowledge of a person, and the materializer reads them under
   * the sweeping site's own group so that no rule can select another
   * holder's segmentation. A lead, a site member and a form submission carry
   * none of them, so the dimensions are SKIPPED for those silos rather than
   * failed — the same discipline `tags` follows, and the same caveat about a
   * negated branch whose only filter is one of these.
   *
   * A contact with no value on the field does not match any of the first
   * three: "owned by A" is not satisfied by nobody owning them. The custom
   * operators each state their own lean — see {@link customValueMatches}.
   */
  /** Owned by any of these team members, by account uid. */
  ownerUids?: string[]
  /** In any of these lifecycle stages. */
  lifecycleStages?: ContactLifecycleStage[]
  /** At any of these companies, by `orgs/{orgId}/companies` id. */
  companyIds?: string[]
  /** Every clause must hold — AND within the dimension, unlike the lists above. */
  custom?: DynamicListCustomClause[]
  /**
   * Opened or clicked a campaign sent by the sweeping holder's sites within
   * the last N days (AGL-2616) — the re-engagement audience.
   *
   * Read from the holder's facet like the four above, and contacts only for
   * the same reason. It is NOT the {@link engagement} block one field up:
   * that reads the address-level rollup, which counts every sender's mail
   * to the address — a receipt, an invite, a sibling business's newsletter —
   * and a "win back our quiet readers" audience built on it would mail
   * people who are reading somebody else. This reads what the delivery
   * webhook stamped on OUR facet from OUR campaigns. A contact with no stamp
   * does not match, the dated-window lean the CRM dimensions all take.
   */
  engagedWithinDays?: number
}

/** One OR branch: an AND-block that may be inverted. */
export interface DynamicListRuleGroup extends DynamicListDimensions {
  /**
   * Invert this branch.
   *
   * ⚠️ A branch whose dimensions do not apply to a candidate's silo matches
   * VACUOUSLY — this rule language skips inapplicable dimensions rather than
   * failing them — so negating such a branch excludes that silo entirely.
   * That is the honest consequence of the skip rule rather than a special
   * case bolted onto it, and every clause the console reads back names the
   * silo its dimension applies to.
   */
  negate?: boolean
}

/** The stored `rule` on a `kind: 'dynamic'` list document. */
export interface DynamicListRule extends DynamicListDimensions {
  /**
   * Which silos to draw from. Empty is not "all" — it matches nobody.
   *
   * ⛔ NOT groupable and NOT negatable, and that is a materializer constraint
   * rather than a modelling preference. `sources` is the SCAN PLAN: it
   * decides which collections are paged and in what order, and it is what the
   * resume cursor names when a sweep runs out of budget. A negated source
   * would mean "every silo except", which is a scan of collections the rule
   * does not name; a source inside an OR branch would mean two scan plans for
   * one rule. Either breaks the budget, the cursor, or both.
   */
  sources: DynamicListSource[]
  /** Reuse a saved contact segment's tags and sources. Contacts only. */
  segmentId?: string
  /**
   * Reuse a saved contacts VIEW's filters (AGL-2617). Contacts only.
   *
   * `orgs/{orgId}/crmViews/{viewId}`, a view over the Contacts section.
   * Resolved once by the materializer into the dimensions this rule
   * language already has — see {@link dynamicListDimensionsForCrmView} —
   * and applied to the rule's top-level block the way a segment is: it
   * always applies, and it is not folded into the OR branches. A view whose
   * filters this language cannot express narrows to nobody, which is the
   * same lean a deleted segment takes: a rule must not quietly select more
   * than the view it reads as.
   */
  viewId?: string
  /**
   * Invert the rule's own top-level block — "people who do NOT match these".
   *
   * Applies to the dimensions on this object and to the resolved segment. It
   * does not touch `sources`, and it does not touch {@link any}, which is
   * ANDed with it and carries its own per-branch negation.
   */
  negate?: boolean
  /**
   * OR branches. A candidate must match at least one of them.
   *
   * ANDed with the top-level block, so a rule can say "drawn from contacts,
   * tagged vip, AND (spent over $500 OR ordered at least three times)" — the
   * shape a flat AND list cannot express and every compared product has.
   * Absent or empty is no constraint at all, rather than a constraint nothing
   * satisfies.
   */
  any?: DynamicListRuleGroup[]
}

/** One person as the materializer reads them out of a silo. */
export interface DynamicListCandidate {
  silo: DynamicListSource
  email: string
  name?: string
  createdAtMs?: number | null
  /** Contacts only. */
  tags?: string[]
  /** Contacts only — the `sources` map, not the rule's `captureSources`. */
  sources?: Partial<Record<ContactSource, true>>
  ordersCount?: number
  ltvCents?: number
  lastPurchaseAtMs?: number | null
  /** `formSubmissions` only. */
  formName?: string
  /**
   * {@link CAMPAIGN_MEMBER_SILOS} only — the campaigns this row is filed
   * under.
   *
   * Read from a different place in each of the two silos and normalized to one
   * shape by the scan: a submission carries the field at the top of its
   * document, a contact carries it inside the reading holder's facet, because
   * a contact row is shared by every site in the org.
   */
  campaignIds?: string[]
  /*
   * ENRICHMENT — filled by a keyed lookup, not by the silo document.
   *
   * The two below describe an ADDRESS rather than a row, so they cannot come
   * out of the scan the way everything above does. The materializer fetches
   * them a page at a time, by document key, and only for a rule that asks —
   * see `dynamicListRuleNeedsEngagement` and `dynamicListRuleNeedsLists`.
   * Absent means "not looked up"; the matcher reads absent as no record,
   * which is the reading each dimension's own documentation states.
   */
  lastOpenedAtMs?: number | null
  lastClickedAtMs?: number | null
  /** Lists this person is already a member of, by list id. */
  listIds?: string[]
  /*
   * THE CRM FIELDS (AGL-2603) — contacts only, read out of the sweeping
   * holder's facet the way `campaignIds` is. Absent means the facet holds no
   * value, which the matcher reads as "does not match" for the first three
   * and as "unset" for a custom clause.
   */
  ownerUid?: string
  lifecycleStage?: ContactLifecycleStage
  companyId?: string
  /** The holder's custom values, keyed by field key. */
  custom?: Record<string, ContactCustomValue>
  /**
   * When the person last opened or clicked one of the holder's campaigns —
   * the facet stamp, read the way the fields above are. Absent when the
   * facet carries none, which the matcher reads as "does not match".
   */
  lastEmailEngagementAtMs?: number | null
}

/** A saved segment's filters, resolved by the caller from `segmentId`. */
export interface ResolvedSegmentFilters {
  tags?: string[]
  sources?: ContactSource[]
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => String(entry ?? '').trim())
        .filter((entry) => entry.length > 0 && entry.length <= 120)
        .slice(0, 50)
    : []

const asPositiveNumber = (value: unknown): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const DYNAMIC_LIST_SOURCES: DynamicListSource[] = [
  'contacts',
  'leads',
  'siteMembers',
  'formSubmissions',
]

/**
 * Coerces a stored rule to the shape the matcher expects.
 *
 * The rule is merchant-authored through the console and read back on a
 * scheduled sweep, so it arrives as whatever Firestore held. Unknown source
 * names are dropped rather than tolerated: a typo that fell through would
 * read as a silo the materializer never scans, and the list would quietly
 * materialize a smaller set than the rule appears to describe.
 */
/**
 * The most OR branches one rule may carry.
 *
 * A bound on the PREDICATE, not on the audience — every branch is evaluated
 * in memory against a candidate the sweep has already read, so this costs no
 * Firestore work. It exists because the rule is merchant-authored and a
 * stored array has no natural end: a thousand branches would be a thousand
 * evaluations per candidate per sweep.
 *
 * ⚠️ Set ABOVE what the console form can produce, and that is a correctness
 * requirement rather than headroom. The form's "any of these filters" mode
 * puts each control in a branch of its own, so a reader who fills in every
 * box authors nineteen, plus one branch per custom-field condition up to
 * {@link DYNAMIC_LIST_MAX_CUSTOM_CLAUSES} — and dropping a branch NARROWS an
 * OR, so a cap the form could reach would silently select fewer people than
 * the sentences above the controls say. The rule editor's spec holds the sum
 * under this number.
 */
export const DYNAMIC_LIST_MAX_GROUPS = 40

/**
 * The most lists one dimension may name.
 *
 * This one DOES cost reads — a named list is a keyed lookup per candidate per
 * page — so it is deliberately small, and it is the same number on both arms
 * so that "in these" and "not in those" cannot be combined into a larger
 * fan-out than either alone.
 */
export const DYNAMIC_LIST_MAX_LIST_REFERENCES = 5

/**
 * Coerces a stored custom-field clause, or drops it.
 *
 * Dropped rather than tolerated for the reason a typo'd silo is: a clause
 * with a key no definition uses, an operator the matcher does not know, or a
 * missing value where one is compared against, is a filter no contact can
 * satisfy — and a rule that quietly matches nobody reads exactly like a rule
 * that has not run yet. The key goes through the definition's own normalizer
 * so a clause written against a label (`Plan Name`) still reaches the stored
 * key (`plan_name`), and a value is kept only as a scalar because that is all
 * a custom field may hold.
 */
function normalizeCustomClause(raw: unknown): DynamicListCustomClause | null {
  const entry = (raw ?? {}) as Record<string, unknown>
  const key = normalizeContactFieldKey(entry['key'])
  const op = entry['op']
  if (
    !key ||
    typeof op !== 'string' ||
    !(DYNAMIC_LIST_CUSTOM_OPS as readonly string[]).includes(op)
  ) {
    return null
  }
  const operator = op as DynamicListCustomOp
  if (!VALUED_CUSTOM_OPS.has(operator)) return { key, op: operator }
  const value = entry['value']
  if (typeof value === 'string') {
    const trimmed = value.trim().slice(0, 500)
    return trimmed ? { key, op: operator, value: trimmed } : null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { key, op: operator, value } : null
  }
  if (typeof value === 'boolean') return { key, op: operator, value }
  return null
}

/** Coerces the dimensions shared by the rule and each of its OR branches. */
function normalizeDimensions(value: Record<string, unknown>): DynamicListDimensions {
  const behavior = (value['behavior'] ?? {}) as Record<string, unknown>
  const normalizedBehavior: DynamicListBehavior = {
    ...(asPositiveNumber(behavior['ordersCountAtLeast']) !== undefined
      ? { ordersCountAtLeast: asPositiveNumber(behavior['ordersCountAtLeast']) }
      : {}),
    ...(asPositiveNumber(behavior['ltvCentsAtLeast']) !== undefined
      ? { ltvCentsAtLeast: asPositiveNumber(behavior['ltvCentsAtLeast']) }
      : {}),
    ...(asPositiveNumber(behavior['lastPurchaseWithinDays']) !== undefined
      ? {
          lastPurchaseWithinDays: asPositiveNumber(
            behavior['lastPurchaseWithinDays'],
          ),
        }
      : {}),
    ...(asPositiveNumber(behavior['noPurchaseForDays']) !== undefined
      ? { noPurchaseForDays: asPositiveNumber(behavior['noPurchaseForDays']) }
      : {}),
  }
  const engagement = (value['engagement'] ?? {}) as Record<string, unknown>
  const normalizedEngagement: DynamicListEngagement = {
    ...(asPositiveNumber(engagement['openedWithinDays']) !== undefined
      ? { openedWithinDays: asPositiveNumber(engagement['openedWithinDays']) }
      : {}),
    ...(asPositiveNumber(engagement['clickedWithinDays']) !== undefined
      ? { clickedWithinDays: asPositiveNumber(engagement['clickedWithinDays']) }
      : {}),
    ...(asPositiveNumber(engagement['notOpenedForDays']) !== undefined
      ? { notOpenedForDays: asPositiveNumber(engagement['notOpenedForDays']) }
      : {}),
    ...(asPositiveNumber(engagement['notClickedForDays']) !== undefined
      ? { notClickedForDays: asPositiveNumber(engagement['notClickedForDays']) }
      : {}),
  }
  const tags = asStringArray(value['tags'])
  const captureSources = asStringArray(value['captureSources']) as ContactSource[]
  const formNames = asStringArray(value['formNames'])
  // Through the campaign field's own normalizer rather than the local string
  // coercion: the cap, the dedupe and the trim are properties of the stored
  // membership, and a second reading of them here would let a rule name more
  // campaigns than any record is allowed to be filed under.
  const campaignIds = normalizeCampaignIds(value['campaignIds'])
  const createdAfterMs = asPositiveNumber(value['createdAfterMs'])
  const createdBeforeMs = asPositiveNumber(value['createdBeforeMs'])
  const inListIds = asStringArray(value['inListIds']).slice(
    0,
    DYNAMIC_LIST_MAX_LIST_REFERENCES,
  )
  const notInListIds = asStringArray(value['notInListIds']).slice(
    0,
    DYNAMIC_LIST_MAX_LIST_REFERENCES,
  )
  const ownerUids = asStringArray(value['ownerUids'])
  // A stage the model does not name is dropped, not kept: kept, it would be
  // a filter no contact can satisfy, and the rule would read as the stages
  // it does name while selecting nobody.
  const lifecycleStages = asStringArray(value['lifecycleStages']).filter(
    isContactLifecycleStage,
  )
  const companyIds = asStringArray(value['companyIds'])
  const custom = (Array.isArray(value['custom']) ? value['custom'] : [])
    .slice(0, DYNAMIC_LIST_MAX_CUSTOM_CLAUSES)
    .map(normalizeCustomClause)
    .filter((clause): clause is DynamicListCustomClause => clause !== null)
  const engagedWithinDays = asPositiveNumber(value['engagedWithinDays'])
  return {
    ...(tags.length ? { tags } : {}),
    ...(captureSources.length ? { captureSources } : {}),
    ...(formNames.length ? { formNames } : {}),
    ...(campaignIds.length ? { campaignIds } : {}),
    ...(createdAfterMs !== undefined ? { createdAfterMs } : {}),
    ...(createdBeforeMs !== undefined ? { createdBeforeMs } : {}),
    ...(Object.keys(normalizedBehavior).length
      ? { behavior: normalizedBehavior }
      : {}),
    ...(Object.keys(normalizedEngagement).length
      ? { engagement: normalizedEngagement }
      : {}),
    ...(inListIds.length ? { inListIds } : {}),
    ...(notInListIds.length ? { notInListIds } : {}),
    ...(ownerUids.length ? { ownerUids } : {}),
    ...(lifecycleStages.length ? { lifecycleStages } : {}),
    ...(companyIds.length ? { companyIds } : {}),
    ...(custom.length ? { custom } : {}),
    ...(engagedWithinDays !== undefined ? { engagedWithinDays } : {}),
  }
}

/** True when a branch constrains nothing, so keeping it would widen the rule. */
function dimensionsAreEmpty(dimensions: DynamicListDimensions): boolean {
  return Object.keys(dimensions).length === 0
}

export function normalizeDynamicListRule(stored: unknown): DynamicListRule {
  const value = (stored ?? {}) as Record<string, unknown>
  const sources = asStringArray(value['sources']).filter((source): source is DynamicListSource =>
    (DYNAMIC_LIST_SOURCES as string[]).includes(source),
  )
  const segmentId = String(value['segmentId'] ?? '').trim()
  const viewId = String(value['viewId'] ?? '').trim()
  /*
   * An empty OR branch is DROPPED rather than kept.
   *
   * A branch with no dimensions matches everybody, and `any` is satisfied by
   * one branch — so a single empty one would silently disable every other
   * branch beside it. Dropping it is the same decision the source filter
   * makes about a typo'd silo name, for the same reason: a rule must not
   * quietly select a different population than the one it reads as.
   */
  const groups = (Array.isArray(value['any']) ? value['any'] : [])
    .slice(0, DYNAMIC_LIST_MAX_GROUPS)
    .map((raw) => {
      const entry = (raw ?? {}) as Record<string, unknown>
      const dimensions = normalizeDimensions(entry)
      return {
        ...dimensions,
        ...(entry['negate'] === true ? { negate: true } : {}),
      } as DynamicListRuleGroup
    })
    .filter((group) => !dimensionsAreEmpty(stripNegate(group)))
  return {
    sources,
    ...(segmentId ? { segmentId } : {}),
    ...(viewId ? { viewId } : {}),
    ...(value['negate'] === true ? { negate: true } : {}),
    ...normalizeDimensions(value),
    ...(groups.length ? { any: groups } : {}),
  }
}

/** A branch without its flag, so emptiness is decided on its filters alone. */
function stripNegate(group: DynamicListRuleGroup): DynamicListDimensions {
  const { negate, ...dimensions } = group
  void negate
  return dimensions
}

/**
 * True when a rule can select nobody no matter what the data holds.
 *
 * Worth its own answer because the failure it prevents is silent: an empty
 * `sources` materializes an empty list, and an empty list reads in the
 * composer exactly like a rule that simply has not run yet.
 */
export function dynamicListRuleIsEmpty(rule: DynamicListRule): boolean {
  return rule.sources.length === 0
}

/**
 * Does this person match the rule?
 *
 * AND across dimensions, OR within one — the same shape `contactMatchesSegment`
 * uses, so a merchant who has built a segment already knows how this reads.
 *
 * On top of that flat block sit two operators, and the whole verdict is:
 *
 * ```
 * silo is in sources
 *   AND (negate ? NOT top-level block : top-level block)
 *   AND (any branches ? at least one branch, each with its own negate : true)
 * ```
 *
 * Which is nested AND/OR with negation, arranged so that the only part the
 * materializer's scan plan depends on — `sources` — sits outside both
 * operators and cannot be touched by either.
 *
 * Dimensions that do not apply to a candidate's silo are SKIPPED rather than
 * failed. A rule of `sources: ['contacts','siteMembers'], tags: ['vip']` means
 * "VIP contacts, and site members" — reading `tags` against a member document
 * that cannot carry tags would make the second source contribute nobody, and
 * a source that silently contributes nobody is the same defect as a dropped
 * typo above.
 *
 * @param segment filters resolved from `rule.segmentId`, when it names one.
 * @param view    the dimensions resolved from `rule.viewId`, when it names
 *                one — see {@link dynamicListDimensionsForCrmView}.
 * @param nowMs   evaluation instant, injected so a sweep is reproducible.
 */
export function candidateMatchesDynamicListRule(
  candidate: DynamicListCandidate,
  rule: DynamicListRule,
  options: {
    segment?: ResolvedSegmentFilters | null
    view?: DynamicListDimensions | null
    nowMs: number
  },
): boolean {
  /*
   * The source filter, first and outside everything else. It is the one
   * dimension that is neither negatable nor groupable, because it is the scan
   * plan rather than a filter over what the scan found.
   */
  if (!rule.sources.includes(candidate.silo)) return false

  /*
   * A resolved VIEW is its own AND-block beside the rule's, inside the
   * negatable top level with the segment — the view always applies, and a
   * rule that inverts its block inverts the view with it, which is what
   * "nobody matching all of these" reads as when a view is one of them.
   * Beside rather than merged INTO the rule's dimensions: the lists within
   * a dimension are OR, so merging a view's owners with the rule's would
   * widen both.
   */
  const top =
    matchesDimensions(candidate, rule, {
      segment: options.segment ?? null,
      nowMs: options.nowMs,
    }) &&
    (!options.view ||
      matchesDimensions(candidate, options.view, {
        segment: null,
        nowMs: options.nowMs,
      }))
  if ((rule.negate === true ? !top : top) === false) return false

  /*
   * The OR branches, ANDed with the block above. Absent or empty is no
   * constraint — `Array.prototype.some` on an empty array is `false`, which
   * would turn a rule that named no branches into one nobody satisfies.
   */
  const groups = rule.any ?? []
  if (!groups.length) return true
  return groups.some((group) => {
    const matched = matchesDimensions(candidate, group, {
      // A saved segment belongs to the rule, not to a branch: it is resolved
      // once by the caller from the rule's own `segmentId`, and folding it
      // into every branch would make each branch narrower than it reads.
      segment: null,
      nowMs: options.nowMs,
    })
    return group.negate === true ? !matched : matched
  })
}

/**
 * One AND-block of dimensions against one candidate.
 *
 * Extracted so the top-level block and every OR branch are decided by the
 * same code. Two implementations of "does this person match these filters"
 * would drift, and the half that drifts is whichever the merchant is not
 * looking at — the same reason `contactMatchesSegment` is reused here rather
 * than restated.
 */
function matchesDimensions(
  candidate: DynamicListCandidate,
  rule: DynamicListDimensions,
  options: { segment: ResolvedSegmentFilters | null; nowMs: number },
): boolean {
  const day = 86_400_000

  if (rule.createdAfterMs !== undefined) {
    // A record with no creation stamp cannot satisfy an age window, and
    // admitting it would put people INTO an audience the merchant bounded on
    // purpose. This is the opposite lean from the consent module's unknown
    // handling, and deliberately so: there, the unknown keeps somebody
    // reachable; here, it would add somebody the rule excluded.
    if (candidate.createdAtMs == null) return false
    if (candidate.createdAtMs < rule.createdAfterMs) return false
  }
  if (rule.createdBeforeMs !== undefined) {
    if (candidate.createdAtMs == null) return false
    if (candidate.createdAtMs >= rule.createdBeforeMs) return false
  }

  if (candidate.silo === 'formSubmissions' && rule.formNames?.length) {
    const wanted = new Set(rule.formNames.map((name) => name.toLowerCase()))
    if (!wanted.has(String(candidate.formName ?? '').trim().toLowerCase())) {
      return false
    }
  }

  /*
   * FILED UNDER A CAMPAIGN — the two silos that can be, and only those.
   *
   * OR within the dimension, like every other list here: a merchant naming
   * three campaigns means anyone in any of them, not the handful of people
   * filed under all three at once.
   *
   * A row in a silo that carries no membership is SKIPPED rather than failed,
   * so "people in the spring push, and every site member" contributes members
   * — the same reading `tags` gets for a lead. ⚠️ Which also means a NEGATED
   * branch whose only filter is this one excludes those silos entirely; that
   * is the honest consequence of the skip rule, stated on the branch flag
   * itself.
   */
  if (
    rule.campaignIds?.length &&
    CAMPAIGN_MEMBER_SILOS.includes(candidate.silo)
  ) {
    // An absent field reads as "filed under nothing", which is what a row
    // written before the form named a campaign actually says.
    const filed = new Set(candidate.campaignIds ?? [])
    if (!rule.campaignIds.some((campaignId) => filed.has(campaignId))) {
      return false
    }
  }

  if (candidate.silo === 'contacts') {
    const segmentFilters = {
      tags: [...(options.segment?.tags ?? []), ...(rule.tags ?? [])],
      sources: [
        ...(options.segment?.sources ?? []),
        ...(rule.captureSources ?? []),
      ],
    }
    if (
      !contactMatchesSegment(
        { tags: candidate.tags ?? [], sources: candidate.sources ?? {} },
        segmentFilters,
      )
    ) {
      return false
    }
    const behavior = rule.behavior
    if (behavior) {
      if (
        behavior.ordersCountAtLeast !== undefined &&
        (candidate.ordersCount ?? 0) < behavior.ordersCountAtLeast
      ) {
        return false
      }
      if (
        behavior.ltvCentsAtLeast !== undefined &&
        (candidate.ltvCents ?? 0) < behavior.ltvCentsAtLeast
      ) {
        return false
      }
      if (behavior.lastPurchaseWithinDays !== undefined) {
        const last = candidate.lastPurchaseAtMs ?? null
        if (last === null) return false
        if (last < options.nowMs - behavior.lastPurchaseWithinDays * day) {
          return false
        }
      }
      if (behavior.noPurchaseForDays !== undefined) {
        const last = candidate.lastPurchaseAtMs ?? null
        // Never purchased is not lapsed — see DynamicListBehavior.
        if (last === null) return false
        if (last > options.nowMs - behavior.noPurchaseForDays * day) {
          return false
        }
      }
    }
    /*
     * THE CRM DIMENSIONS — OR within each, AND across them, like the tags.
     *
     * An absent value matches none of the first three. "Owned by A or B" is
     * a positive claim about the relationship, and a contact nobody owns is
     * not a contact A owns; the same for a stage never set and a company
     * never linked. The lean is the dated-window one rather than the
     * consent module's: admitting the unknown here would put people INTO an
     * audience the merchant bounded on purpose.
     */
    if (rule.ownerUids?.length) {
      if (!candidate.ownerUid || !rule.ownerUids.includes(candidate.ownerUid)) {
        return false
      }
    }
    if (rule.lifecycleStages?.length) {
      if (
        !candidate.lifecycleStage ||
        !rule.lifecycleStages.includes(candidate.lifecycleStage)
      ) {
        return false
      }
    }
    if (rule.companyIds?.length) {
      if (!candidate.companyId || !rule.companyIds.includes(candidate.companyId)) {
        return false
      }
    }
    // Every clause must hold. A merchant adding a second condition on a
    // custom field is narrowing, which is what a second box on a form means
    // everywhere else in it — the OR is the `any` branches, not this list.
    for (const clause of rule.custom ?? []) {
      if (!customValueMatches(candidate.custom?.[clause.key], clause)) {
        return false
      }
    }
    /*
     * ENGAGED WITH OUR CAMPAIGNS — the facet stamp, on the same lean as
     * `lastPurchaseWithinDays`: no stamp is no match. This is the one
     * engagement figure that is about THIS holder's mail; the address-level
     * arms further down are about the address.
     */
    if (rule.engagedWithinDays !== undefined) {
      const last = candidate.lastEmailEngagementAtMs ?? null
      if (last === null) return false
      if (last < options.nowMs - rule.engagedWithinDays * day) return false
    }
  }

  /*
   * ENGAGEMENT — every silo, not contacts only.
   *
   * The rollup keys on the ADDRESS, and a lead, a site member and a form
   * submission all have one. Restricting this to contacts the way `behavior`
   * is restricted would be restricting it to the silo that happens to store
   * the OTHER figures, which is not a fact about engagement.
   */
  const engagement = rule.engagement
  if (engagement) {
    const opened = candidate.lastOpenedAtMs ?? null
    const clicked = candidate.lastClickedAtMs ?? null
    if (engagement.openedWithinDays !== undefined) {
      if (opened === null) return false
      if (opened < options.nowMs - engagement.openedWithinDays * day) {
        return false
      }
    }
    if (engagement.clickedWithinDays !== undefined) {
      if (clicked === null) return false
      if (clicked < options.nowMs - engagement.clickedWithinDays * day) {
        return false
      }
    }
    // No record MATCHES the quiet arms — see DynamicListEngagement for why
    // this leans the opposite way from `noPurchaseForDays` above it.
    if (engagement.notOpenedForDays !== undefined && opened !== null) {
      if (opened > options.nowMs - engagement.notOpenedForDays * day) {
        return false
      }
    }
    if (engagement.notClickedForDays !== undefined && clicked !== null) {
      if (clicked > options.nowMs - engagement.notClickedForDays * day) {
        return false
      }
    }
  }

  /*
   * LIST MEMBERSHIP — "and not the people already on my customers list".
   *
   * An absent `listIds` reads as "on no list", and that is the reading a
   * failed or skipped lookup gets too. The direction is chosen rather than
   * defaulted: an unenriched candidate failing `inListIds` keeps them OUT of
   * an audience, where an unenriched candidate passing `notInListIds` would
   * let a lookup failure quietly re-admit the people a merchant excluded. The
   * materializer runs the enrichment whenever a rule names a list, so the
   * absent case is a lookup that failed rather than an ordinary one — and
   * these two readings are what it costs when one does.
   */
  const memberOf = new Set(candidate.listIds ?? [])
  if (rule.inListIds?.length) {
    if (!rule.inListIds.every((listId) => memberOf.has(listId))) return false
  }
  if (rule.notInListIds?.length) {
    if (rule.notInListIds.some((listId) => memberOf.has(listId))) return false
  }

  return true
}

/** A value that is on the record: not absent, not `null`, not blank text. */
const customValueIsSet = (value: ContactCustomValue | undefined): boolean =>
  value !== undefined &&
  value !== null &&
  !(typeof value === 'string' && value.trim() === '')

/** A value as text, for the comparisons that read it that way. */
const customValueText = (value: string | number | boolean): string =>
  String(value).trim().toLowerCase()

/**
 * Does one stored custom value satisfy one clause?
 *
 * Exported because the comparison is the whole meaning of the dimension and
 * a surface that previews a value against a clause must not carry a second
 * copy of it. The leans, per operator, because each has to be readable back
 * as a sentence the merchant can check against their intent:
 *
 *  - `eq` — the same value. Text compares case-insensitively and trimmed,
 *    because a `select` option typed as `Enterprise` and stored as
 *    `enterprise` is one option; a number and a boolean compare as
 *    themselves, and a number stored as text still equals the number.
 *  - `neq` — a value that is set AND differs. A blank does NOT count: a
 *    merchant excluding one plan is not asking for everyone whose plan was
 *    never recorded, and `unset` exists for that question.
 *  - `contains` — text containment, case-insensitive; a blank contains
 *    nothing.
 *  - `gt` / `lt` — numeric when both sides parse as numbers, text otherwise.
 *    Text ordering is what a `date` field stores (ISO dates order as text),
 *    and a blank is neither greater nor less than anything.
 *  - `set` / `unset` — presence. `false` and `0` are set; `null`, absent and
 *    blank text are not.
 */
export function customValueMatches(
  value: ContactCustomValue | undefined,
  clause: DynamicListCustomClause,
): boolean {
  const present = customValueIsSet(value)
  switch (clause.op) {
    case 'set':
      return present
    case 'unset':
      return !present
    default:
      break
  }
  if (!present || clause.value === undefined) return false
  const stored = value as string | number | boolean
  const wanted = clause.value
  switch (clause.op) {
    case 'eq':
      return customValueText(stored) === customValueText(wanted)
    case 'neq':
      return customValueText(stored) !== customValueText(wanted)
    case 'contains':
      return customValueText(stored).includes(customValueText(wanted))
    case 'gt':
    case 'lt': {
      const left = Number(stored)
      const right = Number(wanted)
      const numeric =
        typeof stored !== 'boolean' &&
        typeof wanted !== 'boolean' &&
        String(stored).trim() !== '' &&
        String(wanted).trim() !== '' &&
        Number.isFinite(left) &&
        Number.isFinite(right)
      if (numeric) return clause.op === 'gt' ? left > right : left < right
      const a = customValueText(stored)
      const b = customValueText(wanted)
      return clause.op === 'gt' ? a > b : a < b
    }
    default:
      return false
  }
}

/** Every dimension block a rule carries: its own, then each OR branch. */
function allDimensions(rule: DynamicListRule): DynamicListDimensions[] {
  return [rule, ...(rule.any ?? [])]
}

/**
 * Does evaluating this rule need the sweeping holder's contact FACET?
 *
 * The campaign membership and the four CRM fields all live inside the facet,
 * which is keyed by the consent group the materializer has to resolve with
 * one org read. A rule that names none of them pays nothing — the same
 * opt-in cost `dynamicListRuleNeedsCampaigns` already describes, widened to
 * every dimension the facet holds so the materializer asks one question
 * rather than five.
 */
export function dynamicListRuleNeedsContactFacet(rule: DynamicListRule): boolean {
  return allDimensions(rule).some(
    (dimensions) =>
      (dimensions.campaignIds?.length ?? 0) > 0 ||
      (dimensions.ownerUids?.length ?? 0) > 0 ||
      (dimensions.lifecycleStages?.length ?? 0) > 0 ||
      (dimensions.companyIds?.length ?? 0) > 0 ||
      (dimensions.custom?.length ?? 0) > 0 ||
      dimensions.engagedWithinDays !== undefined,
  )
}

/**
 * Does evaluating this rule need the per-person engagement rollup?
 *
 * Asked by the materializer before it spends a keyed read per candidate. A
 * rule with no engagement clause anywhere pays nothing, which is what keeps
 * the lookup an opt-in cost rather than a tax on every sweep.
 */
export function dynamicListRuleNeedsEngagement(rule: DynamicListRule): boolean {
  return allDimensions(rule).some(
    (dimensions) =>
      dimensions.engagement !== undefined &&
      Object.keys(dimensions.engagement).length > 0,
  )
}

/**
 * Does evaluating this rule need a contact's campaign membership?
 *
 * Asked by the materializer before it resolves the consent group the facet is
 * keyed by — one org read, and only for a rule that names a campaign. A
 * submission's membership is on the row the sweep already paged and costs
 * nothing either way, so this answers about the CONTACTS silo's extra work.
 */
export function dynamicListRuleNeedsCampaigns(rule: DynamicListRule): boolean {
  return allDimensions(rule).some(
    (dimensions) => (dimensions.campaignIds?.length ?? 0) > 0,
  )
}

/**
 * The rule with one list id removed from both membership arms.
 *
 * ⛔ A dynamic list whose rule referred to ITSELF would oscillate, and the
 * oscillation removes people. `notInListIds: [self]` matches everybody on the
 * first sweep, which enrolls them; on the second sweep they are all members,
 * so nobody matches, and reconciliation deletes every row the rule created.
 * The third sweep enrolls them again. Membership would flip on every beat of
 * the materializing sweep forever, and half of those beats are deletions.
 *
 * A self-reference also cannot mean anything useful — the answer depends on
 * whether the sweep has run yet — so it is dropped rather than refused: a
 * merchant who picks their own audience gets the rule without that clause,
 * which is what it would have meant if it meant anything.
 */
export function dynamicListRuleWithoutListReference(
  rule: DynamicListRule,
  listId: string,
): DynamicListRule {
  if (!listId) return rule
  const strip = <T extends DynamicListDimensions>(dimensions: T): T => {
    const inListIds = (dimensions.inListIds ?? []).filter((id) => id !== listId)
    const notInListIds = (dimensions.notInListIds ?? []).filter(
      (id) => id !== listId,
    )
    const next = { ...dimensions }
    if (dimensions.inListIds) {
      if (inListIds.length) next.inListIds = inListIds
      else delete next.inListIds
    }
    if (dimensions.notInListIds) {
      if (notInListIds.length) next.notInListIds = notInListIds
      else delete next.notInListIds
    }
    return next
  }
  const stripped = strip(rule)
  /*
   * A branch whose ONLY filter was the self-reference is dropped, not kept
   * empty: an empty branch matches everybody, and one satisfied branch
   * satisfies `any`, so keeping it would silently disable every branch
   * beside it. Same reasoning as the normalizer's own empty-branch drop.
   */
  const groups = (rule.any ?? [])
    .map((group) => strip(group))
    .filter((group) => Object.keys(stripNegate(group)).length > 0)
  if (groups.length) stripped.any = groups
  else delete stripped.any
  return stripped
}

/** Every list id this rule refers to, in either direction, de-duplicated. */
export function dynamicListRuleListIds(rule: DynamicListRule): string[] {
  const ids = new Set<string>()
  for (const dimensions of allDimensions(rule)) {
    for (const listId of dimensions.inListIds ?? []) ids.add(listId)
    for (const listId of dimensions.notInListIds ?? []) ids.add(listId)
  }
  return [...ids]
}

/*==========================================
 * A SAVED CONTACTS VIEW, IN THIS LANGUAGE (AGL-2617).
 *
 * A view stores the Contacts list's own filter clauses — a field, an
 * operator, a value — and an audience rule stores dimensions. The two are
 * different vocabularies for overlapping questions: "owner is Dana" is an
 * `ownerUids` dimension, "tagged vip or wholesale" is a `tags` dimension,
 * "created after June" is `createdAfterMs`. So a view is USABLE as an
 * audience exactly as far as its clauses have a dimension here, and the
 * translation below is the whole of that claim: it is pure, it names every
 * clause it could not carry, and nothing about a view is matched any other
 * way. The alternative — evaluating the list's grammar inside the sweep —
 * would put a second matcher beside the one the console runs, in a module
 * that may not import the grammar's home.
 *
 * A clause with no dimension is UNSUPPORTED, never dropped. A name prefix,
 * an email, an `updatedAt` window, a form id: dropping one would make the
 * audience wider than the view it was picked as, and a campaign going to
 * the wrong people is the failure every part of this feature is shaped to
 * prevent. The picker offers only views that translate whole, and the
 * materializer treats a stored reference to one that does not the way it
 * treats a deleted segment.
 *=========================================*/

/** What a view's filters became — see the section note. */
export interface DynamicListViewTranslation {
  dimensions: DynamicListDimensions
  /** The clauses this language has no dimension for. Empty means an audience. */
  unsupported: CrmViewFilterClause[]
}

const DAY_MS = 86_400_000

/** The values an `isAnyOf` carries, or the one an equality does; `null` for any other operator. */
const viewClauseValues = (clause: CrmViewFilterClause): string[] | null => {
  const value = clause.value.trim()
  if (clause.op === 'isAnyOf') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  if (clause.op === 'equals' || clause.op === 'is' || clause.op === 'contains') {
    return value ? [value] : []
  }
  return null
}

const CUSTOM_VIEW_OPS: Readonly<Record<string, DynamicListCustomOp>> = {
  equals: 'eq',
  is: 'eq',
  '=': 'eq',
  doesNotEqual: 'neq',
  '!=': 'neq',
  contains: 'contains',
  '>': 'gt',
  '<': 'lt',
  isNotEmpty: 'set',
  isEmpty: 'unset',
}

/**
 * A view's filters as the dimensions of one AND-block, and the clauses
 * that could not be.
 *
 * Every list operator keeps its own meaning across the translation:
 * `isAnyOf` is the OR the dimension lists already are, an equality is a
 * list of one, a `contains` on the tag array is one tag matched whole. The
 * dates read the clause's value as an instant — a day, as the filter bar
 * writes one — with `after` and `onOrBefore` stepping a day past it the
 * way the list's own matcher does. A purchase threshold has a floor here
 * and no ceiling, so `at least` and `over` carry and `under` cannot.
 */
export function dynamicListDimensionsForCrmView(
  filters: readonly CrmViewFilterClause[],
): DynamicListViewTranslation {
  const fields = CRM_CONTACT_VIEW_FIELDS
  const dimensions: DynamicListDimensions = {}
  const unsupported: CrmViewFilterClause[] = []
  const behavior: DynamicListBehavior = {}
  const custom: DynamicListCustomClause[] = []
  const extend = (
    key: 'tags' | 'ownerUids' | 'companyIds',
    values: string[],
  ) => {
    dimensions[key] = [...(dimensions[key] ?? []), ...values]
  }

  for (const clause of filters) {
    const values = viewClauseValues(clause)
    const value = clause.value.trim()
    const customKey = crmContactCustomKey(clause.field)
    if (customKey !== null) {
      const key = normalizeContactFieldKey(customKey)
      const op = CUSTOM_VIEW_OPS[clause.op]
      if (key && op) {
        custom.push(
          op === 'set' || op === 'unset' ? { key, op } : { key, op, value },
        )
        continue
      }
      unsupported.push(clause)
      continue
    }
    switch (clause.field) {
      case fields.tags:
        if (values?.length) {
          extend('tags', values.map((tag) => tag.toLowerCase()))
          continue
        }
        break
      case fields.source:
        if (values?.length) {
          const sources = values.filter(
            (source): source is ContactSource => source in CONTACT_SOURCE_LABELS,
          )
          if (sources.length === values.length) {
            dimensions.captureSources = [
              ...(dimensions.captureSources ?? []),
              ...sources,
            ]
            continue
          }
        }
        break
      case fields.owner:
        if (values?.length) {
          extend('ownerUids', values)
          continue
        }
        break
      case fields.stage:
        if (values?.length && values.every(isContactLifecycleStage)) {
          dimensions.lifecycleStages = [
            ...(dimensions.lifecycleStages ?? []),
            ...(values as ContactLifecycleStage[]),
          ]
          continue
        }
        break
      case fields.company:
        if (values?.length) {
          extend('companyIds', values)
          continue
        }
        break
      case fields.createdAt: {
        const at = Date.parse(value)
        if (Number.isFinite(at)) {
          if (clause.op === 'after') dimensions.createdAfterMs = at + DAY_MS
          else if (clause.op === 'onOrAfter') dimensions.createdAfterMs = at
          else if (clause.op === 'before') dimensions.createdBeforeMs = at
          else if (clause.op === 'onOrBefore') {
            dimensions.createdBeforeMs = at + DAY_MS
          } else if (clause.op === 'is') {
            dimensions.createdAfterMs = at
            dimensions.createdBeforeMs = at + DAY_MS
          } else break
          continue
        }
        break
      }
      case fields.orders:
      case fields.ltv: {
        const amount = Number(value)
        if (Number.isFinite(amount) && (clause.op === '>=' || clause.op === '>')) {
          const floor = clause.op === '>' ? amount + 1 : amount
          if (clause.field === fields.orders) behavior.ordersCountAtLeast = floor
          else behavior.ltvCentsAtLeast = floor
          continue
        }
        break
      }
      default:
        break
    }
    unsupported.push(clause)
  }

  if (Object.keys(behavior).length) dimensions.behavior = behavior
  if (custom.length) dimensions.custom = custom
  return { dimensions, unsupported }
}

/**
 * The rule the sweep PLANS with once a view is resolved: the rule itself
 * with the view's block beside its branches, so the planners that read
 * every block — does this need the contact facet, an engagement lookup, a
 * list membership — see the view's dimensions too. For planning only; the
 * matcher takes the view as its own option, because a branch is OR and a
 * view is AND.
 */
export function dynamicListPlanningRule(
  rule: DynamicListRule,
  view: DynamicListDimensions | null,
): DynamicListRule {
  if (!view || Object.keys(view).length === 0) return rule
  return { ...rule, any: [...(rule.any ?? []), view] }
}
