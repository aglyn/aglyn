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
  MARKETPLACE_PROCESSING_FIXED_CENTS,
  MARKETPLACE_PROCESSING_PERCENT_BNPL,
  MARKETPLACE_PROCESSING_PERCENT_CARD,
  PLAN_ENTITLEMENTS,
  resolveTransactionFeeCents,
  resolveTransactionFeePct,
  storefrontProcessingCostCents,
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
    Math.round((chargeCents * percent) / 100) + MARKETPLACE_PROCESSING_FIXED_CENTS
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
            fee - stripeCostCents(cents, MARKETPLACE_PROCESSING_PERCENT_BNPL)
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
        fee - stripeCostCents(cents, MARKETPLACE_PROCESSING_PERCENT_BNPL)
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
              MARKETPLACE_PROCESSING_PERCENT_CARD,
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
      stripeCostCents(cents, MARKETPLACE_PROCESSING_PERCENT_CARD)
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
      onGoods - stripeCostCents(chargeCents, MARKETPLACE_PROCESSING_PERCENT_BNPL),
    ).toBeLessThan(0)
    expect(
      onCharge - stripeCostCents(chargeCents, MARKETPLACE_PROCESSING_PERCENT_BNPL),
    ).toBeGreaterThanOrEqual(0)
  })

  /**
   * A FEE LARGER THAN THE CHARGE IS REJECTED BY STRIPE. The clamp can only
   * bind below Stripe's own 50¢ charge minimum, so it must never trim a real
   * order — asserted from 50¢ up.
   */
  it('never returns more than the charge, and never clamps a real order', () => {
    expect(resolveTransactionFeeCents(orgOn('business'), 'physical', 10, 10)).toBe(10)
    for (const cents of ORDER_SIZES_CENTS) {
      const fee = resolveTransactionFeeCents(orgOn('starter'), 'physical', cents, cents)
      expect(fee).toBeLessThanOrEqual(cents)
      expect(fee).toBe(
        Math.round((cents * PLAN_ENTITLEMENTS.starter.transactionFeePhysicalPct) / 100) +
          storefrontProcessingCostCents(cents),
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
    expect(storefrontProcessingCostCents(0)).toBe(0)
    expect(storefrontProcessingCostCents(NaN)).toBe(0)
  })

  /** Rounded UP, so the recovery is never a cent short of Stripe's debit. */
  it('rounds the percentage up rather than to nearest', () => {
    // 101¢ × 6% = 6.06¢ — a `Math.round` would answer 6 and leave a cent short.
    expect(storefrontProcessingCostCents(101)).toBe(
      Math.ceil((101 * MARKETPLACE_PROCESSING_PERCENT_BNPL) / 100) +
        MARKETPLACE_PROCESSING_FIXED_CENTS,
    )
    expect(storefrontProcessingCostCents(101)).toBeGreaterThanOrEqual(
      (101 * MARKETPLACE_PROCESSING_PERCENT_BNPL) / 100 +
        MARKETPLACE_PROCESSING_FIXED_CENTS,
    )
  })
})
