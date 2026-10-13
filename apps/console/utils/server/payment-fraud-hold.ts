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
 * PLACING THE PAYMENT-FRAUD HOLD (AGL-3767).
 *
 * The billing webhook decides that Stripe flagged a workspace's OWN payment
 * (`@aglyn/tenant-data-admin/server/payment-fraud-hold` says how); this
 * places the hold through the same cores the staff panic button uses —
 * `applyOrgLockdown`, `applyHostLockdown`, `sendLockdownOwnerNotice`,
 * `cancelOrgSubscriptions` — so it revokes sessions, evicts the tenant cache,
 * rotates download URLs and writes `adminAudit` exactly as a staff
 * `security` lock does. Every audit row names
 * {@link PAYMENT_FRAUD_HOLD_ACTOR_UID}.
 *
 *  - the WORKSPACE and EACH SITE: `security`, `full`, `takedown`;
 *  - the owners are NOT emailed — the notice is recorded on the console only.
 *    A card tester learns nothing from us that would tell it which card to
 *    try next;
 *  - every subscription canceled now, no proration, no final invoice, no
 *    refund — the staff lock's "Cancel subscriptions" box, ticked;
 *  - ONE abuse-queue row with the evidence, and ONE operator alert per
 *    workspace per window.
 *
 * Never `abuse`, never the house workspace, never one a staff account owns.
 * A workspace 14+ days old, or one that has paid an invoice with another
 * charge, gets the row and the alert and no lock. A target already locked is
 * left exactly as it was set — a ban staff placed is never softened to a
 * hold.
 *
 * AND THE CHARGEBACK HEADED OFF (Zach, 2026-10-13). An issuer's early fraud
 * warning on a workspace's own charge that Stripe marks `actionable` is
 * refunded in full (`reason: fraudulent`) before it can become a dispute —
 * a fully refunded charge cannot then be disputed for fraud, and every
 * dispute counts against the platform account's dispute rate — and the
 * workspace's subscriptions are canceled with it. Only Aglyn's own charge:
 * one that paid a connected account is a seller's sale and is never
 * refunded here.
 *=========================================*/

import { runOrgLockdownParticipants } from '@aglyn/aglyn/plugin-manager/plugin-org-lockdown'
import { ABUSE_REPORT_COLLECTION } from '@aglyn/aglyn/app-utils/abuse-report'
import {
  findUserByUidAcrossPools,
  notifyRiskEvent,
  raiseOperatorAlert,
} from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { orgAgeDays } from '@aglyn/tenant-data-admin/server/org-age'
import { isHouseWorkspace } from '@aglyn/tenant-data-admin/server/page-security-hold'
import {
  claimPaymentFraudHold,
  hasPaidOtherInvoice,
  PAYMENT_FRAUD_HOLD_ACTOR_UID,
  PAYMENT_FRAUD_HOLD_LOCK_REASON,
  PAYMENT_FRAUD_HOLD_TRIGGER_LABELS,
  type PaymentFraudChargeEvidence,
  type PaymentFraudHoldTrigger,
  paymentFraudHoldGuard,
  settlePaymentFraudHold,
} from '@aglyn/tenant-data-admin/server/payment-fraud-hold'
import {
  type PaymentFraudSignal,
  paymentFraudSignalReference,
  staffSubscriptionCardPath,
  type WorkspaceSignalResponder,
} from '@aglyn/tenant-data-admin/server/payment-fraud-signal'
import { createHash } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { lockdownNoticeReference, sendLockdownOwnerNotice } from './lockdown-owner-notice'
import { applyHostLockdown, applyOrgLockdown } from './org-lockdown'
import {
  auditOrgSubscriptionCancel,
  cancellationComment,
  cancelOrgSubscriptions,
} from './org-subscription-cancel'

type AdminFirestore = FirebaseFirestore.Firestore

const LOCK = {
  reason: PAYMENT_FRAUD_HOLD_LOCK_REASON,
  mode: 'full' as const,
  enforcement: 'takedown' as const,
}

