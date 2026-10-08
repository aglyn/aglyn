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

import type {
  CheckoutCreditAccount,
  CheckoutCreditChannel,
  CheckoutCreditHoldRequest,
  CheckoutCreditRefusal,
  CheckoutCreditStage,
  CheckoutCreditTransaction,
} from '@aglyn/aglyn/plugin-manager/plugin-checkout-credits'
import {
  canonicalLoyaltyCode,
  formatLoyaltyCents,
  formatPoints,
  liveHolds,
  loyaltyCodeLast4,
  normalizeLoyaltyEmail,
  spendableBalances,
  spendableCents,
  splitRedemption,
} from '../model/loyalty-math'
import { normalizeLoyaltyProgram, type LoyaltyProgram } from '../model/loyalty-program'
import type { StoredLoyaltyMember } from '../model/loyalty-member'
import {
  isDocumentId,
  keyId,
  loyaltyDb,
  loyaltyRefs,
  memberKeyFor,
  memberReference,
  parseLoyaltyReference,
  referralReference,
} from './db'
import { normalizeStoredMember, writeLedger, type LoyaltyScope } from './members'
import { loyaltyProgramIsOn, resolveLoyaltyStore } from './program-store'
import { normalizeRedemption, restorationTo, withLiveTotals, type StoredRedemption } from './redemptions'
import { resolveLoyaltyOrgId } from './site-context'

/**
 * Loyalty's checkout credit (AGL-3640): the provider commerce reaches through
 * core's `core.checkout-credits` seam, by the codes this plugin mints, without
 * either plugin importing the other.
 *
 * Two kinds of code, one provider:
 *
 *   - a REWARDS code (`RW-…`) spends a member's store credit, then their
 *     points. A bearer secret, like a gift card's; at the register a cashier
 *     may also find the member by email, which only an authenticated staff
 *     member can do.
 *   - a REFERRAL code (`RF-…`) takes a friend's first-order credit, once per
 *     friend, never from anyone's balance. The member who shared it is
 *     rewarded when the friend's order is paid (`order-events.ts`).
 *
 * Every write is a transaction, and every one that settles a sale runs in the
 * SELLER's transaction through {@link stageLoyaltyCredit}, so a redemption
 * commits with its sale or not at all.
 */

/** How long an online checkout's hold stands: past any session that can still be paid. */
export const LOYALTY_HOLD_TTL_MS = 2 * 60 * 60 * 1000

const NOT_OFFERED: CheckoutCreditRefusal = { ok: false, status: 404, error: 'This store does not offer rewards.' }
const UNKNOWN_CODE: CheckoutCreditRefusal = { ok: false, status: 404, error: 'That rewards code is not valid.' }
const FIRST_ORDER_ONLY: CheckoutCreditRefusal = {
  ok: false,
  status: 409,
  error: 'A referral code is for a first order.',
}

function refusal(status: number, error: string): CheckoutCreditRefusal {
  return { ok: false, status, error }
}

/** A member's account as the seller sees it. */
function memberAccount(member: StoredLoyaltyMember, program: LoyaltyProgram, nowMs: number): CheckoutCreditAccount {
  const spendable = spendableBalances(member, program, nowMs)
  const parts = [`${formatPoints(member.points)} points`]
  if (member.creditCents) parts.push(`${formatLoyaltyCents(member.creditCents)} store credit`)
  return {
    ok: true,
    reference: memberReference(member.memberKey),
    label: 'Rewards',
    last4: loyaltyCodeLast4(member.rewardsCode),
    availableCents: spendableCents(spendable, program),
    detail: `${member.email} · ${parts.join(' and ')}`.slice(0, 120),
  }
}

/** Why a member's balance gives nothing, in words for the buyer. */
function emptyBalanceRefusal(member: StoredLoyaltyMember, program: LoyaltyProgram): CheckoutCreditRefusal {
  if (member.creditCents <= 0 && member.points > 0 && member.points < program.minRedeemPoints) {
    return refusal(
      409,
      `Rewards can be used from ${formatPoints(program.minRedeemPoints)} points; this account has ${formatPoints(member.points)}.`,
    )
  }
  return refusal(409, 'This rewards account has nothing to spend right now.')
}

