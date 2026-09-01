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
 * Materializes a `kind: 'dynamic'` list's rule into its `members`
 * subcollection (`docs/specs/email-overhaul.md` §3b/§3e).
 *
 * A dynamic list does NOT resolve at send time. It stores a rule, a sweep
 * writes the matching people into the same `members` collection a manual list
 * uses, and the send path keeps reading one deterministic collection. Three
 * reasons, all of them things that have already gone wrong here:
 *
 * 1. The send must not run an unbounded scan — that is what produced an
 *    arbitrary, unstable 500 of a site's 3,000 leads.
 * 2. The composer needs a cheap count, not a 5,000-document scan per
 *    keystroke.
 * 3. "Who did this campaign go to" is a support question and a compliance
 *    question. A materialized membership answers it; a rule re-evaluated
 *    later does not.
 *
 * ## ⛔ A CEILING NEVER REMOVES A PERSON
 *
 * This function has no quota comparison and must never grow one. Capacity in
 * this product is enforced at the REDUCTION, not at the use: a limit that
 * refuses a person or their data leaks, because the person is already there
 * and dropping them is not a refusal, it is deletion. So a rule that matches
 * more people than a plan's audience band, or than a single send's recipient
 * cap, materializes ALL of them. The ceiling that a large audience meets is
 * `performCampaignSend`'s, which refuses the SEND and states the count it
 * found — a refusal the merchant can see, argue with, and act on, where a
 * trimmed membership is silent and unreproducible.
 *
 * What bounds this function is the per-run SCAN budget below, which is a
 * different thing: it bounds how much work one sweep does, and the cursor it
 * returns resumes the same sweep on the next run. Running out of budget
 * postpones enrollments; it never removes anybody, and it never finishes a
 * sweep it did not complete.
 */

