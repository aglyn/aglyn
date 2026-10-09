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

import type { LoyaltyHold } from './loyalty-math'

/**
 * What loyalty stores about a member and every movement of their balances
 * (AGL-3640), and the views the console is served. The stored shapes are the
 * server's; the views are what leaves it — a rewards code is shown to the
 * store's staff (they read it to the customer at the till) but a hold's key
 * never is.
 */

export interface StoredLoyaltyMember {
  orgId: string
  hostId: string
  memberKey: string
  email: string
  name: string | null
  /** Spendable points. May fall below zero when a refund reverses points already spent. */
  points: number
  /** Store credit, cents. */
  creditCents: number
  lifetimePoints: number
  ordersCount: number
  rewardsCode: string
  referralCode: string
  /** The member whose referral brought this one, by key. */
  referredBy: string | null
  /** Live online checkout reservations, by hold id. */
  holds: Record<string, LoyaltyHold>
  createdAtMs: number
  updatedAtMs: number
  lastOrderAtMs: number | null
  /**
   * The built-in points this member held when the store connected its own
   * Smile.io or Yotpo account (AGL-3677), set aside untouched while `points`
   * mirrors the account, and given back exactly when the store disconnects.
   * Present only while parked.
   */
  parked?: boolean
  parkedPoints?: number
}

export type LoyaltyLedgerKind =
  /** Points for an order. */
  | 'earn'
  /** Points for joining, with the first order. */
  | 'welcome'
  /** Points taken back by a refund or a cancellation. */
  | 'reverse'
  /** Points and credit spent on a sale. */
  | 'redeem'
  /** Spent points and credit handed back by a refund. */
  | 'restore'
  /** A register payment voided before the sale finished. */
  | 'void'
  /** A change the store made by hand. */
  | 'adjust'
  /** Store credit for a friend's first order. */
  | 'referral'
  /** A friend's first-order credit, taken. */
  | 'referee'

export interface StoredLoyaltyLedgerEntry {
  orgId: string
  hostId: string
  memberKey: string
  kind: LoyaltyLedgerKind
  /** Signed: what this movement added to the points balance. */
  points: number
  /** Signed: what it added to store credit, cents. */
  creditCents: number
  orderId: string | null
  channel: 'online' | 'pos' | null
  note: string | null
  /** The console user, for a change made by hand. */
  actorUid: string | null
  atMs: number
  /** On an `earn` row: the goods it was earned on, cents. */
  basisCents?: number
  /** On an `earn` row: how many of its points refunds have taken back so far. */
  reversedPoints?: number
}

/** What a member looks like to the console. */
export interface LoyaltyMemberView {
  id: string
  email: string
  name: string | null
  points: number
  creditCents: number
  lifetimePoints: number
  ordersCount: number
  rewardsCode: string
  referralCode: string | null
  referred: boolean
  createdAtMs: number
  lastOrderAtMs: number | null
}

export interface LoyaltyLedgerView {
  id: string
  kind: LoyaltyLedgerKind
  points: number
  creditCents: number
  orderId: string | null
  channel: 'online' | 'pos' | null
  note: string | null
  atMs: number
}

export const LOYALTY_LEDGER_LABELS: Record<LoyaltyLedgerKind, string> = {
  earn: 'Earned',
  welcome: 'Welcome points',
  reverse: 'Refund',
  redeem: 'Spent',
  restore: 'Given back',
  void: 'Voided',
  adjust: 'Adjusted',
  referral: 'Referral reward',
  referee: 'Referral credit',
}

export function toLoyaltyMemberView(
  id: string,
  member: Partial<StoredLoyaltyMember>,
  options: { referrals: boolean },
): LoyaltyMemberView {
  return {
    id,
    email: String(member.email ?? ''),
    name: member.name ?? null,
    points: Math.trunc(Number(member.points) || 0),
    creditCents: Math.trunc(Number(member.creditCents) || 0),
    lifetimePoints: Math.trunc(Number(member.lifetimePoints) || 0),
    ordersCount: Math.trunc(Number(member.ordersCount) || 0),
    rewardsCode: String(member.rewardsCode ?? ''),
    referralCode: options.referrals ? String(member.referralCode ?? '') || null : null,
    referred: Boolean(member.referredBy),
    createdAtMs: Number(member.createdAtMs) || 0,
    lastOrderAtMs: Number(member.lastOrderAtMs) || null,
  }
}

export function toLoyaltyLedgerView(id: string, entry: Partial<StoredLoyaltyLedgerEntry>): LoyaltyLedgerView {
  return {
    id,
    kind: (entry.kind ?? 'adjust') as LoyaltyLedgerKind,
    points: Math.trunc(Number(entry.points) || 0),
    creditCents: Math.trunc(Number(entry.creditCents) || 0),
    orderId: entry.orderId ?? null,
    channel: entry.channel ?? null,
    note: entry.note ?? null,
    atMs: Number(entry.atMs) || 0,
  }
}

/** What one order did to members' balances, for the order dialog. */
export interface LoyaltyOrderView {
  /** The member the order earned for, by email. */
  email: string | null
  memberId: string | null
  earnedPoints: number
  reversedPoints: number
  /** What the order spent, across members (a sale may take more than one code). */
  spentCents: number
  spentPoints: number
  spentCreditCents: number
  restoredCents: number
  entries: LoyaltyLedgerView[]
}

/** The program's figures for its card. */
export interface LoyaltyProgramTotals {
  members: number | null
  /** Points members hold, and what they are worth at today's rate. */
  outstandingPoints: number | null
  outstandingPointsCents: number | null
  /** Store credit members hold. */
  outstandingCreditCents: number | null
}