async function readMember(scope: LoyaltyScope, memberKey: string): Promise<StoredLoyaltyMember | null> {
  const snapshot = await loyaltyRefs.member(scope.orgId, scope.hostId, memberKey).get()
  return snapshot.exists ? normalizeStoredMember(scope, memberKey, snapshot.data()) : null
}

/** Whether a site offers rewards on a channel: the plugin and the program are on. */
export async function loyaltyCreditOffered(input: { hostId: string; channel: CheckoutCreditChannel }): Promise<boolean> {
  return loyaltyProgramIsOn(input.hostId)
}

/** A buyer's code, or a staff member's pick, to the account it names. */
export async function resolveLoyaltyCredit(input: {
  hostId: string
  code?: string
  reference?: string
  channel: CheckoutCreditChannel
  customerEmail: string | null
  staff: boolean
  nowMs?: number
}): Promise<CheckoutCreditAccount | CheckoutCreditRefusal> {
  const nowMs = input.nowMs ?? Date.now()
  const store = await resolveLoyaltyStore(input.hostId)
  if (!store || !store.program.enabled) return NOT_OFFERED
  const scope = { orgId: store.site.orgId, hostId: input.hostId }
  const program = store.program

  if (!input.code) {
    // A bare reference is a staff member's pick from `lookup`, never a buyer's.
    const parsed = input.staff && input.reference ? parseLoyaltyReference(input.reference) : null
    if (!parsed || parsed.kind !== 'member') return UNKNOWN_CODE
    const member = await readMember(scope, parsed.memberKey)
    return member ? memberAccount(member, program, nowMs) : UNKNOWN_CODE
  }

  const canonical = canonicalLoyaltyCode(input.code)
  if (!canonical) return UNKNOWN_CODE
  const codeSnapshot = await loyaltyRefs.code(scope.orgId, input.hostId, canonical.code).get()
  if (!codeSnapshot.exists || codeSnapshot.get('kind') !== canonical.kind) return UNKNOWN_CODE
  const ownerKey = String(codeSnapshot.get('memberKey') ?? '')
  const owner = ownerKey ? await readMember(scope, ownerKey) : null
  if (!owner) return UNKNOWN_CODE

  if (canonical.kind === 'rewards') return memberAccount(owner, program, nowMs)

  // A referral: the friend is named by the email on the sale.
  if (!program.referralsEnabled || program.refereeRewardCents <= 0) {
    return refusal(409, 'This store is not taking referral codes right now.')
  }
  const email = normalizeLoyaltyEmail(input.customerEmail)
  if (!email) {
    return refusal(
      400,
      input.channel === 'pos'
        ? 'Add the customer’s email to the sale to use a referral code.'
        : 'Enter your email in the cart to use a referral code.',
    )
  }
  const refereeKey = memberKeyFor(input.hostId, email)
  if (refereeKey === ownerKey) return refusal(409, 'A referral code is for a friend, not the member who shared it.')
  const [refereeMember, claim] = await Promise.all([
    readMember(scope, refereeKey),
    loyaltyRefs.referralClaim(scope.orgId, input.hostId, refereeKey).get(),
  ])
  if ((refereeMember?.ordersCount ?? 0) > 0 || (claim.exists && claim.get('settled'))) return FIRST_ORDER_ONLY
  return {
    ok: true,
    reference: referralReference(ownerKey, refereeKey),
    label: 'Referral credit',
    last4: loyaltyCodeLast4(canonical.code),
    availableCents: program.refereeRewardCents,
    detail: `${formatLoyaltyCents(program.refereeRewardCents)} off a first order`,
  }
}

