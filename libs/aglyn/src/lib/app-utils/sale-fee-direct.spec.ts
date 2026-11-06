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
})
