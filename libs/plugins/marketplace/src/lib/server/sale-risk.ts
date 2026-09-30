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

/*==========================================
 * A MARKETPLACE SALE'S FRAUD SHAPE (AGL-3365).
 *
 * Two questions the card network cannot answer, because both sides of the
 * sale are ours:
 *
 * 1. **Is the publisher paying itself?** A publisher that buys its own
 *    listing with stolen cards turns them into a payout. Checkout refuses a
 *    buyer who is a member of the publishing workspace; a second workspace
 *    that shares a member with it, or ONE card buying from one publisher for
 *    several workspaces, is the same actor one step removed.
 * 2. **Is the publisher brand new?** See `model/publisher-risk.ts`: its
 *    payouts are held, and a large sale files a signal while the share can
 *    still be reversed.
 *
 * What it does is what the seller-pattern ledger does: an urgent row in the
 * abuse queue, staff told once. NOTHING IS REFUNDED, REVERSED OR PAUSED
 * HERE — staff decide, with the young tier's payout delay holding the money
 * in reach while they do.
 *
 * Never throws: the sale it reads has already been recorded.
 *=========================================*/

import { createHash } from 'crypto'
import { ABUSE_REPORT_COLLECTION } from '@aglyn/aglyn/app-utils/abuse-report'
import { isSecurityClassLockdownReason, normalizeOrgLockdown } from '@aglyn/aglyn/app-utils/lockdown'
import {
  LOCKDOWN_BILLING_PAUSES_COLLECTION,
  lockdownPayoutPauseRecordId,
} from '@aglyn/aglyn/plugin-manager/plugin-org-lockdown'
import { firebaseAdmin, notifyRiskEvent, type RiskEventInput } from '@aglyn/tenant-data-admin'
import { orgAgeDays } from '@aglyn/tenant-data-admin/server/org-age'
import {
  describeSaleRiskSignals,
  isYoungPublisher,
  publisherPayoutDelayDays,
  type SaleRiskSignal,
  YOUNG_PUBLISHER_REVIEW_SALE_CENTS,
} from '../model/publisher-risk'

/** Members read per workspace when looking for a shared one. */
const MAX_MEMBERS_COMPARED = 200
/** Earlier purchases read when looking for the same card. */
const MAX_CARD_MATCHES = 20

/**
 * Whether `uid` is ANY member of `orgId` — not only a manager, which is all
 * `canActAsPublisher` asks. A publishing workspace's editor buying its
 * listing is the publisher buying it.
 */
export async function isOrgMember(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  uid: string,
): Promise<boolean> {
  if (!orgId || !uid) return false
  const member = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .doc(uid)
    .get()
  return member.exists
}

/**
 * Whether the publishing workspace is under a SECURITY lock (AGL-3365) — the
 * install and update doors hand nothing from it over. Security only: a
 * workspace locked over its own unpaid bill has not made its listings
 * dangerous, and a buyer who paid for one keeps installing it. (Checkout
 * refuses a sale to a workspace under ANY lock; that is money moving to it.)
 *
 * The shared normalizer reads the reason, so a lock written before reason
 * codes existed reads as `manual`, not security. One read of the org.
 */
export async function isPublisherSecurityLocked(
  firestore: FirebaseFirestore.Firestore,
  publisherOrgId: unknown,
): Promise<boolean> {
  const orgId = typeof publisherOrgId === 'string' ? publisherOrgId : ''
  if (!orgId) return false
  const org = (await firestore.collection('orgs').doc(orgId).get()).data()
  return isSecurityClassLockdownReason(
    normalizeOrgLockdown(org as Parameters<typeof normalizeOrgLockdown>[0])?.reason,
  )
}

async function memberUids(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<string[]> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .limit(MAX_MEMBERS_COMPARED)
    .get()
  return snapshot.docs.map((doc) => doc.id)
}

