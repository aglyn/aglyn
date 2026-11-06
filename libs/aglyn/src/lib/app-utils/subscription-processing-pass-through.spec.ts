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
  SALE_PROCESSING_FIXED_CENTS,
  SALE_PROCESSING_PERCENT,
  resolveSubscriptionFeePercent,
  resolveTransactionFeePct,
  saleProcessingCostCents,
  saleProcessingPassThroughPercent,
} from './plan-entitlements'

/**
 * A STOREFRONT SUBSCRIPTION CARRIES THE CARD COST TOO (AGL-2655).
 *
 * AGL-2152 made every one-time storefront charge recover Stripe's processing
 * cost inside `application_fee_amount`, and left subscriptions alone because a
 * Stripe Subscription accepts only `application_fee_percent`, which cannot
 * carry a fixed 30¢ as cents. This file is the arithmetic that folds the 30¢
 * into the rate instead — `(rate × amount + fixed) ÷ amount`, rounded UP to the
 * two decimals the parameter allows — and the invariant it has to hold: the
 * percent applied to the recurring goods recovers the cost, never short, and
 * never more than the rounding to a hundredth of a percent can explain.
 *
 * The boundary proof — that the figure reaches
 * `subscription_data[application_fee_percent]` on the session the handler
 * posts — lives beside the handler in
 * `checkout-subscription-fee-pass-through.spec.ts`.
 */

function org(plan: OrgPlan): Partial<AglynOrgBilling> {
  return { plan, subscriptionStatus: 'active' } as Partial<AglynOrgBilling>
}

/** From the 50¢ minimum up past the size where the fixed 30¢ stops mattering. */
const RECURRING_CENTS = [
  50, 99, 100, 250, 500, 999, 1000, 2500, 4299, 5000, 9000, 10000, 25000,
  100000,
]

/** What the percent takes of the goods, as Stripe rounds a fee. */
function recoveredCents(amountCents: number, percent: number): number {
  return Math.round((amountCents * percent) / 100)
}

