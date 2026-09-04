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

// Imported from BOTH graphs — the staff page (client) and the App Route that
// serves it — so it may import neither entry barrel, for the reason
// `usage-metering.ts` states at its own head. The specific modules underneath
// are safe in both.
import type { AglynOrgBilling, OrgPlan } from '@aglyn/aglyn/foundation'
import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'
import {
  INFRA_COGS_PER_SITE_USD,
  MARGIN_SCOPE_NOTE,
  netMarginRating,
  orgListPriceMonthlyUsd,
  orgMonthlyCogsUsd,
  orgMonthlyRevenueUsd,
  orgNetMonthlyRevenueUsd,
  orgSiteCount,
  pageViewsFromBandwidthGb,
  resolveOrgEntitlements,
  resolveEffectivePlan,
  type DiscountMarginRating,
  type OrgCogsResult,
  type OrgUsageRollupInput,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

export { MARGIN_SCOPE_NOTE }

/**
 * WHAT SHARE OF THE BANDS THEY BOUGHT DO CUSTOMERS ACTUALLY SPEND?
 *
 * `tier-margin-floor.spec.ts` proves what every tier costs at 100% of every
 * band, and pins the margin at 3 / 25 / 50 / 100%. Which of those four columns
 * the business is actually operating in has never been measured — and the
 * spread between them is the whole question, because on Pro the same price
 * list yields 89.3% at the 3% column and 7.1% at the 100% one.
 *
 * Everything needed to answer it was already recorded and already priced. The
 * monthly rollup carries seven meters, `ORG_COGS_UNIT_RATES_USD` carries their
 * unit costs, and `orgMonthlyCogsUsd` already turns one into the other. What
 * did not exist was the DIVISION: usage over the band the plan sold, per org
 * and across the fleet.
 *
 * This module is that division, and nothing else. It runs no query, holds no
 * rate of its own and re-derives no cost — every dollar here comes back out of
 * `orgMonthlyCogsUsd`, so a surface built on it cannot come to disagree with
 * the discount guardrail about what an org costs.
 *
 * ## The three answers a band can give, and why two of them are not numbers
 *
 * A percentage needs a denominator, and two of the bands in `PLAN_ENTITLEMENTS`
 * do not supply one:
 *
 *  * `UNLIMITED` — `Number.POSITIVE_INFINITY`. Enterprise carries it on
 *    contacts, API requests and dataset storage. `used / Infinity` is 0, which
 *    would render the platform's largest customers as its lightest users; and
 *    a model that clamps to 100% instead would render them as its heaviest.
 *    Both are inventions. The band is UNCAPPED, the fraction is `null`, and no
 *    aggregate may average it in either direction.
 *  * `0` — Free carries it on email sends, API requests and dataset storage.
 *    `0 / 0` is `NaN` and `n / 0` is `Infinity`. Neither is a utilization. The
 *    band admits nothing, so there is no allowance to be a fraction of, and an
 *    org that spent the meter anyway did so with no included band behind it —
 *    which is a cost signal in its own right, reported as
 *    `usageWithNoAllowance` rather than folded into a percentile.
 *
 * The two are kept DISTINCT from each other and from `0%`. An uncapped band
 * and an exhausted one are opposite facts, and the recurring defect in this
 * repo's cost work is exactly that an absent figure reads as a zero one.
 *
 * ## What the bands are
 *
 * `meteredIncludedAllowance` sizes three of them and is the shape followed
 * here: the two PER-HOST bands are expanded by `hostLimit`, the rest are
 * org-wide as stored. `contactsPerHost` is org-wide DESPITE ITS NAME —
 * `checkContactQuota` compares it against an org-wide headcount, and
 * `tier-margin-floor.spec.ts` costs it unexpanded. Following either of those
 * and not the name is what keeps this table agreeing with both.
 */

/**
 * A meter with an included band, keyed by the ROLLUP field it is measured by.
 *
 * The seven `orgMonthlyCogsUsd` prices, plus `hosts` and `assistCredits`.
 *
 * Assist is measured in CREDITS rather than in the dollars the rollup stores.
 * `assistCostUsd` is our provider bill and `assistCreditsPerMonth` is the band
 * the plan sells, so the two are only comparable through
 * `assistCreditsFromUsd` — the one conversion between the units, and the same
 * one the customer-facing meter uses.
 *
 * It is also the band most worth watching: Assist is the only line item on the
 * platform whose unit cost is real money paid to a third party, and the only
 * one that can clear the $2/site floor on its own.
 */
export const UTILIZATION_BANDS = [
  'hosts',
  'storageGb',
  'pageViews',
  'formSubmissions',
  'dataStorageMb',
  'apiRequests',
  'contactsCount',
  'emailSends',
  'assistCredits',
  'workflowRuns',
  'actionRuns',
] as const

export type UtilizationBand = (typeof UTILIZATION_BANDS)[number]

/** Column headings, so the page and the aggregate name a band identically. */
export const UTILIZATION_BAND_LABELS: Record<UtilizationBand, string> = {
  hosts: 'Sites',
  storageGb: 'Media storage',
  pageViews: 'Bandwidth (page views)',
  formSubmissions: 'Form submissions',
  dataStorageMb: 'Dataset storage',
  apiRequests: 'API requests',
  contactsCount: 'Contacts',
  emailSends: 'Email sends',
  assistCredits: 'Assist credits',
  workflowRuns: 'Workflow runs',
  actionRuns: 'Action runs',
}

/**
 * Bands that are MEASURED but not PRICED.
 *
 * `report-usage` records `workflowRuns` and `actionRuns` on every rollup and
 * every plan sells a band of them, so their utilization is a real figure. What
 * does not exist is a unit cost: `ORG_COGS_UNIT_RATES_USD` has no entry for
 * either, and the metering route declines to invent one rather than put a
 * made-up rate into a customer's invoice.
 *
 * That reasoning bounds the COST, not the MEASUREMENT. Utilization needs a
 * numerator and a denominator, and both are recorded — so these two bands are
 * reported here and contribute nothing to `cogs`. Marking them is the
 * alternative to either dropping a measurement the platform already pays to
 * collect, or implying a dollar figure nothing derives.
 */
export const BANDS_WITHOUT_A_UNIT_COST: readonly UtilizationBand[] = [
  'workflowRuns',
  'actionRuns',
]

/**
 * Why a band has no percentage, or that it has one.
 *
 * `uncapped` and `noAllowance` are the two non-numbers described at the head
 * of this module. They are separate values rather than one `null` because the
 * remedies are opposite: an uncapped band is a pricing exposure, an exhausted
 * one is an upgrade conversation.
 */
export type BandState = 'measured' | 'uncapped' | 'noAllowance'

export interface BandUtilization {
  band: UtilizationBand
  /** The org-wide included allowance. `Infinity` when uncapped, 0 when none. */
  included: number
  /** What the rollup recorded. Always a finite, non-negative number. */
  used: number
  state: BandState
  /**
   * Share of the band consumed, as a fraction of 1.
   *
   * `null` for every state but `measured`, and callers must render it as
   * neither 0 nor 1. It is NOT clamped: an org past its included band reads
   * above 1, which is the number worth seeing.
   */
  fraction: number | null
}

/** One org's realised position: what it consumed, what it cost, what it paid. */
export interface OrgMarginRow {
  orgId: string
  name: string | null
  plan: OrgPlan
  /** The rollup month these figures describe, or null when none has run. */
  month: string | null
  bands: Record<UtilizationBand, BandUtilization>
  /**
   * The shared cost model's answer — the same function and the same fields
   * `/api/admin/org-discount` underwrites against.
   */
  cogs: OrgCogsResult
  /** Pre-discount sticker price. */
  listPriceUsd: number
  /** List price net of any per-org discount. */
  mrrUsd: number
  /** MRR net of Stripe's processing fee — the base the margin is taken on. */
  netRevenueUsd: number
  /**
   * `(net revenue − COGS) / net revenue`, the same arithmetic
   * `checkDiscountMargin` rates a discount on. See `MARGIN_SCOPE_NOTE`: it is
   * a contribution margin, not a profit.
   *
   * `null` when the org bills nothing. A free or comped org has no revenue to
   * take a fraction of, and reporting it as 0% or −100% would put a customer
   * who was never meant to be profitable at the top of a list whose whole
   * purpose is finding the one who was.
   */
  marginPct: number | null
  rating: DiscountMarginRating | null
}

/**
 * A rollup as this surface reads it: every field `orgMonthlyCogsUsd` prices,
 * plus the two that are recorded and banded but carry no unit cost.
 *
 * The extra keys are inert to the cost model, which reads by name — so a rollup
 * passed straight through prices exactly as it always did.
 */
export interface UtilizationRollup extends OrgUsageRollupInput {
  workflowRuns?: number | null
  actionRuns?: number | null
}

const finite = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * The org-wide included band for every metered axis, on this org's plan and
 * with this org's overrides and add-ons applied.
 *
 * `resolveOrgEntitlements` rather than `PLAN_ENTITLEMENTS[plan]`: a staff
 * entitlement override and a purchased host add-on both change what the
 * customer actually bought, and measuring consumption against the catalogue
 * row instead of the resolved one is the same class of error as measuring it
 * against a constant.
 */
export function orgIncludedBands(
  org: Partial<AglynOrgBilling> | null | undefined,
): Record<UtilizationBand, number> {
  const entitlements = resolveOrgEntitlements(org)
  const hostLimit = Math.max(1, entitlements.hostLimit)
  return {
    hosts: entitlements.hostLimit,
    // Per host, expanded by the host limit — `meteredIncludedAllowance`
    // expands these two and nothing else.
    storageGb: (hostLimit * entitlements.storagePerHostMb) / 1024,
    formSubmissions: hostLimit * entitlements.formSubmissionsPerMonth,
    // Bandwidth IS the page-view band, expressed in the unit customers buy.
    pageViews: pageViewsFromBandwidthGb(entitlements.bandwidthGb),
    // Org-wide, in the unit the rollup stores. `dataStorageMbPerOrg` is
    // megabytes and so is `dataStorageMb`; the GB conversion happens inside
    // `orgMonthlyCogsUsd` and must not happen twice.
    dataStorageMb: entitlements.dataStorageMbPerOrg,
    apiRequests: entitlements.apiRequestsPerMonth,
    // Org-wide despite the name — see the module note.
    contactsCount: entitlements.contactsPerHost,
    emailSends: entitlements.emailSendsPerMonth,
    // Never `UNLIMITED` on any plan, deliberately — Enterprise carries a
    // finite default. The band is a third-party liability rather than capacity
    // the platform already owns, so an uncapped one would be an uncapped bill.
    assistCredits: entitlements.assistCreditsPerMonth,
    // Measured, banded, and unpriced — see `BANDS_WITHOUT_A_UNIT_COST`.
    workflowRuns: entitlements.workflowRunsPerMonth,
    actionRuns: entitlements.actionRunsPerMonth,
  }
}

/** One band's reading. The whole of the `UNLIMITED` and zero-band rule. */
export function bandUtilization(
  band: UtilizationBand,
  used: number,
  included: number,
): BandUtilization {
  const usedSafe = Number.isFinite(used) && used > 0 ? used : 0
  if (!Number.isFinite(included)) {
    return { band, included: Number.POSITIVE_INFINITY, used: usedSafe, state: 'uncapped', fraction: null }
  }
  if (!(included > 0)) {
    return { band, included: 0, used: usedSafe, state: 'noAllowance', fraction: null }
  }
  return { band, included, used: usedSafe, state: 'measured', fraction: usedSafe / included }
}

/**
 * What the rollup recorded, per band.
 *
 * `hosts` comes from the ORG rather than the rollup: `orgSiteCount` is what
 * the cost floor is charged on and what `checkDiscountMargin` counts, and a
 * site added since the cron last ran is a site the org has. The rollup's own
 * `hostCount` is a snapshot of the same thing at cron time.
 */
function bandUsage(
  org: Partial<AglynOrgBilling> | null | undefined,
  rollup: UtilizationRollup | null | undefined,
): Record<UtilizationBand, number> {
  return {
    hosts: orgSiteCount(org),
    storageGb: finite(rollup?.storageGb),
    pageViews: finite(rollup?.pageViews),
    formSubmissions: finite(rollup?.formSubmissions),
    dataStorageMb: finite(rollup?.dataStorageMb),
    apiRequests: finite(rollup?.apiRequests),
    contactsCount: finite(rollup?.contactsCount),
    emailSends: finite(rollup?.emailSends),
    // Dollars on the rollup, credits on the band. `assistCreditsFromUsd` is
    // the ONE conversion between them, so this figure and the one the customer
    // sees on their own billing page cannot disagree about the same month.
    assistCredits: assistCreditsFromUsd(finite(rollup?.assistCostUsd)),
    workflowRuns: finite(rollup?.workflowRuns),
    actionRuns: finite(rollup?.actionRuns),
  }
}

export interface OrgMarginInput {
  orgId: string
  name?: string | null
  /** The merged `{...orgDoc, ...billingDoc}` every revenue helper reads. */
  org: Partial<AglynOrgBilling> | null | undefined
  rollup: UtilizationRollup | null | undefined
  month?: string | null
}

/**
 * One org's realised utilization, cost and margin.
 *
 * The cost is `orgMonthlyCogsUsd`'s, unmodified, floor included — the same
 * `max(measured, $2 × sites)` the guardrail applies. On production today that
 * floor is what every org's figure is, which is worth reading off the `basis`
 * field rather than assuming the meters are driving anything yet.
 */
export function orgMarginRow(input: OrgMarginInput): OrgMarginRow {
  const { org, rollup } = input
  const included = orgIncludedBands(org)
  const used = bandUsage(org, rollup)
  const bands = Object.fromEntries(
    UTILIZATION_BANDS.map((band) => [band, bandUtilization(band, used[band], included[band])]),
  ) as Record<UtilizationBand, BandUtilization>

  const cogs = orgMonthlyCogsUsd(rollup, orgSiteCount(org))
  const listPriceUsd = orgListPriceMonthlyUsd(org)
  const mrrUsd = orgMonthlyRevenueUsd(org)
  const netRevenueUsd = orgNetMonthlyRevenueUsd(org)
  // A margin needs revenue to be a fraction OF. Free and comped orgs have
  // none, and inventing one for them fills the top of a worst-first list with
  // customers who were never billed.
  const marginPct =
    netRevenueUsd > 0
      ? Math.round(((netRevenueUsd - cogs.cogsUsd) / netRevenueUsd) * 10000) / 10000
      : null

  return {
    orgId: input.orgId,
    name: input.name ?? null,
    plan: resolveEffectivePlan(org),
    month: input.month ?? null,
    bands,
    cogs,
    listPriceUsd,
    mrrUsd,
    netRevenueUsd,
    marginPct,
    rating: marginPct === null ? null : netMarginRating(marginPct),
  }
}

/**
 * Nearest-rank percentile over a sample sorted ascending.
 *
 * `null` for an empty sample. A median of nothing is not zero, and the fleet
 * view exists to answer a question that has no answer yet for most bands.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null
  const rank = Math.ceil(p * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

export interface BandDistribution {
  band: UtilizationBand
  /**
   * Orgs a percentage EXISTS for — a finite, positive band. Every percentile
   * below is over this sample and no other.
   */
  counted: number
  /** Excluded because the band is `UNLIMITED`. Not 0%, not 100%: no answer. */
  excludedUncapped: number
  /** Excluded because the plan includes none of this meter. */
  excludedNoAllowance: number
  /**
   * Orgs with no included allowance that spent the meter anyway — cost with no
   * band behind it. Excluded from the percentiles, reported on its own.
   */
  usageWithNoAllowance: number
  p50: number | null
  p25: number | null
  p75: number | null
  p90: number | null
  max: number | null
  /** Orgs at or past 100% of the band, out of `counted`. */
  overBand: number
}