async function stripeRequest(
  path: string,
  stripeKey: string,
  params?: URLSearchParams,
): Promise<{ ok: boolean; body: any }> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(params ? { body: params.toString() } : {}),
  })
  const body = await response.json().catch(() => null)
  return { ok: response.ok, body }
}

/**
 * Put a publisher's connected account on the payout schedule its age calls
 * for (`publisherPayoutDelayDays`), and note it on the profile.
 *
 * Writes to Stripe only when the answer CHANGES what this code last set: a
 * young publisher is moved to the delay once, and moved back to the standard
 * schedule once when it ages out. An account this code never delayed is
 * never written — a schedule staff set by hand in the Dashboard is theirs.
 *
 * Never throws: onboarding and a sale must both go on if Stripe says no.
 */
export async function applyPublisherPayoutPolicy(input: {
  firestore: FirebaseFirestore.Firestore
  publisherOrgId: string
  ageDays: number | null
  stripeKey: string | undefined
  nowMs?: number
}): Promise<'applied' | 'current' | 'held-by-lock' | 'skipped' | 'failed'> {
  try {
    if (!input.stripeKey || !input.publisherOrgId) return 'skipped'
    const profileRef = input.firestore.collection('publisherProfiles').doc(input.publisherOrgId)
    const profile = await profileRef.get()
    const accountId = String(profile.get('stripeAccountId') ?? '')
    if (!accountId) return 'skipped'
    // A workspace lock holds this account's payouts (AGL-3364/3365): its
    // schedule is manual and the lock saved the one to restore. Moving it
    // now would either undo the pause or leave the lift restoring a delay
    // this record no longer describes, so it waits. The next sale after the
    // lift sets it right.
    const lockHold = await input.firestore
      .collection(LOCKDOWN_BILLING_PAUSES_COLLECTION)
      .doc(lockdownPayoutPauseRecordId(accountId))
      .get()
    if (lockHold.exists) return 'held-by-lock'
    const desired = publisherPayoutDelayDays(input.ageDays)
    const stored = profile.get('payoutDelayDays') as number | null | undefined
    if (stored === desired) return 'current'
    // Never delayed by this code and not young: leave the account alone.
    if (stored === undefined && desired === null) return 'current'
    const result = await stripeRequest(
      `accounts/${encodeURIComponent(accountId)}`,
      input.stripeKey,
      new URLSearchParams({
        'settings[payouts][schedule][delay_days]': desired === null ? 'minimum' : String(desired),
      }),
    )
    if (!result.ok) {
      console.error('[marketplace] the payout schedule could not be set', {
        publisherOrgId: input.publisherOrgId,
        error: result.body?.error?.message,
      })
      return 'failed'
    }
    await profileRef.set(
      { payoutDelayDays: desired, payoutPolicyAtMs: input.nowMs ?? Date.now() },
      { merge: true },
    )
    await notifyPublisherPayoutSchedule(input.publisherOrgId, desired !== null)
    return 'applied'
  } catch (error) {
    console.error('[marketplace] the payout schedule could not be set', error)
    return 'failed'
  }
}

/** The card that paid a payment intent, as Stripe fingerprints it, or null. */
async function cardFingerprintOf(
  paymentIntentId: string,
  stripeKey: string,
): Promise<string | null> {
  const result = await stripeRequest(
    `payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge`,
    stripeKey,
  )
  const fingerprint = result.body?.latest_charge?.payment_method_details?.card?.fingerprint
  return result.ok && typeof fingerprint === 'string' && fingerprint ? fingerprint : null
}

/**
 * Tell staff and the publisher's owners and admins that a sale was flagged
 * (AGL-3365), once per row, through the risk notice seam (AGL-3368). Staff
 * get the shapes that flagged it and the row; the publisher gets the
 * catalog's `marketplace-sale-review` words — the outcome and the way to
 * talk to us, never which shape flagged it, which would teach the actor it
 * describes how to avoid it. Never throws.
 */
