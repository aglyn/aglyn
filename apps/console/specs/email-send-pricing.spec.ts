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
 * EMAIL SENDING HAS A PRICE, AND THE PRICE IS NOT OUR COST.
 *
 * Sending was metered from the day the counters were built and priced on none
 * of it. `email-metering.ts` said so in as many words — the meter was
 * "RECORDED, NOT PRICED", entering neither `billedCents` nor `costUsd` nor
 * `ORG_COGS_UNIT_RATES_USD` — so every message the platform sent was absorbed
 * whole. Against the bands the plans included that ran 28-36% of the
 * subscription at Business and above, and Enterprise was `UNLIMITED`, which
 * is not a percentage of anything.
 *
 * Three things changed together and each one can silently undo another:
 *
 *  1. the included bands came DOWN on the four tiers whose email COGS was
 *     unsustainable, and stayed put on the three whose was not;
 *  2. a RETAIL overage rate went on beside the contacts and API rates, tiered
 *     so higher plans pay less per message;
 *  3. our own per-message COST went into the COGS table, so margin reporting
 *     stops reading email as free.
 *
 * ## The failure this file is mostly about
 *
 * (2) and (3) are two numbers about the same unit, three decimal places
 * apart, and the platform publishes one of them. `METERED_BILLED_RATES_USD`
 * is the customer-facing table and its every member is a cost passed through
 * at `METERED_MARKUP` — the published term is literally "at cost + 30%". Put
 * the email cost in there and the claim becomes false about the three meters
 * it really describes; quote the cost anywhere a price belongs and we have
 * published a figure no invoice uses.
 *
 * So the two rates are asserted DISTINCT, in the right tables, with neither
 * reachable from the other's accessor.
 *
 * ## Anti-vacuity
 *
 * Every band and rate here is read through `PLAN_ENTITLEMENTS` /
 * `PLAN_PRICING` by string key. A rename, a stubbed resolver or a collapsed
 * table would make every reading `undefined` or `0`, and a ceiling test whose
 * inputs are all zero passes by refusing everything. The first describe block
 * drives the detectors against synthetic tables in BOTH directions before any
 * real plan is judged by one.
 */

import {
  METERED_BILLED_RATES_USD,
  METERED_MARKUP,
  METERED_UNIT_RATES_USD,
} from '../utils/usage-metering'
import {
  ENTERPRISE_EMAIL_SENDS_PER_MONTH,
  ORG_COGS_UNIT_RATES_USD,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  SELF_SERVE_PLANS,
  UNLIMITED,
  isCustomPricedPlan,
  priceEmailSendOverage,
  resolveOrgEntitlements,
} from '@aglyn/aglyn'
import type { OrgPlan } from '@aglyn/aglyn'

const PLAN_KEYS = Object.keys(PLAN_ENTITLEMENTS) as OrgPlan[]

/** The paid, self-serve tiers — the ones with both a band and a list price. */
const PAID = SELF_SERVE_PLANS.filter((plan) => plan !== 'free')

/** Included email COGS as a fraction of the tier's monthly price. */
function includedEmailCogsShare(
  band: number,
  monthlyUsd: number,
  perEmail = ORG_COGS_UNIT_RATES_USD.perEmailSend,
): number {
  if (!(monthlyUsd > 0)) return 0
  return (band * perEmail) / monthlyUsd
}

/** Tiers whose included email COGS exceeds `ceiling`, from any table shape. */
function tiersOverCogsCeiling(
  bands: Record<string, number>,
  prices: Record<string, number>,
  ceiling: number,
): string[] {
  return Object.keys(bands)
    .filter((plan) => includedEmailCogsShare(bands[plan], prices[plan]) > ceiling)
    .sort()
}

