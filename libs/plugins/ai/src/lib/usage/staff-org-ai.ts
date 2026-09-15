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

// Imported from BOTH graphs — the staff card (client) and the App Route that
// serves it — so it may import neither entry barrel, for the reason
// `margin-utilization.ts` states at its own head.
import type { AiJobStatus } from '../model/ai-jobs.types'
import type { AglynOrgBilling, OrgPlan } from '@aglyn/aglyn/foundation'
import {
  assistBandRefuses,
  assistCreditsFromUsd,
  assistMonthOverage,
  assistOverageCapReached,
  assistUsdFromCredits,
  resolveAssistCreditBudget,
  resolveAssistHardCap,
  resolveAssistOverageCapUsd,
} from '@aglyn/aglyn/app-utils/assist-credits'
import {
  AI_ADDON_CREDITS_PER_MONTH,
  hasAiAddon,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  resolveEffectivePlan,
  type DiscountMarginRating,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AssistRefusalCounts } from './assist-refusals'
import {
  AI_USAGE_MONTH_KINDS_FIELD,
  aiCacheHitRate,
  readAiKindMonths,
  type AiKindMonth,
  type AiTokenTotals,
} from '../model/ai-tokens'

/**
 * THE STAFF AI CARD'S FIGURES (AGL-2930), composed from the same helpers the
 * meter, the invoice and the customer's own billing page read.
 *
 * Nothing here runs a query and nothing here holds a rate of its own. The
 * pool is `resolveAssistCreditBudget`, the overage is `assistMonthOverage`,
 * the ceiling is `assistOverageCapReached` — the ONE derivation each of those
 * already is — so the card cannot show a staff member a different band,
 * rate or ceiling from the one the gate refused a customer at.
 */

/** The four ways the reservation refuses, plus their sum. */
export type StaffOrgAiRefusals = AssistRefusalCounts

export interface StaffOrgAiAddon {
  /** Bought and on a subscription still paying for it — `hasAiAddon`. */
  on: boolean
  /** The add-on's list price on this plan, or null where the plan sells none. */
  priceUsd: number | null
  /** ISO instant the subscription item was created, when Stripe could say. */
  since: string | null
  /**
   * Where `since` came from, so an absent date is legible: `stripe` answered,
   * the org has no Stripe subscription to ask, or Stripe could not be asked
   * (no key on this deployment, or the lookup failed).
   */
  sinceSource: 'stripe' | 'no-subscription' | 'unavailable'
}

export interface StaffOrgAiPool {
  /** The plan's own band, from the catalogue row. */
  planCredits: number
  /** A staff override of the band, or null when none is written. */
  overrideCredits: number | null
  /** The add-on's band, 0 without the add-on. */
  addonCredits: number
  /** The whole pool as the meter resolves it, or null where no band applies. */
  totalCredits: number | null
  /** Credits drawn this month, rounded up from the measured spend. */
  usedCredits: number
  /** The measured provider spend behind `usedCredits`. */
  providerUsd: number
  /** Left in the pool, clamped at zero, or null where no band applies. */
  remainingCredits: number | null
  /** Where `usedCredits` lands at month end at the pace so far. */
  projectedCredits: number
  projectedUsd: number
  /** Model turns and docs-deflected turns, off the month document. */
  messages: number
  deflected: number
}

export interface StaffOrgAiOverage {
  overageCredits: number
  rateUsdPer1k: number | null
  accruedUsd: number
  /** Whether credits past the band are sold at all on this org. */
  sellsOverage: boolean
  /** The org's own band switch — `assistOverage.hardCap`. */
  hardCap: boolean
  /** The org's own dollar ceiling on overage — `assistOverage.capUsd`. */
  capUsd: number | null
  capReached: boolean
  /** Whether the band is a wall for any reason (the switch, or no rate). */
  bandRefuses: boolean
}

export interface StaffOrgAiMargin {
  /** The add-on's list price when it is on, else 0. */
  addonRevenueUsd: number
  /**
   * The provider-spend value of the plan's own band — what the plan price
   * sets aside for assist. Each plan band is sized as a cost figure (a
   * thousand credits are a dollar), so this is the share of the subscription
   * that was sold as AI, in the unit the spend is measured in.
   */
  planAssistShareUsd: number
  /** Overage priced at the plan's rate, which the invoice will bill. */
  overageRevenueUsd: number
  /** The three above, summed. */
  revenueUsd: number
  /** Measured provider spend this month. */
  spendUsd: number
  /**
   * Spend past what the add-on and the plan's assist share bring in — the
   * condition the card renders red. Overage revenue is left OUT of the
   * comparison on purpose: it is billed at a margin, so an org deep in
   * overage is not the one losing money.
   */
  underwater: boolean
  /** The staff review threshold and the multiple of it the spend has reached. */
  thresholdUsd: number
  multiple: number
  /** The whole-org contribution margin, when a usage rollup exists. */
  contribution: {
    month: string | null
    marginPct: number | null
    rating: DiscountMarginRating | null
  }
}

