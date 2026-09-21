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
  ASSIST_HARD_CAP_CONTROL_LABEL,
  ASSIST_HARD_CAP_CONTROL_LOCATION,
  ASSIST_OVERAGE_CAP_CONTROL_LABEL,
  assistBandRefuses,
  assistCreditOverage,
  assistCreditRateMarginPct,
  assistCreditsFromUsd,
  assistFreeTasteRefusalText,
  assistHardCapRefusalText,
  assistMonthOverage,
  assistOverageCapReached,
  assistOverageCapRefusalText,
  assistOwnControlRefusalText,
  assistRefusedByHardCap,
  assistRefusedByOverageCap,
  assistUsdFromCredits,
  priceAssistCreditOverage,
  publicAssistCredits,
  resolveAssistBudgetUsd,
  resolveAssistCreditBudget,
  resolveAssistHardCap,
  resolveAssistOverageRateUsdPer1k,
  resolveAssistOverageCapUsd,
} from './assist-credits'
import {
  AI_ADDON_CREDITS_PER_MONTH,
  FREE_AI_TASTE_CREDITS_PER_MONTH,
  ENTERPRISE_ASSIST_CREDITS_PER_MONTH,
  hasAiAddon,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  resolveEffectivePlan,
} from './plan-entitlements'
import { registerPluginEntitlements } from '../plugin-manager/plugin-entitlements'

