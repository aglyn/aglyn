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

import type { AglynOrgBilling, OrgPlan } from '../foundation'
import {
  PROCESSING_FIXED_CENTS,
  BNPL_PROCESSING_PERCENT,
  CARD_PROCESSING_PERCENT,
  CONNECT_PAYOUT_FIXED_CENTS,
  CONNECT_PAYOUT_PERCENT,
  IN_PERSON_PROCESSING_FIXED_CENTS,
  IN_PERSON_PROCESSING_PERCENT,
  PLAN_ENTITLEMENTS,
  SALE_PROCESSING_FIXED_CENTS,
  STRIPE_TAX_PERCENT,
  TERMINAL_PROCESSING_FIXED_CENTS,
  TERMINAL_PROCESSING_PERCENT,
  SALE_PROCESSING_PERCENT,
  resolveTransactionFeeCents,
  resolveTransactionFeePct,
  saleProcessingCostCents,
} from './plan-entitlements'

/**
 * NO STOREFRONT SALE MAY COST AGLYN MORE THAN IT EARNS (AGL-2152).
 *
 * The charge-path half of this — that the figure computed here actually
 * reaches `payment_intent_data[application_fee_amount]` — is
 * `checkout-platform-margin.spec.ts` in the commerce plugin. This file is the
 * arithmetic: that the figure is non-negative for the PLATFORM at every plan
 * and every order size, including the small ones where Stripe's fixed 30¢ is
 * most of the cost.
 *
 * Written as `fee − whatStripeTakes`, never as an expected fee amount, so no
 * assertion here can be satisfied by a constant that happens to match.
 */

/** What Stripe debits from the PLATFORM's balance for one destination charge. */
function stripeCostCents(chargeCents: number, percent: number): number {
  return (
    Math.round((chargeCents * percent) / 100) + PROCESSING_FIXED_CENTS
  )
}

function orgOn(plan: OrgPlan): Partial<AglynOrgBilling> {
  return {
    plan,
    subscriptionStatus: 'active',
    entitlements: { features: { commerce: true } },
  } as unknown as Partial<AglynOrgBilling>
}

/** Stripe will not process a card charge below 50¢. */
const STRIPE_MIN_CHARGE_CENTS = 50

/** Every self-serve paid tier plus enterprise. */
const PAID_PLANS: OrgPlan[] = [
  'starter',
  'pro',
  'business',
  'scale',
  'advanced',
  'agency',
  'enterprise',
]

/** From the 50¢ minimum up past the size where the fixed 30¢ stops dominating. */
const ORDER_SIZES_CENTS = [
  50, 99, 100, 250, 500, 999, 1000, 2500, 4299, 5000, 10000, 25000, 100000,
]

