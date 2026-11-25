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
 * A DIRECT charge's application fee is the plan's take and nothing else:
 * Stripe bills the seller its own card fee and charges the platform nothing
 * for the sale, so there is no pass-through and no break-even floor.
 */

import {
  resolveSubscriptionFeePercent,
  resolveTransactionFeeCents,
  saleApplicationFeeCents,
  salePlatformCostCents,
} from './plan-entitlements'

describe('direct-charge sale fees', () => {
  it('is the take alone, clamped to the charge', () => {
    expect(saleApplicationFeeCents(50, 10_000, { direct: true })).toBe(50)
    expect(saleApplicationFeeCents(0, 10_000, { direct: true })).toBe(0)
    expect(saleApplicationFeeCents(900, 500, { direct: true })).toBe(500)
    // Stripe Tax is the seller's bill on a direct charge, not the platform's.
    expect(saleApplicationFeeCents(50, 10_000, { direct: true, stripeTax: true })).toBe(50)
  })

  it('stays the AGL-4198 rule for a destination charge', () => {
    // take 50 + 2.9% + 30¢ = 370, equal to the platform's whole cost.
    expect(saleApplicationFeeCents(50, 10_000)).toBe(370)
    expect(saleApplicationFeeCents(0, 10_000)).toBe(370)
  })

  it('applies to a whole-sale resolution from the org', () => {
    const org = { plan: 'pro', subscriptionStatus: 'active' } as any
    const destination = resolveTransactionFeeCents(org, 'physical', 10_000)
    const direct = resolveTransactionFeeCents(org, 'physical', 10_000, 10_000, {
      direct: true,
    })
    expect(direct).toBeLessThan(destination)
    expect(direct).toBeGreaterThanOrEqual(0)
  })

  it('makes a subscription percent the take percent alone', () => {
    const org = { plan: 'pro', subscriptionStatus: 'active' } as any
    const destination = resolveSubscriptionFeePercent(org, 'service', 1_000)
    const direct = resolveSubscriptionFeePercent(org, 'service', 1_000, { direct: true })
    expect(direct).toBeLessThan(destination)
    expect(Number.isInteger(direct * 100)).toBe(true)
  })

  /**
   * The ladder of 2026-11-24 (AGL-4245) on the store's own account: Starter
   * 1% physical / 3% services and digital, Pro 0% / 1%, Custom 0%. A 0% take
   * sends no fee at all (`directChargeParams` omits the key, and a renewal
   * unsets `application_fee_percent`), so the answer here must be exactly 0.
   */
  it('charges the new ladder on a direct sale, and nothing at 0%', () => {
    const on = (plan: string) => ({ plan, subscriptionStatus: 'active' }) as any
    const direct = { direct: true }
    expect(resolveTransactionFeeCents(on('starter'), 'physical', 10_000, 10_000, direct)).toBe(100)
    expect(resolveTransactionFeeCents(on('starter'), 'digital', 10_000, 10_000, direct)).toBe(300)
    expect(resolveTransactionFeeCents(on('starter'), 'service', 10_000, 10_000, direct)).toBe(300)
    expect(resolveTransactionFeeCents(on('pro'), 'physical', 10_000, 10_000, direct)).toBe(0)
    expect(resolveTransactionFeeCents(on('pro'), 'digital', 10_000, 10_000, direct)).toBe(100)
    expect(resolveTransactionFeeCents(on('pro'), 'service', 10_000, 10_000, direct)).toBe(100)
    expect(resolveTransactionFeeCents(on('enterprise'), 'physical', 10_000, 10_000, direct)).toBe(0)
    expect(resolveTransactionFeeCents(on('enterprise'), 'service', 10_000, 10_000, direct)).toBe(0)
    // Subscriptions on the store's own account carry the take percent alone.
    expect(resolveSubscriptionFeePercent(on('starter'), 'digital', 1_000, direct)).toBe(3)
    expect(resolveSubscriptionFeePercent(on('starter'), 'physical', 1_000, direct)).toBe(1)
    expect(resolveSubscriptionFeePercent(on('pro'), 'digital', 1_000, direct)).toBe(1)
    expect(resolveSubscriptionFeePercent(on('pro'), 'physical', 1_000, direct)).toBe(0)
  })

  it('still recovers the platform cost at 0% on a destination sale (AGL-4245)', () => {
    const pro = { plan: 'pro', subscriptionStatus: 'active' } as any
    // $100 of physical goods on Pro: no take, so the fee is the platform's
    // cost, card 320 + payout 50.
    expect(resolveTransactionFeeCents(pro, 'physical', 10_000)).toBe(370)
    expect(resolveTransactionFeeCents(pro, 'physical', 10_000)).toBe(salePlatformCostCents(10_000))
    // A physical subscription on Pro: the percent is the platform's cost for
    // the cycle, 3.7% of $100, never 0.
    expect(resolveSubscriptionFeePercent(pro, 'physical', 10_000)).toBe(3.7)
  })
})