// ---------------------------------------------------------------------------
// THE CONTROL. Run first, on synthetic input, so nothing below can be green
// because the reading collapsed.
// ---------------------------------------------------------------------------
describe('the detectors answer differently for different inputs', () => {
  const PRICES = { thin: 100, fat: 100 }

  it('names a tier whose included band is too expensive for its price', () => {
    // 50,000 x $0.0009 = $45 against $100 — 45%.
    expect(
      tiersOverCogsCeiling({ thin: 1_000, fat: 50_000 }, PRICES, 0.2),
    ).toEqual(['fat'])
  })

  it('names NOBODY once the same band comes down', () => {
    // The other direction. A detector that always reported an offender would
    // make the real assertion below unfalsifiable in the safe direction.
    expect(
      tiersOverCogsCeiling({ thin: 1_000, fat: 20_000 }, PRICES, 0.2),
    ).toEqual([])
  })

  it('treats an unbounded band as over any ceiling, never as zero', () => {
    // The shape that hides: `UNLIMITED` is `Infinity`, and an analysis that
    // scored an absent or non-finite band as 0 would report the single most
    // expensive row on the table as the cheapest.
    expect(
      tiersOverCogsCeiling({ boundless: UNLIMITED }, { boundless: 100 }, 0.2),
    ).toEqual(['boundless'])
  })

  it('reads the real tables, not a resolver that returned nothing', () => {
    // `resolveOrgEntitlements(undefined)` resolves FREE, whose band is 0 — so
    // a wiring failure that lost the plan would read every band as zero and
    // every assertion in this file would agree that nothing is too expensive.
    expect(PLAN_KEYS.length).toBe(8)
    expect(PLAN_ENTITLEMENTS.free.emailSendsPerMonth).toBe(0)
    expect(PLAN_ENTITLEMENTS.agency.emailSendsPerMonth).toBeGreaterThan(0)
    // …and the bands are genuinely different between tiers, so a table that
    // collapsed to one number cannot pass either.
    expect(
      new Set(PLAN_KEYS.map((plan) => PLAN_ENTITLEMENTS[plan].emailSendsPerMonth))
        .size,
    ).toBe(8)
    expect(ORG_COGS_UNIT_RATES_USD.perEmailSend).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// (1) The bands.
// ---------------------------------------------------------------------------
describe('the included campaign-email bands', () => {
  /**
   * All eight, by name and value.
   *
   * The unchanged three are asserted as loudly as the changed five, and that
   * is the point of writing them out rather than testing only what moved: a
   * sweep that lowered every tier would satisfy "Business is 25,000" and be a
   * different, much worse change. Free is 0 because Free sends no campaigns
   * at all, and Starter and Pro did not move because their email COGS was
   * already 1.8% and 8.0% of price.
   */
  it('are exactly these, on every plan', () => {
    expect(
      Object.fromEntries(
        PLAN_KEYS.map((plan) => [plan, PLAN_ENTITLEMENTS[plan].emailSendsPerMonth]),
      ),
    ).toEqual({
      free: 0,
      starter: 500,
      pro: 5_000,
      business: 25_000,
      scale: 40_000,
      advanced: 65_000,
      agency: 130_000,
      enterprise: 250_000,
    })
  })

  it('rise monotonically up the self-serve ladder, and Enterprise tops it', () => {
    const ladder = SELF_SERVE_PLANS.map(
      (plan) => PLAN_ENTITLEMENTS[plan].emailSendsPerMonth,
    )
    expect(ladder).toEqual([...ladder].sort((a, b) => a - b))
    expect(PLAN_ENTITLEMENTS.enterprise.emailSendsPerMonth).toBeGreaterThan(
      PLAN_ENTITLEMENTS.agency.emailSendsPerMonth,
    )
  })

  /**
   * The reason the four came down, as arithmetic rather than as a story.
   *
   * 20% is the ceiling rather than the 15% the bands were dimensioned to,
   * because a guard set at the target fails on rounding and teaches people to
   * move the guard. What it has to catch is the old shape, and the old shape
   * was 28-36%.
   */
  it('cost us at most 20% of the subscription when fully spent', () => {
    const bands = Object.fromEntries(
      PAID.map((plan) => [plan, PLAN_ENTITLEMENTS[plan].emailSendsPerMonth]),
    )
    const prices = Object.fromEntries(
      PAID.map((plan) => [plan, PLAN_PRICING[plan].basePriceMonthlyUsd]),
    )
    expect(tiersOverCogsCeiling(bands, prices, 0.2)).toEqual([])
  })

  it('MUTATION: the pre-change bands do not clear that ceiling', () => {
    // Without this the assertion above could be satisfied by a ceiling set so
    // loosely that nothing could ever fail it. These are the figures that
    // were shipping, and four of them are offenders.
    //
    // The PRICES are the pre-change ones too, written out rather than read:
    // Agency's has since moved to $1,299, and measuring an old band against a
    // new price would compare two states neither of which ever shipped.
    const prices = {
      starter: 25,
      pro: 56,
      business: 139,
      scale: 249,
      advanced: 399,
      agency: 799,
    }
    expect(
      tiersOverCogsCeiling(
        {
          starter: 500,
          pro: 5_000,
          business: 50_000,
          scale: 100_000,
          advanced: 125_000,
          agency: 250_000,
        },
        prices,
        0.2,
      ),
    ).toEqual(['advanced', 'agency', 'business', 'scale'])
  })

  it('states each tier share as a number, so a drift is legible', () => {
    const share = (plan: OrgPlan) =>
      Number(
        (
          includedEmailCogsShare(
            PLAN_ENTITLEMENTS[plan].emailSendsPerMonth,
            PLAN_PRICING[plan].basePriceMonthlyUsd,
          ) * 100
        ).toFixed(1),
      )
    expect(Object.fromEntries(PAID.map((plan) => [plan, share(plan)]))).toEqual({
      starter: 1.8,
      pro: 8,
      business: 16.2,
      scale: 14.5,
      advanced: 14.7,
      // Agency reads lower than its neighbours because its PRICE moved as
      // well as its band — $1,299, not $799.
      agency: 9,
    })
  })
})

// ---------------------------------------------------------------------------
// (2) and (3). The two rates, and the tables they live in.
// ---------------------------------------------------------------------------
describe('the billed rate and the cost rate are different numbers', () => {
  it('the cost is $0.90 per 1,000 and lives ONLY in the COGS table', () => {
    expect(ORG_COGS_UNIT_RATES_USD.perEmailSend).toBe(0.0009)
    expect(ORG_COGS_UNIT_RATES_USD.perEmailSend * 1000).toBeCloseTo(0.9, 9)
    // The published table must not carry it under any name. Asserted over the
    // KEYS rather than by naming one, so a `perEmailSend` added later under a
    // different spelling is caught too.
    expect(
      Object.keys(METERED_UNIT_RATES_USD).filter((rate) => /email/i.test(rate)),
    ).toEqual([])
    expect(
      Object.keys(METERED_BILLED_RATES_USD).filter((rate) => /email/i.test(rate)),
    ).toEqual([])
  })

  it('the price is a per-plan retail rate, and never the cost', () => {
    expect(
      Object.fromEntries(
        PLAN_KEYS.map((plan) => [plan, PLAN_PRICING[plan].extraEmailSendsUsdPer1k]),
      ),
    ).toEqual({
      free: null,
      starter: 2.5,
      pro: 2.25,
      business: 2,
      scale: 1.9,
      advanced: 1.85,
      agency: 1.8,
      enterprise: null,
    })
    // Not one of them equals the cost, and not one equals cost + 30% either
    // — which is what it would be if somebody derived it from the wrong
    // table by reflex.
    const cost1k = ORG_COGS_UNIT_RATES_USD.perEmailSend * 1000
    for (const plan of PAID) {
      const rate = PLAN_PRICING[plan].extraEmailSendsUsdPer1k as number
      expect(`${plan}: ${rate === cost1k}`).toBe(`${plan}: false`)
      expect(`${plan}: ${rate === cost1k * METERED_MARKUP}`).toBe(
        `${plan}: false`,
      )
      // It is a PRICE: strictly above the pass-through markup, so metered
      // email is margin rather than cost recovery.
      expect(`${plan}: ${rate > cost1k * METERED_MARKUP}`).toBe(`${plan}: true`)
    }
  })

  /**
   * THE RETAIL MARGIN FLOOR, and the two categories it must keep apart.
   *
   * Two kinds of rate live next to each other in this codebase and they are
   * priced by different rules:
   *
   *  - INFRA PASS-THROUGH — storage, page views, form submissions. Billed at
   *    `METERED_MARKUP`, and the published customer term is literally "at
   *    cost + 30%", which is a 23% line margin BY CONSTRUCTION. The published
   *    figures ARE the claim, so this floor does not apply to them and must
   *    not be made to.
   *  - RETAIL — contacts, API requests, dataset storage, email. Prices, set
   *    per tier, carrying real margin.
   *
   * The failure this catches is a descending ladder that runs past its own
   * cost floor. `extraContactsUsdPer1k` reached $0.25 against a $0.20 cost —
   * a 20% margin on a line that is supposed to be a price, THINNER than the
   * pass-through earns while being sold as the opposite thing.
   *
   * The categories are named explicitly rather than inferred, so a future
   * editor cannot get a green by quietly reclassifying a rate.
   */
  const RETAIL_LINES = [
    { rate: 'extraEmailSendsUsdPer1k', cost: 0.0009 * 1000, unit: 'per 1,000 emails' },
    { rate: 'extraContactsUsdPer1k', cost: 0.0002 * 1000, unit: 'per 1,000 contact-months' },
    { rate: 'extraApiRequestsUsdPer1k', cost: 0.000002 * 1000, unit: 'per 1,000 API requests' },
  ] as const

  /** Retail lines below the floor, from any pricing table shape. */
  function underMarginFloor(
    table: Record<string, Record<string, number | null>>,
    floor: number,
  ): string[] {
    const offenders: string[] = []
    for (const { rate, cost } of RETAIL_LINES) {
      for (const plan of Object.keys(table)) {
        const price = table[plan]?.[rate]
        if (price == null) continue
        if ((price - cost) / price < floor) offenders.push(`${plan}.${rate}`)
      }
    }
    return offenders.sort()
  }

  it('CONTROL: the floor detector answers both ways', () => {
    // $1.00 against a $0.90 cost is 10%; $2.00 is 55%.
    expect(
      underMarginFloor({ thin: { extraEmailSendsUsdPer1k: 1 } }, 0.5),
    ).toEqual(['thin.extraEmailSendsUsdPer1k'])
    expect(
      underMarginFloor({ fat: { extraEmailSendsUsdPer1k: 2 } }, 0.5),
    ).toEqual([])
    // A null rate is not an offender — it is a line that does not exist.
    expect(
      underMarginFloor({ none: { extraEmailSendsUsdPer1k: null } }, 0.5),
    ).toEqual([])
  })

  it('every RETAIL overage rate clears a 50% line margin', () => {
    expect(underMarginFloor(PLAN_PRICING as never, 0.5)).toEqual([])
  })

  it('MUTATION: the pre-floor email and contacts rates do not clear it', () => {
    // The ladders as they were before the floor was applied. Email ran down
    // to $1.25 (28%) and contacts to $0.25 (20%).
    expect(
      underMarginFloor(
        {
          scale: { extraEmailSendsUsdPer1k: 1.75 },
          advanced: { extraEmailSendsUsdPer1k: 1.5, extraContactsUsdPer1k: 0.25 },
          agency: { extraEmailSendsUsdPer1k: 1.25 },
        },
        0.5,
      ),
    ).toEqual([
      'advanced.extraContactsUsdPer1k',
      'advanced.extraEmailSendsUsdPer1k',
      'agency.extraEmailSendsUsdPer1k',
      'scale.extraEmailSendsUsdPer1k',
    ])
  })

  it('does NOT apply the floor to the infra pass-through', () => {
    // The three pass-through rates earn 23% by construction — they are cost x
    // 1.30, and "at cost + 30%" is a published promise. A guard that swept
    // them in would be red on shipped, correct, PUBLISHED prices, and the
    // cheapest way to get it green would be to change one of them.
    const passThroughMargin =
      (METERED_BILLED_RATES_USD.perPageView -
        METERED_UNIT_RATES_USD.perPageView) /
      METERED_BILLED_RATES_USD.perPageView
    expect(passThroughMargin).toBeCloseTo(0.2308, 4)
    expect(passThroughMargin).toBeLessThan(0.5)
    // …and none of the three is a key this guard reads.
    for (const { rate } of RETAIL_LINES) {
      expect(Object.keys(METERED_BILLED_RATES_USD)).not.toContain(rate)
    }
  })

  it('descends with the tier, the way contacts and API requests do', () => {
    const ladder = PAID.map(
      (plan) => PLAN_PRICING[plan].extraEmailSendsUsdPer1k as number,
    )
    expect(ladder).toEqual([...ladder].sort((a, b) => b - a))
    // Strictly, not merely non-increasing — a flat ladder is not a ladder.
    expect(new Set(ladder).size).toBe(ladder.length)
  })

  /**
   * The three infrastructure pass-through rates are the ONLY figures the
   * "at cost + 30%" sentence describes, and they are duplicated across two
   * tables on purpose. They must not have moved.
   */
  it('leaves the three pass-through rates identical in both tables', () => {
    for (const key of [
      'storagePerGbMonth',
      'perPageView',
      'perFormSubmission',
    ] as const) {
      expect(`${key}: ${METERED_UNIT_RATES_USD[key]}`).toBe(
        `${key}: ${ORG_COGS_UNIT_RATES_USD[key]}`,
      )
    }
    expect(METERED_MARKUP).toBe(1.3)
    expect(METERED_BILLED_RATES_USD.storagePerGbMonth).toBeCloseTo(0.0338, 6)
    expect(METERED_BILLED_RATES_USD.perPageView * 1000).toBeCloseTo(0.13, 6)
    expect(METERED_BILLED_RATES_USD.perFormSubmission * 1000).toBeCloseTo(
      0.065,
      6,
    )
  })

  it('MUTATION: the pairing check can tell the two tables apart', () => {
    // Both halves of the previous case would pass against a `METERED_UNIT_
    // RATES_USD` that had silently become the COGS table itself. Prove the
    // comparison is real by showing the two objects are NOT the same object
    // and do not hold the same keys.
    expect(METERED_UNIT_RATES_USD).not.toBe(ORG_COGS_UNIT_RATES_USD);
    expect(Object.keys(METERED_UNIT_RATES_USD).sort()).not.toEqual(
      Object.keys(ORG_COGS_UNIT_RATES_USD).sort(),
    )
    expect(Object.keys(ORG_COGS_UNIT_RATES_USD)).toContain('perEmailSend')
  })
})

// ---------------------------------------------------------------------------
// The rate reaching an invoice figure.
// ---------------------------------------------------------------------------
describe('priceEmailSendOverage', () => {
  it('prices the excess at the plan rate, to the cent', () => {
    // Business: $2.00/1,000. 4,321 over = $8.642 → $8.64.
    const priced = priceEmailSendOverage({ plan: 'business' } as never, 4_321)
    expect(priced.overageRateUsd).toBe(2)
    expect(priced.overageSends).toBe(4_321)
    expect(priced.overageMonthlyUsd).toBe(8.64)
  })

  it('charges a cheaper tier less for the same excess', () => {
    // Non-vacuous: a stubbed plan resolution would return one rate for every
    // org, and every assertion about "the plan's rate" would still pass.
    const business = priceEmailSendOverage({ plan: 'business' } as never, 10_000)
    const agency = priceEmailSendOverage({ plan: 'agency' } as never, 10_000)
    expect(business.overageMonthlyUsd).toBe(20)
    expect(agency.overageMonthlyUsd).toBe(18)
  })

  it('is structurally zero where the plan carries no rate', () => {
    for (const plan of ['free', 'enterprise'] as const) {
      const priced = priceEmailSendOverage({ plan } as never, 1_000_000)
      expect(`${plan}: ${priced.overageRateUsd}`).toBe(`${plan}: null`)
      expect(`${plan}: ${priced.overageMonthlyUsd}`).toBe(`${plan}: 0`)
    }
    // An unresolvable org resolves as free, which bills nothing. Billing
    // somebody with no subscription is the error with no recovery.
    expect(priceEmailSendOverage(null, 1_000_000).overageMonthlyUsd).toBe(0)
  })

  it('never turns a nonsense reading into a charge', () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const priced = priceEmailSendOverage({ plan: 'agency' } as never, bad)
      expect(`${bad}: ${priced.overageMonthlyUsd}`).toBe(`${bad}: 0`)
      expect(`${bad}: ${priced.overageSends}`).toBe(`${bad}: 0`)
    }
  })

  it('carries no `allowed`, because nothing may gate on this', () => {
    // The cap refuses CAMPAIGNS, inside a transaction, somewhere else.
    // Transactional mail is refused nowhere. A field named `allowed` on a
    // pricing result is a plausible thing for a sender to consult, and a
    // transactional sender consulting it is how a password reset stops going
    // out — see `email-send-metering-coverage.spec.ts`.
    expect(
      Object.keys(priceEmailSendOverage({ plan: 'pro' } as never, 1)),
    ).toEqual(['overageSends', 'overageMonthlyUsd', 'overageRateUsd'])
  })
})

// ---------------------------------------------------------------------------
// (4) Enterprise: a number, not a sentinel.
// ---------------------------------------------------------------------------
describe('the Enterprise band is contracted, finite, and survives the wire', () => {
  it('defaults to a figure the sending platform can actually deliver', () => {
    expect(ENTERPRISE_EMAIL_SENDS_PER_MONTH).toBe(250_000)
    expect(PLAN_ENTITLEMENTS.enterprise.emailSendsPerMonth).toBe(
      ENTERPRISE_EMAIL_SENDS_PER_MONTH,
    )
    expect(Number.isFinite(ENTERPRISE_EMAIL_SENDS_PER_MONTH)).toBe(true)
    expect(isCustomPricedPlan('enterprise')).toBe(true)
  })

  /**
   * The defect the sentinel produced, exercised rather than described.
   *
   * `UNLIMITED` is `Number.POSITIVE_INFINITY`; `JSON.stringify` writes it as
   * `null`; `Number(null)` is `0`; and `Number.isFinite(0)` is TRUE — so it
   * cleared every guard written to reject a payload that could not state its
   * terms, and the console rendered a cap of zero on the most expensive plan
   * on the price list.
   */
  it('round-trips through JSON as a number, never as null or 0', () => {
    // The hazard, first, so the assertion after it is not a coincidence.
    expect(JSON.parse(JSON.stringify(UNLIMITED))).toBeNull()
    expect(Number(JSON.parse(JSON.stringify(UNLIMITED)))).toBe(0)
    expect(Number.isFinite(Number(JSON.parse(JSON.stringify(UNLIMITED))))).toBe(
      true,
    )

    const overTheWire = JSON.parse(
      JSON.stringify({ emailSendsPerMonth: ENTERPRISE_EMAIL_SENDS_PER_MONTH }),
    )
    expect(typeof overTheWire.emailSendsPerMonth).toBe('number')
    expect(overTheWire.emailSendsPerMonth).toBe(250_000)
    expect(overTheWire.emailSendsPerMonth).not.toBeNull()
    expect(overTheWire.emailSendsPerMonth).not.toBe(0)
  })

  it('every plan on the table survives that round trip', () => {
    const round = JSON.parse(JSON.stringify(PLAN_ENTITLEMENTS))
    for (const plan of PLAN_KEYS) {
      const sent = round[plan].emailSendsPerMonth
      expect(`${plan}: ${typeof sent}`).toBe(`${plan}: number`)
      expect(`${plan}: ${sent}`).toBe(
        `${plan}: ${PLAN_ENTITLEMENTS[plan].emailSendsPerMonth}`,
      )
    }
  })

  it('MUTATION: the round-trip check catches a band that is still Infinity', () => {
    // The same check, run against the table as it was. It has to fail, or the
    // green above says nothing.
    const asShipped = JSON.parse(
      JSON.stringify({ emailSendsPerMonth: UNLIMITED }),
    )
    expect(typeof asShipped.emailSendsPerMonth).not.toBe('number')
    expect(Number(asShipped.emailSendsPerMonth)).toBe(0)
  })

  it('is a DEFAULT a contract raises, not a limit a contract meets', () => {
    // The entitlement override is the instrument a deal uses, and it resolves
    // ahead of the plan row — so the table is the contracted figure rather
    // than a global fiction. Both directions: an agreement can buy more, and
    // an agreement that bought nothing gets the defensible default.
    const contracted = resolveOrgEntitlements({
      plan: 'enterprise',
      entitlements: { emailSendsPerMonth: 2_000_000 },
    } as never)
    expect(contracted.emailSendsPerMonth).toBe(2_000_000)
    const uncontracted = resolveOrgEntitlements({ plan: 'enterprise' } as never)
    expect(uncontracted.emailSendsPerMonth).toBe(ENTERPRISE_EMAIL_SENDS_PER_MONTH)
  })
})

// ---------------------------------------------------------------------------
// The rule the Agency contacts defect wrote down, applied to this axis.
// ---------------------------------------------------------------------------
describe('band and rate agree about whether an "over" exists', () => {
  it('no plan sells an uncapped email band', () => {
    // The premise for the rule below, and the thing that makes it currently
    // vacuous — stated out loud rather than left as a silent pass.
    for (const plan of PLAN_KEYS) {
      const band = PLAN_ENTITLEMENTS[plan].emailSendsPerMonth
      expect(`${plan}: ${band === UNLIMITED}`).toBe(`${plan}: false`)
    }
  })

  it('an uncapped band would carry no rate, if one ever appeared', () => {
    // `Math.max(0, used - Infinity)` is 0 at every usage level, so a rate on
    // an uncapped band advertises a fee that cannot be charged — which is
    // exactly what Agency shipped for contacts.
    const offenders = PLAN_KEYS.filter(
      (plan) =>
        PLAN_ENTITLEMENTS[plan].emailSendsPerMonth === UNLIMITED &&
        PLAN_PRICING[plan].extraEmailSendsUsdPer1k != null,
    )
    expect(offenders).toEqual([])
  })

  it('every paid tier with a finite band carries a rate', () => {
    // The converse, and the one that bites here: usage past a bounded band
    // with no rate is silently free, and the bound achieves nothing.
    for (const plan of PAID) {
      expect(`${plan}: ${PLAN_PRICING[plan].extraEmailSendsUsdPer1k}`).not.toBe(
        `${plan}: null`,
      )
      expect(Number.isFinite(PLAN_ENTITLEMENTS[plan].emailSendsPerMonth)).toBe(
        true,
      )
    }
  })

  it('Free and Enterprise are the two deliberate nulls', () => {
    // Free's band is 0 and it has no subscription to hang a metered item on —
    // the same reason every other `extra*` rate is null there. Enterprise
    // publishes no list price at all; its terms are the agreement.
    expect(PLAN_PRICING.free.extraEmailSendsUsdPer1k).toBeNull()
    expect(PLAN_PRICING.free.basePriceMonthlyUsd).toBe(0)
    expect(PLAN_PRICING.enterprise.extraEmailSendsUsdPer1k).toBeNull()
    expect(isCustomPricedPlan('enterprise')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// No charged price moved.
// ---------------------------------------------------------------------------
describe('exactly one list price moved with the email change', () => {
  it('the six unchanged ones are still what they were', () => {
    // The email work moved no price at all; the band resize that followed it
    // moved exactly one. Both halves are asserted, because "we changed a
    // price" and "we changed the price list" are different events.
    expect(
      SELF_SERVE_PLANS.filter((plan) => plan !== 'agency').map(
        (plan) => PLAN_PRICING[plan].basePriceMonthlyUsd,
      ),
    ).toEqual([0, 25, 56, 139, 249, 399])
    expect(
      SELF_SERVE_PLANS.filter((plan) => plan !== 'agency').map(
        (plan) => PLAN_PRICING[plan].basePriceAnnualMonthlyUsd,
      ),
    ).toEqual([0, 16, 39, 99, 179, 299])
  })

  it('Agency is the one that did, on both intervals together', () => {
    // Moving the monthly alone would have widened the annual discount to 50%
    // on the single tier being repriced for margin.
    expect(PLAN_PRICING.agency.basePriceMonthlyUsd).toBe(1299)
    expect(PLAN_PRICING.agency.basePriceAnnualMonthlyUsd).toBe(1049)
    const discount =
      1 -
      PLAN_PRICING.agency.basePriceAnnualMonthlyUsd /
        PLAN_PRICING.agency.basePriceMonthlyUsd
    expect(discount).toBeCloseTo(1 - 649 / 799, 2)
  })

  it('the dataset add-on rate is NOT the metered storage pass-through', () => {
    // `/pricing` carries two per-GB-month figures and they mean different
    // things: $0.0338 is the metered pass-through on GCS media bytes, and
    // this is the retail line on Firestore-backed dataset bytes. Confusing
    // them is a standing hazard, so both are pinned here beside each other.
    for (const plan of PAID) {
      expect(`${plan}: ${PLAN_PRICING[plan].extraDataGbMonthlyUsd}`).toBe(
        `${plan}: 0.36`,
      )
    }
    expect(METERED_BILLED_RATES_USD.storagePerGbMonth).toBeCloseTo(0.0338, 6)
    // …and the retail line clears the 50% floor against its own cost, which
    // is what moved it off $0.25 (a 28% margin).
    const cost = ORG_COGS_UNIT_RATES_USD.dataStoragePerGbMonth
    expect((0.36 - cost) / 0.36).toBeGreaterThanOrEqual(0.5)
    expect((0.25 - cost) / 0.25).toBeLessThan(0.5)
  })
})
