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
 * ## It PINS, it does not repair
 *
 * Three tiers are still negative at 100% and this file says so exactly,
 * rather than choosing a threshold they happen to clear. An entitlement is
 * what a price bought, so closing the last of the gap is a pricing decision
 * with a published table behind it — the same posture
 * `email-ceiling-dimensioning.spec.ts` takes toward the ceiling it cannot
 * repair from inside a test. Every figure is asserted as a NUMBER, so the
 * next move in either direction has to come here and say what it did.
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
describe('the tier margins, pinned as numbers', () => {
  const pct = (plan: OrgPlan, u: number) =>
    Number((tierMargin(plan, u) * 100).toFixed(1))

  /**
   * Every bounded tier, at four utilizations. A PIN rather than a threshold:
   * these figures are the whole argument for the band resize, and any change
   * to a band, a price or a cost rate moves one of them.
   */
  it('are exactly these, at 3 / 25 / 50 / 100% of every band', () => {
    expect(
      Object.fromEntries(
        BOUNDED.map((plan) => [plan, [0.03, 0.25, 0.5, 1].map((u) => pct(plan, u))]),
      ),
    ).toEqual({
      starter: [92, 90.4, 80.7, 61.5],
      pro: [89.3, 76.8, 53.6, 7.1],
      business: [85.6, 74.1, 48.3, -3.4],
      scale: [88, 66.5, 33.1, -33.9],
      advanced: [87.5, 61.4, 22.7, -54.5],
    })
  })

  it('clear 40% at the realistic 25% band', () => {
    // The business condition, and the one every bounded tier now meets.
    expect(tiersUnderFloor(BOUNDED, 0.25, 0.4)).toEqual([])
  })

  it('clear zero at 50%, which the pre-change bands did not', () => {
    expect(tiersUnderFloor(BOUNDED, 0.5, 0)).toEqual([])
  })

  /**
   * ⚠️ FULL UTILIZATION IS NOT YET SAFE, AND THAT IS PINNED RATHER THAN
   * REPAIRED (2026-08-30).
   *
   * Three tiers still go negative when every band is spent at once, and one
   * term is why: `contactsPerHost` prices at $0.0002 a contact-month, so the
   * included audience alone costs $20 at Business, $100 at Scale and $200 at
   * Advanced — 14%, 40% and 50% of the subscription, from a band nobody
   * counted because it is not infrastructure.
   *
   * It is NOT repaired here. The contacts band is an audience, and an
   * audience band is what an upgrade path is built on; moving it is a
   * six-place pricing decision with a published table behind it, exactly the
   * kind `email-ceiling-dimensioning.spec.ts` refuses to make from inside a
   * test. So the failing relation is pinned instead — the set of tiers that
   * go negative at 100% is asserted EXACTLY, which makes this red the moment
   * the set changes in either direction: a new tier joining it, or the
   * decision being taken and a tier leaving.
   *
   * The direction of travel is already large. At the pre-change bands the
   * same three read -58%, -121% and -186%; they now read -3.4%, -33.9% and
   * -54.5%, and Business is within $5 of break-even at a utilization nobody
   * reaches.
   */
  const NEGATIVE_AT_FULL_UTILIZATION = ['advanced', 'business', 'scale']

  it('pins which tiers still go negative at 100%, exactly', () => {
    expect(tiersUnderFloor(BOUNDED, 1, 0)).toEqual(NEGATIVE_AT_FULL_UTILIZATION)
  })

  it('measures how much of each gap the contacts band is', () => {
    // "Contacts is why" as arithmetic rather than as a claim, and stated per
    // tier because the answer differs: removing that one term clears Business
    // and Scale outright, and closes most but not all of Advanced's gap. That
    // distinction is the thing whoever takes the decision needs — Advanced
    // needs the contacts band AND something else.
    const clearedWithoutContacts = (NEGATIVE_AT_FULL_UTILIZATION as OrgPlan[])
      .filter((plan) => {
        const terms = bandCostTerms(plan)
        const without =
          Object.values(terms).reduce((a, b) => a + b, 0) - terms.contacts
        return PLAN_PRICING[plan].basePriceMonthlyUsd - without > 0
      })
      .sort()
    expect(clearedWithoutContacts).toEqual(['business', 'scale'])
    // On all three it is a large share of the price, not a rounding
    // difference — 14%, 40% and 50% respectively.
    for (const plan of NEGATIVE_AT_FULL_UTILIZATION as OrgPlan[]) {
      const share =
        bandCostTerms(plan).contacts / PLAN_PRICING[plan].basePriceMonthlyUsd
      expect(`${plan}: ${share > 0.1}`).toBe(`${plan}: true`)
    }
  })

  it('Starter and Pro clear zero even at full utilization', () => {
    // The two tiers that did not move at all. Without them the pin above
    // would be satisfied by a ladder where everything loses money.
    expect(pct('starter', 1)).toBeGreaterThan(0)
    expect(pct('pro', 1)).toBeGreaterThan(0)
  })

  /**
   * MUTATION. Restore the pre-change bands and prices and the model must be
   * far worse — this is what says the green above came from the numbers and
   * not from the arithmetic being broken in the permissive direction.
   */
  it('MUTATION: the pre-change bands were negative from 25% upward', () => {
    const before = {
      business: { bandwidthGb: 1000, storagePerHostMb: 51200, formSubmissionsPerMonth: 10000, price: 139 },
      scale: { bandwidthGb: 2500, storagePerHostMb: 76800, formSubmissionsPerMonth: 50000, price: 249 },
      advanced: { bandwidthGb: 5000, storagePerHostMb: 102400, formSubmissionsPerMonth: 100000, price: 399 },
      agency: { bandwidthGb: 20000, storagePerHostMb: 204800, formSubmissionsPerMonth: UNLIMITED, price: 799 },
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
        entitlements.contactsPerHost * rates.perContactMonth +
        entitlements.emailSendsPerMonth * rates.perEmailSend
      )
    }
    for (const plan of ['business', 'scale', 'advanced'] as const) {
      const wasFull = (before[plan].price - costAt(plan)) / before[plan].price
      const nowFull = tierMargin(plan, 1)
      // Deeply negative at full utilization before, and much less so now —
      // the improvement is the assertion, because the sign has not flipped
      // yet on these three and pretending otherwise would be the failure
      // this whole file is about.
      expect(`${plan} was under -50%: ${wasFull < -0.5}`).toBe(
        `${plan} was under -50%: true`,
      )
      expect(`${plan} improved: ${nowFull > wasFull}`).toBe(
        `${plan} improved: true`,
      )
      // And at the utilization a real customer reaches, the sign HAS flipped.
      const wasHalf = (before[plan].price - costAt(plan) * 0.5) / before[plan].price
      expect(`${plan} improved at 50%: ${tierMargin(plan, 0.5) > wasHalf}`).toBe(
        `${plan} improved at 50%: true`,
      )
    }
    // Scale and Advanced were negative at HALF utilization before, and are
    // positive there now. Business was the one already just above water.
    for (const plan of ['scale', 'advanced'] as const) {
      const wasHalf = (before[plan].price - costAt(plan) * 0.5) / before[plan].price
      expect(`${plan} was negative at 50%: ${wasHalf < 0}`).toBe(
        `${plan} was negative at 50%: true`,
      )
      expect(`${plan} is positive at 50%: ${tierMargin(plan, 0.5) > 0}`).toBe(
        `${plan} is positive at 50%: true`,
      )
    }
    // Agency's whole model was unbounded, not merely negative — the case the
    // rule below exists for.
    expect(Number.isFinite(costAt('agency'))).toBe(false)
  })

  it('Agency clears zero at full utilization on every BOUNDED term', () => {
    // What the resize and the price rise bought, measured on the part of the
    // model that can be measured. $1,197 of bounded cost against $1,299.
    const terms = bandCostTerms('agency')
    const bounded = Object.values(terms)
      .filter((cost) => Number.isFinite(cost))
      .reduce((a, b) => a + b, 0)
    expect(bounded).toBeCloseTo(1197.05, 2)
    expect(PLAN_PRICING.agency.basePriceMonthlyUsd).toBe(1299)
    expect(1299 - bounded).toBeGreaterThan(0)
    // At the old $799 the same bounded cost was a $398 loss per month.
    expect(799 - bounded).toBeLessThan(0)
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
   * ⚠️ THE ONE REMAINING EXCEPTION, NAMED AND DATED (2026-08-30).
   *
   * `agency.contactsPerHost` is `UNLIMITED`, so Agency's cost model is still
   * unbounded on one axis — at `perContactMonth` of $0.0002 an Agency org
   * with five million contacts costs $1,000/month in contacts alone.
   *
   * It is NOT bounded here, and that is a decision rather than an oversight.
   * Bounding it makes `extraContactsUsdPer1k` mandatory by the paired rule
   * (`plan-entitlements.spec.ts`: a finite band with no rate is silently
   * free), and Agency's rate is deliberately `null` BECAUSE the band is
   * uncapped (AGL-2439) — so the two move together or not at all, and that
   * pair is a published claim on `/pricing` in both directions.
   *
   * The exception is written down, asserted to be the ONLY one, and asserted
   * to be about contacts specifically. It cannot grow silently, and it cannot
   * be widened to cover the next unbounded band somebody adds.
   */
  const UNBOUNDED_BY_DECISION: Record<string, string[]> = {
    agency: ['contacts'],
  }

  it('has exactly one uncapped cost term left, and it is the recorded one', () => {
    const found = Object.fromEntries(
      PAID.map((plan) => [plan, unboundedTerms(plan)]).filter(
        ([, terms]) => (terms as string[]).length > 0,
      ),
    )
    expect(found).toEqual(UNBOUNDED_BY_DECISION)
  })

  it('records a reason for it, and the reason is about the pairing', () => {
    // A rate on an uncapped band advertises a fee that cannot be charged;
    // `Math.max(0, used - Infinity)` is 0 at every usage level. Both halves
    // are asserted so the exception cannot be closed on one side alone.
    expect(PLAN_ENTITLEMENTS.agency.contactsPerHost).toBe(UNLIMITED)
    expect(PLAN_PRICING.agency.extraContactsUsdPer1k).toBeNull()
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
