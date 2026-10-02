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
 * ## An unbounded band costs Infinity, never 0
 *
 * A band that is `UNLIMITED` cannot be costed, and every cost model in this
 * repo that scored one as zero reported the largest line item on a plan as
 * contributing nothing. So a non-finite term — or one that is `NaN` because a
 * zero met an infinity — is `Infinity`, the total is `Infinity`, and no price
 * clears it. The term is named in `unbounded` so a refusal can say which band
 * to bound.
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
 * How many times its full-use cost a discounted price must still cover, net
 * of Stripe: 1×. A discount may spend the 30% the price carries above cost,
 * never the cost itself.
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
 * cost — the per-org check behind applying a coupon, the winback offer and
 * an enterprise quote (whose negotiated `customMonthlyUsd` is the list
 * price). `org` must carry its subscription: a list price of 0 rates against
 * nothing and fails, so a caller holding a stale mirror is refused rather
 * than waved through.
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

/** One plan and interval a coupon could be redeemed on, rated. */
export interface CouponFullUseCase extends FullUseFloorResult {
  plan: OrgPlan
  interval: 'month' | 'year'
}

export interface CouponFullUseVerdict {
  ok: boolean
  /** Every paid self-serve plan, monthly and annual, rated. */
  cases: CouponFullUseCase[]
  /** The case with the least cover — the one that decides `ok`. */
  worst: CouponFullUseCase
}

/**
 * Rate a coupon or promotion code before it exists (AGL-3473).
 *
 * A coupon minted here carries no plan restriction, so it can be redeemed on
 * any paid self-serve plan, on either interval, and its worst case is the
 * case it has to clear. Each is priced at that plan's list price for the
 * interval, against the plan's own bands at 100% — at
 * `FULL_USE_DISCOUNT_MULTIPLE`, so the discount may spend the margin above
 * cost and never the cost. Enterprise is quoted per deal and never takes a
 * code at checkout; a coupon applied to one is rated on that org.
 */
export function rateCouponAgainstFullUse(
  discount: Pick<OrgDiscount, 'percentOff' | 'amountOffUsd'>,
): CouponFullUseVerdict {
  const cases: CouponFullUseCase[] = []
  for (const plan of SELF_SERVE_PLANS) {
    if (!(PLAN_PRICING[plan]?.basePriceMonthlyUsd > 0)) continue
    for (const interval of ['month', 'year'] as const) {
      const org = { plan, subscription: { status: 'active', interval } } as never
      cases.push({
        plan,
        interval,
        ...orgFullUseFloor(org, { multiple: FULL_USE_DISCOUNT_MULTIPLE, discount }),
      })
    }
  }
  const worst = cases.reduce((least, one) => (one.coverage < least.coverage ? one : least))
  return { ok: cases.every((one) => one.ok), cases, worst }
}

/**
 * The deepest whole percent off a coupon can take and still clear the
 * full-use floor on every paid self-serve plan, or `null` when a plan is
 * under it at list price and no discount clears.
 */
export function deepestCouponPercentWithinFullUse(): number | null {
  if (!rateCouponAgainstFullUse({}).ok) return null
  let deepest = 0
  while (deepest < 100 && rateCouponAgainstFullUse({ percentOff: deepest + 1 }).ok) {
    deepest += 1
  }
  return deepest
}

/** Two decimals, or "unbounded". */
function usd(value: number): string {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : 'unbounded'
}

/**
 * The sentence a refusal or a staff verdict states: the floor, and the
 * figures that missed it. Staff-facing only — it names Aglyn's cost.
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