describe('subscription processing pass-through (AGL-2655)', () => {
  /**
   * THE THREE FIGURES. At the card rate plus Connect's payout, 3.15% + 55¢
   * (AGL-4198; 6% + 30¢ before): $10 carries 3.15 + 5.5 = 8.65%, $25 carries
   * 3.15 + 2.2 = 5.35%, $100 carries 3.15 + 0.55 = 3.7%. Pinned as
   * literals so a drift in the constants is a red here, not a quiet re-price
   * of every recurring membership.
   */
  it('folds the fixed 30¢ into the rate for a $10, $25 and $100 price', () => {
    expect(SALE_PROCESSING_PERCENT).toBe(3.15)
    expect(SALE_PROCESSING_FIXED_CENTS).toBe(55)
    expect(saleProcessingPassThroughPercent(1000)).toBe(8.65)
    expect(saleProcessingPassThroughPercent(2500)).toBe(5.35)
    expect(saleProcessingPassThroughPercent(10000)).toBe(3.7)
    // Stripe Tax's 0.5% rides on top where the session runs it.
    expect(saleProcessingPassThroughPercent(10000, { stripeTax: true })).toBe(4.2)
  })

  it('rounds up to the next hundredth, never to nearest', () => {
    // $90: 3.15 + 0.55 ÷ 90 = 3.7611…, which nearest would make 3.76 and leave
    // the recovery short every cycle.
    expect(saleProcessingPassThroughPercent(9000)).toBe(3.77)
    // $70: 3.15 + 0.7857… = 3.9357…, up to 3.94.
    expect(saleProcessingPassThroughPercent(7000)).toBe(3.94)
  })

  it('never carries a third decimal, which Stripe rejects', () => {
    for (const amount of RECURRING_CENTS) {
      const percent = saleProcessingPassThroughPercent(amount)
      expect(String(percent)).toMatch(/^\d+(\.\d{1,2})?$/)
    }
  })

  /**
   * THE INVARIANT. Applied to the goods, the percent recovers at least the
   * cost the one-time helper would have charged in cents — and the two can
   * only differ by what rounding a rate up to a hundredth of a percent is
   * worth on that amount, plus the cent each side rounds.
   */
  it('recovers the card cost at every recurring size, and never much more', () => {
    // From $1 up: below that the percent hits Stripe's 100% ceiling.
    for (const amount of RECURRING_CENTS.filter((cents) => cents >= 100)) {
      const percent = saleProcessingPassThroughPercent(amount)
      const recovered = recoveredCents(amount, percent)
      const cost = saleProcessingCostCents(amount)
      expect(recovered).toBeGreaterThanOrEqual(cost - 1)
      expect(recovered - cost).toBeLessThanOrEqual(amount * 0.0001 + 1)
    }
  })

  it('answers zero for a charge that is not a charge', () => {
    expect(saleProcessingPassThroughPercent(0)).toBe(0)
    expect(saleProcessingPassThroughPercent(-500)).toBe(0)
    expect(saleProcessingPassThroughPercent(Number.NaN)).toBe(0)
    expect(resolveSubscriptionFeePercent(org('business'), 'digital', 0)).toBe(0)
  })

  it('caps at 100, the ceiling Stripe puts on the parameter', () => {
    // A 1¢ recurring price would need 5,503.15%. Stripe would reject that; the
    // cap is the recurring twin of clamping a one-time fee to the charge.
    expect(saleProcessingPassThroughPercent(1)).toBe(100)
    expect(resolveSubscriptionFeePercent(org('starter'), 'digital', 1)).toBe(100)
  })

  /**
   * THE RULE MIRRORED FROM AGL-2152: every tier carries the pass-through, on
   * top of whatever take it advertises. A 0% tier's percent IS the
   * pass-through; a fee tier's is take + pass-through, and the take is still
   * really collected on top of the cost.
   */
  it('a 0% tier carries exactly the pass-through', () => {
    for (const plan of ['advanced', 'agency', 'enterprise'] as OrgPlan[]) {
      expect(resolveTransactionFeePct(org(plan), 'digital')).toBe(0)
      for (const amount of [1000, 2500, 10000]) {
        expect(resolveSubscriptionFeePercent(org(plan), 'digital', amount)).toBe(
          saleProcessingPassThroughPercent(amount),
        )
      }
    }
  })

  it('a fee tier carries its take plus the pass-through, to two decimals', () => {
    // Business digital is 2%: $100 → 2 + 3.7 = 5.7; $90 → 2 + 3.77 = 5.77.
    expect(resolveSubscriptionFeePercent(org('business'), 'digital', 10000)).toBe(5.7)
    expect(resolveSubscriptionFeePercent(org('business'), 'digital', 9000)).toBe(5.77)
    // Starter digital is 5%: $10 → 5 + 8.65 = 13.65.
    expect(resolveSubscriptionFeePercent(org('starter'), 'digital', 1000)).toBe(13.65)
    for (const plan of ['starter', 'business', 'scale'] as OrgPlan[]) {
      const take = resolveTransactionFeePct(org(plan), 'digital')
      expect(take).toBeGreaterThan(0)
      // From $1 up: below that the percent hits Stripe's 100% ceiling.
      for (const amount of RECURRING_CENTS.filter((cents) => cents >= 100)) {
        const percent = resolveSubscriptionFeePercent(org(plan), 'digital', amount)
        expect(String(percent)).toMatch(/^\d+(\.\d{1,2})?$/)
        const net = recoveredCents(amount, percent) - saleProcessingCostCents(amount)
        expect(net).toBeGreaterThanOrEqual(recoveredCents(amount, take) - 1)
      }
    }
  })

  /**
   * THE NEGATIVE CONTROL, and why this file can fail: the percent the
   * subscription path used to send — the plan's take and nothing else — was
   * a loss on every 0% tier at every size, and short on every fee tier below
   * the size where the take clears the 30¢.
   */
  it('the bare take would have been a loss on a 0% tier at every size', () => {
    for (const amount of RECURRING_CENTS) {
      const takeOnly = recoveredCents(amount, resolveTransactionFeePct(org('advanced'), 'digital'))
      expect(takeOnly - saleProcessingCostCents(amount)).toBeLessThan(0)
    }
  })
})
