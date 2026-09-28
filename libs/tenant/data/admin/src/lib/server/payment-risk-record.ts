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
 * STAMP A STRIPE FRAUD SIGNAL ON A MERCHANT'S RECORD (AGL-3360).
 *
 * The server half of `@aglyn/aglyn/app-utils/payment-risk`. A plugin that
 * finds its own record behind a charge — an order, a booking — hands the
 * document here, and this writes the `paymentRisk` field once per signal and
 * tells the site's managers and the workspace's owners once, through the
 * risk notice seam (AGL-3368). Any plugin that sells through Stripe uses
 * the same two calls; nothing about the record's kind is known here.
 *
 * NOTHING IS REFUNDED OR CANCELED. The merchant decides for their own
 * customer; the notification says so.
 *
 * Dependencies are passed in — the Firestore handle and the notifier — so a
 * plugin's spec that substitutes the admin barrel substitutes these too.
 *=========================================*/

import {
  addPaymentRiskSignal,
  PAYMENT_RISK_FIELD,
  type PaymentRisk,
  type PaymentRiskSignal,
  type PaymentRiskSignalKind,
  settlePaymentRiskDispute,
} from '@aglyn/aglyn/app-utils/payment-risk'
import type { AglynNotificationType } from '@aglyn/aglyn/app-utils/notifications'
import type { RiskEventKind } from '@aglyn/shared-util-email/risk-notice-catalog'
import type { RiskEventInput } from './risk-notice'

/**
 * The notifier's shape: `notifyRiskEvent` from the admin barrel (AGL-3368),
 * which tells the site's managers and the workspace's owners and admins what
 * arrived, what it means, and how to refund, keep or answer it.
 */
export type PaymentRiskNotifier = (input: RiskEventInput) => Promise<unknown>

/** The risk notice each Stripe signal on a sale is told as. */
export const PAYMENT_RISK_NOTICE_KINDS: Record<PaymentRiskSignalKind, RiskEventKind> = {
  'early-fraud-warning': 'sale-fraud-warning',
  'radar-review': 'sale-payment-review',
  dispute: 'sale-dispute',
}

export interface RecordPaymentRiskInput {
  ref: FirebaseFirestore.DocumentReference
  signal: PaymentRiskSignal
  /** The site whose managers are told. Empty tells nobody. */
  hostId: string
  /** What the record is, as the merchant calls it: `Order 1042`, `Booking`. */
  subjectLabel: string
  /**
   * The console path the notice's actions open, in the stored-notification
   * shape (`/{hostId}/…`) — the order's own dialog, the Bookings page.
   */
  link: string
  /**
   * The plugin's own notification type. Kept for the record's callers; the
   * notice itself is always a `system.riskNotice` now.
   */
  notificationType?: AglynNotificationType
  /** `$56.00 USD`, when the plugin knows the amount. */
  amount?: string | null
  /** A dispute's evidence deadline, when the plugin knows it. */
  evidenceDueByMs?: number | null
  /**
   * More fields to write in the same transaction, from the record as read —
   * a plugin's own activity line (an order's timeline) rides here.
   */
  extraUpdate?: (data: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Stamp `signal` on `input.ref` and notify, once. Returns true when this
 * delivery wrote it; false for a redelivery or a record that is gone.
 * Throws only when the write throws, which the webhook answers with a 500 and
 * Stripe's redelivery.
 */
export async function recordPaymentRiskOnRecord(
  input: RecordPaymentRiskInput,
  deps: {
    firestore: FirebaseFirestore.Firestore
    notifyRisk: PaymentRiskNotifier
  },
): Promise<boolean> {
  const written = await deps.firestore.runTransaction(async (transaction) => {
    const fresh = await transaction.get(input.ref)
    if (!fresh.exists) return false
    const data = (fresh.data() ?? {}) as Record<string, unknown>
    const next = addPaymentRiskSignal(
      data[PAYMENT_RISK_FIELD] as PaymentRisk | undefined,
      input.signal,
    )
    if (!next) return false
    transaction.update(input.ref, {
      ...(input.extraUpdate ? input.extraUpdate(data) : {}),
      [PAYMENT_RISK_FIELD]: next,
    })
    return true
  })
  if (written && input.hostId) {
    await deps
      .notifyRisk({
        kind: PAYMENT_RISK_NOTICE_KINDS[input.signal.kind],
        orgId: null,
        hostId: input.hostId,
        item: { label: input.subjectLabel, path: input.link },
        occurredAtMs: input.signal.atMs,
        amount: input.amount ?? null,
        evidenceDueByMs: input.evidenceDueByMs ?? null,
        dedupeKey: `sale:${input.signal.stripeObjectId}`,
        staffEvidence: input.signal.detail
          ? `Stripe says: ${input.signal.detail.replace(/_/g, ' ')}.`
          : null,
      })
      .catch(() => undefined)
  }
  return written
}

/**
 * Record a dispute's outcome on the signal already stamped for it. Silent:
 * the plugin that owns money movement on a lost dispute says so itself.
 */
export async function settlePaymentRiskDisputeOnRecord(
  ref: FirebaseFirestore.DocumentReference,
  disputeId: string,
  outcome: string,
  deps: { firestore: FirebaseFirestore.Firestore },
): Promise<boolean> {
  return deps.firestore.runTransaction(async (transaction) => {
    const fresh = await transaction.get(ref)
    if (!fresh.exists) return false
    const next = settlePaymentRiskDispute(
      fresh.get(PAYMENT_RISK_FIELD) as PaymentRisk | undefined,
      disputeId,
      outcome,
    )
    if (!next) return false
    transaction.update(ref, { [PAYMENT_RISK_FIELD]: next })
    return true
  })
}