describe('storefront processing recovery (AGL-2152)', () => {
  /**
   * THE ISSUE, STATED AS AN INVARIANT. Six of the seven paid tiers advertise
   * 0% on physical goods, and 0% on a DESTINATION charge is a loss rather than
   * a break-even: Stripe's fee comes out of the PLATFORM's balance.
   */
  it('leaves the platform non-negative on every paid tier at every order size', () => {
    for (const plan of PAID_PLANS) {
      for (const productType of ['physical', 'digital', 'service'] as const) {
        for (const cents of ORDER_SIZES_CENTS) {
          const fee = resolveTransactionFeeCents(
            orgOn(plan),
            productType,
            cents,
            cents,
          )
          const net =
            fee - stripeCostCents(cents, SALE_PROCESSING_PERCENT)
          expect({ plan, productType, cents, net: net >= 0 }).toEqual({
            plan,
            productType,
            cents,
            net: true,
          })
        }
      }
    }
  })

  /**
   * THE TAKE IS STILL REALLY TAKEN. Recovering the cost must not have quietly
   * eaten the advertised rate — a tier that charges 2% has to keep 2% of the
   * goods ON TOP of covering Stripe, or the pass-through has become the price.
   */
  it('keeps the advertised take on top of the recovered cost', () => {
    for (const plan of PAID_PLANS) {
      const pct = resolveTransactionFeePct(orgOn(plan), 'physical')
      if (!(pct > 0)) continue
      const cents = 10000
      const fee = resolveTransactionFeeCents(orgOn(plan), 'physical', cents, cents)
      const net =
        fee - stripeCostCents(cents, SALE_PROCESSING_PERCENT)
      expect(net).toBeGreaterThanOrEqual(Math.round((cents * pct) / 100))
    }
  })

  /**
   * THE FIXED COMPONENT IS THE WHOLE POINT. A flat percentage cannot reach
   * break-even on a small order, so a fee expressed only as a rate is
   * structurally unable to fix this — proved here rather than asserted, by
   * showing every rate the plan table holds loses money on a 50¢ sale.
   */
  it('no plan-table percentage alone clears the 30¢ fixed fee on a small order', () => {
    for (const plan of Object.keys(PLAN_ENTITLEMENTS) as OrgPlan[]) {
      for (const key of [
        'transactionFeePhysicalPct',
        'transactionFeeDigitalPct',
      ] as const) {
        const pct = PLAN_ENTITLEMENTS[plan][key]
        const takeOnly = Math.round((STRIPE_MIN_CHARGE_CENTS * pct) / 100)
        // At the CHEAPEST processing rate, the friendliest possible reading.
        expect(
          takeOnly -
            stripeCostCents(
              STRIPE_MIN_CHARGE_CENTS,
              CARD_PROCESSING_PERCENT,
            ),
        ).toBeLessThan(0)
      }
    }
  })

  /**
   * STARTER'S 2% NEVER BROKE EVEN AT ANY SIZE, which is why this change is not
   * only about the tiers that advertise zero: 2% is below the processing
   * percentage, so the gap widens with the order rather than closing.
   */
  it('the old take-only fee lost more on a bigger Starter order, not less', () => {
    const takeOnlyNet = (cents: number) =>
      Math.round((cents * PLAN_ENTITLEMENTS.starter.transactionFeePhysicalPct) / 100) -
      stripeCostCents(cents, CARD_PROCESSING_PERCENT)
    expect(takeOnlyNet(10000)).toBeLessThan(0)
    expect(takeOnlyNet(100000)).toBeLessThan(takeOnlyNet(10000))
  })

  /**
   * THE CHARGE BASE IS NOT THE GOODS BASE. The take is a cut of the goods and
   * always has been (AGL-2317); Stripe's percentage rides everything the card
   * runs for. Passing the goods figure as the charge would under-recover.
   */
  it('recovers against the charge total, not the goods the take is cut from', () => {
    const goodsCents = 3000
    const chargeCents = 3000 + 300 + 1999
    const onGoods = resolveTransactionFeeCents(
      orgOn('business'),
      'physical',
      goodsCents,
      goodsCents,
    )
    const onCharge = resolveTransactionFeeCents(
      orgOn('business'),
      'physical',
      goodsCents,
      chargeCents,
    )
    expect(onCharge).toBeGreaterThan(onGoods)
    expect(
      onGoods - stripeCostCents(chargeCents, SALE_PROCESSING_PERCENT),
    ).toBeLessThan(0)
    expect(
      onCharge - stripeCostCents(chargeCents, SALE_PROCESSING_PERCENT),
    ).toBeGreaterThanOrEqual(0)
  })

  /**
   * A FEE LARGER THAN THE CHARGE IS REJECTED BY STRIPE. The clamp can only
   * bind below Stripe's own 50¢ charge minimum, so it must never trim a real
   * order — asserted from 50¢ up.
   */
  it('never returns more than the charge, and never clamps an order of $1 or more', () => {
    expect(resolveTransactionFeeCents(orgOn('business'), 'physical', 10, 10)).toBe(10)
    // Below about 57¢ the recovery is the whole charge: Stripe's 50¢ minimum
    // with its 30¢ and the payout's 25¢ cannot be covered by any fee.
    expect(resolveTransactionFeeCents(orgOn('business'), 'physical', 50, 50)).toBe(50)
    for (const cents of ORDER_SIZES_CENTS.filter((size) => size >= 100)) {
      const fee = resolveTransactionFeeCents(orgOn('starter'), 'physical', cents, cents)
      expect(fee).toBeLessThanOrEqual(cents)
      expect(fee).toBe(
        Math.round((cents * PLAN_ENTITLEMENTS.starter.transactionFeePhysicalPct) / 100) +
          saleProcessingCostCents(cents),
      )
    }
  })

  /** Degenerate inputs must not manufacture a fee on a charge that is not one. */
  it('answers zero for a charge that is not a charge', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(resolveTransactionFeeCents(orgOn('business'), 'physical', 1000, bad)).toBe(0)
    }
    // `undefined` is NOT a degenerate input — it is the documented default,
    // for the paths where the goods and the charge are the same number.
    expect(
      resolveTransactionFeeCents(orgOn('business'), 'physical', 1000, undefined),
    ).toBe(resolveTransactionFeeCents(orgOn('business'), 'physical', 1000, 1000))
    expect(saleProcessingCostCents(0)).toBe(0)
    expect(saleProcessingCostCents(NaN)).toBe(0)
  })

  /** Rounded UP, so the recovery is never a cent short of Stripe's debit. */
  it('rounds the percentage up rather than to nearest', () => {
    // 120¢ × 3.15% = 3.78¢ — up to 4, never down.
    expect(saleProcessingCostCents(120)).toBe(4 + SALE_PROCESSING_FIXED_CENTS)
    expect(saleProcessingCostCents(101)).toBe(
      Math.ceil((101 * SALE_PROCESSING_PERCENT) / 100) +
        SALE_PROCESSING_FIXED_CENTS,
    )
    expect(saleProcessingCostCents(101)).toBeGreaterThanOrEqual(
      (101 * SALE_PROCESSING_PERCENT) / 100 +
        SALE_PROCESSING_FIXED_CENTS,
    )
  })
})

