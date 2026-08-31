/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * Aglyn Assist credits: the unit, the bands, and the retail rate.
 *
 * Every assertion here is about a number that costs money if it is wrong in
 * one direction and refuses a paying customer if it is wrong in the other.
 */

import {
  ASSIST_CREDIT_COST_USD,
  ASSIST_CREDIT_MIN_MARGIN_PCT,
  assistCreditOverage,
  assistCreditRateMarginPct,
  assistCreditsFromUsd,
  assistUsdFromCredits,
  priceAssistCreditOverage,
  publicAssistCredits,
  resolveAssistBudgetUsd,
  resolveAssistCreditBudget,
} from './assist-credits'
import {
  ENTERPRISE_ASSIST_CREDITS_PER_MONTH,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
} from './plan-entitlements'
/**
 * Measured cost of one grounded answer, and of one generated screen, at the
 * shipped Sonnet rates.
 *
 * Dollars rather than token shapes because this module is pure and must not
 * reach into the admin lib for its estimator. The two figures are PINNED:
 * `assist-usage.spec.ts` prices the token shapes they came from through the
 * meter's own `estimateAssistCostUsd` and asserts these exact numbers, so a
 * rate change cannot leave this file quietly asserting a stale ratio.
 */
const A_QUESTION_USD = 0.01287
const A_SCREEN_BUILD_USD = 0.2292

const PAID_TIERS = ['pro', 'business', 'scale', 'advanced', 'agency'] as const

describe('the credit is a unit of COST, which is the whole design', () => {
  it('draws an expensive action down FAR harder than a cheap one', () => {
    const question = assistCreditsFromUsd(A_QUESTION_USD)
    const build = assistCreditsFromUsd(A_SCREEN_BUILD_USD)
    // A message allowance would have made these two identical. They are not
    // within an order of magnitude of each other.
    expect(build).toBeGreaterThan(question * 10)
    // And both are countable whole numbers rather than 0 and 1, which is what
    // makes the unit usable as a band.
    expect(question).toBeGreaterThan(5)
    expect(build).toBeGreaterThan(100)
  })

  it('spends a Pro band on FEWER builds than questions, by the same factor', () => {
    const band = resolveAssistCreditBudget({ plan: 'pro' })
    if (band === null) throw new Error('Pro must carry a band')
    const perQuestion = assistCreditsFromUsd(A_QUESTION_USD)
    const perBuild = assistCreditsFromUsd(A_SCREEN_BUILD_USD)
    const questions = Math.floor(band / perQuestion)
    const builds = Math.floor(band / perBuild)
    // The customer-visible consequence, as NUMBERS: the same band is hundreds
    // of questions or a handful of builds. A count-based allowance cannot
    // express this, and a threshold would let the ratio collapse unnoticed.
    expect(`${questions} questions, ${builds} builds`).toBe(
      '211 questions, 11 builds',
    )
    expect(questions).toBeGreaterThan(builds * 10)
    expect(builds).toBeGreaterThan(0)
  })

  it('rounds measured spend UP, so a tail of cheap turns cannot draw nothing', () => {
    // Half a credit of real provider spend draws one, not zero. Rounding down
    // is the direction where a long tail of sub-credit exchanges costs money
    // and moves no meter.
    expect(assistCreditsFromUsd(ASSIST_CREDIT_COST_USD / 2)).toBe(1)
    expect(assistCreditsFromUsd(ASSIST_CREDIT_COST_USD * 2.1)).toBe(3)
    expect(assistCreditsFromUsd(0)).toBe(0)
  })

  it('refuses to turn junk into a budget', () => {
    for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(assistUsdFromCredits(junk)).toBe(0)
      expect(assistCreditsFromUsd(junk)).toBe(0)
    }
  })
})

describe('the bands', () => {
  /**
   * ⚠️ THE SHARE OF PRICE IS A SANITY BOUND, NOT THE SIZING RULE.
   *
   * A band was once sized as ~13% of the tier price, on the assumption that
   * ~20% of price was available for assist. It is not: the same subscription
   * is also carrying media storage, bandwidth, form submissions, dataset
   * storage, API requests, contacts and email, and those seven together leave
   * between 10.0% and 16.3% of price on the paid ladder. A share of price
   * cannot see that, so it cannot say whether a band is affordable.
   *
   * `tier-margin-floor.spec.ts` is the authority — it multiplies every band
   * against the platform's own cost rates and holds each tier non-negative at
   * 100% of all eight. What is asserted here is only the shape that follows:
   * a band that is a LARGE share of price is definitionally unaffordable,
   * because no tier has that much room left over.
   */
  it('stays a small share of the tier price at FULL consumption', () => {
    for (const plan of PAID_TIERS) {
      const budgetUsd = resolveAssistBudgetUsd({ plan })
      if (budgetUsd === null) throw new Error(`${plan} must carry a band`)
      const price = PLAN_PRICING[plan].basePriceMonthlyUsd
      expect(price).toBeGreaterThan(0)
      // Read against the LIVE price table rather than against figures copied
      // into this file — a repricing must be able to break it.
      expect(budgetUsd / price).toBeLessThanOrEqual(0.055)
      // And it is a real band, not a rounding artefact of the constraint.
      expect(budgetUsd / price).toBeGreaterThan(0.03)
    }
  })

  it('rises with the tier, and Free/Starter carry none', () => {
    expect(PLAN_ENTITLEMENTS.free.assistCreditsPerMonth).toBe(0)
    expect(PLAN_ENTITLEMENTS.starter.assistCreditsPerMonth).toBe(0)
    // Generative building is the most expensive thing that could be given
    // away and the one feature no bandwidth wall bounds, so neither tier
    // carries `aiAssist` either.
    expect(PLAN_ENTITLEMENTS.free.features.aiAssist).toBe(false)
    expect(PLAN_ENTITLEMENTS.starter.features.aiAssist).toBe(false)
    let previous = 0
    for (const plan of [...PAID_TIERS, 'enterprise'] as const) {
      const band = PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth
      expect(PLAN_ENTITLEMENTS[plan].features.aiAssist).toBe(true)
      expect(band).toBeGreaterThan(previous)
      previous = band
    }
  })
})

