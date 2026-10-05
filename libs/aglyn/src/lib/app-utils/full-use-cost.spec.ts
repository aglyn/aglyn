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

import {
  FULL_USE_DISCOUNT_MULTIPLE,
  FULL_USE_QUOTE_MULTIPLE,
  SEAT_COGS_USD_PER_MONTH,
  deepestCouponPercentWithinFullUse,
  describeDiscountFullUse,
  describeFullUseFloor,
  discountReach,
  fullUseCogs,
  fullUseMonthlyCogsUsd,
  orgDiscountFullUse,
  orgFullUseCogs,
  orgFullUseFloor,
  rateAgainstFullUse,
  rateCouponAgainstFullUse,
} from './full-use-cost'
import {
  INFRA_COGS_PER_SITE_USD,
  NET_MARGIN_FLOOR_PCT,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  SELF_SERVE_PLANS,
  UNLIMITED,
  checkDiscountMargin,
  netOfProcessorFee,
  resolveOrgEntitlements,
} from './plan-entitlements'

// The model itself — every term against an independent multiplication, on
// every plan — is held by `apps/console/specs/tier-margin-floor.spec.ts`.
// This file holds the guards built on it.

/** A billing org on `plan` at a negotiated monthly price. */
const quoted = (plan: string, customMonthlyUsd: number, interval = 'month') =>
  ({
    plan,
    subscription: { status: 'active', interval, customMonthlyUsd },
  }) as never

/**
 * The lowest whole-cent monthly price that nets, after Stripe, at least
 * `multiple` × `cogs`. The extra cent absorbs the fee's own rounding to the
 * cent, which can otherwise leave the net a fraction of a cent short.
 */
const priceNetting = (multiple: number, cogs: number) =>
  Math.ceil(((multiple * cogs + 0.3) / (1 - 0.029)) * 100) / 100 + 0.01

describe('fullUseCogs', () => {
  it('reads RESOLVED entitlements: an override raises the cost by what it delivers', () => {
    const base = fullUseCogs(PLAN_ENTITLEMENTS.pro)
    const raised = fullUseCogs(
      resolveOrgEntitlements({
        plan: 'pro',
        subscription: { status: 'active' },
        entitlements: { bandwidthGb: PLAN_ENTITLEMENTS.pro.bandwidthGb + 10 },
      } as never),
    )
    expect(raised.breakdown['bandwidth']).toBeGreaterThan(base.breakdown['bandwidth'])
    expect(raised.cogsUsd).toBeGreaterThan(base.cogsUsd)
  })

  it('counts purchased sites and seats, which a band alone does not carry', () => {
    const plain = orgFullUseCogs({ plan: 'pro', subscription: { status: 'active' } } as never)
    const bought = orgFullUseCogs({
      plan: 'pro',
      subscription: { status: 'active' },
      seatAddons: { hosts: 1, managers: 2, members: 3 },
    } as never)
    const pro = PLAN_ENTITLEMENTS.pro
    // One more site brings its per-site collaborators; five more seats beside.
    expect(bought.breakdown['seats'] - plain.breakdown['seats']).toBeCloseTo(
      (pro.membersPerHost + 2 + 3) * SEAT_COGS_USD_PER_MONTH,
      10,
    )
    expect(bought.floorUsd).toBe(plain.floorUsd + INFRA_COGS_PER_SITE_USD)
    expect(bought.cogsUsd).toBeGreaterThan(plain.cogsUsd)
  })

  it('prices an unbounded band as Infinity, names it, and never reads it as free', () => {
    const result = fullUseCogs({ ...PLAN_ENTITLEMENTS.business, apiRequestsPerMonth: UNLIMITED })
    expect(result.cogsUsd).toBe(Number.POSITIVE_INFINITY)
    expect(result.unbounded).toEqual(['apiRequests'])
    // Zero meeting an infinity is not zero either.
    const noHosts = fullUseCogs({ ...PLAN_ENTITLEMENTS.business, hostLimit: UNLIMITED })
    expect(noHosts.cogsUsd).toBe(Number.POSITIVE_INFINITY)
  })

  it('keeps the per-site estimate as a floor, on the sites sold', () => {
    for (const plan of SELF_SERVE_PLANS) {
      const result = fullUseCogs(PLAN_ENTITLEMENTS[plan])
      expect(result.floorUsd).toBe(INFRA_COGS_PER_SITE_USD * PLAN_ENTITLEMENTS[plan].hostLimit)
      expect(result.cogsUsd).toBe(Math.max(result.measuredUsd, result.floorUsd))
    }
  })
})

