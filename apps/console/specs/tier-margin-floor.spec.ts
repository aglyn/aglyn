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
 * the assist band, and the two CRM terms the 2026-09-05 decision introduced
 * (a seat a month for every collaborator the tier admits, and the whole day
 * spent at the one-to-one email cap thirty times over). The 2026-09-07
 * pricing decision fixed all four of those choices.
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
 * Bandwidth is the largest term on every paid tier — page views are 70–80%
 * of what a tier costs — and the only lever that moves the number. So the
 * bands came down to what the annual price carries: Pro 225 → 125 GB,
 * Business 400 → 185, Scale 700 → 290, Advanced 1,000 → 345, Agency 3,000 →
 * 1,540. Starter, at 50 GB, was never under water and did not move. The
 * ladder now sits between 0.25% and 1.5% at the annual price and between 19%
 * and 30% at the monthly one — the ninth metered axis, workflow and action
 * runs at `perRun`, took the last of the room the same day — and the
 * `MUTATION` cases below prove the shipped bands are what changed the
 * verdict.
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
 * ## ⚠️ THE ANNUAL RULE NO LONGER HOLDS, AND THAT IS THE FINDING (AGL-2711)
 *
 * This file used to open by saying that at the page weight the platform
 * actually serves, every paid tier would be negative at the annual price —
 * and it pinned that as a hypothetical, mutating `perPageView` to the
 * measured figure to show it. On 2026-09-09 the rate was re-pegged to that
 * measurement, so the hypothetical is the live model: at 100% of every band,
 * at the annual price net of Stripe, **every paid tier is negative**, from
 * Starter at -3.6% to Pro at -34.1%.
 *
 * Nothing here resolves it, because none of the three levers is a test's to
 * pull. The bandwidth bands were sized on 2026-09-07 against a rate that has
 * since moved; the annual prices are locked; and the constant that converts a
 * GB band into included page views (`ESTIMATED_PAGE_TRANSFER_BYTES`, 600 KB)
 * is a second statement of the same physical quantity `perPageView` is now
 * calibrated on — 1012.8 KB — so the included allowance grants roughly 1.7x
 * the bytes its GB label implies. Moving any one of the three is a pricing or
 * packaging decision with an owner.
 *
 * What this file does instead is PIN the shortfall exactly, per tier, at both
 * prices, so the gap cannot widen without a red and cannot be closed by
 * anything quieter than a decision. The monthly rule still holds on every
 * tier and is still asserted as a live invariant.
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
  METERED_UNIT_RATES_USD,
  meteredIncludedAllowance,
} from '../utils/usage-metering'
import {
  BANDWIDTH_ABUSE_CEILING_FLOOR,
  BANDWIDTH_ABUSE_CEILING_MULTIPLE,
  ESTIMATED_PAGE_TRANSFER_BYTES,
  INFRA_COGS_PER_SITE_USD,
  ORG_COGS_UNIT_RATES_USD,
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
import {
  ASSIST_CREDIT_COST_USD,
  assistUsdFromCredits,
} from '@aglyn/aglyn/app-utils/assist-credits'

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
 * route a band through a production converter, however tempting.
 * `assistUsdFromCredits` answers **0** for a non-finite band, by design: it
 * feeds a spend budget, and an unbounded budget is worse than none. Reading
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

/** Every cost a tier's bands imply, per month, at full utilization. */
function tierCostTerms(plan: OrgPlan): Record<string, number> {
  return { ...bandCostTerms(plan), ...crmDecisionTerms(plan) }
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
  const terms = tierCostTerms(plan)
  const cost =
    Object.values(terms).reduce((a, b) => a + b, 0) -
    terms.bandwidth +
    bandwidthGb * VIEWS_PER_GB * ORG_COGS_UNIT_RATES_USD.perPageView
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

  it('names bandwidth as the dominant BOUNDED term', () => {
    // Stated as a fact rather than left implicit: page views are the largest
    // finite line on every paid tier, which is why the bands that had to come
    // down were the bandwidth ones and nothing else could have carried it.
    for (const plan of PAID) {
      const finite = Object.entries(tierCostTerms(plan)).filter(([, cost]) =>
        Number.isFinite(cost),
      )
      const largest = finite.sort((a, b) => b[1] - a[1])[0][0]
      expect(`${plan}: ${largest}`).toBe(`${plan}: bandwidth`)
    }
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
    expect(ORG_COGS_UNIT_RATES_USD.perRun).toBe(0.000012)
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
    expect(bandCostTerms('agency').runs).toBeCloseTo(36, 6)
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

  it('carries the two CRM decision terms OUTSIDE the platform model, and no third', () => {
    // The seat and one-to-one email terms are real cost with no meter behind
    // them — the platform model cannot price what the rollup does not record
    // — so they live beside the bridged terms rather than inside it. Named
    // here, both directions, so a fourth un-bridged term cannot arrive the
    // way the first three omissions did: silently.
    expect(Object.keys(crmDecisionTerms('advanced')).sort()).toEqual([
      'crmEmail',
      'crmSeats',
    ])
    for (const plan of PAID) {
      expect(Object.keys(tierCostTerms(plan)).sort()).toEqual(
        [...Object.keys(bandCostTerms(plan)), 'crmSeats', 'crmEmail'].sort(),
      )
      expect(termsWithNoAxis(crmDecisionTerms(plan))).toEqual(['crmEmail', 'crmSeats'])
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
    // `ASSIST_CREDIT_COST_USD` lives in `assist-credits.ts` because a credit
    // IS provider spend rather than a meter priced per unit — the platform
    // model takes assist in dollars at x1 for the same reason. The sweep
    // above therefore cannot see it, and this is the term that was missing.
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
    // The pairing, both directions. For a FINITE band the model must agree
    // with the production converter to the cent — a second assist rate here
    // would be exactly the drift `orgMonthlyCogsUsd` was built to remove.
    for (const plan of PAID) {
      expect(`${plan}: ${bandCostTerms(plan).assistCredits}`).toBe(
        `${plan}: ${assistUsdFromCredits(
          PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth,
        )}`,
      )
    }
    // …and for an UNBOUNDED band they must NOT agree, which is why the model
    // multiplies the rate itself instead of calling the converter.
    // `assistUsdFromCredits` answers 0 for a non-finite band because it feeds
    // a spend budget; scoring an uncapped band as free is the one thing this
    // file may never do.
    expect(assistUsdFromCredits(UNLIMITED)).toBe(0)
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
   * THE RULE, AND THE FACT THAT IT IS CURRENTLY BROKEN AT THE ANNUAL PRICE.
   *
   * The rule is not a threshold anyone chose to be comfortable — it is the
   * survival condition. Every band here is INCLUDED rather than metered, so a
   * customer spending all of it is exercising the plan exactly as sold, and
   * there is no overage to bill and no gate to refuse them.
   *
   * It is stated at the annual price because that is the cheaper of the two a
   * customer can choose and the one the page leads with. It held for none of
   * the five upper tiers before the 2026-09-07 band resize; it held for all
   * six after it; and it holds for none of them since the 2026-09-09 page-view
   * re-peg, which raised the cost of the bandwidth band by 61.5% on every
   * tier at once.
   *
   * So the shortfall is PINNED rather than asserted away. Every figure is
   * exact, which is stricter than a floor: a band widened, a price cut or a
   * rate raised moves one of these strings and has to come here and say what
   * it did. Emptying this object is the goal, and the three ways to reach it
   * are named in the file docblock.
   */
  it('is NEGATIVE on every paid tier at 100% of every band, at the annual price', () => {
    const offenders = tiersUnderFloor(PAID, 1, 0, 'year')
    // Named with the arithmetic, so the record says which tier and by how much
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
    ).toEqual({
      starter: '$16 annual price, $15.51 net of Stripe, vs $16.09 cost',
      pro: '$39 annual price, $37.84 net of Stripe, vs $51.14 cost',
      business: '$99 annual price, $96.1 net of Stripe, vs $115.73 cost',
      scale: '$179 annual price, $173.78 net of Stripe, vs $203.52 cost',
      advanced: '$299 annual price, $290.3 net of Stripe, vs $323.40 cost',
      agency: '$1049 annual price, $1018.55 net of Stripe, vs $1168.76 cost',
    })
    // …and it is EVERY tier, not a subset that could be read as one tier's
    // problem. A shortfall on one rung is a band to re-cut; a shortfall on all
    // six is the rate underneath them.
    expect(offenders.sort()).toEqual([...PAID].sort())
  })

  /**
   * THE INVARIANT THAT SURVIVES, and the reason the annual shortfall is a
   * pricing question rather than an outage.
   *
   * A monthly customer at 100% of every band still pays for themselves on
   * every tier. What the annual price buys is a 26–35% discount, and it is
   * that discount the re-pegged bandwidth cost now overruns.
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
      starter: [84.4, 71.8, 46.6, -3.6],
      pro: [81.6, 64.2, 31.5, -34.1],
      business: [76.9, 67.8, 38.6, -19.8],
      scale: [80.3, 68.7, 40.2, -16.6],
      advanced: [80.4, 70.1, 43, -11.1],
      agency: [78, 69.2, 41.4, -14.3],
    })
    // The 3% column did not move on any tier, and that is not a rounding
    // coincidence. At 3% of every band the per-site FLOOR governs
    // (`INFRA_COGS_PER_SITE_USD` x hostLimit), and the floor is a flat dollar
    // figure no unit rate touches — so the one column the re-peg leaves alone
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
      starter: [87.9, 79.8, 63.7, 31.5],
      pro: [85.9, 73.7, 50.9, 5.3],
      business: [82.5, 76.1, 55.3, 13.6],
      scale: [84.9, 76.5, 56.1, 15.2],
      advanced: [84.5, 76.8, 56.5, 16],
      agency: [81.7, 74.6, 52.1, 7.1],
    })
  })

  /**
   * THE REALISTIC BAND, where the annual ladder still mostly stands.
   *
   * 25% of every band at once is the utilization the 2026-09-07 resize was
   * argued on. The re-peg took roughly nine points off every tier there, and
   * four of the six fell through the 70% line — Advanced and Starter did not.
   * Pinned as the set rather than as an empty array, for the reason the
   * headline shortfall is: an exact set moves when anything moves.
   */
  it('is thinner than 70% on four of six tiers at the realistic 25% band', () => {
    expect(tiersUnderFloor(PAID, 0.25, 0.7, 'year').sort()).toEqual([
      'agency',
      'business',
      'pro',
      'scale',
    ])
    // The two that clear it, named, so "four of six" cannot quietly become
    // six of six without a red.
    expect(tiersUnderFloor(PAID, 0.25, 0.7, 'year')).not.toContain('starter')
    expect(tiersUnderFloor(PAID, 0.25, 0.7, 'year')).not.toContain('advanced')
    // BOTH WAYS: at the monthly price the same utilization clears 70% on
    // every tier, which is where the annual discount is being spent.
    expect(tiersUnderFloor(PAID, 0.25, 0.7, 'month')).toEqual([])
  })

  /**
   * THE BAND THE LADDER ACTUALLY OCCUPIES.
   *
   * Between the 2026-09-07 resize and the 2026-09-09 re-peg the annual worst
   * cases sat between 0.25% and 1.5% — cut to what the price carried and no
   * further, because every gigabyte cut is capacity the customer no longer
   * has. That headroom was 1.5 points wide and the re-peg was 61.5% on the
   * largest term, so all of it went and then some: the ladder now runs from
   * -3.6% on Starter down to -34.1% on Pro.
   *
   * The monthly ladder is what the annual one used to be — 5.3% to 31.5%,
   * still positive on every rung, still thin at the top of the ladder where
   * the bands are largest.
   */
  it('runs from -3.6% to -34.1% at 100% annual, and stays positive monthly', () => {
    // The annual ladder, as an ordered floor sweep rather than six literals:
    // every tier is under zero, none is under -35%, and Pro is the worst rung.
    expect(tiersUnderFloor(PAID, 1, 0, 'year').sort()).toEqual([...PAID].sort())
    expect(tiersUnderFloor(PAID, 1, -0.35, 'year')).toEqual([])
    expect(tiersUnderFloor(PAID, 1, -0.34, 'year')).toEqual(['pro'])
    // …and the monthly ladder still clears, with Pro the thinnest rung there
    // too. Same shape, one price up.
    expect(tiersUnderFloor(PAID, 1, 0.05, 'month')).toEqual([])
    expect(tiersUnderFloor(PAID, 1, 0.06, 'month')).toEqual(['pro'])
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
   * Every figure is pinned. These are the numbers the decision was made on,
   * and a mutation that "goes negative" by a different amount than it did
   * then is a model that changed under the decision.
   */
  it('MUTATION: at the bands sold until 2026-09-07, every tier from Pro up was under water at the annual price', () => {
    const before = { pro: 225, business: 400, scale: 700, advanced: 1000, agency: 3000 } as const
    const was = Object.fromEntries(
      Object.entries(before).map(([plan, gb]) => [
        plan,
        Number((marginAtBandwidth(plan as OrgPlan, gb, 'year') * 100).toFixed(1)),
      ]),
    )
    expect(was).toEqual({
      pro: -106.5,
      business: -81.1,
      scale: -81.3,
      advanced: -72.9,
      agency: -53.6,
    })
    // …and at the MONTHLY price all five were negative too. Three of the five
    // were before the 2026-09-09 re-peg; the other two joined them when the
    // rate under the axis rose 61.5%. The guard that stood here originally
    // read +10.0 … +6.7% on all five, because it counted neither Stripe's
    // fee, nor the two CRM terms, nor the runs.
    expect(
      Object.fromEntries(
        Object.entries(before).map(([plan, gb]) => [
          plan,
          Number((marginAtBandwidth(plan as OrgPlan, gb, 'month') * 100).toFixed(1)),
        ]),
      ),
    ).toEqual({ pro: -45.2, business: -30, scale: -31.2, advanced: -30.4, agency: -24.6 })
    // BOTH WAYS, on the one axis that moved: the shipped band clears at the
    // monthly price. Read there rather than at the annual one, which the
    // re-peg took below zero on every tier — see the file docblock.
    for (const plan of Object.keys(before) as Array<keyof typeof before>) {
      expect(`${plan} is not: ${tierMargin(plan, 1, 'month') >= 0}`).toBe(`${plan} is not: true`)
      expect(PLAN_ENTITLEMENTS[plan].bandwidthGb).toBeLessThan(before[plan])
    }
    // Starter is the CONTROL: its band did not move, so its margin reads the
    // same through the instrument as through the model.
    expect(marginAtBandwidth('starter', 50, 'year')).toBeCloseTo(tierMargin('starter', 1, 'year'), 12)
    expect(PLAN_ENTITLEMENTS.starter.bandwidthGb).toBe(50)
  })

  it('MUTATION: restoring ONE band on ONE tier is enough to break it', () => {
    // The single-axis version, because a mutation that changes four things at
    // once can pass for the wrong reason. Advanced's contacts band alone —
    // 1,000,000 at $0.0002 is $200 against a $299 annual price.
    //
    // Read at the MONTHLY price since the 2026-09-09 re-peg. Both directions
    // is the whole value of a mutation, and the annual price no longer
    // supplies the positive half on any tier — proving a band breaks a margin
    // that is already negative proves nothing about the band.
    const restored =
      measuredCostUsd('advanced') -
      tierCostTerms('advanced').contacts +
      1_000_000 * ORG_COGS_UNIT_RATES_USD.perContactMonth
    expect((netPriceUsd('advanced', 'month') - restored) / listPriceUsd('advanced', 'month')).toBeLessThan(0)
    // …and with the shipped band it is positive. Both directions on one axis.
    expect(tierMargin('advanced', 1, 'month')).toBeGreaterThan(0)
    // The annual side of the same axis, kept as the record of how much of the
    // shortfall this one band is: restoring it roughly doubles Advanced's.
    expect((netPriceUsd('advanced', 'year') - restored) / listPriceUsd('advanced', 'year')).toBeLessThan(
      tierMargin('advanced', 1, 'year'),
    )
  })

  /**
   * PRO, ONE AXIS AT A TIME.
   *
   * The decomposition is pinned as numbers so a change that moved several of
   * Pro's bands at once cannot read as this one, which moved bandwidth and
   * nothing else.
   */
  it('spends 69% of Pro on bandwidth, and the rest on ten small terms', () => {
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
      formSubmissions: 0.15,
      bandwidth: 35.2886,
      datasetStorage: 0.9,
      apiRequests: 0,
      contacts: 2,
      emailSends: 4.5,
      assistCredits: 2.75,
      runs: 0.12,
      crmSeats: 0.6,
      crmEmail: 4.05,
    })
    // The ten others total $15.85 against a $37.84 net annual price, and not
    // one of them moved on 2026-09-09 — bandwidth alone went from $21.85 to
    // $35.29, which is 58% of the tier's cost becoming 69% of a larger one.
    // Nothing but this axis can decide the tier, and nothing but the rate
    // decided this axis.
    const total = Object.values(terms).reduce((a, b) => a + b, 0)
    expect(total - terms.bandwidth).toBeCloseTo(15.85, 2)
    expect(terms.bandwidth / total).toBeGreaterThan(0.68)
    // The axis, read back through the rate that sets it, so the term cannot
    // drift from the constant it is a product of.
    expect(terms.bandwidth).toBeCloseTo(
      PLAN_ENTITLEMENTS.pro.bandwidthGb *
        VIEWS_PER_GB *
        ORG_COGS_UNIT_RATES_USD.perPageView,
      10,
    )
  })

  it('MUTATION: Pro at its OLD 7,500-credit assist band is deeper under water', () => {
    // The assist axis on its own, on the tier with the least room. $7.50 of
    // provider spend on a tier whose annual price is already $13.30 short of
    // its own bands.
    const terms = tierCostTerms('pro')
    const restored =
      Object.values(terms).reduce((a, b) => a + b, 0) -
      terms.assistCredits +
      7_500 * ASSIST_CREDIT_COST_USD
    expect(listPriceUsd('pro', 'year')).toBe(39)
    expect((netPriceUsd('pro', 'year') - restored) / 39).toBeCloseTo(-0.463, 3)
    // BOTH DIRECTIONS, on the one tier and the one interval where the sign
    // still turns: Pro's monthly price has $2.97 of room at 100% of every
    // band, and the extra 4,750 credits are $4.75 of provider spend.
    const proRestoredMonthly =
      (netPriceUsd('pro', 'month') - restored) / listPriceUsd('pro', 'month')
    expect(proRestoredMonthly).toBeLessThan(0)
    expect(tierMargin('pro', 1, 'month')).toBeGreaterThan(0)
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
    expect(METERED_BILLED_RATES_USD.perPageView).toBe(
      METERED_UNIT_RATES_USD.perPageView * METERED_MARKUP,
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
   * STARTER IS THE SHALLOWEST RUNG, and the arithmetic is here rather than
   * asserted by absence. Its bands imply $16.09 against a $16 annual price —
   * the narrowest shortfall on the ladder, -3.6% — and bandwidth is 88% of
   * that, $14.12.
   *
   * It is also THE CONTROL FOR THE BAND RESIZE. Starter sells neither assist
   * nor campaign email, so those two terms are ZERO here, and its bandwidth
   * BAND did not move on 2026-09-07 — only the rate under it moved, on
   * 2026-09-09, which is why this tier's cost rose with every other one.
   */
  it('leaves Starter the shallowest rung, on bandwidth alone', () => {
    expect(listPriceUsd('starter', 'month')).toBe(25)
    expect(listPriceUsd('starter', 'year')).toBe(16)
    expect(tierCostUsd('starter', 1)).toBeCloseTo(16.09, 2)
    // The metered axes alone are $14.57 — $8.74 of which was bandwidth before
    // the re-peg and $14.12 after — plus the 500 runs it sells, 0.6¢; the CRM
    // decision terms are the $1.53 on top.
    expect(Object.values(bandCostTerms('starter')).reduce((a, b) => a + b, 0)).toBeCloseTo(14.56, 2)
    expect(bandCostTerms('starter').bandwidth).toBeCloseTo(14.12, 2)
    expect(PLAN_ENTITLEMENTS.starter.bandwidthGb).toBe(50)
    // Untouched by the assist term, because there is no band to price: the
    // term is present and it is ZERO, which is a different statement from
    // the term being absent.
    expect(Object.keys(tierCostTerms('starter'))).toContain('assistCredits')
    expect(tierCostTerms('starter').assistCredits).toBe(0)
    expect(PLAN_ENTITLEMENTS.starter.assistCreditsPerMonth).toBe(0)
    expect(PLAN_ENTITLEMENTS.starter.features.aiAssist).toBe(false)
    // The email axis, read the same way and for the same reason. Campaign
    // email begins at Pro, so the term is present and ZERO rather than
    // absent — a missing term would drop cost by arithmetic instead of by
    // entitlement, and every margin below would read the same either way.
    expect(Object.keys(tierCostTerms('starter'))).toContain('emailSends')
    expect(tierCostTerms('starter').emailSends).toBe(0)
    expect(PLAN_ENTITLEMENTS.starter.emailSendsPerMonth).toBe(0)
    // Doubling the dominant rate is the move this ladder is thin against, and
    // it no longer spares anybody. Starter cleared 18% monthly at a doubled
    // $0.0001; at a doubled $0.00016153846 every tier is negative on both
    // intervals. The 61.5% the rate actually moved on 2026-09-09 is most of
    // the way to this, which is why it took the whole annual ladder with it.
    const atDoubleRate = (plan: OrgPlan, interval: Interval) =>
      (netPriceUsd(plan, interval) - (measuredCostUsd(plan) + tierCostTerms(plan).bandwidth)) /
      listPriceUsd(plan, interval)
    for (const plan of PAID) {
      for (const interval of ['month', 'year'] as const) {
        expect(`${plan} ${interval}: ${atDoubleRate(plan, interval) < 0}`).toBe(
          `${plan} ${interval}: true`,
        )
      }
    }
    // …and it is the doubling doing that, not the shipped rate: at the
    // shipped rate the monthly ladder clears on every tier.
    expect(tiersUnderFloor(PAID, 1, 0, 'month')).toEqual([])
  })

  /**
   * THE ASSIST BANDS, pinned as numbers and bounded as a share.
   *
   * They were sized on 2026-08-30 to take between a quarter and a third of
   * what the other metered terms left of the MONTHLY price. The 2026-09-07
   * bandwidth resize widened that room on every tier without touching the
   * bands, so the quarter floor no longer describes the ladder — Pro's band
   * is now 11% of its room — and the numbers below are what holds the bands
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
      // Starter sells no assist, and a plan with no band is not measured
      // against a share of a remainder it never spends.
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
      starter: 0,
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

  it('Agency clears zero monthly and is $150 short annually, on the bandwidth axis', () => {
    const cost = tierCostUsd('agency', 1)
    expect(cost).toBeCloseTo(1168.76, 2)
    expect(listPriceUsd('agency', 'year')).toBe(1049)
    expect(netPriceUsd('agency', 'year')).toBe(1018.55)
    // It cleared zero annually between the 2026-09-07 resize and the
    // 2026-09-09 re-peg, on $15.42 of headroom. The re-peg added $165.63 to
    // the bandwidth term alone — 2.69M included views at $0.00016153846
    // instead of $0.0001 — so the annual price is now $150.21 short.
    expect(netPriceUsd('agency', 'year') - cost).toBeCloseTo(-150.21, 2)
    // The monthly price still carries it, which is the whole of the
    // difference between the two intervals on this tier.
    expect(netPriceUsd('agency', 'month') - cost).toBeGreaterThan(0)
    // At the old $649 annual price ($630.15 net) the same cost is a $538
    // loss per month — and that is with the 2026-09-07 bands; at 3,000 GB it
    // is $958, and the real figure before the form band was bounded was
    // unbounded.
    expect(netOfProcessorFee(649, true) - cost).toBeLessThan(-530)
    expect(netOfProcessorFee(649, true) - (cost - tierCostTerms('agency').bandwidth + 3000 * VIEWS_PER_GB * ORG_COGS_UNIT_RATES_USD.perPageView)).toBeLessThan(-950)
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
   * subscription to bill an overage onto — so its band is a pure give. At the
   * $0.0001 per page view the platform read until 2026-09-09, 5 GB was $0.88
   * a month per free org against no revenue and 2 GB was $0.36; at the
   * re-pegged $0.00016153846 the same 2 GB is $0.56, and still covers roughly
   * 3,500 page views, which is more than enough to evaluate the product.
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

  it('costs what the give is worth, at the platform\'s own rate', () => {
    const monthlyCostUsd =
      PLAN_ENTITLEMENTS.free.bandwidthGb * VIEWS_PER_GB * ORG_COGS_UNIT_RATES_USD.perPageView
    expect(monthlyCostUsd).toBeCloseTo(0.56, 2)
    // …and the band still buys a usable evaluation.
    expect(PLAN_ENTITLEMENTS.free.bandwidthGb * VIEWS_PER_GB).toBeGreaterThan(3_000)
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
   * The 2026-09-09 re-peg removed the loss — 1,000 views now bill $0.21
   * against about $0.16 — and the ceiling stays at 3x anyway. It was never a
   * margin instrument: a scraper or a hotlinked asset bills the account holder
   * for traffic they did not ask for, and the cap is what bounds that.
   */
  it('the abuse CEILING is 3x the band, floored, from the entitlement', () => {
    expect(BANDWIDTH_ABUSE_CEILING_MULTIPLE).toBe(3)
    const free = checkBandwidthAbuseCeiling({ plan: 'free' } as never, 0)
    // Free's 2 GB is ~3,495 views, and 3x that is far under the 100,000
    // floor — so the floor is what governs, which is the point of having one.
    expect(free.ceiling).toBe(BANDWIDTH_ABUSE_CEILING_FLOOR)
    // A tier whose band clears the floor derives its ceiling from the band,
    // and moving the band moves it. Agency: 1,540 GB of views x 3.
    const agency = checkBandwidthAbuseCeiling({ plan: 'agency' } as never, 0)
    expect(agency.ceiling).toBe(
      Math.round(
        PLAN_ENTITLEMENTS.agency.bandwidthGb *
          VIEWS_PER_GB *
          BANDWIDTH_ABUSE_CEILING_MULTIPLE,
      ),
    )
    expect(agency.ceiling).toBe(8_074_035)
    // MUTATION: at the 3,000 GB band and the 10x multiple the ceiling was
    // 52.4M views — six and a half times what it is now. Nothing was
    // hardcoded to hold the old figure.
    expect(agency.ceiling).toBeLessThan(Math.round(3_000 * VIEWS_PER_GB * 10) / 6)
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
      (METERED_UNIT_RATES_USD.perPageView * METERED_MARKUP -
        METERED_UNIT_RATES_USD.perPageView) /
      (METERED_UNIT_RATES_USD.perPageView * METERED_MARKUP)
    expect(margin).toBeCloseTo(0.2308, 4)
    expect(METERED_MARKUP).toBe(1.3)
  })

  it('carries the three pass-through rates as published', () => {
    expect(METERED_UNIT_RATES_USD.storagePerGbMonth).toBe(0.026)
    // Untouched by the 2026-09-07 band resize; re-pegged on 2026-09-09 by the
    // page-weight decision, which is the one change on this axis that is a
    // customer-facing price and not a capacity one.
    expect(METERED_UNIT_RATES_USD.perPageView).toBe(0.00016153846)
    expect(METERED_UNIT_RATES_USD.perFormSubmission).toBe(0.00005)
    // …and still identical to the COGS table, which is the pairing both the
    // 2026-08-09 correction and the 2026-09-09 re-peg had to change in two
    // places at once.
    for (const key of ['storagePerGbMonth', 'perPageView', 'perFormSubmission'] as const) {
      expect(`${key}: ${METERED_UNIT_RATES_USD[key]}`).toBe(
        `${key}: ${ORG_COGS_UNIT_RATES_USD[key]}`,
      )
    }
  })

  /**
   * THE RATE THE MODEL NOW READS IS THE MEASURED ONE, and this is what the
   * model said before it did.
   *
   * Until 2026-09-09 this case mutated `perPageView` to the figure the
   * measured page implied and pinned the result as a warning: at that rate
   * every paid tier would be under water at the annual price, Starter
   * included. The re-peg made it the live rate, so the mutation runs the
   * other way now — back to the $0.0001 the meter carried while it was
   * calibrated against a 627 KB page.
   *
   * Kept, rather than deleted with the gap it recorded, because it is the one
   * case that proves the ladder above responds to THIS rate and not to a
   * constant that happens to sit beside it. It also holds the size of the
   * move: 61.5% on the rate is 30 to 35 points of annual margin on every
   * tier, which is the number a re-pricing conversation starts from.
   */
  it('MUTATION: at the rate the meter carried until 2026-09-09, the annual ladder cleared', () => {
    const rates = ORG_COGS_UNIT_RATES_USD as unknown as Record<string, number>
    const original = rates.perPageView
    let atOldRate: Record<string, [number, number]>
    try {
      rates.perPageView = 0.0001
      atOldRate = Object.fromEntries(
        PAID.map((plan) => [plan, [pct(plan, 1, 'month'), pct(plan, 1, 'year')]]),
      )
    } finally {
      rates.perPageView = original
    }
    expect(atOldRate).toEqual({
      starter: [53.1, 30],
      pro: [29.3, 0.4],
      business: [27.9, 0.3],
      scale: [27.8, 0.8],
      advanced: [25.3, 1.3],
      agency: [19.9, 1.5],
    })
    // …and the rate really was restored, or every pin above this line would
    // be the next run's surprise.
    expect(ORG_COGS_UNIT_RATES_USD.perPageView).toBe(0.00016153846)
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
    expect(allowance.formSubmissions).toBe(
      PLAN_ENTITLEMENTS.agency.hostLimit *
        PLAN_ENTITLEMENTS.agency.formSubmissionsPerMonth,
    )
    // Finite, where it used to be `Infinity` — an org-wide form band that no
    // amount of usage could exceed billed nothing, ever.
    expect(Number.isFinite(allowance.formSubmissions)).toBe(true)
  })
})
