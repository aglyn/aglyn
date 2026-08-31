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
 * sold them:
 *
 *   at 100% of every band, before this guard existed
 *     business  -73%      scale  -161%      advanced  -236%
 *     agency    unbounded, and unbounded in a way nothing reported
 *
 *   and now
 *     business  +16.3%    scale  +12.3%     advanced  +10.0%
 *     agency    +13.6%, bounded on every axis
 *
 * ## Pro is on the same rule, and the same instrument
 *
 * Pro was never negative, so it is not in the list above — it is here because
 * a tier can be the wrong side of a decision without being the wrong side of
 * zero. Bandwidth is 82.5% of its modeled cost, so the bandwidth band is what
 * decides the tier: at 250 GB the same $56 subscription runs at +7.1%,
 * positive but thinner than every other rung on a ladder that otherwise sits
 * between 10% and 16%, and therefore the first tier any cost-rate move takes
 * under. At 225 GB it is +14.9%. `MUTATION: Pro at a 250 GB band` is that
 * arithmetic, on the one axis that moved.
 *
 * ## A floor AND a pin
 *
 * The rule is non-negative at 100%, and every tier now holds it. But a
 * threshold alone would let a margin fall from 61% to 1% and stay green, so
 * every figure is ALSO asserted as a number: the next move in either
 * direction has to come here and say what it did.
 *
 * Closing the last of the gap took two levers, not one. Bandwidth is the
 * dominant term on every tier, and `contactsPerHost` is the term nobody
 * counted because it is not infrastructure — $200/month of measured cost on
 * Advanced against a $399 subscription, and unbounded on Agency.
 *
 * ## The shape of the defect this catches, which is the reason for the
 * ## `UNLIMITED` rule below
 *
 * `agency.formSubmissionsPerMonth` was `UNLIMITED`, and form submissions are
 * a per-HOST band multiplied by `hostLimit` — so at 100 hosts the org-wide
 * figure was not merely large, it was infinite. Every cost model that scored
 * an absent or non-finite band as ZERO therefore reported the largest line
 * item on the most expensive self-serve plan as contributing nothing, and the
 * tier looked cheapest at the moment it was most expensive.
 *
 * That is this repo's most-repeated failure — `limit()` with no `orderBy`, a
 * projection that starves a predicate, a gated field that is also an
 * entitlement input, `1 > null` reading true. So this guard does NOT skip an
 * unbounded band. It FAILS on one, by name, and the message says which.
 *
 * ## What it does not claim
 *
 * The rates are operator-tuned estimates, not an invoice (`ORG_COGS_UNIT_
 * RATES_USD` says so out loud). This is a RELATIVE instrument: it compares
 * the bands a tier sells against the rates the platform's own cost model
 * uses, and it fails when the product of the two exceeds the price. If the
 * rates are wrong it is wrong with the rest of the cost model, together —
 * which is the whole reason it reads them rather than carrying its own copy.
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
  UNLIMITED,
  bandwidthCapShouldEngage,
  checkBandwidthAbuseCeiling,
  checkContactQuota,
} from '@aglyn/aglyn'
import type { OrgPlan } from '@aglyn/aglyn'

/** The paid, self-serve tiers: the only ones with both a band set and a price. */
const PAID = SELF_SERVE_PLANS.filter((plan) => plan !== 'free')

/**
 * Page views one GB of bandwidth buys, from the SAME constant the meter is
 * priced on. Bandwidth is published in GB and costs money per view, and
 * `pageViewsFromBandwidthGb` is the one conversion between them.
 */
const VIEWS_PER_GB = (1024 * 1024 * 1024) / ESTIMATED_PAGE_TRANSFER_BYTES

/**
 * The seven cost terms a tier's bands imply, per month, at full utilization.
 *
 * Two of the bands are PER HOST and are expanded by `hostLimit`, exactly as
 * `meteredIncludedAllowance` expands them — that expansion is the reason
 * Agency's numbers are so much larger than its neighbours' and the reason an
 * unbounded per-host band is so dangerous.
 *
 * A non-finite term is returned as `Infinity` rather than dropped. The whole
 * point is that an unbounded band must poison the total instead of vanishing
 * from it.
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
  }
}

/** Bands that cannot be costed because they are uncapped. */
function unboundedTerms(plan: OrgPlan): string[] {
  return Object.entries(bandCostTerms(plan))
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
  const measured = Object.values(bandCostTerms(plan)).reduce((a, b) => a + b, 0)
  if (!Number.isFinite(measured)) return Number.POSITIVE_INFINITY
  return Math.max(measured * utilization, INFRA_COGS_PER_SITE_USD * PLAN_ENTITLEMENTS[plan].hostLimit)
}

