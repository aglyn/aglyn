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
 * The guards that let API access open on Starter (AGL-4226).
 *
 * Starter is the cheapest paid door, so before it carried the API three
 * things had to be true, each asserted here against the catalog rather than
 * against copied numbers — the rate and the ceiling are each written in one
 * place, and every figure below is read from there:
 *
 *  1. a workspace-wide per-minute limit, tiered by plan, so minting keys no
 *     longer multiplies what one subscription can cost;
 *  2. a hard monthly ceiling on Starter, so its overage between invoices is
 *     bounded;
 *  3. a Starter workspace whose overage could never be collected stops at
 *     its included band — and Pro and up are NOT changed by that here.
 */

import {
  API_BILLING_UNIT_BYTES,
  apiRequestBillingUnits,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  UNLIMITED,
  apiMonthlyRefusalMessage,
  apiOverageRateUsd,
  apiRequestEnforcementShape,
  apiWorkspaceRateLimitPerMinute,
  checkApiRequestQuota,
  checkEntitlement,
  cheapestPlanWithoutApiCeiling,
} from './plan-entitlements'
import type { OrgPlan } from '../foundation'

const STARTER_RATE = PLAN_PRICING.starter.extraApiRequestsUsdPer1k as number
const STARTER_BAND = PLAN_ENTITLEMENTS.starter.apiRequestsPerMonth as number
const STARTER_CEILING = PLAN_ENTITLEMENTS.starter.maxApiRequestsPerMonth as number

/** A Starter workspace paying through a live subscription. */
const paying = (extra: Record<string, unknown> = {}) =>
  ({ plan: 'starter', billingStatus: 'active', ...extra }) as never

describe('1 · the workspace rate limit is an entitlement, tiered by plan', () => {
  const LADDER: OrgPlan[] = ['free', 'starter', 'pro', 'business', 'scale', 'advanced', 'agency', 'enterprise']

  it('is 120 on Starter (one key), 600 on Pro, and unlimited on Custom', () => {
    expect(PLAN_ENTITLEMENTS.starter.apiRequestsPerMinutePerOrg).toBe(120)
    expect(PLAN_ENTITLEMENTS.pro.apiRequestsPerMinutePerOrg).toBe(600)
    expect(PLAN_ENTITLEMENTS.enterprise.apiRequestsPerMinutePerOrg).toBe(UNLIMITED)
  })

  it('never falls as the tier rises, and every tier above Pro is at least Pro', () => {
    const values = LADDER.map((plan) => PLAN_ENTITLEMENTS[plan].apiRequestsPerMinutePerOrg as number)
    for (let i = 1; i < values.length; i += 1) {
      expect(`${LADDER[i]}: ${values[i] >= values[i - 1]}`).toBe(`${LADDER[i]}: true`)
    }
    for (const plan of LADDER.slice(LADDER.indexOf('pro'))) {
      expect(PLAN_ENTITLEMENTS[plan].apiRequestsPerMinutePerOrg).toBeGreaterThanOrEqual(600)
    }
  })

  it('is an upgrade reason: Pro has five times Starter', () => {
    expect(apiWorkspaceRateLimitPerMinute(paying())).toBe(120)
    expect(apiWorkspaceRateLimitPerMinute({ plan: 'pro', billingStatus: 'active' } as never)).toBe(600)
  })

  it('a contracted figure decides it, on Custom too', () => {
    expect(
      apiWorkspaceRateLimitPerMinute({
        plan: 'enterprise',
        billingStatus: 'active',
        entitlements: { apiRequestsPerMinutePerOrg: 3_000 },
      } as never),
    ).toBe(3_000)
    expect(apiWorkspaceRateLimitPerMinute({ plan: 'enterprise', billingStatus: 'active' } as never)).toBe(
      UNLIMITED,
    )
  })
})