/** Reserves up to `maxCents` for one online checkout attempt. */
export async function holdLoyaltyCredit(
  input: CheckoutCreditHoldRequest,
): Promise<{ ok: true; cents: number } | CheckoutCreditRefusal> {
  const parsed = parseLoyaltyReference(input.reference)
  if (!parsed) return UNKNOWN_CODE
  const store = await resolveLoyaltyStore(input.hostId)
  if (!store || !store.program.enabled) return NOT_OFFERED
  const scope = { orgId: store.site.orgId, hostId: input.hostId }
  const program = store.program
  const holdId = keyId(input.holdKey)
  const expiresAtMs = input.nowMs + LOYALTY_HOLD_TTL_MS
  const maxCents = Math.max(0, Math.trunc(input.maxCents))

  if (parsed.kind === 'member') {
    return loyaltyDb().runTransaction(async (transaction: any) => {
      const ref = loyaltyRefs.member(scope.orgId, scope.hostId, parsed.memberKey)
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) return UNKNOWN_CODE
      const member = normalizeStoredMember(scope, parsed.memberKey, snapshot.data())
      const split = splitRedemption(maxCents, spendableBalances(member, program, input.nowMs, holdId), program)
      if (split.cents <= 0) return maxCents <= 0 ? refusal(409, 'Nothing is left to pay.') : emptyBalanceRefusal(member, program)
      transaction.set(ref, {
        ...member,
        holds: { ...liveHolds(member.holds, input.nowMs, holdId), [holdId]: { points: split.points, creditCents: split.creditCents, expiresAtMs } },
        updatedAtMs: input.nowMs,
      })
      return { ok: true as const, cents: split.cents }
    })
  }

  // A referral: one live hold per friend, and none once their first order is written.
  if (!program.referralsEnabled || program.refereeRewardCents <= 0) {
    return refusal(409, 'This store is not taking referral codes right now.')
  }
  if (maxCents < program.refereeMinimumCents) {
    return refusal(409, `Referral credit applies to orders of ${formatLoyaltyCents(program.refereeMinimumCents)} or more.`)
  }
  return loyaltyDb().runTransaction(async (transaction: any) => {
    const claimRef = loyaltyRefs.referralClaim(scope.orgId, scope.hostId, parsed.refereeKey)
    const [claimSnapshot, refereeSnapshot] = await Promise.all([
      transaction.get(claimRef),
      transaction.get(loyaltyRefs.member(scope.orgId, scope.hostId, parsed.refereeKey)),
    ])
    if (claimSnapshot.exists && claimSnapshot.get('settled')) return FIRST_ORDER_ONLY
    if (refereeSnapshot.exists && Number(refereeSnapshot.get('ordersCount') ?? 0) > 0) return FIRST_ORDER_ONLY
    const holds = referralHolds(claimSnapshot.exists ? claimSnapshot.get('holds') : null, input.nowMs, holdId)
    if (Object.keys(holds).length) {
      return refusal(409, 'This referral is already being used in another checkout.')
    }
    const cents = Math.min(maxCents, program.refereeRewardCents)
    if (cents <= 0) return refusal(409, 'Nothing is left to pay.')
    transaction.set(claimRef, {
      orgId: scope.orgId,
      hostId: scope.hostId,
      refereeKey: parsed.refereeKey,
      referrerKey: parsed.referrerKey,
      settled: null,
      holds: { [holdId]: { cents, expiresAtMs } },
      updatedAtMs: input.nowMs,
    })
    return { ok: true as const, cents }
  })
}

function referralHolds(raw: unknown, nowMs: number, exceptId?: string): Record<string, { cents: number; expiresAtMs: number }> {
  const live: Record<string, { cents: number; expiresAtMs: number }> = {}
  for (const [id, hold] of Object.entries((raw ?? {}) as Record<string, { cents?: unknown; expiresAtMs?: unknown }>)) {
    if (id === exceptId || !hold || !(Number(hold.expiresAtMs) > nowMs)) continue
    live[id] = { cents: Math.max(0, Math.trunc(Number(hold.cents) || 0)), expiresAtMs: Number(hold.expiresAtMs) }
  }
  return live
}

