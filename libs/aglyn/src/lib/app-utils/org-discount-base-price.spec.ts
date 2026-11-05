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
 * Staff net MRR takes a base-price coupon off the base price only (AGL-4161).
 *
 * A coupon limited to a plan's base price (AGL-4159) leaves add-ons and usage
 * billing in full, so what the workspace is billed each month is its add-ons.
 * Net MRR applied the mirrored percentage to the WHOLE list price and read
 * $0 for an org on a 100% base-price coupon that still pays for Site Care and
 * seats. The mirror now records what the coupon reaches, and every net
 * reader (`orgMonthlyRevenueUsd`, behind the staff overview, the revenue
 * report and margin utilization; `checkDiscountMargin`; the full-use
 * verdict) takes it off the base plan line alone. A mirror written before
 * the field reads as a whole-subscription discount, which it was.
 */

import type { AglynOrgBilling } from '../foundation'
import { orgDiscountFullUse } from './full-use-cost'
import {
  checkDiscountMargin,
  discountReachMonthlyUsd,
  orgBasePriceMonthlyUsd,
  orgListPriceMonthlyUsd,
  orgMonthlyRevenueUsd,
  PLAN_PRICING,
} from './plan-entitlements'

/** Starter, billed monthly, with Site Care and two extra manager seats. */
const org = (
  discount: Record<string, unknown> | undefined,
  over: Partial<AglynOrgBilling> = {},
): Partial<AglynOrgBilling> =>
  ({
    plan: 'starter',
    subscription: { status: 'active', interval: 'month' },
    seatAddons: { siteCare: 1, managers: 2 },
    ...(discount ? { discount } : {}),
    ...over,
  }) as never

const BASE = PLAN_PRICING.starter.basePriceMonthlyUsd
const LIST = orgListPriceMonthlyUsd(org(undefined))
const ADDONS = Math.round((LIST - BASE) * 100) / 100

describe('net MRR with a base-price coupon (AGL-4161)', () => {
  it('has add-ons to leave alone, or the case proves nothing', () => {
    expect(BASE).toBeGreaterThan(0)
    expect(ADDONS).toBeGreaterThan(0)
    expect(orgBasePriceMonthlyUsd(org(undefined))).toBe(BASE)
  })

  it('takes a 100% base-price coupon off the base line only: the add-ons are the MRR', () => {
    const free = org({ couponId: 'c', percentOff: 100, basePriceOnly: true, appliesToPlans: ['starter'] })
    expect(orgMonthlyRevenueUsd(free)).toBe(ADDONS)
  })

  it('takes a partial base-price coupon off the base line only', () => {
    const half = org({ couponId: 'c', percentOff: 50, basePriceOnly: true })
    expect(orgMonthlyRevenueUsd(half)).toBe(Math.round((LIST - BASE / 2) * 100) / 100)
  })

  it('takes a base-price amount off no more than the base line', () => {
    const amount = org({ couponId: 'c', amountOffUsd: 10_000, basePriceOnly: true })
    expect(orgMonthlyRevenueUsd(amount)).toBe(ADDONS)
  })

  it('takes nothing off when the coupon is for another plan’s base price', () => {
    const elsewhere = org({ couponId: 'c', percentOff: 100, basePriceOnly: true, appliesToPlans: ['pro'] })
    expect(discountReachMonthlyUsd(elsewhere, elsewhere.discount)).toBe(0)
    expect(orgMonthlyRevenueUsd(elsewhere)).toBe(LIST)
  })

  it('uses the annual base line on annual billing', () => {
    const annual = org(
      { couponId: 'c', percentOff: 100, basePriceOnly: true },
      { subscription: { status: 'active', interval: 'year' } as never },
    )
    const annualList = orgListPriceMonthlyUsd(annual)
    expect(orgMonthlyRevenueUsd(annual)).toBe(
      Math.round((annualList - PLAN_PRICING.starter.basePriceAnnualMonthlyUsd) * 100) / 100,
    )
  })
})

describe('a whole-subscription coupon is unchanged', () => {
  it('takes its percentage off everything, as before', () => {
    expect(orgMonthlyRevenueUsd(org({ couponId: 'c', percentOff: 100, basePriceOnly: false }))).toBe(0)
    expect(orgMonthlyRevenueUsd(org({ couponId: 'c', percentOff: 40 }))).toBe(
      Math.round(LIST * 0.6 * 100) / 100,
    )
  })

  it('reads an old mirror without the field as whole-subscription', () => {
    // Every `org.discount` written before AGL-4161 looks like this.
    const legacy = org({ couponId: 'c', percentOff: 100, appliedBy: 'system' })
    expect(discountReachMonthlyUsd(legacy, legacy.discount)).toBe(LIST)
    expect(orgMonthlyRevenueUsd(legacy)).toBe(0)
  })
})

describe('the proposed-coupon readers take the same line', () => {
  it('rates a base-price coupon’s depth against the base line it reaches', () => {
    const rating = checkDiscountMargin(org(undefined), { percentOff: 100, basePriceOnly: true })
    expect(rating.discountedUsd).toBe(ADDONS)
    expect(rating.depthPct).toBeCloseTo(BASE / LIST, 3)
    // The whole-subscription reading, for contrast.
    expect(checkDiscountMargin(org(undefined), { percentOff: 100 }).discountedUsd).toBe(0)
  })

  it('judges full-use cost with the add-ons billing in full', () => {
    const verdict = orgDiscountFullUse(
      org(undefined) as never,
      { percentOff: 100, basePriceOnly: true },
      { duration: 'forever' },
    )
    expect(verdict.listUsd).toBe(LIST)
    expect(verdict.discountedUsd).toBe(ADDONS)
    const whole = orgDiscountFullUse(org(undefined) as never, { percentOff: 100 }, { duration: 'forever' })
    expect(whole.discountedUsd).toBe(0)
  })
})