/** One step the hold took, or why it did not. */
export interface PaymentFraudHoldStep {
  scope: 'org' | 'host' | 'billing'
  targetId: string
  outcome: 'locked' | 'already-locked' | 'canceled' | 'failed' | 'skipped'
  detail?: string
}

/** What asking for a hold did. */
export interface PaymentFraudHoldResult {
  orgId: string
  /**
   * - `held` — locks placed (some may report `already-locked`);
   * - `alert-only` — a guard kept the locks off; the row and alert stand;
   * - `skipped` — never held (house, staff-owned, gone); nothing raised;
   * - `already` — a hold or alert for this window exists; nothing new done.
   */
  outcome: 'held' | 'alert-only' | 'skipped' | 'already'
  reason: string | null
  reviewId: string | null
  steps: PaymentFraudHoldStep[]
  alert: string | null
}

/** The row a hold files when no signal row exists: one per workspace. */
export function paymentFraudHoldReviewId(orgId: string): string {
  return createHash('sha256').update(`stripe-fraud-hold:${orgId}`).digest('hex').slice(0, 40)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const unique = (values: ReadonlyArray<string | null | undefined>): string[] => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
]

/** The evidence, in the words staff read. */
export function describeHoldEvidence(charges: readonly PaymentFraudChargeEvidence[]): string {
  return charges
    .map(
      (charge) =>
        `• ${charge.chargeId}` +
        ` · ${charge.cardBrand ?? 'card'}${charge.last4 ? ` …${charge.last4}` : ''}` +
        ` issued in ${charge.cardCountry ?? 'unknown'}` +
        ` · fingerprint ${charge.fingerprint ?? 'unknown'}` +
        ` · ${charge.outcomeType ?? 'outcome unknown'}` +
        (charge.riskLevel ? `, risk ${charge.riskLevel}` : '') +
        (charge.stripeReport ? `, Stripe report ${charge.stripeReport}` : '') +
        (charge.failureCode ? `, ${charge.failureCode}` : '') +
        (charge.postalCheck ? `, postal check ${charge.postalCheck}` : ''),
    )
    .join('\n')
}

/** The plugins' part in a workspace lock (AGL-3365). Never throws. */
async function orgLockParticipants(orgId: string): Promise<void> {
  try {
    const { serverPluginLoader } = await import('../server-plugin-loader')
    await serverPluginLoader.ensureAll(['consoleApi'])
    await runOrgLockdownParticipants({ orgId, locked: true, reason: PAYMENT_FRAUD_HOLD_LOCK_REASON })
  } catch (error) {
    console.error('[payment-fraud-hold] org lock participants failed', orgId, error)
  }
}

async function staffAccount(uid: string | null): Promise<boolean> {
  if (!uid) return false
  const found = await findUserByUidAcrossPools(uid)
  return found?.record.customClaims?.['staff'] === true
}

/** Cancel every subscription now, no proration, no final invoice, and audit it. Never throws. */
export async function cancelWorkspaceBillingForFraud(
  firestore: AdminFirestore,
  orgId: string,
  why: string,
): Promise<PaymentFraudHoldStep> {
  try {
    const result = await cancelOrgSubscriptions({
      orgId,
      when: 'now',
      comment: cancellationComment({
        reason: PAYMENT_FRAUD_HOLD_LOCK_REASON,
        note: why,
        actorUid: PAYMENT_FRAUD_HOLD_ACTOR_UID,
        via: 'lockdown',
      }),
    })
    await auditOrgSubscriptionCancel(firestore, {
      actorUid: PAYMENT_FRAUD_HOLD_ACTOR_UID,
      reason: PAYMENT_FRAUD_HOLD_LOCK_REASON,
      note: why,
      via: 'lockdown',
      result,
    }).catch((error: unknown) =>
      console.error('[payment-fraud-hold] cancel audit write failed', orgId, error),
    )
    return {
      scope: 'billing',
      targetId: orgId,
      outcome: result.confirmed ? 'canceled' : 'failed',
      detail: result.confirmed
        ? `${result.changed} subscription(s) canceled`
        : result.lookupErrors.join(' ') || 'A subscription did not read back as canceled.',
    }
  } catch (error) {
    return { scope: 'billing', targetId: orgId, outcome: 'failed', detail: String((error as Error)?.message ?? error) }
  }
}

