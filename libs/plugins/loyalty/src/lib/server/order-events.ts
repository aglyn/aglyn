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

import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { LOYALTY_CREDIT_PROVIDER_ID } from '../constants/bundle-common'
import { cumulativeTarget, earnedPoints, normalizeLoyaltyEmail } from '../model/loyalty-math'
import type { StoredLoyaltyMember } from '../model/loyalty-member'
import { isDocumentId, keyId, loyaltyDb, loyaltyRefs, parseLoyaltyReference } from './db'
import { pointsEarnedEmail, referralRewardEmail, sendLoyaltyEmail } from './emails'
import { normalizeStoredMember, readMemberForWrite, writeLedger, writeMember } from './members'
import { resolveLoyaltyStore } from './program-store'
import { normalizeRedemption } from './redemptions'
import { restoreRedemptionTo } from './credit-provider'
import { resolveLoyaltyOrgId } from './site-context'

/**
 * Points for sales, and points back for refunds (AGL-3640), from the seller's
 * order events by name — `order.paid`, `order.refunded`, `order.cancelled` —
 * which commerce raises for online and register sales alike. Loyalty never
 * imports commerce; it restates the fields of the event's `order` it reads.
 *
 * ONCE PER ORDER. An event is delivered at least once. The `earn` row for an
 * order is keyed by the order and read inside the transaction that writes
 * it, so a redelivered `order.paid` finds it and does nothing — and a points
 * email is sent only by the delivery that wrote it.
 *
 * REFUNDS SETTLE TO A TARGET. A refund moves the order's cumulative
 * `refundedCents`; the points taken back rise to the share of the earned
 * points that refunds account for, and never past it. A partial refund, a
 * second partial refund and then a cancellation reach the same total however
 * many times each is delivered.
 */

/** The order fields loyalty reads, restated from the seller's event. */
export interface LoyaltyEventOrder {
  id: string
  status: string | null
  channel: string
  currency?: string
  customerEmail: string | null
  customerName: string | null
  totals: { itemsCents: number; discountCents: number; totalCents: number | null }
  refundedCents: number
  credits?: Array<{ providerId: string; reference: string; amountCents: number; appliedAs: 'discount' | 'tender' }>
}

export interface LoyaltyOrderPayload {
  order: LoyaltyEventOrder
}

export interface LoyaltyRefundPayload extends LoyaltyOrderPayload {
  refund?: { full?: boolean }
}

const cents = (value: unknown) => Math.max(0, Math.trunc(Number(value) || 0))

function loyaltyCredits(order: LoyaltyEventOrder) {
  return (Array.isArray(order.credits) ? order.credits : []).filter(
    (credit) => credit && credit.providerId === LOYALTY_CREDIT_PROVIDER_ID,
  )
}

/**
 * The goods a member earns on: items, less discounts (online, a rewards
 * redemption is one of them), less what their rewards paid at the register.
 */
export function earnBasisCents(order: LoyaltyEventOrder): number {
  const tenders = loyaltyCredits(order)
    .filter((credit) => credit.appliedAs === 'tender')
    .reduce((sum, credit) => sum + cents(credit.amountCents), 0)
  return Math.max(0, cents(order.totals?.itemsCents) - cents(order.totals?.discountCents) - tenders)
}

/** `order.paid`: points for the buyer, and the referral reward for whoever sent them. */
export async function earnForOrder(envelope: PluginDomainEventEnvelope<LoyaltyOrderPayload>): Promise<void> {
  const order = envelope.payload?.order
  if (!order || !isDocumentId(order.id)) return
  const store = await resolveLoyaltyStore(envelope.hostId)
  if (!store) return
  const { program, site } = store
  const scope = { orgId: site.orgId, hostId: envelope.hostId }
  const email = normalizeLoyaltyEmail(order.customerEmail)
  const referral = loyaltyCredits(order)
    .map((credit) => parseLoyaltyReference(credit.reference))
    .find((parsed): parsed is { kind: 'referral'; referrerKey: string; refereeKey: string } => parsed?.kind === 'referral')
  // A program switched off earns nothing new; a friend already given their
  // credit under it still earns their referrer the reward they were promised.
  if (!program.enabled && !referral) return
  const points = program.enabled ? earnedPoints(earnBasisCents(order), program) : 0
  const nowMs = Date.now()

  const outcome = await loyaltyDb().runTransaction(async (transaction: any) => {
    const earnRef = loyaltyRefs.ledger(scope.orgId, scope.hostId, `earn__${order.id}`)
    const referralRef = loyaltyRefs.ledger(scope.orgId, scope.hostId, `referral__${order.id}`)
    const [earnSnapshot, referralSnapshot] = await Promise.all([transaction.get(earnRef), transaction.get(referralRef)])
    const plan = program.enabled && email && !earnSnapshot.exists
      ? await readMemberForWrite(transaction, scope, { email, name: order.customerName, nowMs })
      : null
    const referrerRef =
      referral && !referralSnapshot.exists && program.referrerRewardCents > 0
        ? loyaltyRefs.member(scope.orgId, scope.hostId, referral.referrerKey)
        : null
    const referrerSnapshot = referrerRef ? await transaction.get(referrerRef) : null

    let member: StoredLoyaltyMember | null = null
    let welcome = 0
    if (plan) {
      welcome = plan.created ? program.welcomePoints : 0
      member = {
        ...plan.member,
        name: plan.member.name ?? (order.customerName?.trim() ? order.customerName.trim().slice(0, 120) : null),
        points: plan.member.points + points + welcome,
        lifetimePoints: plan.member.lifetimePoints + points + welcome,
        ordersCount: plan.member.ordersCount + 1,
        lastOrderAtMs: nowMs,
        referredBy: plan.member.referredBy ?? (referral && referral.refereeKey === plan.memberKey ? referral.referrerKey : null),
        updatedAtMs: nowMs,
      }
      writeMember(transaction, { ...plan, member })
      writeLedger(transaction, scope, `earn__${order.id}`, {
        memberKey: plan.memberKey,
        kind: 'earn',
        points,
        creditCents: 0,
        orderId: order.id,
        channel: order.channel === 'pos' ? 'pos' : 'online',
        basisCents: earnBasisCents(order),
        reversedPoints: 0,
        atMs: nowMs,
      })
      if (welcome > 0) {
        writeLedger(transaction, scope, `welcome__${plan.memberKey}`, {
          memberKey: plan.memberKey,
          kind: 'welcome',
          points: welcome,
          creditCents: 0,
          orderId: order.id,
          atMs: nowMs,
        })
      }
    }

    let referrer: StoredLoyaltyMember | null = null
    if (referral && referrerRef && referrerSnapshot?.exists && referral.referrerKey !== referral.refereeKey) {
      const current = normalizeStoredMember(scope, referral.referrerKey, referrerSnapshot.data())
      referrer = { ...current, creditCents: current.creditCents + program.referrerRewardCents, updatedAtMs: nowMs }
      transaction.set(referrerRef, referrer)
      writeLedger(transaction, scope, `referral__${order.id}`, {
        memberKey: referral.referrerKey,
        kind: 'referral',
        points: 0,
        creditCents: program.referrerRewardCents,
        orderId: order.id,
        channel: order.channel === 'pos' ? 'pos' : 'online',
        note: 'A friend’s first order',
        atMs: nowMs,
      })
    }
    return { member, created: Boolean(plan?.created), earned: points + welcome, referrer }
  })

  if (!program.emails) return
  if (outcome.member && (outcome.earned > 0 || outcome.created)) {
    await sendLoyaltyEmail(
      pointsEarnedEmail({ hostId: envelope.hostId, org: site.org, member: outcome.member, program, earnedPoints: outcome.earned }),
    )
  }
  if (outcome.referrer) {
    await sendLoyaltyEmail(
      referralRewardEmail({
        hostId: envelope.hostId,
        org: site.org,
        member: outcome.referrer,
        program,
        amountCents: program.referrerRewardCents,
      }),
    )
  }
}

