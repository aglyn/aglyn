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

// Imported from BOTH graphs — the staff pages (client) and the App Routes
// that refuse a quote or a discount — so it may import neither entry barrel,
// for the reason `margin-utilization.ts` states at its own head.
import type { AglynOrgBilling, OrgDiscount, OrgPlan } from '../foundation'
import {
  ESTIMATED_PAGE_TRANSFER_BYTES,
  INFRA_COGS_PER_SITE_USD,
  METERED_MARKUP,
  ORG_COGS_UNIT_RATES_USD,
  PAGE_VIEW_CDN_REQUEST_COST_USD,
  PLAN_LABELS,
  PLAN_PRICING,
  SELF_SERVE_PLANS,
  applyDiscountUsd,
  checkSeatQuota,
  netOfProcessorFee,
  orgListPriceMonthlyUsd,
  resolveCollaboratorSeatPool,
  resolveOrgEntitlements,
  type ResolvedOrgEntitlements,
} from './plan-entitlements'
import { planQuotaOf } from '../plugin-manager/plugin-plan-entitlements'
import {
  pluginCostAxes,
  pluginUsageBands,
  type ResolvedPluginUsageBand,
} from '../plugin-manager/plugin-usage-axes'

/**
 * WHAT A WORKSPACE COSTS IF IT SPENDS EXACTLY WHAT IT BOUGHT (AGL-3473).
 *
 * `orgMonthlyCogsUsd` prices what an org DID use, from its rollup. Every
 * guard that rated a price against it — the discount guardrail, the
 * enterprise quote card — therefore approved deals on the strength of how
 * little the customer had used so far, and a deal is a promise about the
 * whole allowance. Agency at 20% off read "ok, 75.5%" against its measured
 * month while sitting under what its bands cost at 100%.
 *
 * This is the same multiplication `tier-margin-floor.spec.ts` does for the
 * price list — every band at 100%, at the rates the platform's own model
 * uses — over RESOLVED entitlements, so a staff override, a comp's plan and
 * a purchased add-on all cost what they deliver. That spec holds its own
 * independent model and asserts this function agrees with it on every plan.
 *
 * Two readers, held to it differently. An enterprise quote must clear
 * `FULL_USE_QUOTE_MULTIPLE` × the cost and is refused below it. A coupon or
 * discount is judged on the charges it reaches and WARNED about below 1× —
 * never refused, because a first-month or first-year discount that spends
 * cost to close a deal is a decision staff are allowed to make.
 *
 * ## An unbounded band costs Infinity, never 0
 *
 * A band that is `UNLIMITED` cannot be costed, and every cost model in this
 * repo that scored one as zero reported the largest line item on a plan as
 * contributing nothing. So a non-finite term — or one that is `NaN` because a
 * zero met an infinity — is `Infinity`, the total is `Infinity`, and no price
 * clears it. The term is named in `unbounded` so a refusal or a warning can
 * say which band to bound.
 */

/**
 * What one console seat costs to serve for a month — about 60,000 reads and
 * 10,000 writes at `nam5` list prices, ≈$0.054, carried as $0.06 (the Drive
 * pricing decision of 2026-09-05).
 *
 * NOT in `ORG_COGS_UNIT_RATES_USD`: no rollup meter counts seat-months, so a
 * rate there would be one no axis of `orgMonthlyCogsUsd` reads.
 */
export const SEAT_COGS_USD_PER_MONTH = 0.06

/**
 * Days a daily band is spent at 100% in a month: the one-to-one email cap is
 * a pace per UTC day, and the whole month at that pace is thirty of them.
 */
const DAYS_PER_FULL_MONTH = 30

/** Page views one GB of included bandwidth buys — `pageViewsFromBandwidthGb`'s constant. */
const VIEWS_PER_GB = (1024 * 1024 * 1024) / ESTIMATED_PAGE_TRANSFER_BYTES

/**
 * How many times its full-use cost an enterprise quote must cover, net of
 * Stripe: cost + 30%, the markup every metered overage already carries, so a
 * negotiated deal earns what the price list does.
 */