export async function notifySaleRisk(
  notifyRisk: (input: RiskEventInput) => Promise<unknown>,
  flagged: {
    publisherOrgId: string
    reviewId: string
    reference: string
    signals: readonly SaleRiskSignal[]
    amountCents: number
    paymentIntentId: string
    livemode: boolean
  },
): Promise<void> {
  await notifyRisk({
    kind: 'marketplace-sale-review',
    orgId: flagged.publisherOrgId,
    reviewId: flagged.reviewId,
    reference: flagged.reference,
    item: { label: 'a recent marketplace sale', path: '/org/marketplace/payouts' },
    amount: `$${(flagged.amountCents / 100).toFixed(2)}`,
    stripeUrl: flagged.paymentIntentId
      ? `https://dashboard.stripe.com/${flagged.livemode ? '' : 'test/'}payments/${encodeURIComponent(flagged.paymentIntentId)}`
      : null,
    staffEvidence: describeSaleRiskSignals(flagged.signals).join(' '),
  }).catch(() => undefined)
}

/**
 * Tell the publisher's owners and admins their payout timing changed
 * (AGL-3365) — when a hold starts, and when it ends — through the risk
 * notice seam (AGL-3368). Never the rule that set it. Never throws.
 */
export async function notifyPublisherPayoutSchedule(
  publisherOrgId: string,
  held: boolean,
  notifyRisk: (input: RiskEventInput) => Promise<unknown> = notifyRiskEvent,
): Promise<void> {
  await notifyRisk({
    kind: held ? 'publisher-payouts-held' : 'publisher-payouts-standard',
    orgId: publisherOrgId,
    item: { label: 'your marketplace payouts', path: '/org/marketplace/payouts' },
  }).catch(() => undefined)
}

/** The sale-risk row's id: one per sale. */
export function saleRiskReviewId(sessionId: string): string {
  return createHash('sha256').update(`marketplace-sale-risk:${sessionId}`).digest('hex').slice(0, 40)
}

/**
 * Read one recorded sale for the fraud shapes above, hold a young
 * publisher's payouts, and file a staff row when anything is found.
 */
