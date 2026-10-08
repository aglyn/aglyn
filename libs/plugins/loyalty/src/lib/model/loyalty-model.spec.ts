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
  canonicalLoyaltyCode,
  cumulativeTarget,
  earnedPoints,
  formatLoyaltyCode,
  formatLoyaltyCents,
  liveHolds,
  loyaltyCodeLast4,
  normalizeLoyaltyEmail,
  pointsForCents,
  pointsValueCents,
  spendableBalances,
  spendableCents,
  splitRedemption,
} from './loyalty-math'
import {
  applyLoyaltyProgramChange,
  LOYALTY_PROGRAM_DEFAULTS,
  loyaltyProgramProblem,
  loyaltyRewardRatePct,
  normalizeLoyaltyProgram,
} from './loyalty-program'

const PROGRAM = { ...LOYALTY_PROGRAM_DEFAULTS, enabled: true }

describe('the program (AGL-3640)', () => {
  it('is off, at 5% back, until the merchant says otherwise', () => {
    expect(normalizeLoyaltyProgram(undefined)).toEqual(LOYALTY_PROGRAM_DEFAULTS)
    expect(LOYALTY_PROGRAM_DEFAULTS.enabled).toBe(false)
    expect(loyaltyRewardRatePct(LOYALTY_PROGRAM_DEFAULTS)).toBe(5)
  })

  it('holds a stored program to its bounds, and falls back on nonsense rather than zero', () => {
    const program = normalizeLoyaltyProgram({
      enabled: true,
      earnPointsPerDollar: 5000,
      pointsPerDollar: 1,
      minRedeemPoints: 'lots',
      referrerRewardCents: 250.4,
      emails: false,
    })
    expect(program.enabled).toBe(true)
    expect(program.earnPointsPerDollar).toBe(100)
    expect(program.pointsPerDollar).toBe(10)
    expect(program.minRedeemPoints).toBe(LOYALTY_PROGRAM_DEFAULTS.minRedeemPoints)
    expect(program.referrerRewardCents).toBe(250)
    expect(program.emails).toBe(false)
  })

  it('refuses, in words, a change outside its bounds instead of clamping it', () => {
    expect(loyaltyProgramProblem({ earnPointsPerDollar: 500 })).toBe('Points per dollar spent must be between 1 and 100.')
    expect(loyaltyProgramProblem({ refereeRewardCents: 200_000 })).toBe(
      'The friend’s first-order credit must be between $0.00 and $1000.00.',
    )
    expect(loyaltyProgramProblem({ welcomePoints: 1.5 })).toBe('Welcome points must be a whole number.')
    expect(loyaltyProgramProblem({ enabled: 'yes' })).toBe('Switches must be on or off.')
    expect(loyaltyProgramProblem(null)).toBe('Nothing to save.')
    expect(loyaltyProgramProblem({ enabled: true, earnPointsPerDollar: 2 })).toBeNull()
  })

  it('applies only the fields a change names', () => {
    const next = applyLoyaltyProgramChange(PROGRAM, { welcomePoints: 50, unknown: 1 })
    expect(next).toEqual({ ...PROGRAM, welcomePoints: 50 })
  })
})