/** Lets an online hold go. Never throws. */
export async function releaseLoyaltyCredit(input: { hostId: string; reference: string; holdKey: string }): Promise<void> {
  try {
    const parsed = parseLoyaltyReference(input.reference)
    const orgId = parsed ? await resolveLoyaltyOrgId(input.hostId) : null
    if (!parsed || !orgId) return
    const scope = { orgId, hostId: input.hostId }
    const holdId = keyId(input.holdKey)
    const nowMs = Date.now()
    await loyaltyDb().runTransaction(async (transaction: any) => {
      if (parsed.kind === 'member') {
        const ref = loyaltyRefs.member(orgId, input.hostId, parsed.memberKey)
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return
        const member = normalizeStoredMember(scope, parsed.memberKey, snapshot.data())
        if (!member.holds[holdId]) return
        transaction.set(ref, { ...member, holds: liveHolds(member.holds, nowMs, holdId), updatedAtMs: nowMs })
        return
      }
      const ref = loyaltyRefs.referralClaim(orgId, input.hostId, parsed.refereeKey)
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists || snapshot.get('settled')) return
      transaction.set(ref, { ...snapshot.data(), holds: referralHolds(snapshot.get('holds'), nowMs, holdId), updatedAtMs: nowMs })
    })
  } catch (error) {
    // The TTL still lets it go.
    console.error('[loyalty] hold release failed', input.hostId, error)
  }
}

/**
 * Reads the account INSIDE the seller's transaction; the stage's `debit` and
 * `reverse` write through the same transaction. `null` when the account is
 * gone.
 */
