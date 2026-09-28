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
 * PAYMENT RISK ON A MERCHANT'S RECORD (AGL-3360).
 *
 * Stripe tells us three ways that a card may not be its holder's: an
 * issuer's EARLY FRAUD WARNING, a Radar REVIEW that holds the payment, and a
 * DISPUTE. For a site's own sale — an order, a booking, a membership — the
 * merchant is the one who decides what to do about it, so the signal lands
 * on the record the sale belongs to, in the merchant's own workspace.
 *
 * This is the one shape every plugin stamps (`paymentRisk` on its own
 * document) and the one sentence every plugin renders, so an order chip and
 * a booking chip say the same thing about the same event. Pure and
 * client-safe; the server write is `payment-risk-record.ts` in
 * tenant-data-admin.
 *
 * Nothing here moves money. An early fraud warning is not yet a chargeback,
 * a review can clear, and a dispute can be won: the words tell the merchant
 * what arrived and where to act (Stripe), never that anything was refunded.
 *=========================================*/

/** Which Stripe signal arrived. */
export type PaymentRiskSignalKind =
  | 'early-fraud-warning'
  | 'radar-review'
  | 'dispute'

/** One signal, as stamped on the merchant's record. */
export interface PaymentRiskSignal {
  kind: PaymentRiskSignalKind
  /** The EFW, review or dispute id: one entry per signal, whatever redelivers. */
  stripeObjectId: string
  /** `fraud_type`, the review's `reason`, the dispute's `reason`. */
  detail?: string
  /** A dispute's outcome once `charge.dispute.closed` lands. */
  outcome?: string
  atMs: number
}

/** The `paymentRisk` field. */
export interface PaymentRisk {
  signals: PaymentRiskSignal[]
  latestKind: PaymentRiskSignalKind
  latestAtMs: number
}

export const PAYMENT_RISK_FIELD = 'paymentRisk'

/** Bounded so a pathological charge cannot grow a document without end. */
const MAX_SIGNALS = 20

/** The Stripe events that carry a signal, and which kind each is. */
export const PAYMENT_RISK_EVENT_KINDS: Readonly<
  Record<string, PaymentRiskSignalKind>
> = {
  'radar.early_fraud_warning.created': 'early-fraud-warning',
  'review.opened': 'radar-review',
  'charge.dispute.created': 'dispute',
}

/** What a webhook handler needs from one of those events. */
export interface PaymentRiskEvent {
  signal: PaymentRiskSignal
  paymentIntentId: string
  chargeId: string
}

const refOf = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : String((value as { id?: unknown } | null)?.id ?? '')

/**
 * The signal an event carries, or null for any other event. Every one of
 * the three objects names its `charge` and `payment_intent`, which is how a
 * plugin finds its own record.
 */
export function paymentRiskEventFrom(
  type: string,
  object: unknown,
  nowMs = Date.now(),
): PaymentRiskEvent | null {
  const kind = PAYMENT_RISK_EVENT_KINDS[type]
  if (!kind) return null
  const source = (object ?? {}) as Record<string, unknown>
  const stripeObjectId = String(source['id'] ?? '')
  if (!stripeObjectId) return null
  const detail = String(
    source['fraud_type'] ?? source['reason'] ?? source['opened_reason'] ?? '',
  )
  const createdSeconds = Number(source['created'])
  return {
    signal: {
      kind,
      stripeObjectId,
      ...(detail ? { detail } : {}),
      atMs:
        Number.isFinite(createdSeconds) && createdSeconds > 0
          ? createdSeconds * 1000
          : nowMs,
    },
    paymentIntentId: refOf(source['payment_intent']),
    chargeId: refOf(source['charge']),
  }
}

/**
 * The field with `signal` added, or null when this signal is already on it
 * — the redelivery answer, so the caller neither writes nor notifies twice.
 */
export function addPaymentRiskSignal(
  existing: PaymentRisk | null | undefined,
  signal: PaymentRiskSignal,
): PaymentRisk | null {
  const signals = Array.isArray(existing?.signals) ? existing.signals : []
  if (signals.some((entry) => entry.stripeObjectId === signal.stripeObjectId)) {
    return null
  }
  const next = [...signals, signal].slice(-MAX_SIGNALS)
  return { signals: next, latestKind: signal.kind, latestAtMs: signal.atMs }
}

/**
 * The field with a dispute's outcome recorded, or null when the dispute is
 * not on it or already carries that outcome.
 */
export function settlePaymentRiskDispute(
  existing: PaymentRisk | null | undefined,
  disputeId: string,
  outcome: string,
): PaymentRisk | null {
  const signals = Array.isArray(existing?.signals) ? existing.signals : []
  const index = signals.findIndex((entry) => entry.stripeObjectId === disputeId)
  if (index < 0 || !outcome || signals[index].outcome === outcome) return null
  const next = signals.slice()
  next[index] = { ...next[index], outcome }
  return { ...(existing as PaymentRisk), signals: next }
}

const LABEL: Record<PaymentRiskSignalKind, string> = {
  'early-fraud-warning': 'Fraud warning',
  'radar-review': 'Held for review',
  dispute: 'Chargeback',
}

const ADVICE: Record<PaymentRiskSignalKind, string> = {
  'early-fraud-warning':
    'The card issuer reported this payment as possibly fraudulent. It is not a chargeback yet; refunding it in Stripe now usually prevents one. Hold anything not yet shipped or delivered until you are sure.',
  'radar-review':
    'Stripe Radar is holding this payment for review. Approve or refund it in Stripe; it stays held until you do.',
  dispute:
    'The cardholder disputed this payment. Respond in Stripe with your evidence before the deadline, or accept it.',
}

/** The merchant-facing title for one signal, e.g. for a notification. */
export function paymentRiskTitle(kind: PaymentRiskSignalKind): string {
  return kind === 'early-fraud-warning'
    ? 'Early fraud warning on a payment'
    : kind === 'radar-review'
      ? 'A payment is held for review'
      : 'A payment was disputed'
}

/** The merchant-facing sentence for one signal. */
export function paymentRiskAdvice(kind: PaymentRiskSignalKind): string {
  return ADVICE[kind]
}

/**
 * A chip's label and tooltip for the record's latest signal, or null when
 * there is none. `Nothing was refunded` is said every time: the merchant
 * must never read a warning as money already gone.
 */
export function describePaymentRisk(
  risk: PaymentRisk | null | undefined,
): { label: string; detail: string } | null {
  const signals = Array.isArray(risk?.signals) ? risk.signals : []
  const latest = signals[signals.length - 1]
  if (!latest) return null
  const outcome = latest.outcome ? ` (${latest.outcome.replace(/_/g, ' ')})` : ''
  const why = latest.detail ? ` Stripe says: ${latest.detail.replace(/_/g, ' ')}.` : ''
  return {
    label: `${LABEL[latest.kind]}${outcome}`,
    detail: `${ADVICE[latest.kind]}${why} Aglyn has not refunded or canceled anything.`,
  }
}