export const FULL_USE_QUOTE_MULTIPLE = METERED_MARKUP

/**
 * The full-use cost a discounted charge is judged against, net of Stripe: 1×.
 * A discount that spends only the 30% a price carries above cost clears it;
 * one that reaches into the cost is WARNED about, never refused — a coupon is
 * a tool for closing a deal, and staff choose to spend cost on one knowingly.
 */
export const FULL_USE_DISCOUNT_MULTIPLE = 1

export interface FullUseCogsResult {
  /** `measuredUsd` or the per-site floor, whichever is larger; `Infinity` when any band is unbounded. */
  cogsUsd: number
  /** The sum of every term at 100% of its band. */
  measuredUsd: number
  /** `INFRA_COGS_PER_SITE_USD × hostLimit` — the sites sold, not the sites built. */
  floorUsd: number
  /** Every term, in USD a month, for showing the working. */
  breakdown: Record<string, number>
  /** The terms whose band is unbounded, sorted. Empty when the plan can be costed. */
  unbounded: string[]
}

export interface FullUseCogsOptions {
  /**
   * Seats bought on top of the plan's — the org-wide manager add-on and the
   * collaborator pool, neither of which `resolveOrgEntitlements` folds into
   * a band.
   */
  extraSeats?: number
}

/** A term that cannot be costed is unbounded, never free. */
function termUsd(value: number): number {
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

/**
 * The USD one unit of a plugin's declared band costs.
 *
 * A band sold in a unit OF cost declares that unit's price (`unitCostUsd`).
 * Every other band is priced by the cost axis that records the same rollup
 * field the band is measured by — the meter `orgMonthlyCogsUsd` already
 * prices its usage on — at that axis's `ORG_COGS_UNIT_RATES_USD` rate, or at
 * ×1 where the axis records dollars.
 *
 * ⚑ A band no axis records, or an axis naming a rate core does not carry,
 * THROWS. Pricing it at zero would make a plan cost less than it does, which
 * is the direction that approves a quote.
 */
function declaredBandUnitCostUsd(band: ResolvedPluginUsageBand): number {
  if (typeof band.unitCostUsd === 'number') return band.unitCostUsd
  const measuredBy = [...band.fields, ...(band.fallbackFields ?? [])]
  const axis = pluginCostAxes().find((candidate) =>
    measuredBy.some(
      (field) =>
        candidate.fields.includes(field) ||
        (candidate.fallbackFields ?? []).includes(field),
    ),
  )
  if (!axis) {
    throw new Error(
      `usage band "${band.id}" is measured by no declared cost axis, so its full-use cost has no rate`,
    )
  }
  if (axis.rate === undefined) return 1
  const rate = (ORG_COGS_UNIT_RATES_USD as Record<string, number>)[axis.rate]
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error(
      `cost axis "${axis.id}" names the rate "${axis.rate}", which ORG_COGS_UNIT_RATES_USD does not carry`,
    )
  }
  return rate
}

/**
 * Every cost a workspace's RESOLVED bands imply at 100%, per month.
 *
 * The platform's own bands, each at the rate `orgMonthlyCogsUsd` prices its
 * meter on: media storage per site (× `hostLimit`), bandwidth at its weight
 * (`perPageView`) and at its CDN requests (`PAGE_VIEW_CDN_REQUEST_COST_USD`),
 * stored data (`dataStorageMbPerOrg`), API requests and every email the
 * campaign band sends. Then every band a plugin declares
 * (`plugin-usage-axes.ts`), a per-site one expanded by `hostLimit`. Then the
 * two costs no meter records:
 *
 *  - SEATS — every collaborator each site admits on every site
 *    (`membersPerHost × hostLimit`), the org's managers (`managersPerOrg`)
 *    and any bought on top, at `SEAT_COGS_USD_PER_MONTH`;
 *  - ONE-TO-ONE EMAIL — the CRM's daily cap spent every day of the month, at
 *    the rate every other send costs.
 *
 * `INFRA_COGS_PER_SITE_USD × hostLimit` is a FLOOR rather than an added
 * term, exactly as in `orgMonthlyCogsUsd`.
 */