describe('the enterprise quote floor — cost + 30% net of Stripe', () => {
  const cogs = fullUseMonthlyCogsUsd(PLAN_ENTITLEMENTS.enterprise)

  it('refuses a quote that nets under 1.3× full-use cost', () => {
    const at = priceNetting(FULL_USE_QUOTE_MULTIPLE, cogs)
    const under = orgFullUseFloor(quoted('enterprise', at - 1), {
      multiple: FULL_USE_QUOTE_MULTIPLE,
    })
    expect(under.ok).toBe(false)
    expect(under.coverage).toBeLessThan(1.3)
    expect(describeFullUseFloor(under)).toContain(`1.30× its full-use cost, $${cogs.toFixed(2)}`)
  })

  it('clears a quote that nets 1.3× — and nets it AFTER the fee, at either interval', () => {
    const at = priceNetting(FULL_USE_QUOTE_MULTIPLE, cogs)
    expect(orgFullUseFloor(quoted('enterprise', at), { multiple: FULL_USE_QUOTE_MULTIPLE }).ok).toBe(true)
    // The gross figure itself is not enough: Stripe's 2.9% comes off first.
    const gross = Math.ceil(FULL_USE_QUOTE_MULTIPLE * cogs)
    expect(netOfProcessorFee(gross)).toBeLessThan(FULL_USE_QUOTE_MULTIPLE * cogs)
    expect(orgFullUseFloor(quoted('enterprise', gross), { multiple: FULL_USE_QUOTE_MULTIPLE }).ok).toBe(false)
    expect(
      orgFullUseFloor(quoted('enterprise', at, 'year'), { multiple: FULL_USE_QUOTE_MULTIPLE }).ok,
    ).toBe(true)
  })

  it('cannot be cleared at any price while a band is unbounded', () => {
    const verdict = orgFullUseFloor(
      {
        plan: 'enterprise',
        subscription: { status: 'active', interval: 'month', customMonthlyUsd: 10_000_000 },
        entitlements: { emailSendsPerMonth: UNLIMITED },
      } as never,
      { multiple: FULL_USE_QUOTE_MULTIPLE },
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.unbounded).toEqual(['emailSends'])
    expect(describeFullUseFloor(verdict)).toMatch(/emailSends is unbounded/)
  })
})

