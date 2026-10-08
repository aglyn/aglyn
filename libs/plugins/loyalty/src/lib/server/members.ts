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

import type { CheckoutCreditTransaction } from '@aglyn/aglyn/plugin-manager/plugin-checkout-credits'
import type { LoyaltyHold } from '../model/loyalty-math'
import type { LoyaltyLedgerKind, StoredLoyaltyLedgerEntry, StoredLoyaltyMember } from '../model/loyalty-member'
import { loyaltyRefs, memberKeyFor, mintLoyaltyCode } from './db'

/**
 * Reading and writing members inside a transaction (AGL-3640). Every function
 * here keeps the database's rule: the `read…` ones only read, and return a
 * plan; the `write…` ones only write. A caller does all of its reads first.
 */

export interface LoyaltyScope {
  orgId: string
  hostId: string
}

/** A stored member read back, with every field present. */
export function normalizeStoredMember(
  scope: LoyaltyScope,
  memberKey: string,
  data: Record<string, unknown> | undefined,
): StoredLoyaltyMember {
  const source = data ?? {}
  const holds: Record<string, LoyaltyHold> = {}
  for (const [id, hold] of Object.entries((source['holds'] ?? {}) as Record<string, Partial<LoyaltyHold>>)) {
    if (!hold || typeof hold !== 'object') continue
    holds[id] = {
      points: Math.max(0, Math.trunc(Number(hold.points) || 0)),
      creditCents: Math.max(0, Math.trunc(Number(hold.creditCents) || 0)),
      expiresAtMs: Number(hold.expiresAtMs) || 0,
    }
  }
  return {
    orgId: scope.orgId,
    hostId: scope.hostId,
    memberKey,
    email: String(source['email'] ?? ''),
    name: typeof source['name'] === 'string' && source['name'] ? (source['name'] as string) : null,
    points: Math.trunc(Number(source['points']) || 0),
    creditCents: Math.trunc(Number(source['creditCents']) || 0),
    lifetimePoints: Math.max(0, Math.trunc(Number(source['lifetimePoints']) || 0)),
    ordersCount: Math.max(0, Math.trunc(Number(source['ordersCount']) || 0)),
    rewardsCode: String(source['rewardsCode'] ?? ''),
    referralCode: String(source['referralCode'] ?? ''),
    referredBy: typeof source['referredBy'] === 'string' && source['referredBy'] ? (source['referredBy'] as string) : null,
    holds,
    createdAtMs: Number(source['createdAtMs']) || 0,
    updatedAtMs: Number(source['updatedAtMs']) || 0,
    lastOrderAtMs: Number(source['lastOrderAtMs']) || null,
  }
}

/** A member as a transaction read it: existing, or about to be enrolled. */
export interface MemberPlan {
  ref: any
  memberKey: string
  created: boolean
  member: StoredLoyaltyMember
  codeWrites: Array<{ ref: any; data: Record<string, unknown> }>
}

const MAX_CODE_ATTEMPTS = 5

/**
 * Reads the member for `email`, or plans their enrollment: two fresh codes,
 * each read first so a code is never reused. Reads only.
 */
export async function readMemberForWrite(
  transaction: CheckoutCreditTransaction,
  scope: LoyaltyScope,
  input: { email: string; name?: string | null; nowMs: number },
): Promise<MemberPlan> {
  const memberKey = memberKeyFor(scope.hostId, input.email)
  const ref = loyaltyRefs.member(scope.orgId, scope.hostId, memberKey)
  const snapshot = await transaction.get(ref)
  if (snapshot.exists) {
    return { ref, memberKey, created: false, member: normalizeStoredMember(scope, memberKey, snapshot.data()), codeWrites: [] }
  }
  const codes: Record<'rewards' | 'referral', string> = { rewards: '', referral: '' }
  const codeWrites: MemberPlan['codeWrites'] = []
  for (const kind of ['rewards', 'referral'] as const) {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !codes[kind]; attempt += 1) {
      const code = mintLoyaltyCode(kind)
      const codeRef = loyaltyRefs.code(scope.orgId, scope.hostId, code)
      if (!(await transaction.get(codeRef)).exists) {
        codes[kind] = code
        codeWrites.push({
          ref: codeRef,
          data: { orgId: scope.orgId, hostId: scope.hostId, kind, memberKey, createdAtMs: input.nowMs },
        })
      }
    }
    if (!codes[kind]) throw new Error(`could not mint an unused ${kind} code`)
  }
  return {
    ref,
    memberKey,
    created: true,
    codeWrites,
    member: {
      orgId: scope.orgId,
      hostId: scope.hostId,
      memberKey,
      email: input.email,
      name: input.name?.trim() ? input.name.trim().slice(0, 120) : null,
      points: 0,
      creditCents: 0,
      lifetimePoints: 0,
      ordersCount: 0,
      rewardsCode: codes.rewards,
      referralCode: codes.referral,
      referredBy: null,
      holds: {},
      createdAtMs: input.nowMs,
      updatedAtMs: input.nowMs,
      lastOrderAtMs: null,
    },
  }
}

/** Writes a member whole — never a merge, so a hold let go is gone — with its new codes. */
export function writeMember(transaction: CheckoutCreditTransaction, plan: Pick<MemberPlan, 'ref' | 'member' | 'codeWrites'>): void {
  transaction.set(plan.ref, { ...plan.member })
  for (const write of plan.codeWrites) transaction.set(write.ref, write.data)
}

/** Writes one ledger row under a key its cause names, so a retried cause writes the same row. */
export function writeLedger(
  transaction: CheckoutCreditTransaction,
  scope: LoyaltyScope,
  entryKey: string,
  entry: Omit<StoredLoyaltyLedgerEntry, 'orgId' | 'hostId' | 'orderId' | 'channel' | 'note' | 'actorUid'> &
    Partial<Pick<StoredLoyaltyLedgerEntry, 'orderId' | 'channel' | 'note' | 'actorUid'>> & { kind: LoyaltyLedgerKind },
): void {
  transaction.set(loyaltyRefs.ledger(scope.orgId, scope.hostId, entryKey), {
    orgId: scope.orgId,
    hostId: scope.hostId,
    orderId: null,
    channel: null,
    note: null,
    actorUid: null,
    ...entry,
  } satisfies StoredLoyaltyLedgerEntry)
}