describe('earning and spending are whole numbers, in the member’s interest', () => {
  it('earns on whole cents of goods, floored', () => {
    expect(earnedPoints(4_999, { earnPointsPerDollar: 5 })).toBe(249)
    expect(earnedPoints(-100, { earnPointsPerDollar: 5 })).toBe(0)
    expect(earnedPoints(10_000, { earnPointsPerDollar: 1 })).toBe(100)
  })

  it('values points down and charges points up, so a point is never worth more than the rate', () => {
    expect(pointsValueCents(150, { pointsPerDollar: 100 })).toBe(150)
    expect(pointsValueCents(7, { pointsPerDollar: 300 })).toBe(2)
    expect(pointsForCents(3, { pointsPerDollar: 300 })).toBe(9)
    for (const points of [0, 1, 7, 99, 101, 12_345]) {
      expect(pointsForCents(pointsValueCents(points, { pointsPerDollar: 300 }), { pointsPerDollar: 300 })).toBeLessThanOrEqual(points)
    }
  })

  it('spends store credit first, then points, never more than asked or held', () => {
    expect(splitRedemption(800, { creditCents: 500, points: 1_000 }, PROGRAM)).toEqual({ cents: 800, creditCents: 500, points: 300 })
    expect(splitRedemption(300, { creditCents: 500, points: 1_000 }, PROGRAM)).toEqual({ cents: 300, creditCents: 300, points: 0 })
    expect(splitRedemption(5_000, { creditCents: 0, points: 250 }, PROGRAM)).toEqual({ cents: 250, creditCents: 0, points: 250 })
    expect(splitRedemption(0, { creditCents: 500, points: 1_000 }, PROGRAM)).toEqual({ cents: 0, creditCents: 0, points: 0 })
  })

  it('leaves out every live hold but this checkout’s own, and points below the minimum', () => {
    const member = {
      points: 400,
      creditCents: 1_000,
      holds: {
        other: { points: 100, creditCents: 300, expiresAtMs: 2_000 },
        mine: { points: 50, creditCents: 50, expiresAtMs: 2_000 },
        lapsed: { points: 300, creditCents: 600, expiresAtMs: 500 },
      },
    }
    expect(spendableBalances(member, PROGRAM, 1_000, 'mine')).toEqual({ points: 300, creditCents: 700 })
    expect(spendableBalances(member, { minRedeemPoints: 500 }, 1_000, 'mine')).toEqual({ points: 0, creditCents: 700 })
    expect(spendableCents({ points: 300, creditCents: 700 }, PROGRAM)).toBe(1_000)
    expect(Object.keys(liveHolds(member.holds, 1_000))).toEqual(['other', 'mine'])
  })

  it('a balance gone negative spends nothing', () => {
    expect(spendableBalances({ points: -40, creditCents: -1 }, PROGRAM, 0)).toEqual({ points: 0, creditCents: 0 })
  })
})

describe('refunds settle to a cumulative target', () => {
  it('rises with the money refunded and never past the whole', () => {
    expect(cumulativeTarget(250, { refundedCents: 2_500, paidCents: 10_000, full: false })).toBe(63)
    expect(cumulativeTarget(250, { refundedCents: 20_000, paidCents: 10_000, full: false })).toBe(250)
    expect(cumulativeTarget(250, { refundedCents: 0, paidCents: 10_000, full: true })).toBe(250)
    expect(cumulativeTarget(250, { refundedCents: 100, paidCents: 0, full: false })).toBe(0)
  })
})

describe('codes', () => {
  const bytes = Uint8Array.from({ length: 12 }, (_, index) => index * 7)

  it('mints rewards and referral codes from the unambiguous alphabet', () => {
    const rewards = formatLoyaltyCode('rewards', bytes)
    expect(rewards).toMatch(/^RW-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)
    expect(formatLoyaltyCode('referral', bytes)).toMatch(/^RF-[2-9A-HJ-NP-Z]{6}$/)
    expect(() => formatLoyaltyCode('rewards', bytes.slice(0, 3))).toThrow()
  })

  it('reads a typed code in any case and spacing, and refuses one outside the alphabet', () => {
    expect(canonicalLoyaltyCode(' rw 7k3p q9xz 2m4d ')).toEqual({ kind: 'rewards', code: 'RW-7K3P-Q9XZ-2M4D' })
    expect(canonicalLoyaltyCode('rf-7k3p9x')).toEqual({ kind: 'referral', code: 'RF-7K3P9X' })
    expect(canonicalLoyaltyCode('RW-0000-0000-0000')).toBeNull()
    expect(canonicalLoyaltyCode('GC-ABCDEF')).toBeNull()
    expect(canonicalLoyaltyCode('RW-7K3P')).toBeNull()
    expect(loyaltyCodeLast4('RW-7K3P-Q9XZ-2M4D')).toBe('2M4D')
  })

  it('keys members by a valid email only', () => {
    expect(normalizeLoyaltyEmail(' Pat@Example.COM ')).toBe('pat@example.com')
    expect(normalizeLoyaltyEmail('not an email')).toBe('')
  })

  it('formats money', () => {
    expect(formatLoyaltyCents(1_250)).toBe('$12.50')
  })
})