describe('the coupon warning — judged on the charges a coupon reaches, never a refusal', () => {
  const proCogs = () => fullUseMonthlyCogsUsd(PLAN_ENTITLEMENTS.pro)
  /** Pro at a price netting exactly cost + 30%, billed `interval`. */
  const proWithHeadroom = (interval = 'month') =>
    quoted('pro', priceNetting(1.3, proCogs()), interval)

  it('lets a ~20% discount spend the margin of a price with headroom, and warns at one that crosses 1.0×', () => {
    const twenty = orgDiscountFullUse(proWithHeadroom(), { percentOff: 20 }, { duration: 'forever' })
    expect(twenty.ok).toBe(true)
    expect(twenty.coverage).toBeGreaterThanOrEqual(1)
    expect(twenty.coverage).toBeLessThan(1.3)
    expect(describeDiscountFullUse(twenty)).toMatch(/^clears full-use cost on every monthly charge/)

    const twentyFive = orgDiscountFullUse(proWithHeadroom(), { percentOff: 25 }, { duration: 'forever' })
    expect(twentyFive.ok).toBe(false)
    expect(twentyFive.coverage).toBeLessThan(1)
    expect(twentyFive.chargeUnderCostUsd).toBeGreaterThan(0)
    const sentence = describeDiscountFullUse(twentyFive)
    expect(sentence).toMatch(/^under full-use cost on every monthly charge/)
    expect(sentence).toContain(`$${twentyFive.chargeUnderCostUsd.toFixed(2)} under each`)
    expect(sentence).toContain('It touches 12 of the first 12 months')
  })

  it('reads Stripe’s three durations as the charges they reach', () => {
    expect(discountReach({ duration: 'once' }, false)).toEqual({
      duration: 'once',
      charges: 1,
      monthsPerCharge: 1,
      monthsOfFirstYear: 1,
    })
    // Off the annual purchase: one charge, and it pays for the whole year.
    expect(discountReach({ duration: 'once' }, true)).toMatchObject({
      charges: 1,
      monthsPerCharge: 12,
      monthsOfFirstYear: 12,
    })
    expect(discountReach({ duration: 'repeating', durationInMonths: 2 }, false)).toMatchObject({
      charges: 2,
      monthsOfFirstYear: 2,
    })
    expect(discountReach({ duration: 'repeating', durationInMonths: 18 }, false)).toMatchObject({
      charges: 18,
      monthsOfFirstYear: 12,
    })
    // Billed annually, N months reach the annual charges dated inside them.
    expect(discountReach({ duration: 'repeating', durationInMonths: 2 }, true)).toMatchObject({
      charges: 1,
      monthsOfFirstYear: 12,
    })
    expect(discountReach({ duration: 'repeating', durationInMonths: 13 }, true)).toMatchObject({
      charges: 2,
    })
    expect(discountReach({ duration: 'forever' }, false).charges).toBe(Number.POSITIVE_INFINITY)
    // No duration on record is judged as every charge, never as one.
    expect(discountReach(null, false)).toMatchObject({
      duration: 'unknown',
      charges: Number.POSITIVE_INFINITY,
      monthsOfFirstYear: 12,
    })
  })

  it('judges a first-month discount on the first month, and the year as a whole beside it', () => {
    const once = orgDiscountFullUse(proWithHeadroom(), { percentOff: 25 }, { duration: 'once' })
    // The one discounted charge is under cost, exactly as a forever one would be…
    expect(once.ok).toBe(false)
    expect(once.reach.monthsOfFirstYear).toBe(1)
    // …but the other eleven months are at list, and the year covers its cost.
    expect(once.firstYearCoverage).toBeGreaterThan(1)
    expect(once.firstYearUnderCostUsd).toBe(0)
    expect(once.firstYearNetUsd).toBeCloseTo(
      once.netUsd + 11 * netOfProcessorFee(priceNetting(1.3, proCogs())),
      2,
    )
    const sentence = describeDiscountFullUse(once)
    expect(sentence).toMatch(/^under full-use cost on the first month's charge/)
    expect(sentence).toContain('It touches 1 of the first 12 months')
    expect(sentence).not.toMatch(/\(\$[\d.]+ under\)\.$/)

    const twoMonths = orgDiscountFullUse(
      proWithHeadroom(),
      { percentOff: 25 },
      { duration: 'repeating', durationInMonths: 2 },
    )
    expect(describeDiscountFullUse(twoMonths)).toMatch(/^under full-use cost on the first 2 monthly charges/)
    expect(twoMonths.firstYearCoverage).toBeLessThan(once.firstYearCoverage)
  })

  it('judges a discount off the annual purchase on the whole first year', () => {
    const annual = orgDiscountFullUse(proWithHeadroom('year'), { percentOff: 25 }, { duration: 'once' })
    expect(annual.ok).toBe(false)
    expect(annual.reach).toMatchObject({ charges: 1, monthsPerCharge: 12, monthsOfFirstYear: 12 })
    // One charge pays for twelve months, so it is costed as twelve.
    expect(annual.chargeCogsUsd).toBeCloseTo(12 * annual.fullUseCogsUsd, 6)
    expect(annual.firstYearCoverage).toBeCloseTo(annual.coverage, 2)
    expect(describeDiscountFullUse(annual)).toMatch(
      /^under full-use cost on the first annual charge \(the whole first year\)/,
    )
  })

  it('says when there is no price to judge against, rather than calling it covered', () => {
    const none = orgDiscountFullUse({ plan: 'pro' } as never, { percentOff: 10 }, { duration: 'once' })
    expect(none.ok).toBe(false)
    expect(describeDiscountFullUse(none)).toMatch(/no subscription price is on record/)
  })

  it('takes an amount off each CHARGE — a twelfth of it a month on annual billing', () => {
    const cogs = {
      cogsUsd: 10,
      measuredUsd: 10,
      floorUsd: 2,
      breakdown: {},
      unbounded: [] as string[],
    }
    const monthly = rateAgainstFullUse({
      listMonthlyUsd: 100,
      annual: false,
      cogs,
      multiple: 1,
      discount: { amountOffUsd: 60 },
    })
    const annual = rateAgainstFullUse({
      listMonthlyUsd: 100,
      annual: true,
      cogs,
      multiple: 1,
      discount: { amountOffUsd: 60 },
    })
    expect(monthly.discountedUsd).toBe(40)
    expect(annual.discountedUsd).toBe(95)
  })

  it('judges a coupon on every paid plan at both intervals, and leads with the worst case', () => {
    const duration = { duration: 'repeating', durationInMonths: 2 }
    const verdict = rateCouponAgainstFullUse({ percentOff: 10 }, duration)
    const paid = SELF_SERVE_PLANS.filter((plan) => PLAN_PRICING[plan].basePriceMonthlyUsd > 0)
    expect(verdict.cases).toHaveLength(paid.length * 2)
    for (const one of verdict.cases) {
      expect(one.coverage).toBeGreaterThanOrEqual(verdict.worst.coverage)
      // Each case is the per-org judgment on that plan's own list price.
      const direct = orgDiscountFullUse(
        { plan: one.plan, subscription: { status: 'active', interval: one.interval } } as never,
        { percentOff: 10 },
        duration,
      )
      expect(one.netUsd).toBe(direct.netUsd)
      expect(one.ok).toBe(direct.ok)
      expect(one.firstYearCoverage).toBe(direct.firstYearCoverage)
    }
    expect(verdict.ok).toBe(verdict.cases.every((one) => one.ok))
    expect(verdict.warning === null).toBe(verdict.ok)
    // CONTROL: the detector can say "under" on every plan — and it is a
    // warning with the figures, which is all it ever is.
    const free = rateCouponAgainstFullUse({ percentOff: 100 }, { duration: 'once' })
    expect(free.ok).toBe(false)
    expect(free.under).toHaveLength(free.cases.length)
    expect(free.warning).toMatch(
      new RegExp(`^Under full-use cost on ${free.cases.length} of ${free.cases.length} plan`),
    )
    expect(free.warning).toContain('Worst case')
  })

  it('reports the deepest percent every plan carries, and it is the edge', () => {
    const deepest = deepestCouponPercentWithinFullUse()
    if (deepest === null) {
      expect(rateCouponAgainstFullUse({}).ok).toBe(false)
    } else {
      expect(rateCouponAgainstFullUse({ percentOff: deepest }).ok).toBe(true)
      expect(rateCouponAgainstFullUse({ percentOff: deepest + 1 }).ok).toBe(false)
    }
  })
})

describe('the measured contribution check beside it is unchanged', () => {
  it('still rates Agency at 20% off, annual, on 100 sites as ok at 75.5%', () => {
    const hosts = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`h${index}`, {}]),
    )
    const org = {
      plan: 'agency',
      subscription: { status: 'active', interval: 'year' },
      hosts,
    } as never
    const rating = checkDiscountMargin(org, { percentOff: 20 })
    expect(NET_MARGIN_FLOOR_PCT).toBe(0.75)
    // The figures the guardrail has always produced for this deal: $1,049 a
    // month annual, 20% off, net of Stripe, against $2 × 100 sites.
    expect(rating).toMatchObject({
      grossUsd: 1049,
      netUsd: 814.84,
      infraCogsUsd: 200,
      cogsMeasured: false,
      marginPct: 0.7546,
      rating: 'ok',
      reason: 'none',
    })
    // The full-use floor answers its own question about the same discount,
    // from the bands rather than from the sites built.
    const floor = orgFullUseFloor(org, {
      multiple: FULL_USE_DISCOUNT_MULTIPLE,
      discount: { percentOff: 20 },
    })
    expect(floor.netUsd).toBe(rating.netUsd)
    expect(floor.fullUseCogsUsd).toBe(fullUseMonthlyCogsUsd(PLAN_ENTITLEMENTS.agency))
  })
})