/** The job model's own status set: the card renders every one by name. */
export type StaffOrgAiJobStatus = AiJobStatus

export interface StaffOrgAiJob {
  id: string
  kind: string
  status: StaffOrgAiJobStatus | string
  creditsReserved: number
  creditsSpent: number
  createdAt: string | null
  createdBy: string | null
}

export interface StaffOrgAiJobs {
  counts: Record<StaffOrgAiJobStatus, number>
  recent: StaffOrgAiJob[]
  /** True when the scan stopped at its ceiling — the counts are a floor. */
  truncated: boolean
}

/** One row of the per-user rollup (AGL-2928), as the staff card lists it. */
export interface StaffOrgAiUser {
  uid: string
  /** The roster's name for them — display name, else email, else the uid. */
  name: string
  credits: number
  /** The measured provider spend behind `credits`; staff may see dollars. */
  estCostUsd: number
  /** Of the org's measured spend for the month, in `[0, 1]`. */
  share: number
  requests: number
  refusals: number
  byKind: Record<string, number>
  byHost: Record<string, number>
}

/** One kind of model request this month, as the card lists it (AGL-2937). */
export interface StaffOrgAiKindTokens extends AiKindMonth {
  /** Measured provider spend per request of this kind; `null` with none. */
  costPerRequestUsd: number | null
  /** The share of this kind's prompt tokens the cache served — `aiCacheHitRate`. */
  cacheHitRate: number | null
}

/** The month's tokens (AGL-2937): its totals, its cache hit rate, and each kind. */
export interface StaffOrgAiTokens {
  /** The month document's own four totals. */
  total: AiTokenTotals
  cacheHitRate: number | null
  /** Dearest first; empty for a month written before kinds were kept. */
  kinds: StaffOrgAiKindTokens[]
}

export interface StaffOrgAiResponse {
  month: string
  addon: StaffOrgAiAddon
  pool: StaffOrgAiPool
  overage: StaffOrgAiOverage
  refusals: StaffOrgAiRefusals
  /** Null when the jobs read failed — distinct from an org with no jobs. */
  jobs: StaffOrgAiJobs | null
  /** The dearest people this month; empty when nobody's month is written. */
  users: StaffOrgAiUser[]
  margin: StaffOrgAiMargin
  /** Tokens by kind (AGL-2937); absent from a route older than the card. */
  tokens?: StaffOrgAiTokens
}

const finite = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** The UTC day-of-month and month length `projectMonthEnd` scales by. */
export function monthProgress(now: Date): { elapsed: number; length: number } {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  return {
    elapsed: now.getUTCDate(),
    length: new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
  }
}

/**
 * Where a month-to-date figure lands at month end at the pace so far.
 *
 * Linear, on whole UTC days, and deliberately no cleverer: the reader is
 * asking "will this org clear its band" and a straight line answers that
 * within the margin the question needs. Day one projects the first day's
 * spend across the month, which over-reads a burst — the direction a
 * monitoring figure should err in.
 */
export function projectMonthEnd(usedSoFar: number, now: Date): number {
  const { elapsed, length } = monthProgress(now)
  if (!(usedSoFar > 0) || elapsed <= 0) return 0
  return Math.ceil((usedSoFar / elapsed) * length)
}

/** The staff override of the assist band, or null when none is written. */
function assistBandOverride(
  org: Partial<AglynOrgBilling> | null | undefined,
): number | null {
  const raw = (org?.entitlements as Record<string, unknown> | undefined)?.[
    'assistCreditsPerMonth'
  ]
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  return Math.floor(raw)
}

export function composeStaffOrgAiPool(
  org: Partial<AglynOrgBilling> | null | undefined,
  monthDoc: Record<string, unknown> | null | undefined,
  now: Date,
): StaffOrgAiPool {
  const plan = resolveEffectivePlan(org) as OrgPlan
  const addon = hasAiAddon(org)
  const providerUsd = finite(monthDoc?.['estCostUsd'])
  const usedCredits = assistCreditsFromUsd(providerUsd)
  const totalCredits = resolveAssistCreditBudget(org)
  const projectedCredits = projectMonthEnd(usedCredits, now)
  return {
    planCredits: finite(PLAN_ENTITLEMENTS[plan]?.assistCreditsPerMonth),
    overrideCredits: assistBandOverride(org),
    addonCredits: addon ? AI_ADDON_CREDITS_PER_MONTH[plan] : 0,
    totalCredits,
    usedCredits,
    providerUsd,
    remainingCredits:
      totalCredits === null ? null : Math.max(0, totalCredits - usedCredits),
    projectedCredits,
    projectedUsd: assistUsdFromCredits(projectedCredits),
    messages: Math.floor(finite(monthDoc?.['messages'])),
    deflected: Math.floor(finite(monthDoc?.['deflected'])),
  }
}