async function auditLock(
  firestore: AdminFirestore,
  scope: 'org' | 'host',
  targetId: string,
  input: { trigger: PaymentFraudHoldTrigger; reviewId: string; reference: string; chargeIds: string[] },
  extra: Record<string, unknown>,
): Promise<void> {
  await addAdminAudit(firestore, {
    actorUid: PAYMENT_FRAUD_HOLD_ACTOR_UID,
    actorEmail: null,
    action: 'lockdown.lock',
    scope,
    target: scope === 'org' ? `orgs/${targetId}` : `hosts/${targetId}`,
    before: { locked: false, reason: null, message: null, untilMs: null, mode: 'full', enforcement: 'standard' },
    after: {
      locked: true,
      reason: PAYMENT_FRAUD_HOLD_LOCK_REASON,
      message: null,
      untilMs: null,
      mode: 'full',
      enforcement: 'takedown',
      automated: true,
      via: 'payment-fraud-hold',
      trigger: input.trigger,
      reviewId: input.reviewId,
      chargeIds: input.chargeIds,
      ...extra,
    },
    note: [
      `Automatic security hold for payment fraud (AGL-3767): ${PAYMENT_FRAUD_HOLD_TRIGGER_LABELS[input.trigger]}`,
      `on charge(s) ${input.chargeIds.join(', ') || 'not named'};`,
      `abuse row ${input.reviewId} (${input.reference}).`,
      `Notice reference ${lockdownNoticeReference(scope, targetId)}.`,
    ].join(' '),
    at: FieldValue.serverTimestamp(),
  })
}

/**
 * Ask for the workspace's payment-fraud hold. Claims it first, so a
 * redelivery or the next card in a burst does nothing; places the locks
 * unless a guard says alert only; files or extends the abuse row; raises one
 * alert. Never throws for a lock that fails — each is its own step — and
 * releases the claim if it throws anywhere else, so Stripe's retry runs it
 * again.
 */
