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
  BNPL_PROCESSING_PERCENT,
  CARD_PROCESSING_PERCENT,
  bindingMarketplaceFeePct,
  PLAN_ENTITLEMENTS,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  isBelowMarketplacePriceFloor,
  marketplaceBreakEvenUsd,
  marketplaceMinPriceUsd,
  marketplacePriceCostNote,
  marketplacePriceFloorHint,
  marketplaceSaleEconomics,
} from './listing-price-floor'

/**
 * The arithmetic a publisher is shown while they type a price (AGL-2343).
 *
 * Pinned to whole cents because these are the amounts Stripe actually moves,
 * and pinned in BOTH directions — a fee test that only ever asserts the loss
 * cannot tell a correct calculation from one that returns a negative number
 * for everything.
 */
describe('marketplace sale economics (AGL-2343)', () => {
  // Read from the table, not restated: a spec that hard-codes the rate it is
  // checking cannot notice the table moving under it.
  const PAID_PLAN_FEE_PCT = PLAN_ENTITLEMENTS.pro.marketplaceFeePct
  const FREE_PLAN_FEE_PCT = PLAN_ENTITLEMENTS.free.marketplaceFeePct

  it('takes the binding band from the plan table, and it is the lower rate', () => {
    // The whole advice rests on quoting the band that breaks even latest. If
    // the table ever gains a cheaper paid rate, this is what notices.
    expect(PAID_PLAN_FEE_PCT).toBeLessThan(FREE_PLAN_FEE_PCT)
    expect(bindingMarketplaceFeePct()).toBe(PAID_PLAN_FEE_PCT)
  })

  it('says nothing about a free listing and nothing about a healthy price', () => {
    // The note must be SILENT in the ordinary cases or it is noise, and a
    // note that never returns undefined would pass every other test here.
    expect(marketplacePriceCostNote(0)).toBeUndefined()
    expect(marketplacePriceCostNote('')).toBeUndefined()
    expect(marketplacePriceCostNote(25)).toBeUndefined()
    expect(marketplacePriceCostNote(marketplaceBreakEvenUsd())).toBeUndefined()
  })

  it('names the cost, the fee and the minimum when the price is too low', () => {
    const note = marketplacePriceCostNote(1)
    expect(note).toContain('$1')
    expect(note).toContain('$0.36')
    expect(note).toContain('$0.20')
    expect(note).toContain(`minimum paid price is $${marketplaceMinPriceUsd()}`)
    // It reads as a REFUSAL, not as advice: the routes refuse this price, and
    // a form that said "consider raising it" would be lying to the publisher.
    expect(note).toContain('Too low to publish')
  })

  it('reproduces the $1 destination charge, cent for cent', () => {
    // Buyer $1.08, seller $0.80, $0.08 to the state, Aglyn keeps $0.20 and
    // pays Stripe $0.33 on the card rate. Net −$0.13.
    const card = marketplaceSaleEconomics(
      1,
      PAID_PLAN_FEE_PCT,
      CARD_PROCESSING_PERCENT,
    )
    expect(card).toMatchObject({
      priceCents: 100,
      taxCents: 8,
      buyerPaysCents: 108,
      sellerReceivesCents: 80,
      platformFeeCents: 20,
      processingCents: 33,
      platformNetCents: -13,
    })
    // Pay-later is dearer, and it is enabled, so it is the one that binds.
    expect(
      marketplaceSaleEconomics(
        1,
        PAID_PLAN_FEE_PCT,
        BNPL_PROCESSING_PERCENT,
      ).platformNetCents,
    ).toBe(-16)
  })

  it('turns a profit at a price that covers the processing fee', () => {
    // The OTHER branch. Without this the suite would pass against a function
    // that reported every price as a loss.
    const ten = marketplaceSaleEconomics(10, PAID_PLAN_FEE_PCT)
    expect(ten.platformFeeCents).toBe(200)
    expect(ten.platformNetCents).toBeGreaterThan(0)
    expect(ten.sellerReceivesCents).toBe(800)
    expect(ten.buyerPaysCents).toBe(1083)
    // Stripe's percentage is charged on the BUYER'S TOTAL, tax included, not
    // on the listing price — the tax is added on top and enlarges the base.
    // Asserted at $10 rather than at $1 because at a dollar the two readings
    // round to the same cent, so the cheap fixture cannot tell them apart.
    // 1083c x 6% + 30c = 95c; off the price alone it would be 90c.
    expect(ten.processingCents).toBe(95)
  })

  it('charges nothing to process a free listing', () => {
    // A $0 listing takes no payment, so the fixed 30c must not be invented.
    expect(marketplaceSaleEconomics(0, PAID_PLAN_FEE_PCT))
      .toMatchObject({
        buyerPaysCents: 0,
        processingCents: 0,
        platformNetCents: 0,
      })
  })

  it('breaks even at $3 on the enabled payment methods', () => {
    // $2 is still a loss at the 20% take rate once pay-later is in the mix,
    // so $3 is the first whole dollar that clears it — the figure the publish
    // forms show. Asserted as the BOUNDARY: the dollar below must lose.
    const breakEven = marketplaceBreakEvenUsd(PAID_PLAN_FEE_PCT)
    expect(breakEven).toBe(3)
    expect(
      marketplaceSaleEconomics(breakEven, PAID_PLAN_FEE_PCT)
        .platformNetCents,
    ).toBeGreaterThanOrEqual(0)
    expect(
      marketplaceSaleEconomics(breakEven - 1, PAID_PLAN_FEE_PCT)
        .platformNetCents,
    ).toBeLessThan(0)
  })

  it('breaks even sooner on the free plan, which takes a bigger share', () => {
    // 30% of the price against the same processing cost, so the lower band is
    // NOT the binding one and the shown figure must come from the 20% band.
    expect(
      marketplaceBreakEvenUsd(FREE_PLAN_FEE_PCT),
    ).toBe(2)
    expect(
      marketplaceBreakEvenUsd(FREE_PLAN_FEE_PCT),
    ).toBeLessThan(marketplaceBreakEvenUsd(PAID_PLAN_FEE_PCT))
  })

  it('breaks even sooner on cards alone, which is why BNPL is the default', () => {
    // If marketplace sessions ever pin `payment_method_types[0]=card`, this is
    // the figure that becomes correct — and the gap between them is the cost
    // of leaving pay-later on.
    expect(
      marketplaceBreakEvenUsd(
        PAID_PLAN_FEE_PCT,
        CARD_PROCESSING_PERCENT,
      ),
    ).toBe(2)
  })
})

