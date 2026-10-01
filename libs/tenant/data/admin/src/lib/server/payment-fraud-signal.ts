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
import { RISK_PAYMENT_EVENTS } from '@aglyn/shared-util-email/risk-notice-catalog'
import { FieldValue } from 'firebase-admin/firestore'
import type { RiskEventInput } from './risk-notice'

/**
 * The seam every signal here tells people through (AGL-3368): the owners
 * and admins of the workspace, and staff. Passed in, like the Firestore
 * handle, so the webhook's spec substitutes it with the barrel.
 */
export type RiskNotifier = (input: RiskEventInput) => Promise<unknown>

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

/**
 * The Stripe Dashboard page for a signal: the dispute itself, else the
 * payment it is about.
 */
export function stripeSignalDashboardUrl(signal: {
  kind: PaymentFraudSignalKind
  stripeObjectId: string
  chargeId: string | null
  paymentIntentId: string | null
  livemode: boolean
}): string | null {
  const base = `https://dashboard.stripe.com/${signal.livemode ? '' : 'test/'}`
  if (signal.kind === 'dispute' && signal.stripeObjectId) {
    return `${base}disputes/${encodeURIComponent(signal.stripeObjectId)}`
  }
  const payment = signal.paymentIntentId || signal.chargeId
  return payment ? `${base}payments/${encodeURIComponent(payment)}` : null
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
  /**
   * The connected account the charge paid (AGL-3360): a destination
   * charge's `transfer_data.destination`. Every sale Aglyn takes for a site
   * is a destination charge on the platform account — the facilitator
   * model (AGL-1956) — so this is the seller. Null for a charge that paid
   * only the platform, a workspace's own subscription.
   */
  sellerAccountId: string | null
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
      sellerAccountId: accountRef(charge?.['transfer_data']?.['destination']),
    }
  } catch {
    return null
  }
}

/** A Stripe account reference, expanded or not, as an id or null. */
function accountRef(value: unknown): string | null {
  const id =
    typeof value === 'string'
      ? value
      : String((value as { id?: unknown } | null)?.id ?? '')
  return id.startsWith('acct_') ? id : null
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
    notifyRisk: RiskNotifier
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
    // The workspace's owners are told their subscription payment was
    // flagged and how to confirm it; staff get the row with the evidence.
    await deps
      .notifyRisk({
        kind: 'billing-payment-flagged',
        orgId: signal.orgId,
        reviewId,
        reference,
        item: { label: 'your subscription payment', path: '/org/billing/invoices' },
        amount: formatSignalAmount(signal.amountCents, signal.currency),
        // A dispute is the bank's, already opened; a warning or a review is
        // a fraud check. The notice says which.
        paymentEvent: RISK_PAYMENT_EVENTS[signal.kind] ?? null,
        stripeUrl: stripeSignalDashboardUrl(signal),
        staffEvidence:
          `${KIND_LABEL[signal.kind]} (${signal.stripeObjectId}) on charge ` +
          `${signal.chargeId ?? signal.paymentIntentId ?? 'not named'}` +
          (signal.detail ? `; Stripe says: ${signal.detail}` : '') +
          (signal.livemode ? '' : ' — TEST MODE') +
          '.',
      })
      .catch(() => undefined)
  }
  return { reviewId, reference, first }
}

/*==========================================
 * THE SELLER PATTERN: WHEN THE MERCHANT MAY BE THE FRAUDSTER (AGL-3360).
 *
 * A site's own sales are destination charges on the platform account, so
 * Stripe's fraud signals about a shopper's card arrive here too. One of them
 * is the merchant's business — their customer, their order, their decision
 * (`payment-risk-record.ts` puts it on the record and tells them). Staff are
 * not paged for it.
 *
 * What IS staff's business is the shape a phishing actor leaves when they
 * run stolen cards through a storefront of their own: several different
 * charges on ONE connected account drawing issuer fraud reports or
 * chargebacks in a short time. So every signal on a seller's charge is kept
 * in a small per-account ledger, and one urgent abuse-queue row is filed when
 *
 *   ≥ 3 DISTINCT charges carry an early fraud warning or a dispute
 *   within 7 days.
 *
 * Why those numbers. An early fraud warning is an issuer's report that the
 * cardholder did not make the payment, and a dispute is a formal
 * chargeback; a legitimate small merchant sees either rarely — card-network
 * dispute monitoring starts near 0.9% of a month's transactions, single
 * digits a MONTH for a shop doing hundreds of sales. One or two in a week is
 * ordinary friendly fraud and must never page staff. Three separate charges
 * in one week is a rate a real small shop does not produce, and is what a
 * card tester or a stolen-card storefront produces within days. Counted by
 * CHARGE, because a warning is routinely followed by a dispute on the same
 * payment, and that is one bad payment, not two. Radar reviews are kept in
 * the ledger for the row's prose but never counted: a review is Stripe's
 * suspicion, not an issuer's report, and a busy shop can collect several
 * that clear.
 *
 * One row per window: once filed, the account is not filed again until 7
 * days have passed, so a burst is one row with everything in it rather than
 * a row per signal. NOTHING IS DONE TO THE ACCOUNT OR THE MONEY: staff
 * decide (lock the workspace, pause the account's payouts in Stripe).
 *=========================================*/