/**
 * `order.refunded` and `order.cancelled`: earned points come back off the
 * member, and rewards spent online come back to them, in proportion to the
 * money refunded — all of it for a cancellation or a whole refund. Rewards
 * spent at the register come back through the register's own refund, tender
 * by tender, except when the sale is canceled outright.
 */
export async function reverseForOrder(
  envelope: PluginDomainEventEnvelope<LoyaltyRefundPayload>,
  kind: 'refunded' | 'cancelled',
): Promise<void> {
  const order = envelope.payload?.order
  if (!order || !isDocumentId(order.id)) return
  const orgId = await resolveLoyaltyOrgId(envelope.hostId)
  if (!orgId) return
  const scope = { orgId, hostId: envelope.hostId }
  const full = kind === 'cancelled' || envelope.payload?.refund?.full === true || order.status === 'refunded'
  const share = { refundedCents: cents(order.refundedCents), paidCents: cents(order.totals?.totalCents), full }
  const nowMs = Date.now()

  await loyaltyDb().runTransaction(async (transaction: any) => {
    const earnRef = loyaltyRefs.ledger(scope.orgId, scope.hostId, `earn__${order.id}`)
    const earnSnapshot = await transaction.get(earnRef)
    if (!earnSnapshot.exists) return
    const earned = cents(earnSnapshot.get('points'))
    const reversed = cents(earnSnapshot.get('reversedPoints'))
    const target = cumulativeTarget(earned, share)
    if (target <= reversed) return
    const memberKey = String(earnSnapshot.get('memberKey') ?? '')
    const memberRef = loyaltyRefs.member(scope.orgId, scope.hostId, memberKey)
    const memberSnapshot = await transaction.get(memberRef)
    const delta = target - reversed
    if (memberSnapshot.exists) {
      const member = normalizeStoredMember(scope, memberKey, memberSnapshot.data())
      // A balance may go below zero: the points were spent before the refund.
      transaction.set(memberRef, { ...member, points: member.points - delta, updatedAtMs: nowMs })
    }
    transaction.set(earnRef, { ...earnSnapshot.data(), reversedPoints: target })
    writeLedger(transaction, scope, `reverse__${order.id}__${target}`, {
      memberKey,
      kind: 'reverse',
      points: -delta,
      creditCents: 0,
      orderId: order.id,
      note: kind === 'cancelled' ? 'Order canceled' : full ? 'Order refunded' : 'Part of the order refunded',
      atMs: nowMs,
    })
  })

  for (const credit of loyaltyCredits(order)) {
    if (credit.appliedAs === 'tender' && kind !== 'cancelled') continue
    const parsed = parseLoyaltyReference(credit.reference)
    if (parsed?.kind !== 'member') continue
    const snapshot = await loyaltyRefs.redemption(scope.orgId, scope.hostId, order.id, parsed.memberKey).get()
    if (!snapshot.exists) continue
    const redemption = normalizeRedemption({ ...scope, orderId: order.id, memberKey: parsed.memberKey }, snapshot.data())
    await restoreRedemptionTo({
      scope,
      orderId: order.id,
      memberKey: parsed.memberKey,
      targetCents: cumulativeTarget(redemption.cents, share),
      key: `event:${keyId(envelope.id)}`,
      nowMs,
    })
  }
}