export async function stageLoyaltyCredit(input: {
  transaction: CheckoutCreditTransaction
  hostId: string
  reference: string
  orderId: string
  nowMs: number
  holdKey?: string
}): Promise<CheckoutCreditStage | null> {
  const parsed = parseLoyaltyReference(input.reference)
  if (!parsed || !isDocumentId(input.orderId)) return null
  const orgId = await resolveLoyaltyOrgId(input.hostId)
  if (!orgId) return null
  const scope = { orgId, hostId: input.hostId }
  const { transaction, orderId, nowMs } = input
  const holdId = input.holdKey ? keyId(input.holdKey) : undefined
  const programSnapshot = await transaction.get(loyaltyRefs.program(orgId, input.hostId))
  const program = normalizeLoyaltyProgram(programSnapshot.exists ? programSnapshot.data() : null)

  if (parsed.kind === 'member') {
    const memberRef = loyaltyRefs.member(orgId, input.hostId, parsed.memberKey)
    const redemptionRef = loyaltyRefs.redemption(orgId, input.hostId, orderId, parsed.memberKey)
    const [memberSnapshot, redemptionSnapshot] = await Promise.all([transaction.get(memberRef), transaction.get(redemptionRef)])
    if (!memberSnapshot.exists) return null
    const member = normalizeStoredMember(scope, parsed.memberKey, memberSnapshot.data())
    const redemption = normalizeRedemption(
      { ...scope, orderId, memberKey: parsed.memberKey },
      redemptionSnapshot.exists ? redemptionSnapshot.data() : undefined,
    )
    // A sale's own hold is honored whatever the program says now: the buyer
    // was promised it when they paid.
    const spendable = spendableBalances(member, program, nowMs, holdId)
    const ownHold = holdId ? member.holds[holdId] : undefined
    if (ownHold) {
      spendable.points = Math.max(spendable.points, Math.min(ownHold.points, Math.max(0, member.points)))
      spendable.creditCents = Math.max(spendable.creditCents, Math.min(ownHold.creditCents, Math.max(0, member.creditCents)))
    }
    const availableCents = spendableCents(spendable, program)
    return {
      availableCents,
      debit({ cents, key, channel }) {
        const debitId = keyId(key)
        const prior = redemption.debits[debitId]
        if (prior) return prior.reversed ? 0 : prior.cents
        const split = splitRedemption(Math.min(Math.max(0, Math.trunc(cents)), availableCents), spendable, program)
        const nextMember: StoredLoyaltyMember = {
          ...member,
          points: member.points - split.points,
          creditCents: member.creditCents - split.creditCents,
          holds: liveHolds(member.holds, nowMs, holdId),
          updatedAtMs: nowMs,
        }
        transaction.set(memberRef, nextMember)
        if (split.cents > 0) {
          const next = withLiveTotals({
            ...redemption,
            debits: {
              ...redemption.debits,
              [debitId]: { cents: split.cents, creditCents: split.creditCents, points: split.points, channel, atMs: nowMs, reversed: false },
            },
          })
          transaction.set(redemptionRef, next)
          writeLedger(transaction, scope, `redeem__${orderId}__${debitId}`, {
            memberKey: parsed.memberKey,
            kind: 'redeem',
            points: -split.points,
            creditCents: -split.creditCents,
            orderId,
            channel,
            atMs: nowMs,
          })
        }
        return split.cents
      },
      reverse({ key }) {
        const debitId = keyId(key)
        const prior = redemption.debits[debitId]
        if (!prior || prior.reversed) return 0
        transaction.set(memberRef, {
          ...member,
          points: member.points + prior.points,
          creditCents: member.creditCents + prior.creditCents,
          updatedAtMs: nowMs,
        })
        transaction.set(
          redemptionRef,
          withLiveTotals({ ...redemption, debits: { ...redemption.debits, [debitId]: { ...prior, reversed: true } } }),
        )
        writeLedger(transaction, scope, `void__${orderId}__${debitId}`, {
          memberKey: parsed.memberKey,
          kind: 'void',
          points: prior.points,
          creditCents: prior.creditCents,
          orderId,
          channel: prior.channel,
          atMs: nowMs,
        })
        return prior.cents
      },
    }
  }

  const claimRef = loyaltyRefs.referralClaim(orgId, input.hostId, parsed.refereeKey)
  const claimSnapshot = await transaction.get(claimRef)
  const claim = (claimSnapshot.exists ? claimSnapshot.data() : {}) as Record<string, any>
  const settled = claim['settled'] as { orderId?: string; key?: string; cents?: number } | null | undefined
  const ownHold = holdId ? (claim['holds'] ?? {})[holdId] : undefined
  const availableCents = settled
    ? 0
    : ownHold
      ? Math.max(0, Math.trunc(Number(ownHold.cents) || 0))
      : program.referralsEnabled
        ? program.refereeRewardCents
        : 0
  return {
    availableCents,
    debit({ cents, key, channel }) {
      const debitId = keyId(key)
      if (settled) return settled.key === debitId ? Math.trunc(Number(settled.cents) || 0) : 0
      const taken = Math.min(Math.max(0, Math.trunc(cents)), availableCents)
      if (taken <= 0) return 0
      transaction.set(claimRef, {
        orgId,
        hostId: input.hostId,
        refereeKey: parsed.refereeKey,
        referrerKey: parsed.referrerKey,
        holds: {},
        settled: { orderId, key: debitId, cents: taken, channel, atMs: nowMs },
        updatedAtMs: nowMs,
      })
      writeLedger(transaction, scope, `referee__${orderId}`, {
        memberKey: parsed.refereeKey,
        kind: 'referee',
        points: 0,
        creditCents: 0,
        orderId,
        channel,
        note: `${formatLoyaltyCents(taken)} referral credit on a first order`,
        atMs: nowMs,
      })
      return taken
    },
    reverse({ key }) {
      const debitId = keyId(key)
      if (!settled || settled.key !== debitId || settled.orderId !== orderId) return 0
      transaction.set(claimRef, { ...claim, settled: null, holds: {}, updatedAtMs: nowMs })
      return Math.trunc(Number(settled.cents) || 0)
    },
  }
}

/**
 * Raises what one sale has given back to one member to `targetCents`, inside
 * a transaction of its own. Returns the cents given back.
 */