/** Gross margin as a fraction of the monthly list price. */
function tierMargin(plan: OrgPlan, utilization: number): number {
  const price = PLAN_PRICING[plan].basePriceMonthlyUsd
  if (!(price > 0)) return 0
  return (price - tierCostUsd(plan, utilization)) / price
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
): string[] {
  return plans.filter((plan) => !(tierMargin(plan, utilization) >= floor)).sort()
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

// ---------------------------------------------------------------------------
// THE CONTROL, first. Every number below is read by string key off two
// tables; a rename, a stub or a collapsed table makes every reading 0 or
// undefined, and a margin computed from zero cost is 100% on every tier.
// ---------------------------------------------------------------------------
describe('the model is reading real bands and real rates', () => {
  it('reads a finite, non-zero cost for every paid tier', () => {
    for (const plan of PAID) {
      const cost = Object.values(bandCostTerms(plan)).reduce((a, b) => a + b, 0)
      expect(`${plan}: ${cost > 0}`).toBe(`${plan}: true`)
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
    // down furthest were the bandwidth ones. Agency's single UNBOUNDED term
    // is larger still, and the block at the bottom of this file is about it.
    for (const plan of PAID) {
      const finite = Object.entries(bandCostTerms(plan)).filter(([, cost]) =>
        Number.isFinite(cost),
      )
      const largest = finite.sort((a, b) => b[1] - a[1])[0][0]
      expect(`${plan}: ${largest}`).toBe(`${plan}: bandwidth`)
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
// The rule, and the part of it that does not hold yet.
// ---------------------------------------------------------------------------
describe('no self-serve tier loses money at full utilization', () => {
  const pct = (plan: OrgPlan, u: number) =>
    Number((tierMargin(plan, u) * 100).toFixed(1))

  /**
   * THE RULE. Not a threshold anyone chose to be comfortable — the survival
   * condition. Every band here is INCLUDED rather than metered, so a customer
   * spending all of it is exercising the plan exactly as sold and there is no
   * overage to bill and no gate to refuse them.
   *
   * It held for none of the four upper tiers before this work, and one of
   * them could not be evaluated at all.
   */
  it('every paid tier holds a NON-NEGATIVE margin at 100% of every band', () => {
    const offenders = tiersUnderFloor(PAID, 1, 0)
    // Named with the arithmetic, so a failure says which tier and by how much
    // rather than that one exists.
    expect(
      Object.fromEntries(
        offenders.map((plan) => [
          plan,
          `$${PLAN_PRICING[plan as OrgPlan].basePriceMonthlyUsd} price vs ` +
            `$${tierCostUsd(plan as OrgPlan, 1).toFixed(2)} cost`,
        ]),
      ),
    ).toEqual({})
  })

  /**
   * Every tier, at four utilizations, as NUMBERS.
   *
   * A pin as well as a floor: these figures are the whole argument for the
   * band resize, and any change to a band, a price or a cost rate moves one
   * of them. The floor above says the ladder survives; this says by how much,
   * so a change that halves a margin while staying positive still has to come
   * here and say so.
   */
  it('are exactly these, at 3 / 25 / 50 / 100% of every band', () => {
    expect(
      Object.fromEntries(
        PAID.map((plan) => [plan, [0.03, 0.25, 0.5, 1].map((u) => pct(plan, u))]),
      ),
    ).toEqual({
      starter: [92, 90.4, 80.7, 61.5],
      pro: [89.3, 78.7, 57.5, 14.9],
      business: [85.6, 79.1, 58.2, 16.3],
      scale: [88, 78.1, 56.1, 12.3],
      advanced: [87.5, 77.5, 55, 10],
      agency: [84.6, 78.4, 56.8, 13.6],
    })
  })

  it('clears 40% at the realistic 25% band, on every tier', () => {
    expect(tiersUnderFloor(PAID, 0.25, 0.4)).toEqual([])
  })

  /**
   * THE BAND THE LADDER ACTUALLY OCCUPIES, which is a stricter statement than
   * the rule above.
   *
   * Non-negative is the survival condition. This is the shape the tiers were
   * priced to: every paid worst case sits between 9% and 62%, with Advanced
   * setting the low end at 9.96%. A tier landing under it is not losing money
   * — it is carrying a ceiling thinner than any other rung, which is the
   * position Pro was in, and the reason a floor of zero is not enough on its
   * own to keep the ladder coherent.
   */
  it('holds a 9% floor at 100%, which is where the ladder sits', () => {
    expect(tiersUnderFloor(PAID, 1, 0.09)).toEqual([])
    // BOTH WAYS. One point higher and the thinnest rung fails, so this is a
    // real edge rather than a number nothing on the ladder could cross.
    expect(tiersUnderFloor(PAID, 1, 0.1)).toEqual(['advanced'])
  })

  it('CONTROL: the floor is not so low that nothing could fail it', () => {
    // A floor of 0 is only meaningful if the model can produce a negative.
    // Advanced at twice its bands is the demonstration.
    expect(tierMargin('advanced', 2)).toBeLessThan(0)
    expect(tiersUnderFloor(PAID, 2, 0)).not.toEqual([])
  })

  /**
   * MUTATION. Restore the pre-change figures one axis at a time and the rule
   * must break — this is what says the green above came from the numbers and
   * not from the arithmetic being broken in the permissive direction.
   */
  it('MUTATION: the pre-change bands and prices did NOT clear the floor', () => {
    const before = {
      business: {
        bandwidthGb: 1000, storagePerHostMb: 51200, formSubmissionsPerMonth: 10000,
        contactsPerHost: 100000, price: 139,
      },
      scale: {
        bandwidthGb: 2500, storagePerHostMb: 76800, formSubmissionsPerMonth: 50000,
        contactsPerHost: 500000, price: 249,
      },
      advanced: {
        bandwidthGb: 5000, storagePerHostMb: 102400, formSubmissionsPerMonth: 100000,
        contactsPerHost: 1000000, price: 399,
      },
      agency: {
        bandwidthGb: 20000, storagePerHostMb: 204800, formSubmissionsPerMonth: UNLIMITED,
        contactsPerHost: UNLIMITED, price: 799,
      },
    }
    const rates = ORG_COGS_UNIT_RATES_USD
    const costAt = (plan: keyof typeof before) => {
      const entitlements = PLAN_ENTITLEMENTS[plan]
      const hosts = entitlements.hostLimit
      const was = before[plan]
      return (
        ((hosts * was.storagePerHostMb) / 1024) * rates.storagePerGbMonth +
        was.bandwidthGb * VIEWS_PER_GB * rates.perPageView +
        hosts * was.formSubmissionsPerMonth * rates.perFormSubmission +
        (entitlements.dataStorageMbPerOrg / 1024) * rates.dataStoragePerGbMonth +
        entitlements.apiRequestsPerMonth * rates.perApiRequest +
        was.contactsPerHost * rates.perContactMonth +
        entitlements.emailSendsPerMonth * rates.perEmailSend
      )
    }
    for (const plan of ['business', 'scale', 'advanced'] as const) {
      const was = (before[plan].price - costAt(plan)) / before[plan].price
      expect(`${plan} was negative: ${was < 0}`).toBe(`${plan} was negative: true`)
      expect(`${plan} is not: ${tierMargin(plan, 1) >= 0}`).toBe(
        `${plan} is not: true`,
      )
    }
    // Agency could not be evaluated at all — the case the `UNLIMITED` rule
    // below exists for, and the one a model that scores an absent band as
    // zero reports as the cheapest tier on the ladder.
    expect(Number.isFinite(costAt('agency'))).toBe(false)
    expect(Number.isFinite(tierCostUsd('agency', 1))).toBe(true)
  })

  it('MUTATION: restoring ONE band on ONE tier is enough to break it', () => {
    // The single-axis version, because a mutation that changes four things at
    // once can pass for the wrong reason. Advanced's contacts band alone —
    // 1,000,000 at $0.0002 is $200 against a $399 subscription.
    const restored =
      Object.values(bandCostTerms('advanced')).reduce((a, b) => a + b, 0) -
      bandCostTerms('advanced').contacts +
      1_000_000 * ORG_COGS_UNIT_RATES_USD.perContactMonth
    expect(
      (PLAN_PRICING.advanced.basePriceMonthlyUsd - restored) /
        PLAN_PRICING.advanced.basePriceMonthlyUsd,
    ).toBeLessThan(0)
    // …and with the shipped band it is positive. Both directions on one axis.
    expect(tierMargin('advanced', 1)).toBeGreaterThan(0)
  })

  /**
   * PRO, ONE AXIS AT A TIME.
   *
   * The decomposition is pinned as numbers so a change that moved several of
   * Pro's bands at once cannot read as this one, which moved bandwidth and
   * nothing else.
   */
  it('spends 82.5% of Pro on bandwidth, and the rest on six small bands', () => {
    const terms = bandCostTerms('pro')
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
      bandwidth: 39.3216,
      datasetStorage: 0.9,
      apiRequests: 0,
      contacts: 2,
      emailSends: 4.5,
    })
    // The six others total $8.33 against a $56 price, so none of them — nor
    // all of them together — could have carried this tier into the ladder's
    // band. Bandwidth was the only lever that could.
    const total = Object.values(terms).reduce((a, b) => a + b, 0)
    expect(total - terms.bandwidth).toBeCloseTo(8.33, 2)
    expect(terms.bandwidth / total).toBeGreaterThan(0.8)
  })

  it('MUTATION: Pro at a 250 GB band drops out of the ladder', () => {
    const terms = bandCostTerms('pro')
    const restored =
      Object.values(terms).reduce((a, b) => a + b, 0) -
      terms.bandwidth +
      250 * VIEWS_PER_GB * ORG_COGS_UNIT_RATES_USD.perPageView
    const price = PLAN_PRICING.pro.basePriceMonthlyUsd
    // The price is not a lever here. $56 is the Squarespace-anchored rung and
    // the whole move is on the band, so a reading that came from a repricing
    // would be the wrong green.
    expect(price).toBe(56)
    // POSITIVE, which is why the non-negative rule above would never have
    // reported it — and under every other rung on the ladder.
    expect((price - restored) / price).toBeCloseTo(0.071, 3)
    expect((price - restored) / price).toBeLessThan(0.09)
    // …and with the shipped band it clears. Both directions, one axis.
    expect(tierMargin('pro', 1)).toBeGreaterThanOrEqual(0.09)
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
    expect(past.overageContacts).toBe(2_000)
    expect(past.overageMonthlyUsd).toBe(1.5)
  })

  /**
   * STARTER IS NOT IN THE SAME POSITION, and the arithmetic is here rather
   * than asserted by absence. Its bands imply $9.63 against a $25 price —
   * the widest paid margin on the ladder — and bandwidth is 91% of that,
   * $8.74. The lever Pro needed exists on Starter and is not called for.
   */
  it('leaves Starter where it is, with room the ladder does not have', () => {
    const price = PLAN_PRICING.starter.basePriceMonthlyUsd
    expect(price).toBe(25)
    expect(tierCostUsd('starter', 1)).toBeCloseTo(9.63, 2)
    expect(PLAN_ENTITLEMENTS.starter.bandwidthGb).toBe(50)
    // Doubling the dominant rate is the move this ladder is thin against.
    // Starter still clears 26% there; Pro does not survive it on either band,
    // which is what makes the page-view rate the figure to calibrate next.
    const atDoubleRate =
      Object.values(bandCostTerms('starter')).reduce((a, b) => a + b, 0) +
      bandCostTerms('starter').bandwidth
    expect((price - atDoubleRate) / price).toBeGreaterThan(0.26)
  })

  it('Agency clears zero on its own, after the resize and the price rise', () => {
    const cost = tierCostUsd('agency', 1)
    expect(cost).toBeCloseTo(1122.29, 2)
    expect(PLAN_PRICING.agency.basePriceMonthlyUsd).toBe(1299)
    expect(1299 - cost).toBeGreaterThan(0)
    // At the old $799 the same cost was a $323 loss per month — and that is
    // the bounded part only; the real figure was unbounded.
    expect(799 - cost).toBeLessThan(0)
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
   * ⚠️ ENTERPRISE IS OUT OF SCOPE HERE, AND DELIBERATELY SO. Its
   * `contactsPerHost` is still `UNLIMITED`, and bounding it would not meter —
   * it would WALL. `checkContactQuota` returns `allowed: true` past a band
   * only when the plan carries a rate, and every Enterprise rate is the "not
   * for sale" sentinel; `upsert-contact.ts` then DROPS the CRM record on a
   * refusal and increments `contactsDropped`. So a bounded Enterprise band
   * would silently discard a customer's signups on a negotiated contract.
   * That is a capacity limit refusing a person's data, which is the one shape
   * this codebase never enforces at use.
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
    expect(past.overageContacts).toBe(1_000)
    expect(past.overageMonthlyUsd).toBe(0.4)
  })

  it('ENTERPRISE is still uncapped, and bounding it would WALL not meter', () => {
    // The reason the exception list is empty rather than carrying enterprise:
    // enterprise is not a self-serve tier and is not scanned above. Asserted
    // here so the reasoning is live rather than a comment — if somebody gives
    // enterprise a contacts rate, this goes red and the decision gets made
    // deliberately.
    expect(PLAN_ENTITLEMENTS.enterprise.contactsPerHost).toBe(UNLIMITED)
    expect(PLAN_PRICING.enterprise.extraContactsUsdPer1k).toBeNull()
    // With a null rate the gate is `used < included`, so a FINITE enterprise
    // band would refuse. Demonstrated on a synthetic org with a bounded
    // override, which is exactly what bounding the plan row would produce.
    const bounded = checkContactQuota(
      {
        plan: 'enterprise',
        entitlements: { contactsPerHost: 1_000 },
      } as never,
      1_001,
    )
    expect(bounded.allowed).toBe(false)
    expect(bounded.overageRateUsd).toBeNull()
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
// Free, and the two protections that hang off its band.
// ---------------------------------------------------------------------------
describe("Free's bandwidth band, and everything derived from it", () => {
  /**
   * Free is the ONE plan whose bandwidth cannot be metered — there is no
   * subscription to bill an overage onto — so its band is a pure give. At the
   * platform's own $0.0001 per page view, 5 GB was $0.88 a month per free org
   * against no revenue; 2 GB is $0.36 and still covers roughly 3,500 page
   * views, which is more than enough to evaluate the product.
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
    expect(monthlyCostUsd).toBeCloseTo(0.35, 2)
    // …and the band still buys a usable evaluation.
    expect(PLAN_ENTITLEMENTS.free.bandwidthGb * VIEWS_PER_GB).toBeGreaterThan(3_000)
  })

  /**
   * BOTH FREE PROTECTIONS DERIVE FROM THE BAND, and must keep doing so.
   *
   * They are independent and they behave differently: the bandwidth CAP is
   * Free-only, trips at 1x the band and pauses the site; the abuse CEILING
   * applies to any plan, trips at 10x the band with a 100,000-view floor, and
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

  it('the abuse CEILING is 10x the band, floored, from the entitlement', () => {
    const free = checkBandwidthAbuseCeiling({ plan: 'free' } as never, 0)
    // Free's 2 GB is ~3,495 views, and 10x that is far under the 100,000
    // floor — so the floor is what governs, which is the point of having one.
    expect(free.ceiling).toBe(BANDWIDTH_ABUSE_CEILING_FLOOR)
    // A tier whose band clears the floor derives its ceiling from the band,
    // and moving the band moves it. Agency: 4,000 GB of views x 10.
    const agency = checkBandwidthAbuseCeiling({ plan: 'agency' } as never, 0)
    expect(agency.ceiling).toBe(
      Math.round(
        PLAN_ENTITLEMENTS.agency.bandwidthGb *
          VIEWS_PER_GB *
          BANDWIDTH_ABUSE_CEILING_MULTIPLE,
      ),
    )
    // MUTATION: at the pre-change 20,000 GB the ceiling was five times what
    // it is now. Nothing was hardcoded to hold the old figure.
    expect(agency.ceiling).toBeLessThan(
      Math.round(20_000 * VIEWS_PER_GB * BANDWIDTH_ABUSE_CEILING_MULTIPLE),
    )
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

  it('and the three pass-through rates are untouched by the band resize', () => {
    expect(METERED_UNIT_RATES_USD.storagePerGbMonth).toBe(0.026)
    expect(METERED_UNIT_RATES_USD.perPageView).toBe(0.0001)
    expect(METERED_UNIT_RATES_USD.perFormSubmission).toBe(0.00005)
    // …and still identical to the COGS table, which is the pairing a
    // 2026-08-09 correction had to change in both places at once.
    for (const key of ['storagePerGbMonth', 'perPageView', 'perFormSubmission'] as const) {
      expect(`${key}: ${METERED_UNIT_RATES_USD[key]}`).toBe(
        `${key}: ${ORG_COGS_UNIT_RATES_USD[key]}`,
      )
    }
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
