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
 * WHAT A TIER COSTS IF A CUSTOMER SPENDS EXACTLY WHAT THEY BOUGHT.
 *
 * Every tier is a bundle of bands and a price, and the two were set in
 * different places at different times against different evidence. Nothing
 * ever multiplied one by the other. So the platform shipped tiers that go
 * deeply negative at full utilization — not through abuse, not through an
 * overage, but by a customer spending precisely the allowance the price list
 * sold them. This file is the multiplication.
 *
 * ## THE INVARIANT, and the price it is held at
 *
 * A customer cannot cost more than they pay by using exactly what they were
 * sold. Held at the ANNUAL price — the yearly price ÷ 12, the price the page
 * leads with and the cheaper of the two a customer can choose — NET of
 * Stripe's processing fee, with every band at 100% and every cost the
 * platform can name counted: the metered axes `orgMonthlyCogsUsd` prices,
 * the assist band, the two CRM terms the 2026-09-05 decision introduced
 * (a seat a month for every collaborator the tier admits, and the whole day
 * spent at the one-to-one email cap thirty times over), and the CDN requests
 * every included page view makes once the platform is past its hosting
 * plan's request allowance, at the dearest region's price. The 2026-09-07
 * pricing decision fixed the first four of those choices and AGL-3444 the
 * fifth.
 *
 * ## What the guard that stood here could not see
 *
 * Until 2026-09-07 this file judged the MONTHLY price, gross of Stripe, and
 * summed the metered axes alone. It read +10.0 / +10.9 / +8.3 / +6.7 / +9.1%
 * on Pro through Agency, and every one of those figures was a true statement
 * about a question nobody was asking. At the annual price, net of the fee,
 * with the seat and one-to-one email terms added, the same bands read:
 *
 *     annual, 100%   pro -44.1%   business -36.5%   scale -37.5%
 *                    advanced -33.9%   agency -19.4%
 *     monthly, 100%  pro  -1.7%   business  +1.8%   scale  +0.2%
 *                    advanced  -1.2%   agency  +3.0%
 *
 * Bandwidth is the largest term on almost every paid tier — page views are
 * 55–70% of what the smaller ones cost — and the only lever that moves the
 * number. So the bands came down to what the annual price carries: Pro 225 →
 * 125 GB, Business 400 → 185, Scale 700 → 290, Advanced 1,000 → 345, Agency
 * 3,000 → 1,540. Starter, at 50 GB, was never under water and did not move.
 * The ladder sat between 0.25% and 1.5% at the annual price and between 19%
 * and 30% at the monthly one — the ninth metered axis, workflow and action
 * runs at `perRun`, took the last of the room the same day — and the
 * `MUTATION` cases below prove the shipped bands are what changed the
 * verdict.
 *
 * ## At Vercel's dearest region, and Firestore's own (AGL-3444)
 *
 * Vercel bills in the region that serves a visitor: transfer at $0.15 to
 * $0.35 a decimal GB, requests past the hosting plan's 10,000,000 a month at
 * $2.00 to $3.20 a million, and a function's CPU and memory by region. A band
 * cannot choose where its visitors are, and the rule here is stated at any
 * utilization, so every Vercel term is priced where Vercel is dearest, and
 * every Firestore operation at production's `nam5`. An included gigabyte is
 * then $0.41312 of weight (`perPageView`: transfer at $0.35 a decimal GB,
 * reads at nam5) and $0.22400 of requests (`PAGE_VIEW_CDN_REQUEST_COST_USD`:
 * 57 CDN requests at $3.20 and the analytics beacon's function and writes) —
 * $0.63712 all in, against the $0.16724 the bands were sized on until
 * 2026-10-01. Form submissions, runs and API requests carry their Vercel
 * compute at the dearest region too, and an API request its reads, CDN
 * request and response transfer. Every paid bandwidth band is cut to what the
 * annual price carries: Starter 50 → 20 GB, Pro 125 → 30, Business 185 → 45,
 * Scale 290 → 70, Advanced 345 → 80, Agency 1,540 → 395 — each the largest
 * multiple of 5 GB that holds — and every API band to the dollars it was
 * sized to cost, the largest multiple of 500 requests that stays inside it:
 * Business 100,000 → 1,500 requests, Scale 300,000 → 5,000, Advanced
 * 1,000,000 → 17,000, Agency 5,000,000 → 85,000. The ladder sits
 * between 0.1% and 7.3% at the annual price, and
 * `MUTATION: at the bands sold until 2026-10-01` holds what the old bands —
 * and the two re-sizes of the same day — read across the range.
 *
 * ## A floor AND a pin
 *
 * The rule is non-negative at 100%, and every tier now holds it. But a
 * threshold alone would let a margin fall from 30% to 1% and stay green, so
 * every figure is ALSO asserted as a number, at both prices: the next move in
 * either direction has to come here and say what it did.
 *
 * ## The shape of the defect the `UNLIMITED` rule below catches
 *
 * `agency.formSubmissionsPerMonth` was `UNLIMITED`, and form submissions are
 * a per-HOST band multiplied by `hostLimit` — so at 100 hosts the org-wide
 * figure was not merely large, it was infinite. Every cost model that scored
 * an absent or non-finite band as ZERO therefore reported the largest line
 * item on the most expensive self-serve plan as contributing nothing, and the
 * tier looked cheapest at the moment it was most expensive. So this guard
 * does NOT skip an unbounded band. It FAILS on one, by name.
 *
 * ## THE PAIR THAT DECIDES THE BANDWIDTH TERM (AGL-2712)
 *
 * `perPageView` is what a page view COSTS and `ESTIMATED_PAGE_TRANSFER_BYTES`
 * is what the same page view WEIGHS, and a bandwidth band is priced by
 * neither alone but by their quotient — `(1 GB ÷ bytes) × dollars`, the cost
 * of a gigabyte. A heavier page costs more per view and buys fewer views per
 * gigabyte; the two cancel, and the quotient is what the 2026-09-07 bands
 * were sized against.
 *
 * For part of 2026-09-09 they did not cancel, because only one of them moved.
 * The re-peg took `perPageView` from $0.0001 to $0.00016153846 for a
 * 1012.8 KB page while the conversion still assumed 600 KB, which
 * double-counted the page's weight: a gigabyte went from $0.17476 to
 * $0.28231 with no page having changed, and every paid tier read negative at
 * the annual price — Starter -3.6% through Pro -34.1%. Restoring the pairing
 * put a gigabyte at $0.16724, slightly UNDER what the bands were sized
 * against, and the whole ladder back above zero with no band moved.
 * `MUTATION: the unpaired constants` below holds those figures so the state
 * is recognizable if anything re-enters it, and `check:page-view-rate` is
 * what stops it being re-entered quietly.
 *
 * ## What it does not claim
 *
 * The rates are operator-tuned estimates, not an invoice (`ORG_COGS_UNIT_
 * RATES_USD` says so out loud). This is a RELATIVE instrument: it compares
 * the bands a tier sells against the rates the platform's own cost model
 * uses, and it reports when the product of the two exceeds the price the
 * customer pays.
 *
 * 100% utilization of every band at once is not a customer anyone expects.
 * It is a CEILING, and a ceiling is exactly the thing a price has to survive:
 * a tier that goes negative there is one whose worst case is a loss it cannot
 * refuse, because every one of those bands is included rather than metered.
 */

import {
  METERED_BILLED_RATES_USD,
  METERED_MARKUP,
  METERED_OVERAGE_COST_USD,
  METERED_UNIT_RATES_USD,
  meteredIncludedAllowance,
} from '../utils/usage-metering'
import {
  AI_ADDON_CREDITS_PER_MONTH,
  BANDWIDTH_ABUSE_CEILING_FLOOR,
  BANDWIDTH_ABUSE_CEILING_MULTIPLE,
  ESTIMATED_PAGE_TRANSFER_BYTES,
  INFRA_COGS_PER_SITE_USD,
  NET_MARGIN_FLOOR_PCT,
  NET_MARGIN_WARN_BAND_PCT,
  ORG_COGS_UNIT_RATES_USD,
  PAGE_VIEW_CDN_REQUEST_COST_USD,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  SELF_SERVE_PLANS,
  STRIPE_PROCESSOR_FEE_FIXED_USD,
  STRIPE_PROCESSOR_FEE_PCT,
  UNLIMITED,
  bandwidthCapShouldEngage,
  checkBandwidthAbuseCeiling,
  checkContactQuota,
  netOfProcessorFee,
  orgMonthlyCogsUsd,
} from '@aglyn/aglyn'
import type { OrgPlan } from '@aglyn/aglyn'
import { pluginUsageBands } from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'

/**
 * What one AI credit costs, as the AI plugin declares its credits band — the
 * constant its meter converts spend with, compiled into the catalog. The
 * plugin's own spec holds the declaration to that constant.
 */
const ASSIST_CREDIT_COST_USD = pluginUsageBands().find(
  (band) => band.id === 'assistCredits',
)?.unitCostUsd as number

type Interval = 'month' | 'year'

/** The paid, self-serve tiers: the only ones with both a band set and a price. */
const PAID = SELF_SERVE_PLANS.filter((plan) => plan !== 'free')

/**
 * Page views one GB of bandwidth buys, from the SAME constant the meter is
 * priced on. Bandwidth is published in GB and costs money per view, and
 * `pageViewsFromBandwidthGb` is the one conversion between them.
 */
const VIEWS_PER_GB = (1024 * 1024 * 1024) / ESTIMATED_PAGE_TRANSFER_BYTES

/**
 * What one GB of included bandwidth costs — the quotient of the two
 * constants, and the only figure of the three that a band can be sized
 * against.
 */
const COST_PER_GB_USD = VIEWS_PER_GB * ORG_COGS_UNIT_RATES_USD.perPageView

/**
 * Vercel's prices, at each end of its regional range: transfer per DECIMAL
 * GB, requests per million past the hosting plan's monthly allowance, and a
 * function's active CPU per hour and memory per GB-hour. The model prices
 * every one at the DEAREST end — `perPageView` carries the transfer at $0.35
 * and `PAGE_VIEW_CDN_REQUEST_COST_USD` the requests and the beacon's function
 * — because Vercel bills in the region that serves a visitor and the rule is
 * stated at any utilization. The cheapest end is what the instruments below
 * read the same bands at, so the room the dearest-region sizing leaves is a
 * figure.
 */
const VERCEL_PRICE_RANGE_USD = {
  transferPerGb: { cheapest: 0.15, dearest: 0.35 },
  requestsPerMillion: { cheapest: 2.0, dearest: 3.2 },
  cpuPerHour: { cheapest: 0.128, dearest: 0.221 },
  memoryPerGbHour: { cheapest: 0.0106, dearest: 0.0183 },
  originTransferPerGb: { cheapest: 0.06, dearest: 0.43 },
} as const

/** Decimal GB — Vercel's unit — in one binary GB of included bandwidth. */
const BILLED_GB_PER_BAND_GB = (1024 * 1024 * 1024) / 1_000_000_000

/**
 * What the requests behind ONE included page view cost — the shipped
 * constant, at the dearest region. NOT in `ORG_COGS_UNIT_RATES_USD`, for the
 * reason the CRM seat rate below is not: the platform model has no request
 * meter for it to multiply, and the constant is not a rate that table may
 * hold (see `PAGE_VIEW_CDN_REQUEST_COST_USD`).
 */
const REQUEST_COST_PER_VIEW_USD = PAGE_VIEW_CDN_REQUEST_COST_USD

/** The same requests, per GB of included bandwidth. */
const REQUEST_COST_PER_GB_USD = VIEWS_PER_GB * REQUEST_COST_PER_VIEW_USD

/**
 * The same gigabyte at the CHEAPEST region. Its weight with the transfer at
 * $0.15 a GB instead of $0.35 — a GB of included bandwidth is a binary GB of
 * transfer, 1.0737 of the decimal GB Vercel bills — and its requests: 57 at
 * $2.00 a million, plus the beacon's 0.4 s of function at the cheapest CPU
 * and memory prices, its two `nam5` writes and its 1 KB of origin transfer.
 * The Firestore reads in the weight are GCP's and do not move.
 */
const CHEAPEST_WEIGHT_PER_GB_USD =
  COST_PER_GB_USD -
  (VERCEL_PRICE_RANGE_USD.transferPerGb.dearest * BILLED_GB_PER_BAND_GB -
    VERCEL_PRICE_RANGE_USD.transferPerGb.cheapest)
const CHEAPEST_REQUEST_COST_PER_GB_USD =
  VIEWS_PER_GB *
  (57 * (VERCEL_PRICE_RANGE_USD.requestsPerMillion.cheapest / 1_000_000) +
    (0.4 / 3600) * VERCEL_PRICE_RANGE_USD.cpuPerHour.cheapest +
    ((2 * 0.4) / 3600) * VERCEL_PRICE_RANGE_USD.memoryPerGbHour.cheapest +
    0.6 / 1_000_000 +
    2 * 0.0000018 +
    1024 * (VERCEL_PRICE_RANGE_USD.originTransferPerGb.cheapest / 1_000_000_000))

/** What one GB of included bandwidth costs all in: its weight and its requests. */
const ALL_IN_COST_PER_GB_USD = COST_PER_GB_USD + REQUEST_COST_PER_GB_USD

/**
 * What one org member costs to serve for a month of CRM use — about 60,000
 * reads and 10,000 writes at nam5 list prices, ≈$0.054, carried as $0.06.
 * NOT in `ORG_COGS_UNIT_RATES_USD`, deliberately: the rollup has no
 * seat-months meter for the model to multiply it by, and a rate in that
 * table that no axis of `orgMonthlyCogsUsd` reads would fail `declares
 * exactly the axes the platform cost model prices` below. It is a decision
 * input — the Drive pricing decision log of 2026-09-05 records the basis —
 * and this spec is where the repo holds it.
 */
const CRM_SEAT_COGS_USD_PER_MONTH = 0.06

/**
 * The metered cost terms a tier's bands imply, per month, at full
 * utilization — one per axis of the platform's own cost model.
 *
 * Two of the bands are PER HOST and are expanded by `hostLimit`, exactly as
 * `meteredIncludedAllowance` expands them — that expansion is the reason
 * Agency's numbers are so much larger than its neighbours' and the reason an
 * unbounded per-host band is so dangerous.
 *
 * A non-finite term is returned as `Infinity` rather than dropped. The whole
 * point is that an unbounded band must poison the total instead of vanishing
 * from it.
 *
 * ⛔ EVERY TERM MULTIPLIES A RATE HERE, INCLUDING ASSIST — the model must not
 * route a band through a production converter, however tempting. The AI
 * meter's `assistUsdFromCredits` answers **0** for a non-finite band, by
 * design: it feeds a spend budget, and an unbounded budget is worse than
 * none. Reading
 * the assist term through it would make an `UNLIMITED` assist band cost
 * NOTHING here, which is the exact defect the `UNLIMITED` block at the bottom
 * of this file exists to catch, re-introduced on the newest axis. So the rate
 * is multiplied in, and `governs the assist band on the SAME rate the meter
 * does` pins the two against each other in both directions.
 */
function bandCostTerms(plan: OrgPlan): Record<string, number> {
  const entitlements = PLAN_ENTITLEMENTS[plan]
  const hosts = entitlements.hostLimit
  const rates = ORG_COGS_UNIT_RATES_USD
  return {
    // Per host, expanded.
    mediaStorage: (hosts * entitlements.storagePerHostMb) / 1024 * rates.storagePerGbMonth,
    formSubmissions: hosts * entitlements.formSubmissionsPerMonth * rates.perFormSubmission,
    // Org-wide.
    bandwidth: entitlements.bandwidthGb * VIEWS_PER_GB * rates.perPageView,
    datasetStorage: (entitlements.dataStorageMbPerOrg / 1024) * rates.dataStoragePerGbMonth,
    apiRequests: entitlements.apiRequestsPerMonth * rates.perApiRequest,
    contacts: entitlements.contactsPerHost * rates.perContactMonth,
    emailSends: entitlements.emailSendsPerMonth * rates.perEmailSend,
    // A credit IS a fixed quantity of provider spend, so this rate is not in
    // `ORG_COGS_UNIT_RATES_USD` — the platform's own model takes assist in
    // dollars at x1 for the same reason.
    assistCredits: entitlements.assistCreditsPerMonth * ASSIST_CREDIT_COST_USD,
    // Two bands, one term: a run costs the same whichever builder produced
    // it, and the platform model prices both counters on one line.
    runs:
      (entitlements.workflowRunsPerMonth + entitlements.actionRunsPerMonth) *
      rates.perRun,
  }
}

/**
 * The two CRM terms of the 2026-09-05 decision, priced on bands the
 * platform's own model has no meter for.
 *
 * `membersPerHost` is UNEXPANDED, unlike the two per-host bands above: it is
 * the population that can hold `data.manage` on a site, and the decision
 * costs the CRM on that population as it is sold. One-to-one mail lands on
 * the `emailSends` cost meter in production, at the same rate as every other
 * message — but the BAND is a daily cap on its own axis, so at 100% it is a
 * cost the campaign band above cannot stand in for.
 */
function crmDecisionTerms(plan: OrgPlan): Record<string, number> {
  const entitlements = PLAN_ENTITLEMENTS[plan]
  return {
    crmSeats: entitlements.membersPerHost * CRM_SEAT_COGS_USD_PER_MONTH,
    crmEmail:
      entitlements.crmEmailsPerDay * 30 * ORG_COGS_UNIT_RATES_USD.perEmailSend,
  }
}

/**
 * The CDN requests the tier's included bandwidth makes past the hosting
 * plan's allowance, at the dearest region (AGL-3444).
 *
 * Outside the platform model for the reason the CRM terms are: the rollup
 * records page views, and `orgMonthlyCogsUsd` prices them at their weight —
 * there is no request meter for it to multiply. The band is the SAME
 * `bandwidthGb` the `bandwidth` term reads, so the two move together and
 * `marginAtCostPerGb` replaces them together.
 */
function cdnRequestTerms(plan: OrgPlan): Record<string, number> {
  return {
    cdnRequests: PLAN_ENTITLEMENTS[plan].bandwidthGb * REQUEST_COST_PER_GB_USD,
  }
}

/** Every cost a tier's bands imply, per month, at full utilization. */
function tierCostTerms(plan: OrgPlan): Record<string, number> {
  return { ...bandCostTerms(plan), ...crmDecisionTerms(plan), ...cdnRequestTerms(plan) }
}

/** The measured total, before the per-site floor. */
function measuredCostUsd(plan: OrgPlan): number {
  return Object.values(tierCostTerms(plan)).reduce((a, b) => a + b, 0)
}

/** Bands that cannot be costed because they are uncapped. */
function unboundedTerms(plan: OrgPlan): string[] {
  return Object.entries(tierCostTerms(plan))
    .filter(([, cost]) => !Number.isFinite(cost))
    .map(([term]) => term)
    .sort()
}

/**
 * What a tier costs at `utilization` of every band, in USD.
 *
 * `INFRA_COGS_PER_SITE_USD × hostLimit` is a FLOOR rather than an added term,
 * matching `orgMonthlyCogsUsd` exactly: measured cost wins only when it
 * exceeds the flat per-site estimate. Adding the two would double-count the
 * baseline and make every tier look worse than the cost model says it is.
 */
function tierCostUsd(plan: OrgPlan, utilization: number): number {
  const measured = measuredCostUsd(plan)
  if (!Number.isFinite(measured)) return Number.POSITIVE_INFINITY
  return Math.max(measured * utilization, INFRA_COGS_PER_SITE_USD * PLAN_ENTITLEMENTS[plan].hostLimit)
}

/** The list price per month on `interval` — what the customer agrees to. */
function listPriceUsd(plan: OrgPlan, interval: Interval): number {
  return interval === 'year'
    ? PLAN_PRICING[plan].basePriceAnnualMonthlyUsd
    : PLAN_PRICING[plan].basePriceMonthlyUsd
}

/**
 * The same price NET of Stripe's fee — what the platform keeps before any
 * cost. Through the production helper, so the amortization of the fixed 30¢
 * over an annual charge is the one `orgNetMonthlyRevenueUsd` applies.
 */
function netPriceUsd(plan: OrgPlan, interval: Interval): number {
  return netOfProcessorFee(listPriceUsd(plan, interval), interval === 'year')
}

/**
 * Margin as a fraction of the list price: what the platform keeps after
 * Stripe and after cost, over what the customer pays. ANNUAL by default,
 * because the rule is stated at the cheaper price so that it holds at the
 * dearer one for free.
 */
function tierMargin(plan: OrgPlan, utilization: number, interval: Interval = 'year'): number {
  const price = listPriceUsd(plan, interval)
  if (!(price > 0)) return 0
  return (netPriceUsd(plan, interval) - tierCostUsd(plan, utilization)) / price
}

/**
 * The margin the tier would carry with its bandwidth band at `bandwidthGb`
 * and every other band as shipped — the single-axis instrument every
 * bandwidth mutation below is driven through.
 */
function marginAtBandwidth(plan: OrgPlan, bandwidthGb: number, interval: Interval): number {
  return marginAtCostPerGb(plan, COST_PER_GB_USD, interval, bandwidthGb)
}

/**
 * The margin the tier would carry if a gigabyte of included bandwidth WEIGHED
 * `costPerGbUsd` and its requests cost `requestsPerGbUsd` — the instrument for
 * every hypothetical about the PAIR, and about the CDN's regional range.
 *
 * A page weight enters this model through exactly one number, and it is not
 * `perPageView`: it is the cost of a gigabyte, which the rate and
 * `ESTIMATED_PAGE_TRANSFER_BYTES` produce together. Mutating the rate alone
 * would model a state where the two constants disagree, which is a bug rather
 * than a page — so the hypotheticals below move the quotient, and the one
 * case that deliberately models the disagreement says so in its name. The
 * request term rides on the same band, so both are replaced together.
 */
function marginAtCostPerGb(
  plan: OrgPlan,
  costPerGbUsd: number,
  interval: Interval,
  bandwidthGb = PLAN_ENTITLEMENTS[plan].bandwidthGb,
  requestsPerGbUsd = REQUEST_COST_PER_GB_USD,
): number {
  const terms = tierCostTerms(plan)
  const cost =
    Object.values(terms).reduce((a, b) => a + b, 0) -
    terms.bandwidth -
    terms.cdnRequests +
    bandwidthGb * (costPerGbUsd + requestsPerGbUsd)
  const price = listPriceUsd(plan, interval)
  return (netPriceUsd(plan, interval) - Math.max(cost, INFRA_COGS_PER_SITE_USD * PLAN_ENTITLEMENTS[plan].hostLimit)) / price
}

/**
 * Tiers whose margin at `utilization` is below `floor`.
 *
 * An unbounded tier is reported, never skipped: `Infinity` cost yields
 * `-Infinity` margin, which is below every floor.
 */
function tiersUnderFloor(
  plans: readonly OrgPlan[],
  utilization: number,
  floor: number,
  interval: Interval = 'year',
): string[] {
  return plans.filter((plan) => !(tierMargin(plan, utilization, interval) >= floor)).sort()
}

/**
 * The paid tiers whose cost model is fully bounded.
 *
 * Anything with an uncapped band cannot be given a margin at all — its cost
 * is `Infinity` and its margin `-Infinity`. Those are handled by the
 * `UNLIMITED` block at the bottom, which names them, rather than by being
 * quietly dropped from a threshold that would then be about a smaller ladder
 * than it claims.
 */
const BOUNDED = PAID.filter((plan) => unboundedTerms(plan).length === 0)

/** One decimal, the way every figure in this file is pinned. */
const pct = (plan: OrgPlan, u: number, interval: Interval) =>
  Number((tierMargin(plan, u, interval) * 100).toFixed(1))

// ---------------------------------------------------------------------------
// THE CONTROL, first. Every number below is read by string key off two
// tables; a rename, a stub or a collapsed table makes every reading 0 or
// undefined, and a margin computed from zero cost is 100% on every tier.
// ---------------------------------------------------------------------------
describe('the model is reading real bands, real rates and the real fee', () => {
  it('reads a finite, non-zero cost for every paid tier', () => {
    for (const plan of PAID) {
      expect(`${plan}: ${measuredCostUsd(plan) > 0}`).toBe(`${plan}: true`)
    }
  })

  it('costs more for a bigger tier than a smaller one', () => {
    // A stubbed resolver returns the same row for every plan, and every
    // assertion about "this tier" would still pass. The ladder must be
    // visible in the cost, not only in the price.
    const costs = PAID.map((plan) => tierCostUsd(plan, 1))
    expect(costs).toEqual([...costs].sort((a, b) => a - b))
    expect(new Set(costs).size).toBe(costs.length)
  })

  it('names bandwidth — weight and requests together — as the dominant BOUNDED term on five of six tiers', () => {
    // Stated as a fact rather than left implicit: page views are the largest
    // finite line almost everywhere, which is why the bands that had to come
    // down were the bandwidth ones and nothing else could have carried it.
    //
    // A gigabyte is two terms here — what it weighs and the CDN requests it
    // makes — and one band, so they are read as one line. Pinned as the
    // whole map so a tier changing its dominant axis has to come here and
    // say so.
    const withTrafficAsOneLine = (plan: OrgPlan): Record<string, number> => {
      const { bandwidth, cdnRequests, ...rest } = tierCostTerms(plan)
      return { ...rest, traffic: bandwidth + cdnRequests }
    }
    expect(
      Object.fromEntries(
        PAID.map((plan) => [
          plan,
          Object.entries(withTrafficAsOneLine(plan))
            .filter(([, cost]) => Number.isFinite(cost))
            .sort((a, b) => b[1] - a[1])[0][0],
        ]),
      ),
    ).toEqual({
      starter: 'traffic',
      pro: 'traffic',
      business: 'traffic',
      scale: 'traffic',
      advanced: 'formSubmissions',
      agency: 'traffic',
    })
    // Advanced is the exception and is named rather than excused: 25 sites ×
    // 40,000 submissions at $0.0000615 is $61.54 a month, ahead of its
    // campaign email ($58.50) and its 80 GB of traffic ($50.97). Traffic is
    // still the axis its band was cut on, because it is the one band sized
    // against what remains.
    const advanced = withTrafficAsOneLine('advanced')
    expect(advanced.formSubmissions).toBeCloseTo(61.54, 2)
    expect(advanced.traffic).toBeCloseTo(50.97, 2)
    expect(advanced.traffic / advanced.emailSends).toBeLessThan(1)
  })

  /**
   * THE PAIR, READ AS ONE NUMBER (AGL-2712).
   *
   * Every bandwidth term above is `bandwidthGb × VIEWS_PER_GB × perPageView`,
   * and the two constants in that product are one measurement in two units.
   * Multiplied out they are the cost of a gigabyte, which is the figure the
   * 2026-09-07 band resize was argued on — so it is asserted here, as a
   * number, beside the model that spends it.
   */
  it('prices a gigabyte from two constants that describe the SAME page', () => {
    // The two halves, each recovered as a page weight in KB. A tenth of a KB
    // is the grid `check:page-view-rate` compares them on, and this is the
    // same comparison inside the model that spends the result: the rate over
    // the calibration's per-KB cost ($0.0001 for 627 KB) with its transfer
    // share at the dearest region's $0.35 per decimal GB instead of $0.15
    // per binary one, and its ~40 reads at nam5's $0.0000006 instead of the
    // single-region $0.0000003.
    const usdPerKb =
      0.0001 / 627 +
      (VERCEL_PRICE_RANGE_USD.transferPerGb.dearest * 1024) / 1_000_000_000 -
      VERCEL_PRICE_RANGE_USD.transferPerGb.cheapest / (1024 * 1024) +
      (40 * (0.0000006 - 0.0000003)) / 627
    const impliedByRate = ORG_COGS_UNIT_RATES_USD.perPageView / usdPerKb
    expect(Math.round((ESTIMATED_PAGE_TRANSFER_BYTES / 1024) * 10) / 10).toBe(
      1012.8,
    )
    expect(Math.round(impliedByRate * 10) / 10).toBe(1012.8)
    // …and the quotient they make, which is a gigabyte's WEIGHT at the
    // dearest region: a gigabyte of included bandwidth is a binary gigabyte
    // of transfer, 1.0737 decimal ones at $0.35, where the calibration priced
    // it at $0.15 — $0.22581 more — and its reads cost $0.02007 more at nam5.
    expect(COST_PER_GB_USD).toBeCloseTo(0.41312, 5)
    expect(COST_PER_GB_USD - CHEAPEST_WEIGHT_PER_GB_USD).toBeCloseTo(
      0.35 * BILLED_GB_PER_BAND_GB - 0.15,
      12,
    )
    expect(COST_PER_GB_USD - CHEAPEST_WEIGHT_PER_GB_USD).toBeCloseTo(0.22581, 5)
    expect(CHEAPEST_WEIGHT_PER_GB_USD).toBeCloseTo(0.18731, 5)
    // The metered table is the same rate, so the meter a customer is billed
    // on and the model that sizes their band cannot part.
    expect(METERED_UNIT_RATES_USD.perPageView).toBe(
      ORG_COGS_UNIT_RATES_USD.perPageView,
    )
  })

  /**
   * THE REQUEST TERM, READ AS ONE NUMBER (AGL-3444).
   *
   * Past the hosting plan's request allowance the same gigabyte also costs
   * the requests its 1,035 views make: 57 CDN requests a view at the dearest
   * region's $3.20 per million, and the analytics beacon's function and two
   * counter writes — pinned up so the billed view lands on a whole cent. All
   * in, the gigabyte the bands are argued on costs $0.63712.
   */
  it('prices a gigabyte\'s requests at the dearest region, from the billed view\'s own term', () => {
    // The billed view's term IS the dearest region's: one constant prices the
    // overage and sizes the bands.
    expect(PAGE_VIEW_CDN_REQUEST_COST_USD).toBe(0.00021635711)
    // The measured parts: 57 requests at $3.20/M, the beacon's 0.4 s of
    // function at the dearest CPU and memory prices plus $0.60/M, its two
    // nam5 writes, and its 1 KB of origin transfer at $0.43 a decimal GB.
    const beacon =
      (0.4 / 3600) * VERCEL_PRICE_RANGE_USD.cpuPerHour.dearest +
      ((2 * 0.4) / 3600) * VERCEL_PRICE_RANGE_USD.memoryPerGbHour.dearest +
      0.6 / 1_000_000 +
      2 * 0.0000018 +
      1024 * (VERCEL_PRICE_RANGE_USD.originTransferPerGb.dearest / 1_000_000_000)
    expect(beacon).toBeCloseTo(0.00003326, 8)
    expect(57 * 3.2e-6 + beacon).toBeCloseTo(0.00021566, 8)
    expect(PAGE_VIEW_CDN_REQUEST_COST_USD).toBeGreaterThan(57 * 3.2e-6 + beacon)
    expect(REQUEST_COST_PER_VIEW_USD).toBe(PAGE_VIEW_CDN_REQUEST_COST_USD)
    expect(REQUEST_COST_PER_GB_USD).toBeCloseTo(0.224, 5)
    // The cheapest region is the same requests at $2.00 and the beacon at
    // the cheapest CPU and memory prices.
    expect(CHEAPEST_REQUEST_COST_PER_GB_USD).toBeCloseTo(0.1396, 4)
    // All in, a gigabyte of included bandwidth costs 3.8× what the
    // weight-only, cheapest-region figure of 2026-09-09 said ($0.16724) —
    // which is why the bands came down by about three quarters.
    expect(ALL_IN_COST_PER_GB_USD).toBeCloseTo(0.63712, 5)
    expect(ALL_IN_COST_PER_GB_USD / 0.16724).toBeCloseTo(3.81, 2)
    // …and the model carries exactly that on every tier, on the same band
    // the weight term reads.
    for (const plan of PAID) {
      const terms = tierCostTerms(plan)
      expect(`${plan}: ${(terms.bandwidth + terms.cdnRequests).toFixed(8)}`).toBe(
        `${plan}: ${(PLAN_ENTITLEMENTS[plan].bandwidthGb * ALL_IN_COST_PER_GB_USD).toFixed(8)}`,
      )
    }
  })

  /**
   * AN API REQUEST IS A FUNCTION (AGL-3444).
   *
   * `perApiRequest` was $0.000002 — about three reads — and counted no
   * Vercel cost at all, while every `/v1` request is a function invocation
   * behind a CDN request that reads, writes and answers. Priced for a default
   * list page at the dearest region and nam5, it is $0.000117; and each paid
   * API band is cut to the dollars it was sized to cost at the old rate, the
   * largest multiple of 500 requests inside them, so the bandwidth bands
   * absorb only what bandwidth costs.
   */
  it('prices an API request as the function it is, and keeps each API band to its dollars', () => {
    const ledger =
      31 * 0.0000006 +
      2 * 0.0000018 +
      (0.4 / 3600) * VERCEL_PRICE_RANGE_USD.cpuPerHour.dearest +
      ((2 * 0.4) / 3600) * VERCEL_PRICE_RANGE_USD.memoryPerGbHour.dearest +
      0.6 / 1_000_000 +
      VERCEL_PRICE_RANGE_USD.requestsPerMillion.dearest / 1_000_000 +
      (25 * 3 * 1024 + 2 * 1024) *
        ((VERCEL_PRICE_RANGE_USD.transferPerGb.dearest +
          VERCEL_PRICE_RANGE_USD.originTransferPerGb.dearest) /
          1_000_000_000)
    expect(ledger).toBeCloseTo(0.00011612, 8)
    expect(ORG_COGS_UNIT_RATES_USD.perApiRequest).toBe(0.000117)
    expect(ORG_COGS_UNIT_RATES_USD.perApiRequest).toBeGreaterThanOrEqual(ledger)
    const sizedToCost = {
      business: 100_000 * 0.000002,
      scale: 300_000 * 0.000002,
      advanced: 1_000_000 * 0.000002,
      agency: 5_000_000 * 0.000002,
    } as const
    expect(
      Object.fromEntries(
        Object.keys(sizedToCost).map((plan) => [
          plan,
          PLAN_ENTITLEMENTS[plan as OrgPlan].apiRequestsPerMonth,
        ]),
      ),
    ).toEqual({ business: 1_500, scale: 5_000, advanced: 17_000, agency: 85_000 })
    for (const [plan, dollars] of Object.entries(sizedToCost)) {
      const band = PLAN_ENTITLEMENTS[plan as OrgPlan].apiRequestsPerMonth
      // Inside the dollars, and the next 500 would not be.
      expect(`${plan}: ${band * ORG_COGS_UNIT_RATES_USD.perApiRequest <= dollars}`).toBe(`${plan}: true`)
      expect(`${plan}: ${(band + 500) * ORG_COGS_UNIT_RATES_USD.perApiRequest > dollars}`).toBe(
        `${plan}: true`,
      )
      expect(band % 500).toBe(0)
    }
    // Enterprise's fallback stays twice Agency's.
    expect(PLAN_ENTITLEMENTS.enterprise.apiRequestsPerMonth).toBe(170_000)
    // A page of 100 — the most a client may ask for — is about three times
    // the default request, which is why the rate is the default request and
    // the ceiling is named rather than priced.
    const maxPage =
      ledger + 75 * 0.0000006 + 75 * 3 * 1024 * ((0.35 + 0.43) / 1_000_000_000)
    expect(maxPage / ledger).toBeGreaterThan(2.9)
    expect(maxPage / ledger).toBeLessThan(3)
  })

  it('reads the price NET of Stripe, through the production helper', () => {
    // The fee is 2.9% plus 30¢ a charge, and an annual subscription is ONE
    // charge a year — so the fixed part amortizes to 2.5¢ a month there and
    // costs the full 30¢ on a monthly plan. Pinned against the constants so
    // a helper that stopped amortizing, or stopped subtracting, is caught by
    // the number and not only by every margin below moving at once.
    expect(STRIPE_PROCESSOR_FEE_PCT).toBe(0.029)
    expect(STRIPE_PROCESSOR_FEE_FIXED_USD).toBe(0.3)
    expect(netPriceUsd('pro', 'year')).toBe(37.84)
    expect(netPriceUsd('pro', 'month')).toBe(54.08)
    expect(netPriceUsd('pro', 'year')).toBeCloseTo(39 * (1 - 0.029) - 0.3 / 12, 2)
    for (const plan of PAID) {
      // Net is under list on both intervals, and the annual price is the
      // cheaper one — the whole reason the rule is stated there.
      expect(netPriceUsd(plan, 'year')).toBeLessThan(listPriceUsd(plan, 'year'))
      expect(netPriceUsd(plan, 'month')).toBeLessThan(listPriceUsd(plan, 'month'))
      expect(listPriceUsd(plan, 'year')).toBeLessThan(listPriceUsd(plan, 'month'))
    }
  })

  it('CONTROL: the floor detector answers both ways', () => {
    // Driven against the real tables at two floors that must give different
    // answers, so a detector stuck on one verdict cannot produce a green.
    expect(tiersUnderFloor(BOUNDED, 1, -10)).toEqual([])
    expect(tiersUnderFloor(BOUNDED, 1, 0.99)).toEqual([...BOUNDED].sort())
  })
})

// ---------------------------------------------------------------------------
// THE DEFECT CLASS, closed. Three times this model has silently omitted a
// cost, and a cost the model cannot see reads exactly like a cost that is not
// there. The term set is therefore DERIVED from the tables rather than
// maintained here.
// ---------------------------------------------------------------------------
describe('every cost the platform prices has a term here', () => {
  /**
   * The cost axes the PLATFORM's own model prices, read off it at runtime.
   *
   * `orgMonthlyCogsUsd` is the production cost model — the one the discount
   * guardrail and the staff MRR views run on — and it builds its `breakdown`
   * unconditionally, so an empty rollup still names every axis it knows how
   * to price. That makes it a LIVE authority rather than a list: the eighth
   * axis (`assist`) was already there when this file still had seven terms,
   * so this comparison would have caught the omission on the day it landed.
   *
   * Reading it from `null` input is deliberate. Handing it a rollup would
   * make the answer depend on which fields that rollup happened to carry,
   * which is a second hand-maintained list and the same defect one level up.
   */
  const PLATFORM_COST_AXES = Object.keys(orgMonthlyCogsUsd(null, 0).breakdown)

  /**
   * The naming bridge, and the ONLY hand-written thing in this block.
   *
   * The two models name the same axes differently — the platform model reads
   * meters (`storage`, `pageViews`) and this one reads bands (`mediaStorage`,
   * `bandwidth`) — so something has to say which is which. What matters is
   * that every column is pinned to a live source and none of them may be
   * under-declared: the `axis` column must equal `PLATFORM_COST_AXES`, the
   * `term` column must equal the keys of `bandCostTerms`, and each `band` is
   * proved to move its own term and no other. A new cost cannot be added to
   * `ORG_COGS_UNIT_RATES_USD`, to `PLAN_ENTITLEMENTS` or to the platform
   * model without a row here, and a row here cannot be faked.
   */
  const COST_AXES = [
    { axis: 'storage', term: 'mediaStorage', band: 'storagePerHostMb' },
    { axis: 'pageViews', term: 'bandwidth', band: 'bandwidthGb' },
    {
      axis: 'formSubmissions',
      term: 'formSubmissions',
      band: 'formSubmissionsPerMonth',
    },
    {
      axis: 'dataStorage',
      term: 'datasetStorage',
      band: 'dataStorageMbPerOrg',
    },
    { axis: 'apiRequests', term: 'apiRequests', band: 'apiRequestsPerMonth' },
    { axis: 'contacts', term: 'contacts', band: 'contactsPerHost' },
    { axis: 'emailSends', term: 'emailSends', band: 'emailSendsPerMonth' },
    { axis: 'assist', term: 'assistCredits', band: 'assistCreditsPerMonth' },
    // One term fed by TWO bands; the perturbation below drives it through
    // the workflow band, and `prices workflow and action runs on ONE term`
    // drives the action band through the same term.
    { axis: 'runs', term: 'runs', band: 'workflowRunsPerMonth' },
  ] as const

  /** Axes with no term in the model — the failure this block is named for. */
  function axesMissingFrom(terms: Record<string, number>): string[] {
    return COST_AXES.filter(({ term }) => !(term in terms))
      .map(({ axis }) => axis)
      .sort()
  }

  /** Terms in the model that answer to no axis — the other direction. */
  function termsWithNoAxis(terms: Record<string, number>): string[] {
    const declared = new Set<string>(COST_AXES.map(({ term }) => term))
    return Object.keys(terms)
      .filter((term) => !declared.has(term))
      .sort()
  }

  it('declares exactly the axes the platform cost model prices', () => {
    // A cost added to `orgMonthlyCogsUsd` and not to this file fails HERE,
    // with its own name in the diff, before any margin is computed.
    expect(COST_AXES.map(({ axis }) => axis).sort()).toEqual(
      [...PLATFORM_COST_AXES].sort(),
    )
    // …and the axis list is real rather than an empty set agreeing with an
    // empty set. Nine axes, which is what makes the count meaningful.
    expect(PLATFORM_COST_AXES.length).toBe(9)
  })

  it('prices workflow and action runs on ONE term, from BOTH bands', () => {
    // The ninth axis (2026-09-07). Both run counters were recorded on every
    // rollup and sold on every paid tier, and neither had a rate — so
    // Agency's 3,000,000 runs a month were $36 the model could not see.
    expect(ORG_COGS_UNIT_RATES_USD.perRun).toBe(0.000013)
    for (const plan of PAID) {
      const entitlements = PLAN_ENTITLEMENTS[plan]
      expect(`${plan}: ${bandCostTerms(plan).runs}`).toBe(
        `${plan}: ${
          (entitlements.workflowRunsPerMonth + entitlements.actionRunsPerMonth) *
          ORG_COGS_UNIT_RATES_USD.perRun
        }`,
      )
    }
    // The ACTION band moves the term too, and nothing else — the bridge
    // above proves it for the workflow band.
    const entitlements = PLAN_ENTITLEMENTS.advanced as unknown as Record<string, number>
    const original = entitlements.actionRunsPerMonth
    const before = bandCostTerms('advanced')
    let after: Record<string, number>
    try {
      entitlements.actionRunsPerMonth = original + 1024
      after = bandCostTerms('advanced')
    } finally {
      entitlements.actionRunsPerMonth = original
    }
    const moved = Object.keys(after)
      .filter((key) => after[key] !== before[key])
      .sort()
    expect(moved).toEqual(['runs'])
    expect(after.runs - before.runs).toBeCloseTo(1024 * ORG_COGS_UNIT_RATES_USD.perRun, 12)
    // Agency's figure, as a number: the one that read as nothing.
    expect(bandCostTerms('agency').runs).toBeCloseTo(39, 6)
  })

  it('has one band term per axis on every paid tier, and no orphan term', () => {
    for (const plan of PAID) {
      const terms = bandCostTerms(plan)
      expect(`${plan} missing: ${axesMissingFrom(terms).join(',')}`).toBe(
        `${plan} missing: `,
      )
      expect(`${plan} orphan: ${termsWithNoAxis(terms).join(',')}`).toBe(
        `${plan} orphan: `,
      )
    }
  })

  it('carries the two CRM decision terms and the CDN request term OUTSIDE the platform model, and no fourth', () => {
    // The seat, one-to-one email and CDN request terms are real cost with no
    // meter behind them — the platform model cannot price what the rollup
    // does not record — so they live beside the bridged terms rather than
    // inside it. Named here, both directions, so a fourth un-bridged term
    // cannot arrive the way the first three omissions did: silently.
    expect(Object.keys(crmDecisionTerms('advanced')).sort()).toEqual([
      'crmEmail',
      'crmSeats',
    ])
    expect(Object.keys(cdnRequestTerms('advanced'))).toEqual(['cdnRequests'])
    for (const plan of PAID) {
      expect(Object.keys(tierCostTerms(plan)).sort()).toEqual(
        [...Object.keys(bandCostTerms(plan)), 'crmSeats', 'crmEmail', 'cdnRequests'].sort(),
      )
      expect(termsWithNoAxis(crmDecisionTerms(plan))).toEqual(['crmEmail', 'crmSeats'])
      expect(termsWithNoAxis(cdnRequestTerms(plan))).toEqual(['cdnRequests'])
    }
    // The request term reads the BANDWIDTH band, and moves with the weight
    // term and nothing else — one band, two costs.
    {
      const entitlements = PLAN_ENTITLEMENTS.advanced as unknown as Record<string, number>
      const original = entitlements.bandwidthGb
      const before = tierCostTerms('advanced')
      let after: Record<string, number>
      try {
        entitlements.bandwidthGb = original + 7
        after = tierCostTerms('advanced')
      } finally {
        entitlements.bandwidthGb = original
      }
      const moved = Object.keys(after)
        .filter((key) => after[key] !== before[key])
        .sort()
      expect(moved).toEqual(['bandwidth', 'cdnRequests'])
      expect(after.cdnRequests - before.cdnRequests).toBeCloseTo(7 * REQUEST_COST_PER_GB_USD, 10)
    }
    // Each reads its OWN band and moves nothing else — proved by perturbation
    // on Advanced, where both bands are non-zero.
    const entitlements = PLAN_ENTITLEMENTS.advanced as unknown as Record<string, number>
    for (const [band, term] of [
      ['membersPerHost', 'crmSeats'],
      ['crmEmailsPerDay', 'crmEmail'],
    ] as const) {
      const original = entitlements[band]
      const before = tierCostTerms('advanced')
      let after: Record<string, number>
      try {
        entitlements[band] = original + 7
        after = tierCostTerms('advanced')
      } finally {
        entitlements[band] = original
      }
      const moved = Object.keys(after)
        .filter((key) => after[key] !== before[key])
        .sort()
      expect(`${band} moves: ${moved.join(',')}`).toBe(`${band} moves: ${term}`)
    }
    // …at the rates the decision names: $0.06 a seat, and the SAME per-send
    // rate every other message is priced at, thirty days over.
    expect(crmDecisionTerms('agency').crmSeats).toBeCloseTo(250 * 0.06, 10)
    expect(crmDecisionTerms('agency').crmEmail).toBeCloseTo(
      1_000 * 30 * ORG_COGS_UNIT_RATES_USD.perEmailSend,
      10,
    )
  })

  it('MUTATION: dropping the assist term is reported BY NAME', () => {
    // The instrument, driven against a model with one term removed — which is
    // literally the state this file shipped in. A guard that only moved the
    // percentages would have let the next omission through the same way.
    const { assistCredits: _dropped, ...sevenTerms } = bandCostTerms('advanced')
    expect(axesMissingFrom(sevenTerms)).toEqual(['assist'])
    // BOTH WAYS: the complete model reports nothing missing, so the detector
    // is not stuck on one verdict.
    expect(axesMissingFrom(bandCostTerms('advanced'))).toEqual([])
    // …and an extra term nobody priced is reported too.
    expect(
      termsWithNoAxis({ ...bandCostTerms('advanced'), invented: 1 }),
    ).toEqual(['invented'])
  })

  it('READS every rate in ORG_COGS_UNIT_RATES_USD, proved by perturbation', () => {
    // No name mapping at all: a rate the model never multiplies cannot change
    // any tier's cost, whatever it is called. This is the half that needs no
    // maintenance — the next rate added to that table is swept automatically.
    const rates = ORG_COGS_UNIT_RATES_USD as unknown as Record<string, number>
    const unread = (keys: string[]) =>
      keys.filter((key) => {
        const original = rates[key]
        const before = PAID.map((plan) => measuredCostUsd(plan))
        try {
          // `x * 2 + 1` rather than `x * 2`, so a rate of zero also moves.
          rates[key] = original * 2 + 1
          const after = PAID.map((plan) => measuredCostUsd(plan))
          return after.every((cost, index) => cost === before[index])
        } finally {
          rates[key] = original
        }
      })

    expect(unread(Object.keys(rates))).toEqual([])

    // CONTROL. The sweep must be able to find an unread rate, or the green
    // above says only that the loop ran.
    rates.unreadByTheModel = 1
    try {
      expect(unread(Object.keys(rates))).toEqual(['unreadByTheModel'])
    } finally {
      delete rates.unreadByTheModel
    }
  })

  it('reads the assist rate, which is NOT in that table', () => {
    // A credit's cost is the AI plugin's declared unit, not a row of the
    // platform's table, because a credit IS provider spend rather than a
    // meter priced per unit — the platform model takes assist in dollars at
    // x1 for the same reason. The sweep above therefore cannot see it, and
    // this is the term that was missing.
    expect(ASSIST_CREDIT_COST_USD).toBe(0.001)
    expect(Object.keys(ORG_COGS_UNIT_RATES_USD)).not.toContain(
      'assistCreditsPerMonth',
    )
    for (const plan of PAID) {
      expect(`${plan}: ${bandCostTerms(plan).assistCredits}`).toBe(
        `${plan}: ${
          PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth * ASSIST_CREDIT_COST_USD
        }`,
      )
    }
  })

  it('wires each axis to its OWN entitlement, and to no other term', () => {
    // Proves three things at once that a name map cannot: the entitlement key
    // is really read, it feeds the term the bridge claims, and no two terms
    // share a band. Advanced, because every one of its bands is non-zero.
    const entitlements = PLAN_ENTITLEMENTS.advanced as unknown as Record<
      string,
      number
    >
    for (const { axis, term, band } of COST_AXES) {
      const original = entitlements[band]
      const before = bandCostTerms('advanced')
      let after: Record<string, number>
      try {
        entitlements[band] = original + 1024
        after = bandCostTerms('advanced')
      } finally {
        entitlements[band] = original
      }
      const moved = Object.keys(after)
        .filter((key) => after[key] !== before[key])
        .sort()
      expect(`${axis} moves: ${moved.join(',')}`).toBe(`${axis} moves: ${term}`)
    }
  })

  it('governs the assist band on the SAME rate the meter does', () => {
    // The pairing. The model prices a credit at the unit the AI plugin's
    // meter declares — a second assist rate here would be exactly the drift
    // `orgMonthlyCogsUsd` was built to remove.
    for (const plan of PAID) {
      expect(`${plan}: ${bandCostTerms(plan).assistCredits}`).toBe(
        `${plan}: ${PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth * ASSIST_CREDIT_COST_USD}`,
      )
    }
    // …and for an UNBOUNDED band the model multiplies the rate itself, so an
    // uncapped band costs Infinity rather than nothing. The meter's own
    // converter answers 0 for a non-finite band because it feeds a spend
    // budget; scoring an uncapped band as free is the one thing this file may
    // never do.
    expect(UNLIMITED * ASSIST_CREDIT_COST_USD).toBe(Number.POSITIVE_INFINITY)
    // …and the MODEL, not the helper, is what has to hold that. An uncapped
    // assist band must reach `unboundedTerms` by name, exactly as an uncapped
    // form band does — which is a claim about this file's arithmetic and
    // fails the moment the term is read through the converter.
    const entitlements = PLAN_ENTITLEMENTS.advanced as unknown as Record<
      string,
      number
    >
    const original = entitlements.assistCreditsPerMonth
    try {
      entitlements.assistCreditsPerMonth = UNLIMITED
      expect(unboundedTerms('advanced')).toEqual(['assistCredits'])
      expect(tierCostUsd('advanced', 1)).toBe(Number.POSITIVE_INFINITY)
    } finally {
      entitlements.assistCreditsPerMonth = original
    }
    // BOTH WAYS: with the shipped band nothing is unbounded.
    expect(unboundedTerms('advanced')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The rule.
// ---------------------------------------------------------------------------
describe('what full utilization costs against each price, and where it stops clearing', () => {
  /**
   * THE RULE.
   *
   * It is not a threshold anyone chose to be comfortable — it is the survival
   * condition. Every band here is INCLUDED rather than metered, so a customer
   * spending all of it is exercising the plan exactly as sold, and there is no
   * overage to bill and no gate to refuse them.
   *
   * It is stated at the annual price because that is the cheaper of the two a
   * customer can choose and the one the page leads with. It held for none of
   * the five upper tiers before the 2026-09-07 band resize; it held for all
   * six after it; it held for none of them while the page-view constants were
   * unpaired, nor at the CDN's dearest region at the bands sold until
   * 2026-10-01; and it holds for all six at the bands sized for that.
   *
   * The offender set is asserted EMPTY and every margin is pinned as a number
   * below, which is stricter than a floor: a band widened, a price cut or a
   * rate raised moves one of those figures and has to come here and say what
   * it did.
   */
  it('is non-negative on every paid tier at 100% of every band, at the annual price', () => {
    const offenders = tiersUnderFloor(PAID, 1, 0, 'year')
    // Named with the arithmetic, so a failure says which tier and by how much
    // rather than that one exists.
    expect(
      Object.fromEntries(
        offenders.map((plan) => [
          plan,
          `$${listPriceUsd(plan as OrgPlan, 'year')} annual price, ` +
            `$${netPriceUsd(plan as OrgPlan, 'year')} net of Stripe, vs ` +
            `$${tierCostUsd(plan as OrgPlan, 1).toFixed(2)} cost`,
        ]),
      ),
    ).toEqual({})
    // …and the arithmetic behind the empty set, so a detector that had stopped
    // reading cost cannot produce the same green. Every tier keeps something.
    expect(
      Object.fromEntries(
        PAID.map((plan) => [
          plan,
          `$${netPriceUsd(plan, 'year')} net of Stripe, vs ` +
            `$${tierCostUsd(plan, 1).toFixed(2)} cost`,
        ]),
      ),
    ).toEqual({
      starter: '$15.51 net of Stripe, vs $15.47 cost',
      pro: '$37.84 net of Stripe, vs $35.01 cost',
      business: '$96.1 net of Stripe, vs $93.17 cost',
      scale: '$173.78 net of Stripe, vs $170.81 cost',
      advanced: '$290.3 net of Stripe, vs $289.25 cost',
      agency: '$1018.55 net of Stripe, vs $1017.45 cost',
    })
  })

  /**
   * THE SAME RULE AT THE DEARER PRICE, asserted rather than assumed.
   *
   * A monthly customer at 100% of every band pays for themselves by a wide
   * margin on every tier. The rule is stated at the annual price so that it
   * holds here for free — but "for free" is an argument, not a measurement,
   * and this is the measurement.
   */
  it('holds at the monthly price on every tier, which is the easier of the two', () => {
    expect(tiersUnderFloor(PAID, 1, 0, 'month')).toEqual([])
    // The rule is stated at the annual price so that it holds at the monthly
    // one for free — asserted rather than assumed, on every tier.
    for (const plan of PAID) {
      expect(`${plan}: ${tierMargin(plan, 1, 'month') > tierMargin(plan, 1, 'year')}`).toBe(
        `${plan}: true`,
      )
    }
  })

  /**
   * Every tier, at four utilizations, on both prices, as NUMBERS.
   *
   * A pin as well as a floor: these figures are the whole argument for the
   * band resize, and any change to a band, a price, a fee or a cost rate
   * moves one of them. The floor above says the ladder survives; this says
   * by how much, so a change that halves a margin while staying positive
   * still has to come here and say so.
   */
  it('are exactly these at the annual price, at 3 / 25 / 50 / 100% of every band', () => {
    expect(
      Object.fromEntries(
        PAID.map((plan) => [plan, [0.03, 0.25, 0.5, 1].map((u) => pct(plan, u, 'year'))]),
      ),
    ).toEqual({
      starter: [84.4, 72.8, 48.6, 0.2],
      pro: [81.6, 74.6, 52.1, 7.3],
      business: [76.9, 73.5, 50, 3],
      scale: [80.3, 73.2, 49.4, 1.7],
      advanced: [80.4, 72.9, 48.7, 0.4],
      agency: [78, 72.8, 48.6, 0.1],
    })
    // The 3% column does not move when a unit rate does, and that is not a
    // rounding coincidence. At 3% of every band the per-site FLOOR governs
    // (`INFRA_COGS_PER_SITE_USD` x hostLimit), and the floor is a flat dollar
    // figure no unit rate touches — so the one column a re-peg leaves alone
    // is the one where measured cost is not what is being charged against.
    for (const plan of PAID) {
      expect(`${plan}: ${tierCostUsd(plan, 0.03)}`).toBe(
        `${plan}: ${INFRA_COGS_PER_SITE_USD * PLAN_ENTITLEMENTS[plan].hostLimit}`,
      )
    }
  })

  it('and these at the monthly price', () => {
    expect(
      Object.fromEntries(
        PAID.map((plan) => [plan, [0.03, 0.25, 0.5, 1].map((u) => pct(plan, u, 'month'))]),
      ),
    ).toEqual({
      starter: [87.9, 80.4, 65, 34],
      pro: [85.9, 80.9, 65.3, 34.1],
      business: [82.5, 80.1, 63.4, 29.9],
      scale: [84.9, 79.8, 62.7, 28.4],
      advanced: [84.5, 78.9, 60.8, 24.5],
      agency: [81.7, 77.5, 57.9, 18.8],
    })
  })

  /**
   * WHERE THE 75% CONTRIBUTION FLOOR SITS ON THIS LADDER, and what it is
   * a floor ON.
   *
   * `NET_MARGIN_FLOOR_PCT` is 0.75 with a 10-point warn band under it, and it
   * underwrites DISCOUNTS: `checkDiscountMargin` rates net revenue less the
   * org's own measured infrastructure COGS, which on production is the flat
   * `INFRA_COGS_PER_SITE_USD × sites` floor for every org there is. This file
   * measures something deliberately harsher — the bundle at 100% of every band
   * at once, with the two CRM terms the cost model has no meter for — so the
   * two numbers are not comparable and neither one is the other's threshold.
   *
   * Stated here as an assertion rather than left to a reader's assumption,
   * because "we hold a 75% margin" and "no tier is under water at 100% of its
   * bands" are two different promises and only the second is what a ceiling
   * can be asked to keep.
   */
  it('clears the 75% contribution floor at the utilizations the floor is read at', () => {
    // At the per-site floor — which is what every production org's COGS
    // actually is — every tier clears 75% on both intervals.
    expect(tiersUnderFloor(PAID, 0.03, NET_MARGIN_FLOOR_PCT, 'year')).toEqual([])
    expect(tiersUnderFloor(PAID, 0.03, NET_MARGIN_FLOOR_PCT, 'month')).toEqual([])
    // At 100% of every band it does NOT, on either interval, and that is not
    // a regression: a ceiling nobody expects is where a price has to survive,
    // not where it has to be comfortable. The rule at 100% is zero.
    expect(tiersUnderFloor(PAID, 1, NET_MARGIN_FLOOR_PCT, 'year').sort()).toEqual(
      [...PAID].sort(),
    )
    expect(tiersUnderFloor(PAID, 1, NET_MARGIN_FLOOR_PCT, 'month').sort()).toEqual(
      [...PAID].sort(),
    )
    // The warn band, so the two constants are read rather than restated.
    expect(NET_MARGIN_FLOOR_PCT).toBe(0.75)
    expect(NET_MARGIN_WARN_BAND_PCT).toBe(0.1)
  })

  /**
   * THE REALISTIC BAND, where the annual ladder stands comfortably.
   *
   * 25% of every band at once is the utilization the 2026-09-07 resize was
   * argued on. Every tier clears 70% there on both intervals, and the rungs
   * sit within two points of each other — the ladder is
   * deliberately flat here, because the bands were each cut to what their own
   * price carries rather than to a common ratio.
   */
  it('clears 70% on every tier at the realistic 25% band, on both intervals', () => {
    expect(tiersUnderFloor(PAID, 0.25, 0.7, 'year')).toEqual([])
    expect(tiersUnderFloor(PAID, 0.25, 0.7, 'month')).toEqual([])
    // CONTROL: a floor inside the half point the ladder occupies splits it,
    // so the green above is a measurement rather than a detector stuck on
    // "nothing".
    expect(tiersUnderFloor(PAID, 0.25, 0.72, 'year')).toEqual([])
    expect(tiersUnderFloor(PAID, 0.25, 0.73, 'year').sort()).toEqual([
      'advanced',
      'agency',
      'starter',
    ])
  })

  /**
   * THE BAND THE LADDER ACTUALLY OCCUPIES.
   *
   * Every rung sits between 0.1% and 7.3% at the annual price — each band
   * is the largest multiple of 5 GB that the price carries once every
   * included gigabyte is priced at Vercel's dearest region, and no smaller,
   * because every gigabyte cut is capacity the customer no longer has. Pro
   * keeps more room only because 5 GB is a coarse step on a small band. The
   * headroom is thin by construction and the exact figures above are what
   * hold it; the next 5 GB on any rung takes it under.
   */
  it('runs from 0.1% to 7.3% at 100% annual, and is wider monthly', () => {
    // The annual ladder, as an ordered floor sweep rather than six literals:
    // every tier clears zero, Agency is the thinnest rung and Pro the widest.
    expect(tiersUnderFloor(PAID, 1, 0, 'year')).toEqual([])
    expect(tiersUnderFloor(PAID, 1, 0.001, 'year')).toEqual([])
    expect(tiersUnderFloor(PAID, 1, 0.002, 'year')).toEqual(['agency'])
    expect(tiersUnderFloor(PAID, 1, 0.003, 'year').sort()).toEqual(['agency', 'starter'])
    expect(tiersUnderFloor(PAID, 1, 0.005, 'year').sort()).toEqual(['advanced', 'agency', 'starter'])
    expect(tiersUnderFloor(PAID, 1, 0.02, 'year').sort()).toEqual(
      ['advanced', 'agency', 'scale', 'starter'].sort(),
    )
    expect(tiersUnderFloor(PAID, 1, 0.03, 'year').sort()).toEqual(
      ['advanced', 'agency', 'business', 'scale', 'starter'].sort(),
    )
    expect(tiersUnderFloor(PAID, 1, 0.08, 'year').sort()).toEqual([...PAID].sort())
    // …and the next 5 GB on any rung is under water, which is what makes each
    // band the largest that holds rather than merely one that does.
    for (const plan of PAID) {
      expect(
        `${plan}: ${marginAtBandwidth(plan, PLAN_ENTITLEMENTS[plan].bandwidthGb + 5, 'year') < 0}`,
      ).toBe(`${plan}: true`)
    }
    // The monthly ladder clears by eighteen points or more, with Agency the
    // thinnest rung there because its bands are the largest.
    expect(tiersUnderFloor(PAID, 1, 0.18, 'month')).toEqual([])
    expect(tiersUnderFloor(PAID, 1, 0.2, 'month')).toEqual(['agency'])
  })

  it('CONTROL: the floor is not so low that nothing could fail it', () => {
    // A floor of 0 is only meaningful if the model can produce a negative.
    // Advanced at twice its bands is the demonstration.
    expect(tierMargin('advanced', 2)).toBeLessThan(0)
    expect(tiersUnderFloor(PAID, 2, 0)).not.toEqual([])
  })

  /**
   * MUTATION. Restore the bands the page carried until 2026-09-07, one tier
   * at a time, and the rule must break — this is what says the green above
   * came from the numbers and not from the arithmetic being broken in the
   * permissive direction.
   *
   * Every figure is pinned. These are the numbers the decision was made on —
   * in the model as it stood then, which priced a gigabyte at its weight
   * alone — and a mutation that "goes negative" by a different amount than
   * it did then is a model that changed under the decision.
   */
  it('MUTATION: at the bands sold until 2026-09-07, every tier from Pro up was under water at the annual price', () => {
    const before = { pro: 225, business: 400, scale: 700, advanced: 1000, agency: 3000 } as const
    /**
     * The model the 2026-09-07 decision was made in: weight at the cheapest
     * region, no requests.
     */
    const weightOnly = (plan: OrgPlan, gb: number, interval: Interval) =>
      marginAtCostPerGb(plan, CHEAPEST_WEIGHT_PER_GB_USD, interval, gb, 0)
    const was = Object.fromEntries(
      Object.entries(before).map(([plan, gb]) => [
        plan,
        Number((weightOnly(plan as OrgPlan, gb, 'year') * 100).toFixed(1)),
      ]),
    )
    // (Recorded as -40.1 / -34.6 / -36.3 / -34.4 / -20.7 on the day; the
    // 2026-10-01 re-price of the submission, run and API rates, and of the
    // reads inside the weight, moved the figures since, which is the drift
    // this pin exists to show.)
    expect(was).toEqual({
      pro: -51.8,
      business: -43.8,
      scale: -46.7,
      advanced: -45.2,
      agency: -29.5,
    })
    // …and at the MONTHLY price the same five bands now leave between -9.6%
    // and -3.4% (they left -1.5% to +3.1% on the day), which is a ladder that
    // does not pay for itself on either interval. The guard that stood here
    // originally read +10.0 … +6.7% on all five, because it counted neither
    // Stripe's fee, nor the two CRM terms, nor the runs.
    expect(
      Object.fromEntries(
        Object.entries(before).map(([plan, gb]) => [
          plan,
          Number((weightOnly(plan as OrgPlan, gb, 'month') * 100).toFixed(1)),
        ]),
      ),
    ).toEqual({ pro: -7.1, business: -3.4, scale: -6.4, advanced: -9.6, agency: -5.1 })
    // At Vercel's dearest region those bands are not close: every one of
    // them is more than 100 points under water on BOTH intervals.
    expect(
      Object.fromEntries(
        Object.entries(before).map(([plan, gb]) => [
          plan,
          [
            Number((marginAtBandwidth(plan as OrgPlan, gb, 'month') * 100).toFixed(1)),
            Number((marginAtBandwidth(plan as OrgPlan, gb, 'year') * 100).toFixed(1)),
          ],
        ]),
      ),
    ).toEqual({
      pro: [-187.8, -311.3],
      business: [-132.9, -225.5],
      scale: [-132.8, -222.6],
      advanced: [-122.4, -195.7],
      agency: [-109, -158.1],
    })
    // BOTH WAYS, on the one axis that moved: the shipped band is strictly
    // better than the restored one on BOTH intervals, on every tier, and
    // clears zero where the restored one does not.
    for (const plan of Object.keys(before) as Array<keyof typeof before>) {
      for (const interval of ['month', 'year'] as const) {
        expect(
          `${plan} ${interval}: ${tierMargin(plan, 1, interval) > marginAtBandwidth(plan, before[plan], interval)}`,
        ).toBe(`${plan} ${interval}: true`)
        expect(`${plan} ${interval}: ${tierMargin(plan, 1, interval) >= 0}`).toBe(
          `${plan} ${interval}: true`,
        )
      }
      expect(PLAN_ENTITLEMENTS[plan].bandwidthGb).toBeLessThan(before[plan])
    }
    // CONTROL: at the shipped band the instrument reads exactly what the
    // model does, on every tier — so the figures above are the bands moving
    // and nothing else.
    for (const plan of PAID) {
      expect(marginAtBandwidth(plan, PLAN_ENTITLEMENTS[plan].bandwidthGb, 'year')).toBeCloseTo(
        tierMargin(plan, 1, 'year'),
        12,
      )
    }
  })

  /**
   * MUTATION: THE BANDS SOLD UNTIL 2026-10-01, AND THE TWO RE-SIZES OF THAT
   * DAY, ACROSS VERCEL'S PRICE RANGE (AGL-3444).
   *
   * The bands sold until 2026-10-01 were sized on weight alone at the
   * cheapest region. At today's model they are under water at the annual
   * price even inside the request allowance, and at the dearest region on
   * both intervals on every tier.
   *
   * The two re-sizes of the same day (`41a851aca9`, then `e1a6d2be3d`) never
   * reached production. The first priced the requests at the dearest region
   * and the transfer at the cheapest; the second priced both at the dearest
   * but transfer by a binary GB, reads at the single-region price and no API
   * request as a function. At today's model every band either of them moved
   * is under water at the annual price, which is what the third cut answers.
   *
   * Pinned at each price, so the cut the shipped bands made is read against
   * the state it answered rather than asserted.
   */
  it('MUTATION: at the bands sold until 2026-10-01, and at both re-sizes of that day, every moved band is under water at the dearest region', () => {
    const sold = {
      starter: 50,
      pro: 125,
      business: 185,
      scale: 290,
      advanced: 345,
      agency: 1540,
    } as const
    const firstResize = {
      starter: 35,
      pro: 60,
      business: 90,
      scale: 145,
      advanced: 175,
      agency: 790,
    } as const
    const secondResize = {
      starter: 20,
      pro: 35,
      business: 55,
      scale: 90,
      advanced: 105,
      agency: 485,
    } as const
    const ladderAt = (
      bands: Record<string, number>,
      weightPerGbUsd: number,
      requestsPerGbUsd: number,
    ) =>
      Object.fromEntries(
        Object.entries(bands).map(([plan, gb]) => [
          plan,
          [
            Number(
              (marginAtCostPerGb(plan as OrgPlan, weightPerGbUsd, 'month', gb, requestsPerGbUsd) * 100).toFixed(1),
            ),
            Number(
              (marginAtCostPerGb(plan as OrgPlan, weightPerGbUsd, 'year', gb, requestsPerGbUsd) * 100).toFixed(1),
            ),
          ],
        ]),
      )
    // Inside the allowance, at the cheapest region's transfer: under water
    // annually on every tier but Starter.
    expect(ladderAt(sold, CHEAPEST_WEIGHT_PER_GB_USD, 0)).toEqual({
      starter: [47.5, 21.3],
      pro: [26.4, -3.8],
      business: [25.6, -3.1],
      scale: [24.5, -3.8],
      advanced: [21.1, -4.2],
      agency: [15.9, -3.4],
    })
    // Past it at the cheapest region.
    expect(
      ladderAt(sold, CHEAPEST_WEIGHT_PER_GB_USD, CHEAPEST_REQUEST_COST_PER_GB_USD),
    ).toEqual({
      starter: [19.6, -22.3],
      pro: [-4.8, -48.5],
      business: [7, -29.2],
      scale: [8.2, -26.4],
      advanced: [9, -20.3],
      agency: [-0.6, -23.9],
    })
    // …and at the dearest, which is the price the rule is held at.
    expect(ladderAt(sold, COST_PER_GB_USD, REQUEST_COST_PER_GB_USD)).toEqual({
      starter: [-42.4, -119.2],
      pro: [-74, -147.9],
      business: [-34.3, -87.1],
      scale: [-27.9, -76.6],
      advanced: [-17.8, -56.1],
      agency: [-37.4, -69.4],
    })
    // The first re-size, at the dearest region.
    expect(ladderAt(firstResize, COST_PER_GB_USD, REQUEST_COST_PER_GB_USD)).toEqual({
      starter: [-4.2, -59.5],
      pro: [-0.1, -41.7],
      business: [9.2, -26],
      scale: [9.2, -25],
      advanced: [9.4, -19.9],
      agency: [-0.6, -23.9],
    })
    // The second, at the dearest region: Starter's 20 GB did not move again
    // and still clears; every band that did move is under water.
    expect(ladderAt(secondResize, COST_PER_GB_USD, REQUEST_COST_PER_GB_USD)).toEqual({
      starter: [34, 0.2],
      pro: [28.4, -0.9],
      business: [25.3, -3.5],
      scale: [23.3, -5.5],
      advanced: [20.5, -5],
      agency: [14.3, -5.4],
    })
    // BOTH WAYS: every shipped band is at or below both re-sizes, below the
    // band sold, and clears zero on both intervals.
    for (const plan of PAID) {
      expect(PLAN_ENTITLEMENTS[plan].bandwidthGb).toBeLessThanOrEqual(secondResize[plan])
      expect(secondResize[plan]).toBeLessThan(firstResize[plan])
      expect(firstResize[plan]).toBeLessThan(sold[plan])
      expect(marginAtBandwidth(plan, firstResize[plan], 'year')).toBeLessThan(0)
      for (const interval of ['month', 'year'] as const) {
        expect(`${plan} ${interval}: ${tierMargin(plan, 1, interval) >= 0}`).toBe(
          `${plan} ${interval}: true`,
        )
      }
    }
  })

  it('MUTATION: restoring ONE band on ONE tier is enough to break it', () => {
    // The single-axis version, because a mutation that changes four things at
    // once can pass for the wrong reason. Advanced's contacts band alone —
    // 1,000,000 at $0.0002 is $200 against a $299 annual price.
    const restored =
      measuredCostUsd('advanced') -
      tierCostTerms('advanced').contacts +
      1_000_000 * ORG_COGS_UNIT_RATES_USD.perContactMonth
    expect((netPriceUsd('advanced', 'month') - restored) / listPriceUsd('advanced', 'month')).toBeLessThan(0)
    expect((netPriceUsd('advanced', 'year') - restored) / listPriceUsd('advanced', 'year')).toBeLessThan(0)
    // …and with the shipped band it is positive on both. Both directions on
    // one axis, on both intervals.
    expect(tierMargin('advanced', 1, 'month')).toBeGreaterThan(0)
    expect(tierMargin('advanced', 1, 'year')).toBeGreaterThan(0)
  })

  /**
   * MUTATION: THE UNPAIRED CONSTANTS (AGL-2712).
   *
   * The state the platform was in for part of 2026-09-09, modeled as a cost
   * per gigabyte because that is the only place the disagreement shows up:
   * `perPageView` priced a 1012.8 KB page while the conversion still divided
   * a gigabyte by 600 KB, so the page's weight was counted twice — a
   * gigabyte billed $0.28231 of modeled cost instead of $0.16724 then, and
   * the same shape at today's rate is $0.69735 instead of $0.41312.
   *
   * Pinned as exact figures, at the shipped bands and today's rate with the
   * request term counted, because it is the shape of the defect: a model that doubles a
   * page's weight reads a ladder under water that is not, and the figures
   * make the state recognizable if anything re-enters it.
   */
  it('MUTATION: the unpaired constants put every paid tier under water annually', () => {
    const UNPAIRED_COST_PER_GB =
      (1024 * 1024 * 1024 / (600 * 1024)) * ORG_COGS_UNIT_RATES_USD.perPageView
    expect(UNPAIRED_COST_PER_GB).toBeCloseTo(0.69735, 5)
    expect(UNPAIRED_COST_PER_GB / COST_PER_GB_USD).toBeCloseTo(1.688, 3)
    // The figure it billed on the day, at the rate then in force.
    expect((1024 * 1024 * 1024 / (600 * 1024)) * 0.00016153846).toBeCloseTo(0.28231, 5)
    expect(
      Object.fromEntries(
        PAID.map((plan) => [
          plan,
          [
            Number((marginAtCostPerGb(plan, UNPAIRED_COST_PER_GB, 'month') * 100).toFixed(1)),
            Number((marginAtCostPerGb(plan, UNPAIRED_COST_PER_GB, 'year') * 100).toFixed(1)),
          ],
        ]),
      ),
    ).toEqual({
      starter: [11.3, -35.3],
      pro: [18.8, -14.6],
      business: [20.7, -10],
      scale: [20.4, -9.5],
      advanced: [18.8, -7.3],
      agency: [10.1, -10.6],
    })
    // BOTH WAYS: with the pairing restored the same instrument reads the
    // shipped ladder, so the mutation is the constants and not the arithmetic.
    for (const plan of PAID) {
      expect(marginAtCostPerGb(plan, COST_PER_GB_USD, 'year')).toBeCloseTo(
        tierMargin(plan, 1, 'year'),
        12,
      )
    }
  })

  /**
   * ACROSS THE CDN'S PRICE RANGE, AT THE SHIPPED BANDS (AGL-3444).
   *
   * The shipped model prices an included gigabyte's transfer and requests at
   * the dearest region, because the rule is stated at any utilization and a
   * band cannot choose where its visitors are. Inside the hosting plan's
   * request allowance, or at the cheapest region, the same band costs less,
   * so every reading below is at least the shipped one — pinned so the room
   * the dearest-region sizing leaves elsewhere is a figure here rather than a
   * re-derivation.
   */
  it('ACROSS THE PRICE RANGE: the shipped bands clear zero at the dearest region and by more everywhere else', () => {
    const ladderAt = (weightPerGbUsd: number, requestsPerGbUsd: number) =>
      Object.fromEntries(
        PAID.map((plan) => [
          plan,
          [
            Number(
              (marginAtCostPerGb(plan, weightPerGbUsd, 'month', undefined, requestsPerGbUsd) * 100).toFixed(1),
            ),
            Number(
              (marginAtCostPerGb(plan, weightPerGbUsd, 'year', undefined, requestsPerGbUsd) * 100).toFixed(1),
            ),
          ],
        ]),
      )
    // The cheapest region, inside the request allowance: weight alone.
    expect(ladderAt(CHEAPEST_WEIGHT_PER_GB_USD, 0)).toEqual({
      starter: [70, 56.5],
      pro: [58.2, 41.9],
      business: [44.4, 23.4],
      scale: [41, 19.2],
      advanced: [33.6, 12.4],
      agency: [32.4, 17],
    })
    // The cheapest region, past the allowance.
    expect(ladderAt(CHEAPEST_WEIGHT_PER_GB_USD, CHEAPEST_REQUEST_COST_PER_GB_USD)).toEqual(
      {
      starter: [58.8, 39],
      pro: [50.7, 31.1],
      business: [39.9, 17.1],
      scale: [37.1, 13.8],
      advanced: [30.8, 8.7],
      agency: [28.2, 11.8],
    },
    )
    // …and the dearest, past the allowance, which IS the shipped model.
    expect(ladderAt(COST_PER_GB_USD, REQUEST_COST_PER_GB_USD)).toEqual(
      Object.fromEntries(PAID.map((plan) => [plan, [pct(plan, 1, 'month'), pct(plan, 1, 'year')]])),
    )
    for (const plan of PAID) {
      expect(
        `${plan}: ${marginAtCostPerGb(plan, CHEAPEST_WEIGHT_PER_GB_USD, 'year', undefined, CHEAPEST_REQUEST_COST_PER_GB_USD) > tierMargin(plan, 1, 'year')}`,
      ).toBe(`${plan}: true`)
    }
  })

  /**
   * PRO, ONE AXIS AT A TIME.
   *
   * The decomposition is pinned as numbers so a change that moved several of
   * Pro's bands at once cannot read as this one, which moved bandwidth and
   * nothing else.
   */
  it('spends 55% of Pro on bandwidth — weight and requests — and the rest on ten small terms', () => {
    const terms = tierCostTerms('pro')
    expect(
      Object.fromEntries(
        Object.entries(terms).map(([term, cost]) => [
          term,
          Number(cost.toFixed(4)),
        ]),
      ),
    ).toEqual({
      mediaStorage: 0.78,
      formSubmissions: 0.1846,
      bandwidth: 12.3937,
      datasetStorage: 0.9,
      apiRequests: 0,
      contacts: 2,
      emailSends: 4.5,
      assistCredits: 2.75,
      runs: 0.13,
      crmSeats: 0.6,
      crmEmail: 4.05,
      cdnRequests: 6.72,
    })
    // The ten others total $15.89 against a $37.84 net annual price — the
    // submission and run terms moved four cents with the dearest-region
    // re-price. The band is the axis that moves, and it costs twice: $12.39 of
    // weight and $6.72 of requests, 55% of the tier's cost together. Nothing
    // but this axis can decide the tier.
    const total = Object.values(terms).reduce((a, b) => a + b, 0)
    const traffic = terms.bandwidth + terms.cdnRequests
    expect(total - traffic).toBeCloseTo(15.89, 2)
    expect(traffic / total).toBeGreaterThan(0.54)
    expect(traffic / total).toBeLessThan(0.55)
    // The axis, read back through the rates that set it, so neither term can
    // drift from the constant it is a product of.
    expect(terms.bandwidth).toBeCloseTo(
      PLAN_ENTITLEMENTS.pro.bandwidthGb *
        VIEWS_PER_GB *
        ORG_COGS_UNIT_RATES_USD.perPageView,
      10,
    )
    expect(terms.cdnRequests).toBeCloseTo(
      PLAN_ENTITLEMENTS.pro.bandwidthGb * VIEWS_PER_GB * PAGE_VIEW_CDN_REQUEST_COST_USD,
      10,
    )
  })

  it('MUTATION: Pro at its OLD 7,500-credit assist band is deeper under water', () => {
    // The assist axis on its own. $7.50 of provider spend on a tier whose
    // annual price has $2.83 of room at 100% of every band.
    const terms = tierCostTerms('pro')
    const restored =
      Object.values(terms).reduce((a, b) => a + b, 0) -
      terms.assistCredits +
      7_500 * ASSIST_CREDIT_COST_USD
    expect(listPriceUsd('pro', 'year')).toBe(39)
    expect((netPriceUsd('pro', 'year') - restored) / 39).toBeCloseTo(-0.049, 3)
    // BOTH DIRECTIONS, on the one tier and the one interval where the sign
    // turns: the extra 4,750 credits are $4.75 of provider spend against
    // $2.83 of annual room, and Pro's shipped band leaves it positive.
    expect(tierMargin('pro', 1, 'year')).toBeGreaterThan(0)
    // The monthly price absorbs the same restoration — $19.07 of room at 100%
    // — which is why the sign test is read at the annual price and not here.
    expect(
      (netPriceUsd('pro', 'month') - restored) / listPriceUsd('pro', 'month'),
    ).toBeGreaterThan(0)
    // Scale and Advanced go the same way on the same axis, but their monthly
    // room is wider than their old bands cost, so a sign test there would
    // assert nothing. What holds on every tier is the ARITHMETIC: restoring
    // the band costs exactly the credit delta, and moves the margin by
    // exactly that over the price. A model that had stopped reading the band
    // fails this where a sign test would have passed.
    for (const [plan, oldBand] of [
      ['scale', 32_000],
      ['advanced', 52_000],
    ] as const) {
      const was =
        measuredCostUsd(plan) -
        tierCostTerms(plan).assistCredits +
        oldBand * ASSIST_CREDIT_COST_USD
      const restoredMargin =
        (netPriceUsd(plan, 'month') - was) / listPriceUsd(plan, 'month')
      expect(restoredMargin).toBeLessThan(tierMargin(plan, 1, 'month'))
      expect(tierMargin(plan, 1, 'month') - restoredMargin).toBeCloseTo(
        ((oldBand - PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth) *
          ASSIST_CREDIT_COST_USD) /
          listPriceUsd(plan, 'month'),
        12,
      )
      // …and at the annual price both bands are under water, which is the
      // shortfall the file docblock names rather than anything this axis did.
      expect(`${plan} was negative: ${(netPriceUsd(plan, 'year') - was) / listPriceUsd(plan, 'year') < 0}`).toBe(
        `${plan} was negative: true`,
      )
    }
  })

  it('governs what Pro sells past every band it bounds', () => {
    // A finite band with no rate is silently free past the band, so shrinking
    // one is half a change on its own. Bandwidth rides the infrastructure
    // pass-through; contacts and email sends carry retail rates. Asserted as
    // pairs, because each half is only correct with the other.
    expect(PLAN_PRICING.pro.meteredInfraPassThrough).toBe(true)
    // A billed view costs its weight AND its CDN requests, and is billed at
    // that cost x the markup.
    expect(METERED_OVERAGE_COST_USD.perPageView).toBe(
      METERED_UNIT_RATES_USD.perPageView + PAGE_VIEW_CDN_REQUEST_COST_USD,
    )
    expect(METERED_BILLED_RATES_USD.perPageView).toBe(
      METERED_OVERAGE_COST_USD.perPageView * METERED_MARKUP,
    )
    expect(METERED_BILLED_RATES_USD.perPageView).toBeGreaterThan(0)
    // The line where the pass-through starts billing IS the band, read from
    // the entitlement — so a smaller band moves the meter with it rather than
    // leaving a give the customer no longer has.
    const allowance = meteredIncludedAllowance({ plan: 'pro' } as never)
    expect(allowance.metered).toBe(true)
    expect(allowance.pageViews).toBeCloseTo(
      PLAN_ENTITLEMENTS.pro.bandwidthGb * VIEWS_PER_GB,
      3,
    )
    expect(Number.isFinite(PLAN_ENTITLEMENTS.pro.contactsPerHost)).toBe(true)
    expect(PLAN_PRICING.pro.extraContactsUsdPer1k).toBe(0.75)
    expect(Number.isFinite(PLAN_ENTITLEMENTS.pro.emailSendsPerMonth)).toBe(true)
    expect(PLAN_PRICING.pro.extraEmailSendsUsdPer1k).toBe(2.25)
    // …and contacts METER rather than wall, which is what makes a bounded
    // band safe on this tier: the rate is what flips `allowed` past it.
    const past = checkContactQuota(
      { plan: 'pro', subscription: { status: 'active' } } as never,
      PLAN_ENTITLEMENTS.pro.contactsPerHost + 2_000,
    )
    expect(past.allowed).toBe(true)
    expect(past.overageRecords).toBe(2_000)
    expect(past.overageMonthlyUsd).toBe(1.5)
  })

  /**
   * STARTER, AXIS BY AXIS, and the arithmetic is here rather than asserted
   * by absence. Its bands imply $15.47 against a $16 annual price — 0.2%,
   * among the thinnest rungs on the ladder — and bandwidth is 82% of that:
   * $8.26 of weight and $4.48 of requests at Vercel's dearest region.
   *
   * Its band is cut the way every other rung's is: 20 GB is the largest
   * multiple of 5 GB the annual price carries, and 20.06 GB is all it
   * carries. At 50 GB, the band it carried until 2026-10-01, the same price
   * is 119% under water.
   *
   * ⚠ It is NO LONGER the zero-assist control. AGL-3203 gave Starter 750
   * credits, so the assist term is $0.75 here and the "term present and
   * ZERO" reading moved to campaign email, which Starter still bands at 0.
   * That reading has to live SOMEWHERE — a term that vanishes instead of
   * reading zero drops cost by arithmetic rather than by entitlement — and
   * email is where it lives now.
   */
  it('says what each of Starter\'s bands costs', () => {
    expect(listPriceUsd('starter', 'month')).toBe(25)
    expect(listPriceUsd('starter', 'year')).toBe(16)
    expect(tierCostUsd('starter', 1)).toBeCloseTo(15.47, 2)
    // The metered axes alone are $9.46 — $8.26 of which is bandwidth's
    // weight — plus the 750 assist credits at 75¢ and the 500 runs it sells,
    // 0.65¢; the requests are $4.48 and the CRM decision terms the $1.53 on
    // top.
    expect(Object.values(bandCostTerms('starter')).reduce((a, b) => a + b, 0)).toBeCloseTo(9.46, 2)
    expect(bandCostTerms('starter').bandwidth).toBeCloseTo(8.26, 2)
    expect(cdnRequestTerms('starter').cdnRequests).toBeCloseTo(4.48, 2)
    expect(PLAN_ENTITLEMENTS.starter.bandwidthGb).toBe(20)
    expect(marginAtBandwidth('starter', 50, 'year')).toBeCloseTo(-1.192, 3)
    // The assist term is REAL here since AGL-3203, and it is the whole of
    // what the decision cost this tier: 750 credits, 75¢, and the rung still
    // clears zero with it counted.
    expect(Object.keys(tierCostTerms('starter'))).toContain('assistCredits')
    expect(tierCostTerms('starter').assistCredits).toBeCloseTo(0.75, 2)
    expect(PLAN_ENTITLEMENTS.starter.assistCreditsPerMonth).toBe(750)
    // The guided rung starts HERE since AGL-3207, and the cost above is
    // why opening it moved nothing: the assist term is already the full 750
    // credits at 75¢, so the door makes modeled spend reachable rather than
    // adding any.
    expect(PLAN_ENTITLEMENTS.starter.features.aiAssist).toBe(true)
    // The email axis, read the same way and for the same reason. Campaign
    // email begins at Pro, so the term is present and ZERO rather than
    // absent — a missing term would drop cost by arithmetic instead of by
    // entitlement, and every margin below would read the same either way.
    expect(Object.keys(tierCostTerms('starter'))).toContain('emailSends')
    expect(tierCostTerms('starter').emailSends).toBe(0)
    expect(PLAN_ENTITLEMENTS.starter.emailSendsPerMonth).toBe(0)
    // Doubling a gigabyte's weight is the move this ladder is thin against.
    // It takes the ANNUAL ladder under water on every tier and leaves the
    // monthly one clear — which is the size of the headroom the bands
    // actually leave, stated as a stress test rather than as a margin.
    const atDoubleCost = (plan: OrgPlan, interval: Interval) =>
      marginAtCostPerGb(plan, COST_PER_GB_USD * 2, interval)
    expect(
      Object.fromEntries(
        PAID.map((plan) => [
          plan,
          `${atDoubleCost(plan, 'month') < 0 ? 'monthly under' : 'monthly clear'}, ` +
            `${atDoubleCost(plan, 'year') < 0 ? 'annual under' : 'annual clear'}`,
        ]),
      ),
    ).toEqual({
      starter: 'monthly clear, annual under',
      pro: 'monthly clear, annual under',
      business: 'monthly clear, annual under',
      scale: 'monthly clear, annual under',
      advanced: 'monthly clear, annual under',
      agency: 'monthly clear, annual under',
    })
    // …and it is the doubling doing that, not the shipped pair: at the shipped
    // cost per gigabyte both ladders clear on every tier.
    expect(tiersUnderFloor(PAID, 1, 0, 'month')).toEqual([])
    expect(tiersUnderFloor(PAID, 1, 0, 'year')).toEqual([])
  })

  /**
   * THE ASSIST BANDS, pinned as numbers and bounded as a share.
   *
   * They were sized on 2026-08-30 to take between a quarter and a third of
   * what the other metered terms left of the MONTHLY price. The bandwidth
   * resizes widened that room on every tier without touching the bands, so
   * the quarter floor no longer describes the ladder — Pro's band is 7% of
   * its room — and the numbers below are what holds the bands
   * from being shrunk the next time a cost rate moves. The third stays as
   * the ceiling: an assist band that consumed more than a third of the room
   * would put the tier back where Pro was at 7,500 credits.
   */
  it('keeps every assist band inside a third of the room the other metered terms leave', () => {
    for (const plan of PAID) {
      const terms = bandCostTerms(plan)
      const price = listPriceUsd(plan, 'month')
      const room =
        price -
        (Object.values(terms).reduce((a, b) => a + b, 0) - terms.assistCredits)
      const band = PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth
      // Every paid plan sells an assist band since AGL-3203, so the null
      // branch no longer fires on any shipped row. It is kept because it is
      // the rule's guard, not a Starter special case: a band of zero is "not
      // sold" and must not be measured against a share of a remainder it
      // never spends.
      const share = band === 0 ? null : (band * ASSIST_CREDIT_COST_USD) / room
      expect(
        `${plan}: ${share === null ? 'none' : share > 0 && share <= 1 / 3}`,
      ).toBe(`${plan}: ${share === null ? 'none' : true}`)
    }
    // The bands themselves, as numbers — a rule alone would be satisfied by a
    // ladder that had been rewritten wholesale.
    expect(
      Object.fromEntries(
        PAID.map((plan) => [
          plan,
          PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth,
        ]),
      ),
    ).toEqual({
      starter: 750,
      pro: 2_750,
      business: 7_500,
      scale: 10_000,
      advanced: 13_000,
      agency: 58_000,
    })
    // And it still RISES with the tier. A rule expressed in a remainder can
    // in principle invert the ladder, so the ordering is asserted, not
    // assumed.
    const bands = PAID.map(
      (plan) => PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth,
    )
    expect(bands).toEqual([...bands].sort((a, b) => a - b))
  })

  it('Agency clears zero on both intervals, on the bandwidth axis', () => {
    const cost = tierCostUsd('agency', 1)
    expect(cost).toBeCloseTo(1017.45, 2)
    expect(listPriceUsd('agency', 'year')).toBe(1049)
    expect(netPriceUsd('agency', 'year')).toBe(1018.55)
    // 395 GB at $0.63712 a gigabyte all in is $251.66 of the cost — $163.18
    // of weight and $88.48 of requests — and leaves $1.10 clear annually:
    // the next 5 GB, $3.19, would not fit.
    expect(netPriceUsd('agency', 'year') - cost).toBeCloseTo(1.1, 2)
    expect(5 * ALL_IN_COST_PER_GB_USD).toBeGreaterThan(netPriceUsd('agency', 'year') - cost)
    expect(netPriceUsd('agency', 'month') - cost).toBeGreaterThan(0)
    // At the old $649 annual price ($630.15 net) the same cost is a $387
    // loss per month; at the 3,000 GB band it carried until 2026-09-07 it is
    // $2,047, and the real figure before the form band was bounded was
    // unbounded.
    const terms = tierCostTerms('agency')
    expect(netOfProcessorFee(649, true) - cost).toBeLessThan(-380)
    expect(
      netOfProcessorFee(649, true) -
        (cost - terms.bandwidth - terms.cdnRequests + 3000 * ALL_IN_COST_PER_GB_USD),
    ).toBeLessThan(-2_040)
  })
})

// ---------------------------------------------------------------------------
// The rule that would have made the Agency defect visible.
// ---------------------------------------------------------------------------
describe('an unbounded band FAILS the model rather than scoring zero', () => {
  it('reports an uncapped term by name instead of dropping it', () => {
    // The instrument, exercised on a synthetic tier before any real one is
    // judged. `UNLIMITED` must reach the total as `Infinity`.
    expect(Number.isFinite(UNLIMITED * ORG_COGS_UNIT_RATES_USD.perFormSubmission)).toBe(
      false,
    )
    expect(0 * UNLIMITED).toBeNaN()
  })

  /**
   * NO SELF-SERVE TIER HAS AN UNCAPPED COST TERM ANY MORE.
   *
   * Agency's `contactsPerHost` was the last one, and bounding it required
   * moving `extraContactsUsdPer1k` off `null` in the same change: the paired
   * rule is that a finite band with no rate is usage past a bound that is
   * silently free, so the bound achieves nothing. The two are asserted
   * together below because they are only correct together.
   *
   * ENTERPRISE IS NOT A SELF-SERVE TIER and is not scanned here; since
   * 2026-09-07 its every band is a FINITE fallback (twice Agency's), and the
   * case at the bottom of this block records what bounding it means.
   */
  const UNBOUNDED_BY_DECISION: Record<string, string[]> = {}

  it('has no uncapped cost term left on any self-serve tier', () => {
    const found = Object.fromEntries(
      PAID.map((plan) => [plan, unboundedTerms(plan)]).filter(
        ([, terms]) => (terms as string[]).length > 0,
      ),
    )
    expect(found).toEqual(UNBOUNDED_BY_DECISION)
  })

  it('bounding the last one brought its rate with it', () => {
    // Both halves. A finite band with a null rate is silently free past the
    // bound; a rate on an uncapped band advertises a fee that cannot be
    // charged, because `Math.max(0, used - Infinity)` is 0 at every level.
    expect(Number.isFinite(PLAN_ENTITLEMENTS.agency.contactsPerHost)).toBe(true)
    expect(PLAN_PRICING.agency.extraContactsUsdPer1k).toBe(0.4)
    // …and it METERS rather than walls, which is what makes bounding it safe.
    // A rate is exactly what flips `allowed` past the band.
    const past = checkContactQuota(
      { plan: 'agency', subscription: { status: 'active' } } as never,
      PLAN_ENTITLEMENTS.agency.contactsPerHost + 1_000,
    )
    expect(past.allowed).toBe(true)
    expect(past.overageRecords).toBe(1_000)
    expect(past.overageMonthlyUsd).toBe(0.4)
  })

  it('ENTERPRISE is bounded at twice Agency\'s band, and the bound WALLS rather than meters', () => {
    // The 2026-09-07 decision, and its consequence stated out loud. Every
    // Enterprise rate is the "not for sale" sentinel, so `checkContactQuota`
    // has no rate to flip `allowed` past the band: the fallback is a CAP, and
    // at 1,000,000 records an org that reaches it with no contracted figure
    // is refused the next one — `upsert-contact.ts` drops the record and
    // counts it in `contactsDropped`. That is deliberate and it is what the
    // per-org override exists for: a deal that holds more than a million
    // records is a deal whose agreement has said so. If somebody gives
    // enterprise a contacts rate, this goes red and the decision gets made
    // again, deliberately.
    expect(PLAN_ENTITLEMENTS.enterprise.contactsPerHost).toBe(
      PLAN_ENTITLEMENTS.agency.contactsPerHost * 2,
    )
    expect(PLAN_ENTITLEMENTS.enterprise.contactsPerHost).toBe(1_000_000)
    expect(PLAN_PRICING.enterprise.extraContactsUsdPer1k).toBeNull()
    const atTheLine = checkContactQuota({ plan: 'enterprise' } as never, 1_000_000)
    expect(atTheLine.allowed).toBe(false)
    expect(atTheLine.overageRateUsd).toBeNull()
    expect(checkContactQuota({ plan: 'enterprise' } as never, 999_999).allowed).toBe(true)
    // …and the contracted figure wins, which is the half that makes a
    // fallback safe to hold.
    expect(
      checkContactQuota(
        { plan: 'enterprise', entitlements: { contactsPerHost: 5_000_000 } } as never,
        1_000_000,
      ).allowed,
    ).toBe(true)
  })

  it('BOTH WAYS: every OTHER band on every paid tier is finite', () => {
    // Without this the exception list would be satisfied by a table where
    // everything was uncapped and only contacts happened to be listed.
    for (const plan of PAID) {
      const uncapped = unboundedTerms(plan).filter(
        (term) => !(UNBOUNDED_BY_DECISION[plan] ?? []).includes(term),
      )
      expect(`${plan}: ${uncapped.join(',')}`).toBe(`${plan}: `)
    }
  })
})

// ---------------------------------------------------------------------------
// The CRM axis on its own, at full utilization, at the ANNUAL price
// (AGL-2611).
// ---------------------------------------------------------------------------
describe('the CRM axis holds an 80% margin at 100%, at the annual price (AGL-2611)', () => {
  /** The share of the ANNUAL monthly price the CRM axis may consume at 100%. */
  const CRM_AXIS_COST_SHARE = 0.2

  /**
   * The three terms of the axis — the records band, the seats that can work
   * it, and a whole day at the one-to-one email cap thirty times over — each
   * a rate times a band read off the tables by key, so a stub, a rename or a
   * collapsed table zeroes a term and the control below names it. The seat
   * and email terms are the SAME two the whole-plan model above carries as
   * `crmDecisionTerms`; the records term is its `contacts` term.
   */
  function crmAxisTerms(plan: OrgPlan): Record<string, number> {
    const entitlements = PLAN_ENTITLEMENTS[plan]
    const rates = ORG_COGS_UNIT_RATES_USD
    return {
      records: entitlements.contactsPerHost * rates.perContactMonth,
      seats: entitlements.membersPerHost * CRM_SEAT_COGS_USD_PER_MONTH,
      email: entitlements.crmEmailsPerDay * 30 * rates.perEmailSend,
    }
  }
  const crmAxisCostUsd = (plan: OrgPlan) =>
    Object.values(crmAxisTerms(plan)).reduce((a, b) => a + b, 0)
  const annualPriceUsd = (plan: OrgPlan) =>
    PLAN_PRICING[plan].basePriceAnnualMonthlyUsd
  const marginPct = (plan: OrgPlan) =>
    Number(((1 - crmAxisCostUsd(plan) / annualPriceUsd(plan)) * 100).toFixed(1))

  it('CONTROL: every term is finite and non-zero on every paid tier', () => {
    // A term that reads 0 or `undefined` is a band or a rate that stopped
    // being read, and a margin computed over it is 100% on no evidence.
    for (const plan of PAID) {
      for (const [term, cost] of Object.entries(crmAxisTerms(plan))) {
        expect(
          `${plan}.${term}: ${Number.isFinite(cost) && cost > 0 ? 'priced' : String(cost)}`,
        ).toBe(`${plan}.${term}: priced`)
      }
      expect(annualPriceUsd(plan)).toBeGreaterThan(0)
    }
  })

  it('is the same three terms the whole-plan model counts', () => {
    // One arithmetic, two views of it. A CRM-axis guard that priced a seat or
    // a send differently from the tier model would let the two disagree about
    // the same dollars.
    for (const plan of PAID) {
      const axis = crmAxisTerms(plan)
      const tier = tierCostTerms(plan)
      expect(axis.records).toBe(tier.contacts)
      expect(axis.seats).toBe(tier.crmSeats)
      expect(axis.email).toBe(tier.crmEmail)
    }
  })

  it('takes the share of the ANNUAL price, the cheaper of the two', () => {
    // The guardrail is stated against the lower price so that it holds on
    // the higher one for free; a spec that read `basePriceMonthlyUsd` would
    // pass a cap the annual customer loses money on.
    for (const plan of PAID) {
      expect(annualPriceUsd(plan)).toBeLessThan(
        PLAN_PRICING[plan].basePriceMonthlyUsd,
      )
    }
  })

  it('costs exactly what the decision log tabled, per tier per month', () => {
    // A pin as well as a floor: any change to a band, a cap or a rate moves
    // one of these, and has to come here and say so.
    expect(
      Object.fromEntries(
        PAID.map((plan) => [plan, Number(crmAxisCostUsd(plan).toFixed(2))]),
      ),
    ).toEqual({
      starter: 1.73,
      pro: 6.65,
      business: 18.4,
      scale: 32.6,
      advanced: 49.5,
      agency: 142,
    })
  })

  it('stays at or under 20% of the annual monthly price on every paid tier', () => {
    const offenders = Object.fromEntries(
      PAID.filter(
        (plan) =>
          crmAxisCostUsd(plan) > CRM_AXIS_COST_SHARE * annualPriceUsd(plan),
      ).map((plan) => [
        plan,
        `$${crmAxisCostUsd(plan).toFixed(2)} of a $${annualPriceUsd(plan)} annual price`,
      ]),
    )
    expect(offenders).toEqual({})
  })

  it('holds these margins at the annual price, as numbers', () => {
    expect(
      Object.fromEntries(PAID.map((plan) => [plan, marginPct(plan)])),
    ).toEqual({
      starter: 89.2,
      pro: 82.9,
      business: 81.4,
      scale: 81.8,
      advanced: 83.4,
      agency: 86.5,
    })
    // Every one at or above the 80% the decision names.
    for (const plan of PAID) expect(marginPct(plan)).toBeGreaterThanOrEqual(80)
  })

  it('CONTROL: the share is not so generous that nothing could fail it', () => {
    // Starter at PRO's one-to-one cap spends $4.43 of a $3.20 share: the cap
    // was chosen AT the line, which is what makes the line worth asserting.
    const starter = crmAxisTerms('starter')
    const atProCap =
      starter['records'] +
      starter['seats'] +
      PLAN_ENTITLEMENTS.pro.crmEmailsPerDay * 30 * ORG_COGS_UNIT_RATES_USD.perEmailSend
    expect(atProCap).toBeGreaterThan(CRM_AXIS_COST_SHARE * annualPriceUsd('starter'))
    // And the real cap is inside it, so the two sides of the line are both
    // exercised on the same tier.
    expect(crmAxisCostUsd('starter')).toBeLessThanOrEqual(
      CRM_AXIS_COST_SHARE * annualPriceUsd('starter'),
    )
  })

  it('reads the email cap through the entitlement, proved by perturbation', () => {
    // The newest term is the one most likely to be silently dropped. Its
    // cost must MOVE with the cap — an axis that priced email from a literal
    // would pass every pin above until the cap changed.
    const real = crmAxisTerms('agency')['email']
    const perturbed =
      (PLAN_ENTITLEMENTS.agency.crmEmailsPerDay + 100) *
      30 *
      ORG_COGS_UNIT_RATES_USD.perEmailSend
    expect(perturbed - real).toBeCloseTo(100 * 30 * 0.0009, 10)
    expect(real).toBeCloseTo(27, 10)
  })
})

// ---------------------------------------------------------------------------
// Free, and the two protections that hang off its band.
// ---------------------------------------------------------------------------
describe("Free's bandwidth band, and everything derived from it", () => {
  /**
   * Free is the ONE plan whose bandwidth cannot be metered — there is no
   * subscription to bill an overage onto — so its band is a pure give. It is
   * denominated in GIGABYTES, and it is the gigabytes that are the promise:
   * at the paired constants 2 GB costs $0.83 a month per free org against no
   * revenue — its transfer at the dearest region, its reads at nam5 — and
   * $1.27 once its views' requests are counted; it covers roughly 2,070 page
   * views of a
   * 1012.8 KB page. It
   * covered ~3,500 views of a 600 KB one, which is the same 2 GB — the page
   * grew, and a heavier page is fewer views of the same allowance.
   *
   * The margin rule cannot size it, because there is no price for a margin
   * to be a fraction of: no band above zero clears it, so the band is a
   * capped give rather than a sized one, and the cap below is what bounds it.
   *
   * Nothing else about Free moves. It is asserted here rather than assumed,
   * because "we trimmed Free" and "we trimmed one band on Free" are different
   * changes and only the second one happened.
   */
  it('is 2 GB, and every other Free band is untouched', () => {
    expect(PLAN_ENTITLEMENTS.free.bandwidthGb).toBe(2)
    expect(PLAN_ENTITLEMENTS.free.storagePerHostMb).toBe(250)
    expect(PLAN_ENTITLEMENTS.free.hostLimit).toBe(1)
    expect(PLAN_ENTITLEMENTS.free.formSubmissionsPerMonth).toBe(20)
    expect(PLAN_ENTITLEMENTS.free.emailSendsPerMonth).toBe(0)
    expect(PLAN_ENTITLEMENTS.free.features.aiAssist).toBe(false)
    expect(PLAN_PRICING.free.basePriceMonthlyUsd).toBe(0)
  })

  /**
   * THE AI TASTE (AGL-2925) — the one Free band with no bandwidth wall
   * behind it, and the one give that is priced in provider dollars rather
   * than in gigabytes. Its cost exposure is the number the decision was
   * made on, so it is pinned here beside the bandwidth give: at most thirty
   * cents a month per Free workspace, and a WALL — no rate, so nothing past
   * the band can ever produce a charge in either direction.
   */
  it('the AI taste costs at most $0.30 a month per Free workspace, and is a wall', () => {
    expect(PLAN_ENTITLEMENTS.free.assistCreditsPerMonth).toBe(300)
    expect(PLAN_ENTITLEMENTS.free.features.aiGenerative).toBe(true)
    const monthlyCostUsd = PLAN_ENTITLEMENTS.free.assistCreditsPerMonth * ASSIST_CREDIT_COST_USD
    expect(monthlyCostUsd).toBeLessThanOrEqual(0.3)
    expect(monthlyCostUsd).toBeGreaterThan(0)
    // …and it is metered on the SAME rate the paid bands are, so a cheaper
    // credit could not silently make the taste larger than it was decided.
    expect(ASSIST_CREDIT_COST_USD).toBe(0.001)
    expect(PLAN_PRICING.free.extraAssistCreditsUsdPer1k).toBeNull()
    // Three workspaces per account (AGL-2265) do NOT triple it: the account
    // allowance is the same constant, read by the meter for the owner — held
    // by the AI plugin's `plan-entitlements.spec.ts`, where the constant is.
  })

  it('costs what the give is worth, at the platform\'s own rate', () => {
    const monthlyCostUsd =
      PLAN_ENTITLEMENTS.free.bandwidthGb * VIEWS_PER_GB * ORG_COGS_UNIT_RATES_USD.perPageView
    expect(monthlyCostUsd).toBeCloseTo(0.83, 2)
    // …and it is the GB band times the cost of a gigabyte, which is the only
    // honest way to price a give denominated in gigabytes.
    expect(monthlyCostUsd).toBeCloseTo(
      PLAN_ENTITLEMENTS.free.bandwidthGb * COST_PER_GB_USD,
      10,
    )
    // Past the CDN's request allowance the same views also make their
    // requests, which the model counts at the dearest region: $1.27 a month
    // at most per Free workspace, and the cap stops it there.
    expect(
      PLAN_ENTITLEMENTS.free.bandwidthGb * ALL_IN_COST_PER_GB_USD,
    ).toBeCloseTo(1.27, 2)
    expect(tierCostTerms('free').cdnRequests).toBeCloseTo(
      PLAN_ENTITLEMENTS.free.bandwidthGb * REQUEST_COST_PER_GB_USD,
      10,
    )
    // The band still buys a usable evaluation — 2,070 views of the page the
    // platform actually serves.
    expect(PLAN_ENTITLEMENTS.free.bandwidthGb * VIEWS_PER_GB).toBeGreaterThan(2_000)
  })

  /**
   * BOTH FREE PROTECTIONS DERIVE FROM THE BAND, and must keep doing so.
   *
   * They are independent and they behave differently: the bandwidth CAP is
   * Free-only, trips at 1x the band and pauses the site; the abuse CEILING
   * applies to any plan, trips at 3x the band with a 100,000-view floor, and
   * raises an incident. Both read the resolved entitlement rather than a
   * copy, which is what makes a band change move them — and what a hardcoded
   * threshold would silently break.
   */
  it('the CAP trips at exactly 1x the band, from the entitlement', () => {
    const free = { plan: 'free' } as never
    const band = PLAN_ENTITLEMENTS.free.bandwidthGb
    // Inside the band: nothing engages. Past it: it does. Both directions, so
    // a predicate stuck on one answer cannot pass.
    expect(
      bandwidthCapShouldEngage({ org: free, usedBandwidthGb: band, includedBandwidthGb: band }),
    ).toBe(false)
    expect(
      bandwidthCapShouldEngage({
        org: free,
        usedBandwidthGb: band + 0.01,
        includedBandwidthGb: band,
      }),
    ).toBe(true)
    // MUTATION: at the OLD 5 GB band the same 2.01 GB of traffic was well
    // inside the allowance and engaged nothing. The threshold moved with the
    // band because it is the band.
    expect(
      bandwidthCapShouldEngage({ org: free, usedBandwidthGb: band + 0.01, includedBandwidthGb: 5 }),
    ).toBe(false)
    // …and it stays Free-only. A paid org past its band is BILLED, never
    // paused — pausing a paying customer's site would trade a bill they
    // agreed to for an outage they did not.
    expect(
      bandwidthCapShouldEngage({
        org: { plan: 'starter', subscription: { status: 'active' } } as never,
        usedBandwidthGb: 10_000,
        includedBandwidthGb: PLAN_ENTITLEMENTS.starter.bandwidthGb,
      }),
    ).toBe(false)
  })

  /**
   * THE CEILING IS A CAP, NOT A PRICE. It came down from 10x to 3x on
   * 2026-09-07 because the page-view meter under it was priced for a 627 KB
   * page while the platform served over a thousand: past the band every 1,000
   * views billed $0.13 and cost about $0.17, so the tail a metered plan could
   * run up before staff looked at it grew with the traffic. At 10x that tail
   * was $2,374 a month on Agency at the measured page weight.
   *
   * The 2026-09-09 re-peg removed the loss on weight, and AGL-1879 removed it
   * on requests — 1,000 views now bill $0.80 against at most $0.62, the
   * dearest region's cost, once the CDN's request allowance is spent — and the
   * ceiling stays at 3x anyway. It
   * was never a margin instrument: a scraper or a hotlinked asset bills the
   * account holder for traffic they did not ask for, and the cap is what
   * bounds that.
   */
  it('the abuse CEILING is 3x the band, floored, from the entitlement', () => {
    expect(BANDWIDTH_ABUSE_CEILING_MULTIPLE).toBe(3)
    const free = checkBandwidthAbuseCeiling({ plan: 'free' } as never, 0)
    // Free's 2 GB is ~2,071 views, and 3x that is far under the 100,000
    // floor — so the floor is what governs, which is the point of having one.
    expect(free.ceiling).toBe(BANDWIDTH_ABUSE_CEILING_FLOOR)
    // A tier whose band clears the floor derives its ceiling from the band,
    // and moving the band moves it. Agency: 395 GB of views x 3.
    const agency = checkBandwidthAbuseCeiling({ plan: 'agency' } as never, 0)
    expect(agency.ceiling).toBe(
      Math.round(
        PLAN_ENTITLEMENTS.agency.bandwidthGb *
          VIEWS_PER_GB *
          BANDWIDTH_ABUSE_CEILING_MULTIPLE,
      ),
    )
    expect(agency.ceiling).toBe(1_226_859)
    // The ceiling is 3x the BAND, and the band is gigabytes — so it is 1,185
    // GB of containment whatever a page weighs, which is the property that
    // matters for a cap.
    expect(agency.ceiling * (ESTIMATED_PAGE_TRANSFER_BYTES / 1024 / 1024 / 1024)).toBeCloseTo(
      PLAN_ENTITLEMENTS.agency.bandwidthGb * BANDWIDTH_ABUSE_CEILING_MULTIPLE,
      2,
    )
    // MUTATION: at the 3,000 GB band and the 10x multiple the ceiling was
    // 31.1M views — more than twenty-five times what it is now. Nothing was
    // hardcoded to hold the old figure.
    expect(agency.ceiling).toBeLessThan(Math.round(3_000 * VIEWS_PER_GB * 10) / 25)
    // The ceiling is never below the band the plan sold — containment must
    // not become a capacity cut.
    for (const plan of PAID) {
      const { ceiling } = checkBandwidthAbuseCeiling({ plan } as never, 0)
      expect(
        `${plan}: ${ceiling >= PLAN_ENTITLEMENTS[plan].bandwidthGb * VIEWS_PER_GB}`,
      ).toBe(`${plan}: true`)
    }
  })
})

// ---------------------------------------------------------------------------
// The pass-through is not in scope, and saying so is load-bearing.
// ---------------------------------------------------------------------------
describe('the infra pass-through is priced by a different rule', () => {
  it('earns 23% by construction, and this guard does not judge it', () => {
    // "At cost + 30%" is a published customer promise, so the published
    // figures ARE the claim and a margin floor cannot be applied to them.
    // The collision between that promise and a 50% retail floor is a pricing
    // decision, not something a test may resolve by moving a rate.
    const margin =
      (METERED_BILLED_RATES_USD.perPageView -
        METERED_OVERAGE_COST_USD.perPageView) /
      METERED_BILLED_RATES_USD.perPageView
    expect(margin).toBeCloseTo(0.2308, 4)
    expect(METERED_MARKUP).toBe(1.3)
    // $0.80 per 1,000, the published figure, from a billed view's cost at the
    // dearest region — and $0.08 per 1,000 form submissions the same way.
    expect(Math.round(METERED_BILLED_RATES_USD.perPageView * 1000 * 100) / 100).toBe(0.8)
    expect(Math.round(METERED_BILLED_RATES_USD.perFormSubmission * 1000 * 100) / 100).toBe(
      0.08,
    )
    // "At cost + 30%" holds against the cost a billed unit incurs where the
    // CDN and functions are DEAREST, so it holds in every region.
    for (const key of ['perPageView', 'perFormSubmission'] as const) {
      expect(
        `${key}: ${METERED_BILLED_RATES_USD[key] / METERED_OVERAGE_COST_USD[key] >= 1.3 - 1e-9}`,
      ).toBe(`${key}: true`)
    }
  })

  it('carries the three pass-through rates as published', () => {
    expect(METERED_UNIT_RATES_USD.storagePerGbMonth).toBe(0.026)
    // Re-pegged on 2026-09-09 by the page-weight decision, and re-priced on
    // 2026-10-01 with the Vercel-billed share of each — transfer, and the
    // submission's function invocation — at Vercel's dearest region.
    expect(METERED_UNIT_RATES_USD.perPageView).toBe(0.00039902751)
    expect(METERED_UNIT_RATES_USD.perFormSubmission).toBe(0.000061538462)
    // …and still identical to the COGS table, which is the pairing every
    // change on these three axes has had to make in two places at once.
    for (const key of ['storagePerGbMonth', 'perPageView', 'perFormSubmission'] as const) {
      expect(`${key}: ${METERED_UNIT_RATES_USD[key]}`).toBe(
        `${key}: ${ORG_COGS_UNIT_RATES_USD[key]}`,
      )
    }
  })

  /**
   * THE LADDER THE 2026-09-07 BAND RESIZE WAS ARGUED ON.
   *
   * A page-weight hypothetical enters this model as a cost per gigabyte,
   * never as a rate on its own: the rate and `ESTIMATED_PAGE_TRANSFER_BYTES`
   * are one measurement in two units, so mutating one of them models a bug
   * rather than a page (`MUTATION: the unpaired constants` is the case that
   * deliberately does model the bug).
   *
   * The 2026-09-07 bands were cut against a gigabyte WEIGHING $0.17476 — a
   * 600 KB page at $0.0001 a view, transfer at the cheapest region — where the
   * paired constants price it at $0.16724. Kept because it is the one case
   * proving the ladder above responds to a gigabyte's weight and not to a
   * constant that happens to sit beside it, and because it measures how thin
   * the shipped headroom is: that gigabyte with the same re-prices — its
   * transfer at the dearest region by the decimal GB, its reads at nam5 —
   * is $0.42065, 2% more weight than the shipped $0.41312, and at the
   * shipped bands with the requests counted it is enough to take Starter and
   * Agency under at the annual price.
   */
  it('MUTATION: at the gigabyte the 2026-09-07 resize was argued on, re-priced at the dearest region, the ladder is thinner', () => {
    const AT_600_KB_AND_ONE_HUNDREDTH_OF_A_CENT =
      ((1024 * 1024 * 1024) / (600 * 1024)) * 0.0001
    expect(AT_600_KB_AND_ONE_HUNDREDTH_OF_A_CENT).toBeCloseTo(0.17476, 5)
    // The same re-prices that take the calibration's own gigabyte ($0.0001
    // for 627 KB, $0.16724) to the shipped one — transfer at the dearest
    // region by the decimal GB, reads at nam5 — applied to this one.
    const atTheDearestRegion =
      AT_600_KB_AND_ONE_HUNDREDTH_OF_A_CENT + (COST_PER_GB_USD - (0.0001 / 627) * 1024 * 1024)
    expect(
      Object.fromEntries(
        PAID.map((plan) => [
          plan,
          [
            Number((marginAtCostPerGb(plan, atTheDearestRegion, 'month') * 100).toFixed(1)),
            Number((marginAtCostPerGb(plan, atTheDearestRegion, 'year') * 100).toFixed(1)),
          ],
        ]),
      ),
    ).toEqual({
      starter: [33.4, -0.7],
      pro: [33.7, 6.7],
      business: [29.6, 2.6],
      scale: [28.2, 1.4],
      advanced: [24.4, 0.2],
      agency: [18.5, -0.2],
    })
    // …and the live pair weighs a gigabyte at less than that, which is the
    // room the shipped bands are sized into.
    expect(COST_PER_GB_USD).toBeLessThan(atTheDearestRegion)
    for (const plan of PAID) {
      expect(marginAtCostPerGb(plan, atTheDearestRegion, 'year')).toBeLessThan(
        tierMargin(plan, 1, 'year'),
      )
    }
    expect(ORG_COGS_UNIT_RATES_USD.perPageView).toBe(0.00039902751)
  })

  it('a smaller band WIDENS what the pass-through bills, which is the point', () => {
    // Metering starts at the included band, so cutting a band does not only
    // reduce what is given away — it moves the line where billing starts.
    // Asserted through the real allowance helper rather than restated.
    const allowance = meteredIncludedAllowance({ plan: 'agency' } as never)
    expect(allowance.metered).toBe(true)
    expect(allowance.pageViews).toBeCloseTo(
      PLAN_ENTITLEMENTS.agency.bandwidthGb * VIEWS_PER_GB,
      3,
    )
    expect(allowance.meters['formSubmissions']).toBe(
      PLAN_ENTITLEMENTS.agency.hostLimit *
        PLAN_ENTITLEMENTS.agency.formSubmissionsPerMonth,
    )
    // Finite, where it used to be `Infinity` — an org-wide form band that no
    // amount of usage could exceed billed nothing, ever.
    expect(Number.isFinite(allowance.meters['formSubmissions'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// THE AGLYN AI ADD-ON (AGL-2896). It widens the assist band on the plan an
// org already has, so every figure above is the tier WITHOUT it. This block
// is the same rule with the add-on's band at 100% and the add-on's own
// revenue counted: the customer who buys it and spends all of it must still
// pay for themselves, at the annual price, net of Stripe.
// ---------------------------------------------------------------------------
describe('the Aglyn AI add-on band clears the same invariant with its revenue counted', () => {
  /** What the add-on's band costs at 100%, on the rate the meter uses. */
  const addonCostUsd = (plan: OrgPlan) =>
    AI_ADDON_CREDITS_PER_MONTH[plan] * ASSIST_CREDIT_COST_USD

  /** The add-on's monthly price; the plan sells it, or this block is not about it. */
  const addonPriceUsd = (plan: OrgPlan) => {
    const price = PLAN_PRICING[plan].aiAddonMonthlyUsd
    if (price === null) throw new Error(`${plan} sells no Aglyn AI add-on`)
    return price
  }

  /**
   * The tier's margin with the add-on: the plan at `interval` plus the
   * add-on's flat monthly price (x12 on annual, no discount — the one charge
   * for the year is what the fee amortizes over), net of Stripe, less the
   * plan's full-utilization cost plus the add-on band's.
   */
  const marginWithAddon = (plan: OrgPlan, interval: Interval) => {
    const price = listPriceUsd(plan, interval) + addonPriceUsd(plan)
    const net = netOfProcessorFee(price, interval === 'year')
    const cost = tierCostUsd(plan, 1) + addonCostUsd(plan)
    return (net - cost) / price
  }

  it('is non-negative on every tier that sells it, at 100% of every band and the add-on band', () => {
    // FORCED RED by pricing the add-on band at Agency's size on Starter:
    // $149 of spend against $24.25 net.
    const offenders = PAID.filter((plan) => !(marginWithAddon(plan, 'year') >= 0))
    expect(
      Object.fromEntries(
        offenders.map((plan) => [
          plan,
          `$${listPriceUsd(plan, 'year') + addonPriceUsd(plan)} annual price, vs ` +
            `$${(tierCostUsd(plan, 1) + addonCostUsd(plan)).toFixed(2)} cost`,
        ]),
      ),
    ).toEqual({})
    expect(PAID.filter((plan) => !(marginWithAddon(plan, 'month') >= 0))).toEqual([])
    // Pinned, both intervals, so a band widened or a price cut has to come
    // here and say what it did.
    expect(
      Object.fromEntries(
        PAID.map((plan) => [
          plan,
          [Number((marginWithAddon(plan, 'year') * 100).toFixed(1)),
            Number((marginWithAddon(plan, 'month') * 100).toFixed(1))],
        ]),
      ),
    ).toEqual({
      starter: [19.1, 38.9],
      pro: [21.2, 38],
      business: [15.8, 33.9],
      scale: [14.5, 32.6],
      advanced: [12.1, 29.1],
      agency: [10.6, 24.1],
    })
  })

  it('IMPROVES every tier’s margin: the add-on earns more than its band costs', () => {
    // The add-on line clears the retail floor on its own, so stacking it on
    // a plan at 100% cannot pull the plan under — asserted per tier rather
    // than argued, because "sold above cost" and "improves the bundle" are
    // two claims and only the second is what a customer buying it exercises.
    for (const plan of PAID) {
      expect(`${plan}: ${marginWithAddon(plan, 'year') > tierMargin(plan, 1, 'year')}`).toBe(
        `${plan}: true`,
      )
    }
  })

  it('costs at most 50% of the add-on price on every tier, in provider spend', () => {
    // The `ASSIST_CREDIT_MIN_MARGIN_PCT` floor, held on the add-on line the
    // way `assist-credits.spec.ts` holds it on the overage ladder — and pinned
    // as the share, to one decimal, so the next band move is visible.
    expect(
      Object.fromEntries(
        PAID.map((plan) => [
          plan,
          Number(((addonCostUsd(plan) / addonPriceUsd(plan)) * 100).toFixed(1)),
        ]),
      ),
    ).toEqual({
      starter: 44.4,
      pro: 47.4,
      business: 48.7,
      scale: 49.3,
      advanced: 49.5,
      agency: 49.8,
    })
    for (const plan of PAID) {
      expect(addonCostUsd(plan) / addonPriceUsd(plan)).toBeLessThanOrEqual(0.5)
    }
    // CONTROL: the detector can fail. One more thousand credits on Agency
    // crosses the floor.
    expect((addonCostUsd('agency') + 1) / addonPriceUsd('agency')).toBeGreaterThan(0.5)
  })

  it('reads the add-on band on the SAME rate the meter does, and it is finite everywhere', () => {
    // `addonCostUsd` prices the add-on's credits at the AI meter's declared
    // unit, the one every band above is priced at.
    expect(ASSIST_CREDIT_COST_USD).toBe(0.001)
    // Free sells none and Enterprise is Agency x 2 — the rule every
    // Enterprise fallback follows — and neither is `UNLIMITED`, for the
    // reason the `UNLIMITED` block above gives.
    expect(AI_ADDON_CREDITS_PER_MONTH.free).toBe(0)
    expect(AI_ADDON_CREDITS_PER_MONTH.enterprise).toBe(AI_ADDON_CREDITS_PER_MONTH.agency * 2)
    for (const plan of SELF_SERVE_PLANS) {
      expect(Number.isFinite(AI_ADDON_CREDITS_PER_MONTH[plan])).toBe(true)
    }
    expect(Number.isFinite(AI_ADDON_CREDITS_PER_MONTH.enterprise)).toBe(true)
  })
})