export async function placePaymentFraudHold(input: {
  firestore: AdminFirestore
  orgId: string
  trigger: PaymentFraudHoldTrigger
  charges: readonly PaymentFraudChargeEvidence[]
  /** The signal row to extend; absent, the workspace's own hold row is filed. */
  reviewId?: string | null
  /** Subscriptions already canceled by the caller (an early fraud warning's refund). */
  billingAlreadyCanceled?: boolean
  livemode: boolean
  nowMs?: number
}): Promise<PaymentFraudHoldResult> {
  const { firestore, orgId, trigger } = input
  const nowMs = input.nowMs ?? Date.now()
  const steps: PaymentFraudHoldStep[] = []
  const claim = await claimPaymentFraudHold(firestore, orgId, trigger, nowMs)
  if (!claim.claimed) {
    return { orgId, outcome: 'already', reason: claim.reason, reviewId: null, steps, alert: null }
  }
  try {
    const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
    const org = (orgSnapshot.exists ? (orgSnapshot.data() ?? {}) : {}) as Record<string, unknown>
    const skip = async (reason: string): Promise<PaymentFraudHoldResult> => {
      await settlePaymentFraudHold(firestore, orgId, 'skipped', { outcome: { skipped: reason } }, nowMs)
      return { orgId, outcome: 'skipped', reason, reviewId: null, steps, alert: null }
    }
    if (!orgSnapshot.exists) return await skip('The workspace no longer exists.')
    if (isHouseWorkspace({ org })) return await skip('The house workspace is never held automatically.')
    if (await staffAccount(text(org['ownerUid']))) {
      return await skip('A staff account owns this workspace; it is never held automatically.')
    }

    const chargeIds = unique(input.charges.map((charge) => charge.chargeId))
    const paymentIntentIds = unique(input.charges.map((charge) => charge.paymentIntentId))
    const ageDays = orgAgeDays(org['createdAt'], nowMs)
    const hasPaidInvoice = await hasPaidOtherInvoice(firestore, orgId, { chargeIds, paymentIntentIds })
    const guard = paymentFraudHoldGuard({ ageDays, hasPaidInvoice })

    const reviewId = input.reviewId ?? paymentFraudHoldReviewId(orgId)
    const reference = paymentFraudSignalReference(reviewId)
    const audit = { trigger, reviewId, reference, chargeIds }

    if (guard.lock) {
      // 1. The workspace.
      if (orgSnapshot.get('suspendedAt') != null) {
        steps.push({ scope: 'org', targetId: orgId, outcome: 'already-locked' })
      } else {
        try {
          const result = await applyOrgLockdown({
            firestore,
            orgId,
            action: 'lock',
            lock: LOCK,
            revokeMemberTokens: true,
          })
          await auditLock(firestore, 'org', orgId, audit, { tokensRevoked: result.tokensRevoked })
          await orgLockParticipants(orgId)
          // Recorded on the console, never mailed (owner email OFF).
          await sendLockdownOwnerNotice({
            firestore,
            notifyRisk: notifyRiskEvent,
            action: 'lock',
            scope: 'org',
            targetId: orgId,
            emailOwners: false,
            lock: LOCK,
            effects: { sessionsRevoked: result.tokensRevoked > 0 },
          })
          steps.push({ scope: 'org', targetId: orgId, outcome: 'locked' })
        } catch (error) {
          steps.push({ scope: 'org', targetId: orgId, outcome: 'failed', detail: String((error as Error)?.message ?? error) })
        }
      }
      // 2. Its billing: canceled now, no proration, no final invoice, no refund.
      steps.push(
        input.billingAlreadyCanceled
          ? { scope: 'billing', targetId: orgId, outcome: 'skipped', detail: 'Canceled with the early fraud warning refund.' }
          : await cancelWorkspaceBillingForFraud(firestore, orgId, PAYMENT_FRAUD_HOLD_TRIGGER_LABELS[trigger]),
      )
      // 3. Each site, as a takedown.
      for (const hostId of Object.keys((org['hosts'] ?? {}) as Record<string, unknown>)) {
        try {
          const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
          if (!hostSnapshot.exists) {
            steps.push({ scope: 'host', targetId: hostId, outcome: 'skipped', detail: 'The site no longer exists.' })
            continue
          }
          if (hostSnapshot.get('suspendedAt') != null) {
            steps.push({ scope: 'host', targetId: hostId, outcome: 'already-locked' })
            continue
          }
          await applyHostLockdown({ firestore, hostId, action: 'lock', lock: LOCK })
          await auditLock(firestore, 'host', hostId, audit, {})
          await sendLockdownOwnerNotice({
            firestore,
            notifyRisk: notifyRiskEvent,
            action: 'lock',
            scope: 'host',
            targetId: hostId,
            emailOwners: false,
            lock: LOCK,
          })
          steps.push({ scope: 'host', targetId: hostId, outcome: 'locked' })
        } catch (error) {
          steps.push({ scope: 'host', targetId: hostId, outcome: 'failed', detail: String((error as Error)?.message ?? error) })
        }
      }
    }

    // The row: the signal's row extended, or the workspace's own hold row.
    const evidence = {
      trigger,
      triggerLabel: PAYMENT_FRAUD_HOLD_TRIGGER_LABELS[trigger],
      chargeIds,
      riskLevels: unique(input.charges.map((charge) => charge.riskLevel)),
      cardCountries: unique(input.charges.map((charge) => charge.cardCountry)),
      fingerprints: unique(input.charges.map((charge) => charge.fingerprint)),
      charges: input.charges.map((charge) => ({ ...charge })),
      outcome: guard.lock ? 'held' : 'alert-only',
      guard: guard.reason,
      ageDays,
      hasPaidInvoice,
      steps: steps.map((step) => ({ ...step })),
      atMs: nowMs,
    }
    const locked = steps.filter((step) => step.outcome === 'locked' || step.outcome === 'canceled')
    const summary = guard.lock
      ? `Automatic security hold (AGL-3767): ${PAYMENT_FRAUD_HOLD_TRIGGER_LABELS[trigger]}. The workspace and its sites are locked as security (takedown) and its subscriptions canceled; the owners were not emailed. Confirm it by re-placing the lock as abuse on Staff → Lockdown, or lift it there.`
      : `Not locked automatically (AGL-3767): ${guard.reason} ${PAYMENT_FRAUD_HOLD_TRIGGER_LABELS[trigger]} — decide on the org’s Subscription card and Staff → Lockdown.`
    const rowRef = firestore.collection(ABUSE_REPORT_COLLECTION).doc(reviewId)
    if (input.reviewId) {
      await rowRef.set(
        {
          paymentFraudHold: evidence,
          ...(guard.lock ? { securityHold: { orgId, locks: evidence.steps, appliedAtMs: nowMs } } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    } else {
      const existing = await rowRef.get()
      await rowRef.set(
        {
          reference,
          // "Phishing or fraud" — the queue's urgent fraud category.
          category: 'phishing',
          severity: 'urgent',
          source: 'stripe-payment-fraud-hold',
          url: null,
          reportedHostname: null,
          hostId: null,
          orgId,
          details: [
            `${PAYMENT_FRAUD_HOLD_TRIGGER_LABELS[trigger]} on workspace ${orgId}'s own subscription payment` +
              (input.livemode ? '' : ' — TEST MODE') +
              '.',
            describeHoldEvidence(input.charges),
            summary,
          ]
            .join('\n')
            .slice(0, 5000),
          reporterEmail: null,
          reporterName: null,
          dmca: null,
          reportCount: input.charges.length || 1,
          paymentFraudHold: evidence,
          paymentSignal: { subscriptionCard: staffSubscriptionCardPath(orgId), livemode: input.livemode },
          ...(guard.lock ? { securityHold: { orgId, locks: evidence.steps, appliedAtMs: nowMs } } : {}),
          updatedAt: FieldValue.serverTimestamp(),
          ...(existing.exists ? {} : { status: 'open', createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      )
    }

    const alert = await raiseOperatorAlert('security.paymentFraudHold', {
      dedupeKey: orgId,
      orgId,
      context: {
        orgName: text(org['name']) ?? orgId,
        orgId,
        trigger: PAYMENT_FRAUD_HOLD_TRIGGER_LABELS[trigger],
        action: guard.lock ? 'Security hold placed' : 'Not locked — needs a decision',
        locks: guard.lock
          ? locked.length
            ? locked.map((step) => `${step.scope} ${step.targetId}`).join(', ')
            : 'nothing new — every target was already locked'
          : `nothing: ${guard.reason}`,
        charges: chargeIds.join(', ') || 'not named',
        cardCountries: evidence.cardCountries.join(', ') || 'unknown',
        cards: String(evidence.fingerprints.length || chargeIds.length),
        reference,
        reviewId,
      },
    })
    await settlePaymentFraudHold(
      firestore,
      orgId,
      guard.lock ? 'held' : 'alerted',
      { reviewId, outcome: { steps: evidence.steps, guard: guard.reason, alert: alert.outcome } },
      nowMs,
    )
    return {
      orgId,
      outcome: guard.lock ? 'held' : 'alert-only',
      reason: guard.reason,
      reviewId,
      steps,
      alert: alert.outcome,
    }
  } catch (error) {
    // Release the claim so Stripe's retry runs the hold again; every lock
    // above is already-locked-aware, so a rerun never doubles one.
    await settlePaymentFraudHold(firestore, orgId, 'watching', {}, nowMs).catch(() => undefined)
    throw error
  }
}

/*==========================================
 * AN EARLY FRAUD WARNING, REFUNDED BEFORE IT IS A DISPUTE.
 *=========================================*/

/** What the refund step did. */
export interface EarlyFraudWarningRefund {
  outcome:
    | 'refunded'
    | 'not-actionable'
    | 'already-refunded'
    | 'disputed'
    | 'connected-account'
    | 'not-configured'
    | 'failed'
  refundId: string | null
  amountCents: number | null
  detail: string | null
}

/** The Stripe idempotency key for one warning's refund: one refund per warning, ever. */
export function earlyFraudWarningRefundKey(efwId: string): string {
  return `efw-refund-${efwId}`
}

/**
 * Refund the charge an actionable early fraud warning names, in full, as
 * `fraudulent`. Re-reads the charge first and refuses one already refunded,
 * already disputed, or that paid a connected account. The idempotency key is
 * the warning's, so a redelivery that races past every check still makes
 * one refund. Never throws.
 */
export async function refundEarlyFraudWarningCharge(input: {
  efwId: string
  chargeId: string
  actionable: boolean
  /** `event.account` — set when the event came from a connected account. */
  connectAccount: string | null
  secretKey?: string | null
  fetchImpl?: typeof fetch
}): Promise<EarlyFraudWarningRefund> {
  const none = { refundId: null, amountCents: null, detail: null }
  if (!input.actionable) return { ...none, outcome: 'not-actionable' }
  if (input.connectAccount) return { ...none, outcome: 'connected-account' }
  const secretKey = input.secretKey ?? process.env['STRIPE_SECRET_KEY'] ?? ''
  if (!secretKey || !input.chargeId) return { ...none, outcome: 'not-configured' }
  const call = input.fetchImpl ?? fetch
  try {
    const read = await call(`https://api.stripe.com/v1/charges/${encodeURIComponent(input.chargeId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    const charge = (await read.json().catch(() => ({}))) as Record<string, any>
    if (!read.ok) {
      return { ...none, outcome: 'failed', detail: charge?.['error']?.['message'] ?? `HTTP ${read.status}` }
    }
    const amount = Number(charge['amount']) || 0
    const refunded = Number(charge['amount_refunded']) || 0
    if (charge['refunded'] === true || (amount > 0 && refunded >= amount)) {
      return { ...none, outcome: 'already-refunded', amountCents: refunded }
    }
    if (charge['disputed'] === true) return { ...none, outcome: 'disputed' }
    // Every sale Aglyn takes for a site is a destination charge (AGL-1956):
    // a transfer to the seller, usually with the platform fee beside it.
    if (charge['transfer_data']?.['destination'] || charge['application_fee_amount']) {
      return { ...none, outcome: 'connected-account' }
    }
    const response = await call('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': earlyFraudWarningRefundKey(input.efwId),
      },
      body: new URLSearchParams({
        charge: input.chargeId,
        reason: 'fraudulent',
        'metadata[early_fraud_warning]': input.efwId,
        'metadata[aglyn_actor]': PAYMENT_FRAUD_HOLD_ACTOR_UID,
      }).toString(),
    })
    const refund = (await response.json().catch(() => ({}))) as Record<string, any>
    if (!response.ok) {
      return { ...none, outcome: 'failed', detail: refund?.['error']?.['message'] ?? `HTTP ${response.status}` }
    }
    return {
      outcome: 'refunded',
      refundId: text(refund['id']),
      amountCents: Number.isFinite(Number(refund['amount'])) ? Number(refund['amount']) : amount - refunded,
      detail: null,
    }
  } catch (error) {
    return { ...none, outcome: 'failed', detail: String((error as Error)?.message ?? error) }
  }
}

/** A fraud signal's charge, as hold evidence. */
function signalChargeEvidence(signal: PaymentFraudSignal, nowMs: number): PaymentFraudChargeEvidence {
  return {
    chargeId: signal.chargeId ?? signal.paymentIntentId ?? signal.stripeObjectId,
    paymentIntentId: signal.paymentIntentId,
    invoiceId: null,
    fingerprint: null,
    cardCountry: signal.checks?.cardCountry ?? null,
    cardBrand: null,
    last4: null,
    outcomeType: null,
    outcomeReason: null,
    riskLevel: signal.checks?.riskLevel ?? null,
    riskScore: null,
    stripeReport: null,
    failureCode: null,
    declineCode: null,
    postalCheck: signal.checks?.addressPostalCodeCheck ?? null,
    cvcCheck: signal.checks?.cvcCheck ?? null,
    amountCents: signal.amountCents,
    currency: signal.currency,
    atMs: nowMs,
  }
}

/**
 * The responder `recordPaymentFraudSignal` calls for a NEW early fraud
 * warning or Radar review on a workspace's own charge: refund an actionable
 * warning and cancel the subscriptions, then ask for the hold.
 */
export function workspaceFraudSignalResponder(input: {
  firestore: AdminFirestore
  /** The warning's `actionable` flag; absent for a review. */
  actionable: boolean
  connectAccount: string | null
  /** The charge paid a connected account (a seller's sale). */
  sellerAccountId: string | null
  nowMs?: number
}): WorkspaceSignalResponder {
  return async ({ signal, reviewId }) => {
    if (!signal.orgId) return null
    const nowMs = input.nowMs ?? Date.now()
    const lines: string[] = []
    const record: Record<string, unknown> = {}
    let billingAlreadyCanceled = false
    if (signal.kind === 'early-fraud-warning' && signal.chargeId && !input.sellerAccountId) {
      const refund = await refundEarlyFraudWarningCharge({
        efwId: signal.stripeObjectId,
        chargeId: signal.chargeId,
        actionable: input.actionable,
        connectAccount: input.connectAccount,
      })
      record['refund'] = { ...refund }
      if (refund.outcome === 'refunded') {
        lines.push(
          `Refunded in full as fraudulent (${refund.refundId ?? 'refund id not returned'}) to head off the chargeback.`,
        )
        const cancel = await cancelWorkspaceBillingForFraud(input.firestore, signal.orgId, 'Early fraud warning refunded')
        record['subscriptionCancel'] = { ...cancel }
        billingAlreadyCanceled = cancel.outcome === 'canceled'
        lines.push(
          cancel.outcome === 'canceled'
            ? 'Its subscriptions were canceled now, no proration and no final invoice.'
            : `Canceling its subscriptions did not confirm: ${cancel.detail ?? 'unknown'}. Cancel them on the Subscription card.`,
        )
      } else {
        lines.push(
          refund.outcome === 'not-actionable'
            ? 'Not refunded: Stripe marked the warning not actionable (already refunded or disputed upstream).'
            : refund.outcome === 'already-refunded'
              ? 'Not refunded again: the charge was already refunded.'
              : refund.outcome === 'disputed'
                ? 'Not refunded: the charge is already disputed — answer the dispute in Stripe.'
                : refund.outcome === 'connected-account'
                  ? 'Not refunded: the charge paid a connected account.'
                  : `The refund did not run (${refund.outcome}${refund.detail ? `: ${refund.detail}` : ''}). Refund it in Stripe before it becomes a dispute.`,
        )
      }
    }
    const hold = await placePaymentFraudHold({
      firestore: input.firestore,
      orgId: signal.orgId,
      trigger: signal.kind === 'early-fraud-warning' ? 'early-fraud-warning' : 'radar-review',
      charges: [signalChargeEvidence(signal, nowMs)],
      reviewId,
      billingAlreadyCanceled,
      livemode: signal.livemode,
      nowMs,
    })
    record['hold'] = { outcome: hold.outcome, reason: hold.reason, steps: hold.steps, alert: hold.alert }
    lines.push(
      hold.outcome === 'held'
        ? 'Automatic security hold placed: the workspace and its sites are locked as security (takedown). Re-place it as abuse on Staff → Lockdown, or lift it there.'
        : hold.outcome === 'alert-only'
          ? `Not locked automatically: ${hold.reason}`
          : hold.outcome === 'already'
            ? `No second hold: ${hold.reason === 'held' ? 'the workspace is already held' : 'one was raised for this workspace in this window'}.`
            : `Never held automatically: ${hold.reason}`,
    )
    return { summary: `Automated response (AGL-3767): ${lines.join(' ')}`, record }
  }
}