/**
 * The month's tokens as the card reads them: the totals the month document
 * has always kept, and its `kinds` map (`model/ai-tokens.ts`) with the cost
 * per request and the cache hit rate worked out per kind.
 */
export function composeStaffOrgAiTokens(
  monthDoc: Record<string, unknown> | null | undefined,
): StaffOrgAiTokens {
  const total: AiTokenTotals = {
    input: Math.floor(finite(monthDoc?.['inputTokens'])),
    cached: Math.floor(finite(monthDoc?.['cacheReadTokens'])),
    cacheWrite: Math.floor(finite(monthDoc?.['cacheWriteTokens'])),
    output: Math.floor(finite(monthDoc?.['outputTokens'])),
  }
  return {
    total,
    cacheHitRate: aiCacheHitRate(total),
    kinds: readAiKindMonths(monthDoc?.[AI_USAGE_MONTH_KINDS_FIELD]).map((row) => ({
      ...row,
      costPerRequestUsd:
        row.requests > 0 ? Math.round((row.estCostUsd / row.requests) * 1_000_000) / 1_000_000 : null,
      cacheHitRate: aiCacheHitRate(row.tokens),
    })),
  }
}

export function composeStaffOrgAiOverage(
  org: Partial<AglynOrgBilling> | null | undefined,
  providerUsd: number,
): StaffOrgAiOverage {
  const overage = assistMonthOverage(org, providerUsd)
  return {
    overageCredits: overage.overageCredits,
    rateUsdPer1k: overage.overageRateUsd,
    accruedUsd: overage.overageMonthlyUsd,
    sellsOverage: overage.bandCredits !== null && overage.overageRateUsd !== null,
    hardCap: resolveAssistHardCap(org),
    capUsd: resolveAssistOverageCapUsd(org),
    capReached: assistOverageCapReached(org, providerUsd),
    bandRefuses: assistBandRefuses(org),
  }
}

export function composeStaffOrgAiAddon(
  org: Partial<AglynOrgBilling> | null | undefined,
  since: Pick<StaffOrgAiAddon, 'since' | 'sinceSource'>,
): StaffOrgAiAddon {
  const plan = resolveEffectivePlan(org) as OrgPlan
  return {
    on: hasAiAddon(org),
    priceUsd: PLAN_PRICING[plan]?.aiAddonMonthlyUsd ?? null,
    ...since,
  }
}

export function composeStaffOrgAiMargin(input: {
  org: Partial<AglynOrgBilling> | null | undefined
  pool: StaffOrgAiPool
  overage: StaffOrgAiOverage
  addon: StaffOrgAiAddon
  thresholdUsd: number
  multiple: number
  contribution: StaffOrgAiMargin['contribution']
}): StaffOrgAiMargin {
  const { pool, overage, addon } = input
  const addonRevenueUsd = addon.on ? finite(addon.priceUsd) : 0
  // The band the PLAN sells — the override, when one is written, is what the
  // customer was actually given, so it is the figure the price is carrying.
  const planAssistShareUsd = assistUsdFromCredits(
    pool.overrideCredits ?? pool.planCredits,
  )
  const overageRevenueUsd = overage.accruedUsd
  const revenueUsd =
    Math.round((addonRevenueUsd + planAssistShareUsd + overageRevenueUsd) * 100) /
    100
  return {
    addonRevenueUsd,
    planAssistShareUsd,
    overageRevenueUsd,
    revenueUsd,
    spendUsd: pool.providerUsd,
    underwater: pool.providerUsd > addonRevenueUsd + planAssistShareUsd,
    thresholdUsd: input.thresholdUsd,
    multiple: input.multiple,
    contribution: input.contribution,
  }
}

export const STAFF_ORG_AI_JOB_STATUSES: readonly StaffOrgAiJobStatus[] = [
  'queued',
  'running',
  'needs_input',
  'needs_review',
  'done',
  'failed',
  'canceled',
]

/** Zero-filled counts, so the card renders every status by name. */
export function emptyJobCounts(): Record<StaffOrgAiJobStatus, number> {
  return Object.fromEntries(
    STAFF_ORG_AI_JOB_STATUSES.map((status) => [status, 0]),
  ) as Record<StaffOrgAiJobStatus, number>
}
