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
 * STRIPE'S FRAUD SIGNALS, INTO THE ABUSE QUEUE (AGL-3356).
 *
 * The 9/26 incident paid for Pro with a card whose CVC check came back
 * unavailable and which never met 3-D Secure. Stripe had three ways to tell
 * us about a card like that — an early fraud warning from the issuer, a
 * Radar review, a dispute — and the platform webhook either did not
 * subscribe to them or filed them where nobody triages abuse.
 *
 * Each signal now files an urgent row in the abuse queue that names the
 * workspace, the charge and the amount, links the staff Subscription card
 * on the org page (AGL-3359, where billing is canceled), and notifies staff
 * once. NOTHING IS DONE TO THE MONEY OR THE SUBSCRIPTION: no refund, no
 * cancel. An early fraud warning is not a chargeback, a review may clear, and
 * a refund issued before staff look can be the wrong half of a dispute. The
 * row is the prompt; staff decide.
 *
 * Dependencies are passed in rather than imported — the Firestore handle the
 * webhook observes its writes through, and its staff notifier — so the
 * webhook's "did this delivery do anything" ledger sees the write, and a spec
 * substituting the admin barrel substitutes these too.
 *=========================================*/

import { createHash } from 'crypto'
import { ABUSE_REPORT_COLLECTION } from '@aglyn/aglyn/app-utils/abuse-report'
import { FieldValue } from 'firebase-admin/firestore'

/** Which Stripe signal this is. */
export type PaymentFraudSignalKind =
  | 'early-fraud-warning'
  | 'radar-review'
  | 'dispute'

const KIND_LABEL: Record<PaymentFraudSignalKind, string> = {
  'early-fraud-warning': 'Early fraud warning',
  'radar-review': 'Radar review opened',
  dispute: 'Card dispute opened',
}

/** The Stripe object type each signal arrives as, for the queue's text. */
export const PAYMENT_FRAUD_SIGNAL_LABELS = KIND_LABEL

/** What the card's own checks said, when the charge could be read. */
export interface PaymentFraudCardChecks {
  cvcCheck: string | null
  addressPostalCodeCheck: string | null
  cardCountry: string | null
  riskLevel: string | null
  threeDSecure: string | null
}

export interface PaymentFraudSignal {
  kind: PaymentFraudSignalKind
  /** The EFW, review or dispute id: one row per signal, whatever redelivers. */
  stripeObjectId: string
  chargeId: string | null
  paymentIntentId: string | null
  /** The workspace the charge billed, or null when it resolved to none. */
  orgId: string | null
  /** Smallest currency unit, or null when nothing recorded the amount. */
  amountCents: number | null
  currency: string
  /** `fraud_type`, the review's `reason`, the dispute's `reason`. */
  detail: string
  checks: PaymentFraudCardChecks | null
  livemode: boolean
}

/** The row id: hex, so the admin route's id pattern addresses it. */
export function paymentFraudSignalReviewId(
  kind: PaymentFraudSignalKind,
  stripeObjectId: string,
): string {
  return createHash('sha256')
    .update(`stripe-fraud:${kind}:${stripeObjectId}`)
    .digest('hex')
    .slice(0, 40)
}

/** The staff-facing reference, beside the intake's `AR-` and the screen's `HS-`. */
export function paymentFraudSignalReference(reviewId: string): string {
  return `PF-${reviewId.slice(0, 10).toUpperCase()}`
}

/** Where staff act on the workspace's billing: its Subscription card. */
export function staffSubscriptionCardPath(orgId: string): string {
  return `/admin/orgs/${encodeURIComponent(orgId)}#subscription`
}

/** `$56.00 USD`, or a sentence saying the amount is not known. */
export function formatSignalAmount(
  amountCents: number | null,
  currency: string,
): string {
  if (amountCents === null || !Number.isFinite(amountCents)) {
    return 'amount not recorded'
  }
  return `${(amountCents / 100).toFixed(2)} ${String(currency || 'usd').toUpperCase()}`
}

/**
 * The one-line summary of a charge Stripe gives back, for a signal whose
 * charge is not on a platform revenue row. A READ — the only Stripe call
 * this module makes — and it answers null rather than throwing, because a
 * fraud alert that fails for want of an amount is worse than one that says
 * the amount is unknown.
 */
export async function readStripeChargeForSignal(
  chargeId: string,
  options: { secretKey: string | undefined; fetchImpl?: typeof fetch },
): Promise<{
  amountCents: number | null
  currency: string
  customerId: string | null
  checks: PaymentFraudCardChecks
} | null> {
  if (!chargeId || !options.secretKey) return null
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `https://api.stripe.com/v1/charges/${encodeURIComponent(chargeId)}`,
      { headers: { Authorization: `Bearer ${options.secretKey}` } },
    )
    if (!response.ok) return null
    const charge = (await response.json()) as Record<string, any>
    const card = charge?.['payment_method_details']?.['card'] ?? {}
    const text = (value: unknown) =>
      typeof value === 'string' && value ? value : null
    return {
      amountCents: Number.isFinite(Number(charge?.['amount']))
        ? Number(charge['amount'])
        : null,
      currency: String(charge?.['currency'] ?? 'usd'),
      customerId: text(charge?.['customer']),
      checks: {
        cvcCheck: text(card?.['checks']?.['cvc_check']),
        addressPostalCodeCheck: text(card?.['checks']?.['address_postal_code_check']),
        cardCountry: text(card?.['country']),
        riskLevel: text(charge?.['outcome']?.['risk_level']),
        threeDSecure: text(card?.['three_d_secure']?.['result']),
      },
    }
  } catch {
    return null
  }
}

