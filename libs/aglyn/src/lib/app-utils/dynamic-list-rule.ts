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
 * `createdAt` all three person silos already stamp.
 *
 * ⚠️ A rule selects an AUDIENCE. It does not grant consent — a person matched
 * by "submitted a form" has not opted in by submitting it. Membership and
 * basis are separate joins and `marketing-consent.ts` owns the second one.
 */

import { contactMatchesSegment, type ContactSource } from './contacts'

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

/** The stored `rule` on a `kind: 'dynamic'` list document. */
export interface DynamicListRule {
  /** Which silos to draw from. Empty is not "all" — it matches nobody. */
  sources: DynamicListSource[]
  /** Reuse a saved contact segment's tags and sources. Contacts only. */
  segmentId?: string
  /** Contacts only: at least one of these tags. */
  tags?: string[]
  /** Contacts only: captured by at least one of these surfaces. */
  captureSources?: ContactSource[]
  /** `formSubmissions` only: at least one of these form names, case-insensitive. */
  formNames?: string[]
  /** Any silo: the record was created at or after this instant. */
  createdAfterMs?: number
  /** Any silo: the record was created strictly before this instant. */
  createdBeforeMs?: number
  /** Contacts only. */
  behavior?: DynamicListBehavior
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
export function normalizeDynamicListRule(stored: unknown): DynamicListRule {
  const value = (stored ?? {}) as Record<string, unknown>
  const sources = asStringArray(value['sources']).filter((source): source is DynamicListSource =>
    (DYNAMIC_LIST_SOURCES as string[]).includes(source),
  )
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
  const segmentId = String(value['segmentId'] ?? '').trim()
  const tags = asStringArray(value['tags'])
  const captureSources = asStringArray(value['captureSources']) as ContactSource[]
  const formNames = asStringArray(value['formNames'])
  const createdAfterMs = asPositiveNumber(value['createdAfterMs'])
  const createdBeforeMs = asPositiveNumber(value['createdBeforeMs'])
  return {
    sources,
    ...(segmentId ? { segmentId } : {}),
    ...(tags.length ? { tags } : {}),
    ...(captureSources.length ? { captureSources } : {}),
    ...(formNames.length ? { formNames } : {}),
    ...(createdAfterMs !== undefined ? { createdAfterMs } : {}),
    ...(createdBeforeMs !== undefined ? { createdBeforeMs } : {}),
    ...(Object.keys(normalizedBehavior).length
      ? { behavior: normalizedBehavior }
      : {}),
  }
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
 * Dimensions that do not apply to a candidate's silo are SKIPPED rather than
 * failed. A rule of `sources: ['contacts','siteMembers'], tags: ['vip']` means
 * "VIP contacts, and site members" — reading `tags` against a member document
 * that cannot carry tags would make the second source contribute nobody, and
 * a source that silently contributes nobody is the same defect as a dropped
 * typo above.
 *
 * @param segment filters resolved from `rule.segmentId`, when it names one.
 * @param nowMs   evaluation instant, injected so a sweep is reproducible.
 */
export function candidateMatchesDynamicListRule(
  candidate: DynamicListCandidate,
  rule: DynamicListRule,
  options: { segment?: ResolvedSegmentFilters | null; nowMs: number },
): boolean {
  if (!rule.sources.includes(candidate.silo)) return false

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
      const day = 86_400_000
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
  }

  return true
}
