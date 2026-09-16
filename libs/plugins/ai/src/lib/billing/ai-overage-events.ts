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
 * WHAT THE PLATFORM'S BILLING EVENTS MEAN TO AI OVERAGE (AGL-3011).
 *
 * Five facts reach the plugin from the platform's Stripe webhook, and this
 * module is where each one becomes a change to a workspace's standing. The
 * plugin subscribes no Stripe endpoint of its own: core raises the fact, the
 * plugin decides what it means.
 *
 * ## Whose invoice is it
 *
 * Every invoice this plugin creates is stamped `pluginId: 'ai'` and
 * `kind: 'ai-overage'`. An invoice carrying those is OURS — its outcome
 * settles a charge in the ledger. An invoice without them is the workspace's
 * subscription, and it still matters: a failed renewal is a past-due
 * workspace, and extending it credit between invoices is precisely what must
 * not happen while it owes us money.
 *
 * ## Resuming needs no cron
 *
 * The gate reads the standing document on every request past the band, so
 * clearing a pause here is the whole of "overage resumes". There is nothing
 * to schedule and no cache to expire: the next request sees it.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { PluginEventPayloads } from '@aglyn/aglyn/plugin-manager/plugin-events'
import { assistUsageMonth } from '../usage/assist-usage'
import { AI_PLUGIN_ID } from '../constants'
import { settleAiOverageCharge } from './ai-overage-ledger'
import {
  pauseAiOverage,
  recordAiOveragePaidInvoice,
  recordAiOveragePaymentMethod,
  recordAiOverageDispute,
  resumeAiOverage,
} from './ai-overage-standing-writes'

/** The metadata an invoice of ours carries. */
export const AI_OVERAGE_INVOICE_KIND = 'ai-overage'

interface OverageInvoice {
  chargeId: string
  month: string
}

/**
 * Is this invoice one of ours, and which charge does it settle?
 *
 * Both halves are required. `pluginId` alone would claim an invoice another
 * AI feature might one day raise, and a `chargeId` alone would claim any
 * invoice that happened to carry the key.
 */
export function aiOverageInvoiceFromMetadata(
  metadata: Readonly<Record<string, string>>,
): OverageInvoice | null {
  if (metadata['pluginId'] !== AI_PLUGIN_ID) return null
  if (metadata['kind'] !== AI_OVERAGE_INVOICE_KIND) return null
  const chargeId = String(metadata['chargeId'] ?? '').trim()
  const month = String(metadata['month'] ?? '').trim()
  if (!chargeId || !/^\d{4}-\d{2}$/.test(month)) return null
  return { chargeId, month }
}

function firestore(): FirebaseFirestore.Firestore {
  return firebaseAdmin.app().firestore()
}

/**
 * An invoice was paid.
 *
 * Three consequences, and they are independent of each other:
 *
 * 1. The workspace's payment history moves, which is what raises the ceiling
 *    over time. Every real payment counts, ours or a renewal.
 * 2. If it was OUR invoice, the charge is settled — and settling is what
 *    lowers the unpaid balance the gate refuses on, so paying is what lets a
 *    workspace keep going.
 * 3. A pause this invoice caused is lifted. A paid renewal also lifts a
 *    `past_due` pause, because past due is exactly what it stopped being.
 */
export async function onAiBillingInvoicePaid(
  payload: PluginEventPayloads['billing.invoice.paid'],
  now = new Date(),
): Promise<void> {
  const db = firestore()
  await recordAiOveragePaidInvoice(db, payload.orgId, {
    month: assistUsageMonth(now),
    amountPaidCents: payload.amountPaidCents,
    paidOutOfBand: payload.paidOutOfBand,
  })
  const ours = aiOverageInvoiceFromMetadata(payload.metadata)
  if (ours) {
    await settleAiOverageCharge(db, payload.orgId, {
      chargeId: ours.chargeId,
      month: ours.month,
      invoiceId: payload.invoiceId,
      status: 'paid',
      // The event's own figure (AGL-3023): what Stripe collected, which is
      // the only thing that may clear what the gate refuses on.
      paidUsd: payload.amountPaidCents / 100,
    })
    await resumeAiOverage(db, payload.orgId, { invoiceId: payload.invoiceId })
    return
  }
  // A renewal paid. It clears the `past_due` pause its own failure set, and
  // NOTHING else: an AI charge that failed is still an open invoice, and
  // resuming accrual against it would let the unpaid balance grow.
  await resumeAiOverage(db, payload.orgId, { reason: 'past_due' })
}

/**
 * A charge attempt failed.
 *
 * Ours pauses on `charge_failed` and names the invoice, so the sentence the
 * customer reads points at something they can pay. Anything else is the
 * workspace's own subscription falling past due, which pauses for a
 * different reason and names no invoice of ours.
 *
 * Either way the workspace keeps its INCLUDED credits. Pausing overage is
 * about credit we extend between invoices; the band was paid for in advance.
 */
export async function onAiBillingInvoiceFailed(
  payload: PluginEventPayloads['billing.invoice.failed'],
  now = new Date(),
): Promise<void> {
  const db = firestore()
  const ours = aiOverageInvoiceFromMetadata(payload.metadata)
  if (ours) {
    await settleAiOverageCharge(db, payload.orgId, {
      chargeId: ours.chargeId,
      month: ours.month,
      invoiceId: payload.invoiceId,
      status: 'failed',
    })
    await pauseAiOverage(db, payload.orgId, {
      reason: 'charge_failed',
      invoiceId: payload.invoiceId,
      now,
    })
    return
  }
  await pauseAiOverage(db, payload.orgId, { reason: 'past_due', invoiceId: null, now })
}

/**
 * An invoice was voided or written off.
 *
 * Only ours matters here: the charge is closed as `void`, and the pause it
 * set is lifted. Nothing is re-billed — voiding an invoice is a decision
 * that these dollars are not owed, and the ledger keeps the row so the
 * decision is visible rather than looking like a gap in the sequence.
 */
export async function onAiBillingInvoiceClosed(
  payload: PluginEventPayloads['billing.invoice.closed'],
): Promise<void> {
  const ours = aiOverageInvoiceFromMetadata(payload.metadata)
  if (!ours) return
  const db = firestore()
  await settleAiOverageCharge(db, payload.orgId, {
    chargeId: ours.chargeId,
    month: ours.month,
    invoiceId: payload.invoiceId,
    status: 'void',
  })
  await resumeAiOverage(db, payload.orgId, { invoiceId: payload.invoiceId })
}

/** A dispute resets the ladder and pauses until staff review it. */
export async function onAiBillingDisputeOpened(
  payload: PluginEventPayloads['billing.dispute.opened'],
  now = new Date(),
): Promise<void> {
  await recordAiOverageDispute(firestore(), payload.orgId, now)
}

/**
 * The default payment method changed.
 *
 * Mirrored rather than looked up at the gate: the reservation runs on every
 * metered request and a Stripe round trip there would put a vendor's
 * latency on the critical path of every AI turn.
 */
export async function onAiBillingPaymentMethodChanged(
  payload: PluginEventPayloads['billing.paymentMethod.changed'],
): Promise<void> {
  await recordAiOveragePaymentMethod(firestore(), payload.orgId, payload.defaultType)
}
