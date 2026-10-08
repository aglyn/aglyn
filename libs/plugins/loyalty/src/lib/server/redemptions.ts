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
 * What one sale took from one member, and what refunds have given back
 * (AGL-3640): `loyaltyRedemptions/{hostId}__{orderId}__{memberKey}`. A sale
 * may take from a member more than once — two register payments — so each
 * debit is kept by the key that took it, and the totals are what is live.
 *
 * Giving back is by cumulative target: the total restored only ever rises to
 * what the refunds so far account for, and each part (credit, points) is
 * restored in proportion, so a member gets back the mix they spent.
 */

export interface RedemptionDebit {
  cents: number
  creditCents: number
  points: number
  channel: 'online' | 'pos'
  atMs: number
  reversed: boolean
}

export interface StoredRedemption {
  orgId: string
  hostId: string
  orderId: string
  memberKey: string
  debits: Record<string, RedemptionDebit>
  /** Live totals: every debit not reversed. */
  cents: number
  creditCents: number
  points: number
  restoredCents: number
  restoredCreditCents: number
  restoredPoints: number
  /** Restores already applied, by key: what each gave back. */
  restores: Record<string, number>
}

const int = (value: unknown) => Math.max(0, Math.trunc(Number(value) || 0))

export function normalizeRedemption(
  scope: { orgId: string; hostId: string; orderId: string; memberKey: string },
  data: Record<string, unknown> | undefined,
): StoredRedemption {
  const source = data ?? {}
  const debits: Record<string, RedemptionDebit> = {}
  for (const [id, raw] of Object.entries((source['debits'] ?? {}) as Record<string, Partial<RedemptionDebit>>)) {
    if (!raw || typeof raw !== 'object') continue
    debits[id] = {
      cents: int(raw.cents),
      creditCents: int(raw.creditCents),
      points: int(raw.points),
      channel: raw.channel === 'pos' ? 'pos' : 'online',
      atMs: Number(raw.atMs) || 0,
      reversed: raw.reversed === true,
    }
  }
  const restores: Record<string, number> = {}
  for (const [id, cents] of Object.entries((source['restores'] ?? {}) as Record<string, unknown>)) restores[id] = int(cents)
  return {
    ...scope,
    debits,
    cents: int(source['cents']),
    creditCents: int(source['creditCents']),
    points: int(source['points']),
    restoredCents: int(source['restoredCents']),
    restoredCreditCents: int(source['restoredCreditCents']),
    restoredPoints: int(source['restoredPoints']),
    restores,
  }
}

/** The totals recomputed from the debits that stand. */
export function withLiveTotals(redemption: StoredRedemption): StoredRedemption {
  const live = Object.values(redemption.debits).filter((debit) => !debit.reversed)
  return {
    ...redemption,
    cents: live.reduce((sum, debit) => sum + debit.cents, 0),
    creditCents: live.reduce((sum, debit) => sum + debit.creditCents, 0),
    points: live.reduce((sum, debit) => sum + debit.points, 0),
  }
}

/**
 * What raising the restored total to `targetCents` gives back, split across
 * credit and points in the proportion they were spent. Never past what was
 * spent, never below what is already restored.
 */
export function restorationTo(
  redemption: StoredRedemption,
  targetCents: number,
): { cents: number; creditCents: number; points: number } {
  const total = redemption.cents
  const target = Math.min(total, Math.max(redemption.restoredCents, int(targetCents)))
  const cents = target - redemption.restoredCents
  if (cents <= 0 || total <= 0) return { cents: 0, creditCents: 0, points: 0 }
  const creditTarget = target === total ? redemption.creditCents : Math.round((redemption.creditCents * target) / total)
  const pointsTarget = target === total ? redemption.points : Math.round((redemption.points * target) / total)
  return {
    cents,
    creditCents: Math.max(0, creditTarget - redemption.restoredCreditCents),
    points: Math.max(0, pointsTarget - redemption.restoredPoints),
  }
}
