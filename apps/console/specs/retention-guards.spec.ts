/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * The winback coupon walls (AGL-1863, encoding the AGL-1620 lesson).
 *
 * The failure these tests make impossible to reintroduce quietly: a
 * 100%-off-forever coupon minted by the retention flow — a free account
 * nobody ever looks at again. Every wall is asserted from BOTH sides: the
 * shape the funnel actually mints passes, and each unbounded variant throws.
 */

export {}

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  // The REAL ladder — a hand-copied list here would let the downsell answer
  // drift from the tiers the product sells.
  SELF_SERVE_PLANS: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
    .SELF_SERVE_PLANS,
}))

import {
  assertBoundedWinbackCoupon,
  downsellTargetPlan,
  WINBACK_DURATION_MONTHS,
  WINBACK_MAX_DURATION_MONTHS,
  WINBACK_MAX_PERCENT_OFF,
  WINBACK_PERCENT_OFF,
} from '../app/api/_lib/retention'

describe('assertBoundedWinbackCoupon (AGL-1863 / AGL-1620)', () => {
  it('accepts the shape the funnel actually mints', () => {
    expect(() =>
      assertBoundedWinbackCoupon({
        percentOff: WINBACK_PERCENT_OFF,
        duration: 'repeating',
        durationInMonths: WINBACK_DURATION_MONTHS,
      }),
    ).not.toThrow()
  })

  it('accepts a once-off discount', () => {
    expect(() =>
      assertBoundedWinbackCoupon({ percentOff: 25, duration: 'once' }),
    ).not.toThrow()
  })

  it('refuses `forever`, whatever the percent', () => {
    expect(() =>
      assertBoundedWinbackCoupon({ percentOff: 5, duration: 'forever' }),
    ).toThrow(/forever/)
  })

  it('refuses the 100%-off-forever coupon on BOTH axes', () => {
    // The exact artifact AGL-1620 exists to never see again.
    expect(() =>
      assertBoundedWinbackCoupon({ percentOff: 100, duration: 'forever' }),
    ).toThrow()
    // And 100% off even for a single cycle is over the percent wall.
    expect(() =>
      assertBoundedWinbackCoupon({ percentOff: 100, duration: 'once' }),
    ).toThrow(/capped/)
  })

  it('refuses a percent over the cap', () => {
    expect(() =>
      assertBoundedWinbackCoupon({
        percentOff: WINBACK_MAX_PERCENT_OFF + 1,
        duration: 'once',
      }),
    ).toThrow(/capped/)
  })

  it('refuses repeating without a stated month count', () => {
    expect(() =>
      assertBoundedWinbackCoupon({ percentOff: 50, duration: 'repeating' }),
    ).toThrow(/whole months/)
  })

  it('refuses repeating past the month wall', () => {
    expect(() =>
      assertBoundedWinbackCoupon({
        percentOff: 50,
        duration: 'repeating',
        durationInMonths: WINBACK_MAX_DURATION_MONTHS + 1,
      }),
    ).toThrow(/whole months/)
  })

  it('refuses fractional months — 1.5 months is not a Stripe duration', () => {
    expect(() =>
      assertBoundedWinbackCoupon({
        percentOff: 50,
        duration: 'repeating',
        durationInMonths: 1.5,
      }),
    ).toThrow(/whole months/)
  })

  it('refuses a coupon that discounts nothing', () => {
    expect(() =>
      assertBoundedWinbackCoupon({ duration: 'once' }),
    ).toThrow(/discount something/)
    expect(() =>
      assertBoundedWinbackCoupon({ percentOff: 0, duration: 'once' }),
    ).toThrow(/discount something/)
  })

  it('refuses an unknown duration word outright', () => {
    expect(() =>
      assertBoundedWinbackCoupon({ percentOff: 10, duration: 'monthly' }),
    ).toThrow(/once.*repeating/)
  })

  it('PIN — the constants the funnel mints stay inside their own walls', () => {
    // If someone raises WINBACK_PERCENT_OFF past the cap, every live request
    // starts throwing; this catches it at test time instead.
    expect(WINBACK_PERCENT_OFF).toBeLessThanOrEqual(WINBACK_MAX_PERCENT_OFF)
    expect(WINBACK_DURATION_MONTHS).toBeLessThanOrEqual(
      WINBACK_MAX_DURATION_MONTHS,
    )
    expect(WINBACK_DURATION_MONTHS).toBeGreaterThanOrEqual(1)
  })
})

describe('downsellTargetPlan (AGL-1863)', () => {
  it('offers the next PAID tier down', () => {
    expect(downsellTargetPlan('pro')).toBe('starter')
    expect(downsellTargetPlan('business')).toBe('pro')
    expect(downsellTargetPlan('agency')).toBe('advanced')
  })

  it('never offers free — below starter there is no downsell', () => {
    // Free is a cancel, not a downsell; the margin constraint is structural:
    // every answer this returns is a tier whose list price covers its floor.
    expect(downsellTargetPlan('starter')).toBeNull()
    expect(downsellTargetPlan('free')).toBeNull()
  })

  it('answers null for tiers outside the ladder', () => {
    expect(downsellTargetPlan('enterprise')).toBeNull()
    expect(downsellTargetPlan(undefined)).toBeNull()
    expect(downsellTargetPlan(null)).toBeNull()
  })
})