export function fullUseCogs(
  entitlements: ResolvedOrgEntitlements,
  options: FullUseCogsOptions = {},
): FullUseCogsResult {
  const rates = ORG_COGS_UNIT_RATES_USD
  const hosts = entitlements.hostLimit
  const quota = (key: string) => planQuotaOf(entitlements, key)
  const extraSeats = Math.max(0, Number(options.extraSeats ?? 0) || 0)
  const breakdown: Record<string, number> = {
    mediaStorage: termUsd(
      ((hosts * entitlements.storagePerHostMb) / 1024) * rates.storagePerGbMonth,
    ),
    bandwidth: termUsd(entitlements.bandwidthGb * VIEWS_PER_GB * rates.perPageView),
    cdnRequests: termUsd(
      entitlements.bandwidthGb * VIEWS_PER_GB * PAGE_VIEW_CDN_REQUEST_COST_USD,
    ),
    dataStorage: termUsd(
      (entitlements.dataStorageMbPerOrg / 1024) * rates.dataStoragePerGbMonth,
    ),
    apiRequests: termUsd(entitlements.apiRequestsPerMonth * rates.perApiRequest),
    emailSends: termUsd(entitlements.emailSendsPerMonth * rates.perEmailSend),
  }
  for (const band of pluginUsageBands()) {
    const units = quota(band.entitlement) * (band.perHost ? hosts : 1)
    breakdown[band.id] = termUsd(units * declaredBandUnitCostUsd(band))
  }
  breakdown['seats'] = termUsd(
    (entitlements.membersPerHost * hosts + entitlements.managersPerOrg + extraSeats) *
      SEAT_COGS_USD_PER_MONTH,
  )
  // Read by key, as `checkCrmEmailQuota` reads it: a daily pace is not a
  // monthly band, so no usage-band declaration carries it.
  breakdown['crmEmail'] = termUsd(
    quota('crmEmailsPerDay') * DAYS_PER_FULL_MONTH * rates.perEmailSend,
  )
  const unbounded = Object.entries(breakdown)
    .filter(([, usd]) => !Number.isFinite(usd))
    .map(([term]) => term)
    .sort()
  const measuredUsd = Object.values(breakdown).reduce((sum, usd) => sum + usd, 0)
  const floorUsd = termUsd(Math.max(0, hosts) * INFRA_COGS_PER_SITE_USD)
  return {
    cogsUsd: Math.max(measuredUsd, floorUsd),
    measuredUsd,
    floorUsd,
    breakdown,
    unbounded,
  }
}

/** `fullUseCogs(entitlements).cogsUsd` — the figure every guard compares against. */
export function fullUseMonthlyCogsUsd(
  entitlements: ResolvedOrgEntitlements,
  options: FullUseCogsOptions = {},
): number {
  return fullUseCogs(entitlements, options).cogsUsd
}

/**
 * The full-use cost of an org as it stands: its resolved entitlements, plus
 * the manager and collaborator seats it bought, which no band carries.
 */
export function orgFullUseCogs(
  org: Partial<AglynOrgBilling> | null | undefined,
): FullUseCogsResult {
  return fullUseCogs(resolveOrgEntitlements(org), {
    extraSeats:
      checkSeatQuota(org, 'managers', 0).purchased +
      resolveCollaboratorSeatPool(org).purchased,
  })
}

/** A price rated against what the bands it buys cost at 100%. */
export interface FullUseFloorResult {
  /** The monthly list price before the discount (annual billing as its monthly equivalent). */
  listUsd: number
  /** The same after the discount. */
  discountedUsd: number
  /** The discounted price net of Stripe's fee — what is kept before any cost. */
  netUsd: number
  annual: boolean
  /** `fullUseCogs(…).cogsUsd`; `Infinity` when a band is unbounded. */
  fullUseCogsUsd: number
  /** The multiple of full-use cost the net price must reach. */
  multiple: number
  /** `multiple × fullUseCogsUsd` — the net price the floor asks for. */
  requiredNetUsd: number
  /** `netUsd / fullUseCogsUsd`: 1.30 is cost + 30%. 0 when the cost is unbounded. */
  coverage: number
  ok: boolean
  /** The unbounded terms, when that is why it fails. */
  unbounded: string[]
}