export async function restoreRedemptionTo(input: {
  scope: LoyaltyScope
  orderId: string
  memberKey: string
  targetCents: number
  /** The restore's own key: a key already applied gives nothing more. */
  key: string
  nowMs: number
}): Promise<number> {
  const { scope, orderId, memberKey } = input
  if (!isDocumentId(orderId)) return 0
  return loyaltyDb().runTransaction(async (transaction: any) => {
    const redemptionRef = loyaltyRefs.redemption(scope.orgId, scope.hostId, orderId, memberKey)
    const memberRef = loyaltyRefs.member(scope.orgId, scope.hostId, memberKey)
    const [redemptionSnapshot, memberSnapshot] = await Promise.all([transaction.get(redemptionRef), transaction.get(memberRef)])
    if (!redemptionSnapshot.exists || !memberSnapshot.exists) return 0
    const redemption: StoredRedemption = normalizeRedemption({ ...scope, orderId, memberKey }, redemptionSnapshot.data())
    const restoreId = keyId(input.key)
    if (restoreId in redemption.restores) return 0
    const give = restorationTo(redemption, input.targetCents)
    if (give.cents <= 0) return 0
    const member = normalizeStoredMember(scope, memberKey, memberSnapshot.data())
    transaction.set(memberRef, {
      ...member,
      points: member.points + give.points,
      creditCents: member.creditCents + give.creditCents,
      updatedAtMs: input.nowMs,
    })
    transaction.set(redemptionRef, {
      ...redemption,
      restoredCents: redemption.restoredCents + give.cents,
      restoredCreditCents: redemption.restoredCreditCents + give.creditCents,
      restoredPoints: redemption.restoredPoints + give.points,
      restores: { ...redemption.restores, [restoreId]: give.cents },
    })
    writeLedger(transaction, scope, `restore__${orderId}__${restoreId}`, {
      memberKey,
      kind: 'restore',
      points: give.points,
      creditCents: give.creditCents,
      orderId,
      atMs: input.nowMs,
    })
    return give.cents
  })
}

/** A refund at the register: gives back up to `cents` of what the sale took. Idempotent per key. */
export async function restoreLoyaltyCredit(input: {
  hostId: string
  reference: string
  orderId: string
  cents: number
  key: string
}): Promise<number> {
  const parsed = parseLoyaltyReference(input.reference)
  // A referral credit was a discount, not a balance: there is nothing to give back.
  if (!parsed || parsed.kind !== 'member') return 0
  const orgId = await resolveLoyaltyOrgId(input.hostId)
  if (!orgId) return 0
  const scope = { orgId, hostId: input.hostId }
  const snapshot = await loyaltyRefs.redemption(orgId, input.hostId, input.orderId, parsed.memberKey).get()
  if (!snapshot.exists) return 0
  const redemption = normalizeRedemption({ ...scope, orderId: input.orderId, memberKey: parsed.memberKey }, snapshot.data())
  return restoreRedemptionTo({
    scope,
    orderId: input.orderId,
    memberKey: parsed.memberKey,
    targetCents: redemption.restoredCents + Math.max(0, Math.trunc(input.cents)),
    key: input.key,
    nowMs: Date.now(),
  })
}

/** Staff search at the register: by code, by exact email, or by the start of an email. */
export async function lookupLoyaltyCredit(input: { hostId: string; query: string }): Promise<CheckoutCreditAccount[]> {
  const store = await resolveLoyaltyStore(input.hostId)
  if (!store || !store.program.enabled) return []
  const scope = { orgId: store.site.orgId, hostId: input.hostId }
  const nowMs = Date.now()
  const query = String(input.query ?? '').trim().slice(0, 120)
  if (query.length < 2) return []
  const canonical = canonicalLoyaltyCode(query)
  if (canonical?.kind === 'rewards') {
    const account = await resolveLoyaltyCredit({ hostId: input.hostId, code: canonical.code, channel: 'pos', customerEmail: null, staff: true })
    return account.ok ? [account] : []
  }
  const email = normalizeLoyaltyEmail(query)
  if (email) {
    const member = await readMember(scope, memberKeyFor(input.hostId, email))
    return member ? [memberAccount(member, store.program, nowMs)] : []
  }
  const prefix = query.toLowerCase()
  const snapshot = await loyaltyRefs
    .members(scope.orgId)
    .where('hostId', '==', input.hostId)
    .where('email', '>=', prefix)
    .where('email', '<', `${prefix}`)
    .orderBy('email', 'asc')
    .limit(8)
    .get()
  return snapshot.docs.map((doc: any) =>
    memberAccount(normalizeStoredMember(scope, String(doc.get('memberKey') ?? ''), doc.data()), store.program, nowMs),
  )
}