/**
 * THE FLOOR ITSELF (AGL-2343). The floor exists to stop a marketplace listing
 * priced below what it costs to process, so the property under test is not
 * "the number is 3" — it is "the number is the cheapest one that does not lose
 * money".
 */
describe('marketplace price floor (AGL-2343)', () => {
  const PAID_PLAN_FEE_PCT = PLAN_ENTITLEMENTS.pro.marketplaceFeePct

  it('IS the break-even price, not a number chosen beside it', () => {
    // The two must be the same figure by construction. If the floor is ever
    // re-typed as a literal, this fails the moment the inputs move.
    expect(marketplaceMinPriceUsd()).toBe(marketplaceBreakEvenUsd())
  })

  it('does not lose money AT the floor, and does one dollar below it', () => {
    // The boundary, asserted in both directions. A floor that merely sat above
    // break-even would pass a one-sided test while overcharging publishers;
    // one that sat below it would pass a "does not lose money" test that only
    // ever checked the dollar above.
    const floor = marketplaceMinPriceUsd()
    expect(
      marketplaceSaleEconomics(floor, PAID_PLAN_FEE_PCT).platformNetCents,
    ).toBeGreaterThanOrEqual(0)
    expect(
      marketplaceSaleEconomics(floor - 1, PAID_PLAN_FEE_PCT).platformNetCents,
    ).toBeLessThan(0)
  })

  it('does not lose money at the floor on ANY plan in the table', () => {
    // The floor is one number for every publisher, so it has to clear the
    // whole table — not just the band it was derived from.
    for (const plan of Object.values(PLAN_ENTITLEMENTS)) {
      if (!(plan.marketplaceFeePct > 0)) continue
      expect(
        marketplaceSaleEconomics(marketplaceMinPriceUsd(), plan.marketplaceFeePct)
          .platformNetCents,
      ).toBeGreaterThanOrEqual(0)
    }
  })

  it('holds a paid price below it and lets zero through', () => {
    // Zero is the free listing, which takes no payment and so cannot lose
    // money on one. A predicate that treated it as "below the floor" would
    // block every free listing in the console.
    expect(isBelowMarketplacePriceFloor(0)).toBe(false)
    expect(isBelowMarketplacePriceFloor('')).toBe(false)
    expect(isBelowMarketplacePriceFloor(undefined)).toBe(false)
    expect(isBelowMarketplacePriceFloor(1)).toBe(true)
    expect(isBelowMarketplacePriceFloor(marketplaceMinPriceUsd() - 1)).toBe(true)
    expect(isBelowMarketplacePriceFloor(marketplaceMinPriceUsd())).toBe(false)
    expect(isBelowMarketplacePriceFloor(1000)).toBe(false)
  })

  it('rounds a mid-type string the way the publish routes do', () => {
    // A form's value is a string, and every route stores `Math.round`. `'2.6'`
    // is stored as $3, so the button must not refuse what the route accepts.
    expect(isBelowMarketplacePriceFloor('2.6')).toBe(false)
    expect(isBelowMarketplacePriceFloor('2.4')).toBe(true)
  })

  it('states the minimum in the standing hint, before anything is refused', () => {
    // the rule: a capability not surfaced in the console is not shipped —
    // which for a refusal means the publisher reads the minimum while typing.
    expect(marketplacePriceFloorHint()).toContain(`$${marketplaceMinPriceUsd()}`)
    expect(marketplacePriceFloorHint()).toContain('0 for free')
    expect(marketplacePriceFloorHint('Payouts first.')).toContain(
      'Payouts first.',
    )
  })
})