/**
 * A discount as it reaches a MONTH of the price. A percentage scales every
 * charge alike. An amount comes off each CHARGE, and an annual subscription
 * is charged once for twelve months, so it is a twelfth of that a month.
 */
function monthlyDiscount(
  discount: Pick<OrgDiscount, 'percentOff' | 'amountOffUsd'> | null | undefined,
  annual: boolean,
): Pick<OrgDiscount, 'percentOff' | 'amountOffUsd'> | null {
  if (!discount) return null
  if (typeof discount.percentOff === 'number') return { percentOff: discount.percentOff }
  if (typeof discount.amountOffUsd === 'number') {
    return { amountOffUsd: annual ? discount.amountOffUsd / 12 : discount.amountOffUsd }
  }
  return null
}

/**
 * Rate a monthly price — after `discount`, net of Stripe — against `multiple`
 * times a full-use cost. Pure: the callers below bring the price and the cost.
 */
export function rateAgainstFullUse(input: {
  listMonthlyUsd: number
  annual: boolean
  cogs: FullUseCogsResult
  multiple: number
  discount?: Pick<OrgDiscount, 'percentOff' | 'amountOffUsd'> | null
}): FullUseFloorResult {
  const listUsd = Math.max(0, Number(input.listMonthlyUsd) || 0)
  const discountedUsd = applyDiscountUsd(listUsd, monthlyDiscount(input.discount, input.annual))
  const netUsd = netOfProcessorFee(discountedUsd, input.annual)
  const fullUseCogsUsd = input.cogs.cogsUsd
  const requiredNetUsd = input.multiple * fullUseCogsUsd
  const coverage =
    Number.isFinite(fullUseCogsUsd) && fullUseCogsUsd > 0 ? netUsd / fullUseCogsUsd : 0
  return {
    listUsd,
    discountedUsd,
    netUsd,
    annual: input.annual,
    fullUseCogsUsd,
    multiple: input.multiple,
    requiredNetUsd,
    coverage,
    ok: netUsd >= requiredNetUsd,
    unbounded: input.cogs.unbounded,
  }
}

/**
 * An org's subscription after `discount`, against `multiple` × its full-use
 * cost — the enterprise quote floor, where the negotiated `customMonthlyUsd`
 * is the list price. `org` must carry its subscription: a list price of 0
 * rates against nothing and fails, so a caller holding a stale mirror is
 * refused rather than waved through.
 */
export function orgFullUseFloor(
  org: Partial<AglynOrgBilling> | null | undefined,
  options: {
    multiple: number
    discount?: Pick<OrgDiscount, 'percentOff' | 'amountOffUsd'> | null
  },
): FullUseFloorResult {
  return rateAgainstFullUse({
    listMonthlyUsd: orgListPriceMonthlyUsd(org),
    annual: org?.subscription?.interval === 'year',
    cogs: orgFullUseCogs(org),
    multiple: options.multiple,
    discount: options.discount,
  })
}

/** How long a coupon takes its discount off — Stripe's `duration` and `duration_in_months`. */
export interface CouponDuration {
  duration?: string | null
  durationInMonths?: number | null
}

/** Which charges a discount reaches on one billing interval. */
export interface DiscountReach {
  /** Stripe's duration, or `unknown` when none is on record — judged as `forever`. */
  duration: 'once' | 'repeating' | 'forever' | 'unknown'
  /** How many charges it comes off; `Infinity` for every one. */
  charges: number
  /** The months one charge pays for: 1 billed monthly, 12 billed annually. */
  monthsPerCharge: 1 | 12
  /** How many of the first twelve months the discounted charges pay for. */
  monthsOfFirstYear: number
}