describe('2 · Starter has a hard monthly ceiling; Pro and up have none', () => {
  it('is written once, on the Starter row, and Pro and above are uncapped', () => {
    expect(STARTER_CEILING).toBe(20_000)
    for (const plan of ['pro', 'business', 'scale', 'advanced', 'agency', 'enterprise'] as OrgPlan[]) {
      expect(`${plan}: ${PLAN_ENTITLEMENTS[plan].maxApiRequestsPerMonth}`).toBe(`${plan}: ${UNLIMITED}`)
    }
    expect(cheapestPlanWithoutApiCeiling()).toBe('pro')
  })

  it('meters past the band and refuses AT the ceiling', () => {
    const below = checkApiRequestQuota(paying(), STARTER_CEILING - 1)
    expect(below.allowed).toBe(true)
    expect(below.refusedBy).toBeNull()
    const at = checkApiRequestQuota(paying(), STARTER_CEILING)
    expect(at.allowed).toBe(false)
    expect(at.refusedBy).toBe('ceiling')
    expect(at.ceiling).toBe(STARTER_CEILING)
  })

  it('bounds Starter API overage at $58.50 a month at $3.00 — derived, not copied', () => {
    const most = checkApiRequestQuota(paying(), STARTER_CEILING)
    expect(most.overageMonthlyUsd).toBeCloseTo(((STARTER_CEILING - STARTER_BAND) / 1000) * STARTER_RATE, 2)
    // The figure the owner set, while the rate and ceiling are what they are.
    if (STARTER_RATE === 3 && STARTER_CEILING === 20_000) expect(most.overageMonthlyUsd).toBe(58.5)
  })

  it('makes Starter MEASURED and leaves Pro never-blocks (no extra read on Pro)', () => {
    expect(apiRequestEnforcementShape(paying())).toBe('measure')
    expect(apiRequestEnforcementShape({ plan: 'pro', billingStatus: 'active' } as never)).toBe('never-blocks')
    expect(checkApiRequestQuota({ plan: 'pro', billingStatus: 'active' } as never, 10_000_000).allowed).toBe(true)
  })

  it('a band raised by override above the ceiling raises the ceiling with it', () => {
    const raised = checkApiRequestQuota(paying({ entitlements: { apiRequestsPerMonth: 80_000 } }), 60_000)
    expect(raised.ceiling).toBe(80_000)
    expect(raised.allowed).toBe(true)
  })

  it('names the limit, and the plan without one, in the refusal', () => {
    const at = checkApiRequestQuota(paying(), STARTER_CEILING)
    const message = apiMonthlyRefusalMessage(paying(), at)
    expect(message).toContain(STARTER_CEILING.toLocaleString('en-US'))
    expect(message).toContain('Starter plan')
    expect(message).toContain('Pro has no monthly ceiling')
  })
})