describe('Enterprise resolves to a finite number, never Infinity', () => {
  it('SURVIVES A JSON ROUND TRIP as a number, not null and not 0', () => {
    // `JSON.stringify(Infinity)` is `null` and `Number(null)` is 0, so an
    // unbounded band would hand the only customers with a signed contract the
    // one budget that refuses everything.
    const band = PLAN_ENTITLEMENTS.enterprise.assistCreditsPerMonth
    expect(band).toBe(ENTERPRISE_ASSIST_CREDITS_PER_MONTH)
    expect(Number.isFinite(band)).toBe(true)
    const wire = JSON.parse(JSON.stringify({ band })) as { band: number }
    expect(wire.band).not.toBeNull()
    expect(wire.band).toBe(band)
    expect(Number(wire.band)).toBeGreaterThan(0)
    // The whole resolved entitlement set, not just the field in isolation —
    // this is the shape that actually crosses a wire.
    const resolved = JSON.parse(
      JSON.stringify(PLAN_ENTITLEMENTS.enterprise),
    ) as { assistCreditsPerMonth: number }
    expect(resolved.assistCreditsPerMonth).toBe(band)
  })

  it('is anchored to the TOP OF THE LADDER, not to a price it does not have', () => {
    // Enterprise carries no list price, so the band cannot be sized against
    // what a tier's other cost terms leave out of one. It takes the step the
    // ladder already takes instead — 1.5x Agency — and that relation is
    // asserted rather than described, so moving Agency's band without moving
    // this one goes red instead of quietly flattening the top of the ladder.
    expect(ENTERPRISE_ASSIST_CREDITS_PER_MONTH).toBe(
      PLAN_ENTITLEMENTS.agency.assistCreditsPerMonth * 1.5,
    )
    // And it stays a smaller share of the cheapest deal that is sold as
    // Enterprise than Agency's own band is of $1,299 — a top rung that cost
    // proportionally more than the one below it would be the wrong shape.
    const agencyPrice = PLAN_PRICING.agency.basePriceMonthlyUsd
    expect(
      assistUsdFromCredits(ENTERPRISE_ASSIST_CREDITS_PER_MONTH) / agencyPrice,
    ).toBeLessThan(0.07)
  })

  it('takes a CONTRACTED per-org value over the fallback', () => {
    const contracted = resolveAssistCreditBudget({
      plan: 'enterprise',
      entitlements: { assistCreditsPerMonth: 4_000_000 },
    })
    expect(contracted).toBe(4_000_000)
    // And the fallback still stands for an agreement that bought no override.
    expect(resolveAssistCreditBudget({ plan: 'enterprise' })).toBe(
      ENTERPRISE_ASSIST_CREDITS_PER_MONTH,
    )
  })

  it('does not honour an Infinity that reached it through an override', () => {
    // A stored `Infinity` is a band that reads as ZERO on the next process to
    // deserialize it. Falling through to the operator backstop is bounded and
    // consistent; honouring it would be unbounded here and a refusal there.
    expect(
      resolveAssistCreditBudget({
        plan: 'enterprise',
        entitlements: { assistCreditsPerMonth: Number.POSITIVE_INFINITY },
      }),
    ).toBeNull()
  })
})