/**
 * Which charges a coupon of `duration` comes off (AGL-3473).
 *
 * `once` is the first charge: the first month billed monthly, the whole first
 * year billed annually. `repeating` covers the invoices dated within its
 * months of redemption: N monthly charges, or — billed annually — the annual
 * charges that fall inside them, which is the first one for any N up to 12.
 * `forever` is every charge. A duration not on record is judged as
 * `forever`, the reading that cannot understate what a discount gives away.
 */
export function discountReach(
  coupon: CouponDuration | null | undefined,
  annual: boolean,
): DiscountReach {
  const monthsPerCharge = annual ? 12 : 1
  const months = Math.floor(Number(coupon?.durationInMonths))
  if (coupon?.duration === 'once') {
    return { duration: 'once', charges: 1, monthsPerCharge, monthsOfFirstYear: monthsPerCharge }
  }
  if (coupon?.duration === 'repeating' && months >= 1) {
    return annual
      ? { duration: 'repeating', charges: Math.ceil(months / 12), monthsPerCharge, monthsOfFirstYear: 12 }
      : { duration: 'repeating', charges: months, monthsPerCharge, monthsOfFirstYear: Math.min(months, 12) }
  }
  return {
    duration: coupon?.duration === 'forever' ? 'forever' : 'unknown',
    charges: Number.POSITIVE_INFINITY,
    monthsPerCharge,
    monthsOfFirstYear: 12,
  }
}

/**
 * A discount against full-use cost on the charges it actually reaches, and on
 * the first year as a whole. `ok` and `coverage` are one DISCOUNTED charge's:
 * the warning is about the charges a coupon touches, never about the ones it
 * does not.
 */
export interface DiscountFullUseAssessment extends FullUseFloorResult {
  reach: DiscountReach
  /** What one discounted charge keeps, net of Stripe. */
  chargeNetUsd: number
  /** What the months one charge pays for cost at full use. */
  chargeCogsUsd: number
  /** How far under its full-use cost each discounted charge falls; 0 when it clears. */
  chargeUnderCostUsd: number
  /** The first twelve months together: the discounted charges, the rest at list. */
  firstYearNetUsd: number
  firstYearCogsUsd: number
  /** `firstYearNetUsd / firstYearCogsUsd`; 0 when the cost is unbounded. */
  firstYearCoverage: number
  /** How far under twelve months of full-use cost the first year falls; 0 when covered. */
  firstYearUnderCostUsd: number
}

/** `cost − net`, never negative; an unbounded cost is an unbounded shortfall. */
function shortfall(cogsUsd: number, netUsd: number): number {
  if (!Number.isFinite(cogsUsd)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.round((cogsUsd - netUsd) * 100) / 100)
}

/**
 * Judge a discount on one price against full-use cost — pure: the callers
 * below bring the price, the cost and the coupon.
 */
export function assessDiscountAgainstFullUse(input: {
  listMonthlyUsd: number
  annual: boolean
  cogs: FullUseCogsResult
  discount: Pick<OrgDiscount, 'percentOff' | 'amountOffUsd'> | null | undefined
  duration: CouponDuration | null | undefined
}): DiscountFullUseAssessment {
  const charge = rateAgainstFullUse({ ...input, multiple: FULL_USE_DISCOUNT_MULTIPLE })
  const undiscounted = rateAgainstFullUse({
    ...input,
    discount: null,
    multiple: FULL_USE_DISCOUNT_MULTIPLE,
  })
  const reach = discountReach(input.duration, input.annual)
  const chargeNetUsd = Math.round(charge.netUsd * reach.monthsPerCharge * 100) / 100
  const chargeCogsUsd = charge.fullUseCogsUsd * reach.monthsPerCharge
  const firstYearNetUsd =
    Math.round(
      (charge.netUsd * reach.monthsOfFirstYear +
        undiscounted.netUsd * (12 - reach.monthsOfFirstYear)) *
        100,
    ) / 100
  const firstYearCogsUsd = charge.fullUseCogsUsd * 12
  return {
    ...charge,
    reach,
    chargeNetUsd,
    chargeCogsUsd,
    chargeUnderCostUsd: shortfall(chargeCogsUsd, chargeNetUsd),
    firstYearNetUsd,
    firstYearCogsUsd,
    firstYearCoverage:
      Number.isFinite(firstYearCogsUsd) && firstYearCogsUsd > 0
        ? firstYearNetUsd / firstYearCogsUsd
        : 0,
    firstYearUnderCostUsd: shortfall(firstYearCogsUsd, firstYearNetUsd),
  }
}