// The AI add-on is the AI plugin's declaration (AGL-2939), and core cannot
// import a plugin: a stand-in with the plugin's own figures, so the fold
// under test is the generic one and the numbers are the shipped ones.
beforeAll(() => {
  registerPluginEntitlements({
    pluginId: 'ai',
    seatAddons: [
      {
        key: 'aiAddon',
        label: 'AI add-on',
        maxUnits: 1,
        quota: { key: 'assistCreditsPerMonth', perUnitByPlan: AI_ADDON_CREDITS_PER_MONTH },
        features: ['aiGenerative', 'aiAssist'],
      },
    ],
  })
})
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

  it('rises with the tier; Free carries the taste as a wall and Starter sells past its own', () => {
    // The Free taste (AGL-2925): a real band, small enough that a month of
    // it costs under a third of a dollar, and a wall because the plan has
    // no rate to sell past it at.
    expect(PLAN_ENTITLEMENTS.free.assistCreditsPerMonth).toBe(FREE_AI_TASTE_CREDITS_PER_MONTH)
    expect(FREE_AI_TASTE_CREDITS_PER_MONTH).toBe(300)
    expect(assistUsdFromCredits(PLAN_ENTITLEMENTS.free.assistCreditsPerMonth)).toBeLessThanOrEqual(0.3)
    expect(assistBandRefuses({ plan: 'free' })).toBe(true)
    // Starter (AGL-3203): the first PAID rung, and the whole point of the
    // decision — a paying workspace must not include LESS than a free one.
    // Unlike Free it is not a wall: the plan carries a rate, so past 750 it
    // meters and bills like every tier above it.
    expect(PLAN_ENTITLEMENTS.starter.assistCreditsPerMonth).toBe(750)
    expect(PLAN_ENTITLEMENTS.starter.assistCreditsPerMonth).toBeGreaterThan(
      PLAN_ENTITLEMENTS.free.assistCreditsPerMonth,
    )
    expect(assistUsdFromCredits(PLAN_ENTITLEMENTS.starter.assistCreditsPerMonth)).toBe(0.75)
    expect(assistBandRefuses({ plan: 'starter' })).toBe(false)
    // Each tier has a door its band can be spent through, which is the
    // AGL-3207 rule: Free's is `aiGenerative`, the door its taste exists
    // for; Starter's is `aiAssist`, the shape of every paid rung above it.
    // A band with neither flag is a quantity sold and not deliverable, and
    // Starter was exactly that for one release.
    expect(PLAN_ENTITLEMENTS.free.features.aiAssist).toBe(false)
    expect(PLAN_ENTITLEMENTS.free.features.aiGenerative).toBe(true)
    expect(PLAN_ENTITLEMENTS.starter.features.aiAssist).toBe(true)
    expect(PLAN_ENTITLEMENTS.starter.features.aiGenerative).toBe(false)
    // The ladder is unbroken from Free upward now, so it is walked from Free
    // THROUGH Starter rather than around it.
    expect(PLAN_ENTITLEMENTS.starter.assistCreditsPerMonth).toBeLessThan(
      PLAN_ENTITLEMENTS.pro.assistCreditsPerMonth,
    )
    let previous = PLAN_ENTITLEMENTS.starter.assistCreditsPerMonth
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
    // what a tier's other cost terms leave out of one. It is twice Agency's
    // band instead — the rule every Enterprise fallback follows since the
    // 2026-09-07 decision — and that relation is asserted rather than
    // described, so moving Agency's band without moving this one goes red
    // instead of quietly flattening the top of the ladder.
    expect(ENTERPRISE_ASSIST_CREDITS_PER_MONTH).toBe(
      PLAN_ENTITLEMENTS.agency.assistCreditsPerMonth * 2,
    )
    // As provider spend: $116 a month, under 9% of the cheapest deal that is
    // sold as Enterprise — the Agency price is the floor a deal is written
    // above — and a figure a contract raises rather than a share it is held
    // to.
    expect(assistUsdFromCredits(ENTERPRISE_ASSIST_CREDITS_PER_MONTH)).toBe(116)
    const agencyPrice = PLAN_PRICING.agency.basePriceMonthlyUsd
    expect(
      assistUsdFromCredits(ENTERPRISE_ASSIST_CREDITS_PER_MONTH) / agencyPrice,
    ).toBeLessThan(0.09)
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
  it('resolves an overridden zero to null, and every plan row to its real band', () => {
    // A stubbed entitlements module answers 0 for every quota. If 0 became a
    // budget of $0, every clamp in this feature would go green having refused
    // every request — and the docs-grounded assistant, which is bounded by a
    // message cap and an operator backstop, would be switched off by a
    // pricing field that was never about it.
    //
    // Starter used to be the plan-row case here. Since AGL-3203 no plan row
    // bands at zero, so the rule is exercised where a zero can still reach
    // this function: a per-org override that writes one.
    expect(
      resolveAssistCreditBudget({
        plan: 'starter',
        entitlements: { assistCreditsPerMonth: 0 },
      }),
    ).toBeNull()
    expect(
      resolveAssistBudgetUsd({
        plan: 'starter',
        entitlements: { assistCreditsPerMonth: 0 },
      }),
    ).toBeNull()
    // The exact shape a stub produces, on a tier that sells a larger band.
    expect(
      resolveAssistCreditBudget({
        plan: 'business',
        entitlements: { assistCreditsPerMonth: 0 },
      }),
    ).toBeNull()
    // …and the premise: the same plans resolve their REAL bands untouched,
    // so the nulls above are the override and not the function refusing
    // everything. Free is a real band since AGL-2925, Starter since
    // AGL-3203.
    expect(resolveAssistCreditBudget({ plan: 'free' })).toBe(300)
    expect(resolveAssistBudgetUsd({ plan: 'free' })).toBe(0.3)
    expect(resolveAssistCreditBudget({ plan: 'starter' })).toBe(750)
    expect(resolveAssistBudgetUsd({ plan: 'starter' })).toBe(0.75)
  })

  it('THE OTHER WAY: a real band is not swallowed by the same rule', () => {
    // Without this, the test above passes for a build that resolves EVERY
    // band to null and therefore never enforces anything.
    expect(resolveAssistCreditBudget({ plan: 'pro' })).toBe(2_750)
    expect(resolveAssistBudgetUsd({ plan: 'pro' })).toBe(2.75)
    expect(resolveAssistCreditBudget({ plan: 'agency' })).toBe(58_000)
  })

  it('a dead subscription drops to free, and so drops to the taste', () => {
    // Fifty-eight thousand credits become three hundred, behind a wall.
    expect(
      resolveAssistCreditBudget({
        plan: 'agency',
        subscription: { status: 'canceled' },
      } as never),
    ).toBe(FREE_AI_TASTE_CREDITS_PER_MONTH)
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
    // Free and Enterprise are the only two nulls since AGL-3203 — Free's
    // band is a wall by decision, Enterprise's usage is contractual.
    expect(PLAN_PRICING.free.extraAssistCreditsUsdPer1k).toBeNull()
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
    // Starter joins the ladder at Pro's rate, so the same overage prices the
    // same (AGL-3203).
    expect(priceAssistCreditOverage({ plan: 'starter' }, 2_000)).toEqual({
      overageCredits: 2_000,
      overageMonthlyUsd: 6,
      overageRateUsd: 3,
    })
    // Structurally zero on a plan with no rate, not zero by a check.
    expect(
      priceAssistCreditOverage({ plan: 'free' }, 2_000).overageMonthlyUsd,
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

describe('the overage is SOLD past the band at the plan rate, unless the org asks to be stopped (AGL-2653)', () => {
  /**
   * Pro: 2,750 credits at $3.00 per 1,000; Agency: 58,000 at $2.00. Each
   * fixture is the month's measured spend as `report-usage` reads it, built
   * from the credit count so the band edge is exact.
   */
  const BILLED = [
    { plan: 'pro' as const, band: 2_750, rate: 3, plus2500Usd: 7.5 },
    { plan: 'agency' as const, band: 58_000, rate: 2, plus2500Usd: 5 },
  ]

  describe.each(BILLED)('assistMonthOverage on $plan', ({ plan, band, rate, plus2500Usd }) => {
    it('at the band: nothing over, nothing billed', () => {
      // FORCED RED by `Math.max(0, used - band + 1)` in `assistCreditOverage`.
      expect(assistMonthOverage({ plan }, assistUsdFromCredits(band))).toEqual({
        usedCredits: band,
        bandCredits: band,
        overageCredits: 0,
        overageMonthlyUsd: 0,
        overageRateUsd: rate,
      })
    })

    it('at band + 1 credit: one credit over, which rounds to no cents', () => {
      // One credit at $2–$3 per 1,000 is a third of a cent, and the invoice
      // rounds to the cent as every other overage term does — so the count
      // is 1 and the amount is $0.00. Both are on the rollup for that reason.
      expect(assistMonthOverage({ plan }, assistUsdFromCredits(band + 1))).toEqual({
        usedCredits: band + 1,
        bandCredits: band,
        overageCredits: 1,
        overageMonthlyUsd: 0,
        overageRateUsd: rate,
      })
    })

    it('at band + 2,500 credits: 2.5 x the rate, to the cent', () => {
      // LITERAL dollars, not `2.5 * rate` — a guard that recomputes the
      // expression it tests cannot fail when the expression is wrong.
      const month = assistMonthOverage({ plan }, assistUsdFromCredits(band + 2_500))
      expect(month).toEqual({
        usedCredits: band + 2_500,
        bandCredits: band,
        overageCredits: 2_500,
        overageMonthlyUsd: plus2500Usd,
        overageRateUsd: rate,
      })
      // And in cents, the way `billedCents` folds it in beside contacts, API
      // and dataset storage.
      expect(Math.round(month.overageMonthlyUsd * 100)).toBe(plus2500Usd * 100)
    })
  })

  it('prices ZERO where there is no band or no rate, structurally', () => {
    // Free and Enterprise: a band, and no rate to sell past it at. The "no
    // band at all" case is an overridden zero since AGL-3203 — Starter, the
    // plan that used to supply it, now sells a band of its own.
    expect(
      assistMonthOverage({ plan: 'starter', entitlements: { assistCreditsPerMonth: 0 } }, 40),
    ).toMatchObject({
      bandCredits: null,
      overageCredits: 0,
      overageMonthlyUsd: 0,
    })
    expect(assistMonthOverage({ plan: 'free' }, 40)).toMatchObject({
      bandCredits: 300,
      overageCredits: 40_000 - 300,
      overageMonthlyUsd: 0,
      overageRateUsd: null,
    })
    expect(assistMonthOverage({ plan: 'enterprise' }, 200)).toMatchObject({
      bandCredits: ENTERPRISE_ASSIST_CREDITS_PER_MONTH,
      overageCredits: 200_000 - ENTERPRISE_ASSIST_CREDITS_PER_MONTH,
      overageMonthlyUsd: 0,
      overageRateUsd: null,
    })
    // Junk spend is zero credits, never NaN dollars.
    expect(assistMonthOverage({ plan: 'pro' }, Number.NaN).overageMonthlyUsd).toBe(0)
  })

  describe('the switch', () => {
    it('is OFF by default, and OFF is the selling state on every plan with a rate', () => {
      // FORCED RED by returning `true` from `assistBandRefuses` — the
      // pre-2026-09-07 behavior, where every band was a wall.
      for (const plan of PAID_TIERS) {
        expect(resolveAssistHardCap({ plan })).toBe(false)
        expect(assistBandRefuses({ plan })).toBe(false)
      }
    })

    it('ON makes the band a wall on those same plans', () => {
      for (const plan of PAID_TIERS) {
        const org = { plan, assistOverage: { hardCap: true } }
        expect(resolveAssistHardCap(org)).toBe(true)
        expect(assistBandRefuses(org)).toBe(true)
      }
    })

    it('reads only the boolean — a string, a 1, a missing map all sell', () => {
      for (const hardCap of ['true', 1, 'on', undefined] as unknown[]) {
        expect(
          resolveAssistHardCap({ plan: 'pro', assistOverage: { hardCap: hardCap as boolean } }),
        ).toBe(false)
      }
      expect(resolveAssistHardCap(null)).toBe(false)
      expect(resolveAssistHardCap({ plan: 'pro', assistOverage: {} })).toBe(false)
    })

    it('changes nothing on a plan with no rate: the band is a wall either way', () => {
      // Enterprise sells no overage and Free's taste is a wall by decision,
      // so the switch has nothing to change on either. Starter left this set
      // in AGL-3203: it now carries a rate, so its switch does what every
      // paid tier's does — asserted below rather than here.
      for (const plan of ['enterprise', 'free'] as const) {
        expect(assistBandRefuses({ plan })).toBe(true)
        expect(assistBandRefuses({ plan, assistOverage: { hardCap: false } })).toBe(true)
        expect(assistBandRefuses({ plan, assistOverage: { hardCap: true } })).toBe(true)
      }
      // THE CONTRAST, and the premise that the loop above is about the
      // missing rate rather than about every plan: Starter carries one, so
      // its band sells by default and walls only when the org asks.
      expect(assistBandRefuses({ plan: 'starter' })).toBe(false)
      expect(assistBandRefuses({ plan: 'starter', assistOverage: { hardCap: false } })).toBe(false)
      expect(assistBandRefuses({ plan: 'starter', assistOverage: { hardCap: true } })).toBe(true)
    })

    it('a refusal is the switch’s own only when the switch caused it', () => {
      const stopped = { plan: 'pro' as const, assistOverage: { hardCap: true } }
      expect(assistRefusedByHardCap(stopped, 'band')).toBe(true)
      // The operator's figure, the message cap, or an admission: not the switch.
      expect(assistRefusedByHardCap(stopped, 'budget')).toBe(false)
      expect(assistRefusedByHardCap(stopped, 'messages')).toBe(false)
      expect(assistRefusedByHardCap(stopped, null)).toBe(false)
      // Switch off: a band refusal is somebody else's (an operator figure at
      // the band, say), and must not send the user to a switch that is off.
      expect(assistRefusedByHardCap({ plan: 'pro' }, 'band')).toBe(false)
      // A plan with no rate: the band refuses whatever the switch says, so
      // pointing at the switch would point at a control that does nothing.
      expect(
        assistRefusedByHardCap({ plan: 'enterprise', assistOverage: { hardCap: true } }, 'band'),
      ).toBe(false)
    })
  })

  describe('the refusal sentence', () => {
    it('names the control by its label, says where it lives, and quotes the plan rate', () => {
      const text = assistHardCapRefusalText({ plan: 'pro' })
      expect(text).toContain(`"${ASSIST_HARD_CAP_CONTROL_LABEL}"`)
      expect(text).toContain(ASSIST_HARD_CAP_CONTROL_LOCATION)
      expect(text).toContain('$3.00 per 1,000 credits')
      expect(assistHardCapRefusalText({ plan: 'agency' })).toContain('$2.00 per 1,000 credits')
    })

    it('ships no dollar figure of OURS — only the retail rate', () => {
      const text = assistHardCapRefusalText({ plan: 'pro' })
      for (const leak of ['costUsd', 'estCostUsd', '0.001', 'provider']) {
        expect(text).not.toContain(leak)
      }
      // The label is a customer-facing string, so it is spelled the way the
      // console spells it: a sentence, not a key.
      expect(ASSIST_HARD_CAP_CONTROL_LABEL).toMatch(/^[A-Z][a-z]/)
      expect(ASSIST_HARD_CAP_CONTROL_LABEL).not.toMatch(/[_{}]/)
    })
  })
})

describe('the Aglyn AI add-on widens the ONE pool and sells past it (AGL-2896)', () => {
  const starterWithAddon = { plan: 'starter' as const, seatAddons: { aiAddon: 1 } }

  it('ADDS to the band Starter already has, and leaves the rate where it is', () => {
    // Before AGL-3203 the add-on was the whole of Starter's assist: the plan
    // banded at 0 and the rate lived off-row in a constant. Now the plan
    // carries both, so the add-on does here exactly what it does on every
    // other tier — it widens the one pool and changes no rate.
    expect(resolveAssistCreditBudget({ plan: 'starter' })).toBe(750)
    expect(resolveAssistCreditBudget(starterWithAddon)).toBe(
      PLAN_ENTITLEMENTS.starter.assistCreditsPerMonth + AI_ADDON_CREDITS_PER_MONTH.starter,
    )
    expect(resolveAssistCreditBudget(starterWithAddon)).toBe(4_750)
    expect(resolveAssistBudgetUsd(starterWithAddon)).toBe(4.75)
    // The rate is the PLAN's, with or without the add-on — one number in one
    // place, which is what the collapsed constant bought.
    expect(resolveAssistOverageRateUsdPer1k({ plan: 'starter' })).toBe(3)
    expect(resolveAssistOverageRateUsdPer1k(starterWithAddon)).toBe(3)
    expect(PLAN_PRICING.starter.extraAssistCreditsUsdPer1k).toBe(3)
    // …and it is Pro's figure, joined rather than stepped above: the ladder
    // descends with the tier, so the rung below Pro cannot cost more.
    expect(PLAN_PRICING.starter.extraAssistCreditsUsdPer1k).toBe(
      PLAN_PRICING.pro.extraAssistCreditsUsdPer1k,
    )
  })

  it('ADDS to a plan that already has a band, at the plan rate it already had', () => {
    // FORCED RED by replacing the band rather than adding to it.
    expect(resolveAssistCreditBudget({ plan: 'pro', seatAddons: { aiAddon: 1 } })).toBe(
      2_750 + 9_000,
    )
    expect(resolveAssistOverageRateUsdPer1k({ plan: 'pro', seatAddons: { aiAddon: 1 } })).toBe(3)
    expect(resolveAssistCreditBudget({ plan: 'agency', seatAddons: { aiAddon: 1 } })).toBe(
      58_000 + 149_000,
    )
    expect(resolveAssistOverageRateUsdPer1k({ plan: 'agency', seatAddons: { aiAddon: 1 } })).toBe(2)
  })

  it('leaves Free and Enterprise with no rate, add-on or not', () => {
    // Free sells no add-on: a quantity written onto it adds free's zero, so
    // the budget stays the taste and nothing widens it.
    expect(resolveAssistCreditBudget({ plan: 'free', seatAddons: { aiAddon: 1 } })).toBe(
      FREE_AI_TASTE_CREDITS_PER_MONTH,
    )
    expect(resolveAssistOverageRateUsdPer1k({ plan: 'free', seatAddons: { aiAddon: 1 } })).toBeNull()
    // Enterprise: the band widens by the fallback figure, and the usage is
    // still in the contract — no rate, so the band stays a wall.
    expect(resolveAssistCreditBudget({ plan: 'enterprise', seatAddons: { aiAddon: 1 } })).toBe(
      ENTERPRISE_ASSIST_CREDITS_PER_MONTH + AI_ADDON_CREDITS_PER_MONTH.enterprise,
    )
    expect(
      resolveAssistOverageRateUsdPer1k({ plan: 'enterprise', seatAddons: { aiAddon: 1 } }),
    ).toBeNull()
    expect(assistBandRefuses({ plan: 'enterprise', seatAddons: { aiAddon: 1 } })).toBe(true)
  })

  it('every reader of the rate reads the SAME one', () => {
    // The gate, the invoice and the refusal sentence, on the org whose rate
    // comes from the add-on and not from the plan table.
    expect(assistBandRefuses(starterWithAddon)).toBe(false)
    expect(assistBandRefuses({ ...starterWithAddon, assistOverage: { hardCap: true } })).toBe(true)
    expect(
      assistRefusedByHardCap({ ...starterWithAddon, assistOverage: { hardCap: true } }, 'band'),
    ).toBe(true)
    expect(assistHardCapRefusalText(starterWithAddon)).toContain('$3.00 per 1,000 credits')
    expect(priceAssistCreditOverage(starterWithAddon, 2_000)).toEqual({
      overageCredits: 2_000,
      overageMonthlyUsd: 6,
      overageRateUsd: 3,
    })
    // The month's derivation, end to end: the band edge is the plan's 750
    // plus the add-on's 4,000.
    expect(assistMonthOverage(starterWithAddon, assistUsdFromCredits(4_750 + 2_500))).toEqual({
      usedCredits: 7_250,
      bandCredits: 4_750,
      overageCredits: 2_500,
      overageMonthlyUsd: 7.5,
      overageRateUsd: 3,
    })
    // And WITHOUT the add-on the same org still sells, at the same rate,
    // from the plan's own narrower band — the shape AGL-3203 introduced.
    expect(assistMonthOverage({ plan: 'starter' }, assistUsdFromCredits(750 + 2_500))).toEqual({
      usedCredits: 3_250,
      bandCredits: 750,
      overageCredits: 2_500,
      overageMonthlyUsd: 7.5,
      overageRateUsd: 3,
    })
    expect(assistBandRefuses({ plan: 'starter' })).toBe(false)
  })

  it('is a toggle: any quantity from one up is one purchase, anything else is none', () => {
    for (const quantity of [1, 2, 7, 1e6]) {
      expect(hasAiAddon({ plan: 'starter', seatAddons: { aiAddon: quantity } })).toBe(true)
      expect(
        resolveAssistCreditBudget({ plan: 'starter', seatAddons: { aiAddon: quantity } }),
      ).toBe(4_750)
    }
    for (const quantity of [0, -1, 0.5, Number.NaN, undefined] as unknown[]) {
      expect(
        hasAiAddon({ plan: 'starter', seatAddons: { aiAddon: quantity as number } }),
      ).toBe(false)
    }
    expect(hasAiAddon({ plan: 'starter' })).toBe(false)
    expect(hasAiAddon(null)).toBe(false)
  })

  it('goes with the subscription: a dead one drops the band and the rate together', () => {
    // A rate on a band that has gone would be the silent free overage in
    // reverse — a fee quoted on nothing. Both come from `hasAiAddon`.
    const dead = {
      plan: 'starter' as const,
      subscription: { status: 'canceled' },
      seatAddons: { aiAddon: 1 },
    } as never
    expect(hasAiAddon(dead)).toBe(false)
    // Dead is Free, and Free is the taste: the add-on's four thousand are
    // gone, three hundred remain, and they are a wall.
    expect(resolveAssistCreditBudget(dead)).toBe(FREE_AI_TASTE_CREDITS_PER_MONTH)
    expect(resolveAssistOverageRateUsdPer1k(dead)).toBeNull()
    expect(assistBandRefuses(dead)).toBe(true)
  })

  it('every band costs at most 50% of the add-on price in provider spend', () => {
    // The `ASSIST_CREDIT_MIN_MARGIN_PCT` floor, applied to the add-on line
    // itself: what the band costs at 100% against what the add-on charges.
    // Free and Enterprise sell no add-on and are asserted separately.
    for (const plan of ['starter', ...PAID_TIERS] as const) {
      const price = PLAN_PRICING[plan].aiAddonMonthlyUsd
      if (price === null) throw new Error(`${plan} must price the add-on`)
      const cost = assistUsdFromCredits(AI_ADDON_CREDITS_PER_MONTH[plan])
      expect(`${plan}: ${cost / price <= 1 - ASSIST_CREDIT_MIN_MARGIN_PCT}`).toBe(`${plan}: true`)
      // …and it is a real band, not a token one hiding under the floor.
      expect(cost / price).toBeGreaterThan(0.4)
    }
    expect(PLAN_PRICING.free.aiAddonMonthlyUsd).toBeNull()
    expect(AI_ADDON_CREDITS_PER_MONTH.free).toBe(0)
    expect(PLAN_PRICING.enterprise.aiAddonMonthlyUsd).toBeNull()
    // Enterprise's band follows the Agency x 2 rule and is finite.
    expect(AI_ADDON_CREDITS_PER_MONTH.enterprise).toBe(AI_ADDON_CREDITS_PER_MONTH.agency * 2)
    for (const band of Object.values(AI_ADDON_CREDITS_PER_MONTH)) {
      expect(Number.isFinite(band)).toBe(true)
    }
  })
})

describe('the dollar ceiling on overage (AGL-2898)', () => {
  /** Pro: 2,750 credits at $3.00 per 1,000. 2,000 credits over is $6.00. */
  const PRO_BAND = 2_750
  const capped = (capUsd: unknown) => ({
    plan: 'pro' as const,
    assistOverage: { capUsd: capUsd as number },
  })

  it('resolves only a finite positive number; everything else is NO ceiling', () => {
    expect(resolveAssistOverageCapUsd(capped(6))).toBe(6)
    expect(resolveAssistOverageCapUsd(capped(0.5))).toBe(0.5)
    // A string "6" must not become a ceiling — the route refuses it too —
    // and neither may junk become a wall of NaN that every comparison passes.
    for (const junk of ['6', 0, -6, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, true]) {
      expect(resolveAssistOverageCapUsd(capped(junk))).toBeNull()
    }
    expect(resolveAssistOverageCapUsd({ plan: 'pro' })).toBeNull()
    expect(resolveAssistOverageCapUsd(null)).toBeNull()
  })

  it('is reached when the month’s PRICED overage meets the figure, not before', () => {
    // FORCED RED by comparing credits to the cap instead of dollars: 2,000
    // credits over reads as 2,000 >= 6 and the ceiling fires at the band.
    const org = capped(6)
    expect(assistOverageCapReached(org, assistUsdFromCredits(PRO_BAND))).toBe(false)
    expect(assistOverageCapReached(org, assistUsdFromCredits(PRO_BAND + 1_000))).toBe(false)
    // $5.97 of overage against a $6 ceiling: under.
    expect(assistOverageCapReached(org, assistUsdFromCredits(PRO_BAND + 1_990))).toBe(false)
    // Exactly $6.00: reached. An org that asked to stop AT a figure is
    // stopped when the figure is met.
    expect(assistOverageCapReached(org, assistUsdFromCredits(PRO_BAND + 2_000))).toBe(true)
    expect(assistOverageCapReached(org, assistUsdFromCredits(PRO_BAND + 9_000))).toBe(true)
  })

  it('is the invoice’s own arithmetic — the figure it stops at is the figure billed', () => {
    const org = capped(6)
    const spend = assistUsdFromCredits(PRO_BAND + 2_000)
    expect(assistMonthOverage(org, spend).overageMonthlyUsd).toBe(6)
    expect(assistOverageCapReached(org, spend)).toBe(true)
  })

  it('is never reached without a ceiling, however far past the band', () => {
    expect(assistOverageCapReached({ plan: 'pro' }, assistUsdFromCredits(PRO_BAND + 90_000))).toBe(false)
    expect(assistOverageCapReached(capped('6'), assistUsdFromCredits(PRO_BAND + 90_000))).toBe(false)
  })

  it('is never reached on a plan with no rate — the overage prices to zero, structurally', () => {
    // Enterprise: a band, no rate. Free with a contracted band: the same.
    // Neither has a check for it; zero simply never meets a positive figure.
    for (const org of [
      { plan: 'enterprise' as const, assistOverage: { capUsd: 1 } },
      {
        plan: 'free' as const,
        entitlements: { assistCreditsPerMonth: 300 },
        assistOverage: { capUsd: 1 },
      },
    ]) {
      expect(assistOverageCapReached(org, 500)).toBe(false)
      expect(assistRefusedByOverageCap(org, 'cap')).toBe(false)
    }
  })

  it('a refusal is the ceiling’s own only when the ceiling caused it', () => {
    const org = capped(6)
    expect(assistRefusedByOverageCap(org, 'cap')).toBe(true)
    for (const other of ['band', 'budget', 'messages', null] as const) {
      expect(assistRefusedByOverageCap(org, other)).toBe(false)
    }
    // No ceiling set: a `cap` refusal is not this org's and must not send
    // the user to a control that shows nothing.
    expect(assistRefusedByOverageCap({ plan: 'pro' }, 'cap')).toBe(false)
    // AGL-3014 was Starter's rate living off `PLAN_PRICING`: read from the
    // table, this answered false for an org that could really reach a
    // ceiling, so the ceiling that refused was not the ceiling the sentence
    // named. AGL-3203 removed the split — Starter carries its own band and
    // rate — so BOTH shapes answer true, with and without the add-on, and
    // the divergence the bug was made of cannot recur.
    expect(
      assistRefusedByOverageCap(
        { plan: 'starter', seatAddons: { aiAddon: 1 }, assistOverage: { capUsd: 6 } },
        'cap',
      ),
    ).toBe(true)
    expect(
      assistRefusedByOverageCap({ plan: 'starter', assistOverage: { capUsd: 6 } }, 'cap'),
    ).toBe(true)
    // The premise stays: a plan with NO rate still cannot reach a ceiling,
    // so `true` above is the rate and not the function agreeing always.
    expect(
      assistRefusedByOverageCap({ plan: 'free', assistOverage: { capUsd: 6 } }, 'cap'),
    ).toBe(false)
  })

  it('the switch and the ceiling are told apart, and each names only itself', () => {
    const stoppedAtBand = { plan: 'pro' as const, assistOverage: { hardCap: true, capUsd: 6 } }
    expect(assistRefusedByHardCap(stoppedAtBand, 'band')).toBe(true)
    expect(assistRefusedByOverageCap(stoppedAtBand, 'band')).toBe(false)
    expect(assistRefusedByHardCap(stoppedAtBand, 'cap')).toBe(false)
    expect(assistRefusedByOverageCap(stoppedAtBand, 'cap')).toBe(true)
    expect(assistOwnControlRefusalText(stoppedAtBand, 'band')).toContain(
      `"${ASSIST_HARD_CAP_CONTROL_LABEL}"`,
    )
    expect(assistOwnControlRefusalText(stoppedAtBand, 'cap')).toContain(
      `"${ASSIST_OVERAGE_CAP_CONTROL_LABEL}"`,
    )
    // Nobody's control: the message cap, the operator's figure, an admission.
    for (const other of ['messages', 'budget', null] as const) {
      expect(assistOwnControlRefusalText(stoppedAtBand, other)).toBeNull()
    }
  })

  it('the refusal sentence names the control, quotes the figure, and says where it lives', () => {
    const text = assistOverageCapRefusalText(capped(6))
    expect(text).toContain(`"${ASSIST_OVERAGE_CAP_CONTROL_LABEL}"`)
    expect(text).toContain('$6.00')
    expect(text).toContain(ASSIST_HARD_CAP_CONTROL_LOCATION)
    // No dollar figure of OURS — the ceiling is the customer's own number.
    for (const leak of ['costUsd', 'estCostUsd', '0.001', 'provider']) {
      expect(text).not.toContain(leak)
    }
    expect(ASSIST_OVERAGE_CAP_CONTROL_LABEL).toMatch(/^[A-Z][a-z]/)
    expect(ASSIST_OVERAGE_CAP_CONTROL_LABEL).not.toMatch(/[_{}]/)
  })
})

describe('Free is a WALL, on the real plan row (AGL-2898, AGL-2925)', () => {
  /**
   * A Free org on the plan row as shipped: the 300-credit taste. It has a
   * band to measure against and no rate to sell past it at, so the band is
   * a wall: refused there, billed nothing, offered no control — and nothing
   * here is a Free-specific check, it all follows from
   * `extraAssistCreditsUsdPer1k` being `null`. This block was written
   * against an entitlements override of 300 before the constant existed.
   */
  const freeWithBand = { plan: 'free' as const }

  it('has the band, and no rate', () => {
    expect(resolveAssistCreditBudget(freeWithBand)).toBe(300)
    expect(resolveAssistCreditBudget(freeWithBand)).toBe(FREE_AI_TASTE_CREDITS_PER_MONTH)
    expect(PLAN_PRICING.free.extraAssistCreditsUsdPer1k).toBeNull()
    expect(assistBandRefuses(freeWithBand)).toBe(true)
    // A band WIDENED by staff is a wall all the same.
    const widened = { plan: 'free' as const, entitlements: { assistCreditsPerMonth: 900 } }
    expect(resolveAssistCreditBudget(widened)).toBe(900)
    expect(assistBandRefuses(widened)).toBe(true)
    expect(assistOwnControlRefusalText(widened, 'band')).toBeNull()
  })

  it('prices NOTHING past the band', () => {
    // FORCED RED by pricing a null rate as 0 per 1,000 instead of skipping:
    // the overage credits would still count and the dollars would be 0, so
    // this asserts both halves of "billed nothing".
    const month = assistMonthOverage(freeWithBand, assistUsdFromCredits(900))
    expect(month).toMatchObject({
      usedCredits: 900,
      bandCredits: 300,
      overageCredits: 600,
      overageMonthlyUsd: 0,
      overageRateUsd: null,
    })
  })

  it('names NO control when refused at the band — there is nothing to switch', () => {
    // A refusal at the band on this org is the plan's, not the org's: the
    // switch is off, and turning it on would change nothing.
    expect(assistRefusedByHardCap(freeWithBand, 'band')).toBe(false)
    expect(assistRefusedByHardCap({ ...freeWithBand, assistOverage: { hardCap: true } }, 'band')).toBe(false)
    expect(assistOwnControlRefusalText(freeWithBand, 'band')).toBeNull()
    // And a ceiling on it is inert: zero overage never reaches one.
    expect(assistOverageCapReached({ ...freeWithBand, assistOverage: { capUsd: 1 } }, 500)).toBe(false)
    expect(assistOwnControlRefusalText({ ...freeWithBand, assistOverage: { capUsd: 1 } }, 'cap')).toBeNull()
  })

  it('the card’s "nothing to stop" reading: sells no overage, switch off', () => {
    // What the assist-overage route serves the card, from the same
    // resolvers: a band, no rate, so `sellsOverage` is false and with the
    // switch off the card offers neither the switch nor the ceiling.
    const bandCredits = resolveAssistCreditBudget(freeWithBand)
    const rate = PLAN_PRICING[resolveEffectivePlan(freeWithBand)].extraAssistCreditsUsdPer1k
    const sellsOverage = bandCredits !== null && rate !== null
    const nothingToStop = !sellsOverage && !resolveAssistHardCap(freeWithBand)
    expect(sellsOverage).toBe(false)
    expect(nothingToStop).toBe(true)
  })
})

describe('the Free taste’s own refusals have their own sentences (AGL-2925)', () => {
  it('names a clock or an upgrade for each rung, and nothing for any other refusal', () => {
    expect(assistFreeTasteRefusalText('account')).toMatch(/across your workspaces/)
    expect(assistFreeTasteRefusalText('account')).toMatch(/upgrade/i)
    expect(assistFreeTasteRefusalText('requests')).toMatch(/tomorrow/)
    expect(assistFreeTasteRefusalText('refusals')).toMatch(/paused until tomorrow/)
    expect(assistFreeTasteRefusalText('platform')).toMatch(/try again tomorrow/i)
    expect(assistFreeTasteRefusalText('platform')).toMatch(/Paid workspaces are not affected/)
    for (const other of ['messages', 'budget', 'band', 'cap', null] as const) {
      expect(assistFreeTasteRefusalText(other)).toBeNull()
    }
  })

  it('is customer-safe: no dollar figure, no counter, no other workspace named', () => {
    for (const rung of ['account', 'requests', 'refusals', 'platform'] as const) {
      const text = assistFreeTasteRefusalText(rung) as string
      expect(text).not.toMatch(/\$/)
      expect(text).not.toMatch(/\d/)
      expect(text).not.toMatch(/uid|Firestore|ceiling/i)
    }
  })
})