describe('3 · a workspace whose overage cannot be collected stops at its band (Starter first, every plan since)', () => {
  it('a paying Starter workspace is sold overage', () => {
    expect(apiOverageRateUsd(paying())).toBe(STARTER_RATE)
    expect(apiOverageRateUsd(paying({ billingStatus: 'past_due' }))).toBe(STARTER_RATE)
    expect(apiOverageRateUsd(paying({ billingStatus: 'trialing' }))).toBe(STARTER_RATE)
  })

  it('no live subscription — a Starter plan stored directly — stops at the band', () => {
    const stored = { plan: 'starter' } as never
    expect(apiOverageRateUsd(stored)).toBeNull()
    expect(checkApiRequestQuota(stored, STARTER_BAND - 1).allowed).toBe(true)
    const at = checkApiRequestQuota(stored, STARTER_BAND)
    expect(at.allowed).toBe(false)
    expect(at.refusedBy).toBe('band')
    expect(at.overageMonthlyUsd).toBe(0)
    expect(apiMonthlyRefusalMessage(stored, at)).toContain('no overage can be billed')
  })

  it('a 100% whole-bill coupon stops at the band; a base-price-only one does not', () => {
    const whole = paying({ discount: { couponId: 'c', percentOff: 100 } })
    expect(apiOverageRateUsd(whole)).toBeNull()
    expect(checkApiRequestQuota(whole, STARTER_BAND).allowed).toBe(false)
    // A partner deal (AGL-4159): the base price is free, usage bills in full.
    const basePrice = paying({ discount: { couponId: 'c', percentOff: 100, basePriceOnly: true } })
    expect(apiOverageRateUsd(basePrice)).toBe(STARTER_RATE)
    // A partial whole-bill discount still collects something past the band.
    expect(apiOverageRateUsd(paying({ discount: { couponId: 'c', percentOff: 50 } }))).toBe(STARTER_RATE)
  })

  it('a dead subscription is Free, which has no API at all', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired']) {
      const dead = paying({ billingStatus: status })
      expect(`${status}: ${checkEntitlement(dead, 'apiAccess')}`).toBe(`${status}: false`)
    }
  })

  it('a capped Starter comp stops at the band; an uncapped one keeps working', () => {
    const comp = (uncapped: boolean) =>
      ({ plan: 'free', entitlements: { planComp: { plan: 'starter', uncapped } } }) as never
    expect(checkApiRequestQuota(comp(false), STARTER_BAND).allowed).toBe(false)
    expect(apiRequestEnforcementShape(comp(true))).toBe('never-blocks')
  })

  it('applies to Pro the same way: no live subscription, or a 100% whole-bill coupon, stops at the band', () => {
    const PRO_BAND = PLAN_ENTITLEMENTS.pro.apiRequestsPerMonth as number
    const stored = { plan: 'pro' } as never
    expect(apiOverageRateUsd(stored)).toBeNull()
    expect(checkApiRequestQuota(stored, PRO_BAND).refusedBy).toBe('band')
    const free100 = { plan: 'pro', billingStatus: 'active', discount: { couponId: 'c', percentOff: 100 } } as never
    expect(apiOverageRateUsd(free100)).toBeNull()
    expect(checkApiRequestQuota(free100, PRO_BAND).allowed).toBe(false)
    // A paying Pro workspace, and a base-price-only partner coupon, still meter with no ceiling.
    expect(checkApiRequestQuota({ plan: 'pro', billingStatus: 'active' } as never, 10_000_000).allowed).toBe(true)
    expect(
      apiOverageRateUsd({
        plan: 'pro',
        billingStatus: 'active',
        discount: { couponId: 'c', percentOff: 100, basePriceOnly: true },
      } as never),
    ).toBe(PLAN_PRICING.pro.extraApiRequestsUsdPer1k)
  })

  it('Custom stops at its contracted band, and an uncapped comp of it keeps working', () => {
    const custom = { plan: 'enterprise', billingStatus: 'active' } as never
    expect(apiOverageRateUsd(custom)).toBeNull()
    const band = PLAN_ENTITLEMENTS.enterprise.apiRequestsPerMonth as number
    expect(checkApiRequestQuota(custom, band).allowed).toBe(false)
    const uncapped = { plan: 'free', entitlements: { planComp: { plan: 'enterprise', uncapped: true } } } as never
    expect(apiRequestEnforcementShape(uncapped)).toBe('never-blocks')
    const uncappedPro = { plan: 'free', entitlements: { planComp: { plan: 'pro', uncapped: true } } } as never
    expect(checkApiRequestQuota(uncappedPro, 50_000_000).allowed).toBe(true)
  })
})

describe('AGL-4227 · one billed unit per started 256 KB', () => {
  it('is 256 KiB, and a call is never less than one unit', () => {
    expect(API_BILLING_UNIT_BYTES).toBe(262_144)
    expect(apiRequestBillingUnits(0, 0)).toBe(1)
    expect(apiRequestBillingUnits(Number.NaN, -5)).toBe(1)
  })

  it('weighs the LARGER of request and response, per started unit', () => {
    // A default page (~77 KB) and a page of 100 records (~302 KB).
    expect(apiRequestBillingUnits(2_048, 77 * 1024)).toBe(1)
    expect(apiRequestBillingUnits(2_048, 302 * 1024)).toBe(2)
    expect(apiRequestBillingUnits(API_BILLING_UNIT_BYTES, 0)).toBe(1)
    expect(apiRequestBillingUnits(API_BILLING_UNIT_BYTES + 1, 0)).toBe(2)
    // A body at Vercel's 4.5 MB limit: 18 units.
    expect(apiRequestBillingUnits(4_500_000, 1_000)).toBe(18)
  })
})
