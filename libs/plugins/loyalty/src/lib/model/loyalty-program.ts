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
 * A store's loyalty program (AGL-3640): how customers earn points, what the
 * points are worth, and the referral offer. Pure and framework-free, so the
 * console's card, the server and the specs read one answer.
 *
 * Every rate is a whole number and every amount integer cents, bounded so a
 * typo cannot give a store away: at most 100 points per dollar earned, and a
 * point is never worth more than ten cents.
 */

export interface LoyaltyProgram {
  /** Whether customers earn and spend at all. Off until the merchant turns it on. */
  enabled: boolean
  /** Points per whole dollar of goods a customer pays for. */
  earnPointsPerDollar: number
  /** Points that make one dollar off. */
  pointsPerDollar: number
  /** The fewest points a member must hold before any can be spent. */
  minRedeemPoints: number
  /** Points a new member gets with their first order. */
  welcomePoints: number
  /** Whether members get a referral code to share. */
  referralsEnabled: boolean
  /** Store credit a member earns when a friend's first order is paid, cents. */
  referrerRewardCents: number
  /** What a friend's first order takes off, cents. */
  refereeRewardCents: number
  /** The smallest first order a friend's credit applies to, cents. */
  refereeMinimumCents: number
  /** Whether members are emailed what they earned and were given. */
  emails: boolean
}

export const LOYALTY_PROGRAM_DEFAULTS: LoyaltyProgram = {
  enabled: false,
  earnPointsPerDollar: 5,
  pointsPerDollar: 100,
  minRedeemPoints: 100,
  welcomePoints: 0,
  referralsEnabled: false,
  referrerRewardCents: 1000,
  refereeRewardCents: 1000,
  refereeMinimumCents: 0,
  emails: true,
}

/** The bounds each number is held to: `[min, max]`. */
export const LOYALTY_PROGRAM_BOUNDS = {
  earnPointsPerDollar: [1, 100],
  pointsPerDollar: [10, 10_000],
  minRedeemPoints: [0, 100_000],
  welcomePoints: [0, 100_000],
  referrerRewardCents: [0, 100_000],
  refereeRewardCents: [0, 100_000],
  refereeMinimumCents: [0, 10_000_000],
} as const satisfies Record<string, readonly [number, number]>

type NumberField = keyof typeof LOYALTY_PROGRAM_BOUNDS

const NUMBER_FIELDS = Object.keys(LOYALTY_PROGRAM_BOUNDS) as NumberField[]

function whole(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) ? Math.round(number) : null
}

/**
 * A stored or untrusted program as one the server can run: every field
 * present, every number whole and inside its bounds. Anything unreadable
 * falls back to the default rather than to zero.
 */
export function normalizeLoyaltyProgram(raw: unknown): LoyaltyProgram {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const program: LoyaltyProgram = { ...LOYALTY_PROGRAM_DEFAULTS }
  program.enabled = source['enabled'] === true
  program.referralsEnabled = source['referralsEnabled'] === true
  program.emails = source['emails'] !== false
  for (const field of NUMBER_FIELDS) {
    const [min, max] = LOYALTY_PROGRAM_BOUNDS[field]
    const value = whole(source[field])
    program[field] = value === null ? LOYALTY_PROGRAM_DEFAULTS[field] : Math.min(max, Math.max(min, value))
  }
  return program
}

const FIELD_WORDS: Record<NumberField, string> = {
  earnPointsPerDollar: 'Points per dollar spent',
  pointsPerDollar: 'Points for $1 off',
  minRedeemPoints: 'Points needed to redeem',
  welcomePoints: 'Welcome points',
  referrerRewardCents: 'The member’s referral reward',
  refereeRewardCents: 'The friend’s first-order credit',
  refereeMinimumCents: 'The friend’s minimum order',
}

/**
 * Why a change cannot be saved, in words for the card, or `null`. A number
 * outside its bounds is refused rather than clamped: the merchant should see
 * that 500 points per dollar was not kept.
 */
export function loyaltyProgramProblem(change: unknown): string | null {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return 'Nothing to save.'
  const source = change as Record<string, unknown>
  for (const field of NUMBER_FIELDS) {
    if (!(field in source)) continue
    const value = whole(source[field])
    const [min, max] = LOYALTY_PROGRAM_BOUNDS[field]
    if (value === null || value !== Number(source[field])) return `${FIELD_WORDS[field]} must be a whole number.`
    if (value < min || value > max) {
      const money = field.endsWith('Cents')
      const show = (n: number) => (money ? `$${(n / 100).toFixed(2)}` : n.toLocaleString('en-US'))
      return `${FIELD_WORDS[field]} must be between ${show(min)} and ${show(max)}.`
    }
  }
  for (const flag of ['enabled', 'referralsEnabled', 'emails'] as const) {
    if (flag in source && typeof source[flag] !== 'boolean') return 'Switches must be on or off.'
  }
  return null
}

/** The program with a checked change applied: only the fields the change names. */
export function applyLoyaltyProgramChange(current: LoyaltyProgram, change: Record<string, unknown>): LoyaltyProgram {
  const next: Record<string, unknown> = { ...current }
  for (const key of Object.keys(LOYALTY_PROGRAM_DEFAULTS)) {
    if (key in change) next[key] = change[key]
  }
  return normalizeLoyaltyProgram(next)
}

/** What a member gets back on each dollar, as a percentage with one decimal: `5`, `2.5`. */
export function loyaltyRewardRatePct(program: Pick<LoyaltyProgram, 'earnPointsPerDollar' | 'pointsPerDollar'>): number {
  return Math.round((program.earnPointsPerDollar / program.pointsPerDollar) * 1000) / 10
}
