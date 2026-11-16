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
 * The daily transactional ceiling's figures and its per-org override
 * (AGL-4145). The send seam and the counter are proven beside them, in
 * `@aglyn/shared-util-email` and `@aglyn/tenant-data-admin`; this proves the
 * number they are handed.
 */

import type { OrgPlan } from '../foundation'
import { PLAN_ENTITLEMENTS, UNLIMITED } from './plan-entitlements'
import {
  checkTransactionalEmailCeiling,
  resolveTransactionalEmailDailyCeiling,
  TRANSACTIONAL_EMAIL_CEILING_OVERRIDE_FIELDS,
  TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN,
  TRANSACTIONAL_EMAILS_PER_DAY_KEY,
} from './transactional-email-ceiling'

const PLANS = Object.keys(PLAN_ENTITLEMENTS) as OrgPlan[]

describe('the daily transactional ceiling per plan (AGL-4145)', () => {
  it('holds the figures the margin check set', () => {
    expect(TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN.free).toBe(200)
    expect(TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN.starter).toBe(1_000)
    expect(TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN.pro).toBe(5_000)
    expect(TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN.enterprise).toBe(UNLIMITED)
  })

  it('names every plan, and never descends up the ladder', () => {
    expect(Object.keys(TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN).sort()).toEqual([...PLANS].sort())
    const ladder = PLANS.map((plan) => TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN[plan])
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]).toBeGreaterThanOrEqual(ladder[i - 1]!)
    }
  })

  it('is NOT a plan-table key, so nothing that reads the plan table can publish it', () => {
    // `/pricing`, the plan comparison and the pricing-table generator read
    // `PLAN_ENTITLEMENTS`; an abuse ceiling is not something a plan sells.
    for (const plan of PLANS) {
      expect(PLAN_ENTITLEMENTS[plan]).not.toHaveProperty(TRANSACTIONAL_EMAILS_PER_DAY_KEY)
    }
  })

  it('resolves each plan to its figure', () => {
    for (const plan of PLANS) {
      expect(
        resolveTransactionalEmailDailyCeiling({ plan, billingStatus: 'active' } as never),
      ).toBe(TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN[plan])
    }
  })

  it('reads a canceled paid plan, or no plan at all, as Free', () => {
    expect(resolveTransactionalEmailDailyCeiling({ plan: 'pro', billingStatus: 'canceled' } as never)).toBe(200)
    expect(resolveTransactionalEmailDailyCeiling(null)).toBe(200)
    expect(resolveTransactionalEmailDailyCeiling({} as never)).toBe(200)
  })

  describe('the per-org override', () => {
    const withOverride = (value: unknown, plan: OrgPlan = 'starter') =>
      ({
        plan,
        billingStatus: 'active',
        entitlements: { [TRANSACTIONAL_EMAILS_PER_DAY_KEY]: value },
      }) as never

    it('wins over the plan, in either direction', () => {
      expect(resolveTransactionalEmailDailyCeiling(withOverride(25_000))).toBe(25_000)
      expect(resolveTransactionalEmailDailyCeiling(withOverride(50))).toBe(50)
    })

    it('keeps a deliberate 0 — a ceiling of none, never unlimited', () => {
      expect(resolveTransactionalEmailDailyCeiling(withOverride(0))).toBe(0)
    })

    it('ignores anything that is not a finite number of 0 or more', () => {
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '9000', null, true]) {
        expect(resolveTransactionalEmailDailyCeiling(withOverride(bad))).toBe(1_000)
      }
    })

    it('rides the same map the staff override dialog writes, with the plan figures as its default', () => {
      expect(TRANSACTIONAL_EMAIL_CEILING_OVERRIDE_FIELDS).toEqual([
        expect.objectContaining({
          key: TRANSACTIONAL_EMAILS_PER_DAY_KEY,
          byPlan: TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN,
        }),
      ])
    })
  })

  it('is not lifted by an uncapped plan comp, which lifts bands and this is not one', () => {
    const comped = {
      plan: 'free',
      entitlements: {
        planComp: {
          plan: 'pro',
          uncapped: true,
          reason: 'other',
          note: 'Internal workspace',
          grantedBy: 'staff-1',
          grantedAt: { seconds: 1_789_560_000, nanoseconds: 0 },
        },
      },
    }
    expect(resolveTransactionalEmailDailyCeiling(comped as never)).toBe(5_000)
  })
})

describe('checkTransactionalEmailCeiling', () => {
  it('admits the Nth message and refuses the N+1th', () => {
    expect(checkTransactionalEmailCeiling(4, 1, 5)).toEqual({
      allowed: true,
      ceiling: 5,
      used: 4,
      remaining: 0,
    })
    expect(checkTransactionalEmailCeiling(5, 1, 5)).toEqual({
      allowed: false,
      ceiling: 5,
      used: 5,
      remaining: 0,
    })
  })

  it('refuses a multi-recipient claim that would cross the ceiling, whole', () => {
    expect(checkTransactionalEmailCeiling(3, 3, 5).allowed).toBe(false)
    expect(checkTransactionalEmailCeiling(2, 3, 5).allowed).toBe(true)
  })

  it('reads a missing or corrupt count as 0, and a missing ceiling as 0 — which refuses', () => {
    expect(checkTransactionalEmailCeiling(Number.NaN, 1, 5)).toMatchObject({ allowed: true, used: 0 })
    expect(checkTransactionalEmailCeiling(-3, 1, 5)).toMatchObject({ allowed: true, used: 0 })
    expect(checkTransactionalEmailCeiling(0, 1, Number.NaN)).toMatchObject({ allowed: false, ceiling: 0 })
    expect(checkTransactionalEmailCeiling(0, 1, undefined as never).allowed).toBe(false)
  })

  it('admits everything against Infinity', () => {
    expect(checkTransactionalEmailCeiling(10_000_000, 500, UNLIMITED).allowed).toBe(true)
  })
})