/** The row's prose: what arrived, about which workspace, and what to do. */
export function describePaymentFraudSignal(signal: PaymentFraudSignal): string {
  const lines = [
    `${KIND_LABEL[signal.kind]} from Stripe (${signal.stripeObjectId})` +
      (signal.livemode ? '' : ' — TEST MODE') +
      '.',
    `Workspace: ${signal.orgId ?? 'none — the charge did not resolve to a workspace subscription'}.`,
    `Charge: ${signal.chargeId ?? signal.paymentIntentId ?? 'not named'} · ${formatSignalAmount(signal.amountCents, signal.currency)}.`,
  ]
  if (signal.detail) lines.push(`Stripe says: ${signal.detail}.`)
  const checks = signal.checks
  if (checks) {
    lines.push(
      `Card: CVC ${checks.cvcCheck ?? 'unknown'}, postal code ${checks.addressPostalCodeCheck ?? 'unknown'}, ` +
        `issued in ${checks.cardCountry ?? 'unknown'}, 3DS ${checks.threeDSecure ?? 'not used'}, ` +
        `Radar risk ${checks.riskLevel ?? 'unknown'}.`,
    )
  }
  lines.push(
    signal.kind === 'radar-review'
      ? 'The payment waits in Stripe until the review is closed there.'
      : signal.kind === 'dispute'
        ? 'Answer the dispute in Stripe before its evidence deadline.'
        : 'An early fraud warning is not yet a chargeback; refunding now can avoid one.',
    'Nothing has been refunded or canceled. Decide on the org’s Subscription card, lock the workspace if it is fraud, and close this row with what you did.',
  )
  return lines.join('\n').slice(0, 5000)
}

/**
 * File one signal and tell staff, once per signal.
 *
 * Idempotent on the Stripe object id: a redelivery bumps `reportCount` and
 * leaves the row's status — which staff own from the moment they touch it —
 * where it was. Throws only if the row write throws, which is the webhook's
 * to answer; the notification never throws.
 */
export async function recordPaymentFraudSignal(
  signal: PaymentFraudSignal,
  deps: {
    firestore: FirebaseFirestore.Firestore
    notify: (payload: {
      type: 'system.abuseReportUrgent'
      title: string
      body: string
      link: string
    }) => Promise<void>
  },
): Promise<{ reviewId: string; reference: string; first: boolean }> {
  const reviewId = paymentFraudSignalReviewId(signal.kind, signal.stripeObjectId)
  const reference = paymentFraudSignalReference(reviewId)
  const ref = deps.firestore.collection(ABUSE_REPORT_COLLECTION).doc(reviewId)
  const first = !(await ref.get()).exists
  const subscriptionCard = signal.orgId
    ? staffSubscriptionCardPath(signal.orgId)
    : null
  await ref.set(
    {
      reference,
      // "Phishing or fraud" — the queue's urgent fraud category.
      category: 'phishing',
      severity: 'urgent',
      source: 'stripe-fraud-signal',
      url: null,
      reportedHostname: null,
      hostId: null,
      orgId: signal.orgId,
      details: describePaymentFraudSignal(signal),
      reporterEmail: null,
      reporterName: null,
      dmca: null,
      reportCount: FieldValue.increment(1),
      paymentSignal: {
        kind: signal.kind,
        stripeObjectId: signal.stripeObjectId,
        chargeId: signal.chargeId,
        paymentIntentId: signal.paymentIntentId,
        amountCents: signal.amountCents,
        currency: signal.currency,
        detail: signal.detail,
        checks: signal.checks,
        livemode: signal.livemode,
        subscriptionCard,
      },
      updatedAt: FieldValue.serverTimestamp(),
      ...(first
        ? { status: 'open', createdAt: FieldValue.serverTimestamp() }
        : {}),
    },
    { merge: true },
  )
  if (first) {
    await deps
      .notify({
        type: 'system.abuseReportUrgent',
        title: `${KIND_LABEL[signal.kind]} — ${formatSignalAmount(signal.amountCents, signal.currency)}`,
        body:
          `${signal.orgId ? `Workspace ${signal.orgId}` : 'A charge that is not a workspace subscription'}, ` +
          `charge ${signal.chargeId ?? signal.paymentIntentId ?? 'not named'}. ` +
          `Nothing has been refunded or canceled. Reference ${reference}.`,
        link: '/admin/abuse-reports',
      })
      .catch(() => undefined)
  }
  return { reviewId, reference, first }
}
