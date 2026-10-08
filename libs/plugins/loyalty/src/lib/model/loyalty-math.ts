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

import type { LoyaltyProgram } from './loyalty-program'

/**
 * The arithmetic of points and store credit (AGL-3640). Pure: the server's
 * transactions and the console's figures call the same functions, and every
 * one of them is integer arithmetic on whole points and whole cents.
 *
 * ## Earning
 *
 * A member earns on the GOODS they paid for: the items, less every discount,
 * less whatever their own rewards paid at the register. Never on shipping, tax
 * or a tip, and never on the part of a sale their points already paid for —
 * points that earn points are a loop.
 *
 * ## Spending
 *
 * Store credit is spent before points: it is money the store already owes,
 * where points are a promise. Points are spent only once a member holds the
 * program's minimum, and are converted at the program's rate with the
 * member's interest rounded in: cents off are floored, points taken are
 * ceilinged, so a point is never worth more than the rate says.
 *
 * ## Giving back
 *
 * A refund reverses earned points, and returns spent ones, in proportion to
 * the money refunded — as a cumulative TARGET, never a per-event delta, so a
 * refund announced twice, or a partial refund followed by a cancellation,
 * settles at the same number however the events arrive.
 */

/** Whole non-negative integer from an untrusted figure. */
export function wholeNonNegative(value: unknown): number {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

/** Points earned on `basisCents` of goods. */
export function earnedPoints(basisCents: number, program: Pick<LoyaltyProgram, 'earnPointsPerDollar'>): number {
  return Math.floor((wholeNonNegative(basisCents) * wholeNonNegative(program.earnPointsPerDollar)) / 100)
}

/** What `points` are worth, in whole cents (floored). */
export function pointsValueCents(points: number, program: Pick<LoyaltyProgram, 'pointsPerDollar'>): number {
  const rate = wholeNonNegative(program.pointsPerDollar)
  if (!rate) return 0
  return Math.floor((wholeNonNegative(points) * 100) / rate)
}

/** The points `cents` off costs (ceilinged). */
export function pointsForCents(cents: number, program: Pick<LoyaltyProgram, 'pointsPerDollar'>): number {
  return Math.ceil((wholeNonNegative(cents) * wholeNonNegative(program.pointsPerDollar)) / 100)
}

/** A member's balances as a redemption sees them. */
export interface LoyaltyBalances {
  points: number
  creditCents: number
}

/** One live reservation of a member's balances. */
export interface LoyaltyHold {
  points: number
  creditCents: number
  expiresAtMs: number
}

/** The holds still standing at `nowMs`, less the one named `exceptId`. */
export function liveHolds(
  holds: Record<string, LoyaltyHold> | null | undefined,
  nowMs: number,
  exceptId?: string,
): Record<string, LoyaltyHold> {
  const live: Record<string, LoyaltyHold> = {}
  for (const [id, hold] of Object.entries(holds ?? {})) {
    if (id === exceptId || !hold || !(Number(hold.expiresAtMs) > nowMs)) continue
    live[id] = {
      points: wholeNonNegative(hold.points),
      creditCents: wholeNonNegative(hold.creditCents),
      expiresAtMs: Number(hold.expiresAtMs),
    }
  }
  return live
}

/** What a member may spend now: their balances less every live hold. */
export function spendableBalances(
  member: LoyaltyBalances & { holds?: Record<string, LoyaltyHold> | null },
  program: Pick<LoyaltyProgram, 'minRedeemPoints'>,
  nowMs: number,
  exceptHoldId?: string,
): LoyaltyBalances {
  const holds = Object.values(liveHolds(member.holds, nowMs, exceptHoldId))
  const heldPoints = holds.reduce((sum, hold) => sum + hold.points, 0)
  const heldCredit = holds.reduce((sum, hold) => sum + hold.creditCents, 0)
  const points = Math.max(0, Math.floor(Number(member.points) || 0) - heldPoints)
  const creditCents = Math.max(0, Math.floor(Number(member.creditCents) || 0) - heldCredit)
  // The minimum is a threshold on what the member holds, not a floor on what
  // they spend: 120 points against a 100-point minimum can all be spent.
  const pointsBalance = Math.max(0, Math.floor(Number(member.points) || 0))
  const usablePoints = pointsBalance >= wholeNonNegative(program.minRedeemPoints) ? points : 0
  return { points: usablePoints, creditCents }
}

/** The cents a member's spendable balances could pay. */
export function spendableCents(
  spendable: LoyaltyBalances,
  program: Pick<LoyaltyProgram, 'pointsPerDollar'>,
): number {
  return wholeNonNegative(spendable.creditCents) + pointsValueCents(spendable.points, program)
}

/** How a redemption of up to `cents` is paid: credit first, then points. */
export interface LoyaltySplit {
  /** What the redemption pays, cents: never more than asked or available. */
  cents: number
  creditCents: number
  points: number
}

export function splitRedemption(
  cents: number,
  spendable: LoyaltyBalances,
  program: Pick<LoyaltyProgram, 'pointsPerDollar'>,
): LoyaltySplit {
  const asked = wholeNonNegative(cents)
  const creditCents = Math.min(asked, wholeNonNegative(spendable.creditCents))
  const pointsCents = Math.min(asked - creditCents, pointsValueCents(spendable.points, program))
  const points = pointsCents > 0 ? Math.min(wholeNonNegative(spendable.points), pointsForCents(pointsCents, program)) : 0
  return { cents: creditCents + pointsCents, creditCents, points }
}

/**
 * The part of a cumulative total that `fraction` of the money accounts for:
 * the whole total once the money is entirely refunded, otherwise rounded.
 */
export function cumulativeTarget(total: number, input: { refundedCents: number; paidCents: number; full: boolean }): number {
  const whole = wholeNonNegative(total)
  if (input.full) return whole
  const paid = wholeNonNegative(input.paidCents)
  if (!paid) return 0
  const refunded = Math.min(paid, wholeNonNegative(input.refundedCents))
  return Math.min(whole, Math.round((whole * refunded) / paid))
}

/*==========================================
 * CODES.
 *
 * A REWARDS code (`RW-7K3P-Q9XZ-2M4D`) spends a member's balance: it is a
 * bearer secret, like a gift card's, with sixty bits drawn from an alphabet
 * without 0/O and 1/I. A REFERRAL code (`RF-7K3P9X`) is made to be shared:
 * it only ever takes a friend's first-order credit, never a balance.
 *=========================================*/

export const LOYALTY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export type LoyaltyCodeKind = 'rewards' | 'referral'

const CODE_SHAPES: Record<LoyaltyCodeKind, { prefix: string; length: number; groups: number[] }> = {
  rewards: { prefix: 'RW', length: 12, groups: [4, 4, 4] },
  referral: { prefix: 'RF', length: 6, groups: [6] },
}

/** A code of `kind` from random bytes (one character per byte). */
export function formatLoyaltyCode(kind: LoyaltyCodeKind, bytes: ArrayLike<number>): string {
  const shape = CODE_SHAPES[kind]
  if (bytes.length < shape.length) throw new Error(`a ${kind} code needs ${shape.length} random bytes`)
  const chars = Array.from({ length: shape.length }, (_, index) => LOYALTY_CODE_ALPHABET[bytes[index] % 32])
  const parts: string[] = [shape.prefix]
  let at = 0
  for (const size of shape.groups) {
    parts.push(chars.slice(at, at + size).join(''))
    at += size
  }
  return parts.join('-')
}

/** Bytes a code of `kind` takes. */
export function loyaltyCodeBytes(kind: LoyaltyCodeKind): number {
  return CODE_SHAPES[kind].length
}

/**
 * A typed code in its one stored form, with its kind, or `null` when it is
 * not one of this plugin's. Dashes and case are forgiven; the alphabet is not.
 */
export function canonicalLoyaltyCode(value: unknown): { kind: LoyaltyCodeKind; code: string } | null {
  const bare = String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  for (const kind of Object.keys(CODE_SHAPES) as LoyaltyCodeKind[]) {
    const shape = CODE_SHAPES[kind]
    if (!bare.startsWith(shape.prefix)) continue
    const body = bare.slice(shape.prefix.length)
    if (body.length !== shape.length) continue
    if (![...body].every((char) => LOYALTY_CODE_ALPHABET.includes(char))) return null
    const parts: string[] = [shape.prefix]
    let at = 0
    for (const size of shape.groups) {
      parts.push(body.slice(at, at + size))
      at += size
    }
    return { kind, code: parts.join('-') }
  }
  return null
}

/** The last four characters a receipt shows. */
export function loyaltyCodeLast4(code: string): string {
  return String(code ?? '')
    .replace(/[^A-Z0-9]/gi, '')
    .slice(-4)
    .toUpperCase()
}

/** An email as a member is keyed by, or `''` when it is not one. */
export function normalizeLoyaltyEmail(value: unknown): string {
  const email = String(value ?? '')
    .trim()
    .toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

/** Whole points as people read them: `1,250`. */
export function formatPoints(points: number): string {
  return Math.trunc(Number(points) || 0).toLocaleString('en-US')
}

/** Integer cents as money: `$12.50`. */
export function formatLoyaltyCents(cents: number, currency = 'usd'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
      (Number(cents) || 0) / 100,
    )
  } catch {
    return `$${((Number(cents) || 0) / 100).toFixed(2)}`
  }
}