describe('ANTI-VACUITY: a zero band is "no band", never a budget of zero', () => {
  it('resolves Free and Starter to null so their assistant still runs', () => {
    // A stubbed entitlements module answers 0 for every quota. If 0 became a
    // budget of $0, every clamp in this feature would go green having refused
    // every request — and the free tier's docs-grounded assistant, which is
    // bounded by a message cap and an operator backstop, would be switched
    // off by a pricing field that was never about it.
    expect(resolveAssistCreditBudget({ plan: 'free' })).toBeNull()
    expect(resolveAssistCreditBudget({ plan: 'starter' })).toBeNull()
    expect(resolveAssistBudgetUsd({ plan: 'free' })).toBeNull()
    // The exact shape a stub produces, on a tier that DOES sell a band.
    expect(
      resolveAssistCreditBudget({
        plan: 'business',
        entitlements: { assistCreditsPerMonth: 0 },
      }),
    ).toBeNull()
  })

  it('THE OTHER WAY: a real band is not swallowed by the same rule', () => {
    // Without this, the test above passes for a build that resolves EVERY
    // band to null and therefore never enforces anything.
    expect(resolveAssistCreditBudget({ plan: 'pro' })).toBe(2_750)
    expect(resolveAssistBudgetUsd({ plan: 'pro' })).toBe(2.75)
    expect(resolveAssistCreditBudget({ plan: 'agency' })).toBe(58_000)
  })

  it('a dead subscription drops to free, and so loses the band', () => {
    expect(
      resolveAssistCreditBudget({
        plan: 'agency',
        subscription: { status: 'canceled' },
      } as never),
    ).toBeNull()
  })
})

describe('the retail overage rate', () => {
  it('CLEARS the 50% margin floor on every plan that sells one', () => {
    for (const plan of PAID_TIERS) {
      const rate = PLAN_PRICING[plan].extraAssistCreditsUsdPer1k
      expect(rate).not.toBeNull()
      const margin = assistCreditRateMarginPct(rate)
      if (margin === null) throw new Error(`${plan} must price an overage`)
      expect(margin).toBeGreaterThanOrEqual(ASSIST_CREDIT_MIN_MARGIN_PCT)
    }
  })

  it('is a MULTIPLIER ON COST, and stops descending at the floor', () => {
    // 1,000 credits cost exactly $1.00, which is what makes the per-1,000
    // rate read as the multiplier.
    expect(ASSIST_CREDIT_COST_USD * 1000).toBe(1)
    const ladder = PAID_TIERS.map(
      (plan) => PLAN_PRICING[plan].extraAssistCreditsUsdPer1k as number,
    )
    // Descends with the tier the way contacts and API requests do...
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]).toBeLessThan(ladder[i - 1])
    }
    // ...and stops at cost x2 rather than running past it.
    const floor = (ASSIST_CREDIT_COST_USD * 1000) / (1 - ASSIST_CREDIT_MIN_MARGIN_PCT)
    expect(floor).toBe(2)
    expect(Math.min(...ladder)).toBe(floor)
    expect(assistCreditRateMarginPct(floor)).toBe(ASSIST_CREDIT_MIN_MARGIN_PCT)
  })

  it('reports NO margin for a plan that sells no overage', () => {
    // Not 1, and not 0: "sells nothing here" is not "sells at 100% margin".
    expect(PLAN_PRICING.free.extraAssistCreditsUsdPer1k).toBeNull()
    expect(PLAN_PRICING.starter.extraAssistCreditsUsdPer1k).toBeNull()
    expect(PLAN_PRICING.enterprise.extraAssistCreditsUsdPer1k).toBeNull()
    expect(assistCreditRateMarginPct(null)).toBeNull()
    expect(assistCreditRateMarginPct(0)).toBeNull()
  })

  it('prices the overage, and charges nothing where there is no rate', () => {
    expect(priceAssistCreditOverage({ plan: 'pro' }, 2_000)).toEqual({
      overageCredits: 2_000,
      overageMonthlyUsd: 6,
      overageRateUsd: 3,
    })
    // Structurally zero on a plan with no rate, not zero by a check.
    expect(
      priceAssistCreditOverage({ plan: 'starter' }, 2_000).overageMonthlyUsd,
    ).toBe(0)
    // And a rate above cost is the point: $6 of revenue on $2 of spend.
    expect(assistUsdFromCredits(2_000)).toBe(2)
  })

  it('counts overage only past a band that exists', () => {
    expect(assistCreditOverage(20_000, 18_000)).toBe(2_000)
    expect(assistCreditOverage(10_000, 18_000)).toBe(0)
    // An org with NO band has nothing to be over — reporting the month's
    // whole spend here would invoice the free tier for its docs answers.
    expect(assistCreditOverage(10_000, null)).toBe(0)
  })
})

describe('what a customer may be shown is credits, never our provider bill', () => {
  it('converts spend and ceiling into a credit standing', () => {
    const view = publicAssistCredits(4.5, 18)
    expect(view).toEqual({ used: 4_500, limit: 18_000, remaining: 13_500 })
    expect(JSON.stringify(view)).not.toContain('4.5')
    expect(JSON.stringify(view)).not.toContain('Usd')
  })

  it('never reports a negative balance past the ceiling', () => {
    expect(publicAssistCredits(25, 18).remaining).toBe(0)
  })

  it('reports NO band rather than converting a ceiling nobody was sold', () => {
    // A workspace with no plan band that met the operator backstop has no
    // credit balance; telling it "0 of 40,000 left" names a band it never had.
    expect(publicAssistCredits(41.5, null)).toEqual({
      used: 41_500,
      limit: null,
      remaining: null,
    })
  })
})