export async function screenMarketplaceSale(
  input: {
    purchaseRef: FirebaseFirestore.DocumentReference
    sessionId: string
    buyerUid: string
    buyerOrgId: string | null
    sellerOrgId: string
    amountCents: number
    paymentIntentId: string
    livemode: boolean
  },
  deps: {
    firestore?: FirebaseFirestore.Firestore
    stripeKey?: string
    notifyRisk: (input: RiskEventInput) => Promise<unknown>
    nowMs?: number
  },
): Promise<{ signals: SaleRiskSignal[]; filed: string | null }> {
  const nowMs = deps.nowMs ?? Date.now()
  const signals: SaleRiskSignal[] = []
  try {
    const firestore = deps.firestore ?? firebaseAdmin.app().firestore()
    const sellerOrg = (await firestore.collection('orgs').doc(input.sellerOrgId).get()).data() ?? {}
    const ageDays = orgAgeDays((sellerOrg as { createdAt?: unknown }).createdAt, nowMs)

    // 1. A young publisher: hold its payouts; a large sale is a signal.
    await applyPublisherPayoutPolicy({
      firestore,
      publisherOrgId: input.sellerOrgId,
      ageDays,
      stripeKey: deps.stripeKey,
      nowMs,
    })
    if (isYoungPublisher(ageDays) && input.amountCents >= YOUNG_PUBLISHER_REVIEW_SALE_CENTS) {
      signals.push({
        code: 'young-publisher-large-sale',
        ageDays: ageDays as number,
        amountCents: input.amountCents,
      })
    }

    // 2. A member in both workspaces — the buyer themself included.
    const sellerMembers = new Set(await memberUids(firestore, input.sellerOrgId))
    const buyerSide = new Set([
      input.buyerUid,
      ...(input.buyerOrgId && input.buyerOrgId !== input.sellerOrgId
        ? await memberUids(firestore, input.buyerOrgId)
        : []),
    ])
    const shared = [...buyerSide].filter((uid) => uid && sellerMembers.has(uid)).sort()
    if (shared.length || (input.buyerOrgId && input.buyerOrgId === input.sellerOrgId)) {
      signals.push({ code: 'shared-member', uids: shared })
    }

    // 3. One card, several buyer workspaces, one publisher.
    if (deps.stripeKey && input.paymentIntentId) {
      const fingerprint = await cardFingerprintOf(input.paymentIntentId, deps.stripeKey)
      if (fingerprint) {
        await input.purchaseRef.set({ cardFingerprint: fingerprint }, { merge: true })
        const matches = await firestore
          .collection('marketplacePurchases')
          .where('sellerOrgId', '==', input.sellerOrgId)
          .where('cardFingerprint', '==', fingerprint)
          .limit(MAX_CARD_MATCHES)
          .get()
        const others = [
          ...new Set(
            matches.docs
              .map((doc) => String(doc.get('buyerOrgId') ?? ''))
              .filter((orgId) => orgId && orgId !== (input.buyerOrgId ?? '')),
          ),
        ].sort()
        if (others.length) {
          signals.push({ code: 'card-reused-across-buyers', otherBuyerOrgIds: others })
        }
      }
    }

    if (!signals.length) return { signals, filed: null }

    const reviewId = saleRiskReviewId(input.sessionId)
    const reference = `MR-${reviewId.slice(0, 10).toUpperCase()}`
    const ref = firestore.collection(ABUSE_REPORT_COLLECTION).doc(reviewId)
    const first = !(await ref.get()).exists
    await ref.set(
      {
        reference,
        category: 'phishing',
        severity: 'urgent',
        source: 'marketplace-sale-risk',
        url: null,
        reportedHostname: null,
        hostId: null,
        orgId: input.sellerOrgId,
        details: [
          `A marketplace sale (checkout ${input.sessionId}, payment ${input.paymentIntentId || 'unknown'}) ` +
            `paid publisher workspace ${input.sellerOrgId} $${(input.amountCents / 100).toFixed(2)} ` +
            `from buyer ${input.buyerUid}${input.buyerOrgId ? ` for workspace ${input.buyerOrgId}` : ''}` +
            (input.livemode ? '' : ' — TEST MODE') +
            '.',
          ...describeSaleRiskSignals(signals),
          'A publisher buying its own listings with stolen cards, to cash them out as payouts, leaves this shape.',
          'Nothing has been refunded, reversed or paused. If it is the publisher, lock its workspace and ' +
            "refund the sale (the refund takes the publisher's share back), then close this row with what you did.",
        ]
          .join('\n')
          .slice(0, 5000),
        reporterEmail: null,
        reporterName: null,
        dmca: null,
        reportCount: 1,
        saleRisk: {
          sessionId: input.sessionId,
          paymentIntentId: input.paymentIntentId || null,
          sellerOrgId: input.sellerOrgId,
          buyerOrgId: input.buyerOrgId,
          buyerUid: input.buyerUid,
          amountCents: input.amountCents,
          signals,
          livemode: input.livemode,
        },
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        ...(first
          ? { status: 'open', createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp() }
          : {}),
      },
      { merge: true },
    )
    if (first) {
      await notifySaleRisk(deps.notifyRisk, {
        publisherOrgId: input.sellerOrgId,
        reviewId,
        reference,
        signals,
        amountCents: input.amountCents,
        paymentIntentId: input.paymentIntentId,
        livemode: input.livemode,
      })
    }
    return { signals, filed: reference }
  } catch (error) {
    console.error('[marketplace] a sale could not be screened', error)
    return { signals, filed: null }
  }
}