import { FieldValue } from 'firebase-admin/firestore'
import type {
  DocumentReference,
  Query,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import {
  soloConsentGroup,
  candidateMatchesDynamicListRule,
  dynamicListRuleIsEmpty,
  dynamicListRuleListIds,
  dynamicListRuleWithoutListReference,
  dynamicListRuleNeedsCampaigns,
  dynamicListRuleNeedsEngagement,
  extractEmailFromFields,
  normalizeContactEmail,
  normalizeDynamicListRule,
  personKey,
  readCampaignIds,
  readContactCampaignIds,
  type DynamicListCandidate,
  type DynamicListRule,
  type DynamicListSource,
  type ResolvedSegmentFilters,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from './firebase-admin'
import { readPersonEngagementByKeys } from './email-delivery-log'
import { enrollListMember } from './list-members'
import {
  consentGroupForSite,
  orgDataCollectionForHost,
  scopedToHost,
} from './organizations'

/**
 * Documents one sweep run may READ across all sources.
 *
 * A bound on work, not on membership. When a run exhausts it the sweep stops
 * where it is, returns `complete: false` with the cursor it reached, and the
 * next run continues — the shape the import-history sweep already uses. The
 * alternative, an unbounded scan of every silo per list per run, is the
 * expensive-read pattern this codebase refuses.
 *
 * ⚠️ Membership reconciliation is SKIPPED on an incomplete run. A partial
 * scan has only seen part of the population, so anybody it did not reach
 * would look like a non-match — and acting on that would delete real members
 * because a budget ran out.
 */
export const DYNAMIC_LIST_SCAN_BUDGET = 5_000

/** Documents read per source page. */
const PAGE_SIZE = 500

/**
 * ⚠️ THE DATE FIELDS THIS FILE READS, AND WHO WRITES THEM.
 *
 * `createdAfterMs`/`createdBeforeMs` are applied IN MEMORY against
 * `createdAt`, never as a Firestore `orderBy` or `where`. That distinction is
 * the whole safety property: an `orderBy` on a data field drops every document
 * missing it from the QUERY, invisibly, where an in-memory filter still reads
 * the document and merely decides it does not match. The paging order is
 * `__name__`, the one key every document has.
 *
 * The rule's decision for an undated record is to EXCLUDE it, so the writers
 * were checked rather than assumed — a silo with an unstamped writer would
 * quietly shrink every dated rule:
 *
 * - `leads` — `addHostLead` is the single writer and always stamps it.
 * - `siteMembers` — `membership-register.ts` is the only creator; the other
 *   member routes read or update an existing document.
 * - `contacts` — `upsertHostContact`'s create path and the v1 API both stamp.
 * - `formSubmissions` — the submit route is the only creator; the v1 API and
 *   the inbox reply route read.
 *
 * A new writer of any of those four must stamp `createdAt` or be added here.
 *
 * ## Campaign membership is read the same way — off the paged document
 *
 * `campaignIds` is applied in memory too, and for a second reason beyond the
 * one above: it is an ARRAY, so a Firestore `array-contains-any` could express
 * only the single-campaign case and would need a composite index the moment it
 * met any other filter in the rule. The membership is already on the document
 * this scan has read, on a submission at the top and on a contact inside the
 * reading holder's facet, so matching it costs nothing the page did not
 * already pay.
 */

/** Where a partial sweep stopped, so the next run resumes rather than restarts. */
export interface DynamicListCursor {
  /** The source being scanned when the budget ran out. */
  source: DynamicListSource
  /** The last document id read from it. */
  afterId: string
}

export interface MaterializeDynamicListResult {
  /** People the rule matched and that are now enrolled. */
  matched: number
  /** Rows created by this run. */
  enrolled: number
  /** Rule-owned rows removed because the person no longer matches. */
  removed: number
  /** False when the scan budget ran out — `cursor` says where to resume. */
  complete: boolean
  cursor: DynamicListCursor | null
  /**
   * True when the rule selects nobody by construction (no sources). Reported
   * rather than silently materializing an empty list, because an empty list
   * reads in the composer exactly like a rule that has not run yet.
   */
  empty: boolean
}

/** What a read-only pass over the silos found. */
export interface DynamicListScanResult {
  /** Matched people, de-duplicated across silos by their person key. */
  candidates: DynamicListCandidate[]
  /** False when the scan budget ran out — `cursor` says where to resume. */
  complete: boolean
  cursor: DynamicListCursor | null
  /**
   * True when the rule selects nobody by construction — no sources, or a
   * `segmentId` naming a segment that no longer exists.
   */
  empty: boolean
  /** Documents read, against the budget. */
  read: number
}

/**
 * The silo collections, as queries.
 *
 * `contacts` is org-scoped and must go through `scopedToHost` — the Admin SDK
 * does not evaluate rules, so an unfiltered read would let one site's list
 * materialize another site's contacts. The other three are host-owned and
 * carry no `visibleTo` to filter on.
 */
async function sourceQuery(
  source: DynamicListSource,
  hostId: string,
): Promise<Query> {
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
  if (source === 'contacts') {
    const ref = await orgDataCollectionForHost(hostId, 'contacts')
    return scopedToHost(ref, hostId)
  }
  return hostRef.collection(source)
}

const millis = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const toMillis = (value as { toMillis?: unknown } | null)?.toMillis
  if (typeof toMillis === 'function') {
    const parsed = Number(toMillis.call(value))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Reads one silo document into the shape the rule matcher understands.
 *
 * @param groupId the consent group whose contact facet the campaign membership
 *   is read from, or `null` when the rule names no campaign and none was
 *   resolved. A contact row is shared by every site in the org and its
 *   membership lives inside one holder's facet, so there is no expression here
 *   that returns another holder's filing.
 */
function toCandidate(
  source: DynamicListSource,
  doc: QueryDocumentSnapshot,
  groupId: string | null,
): DynamicListCandidate | null {
  const data = doc.data() as Record<string, unknown>
  const email =
    source === 'formSubmissions'
      ? // A form does not guarantee a canonical email field, so this is the
        // same best-effort extraction the submissions route already uses to
        // decide whether a submission produces a contact at all.
        extractEmailFromFields(data['fields'] as Record<string, unknown>)
      : normalizeContactEmail(data['email'])
  if (!email) return null
  const createdAtMs = millis(data['createdAt'])
  return {
    silo: source,
    email,
    // `siteMembers` stores `displayName`; the rest store `name`. Reading only
    // `name` is what left every member campaign's merge tags blank.
    name:
      (typeof data['name'] === 'string' && data['name']) ||
      (typeof data['displayName'] === 'string' && data['displayName']) ||
      undefined,
    createdAtMs,
    ...(source === 'contacts'
      ? {
          tags: (data['tags'] as string[]) ?? [],
          sources: (data['sources'] as DynamicListCandidate['sources']) ?? {},
          ordersCount: Number(data['ordersCount'] ?? 0),
          ltvCents: Number(data['ltvCents'] ?? 0),
          lastPurchaseAtMs: millis(data['lastPurchaseAtMs']),
          // Inside the holder's facet, never the top of the document. A rule
          // with no campaign clause resolves no group and reads nothing here,
          // which is what keeps the group lookup an opt-in cost.
          ...(groupId
            ? { campaignIds: readContactCampaignIds(data, groupId) }
            : {}),
        }
      : {}),
    ...(source === 'formSubmissions'
      ? {
          formName: String(data['formName'] ?? ''),
          // At the TOP of a submission, because a submission belongs to one
          // site — the same shape every other host resource carries it in.
          campaignIds: readCampaignIds(data),
        }
      : {}),
  }
}

/*==========================================
 * ENRICHMENT — the two dimensions the scan cannot read off a silo row.
 *
 * Engagement lives on `emailDeliveries/{personKey}` and list membership on
 * `orgs/{orgId}/lists/{listId}/members/{personKey}`. Both describe an ADDRESS
 * rather than a contact, a lead or a submission, so neither is in the
 * document the sweep just paged.
 *
 * Three properties, and each of them is a thing that could otherwise go
 * wrong here:
 *
 *  1. **KEYED reads, never queries.** `getAll` over document references. No
 *     `where`, no `orderBy`, so no composite index, nothing that can be
 *     truncated by a `limit`, and — the failure this codebase has hit
 *     nineteen times — nothing that silently drops a document for missing
 *     the field being ordered on.
 *  2. **Opt-in.** A rule with no engagement clause and no list reference
 *     pays nothing at all. The cost belongs to the rules that ask for it,
 *     not to every sweep.
 *  3. **Charged to the SAME scan budget.** Every enrichment read is counted
 *     in `read`, so a rule that asks for engagement fills the budget faster
 *     and its sweep simply takes more runs. The budget and the resume cursor
 *     keep working exactly as they did; what changes is how much of the
 *     budget one page costs.
 *=========================================*/

/** What a rule needs looked up, resolved once per scan rather than per page. */
interface EnrichmentPlan {
  engagement: boolean
  /** `listId` → that list's `members` collection. */
  listMembers: Map<string, FirebaseFirestore.CollectionReference>
}

/**
 * Resolves what a rule needs enriched.
 *
 * A named list that no longer exists resolves to a collection with no
 * documents, which reads as "nobody is a member" — the same direction a
 * deleted `segmentId` takes, and the safe one: an `inListIds` naming a
 * deleted list selects nobody rather than everybody, and a `notInListIds`
 * naming one excludes nobody rather than the whole audience.
 */
async function planEnrichment(
  rule: DynamicListRule,
  hostId: string,
): Promise<EnrichmentPlan> {
  const listIds = dynamicListRuleListIds(rule)
  const listMembers = new Map<string, FirebaseFirestore.CollectionReference>()
  if (listIds.length) {
    const lists = await orgDataCollectionForHost(hostId, 'lists')
    for (const listId of listIds) {
      listMembers.set(listId, lists.doc(listId).collection('members'))
    }
  }
  return { engagement: dynamicListRuleNeedsEngagement(rule), listMembers }
}

/** True when nothing needs looking up, so the page loop can skip the work. */
function planIsEmpty(plan: EnrichmentPlan): boolean {
  return !plan.engagement && plan.listMembers.size === 0
}

/**
 * Fills the enrichment fields on one page's candidates.
 *
 * Keys are de-duplicated first: two silos can produce the same person on one
 * page, and looking them up twice would spend budget on an answer already in
 * hand.
 *
 * @returns how many documents were read, for the caller's budget.
 */
async function enrichCandidates(
  candidates: DynamicListCandidate[],
  plan: EnrichmentPlan,
): Promise<number> {
  if (!candidates.length || planIsEmpty(plan)) return 0
  const keyed = new Map<string, DynamicListCandidate[]>()
  for (const candidate of candidates) {
    const key = personKey(candidate.email)
    if (!key) continue
    const held = keyed.get(key)
    if (held) held.push(candidate)
    else keyed.set(key, [candidate])
  }
  const keys = [...keyed.keys()]
  if (!keys.length) return 0
  const firestore = firebaseAdmin.app().firestore()
  let read = 0

  if (plan.engagement) {
    // The scan's own Firestore handle, passed rather than defaulted: the
    // rollup lives in another module with its own default, and two handles in
    // one sweep is two things a caller has to configure to reach one store.
    const engagement = await readPersonEngagementByKeys(keys, firestore)
    read += keys.length
    for (const [key, rows] of keyed) {
      const found = engagement.get(key)
      for (const candidate of rows) {
        candidate.lastOpenedAtMs = found?.lastOpenedAtMs ?? null
        candidate.lastClickedAtMs = found?.lastClickedAtMs ?? null
      }
    }
  }

  if (plan.listMembers.size) {
    // No pre-seeding of `listIds`. A candidate found on no list keeps the
    // field absent, and the matcher reads absent as "on no list" — see
    // `candidateMatchesDynamicListRule` for why that direction is the safe
    // one. Writing an empty array first would be a line saying the same thing
    // the matcher already says.
    for (const [listId, members] of plan.listMembers) {
      let snapshots: FirebaseFirestore.DocumentSnapshot[] = []
      try {
        snapshots = await firestore.getAll(
          ...keys.map((key) => members.doc(key)),
        )
      } catch (error) {
        // A failed membership lookup leaves every candidate reading as a
        // non-member of this list. That keeps an `inListIds` rule from
        // enrolling people it could not confirm, and it is the direction a
        // reader can recover from — the next sweep asks again.
        console.error('[dynamic-list] list membership lookup failed', listId, error)
      }
      read += keys.length
      for (const snapshot of snapshots) {
        if (!snapshot?.exists) continue
        for (const candidate of keyed.get(snapshot.id) ?? []) {
          candidate.listIds = [...(candidate.listIds ?? []), listId]
        }
      }
    }
  }

  return read
}

/**
 * WHO A RULE SELECTS, without writing anything.
 *
 * The scan and the enrollment used to be one function, so "who would this
 * match" could only be answered by materializing it. That is the wrong shape
 * for two callers that now exist: a merchant asking to see an audience before
 * committing to it, and a fixed list using the filters to FIND people to add.
 * Neither may write memberships as a side effect of a question.
 *
 * One scanner rather than two. Every subtlety here is a place a second
 * implementation would drift — the in-memory date filter (an `orderBy` on a
 * data field would DROP undated documents rather than merely not matching
 * them), the `__name__` paging order, `scopedToHost` on `contacts` and on
 * nothing else, and a deleted `segmentId` narrowing to nobody rather than
 * widening to everybody. `materializeDynamicList` reads this and then enrolls.
 *
 * NOTHING here writes, and nothing here compares a count against a limit.
 */
export async function collectDynamicListCandidates(options: {
  hostId: string
  rule: unknown
  resume?: DynamicListCursor | null
  nowMs?: number
  scanBudget?: number
}): Promise<DynamicListScanResult> {
  const rule: DynamicListRule = normalizeDynamicListRule(options.rule)
  const nowMs = options.nowMs ?? Date.now()
  const budget = options.scanBudget ?? DYNAMIC_LIST_SCAN_BUDGET
  if (dynamicListRuleIsEmpty(rule)) {
    return { candidates: [], complete: true, cursor: null, empty: true, read: 0 }
  }

  // A saved segment's filters, resolved ONCE rather than per candidate.
  let segment: ResolvedSegmentFilters | null = null
  if (rule.segmentId) {
    const segments = await orgDataCollectionForHost(
      options.hostId,
      'contactSegments',
    )
    const snapshot = await segments.doc(rule.segmentId).get()
    // A deleted segment narrows to nothing rather than widening to everybody:
    // a rule whose filter vanished must not start matching the whole org.
    if (!snapshot.exists) {
      return {
        candidates: [],
        complete: true,
        cursor: null,
        empty: true,
        read: 0,
      }
    }
    segment = {
      tags: (snapshot.get('tags') as string[]) ?? [],
      sources: (snapshot.get('sources') as ResolvedSegmentFilters['sources']) ?? [],
    }
  }

  // Resolved once for the whole scan: it names collections, and re-resolving
  // the org for every page would be a read per page for an unchanging answer.
  const enrichment = await planEnrichment(rule, options.hostId)

  /*
   * THE HOLDER whose contact facet a campaign clause is read from.
   *
   * The same group the writers use — the sites declared to be one sender, or
   * this site alone — because a facet written under one group id and read
   * under another is a membership that silently matches nobody. Resolved once,
   * and only for a rule that names a campaign: a rule with no campaign clause
   * pays no org read at all, which is the shape the engagement and list
   * lookups already take.
   */
  const campaignGroupId = dynamicListRuleNeedsCampaigns(rule)
    ? (await consentGroupForSite(options.hostId)).groupId
    : null

  /** Matched people, de-duplicated across silos by their person key. */
  const matches = new Map<string, DynamicListCandidate>()
  let read = 0
  let cursor: DynamicListCursor | null = null
  let complete = true

  const ordered = rule.sources
  const resumeIndex = options.resume
    ? ordered.indexOf(options.resume.source)
    : -1

  scan: for (let index = 0; index < ordered.length; index += 1) {
    const source = ordered[index] as DynamicListSource
    // A resume skips the sources already finished and re-enters the one that
    // was interrupted at the id it stopped on.
    if (resumeIndex >= 0 && index < resumeIndex) continue
    let after = resumeIndex === index ? options.resume?.afterId ?? '' : ''
    const base = await sourceQuery(source, options.hostId)
    for (;;) {
      /*
       * Ordered by document id, and paged with a `startAfter` cursor.
       *
       * `orderBy(FieldPath.documentId())` rather than a data field on
       * purpose: an `orderBy` on a field DROPS every document missing it, and
       * these four collections have writers old enough that no data field is
       * guaranteed on every row. The id is on all of them, so this is a total
       * order that cannot silently omit a person — which is the whole point
       * of the exercise, since the defect being fixed is an unordered
       * `limit()` returning an arbitrary subset.
       */
      let page = base
        .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
        .limit(PAGE_SIZE)
      if (after) page = page.startAfter(after)
      const snapshot = await page.get()
      if (snapshot.empty) break
      /*
       * The page is read into candidates FIRST, then enriched, then matched.
       *
       * A per-document match would mean a per-document enrichment lookup, and
       * the whole reason enrichment is affordable is that one page's people
       * are fetched in one `getAll`. Only candidates are enriched — a
       * document with no usable address is dropped by `toCandidate` before it
       * can cost a lookup.
       */
      const pageCandidates: DynamicListCandidate[] = []
      for (const doc of snapshot.docs) {
        read += 1
        after = doc.id
        const candidate = toCandidate(source, doc, campaignGroupId)
        if (candidate) pageCandidates.push(candidate)
      }
      read += await enrichCandidates(pageCandidates, enrichment)
      for (const candidate of pageCandidates) {
        if (
          !candidateMatchesDynamicListRule(candidate, rule, { segment, nowMs })
        ) {
          continue
        }
        const key = personKey(candidate.email)
        if (key && !matches.has(key)) matches.set(key, candidate)
      }
      if (read >= budget) {
        complete = false
        cursor = { source, afterId: after }
        break scan
      }
      if (snapshot.size < PAGE_SIZE) break
    }
  }


  return {
    candidates: [...matches.values()],
    complete,
    cursor,
    empty: false,
    read,
  }
}

/**
 * Re-evaluates one dynamic list and writes the result into its members.
 *
 * @param listRef `orgs/{orgId}/lists/{listId}` — the caller has proved it
 *                exists and that it is `kind: 'dynamic'`.
 * @param hostId  the site whose silos the rule draws from, and the scope the
 *                org-owned contacts read is narrowed to.
 * @param resume  a cursor from a previous incomplete run.
 */
export async function materializeDynamicList(options: {
  listRef: DocumentReference
  hostId: string
  rule: unknown
  resume?: DynamicListCursor | null
  nowMs?: number
  /**
   * The scan budget. Passed by NOTHING in production — it exists so the suite
   * can drive a sweep into an exhausted budget and require that it still
   * removes nobody. A guarantee that only holds at the production budget was
   * never that guarantee.
   */
  scanBudget?: number
}): Promise<MaterializeDynamicListResult> {
  /*
   * The rule cannot refer to the list it materializes — see
   * `dynamicListRuleWithoutListReference` for the oscillation that produces,
   * and note that half of its beats are DELETIONS of rows this sweep created.
   * Stripped here rather than at authoring time because the rule outlives any
   * one form: an API caller, an import and a copied list would each need to
   * remember, and the sweep is the one place all of them arrive.
   */
  const rule = dynamicListRuleWithoutListReference(
    normalizeDynamicListRule(options.rule),
    options.listRef.id,
  )
  const scan = await collectDynamicListCandidates({
    hostId: options.hostId,
    rule,
    ...(options.resume ? { resume: options.resume } : {}),
    ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    ...(options.scanBudget !== undefined
      ? { scanBudget: options.scanBudget }
      : {}),
  })
  if (scan.empty) {
    return {
      matched: 0,
      enrolled: 0,
      removed: 0,
      complete: true,
      cursor: null,
      empty: true,
    }
  }
  const { complete, cursor } = scan
  /*
   * Re-keyed by person rather than carried as a Map across the seam.
   *
   * Reconciliation below asks `matches.has(key)` about a stored row's id and
   * about its address, so it needs the same key the scan de-duplicated on —
   * computed by the same function, from the same addresses.
   */
  const matches = new Map<string, DynamicListCandidate>()
  for (const candidate of scan.candidates) {
    const key = personKey(candidate.email)
    if (key) matches.set(key, candidate)
  }

  let enrolled = 0
  for (const candidate of matches.values()) {
    const result = await enrollListMember({
      listRef: options.listRef,
      // A group of one, and it costs nothing: the materializer passes NO
      // consent (see below), so the group decides only which site is recorded
      // as having captured the row.
      group: soloConsentGroup(options.hostId),
      email: candidate.email,
      ...(candidate.name ? { name: candidate.name } : {}),
      source: `rule:${candidate.silo}`,
      via: 'rule',
      /*
       * ⛔ NO CONSENT IS PASSED, EVER.
       *
       * Matching a rule is not consenting to anything — the person is here
       * because they bought something, filled in a form or hold an account,
       * and none of those is an opt-in. Stamping a basis from a rule match
       * would let any merchant manufacture consent for their whole contact
       * list by writing a rule that selects it, which is precisely the
       * inference the consent arc refused to make. Their real basis, if they
       * have one, is on their own record and the send-time join reads it
       * there.
       */
    })
    // A refusal is not a materialization failure: an unusable address and a
    // person whose row records a refusal are both simply not on this list,
    // and a rule that selected them does not overrule either.
    if (result.enrolled && result.created) enrolled += 1
  }

  /*
   * Reconciliation is allowed only for a run that saw the WHOLE population:
   * one that started at the beginning AND finished.
   *
   * `complete` alone is not enough, and that is the trap. A run that RESUMES
   * from a cursor finishes the tail of the scan and reports `complete: true`
   * having examined only the tail — so its match set is the remainder, and
   * reconciling against it would delete every member found by the earlier
   * runs of the same sweep. That is a quota drop wearing the costume of a
   * membership change: nothing about it looks like a limit, and it removes
   * people for no reason but how the work was chunked.
   *
   * The cost is that a list whose population exceeds one run's scan budget
   * never reconciles, so somebody who stops matching stays enrolled until a
   * sweep fits in one run. That is the right way round: an over-full list is
   * a wrong count, which is recoverable, and a deleted enrollment destroys
   * the record that says the person asked to be there, which is not.
   */
  const sawWholePopulation = complete && !options.resume
  let removed = 0
  if (sawWholePopulation) {
    /*
     * Reconciliation.
     *
     * Only rows this materializer created are eligible (`via === 'rule'`). A
     * row somebody enrolled by hand, or that an automation's `enrollList`
     * step wrote, stays on a dynamic list forever: it was put there by a
     * decision, and a rule that does not happen to select that person is not
     * a decision to remove them. Rows written before `via` existed carry no
     * `via` at all and are therefore never eligible either, which is the
     * conservative direction for a field introduced after the data.
     *
     * This is the one removal in this file and it is a MEMBERSHIP change —
     * the person stopped matching the rule. It is not a capacity decision and
     * there is no count in the condition.
     */
    const existing = await options.listRef
      .collection('members')
      .where('via', '==', 'rule')
      .get()
    for (const doc of existing.docs) {
      if (matches.has(doc.id)) continue
      // A row adopted under a legacy id is keyed by neither `personKey` nor
      // anything this sweep computed, so it is matched by ADDRESS as well
      // before being removed. Getting that wrong un-enrolls a person who
      // still matches the rule.
      const email = normalizeContactEmail(doc.get('email'))
      const key = email ? personKey(email) : null
      if (key && matches.has(key)) continue
      await doc.ref.delete()
      removed += 1
    }
  }

  await options.listRef.set(
    {
      kind: 'dynamic',
      // The count the composer reads instead of scanning. Written only by a
      // run that saw everybody, for the same reason reconciliation is: a
      // partial or resumed run measured a fraction, and publishing that as
      // the list's size would under-report the audience in the one place a
      // merchant checks it before sending.
      ...(sawWholePopulation ? { memberCount: matches.size } : {}),
      lastEvaluatedAt: FieldValue.serverTimestamp(),
      ...(cursor ? { evaluationCursor: cursor } : { evaluationCursor: null }),
    },
    { merge: true },
  )

  return {
    matched: matches.size,
    enrolled,
    removed,
    complete,
    cursor,
    empty: false,
  }
}