/**
 * A discount on an org as it bills — its plan, overrides, add-ons, interval
 * and the price it pays — against its full-use cost: the warning behind
 * applying a coupon to an org and behind the winback. A list price of 0 (no
 * subscription on record) is reported as such, never as covered.
 */
export function orgDiscountFullUse(
  org: Partial<AglynOrgBilling> | null | undefined,
  discount: Pick<OrgDiscount, 'percentOff' | 'amountOffUsd'> | null | undefined,
  duration: CouponDuration | null | undefined,
): DiscountFullUseAssessment {
  return assessDiscountAgainstFullUse({
    listMonthlyUsd: orgListPriceMonthlyUsd(org),
    annual: org?.subscription?.interval === 'year',
    cogs: orgFullUseCogs(org),
    discount,
    duration,
  })
}

/** One plan and interval a coupon could be redeemed on, judged. */
export interface CouponFullUseCase extends DiscountFullUseAssessment {
  plan: OrgPlan
  interval: 'month' | 'year'
}

export interface CouponFullUseVerdict {
  /** Every case clears: no discounted charge, on any plan, falls under its full-use cost. */
  ok: boolean
  /** Every paid self-serve plan, monthly and annual, judged. */
  cases: CouponFullUseCase[]
  /** The case with the least cover — the one the warning leads with. */
  worst: CouponFullUseCase
  /** The cases under full-use cost, as "Agency, annual". */
  under: string[]
  /** The staff warning, with the figures; `null` when every case clears. */
  warning: string | null
}

/**
 * Judge a coupon or promotion code against full-use cost before it is minted
 * (AGL-3473) — a WARNING for staff, never a refusal.
 *
 * A coupon here carries no plan restriction, so its code can be redeemed on
 * any paid self-serve plan, on either interval, by a customer using
 * everything the plan includes; each case is that plan's list price against
 * its own bands at 100%, on the charges `duration` reaches. Enterprise is
 * quoted per deal and never takes a code at checkout; a coupon applied to one
 * is judged on that org.
 */
export function rateCouponAgainstFullUse(
  discount: Pick<OrgDiscount, 'percentOff' | 'amountOffUsd'>,
  duration?: CouponDuration | null,
): CouponFullUseVerdict {
  const cases: CouponFullUseCase[] = []
  for (const plan of SELF_SERVE_PLANS) {
    if (!(PLAN_PRICING[plan]?.basePriceMonthlyUsd > 0)) continue
    for (const interval of ['month', 'year'] as const) {
      const org = { plan, subscription: { status: 'active', interval } } as never
      cases.push({ plan, interval, ...orgDiscountFullUse(org, discount, duration) })
    }
  }
  const worst = cases.reduce((least, one) => (one.coverage < least.coverage ? one : least))
  const under = cases.filter((one) => !one.ok).map(couponCaseLabel)
  const ok = under.length === 0
  return {
    ok,
    cases,
    worst,
    under,
    warning: ok
      ? null
      : `Under full-use cost on ${under.length} of ${cases.length} plan and billing ` +
        `combinations (${under.join('; ')}). Worst case ` +
        describeDiscountFullUse(worst, couponCaseLabel(worst)),
  }
}

/**
 * The deepest whole percent off a coupon can take with every discounted
 * charge, on every paid self-serve plan, still covering its full-use cost —
 * or `null` when a plan is under it at list price.
 */