export const SELLER_FRAUD_PATTERN = {
  /** Distinct charges with an early fraud warning or a dispute. */
  minDistinctCharges: 3,
  /** …within this window. */
  windowMs: 7 * 24 * 60 * 60 * 1000,
  /** How long the ledger keeps an entry at all. */
  retainMs: 30 * 24 * 60 * 60 * 1000,
} as const

const WINDOW_DAYS = SELLER_FRAUD_PATTERN.windowMs / 86_400_000

/** Admin-SDK only; no client rule opens it (default deny). */
export const SELLER_FRAUD_LEDGER_COLLECTION = 'paymentFraudLedger'

export interface SellerFraudLedgerEntry {
  kind: PaymentFraudSignalKind
  stripeObjectId: string
  chargeId: string | null
  amountCents: number | null
  currency: string
  detail: string
  /** The sites a plugin recognised the charge as belonging to. */
  hostIds: string[]
  atMs: number
}

/** Whether a seller's ledger shows the pattern at `nowMs`. Pure. */
export function sellerFraudPattern(
  entries: readonly SellerFraudLedgerEntry[],
  nowMs: number,
): { matched: boolean; chargeIds: string[] } {
  const since = nowMs - SELLER_FRAUD_PATTERN.windowMs
  const chargeIds = [
    ...new Set(
      entries
        .filter(
          (entry) =>
            (entry.kind === 'early-fraud-warning' || entry.kind === 'dispute') &&
            entry.atMs >= since,
        )
        .map((entry) => entry.chargeId || entry.stripeObjectId),
    ),
  ]
  return {
    matched: chargeIds.length >= SELLER_FRAUD_PATTERN.minDistinctCharges,
    chargeIds,
  }
}

/** The connected account's page in the Stripe Dashboard. */
export function stripeConnectedAccountUrl(
  accountId: string,
  livemode: boolean,
): string {
  return `https://dashboard.stripe.com/${livemode ? '' : 'test/'}connect/accounts/${encodeURIComponent(accountId)}`
}

/**
 * Keep one signal on a seller's charge, and file the pattern row when the
 * ledger crosses the threshold. Idempotent on the Stripe object id: a
 * redelivery changes nothing and files nothing.
 */