export interface FleetUtilization {
  /** Orgs folded in — every row handed to it, whatever its plan. */
  orgs: number
  /** Of those, how many had a usage rollup at all. */
  withRollup: number
  distributions: BandDistribution[]
  /** Median contribution margin across orgs that bill something. */
  medianMarginPct: number | null
  /** Orgs billing something whose margin sits under `NET_MARGIN_FLOOR_PCT`. */
  orgsUnderFloor: number
  /** Orgs billing something whose COGS exceeds their net revenue. */
  orgsUnderwater: number
  /** Total measured COGS and net revenue across the fold, in USD. */
  totalCogsUsd: number
  totalNetRevenueUsd: number
}

/**
 * The fleet answer: the median and spread of utilization per band.
 *
 * This is the figure every margin projection has been assuming. It is folded
 * over whatever rows the caller read — see the route's truncation disclosure,
 * because a distribution over a partial fleet is a distribution over a partial
 * fleet and must say so.
 *
 * An org WITHOUT a rollup still contributes its `hosts` band (the org doc
 * knows its own sites) and is excluded from the other seven by having no
 * measurement, not by being scored at zero. `withRollup` is what says how much
 * of the fold is real.
 */
export function fleetUtilization(rows: readonly OrgMarginRow[]): FleetUtilization {
  const distributions = UTILIZATION_BANDS.map<BandDistribution>((band) => {
    const sample: number[] = []
    let excludedUncapped = 0
    let excludedNoAllowance = 0
    let usageWithNoAllowance = 0
    for (const row of rows) {
      const reading = row.bands[band]
      if (!reading) continue
      // A band the cron has never measured contributes nothing rather than a
      // zero: `hosts` is known without a rollup, the seven meters are not.
      if (band !== 'hosts' && row.month === null) continue
      if (reading.state === 'uncapped') {
        excludedUncapped += 1
        continue
      }
      if (reading.state === 'noAllowance') {
        excludedNoAllowance += 1
        if (reading.used > 0) usageWithNoAllowance += 1
        continue
      }
      sample.push(reading.fraction as number)
    }
    sample.sort((a, b) => a - b)
    return {
      band,
      counted: sample.length,
      excludedUncapped,
      excludedNoAllowance,
      usageWithNoAllowance,
      p50: percentile(sample, 0.5),
      p25: percentile(sample, 0.25),
      p75: percentile(sample, 0.75),
      p90: percentile(sample, 0.9),
      max: sample.length ? sample[sample.length - 1] : null,
      overBand: sample.filter((fraction) => fraction >= 1).length,
    }
  })

  const margins = rows
    .map((row) => row.marginPct)
    .filter((margin): margin is number => margin !== null)
    .sort((a, b) => a - b)

  return {
    orgs: rows.length,
    withRollup: rows.filter((row) => row.month !== null).length,
    distributions,
    medianMarginPct: percentile(margins, 0.5),
    orgsUnderFloor: margins.filter((margin) => netMarginRating(margin) !== 'ok').length,
    orgsUnderwater: margins.filter((margin) => margin < 0).length,
    totalCogsUsd: Math.round(rows.reduce((sum, row) => sum + row.cogs.cogsUsd, 0) * 100) / 100,
    totalNetRevenueUsd:
      Math.round(rows.reduce((sum, row) => sum + row.netRevenueUsd, 0) * 100) / 100,
  }
}

/**
 * Worst margin first — the ordering the surface exists for.
 *
 * An org with no revenue has no margin and sorts to the END regardless. It
 * cannot be the unprofitable customer this list is looking for, and putting
 * the free tier at the top would bury the one org that is.
 */
export function byWorstMargin(a: OrgMarginRow, b: OrgMarginRow): number {
  if (a.marginPct === null && b.marginPct === null) return b.cogs.cogsUsd - a.cogs.cogsUsd
  if (a.marginPct === null) return 1
  if (b.marginPct === null) return -1
  return a.marginPct - b.marginPct || b.cogs.cogsUsd - a.cogs.cogsUsd
}

/** Re-exported so the page states the floor it is colouring against. */
export { INFRA_COGS_PER_SITE_USD }