export function deepestCouponPercentWithinFullUse(): number | null {
  if (!rateCouponAgainstFullUse({}).ok) return null
  let deepest = 0
  while (deepest < 100 && rateCouponAgainstFullUse({ percentOff: deepest + 1 }).ok) {
    deepest += 1
  }
  return deepest
}

/** Which charges a reach names, in words. */
function chargesReached(reach: DiscountReach): string {
  const annual = reach.monthsPerCharge === 12
  if (reach.duration === 'unknown') return 'every charge (no duration on record)'
  if (!Number.isFinite(reach.charges)) {
    return annual ? 'every annual charge' : 'every monthly charge'
  }
  if (annual) {
    return reach.charges === 1
      ? 'the first annual charge (the whole first year)'
      : `the first ${reach.charges} annual charges`
  }
  return reach.charges === 1
    ? "the first month's charge"
    : `the first ${reach.charges} monthly charges`
}

/**
 * The staff sentence for a discount against full-use cost: which charges it
 * reaches, what each keeps against what its months cost, how far under, and
 * the first year as a whole. Staff-facing only — it names Aglyn's cost.
 */
export function describeDiscountFullUse(
  result: DiscountFullUseAssessment,
  subject?: string,
): string {
  const about = subject ? `${subject}: ` : ''
  if (result.unbounded.length) {
    return (
      `${about}cannot be costed — ${result.unbounded.join(', ')} ` +
      `${result.unbounded.length === 1 ? 'is' : 'are'} unbounded, so the full-use cost is too.`
    )
  }
  if (!(result.listUsd > 0)) {
    return `${about}no subscription price is on record to judge the discount against.`
  }
  const each =
    `${chargesReached(result.reach)}: each keeps ${usd(result.chargeNetUsd)} net of ` +
    `Stripe against ${usd(result.chargeCogsUsd)} of full-use cost ` +
    `(${result.coverage.toFixed(2)}×`
  if (result.ok) return `${about}clears full-use cost on ${each}).`
  const year =
    `It touches ${result.reach.monthsOfFirstYear} of the first 12 months; the first ` +
    `year as a whole covers ${result.firstYearCoverage.toFixed(2)}×` +
    (result.firstYearUnderCostUsd > 0
      ? ` (${usd(result.firstYearUnderCostUsd)} under).`
      : '.')
  return (
    `${about}under full-use cost on ${each}, ${usd(result.chargeUnderCostUsd)} under ` +
    `each). ${year}`
  )
}

/** Two decimals, or "unbounded". */
function usd(value: number): string {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : 'unbounded'
}

/**
 * The sentence an enterprise quote refusal or verdict states: the floor, and
 * the figures that missed it. Staff-facing only — it names Aglyn's cost.
 */
export function describeFullUseFloor(
  result: FullUseFloorResult,
  subject?: string,
): string {
  const floor =
    result.multiple === 1
      ? 'its full-use cost'
      : `${result.multiple.toFixed(2)}× its full-use cost`
  const about = subject ? `${subject}: ` : ''
  if (result.unbounded.length) {
    return (
      `${about}cannot be rated — ${result.unbounded.join(', ')} ` +
      `${result.unbounded.length === 1 ? 'is' : 'are'} unbounded, so the full-use cost is too. ` +
      'Bound the band with an entitlement override first.'
    )
  }
  return (
    `${about}keeps ${usd(result.netUsd)}/mo net of Stripe ` +
    `against ${usd(result.requiredNetUsd)} (${floor}, ${usd(result.fullUseCogsUsd)}) — ` +
    `${result.coverage.toFixed(2)}× full-use cost.`
  )
}

/** "Agency, annual" — how a coupon case names itself. */
export function couponCaseLabel(one: Pick<CouponFullUseCase, 'plan' | 'interval'>): string {
  return `${PLAN_LABELS[one.plan] ?? one.plan}, ${one.interval === 'year' ? 'annual' : 'monthly'}`
}