export async function recordSellerFraudSignal(
  input: {
    signal: PaymentFraudSignal
    sellerAccountId: string
    /** The sites a plugin recognised the charge as belonging to. */
    hostIds: string[]
    /** Workspaces owning those sites, for the row. */
    orgIds: string[]
  },
  deps: {
    firestore: FirebaseFirestore.Firestore
    notifyRisk: RiskNotifier
    nowMs?: number
  },
): Promise<{
  first: boolean
  matched: boolean
  filed: { reviewId: string; reference: string } | null
}> {
  const nowMs = deps.nowMs ?? Date.now()
  const { signal, sellerAccountId } = input
  const ledgerRef = deps.firestore
    .collection(SELLER_FRAUD_LEDGER_COLLECTION)
    .doc(sellerAccountId)
  const outcome = await deps.firestore.runTransaction(async (transaction) => {
    const fresh = await transaction.get(ledgerRef)
    const stored = (
      Array.isArray(fresh.get('entries')) ? fresh.get('entries') : []
    ) as SellerFraudLedgerEntry[]
    if (stored.some((entry) => entry.stripeObjectId === signal.stripeObjectId)) {
      return { first: false, matched: false, fileAtMs: 0, entries: stored }
    }
    const entries: SellerFraudLedgerEntry[] = [
      ...stored.filter(
        (entry) => entry.atMs >= nowMs - SELLER_FRAUD_PATTERN.retainMs,
      ),
      {
        kind: signal.kind,
        stripeObjectId: signal.stripeObjectId,
        chargeId: signal.chargeId,
        amountCents: signal.amountCents,
        currency: signal.currency,
        detail: signal.detail,
        hostIds: input.hostIds,
        atMs: nowMs,
      },
    ]
    const { matched } = sellerFraudPattern(entries, nowMs)
    const lastFiledAtMs = Number(fresh.get('lastFiledAtMs') ?? 0)
    const fileAtMs =
      matched &&
      !(lastFiledAtMs && nowMs - lastFiledAtMs < SELLER_FRAUD_PATTERN.windowMs)
        ? nowMs
        : 0
    transaction.set(
      ledgerRef,
      {
        sellerAccountId,
        entries,
        livemode: signal.livemode,
        updatedAtMs: nowMs,
        ...(fileAtMs ? { lastFiledAtMs: fileAtMs } : {}),
      },
      { merge: true },
    )
    return { first: true, matched, fileAtMs, entries }
  })
  if (!outcome.fileAtMs) {
    return { first: outcome.first, matched: outcome.matched, filed: null }
  }

  const { chargeIds } = sellerFraudPattern(outcome.entries, nowMs)
  const inWindow = outcome.entries.filter(
    (entry) => entry.atMs >= nowMs - SELLER_FRAUD_PATTERN.windowMs,
  )
  const reviewId = createHash('sha256')
    .update(`stripe-seller-pattern:${sellerAccountId}:${outcome.fileAtMs}`)
    .digest('hex')
    .slice(0, 40)
  const reference = paymentFraudSignalReference(reviewId)
  const orgId = input.orgIds[0] ?? null
  const hostIds = [...new Set(inWindow.flatMap((entry) => entry.hostIds ?? []))]
  const stripeUrl = stripeConnectedAccountUrl(sellerAccountId, signal.livemode)
  const details = [
    `${chargeIds.length} different charges paid to connected account ${sellerAccountId} drew an issuer fraud warning or a dispute within ${WINDOW_DAYS} days` +
      (signal.livemode ? '' : ' — TEST MODE') +
      '.',
    `Workspace(s): ${input.orgIds.length ? input.orgIds.join(', ') : 'not resolved'}. Site(s): ${hostIds.length ? hostIds.join(', ') : 'not resolved'}.`,
    ...inWindow.map(
      (entry) =>
        `• ${KIND_LABEL[entry.kind]} ${entry.stripeObjectId} on ${entry.chargeId ?? 'an unnamed charge'} · ${formatSignalAmount(entry.amountCents, entry.currency)}` +
        (entry.detail ? ` · ${entry.detail}` : ''),
    ),
    'A shop taking stolen cards through its own storefront leaves this shape. Each merchant has already been shown the signal on its own order or booking.',
    `Nothing has been refunded, canceled or paused. If this is the seller's fraud, lock the workspace and pause the account's payouts in Stripe (${stripeUrl}), then close this row with what you did.`,
  ]
    .join('\n')
    .slice(0, 5000)
  await deps.firestore
    .collection(ABUSE_REPORT_COLLECTION)
    .doc(reviewId)
    .set(
      {
        reference,
        // "Phishing or fraud" — the queue's urgent fraud category.
        category: 'phishing',
        severity: 'urgent',
        source: 'stripe-seller-fraud-pattern',
        url: null,
        reportedHostname: null,
        hostId: hostIds[0] ?? null,
        orgId,
        details,
        reporterEmail: null,
        reporterName: null,
        dmca: null,
        reportCount: 1,
        sellerPattern: {
          sellerAccountId,
          stripeAccountUrl: stripeUrl,
          chargeIds,
          orgIds: input.orgIds,
          hostIds,
          threshold: SELLER_FRAUD_PATTERN.minDistinctCharges,
          windowDays: WINDOW_DAYS,
          livemode: signal.livemode,
        },
        status: 'open',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  // Staff get the pattern with its numbers; the owners get a plain "we are
  // reviewing recent payments" with the way to talk to us, never the count
  // or the window that opened the review.
  await deps
    .notifyRisk({
      kind: 'seller-review',
      orgId,
      hostId: hostIds[0] ?? null,
      reviewId,
      reference,
      item: { label: 'recent card payments on your store', path: '/org/settings/holds' },
      stripeUrl,
      staffEvidence:
        `Connected account ${sellerAccountId} drew fraud warnings or disputes on ` +
        `${chargeIds.length} different charges in ${WINDOW_DAYS} days` +
        (signal.livemode ? '' : ' — TEST MODE') +
        '.',
    })
    .catch(() => undefined)
  return { first: true, matched: true, filed: { reviewId, reference } }
}