/**
 * NOT UNDER WATER ON ANY PLAN (AGL-4198). What Stripe charges the platform for
 * one online sale, from its published US pricing: the card (2.9% + 30¢), the
 * Connect payout that sends the money on (0.25% + 25¢, one payout per sale,
 * the daily-payout worst case), and Stripe Tax's 0.5% where the session runs
 * it. With a 0% take the fee must still cover all of it.
 */
function platformCostCents(chargeCents: number, options: { stripeTax?: boolean; inPerson?: boolean } = {}): number {
  const card = options.inPerson
    ? (chargeCents * TERMINAL_PROCESSING_PERCENT) / 100 + TERMINAL_PROCESSING_FIXED_CENTS
    : (chargeCents * CARD_PROCESSING_PERCENT) / 100 + PROCESSING_FIXED_CENTS
  const payout = (chargeCents * CONNECT_PAYOUT_PERCENT) / 100 + CONNECT_PAYOUT_FIXED_CENTS
  const tax = options.stripeTax ? (chargeCents * STRIPE_TAX_PERCENT) / 100 : 0
  return card + payout + tax
}

describe('every site sale covers what the platform pays for it (AGL-4198)', () => {
  it('recovers the card, the payout and Stripe Tax: 3.15% + 55¢, plus 0.5% under Stripe Tax', () => {
    expect(CARD_PROCESSING_PERCENT).toBe(2.9)
    expect(SALE_PROCESSING_PERCENT).toBe(3.15)
    expect(SALE_PROCESSING_FIXED_CENTS).toBe(55)
    expect(IN_PERSON_PROCESSING_PERCENT).toBe(2.95)
    expect(IN_PERSON_PROCESSING_FIXED_CENTS).toBe(40)
    expect(SALE_PROCESSING_PERCENT).toBeLessThan(BNPL_PROCESSING_PERCENT)
    // $4,000 of goods on Pro: physical 0.5% take, service 3%.
    const pro = orgOn('pro')
    expect(resolveTransactionFeeCents(pro, 'physical', 400_000)).toBe(2_000 + 12_600 + 55)
    expect(resolveTransactionFeeCents(pro, 'service', 400_000)).toBe(12_000 + 12_600 + 55)
    expect(resolveTransactionFeeCents(pro, 'physical', 400_000, 400_000, { stripeTax: true })).toBe(
      2_000 + 14_600 + 55,
    )
    expect(resolveTransactionFeeCents(pro, 'physical', 400_000, 400_000, { inPerson: true })).toBe(
      2_000 + 11_800 + 40,
    )
  })

  it('nets zero or more on every plan, a 0% take included, at $1 and up, online, under Stripe Tax and in person', () => {
    for (const plan of Object.keys(PLAN_ENTITLEMENTS) as OrgPlan[]) {
      for (const type of ['physical', 'digital', 'service'] as const) {
        for (const cents of [100, 999, 5_000, 50_000, 400_000, 2_500_000]) {
          for (const options of [{}, { stripeTax: true }, { inPerson: true }]) {
            const fee = resolveTransactionFeeCents(orgOn(plan), type, cents, cents, options)
            expect({ plan, type, cents, options, net: fee - platformCostCents(cents, options) >= 0 }).toEqual({
              plan,
              type,
              cents,
              options,
              net: true,
            })
          }
        }
      }
    }
  })
})
