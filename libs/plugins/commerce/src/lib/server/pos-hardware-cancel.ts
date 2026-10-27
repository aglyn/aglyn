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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  POS_HARDWARE_STATUS_STAMP,
  posHardwareRefundable,
  posHardwareSaleRecord,
  type PosHardwareCancelReason,
  type PosHardwareOrder,
} from '../model/pos-hardware'
import { hardwareOrdersRef, posHardwareSaleRef } from './pos-hardware'
import { posStripe } from './pos-stripe'

/*==========================================
 * CANCELING AND REFUNDING A HARDWARE ORDER IN FULL (AGL-4038).
 *
 * One path for every caller: staff on the Hardware orders page, and the
 * closures (a workspace deleted, the buying account closed) that cancel every
 * order of theirs that has not shipped. Each refunds the whole payment on the
 * PLATFORM account, only before the order ships, and only once:
 *
 *   1. CLAIM under the lock: the order must still be paid or ordered, and
 *      `refundRequestedAtMs` is set, so it cannot be marked shipped while the
 *      money is on its way back.
 *   2. REFUND through Stripe under ONE idempotency key per order,
 *      `pos-hw-refund-{orderId}`, with the same parameters whoever asks — a
 *      key replayed with different parameters is refused by Stripe, so no
 *      caller adds its own. A second ask inside Stripe's key window gets the
 *      first refund back; after it, Stripe refuses the charge as already
 *      refunded, and the refund it already made is read back instead of a
 *      second one made.
 *   3. SETTLE: the order and its retained sale record move together, in one
 *      transaction, with the refund id, the cents Stripe reported and why.
 *
 * Stripe refusing releases the claim, so the order can still ship. Telling
 * people (the buyer, staff) and the audit row are the caller's: staff and a
 * closure say different things.
 *=========================================*/

/** What became of one cancel. */
export type PosHardwareCancelResult =
  /** Refunded now (or Stripe's earlier refund recovered) and settled. */
  | { outcome: 'settled'; before: PosHardwareOrder; order: PosHardwareOrder }
  /** It already had the final status: nothing was asked of Stripe. */
  | { outcome: 'already'; order: PosHardwareOrder }
  | { outcome: 'missing' }
  /** Shipped, delivered, registered, or canceled the other way. */
  | { outcome: 'not-refundable'; order: PosHardwareOrder }
  | { outcome: 'no-payment'; order: PosHardwareOrder }
  /** Stripe refused; the claim was released and the order is as it was. */
  | { outcome: 'refused'; order: PosHardwareOrder; message: string; code: string | null }

export interface PosHardwareCancelRequest {
  orgId: string
  orderId: string
  /** `canceled` for a cancel (staff or closure), `refunded` for a staff refund. */
  finalStatus: 'canceled' | 'refunded'
  reason: PosHardwareCancelReason
  now?: () => number
}

type ClaimedOrder = PosHardwareOrder & { refundRequestedAtMs?: number }

/** The idempotency key every caller refunds an order under. */
export function posHardwareRefundKey(orderId: string): string {
  return `pos-hw-refund-${orderId}`
}

/**
 * The refund Stripe already made on this payment, for a charge it refuses as
 * already refunded: the earlier ask settled at Stripe and never reached the
 * order (a crash between the two, or an ask after Stripe's key window).
 */
async function existingRefund(paymentIntentId: string): Promise<{ id: string; amount: number } | null> {
  const listed = await posStripe('GET', 'refunds', {
    params: { payment_intent: paymentIntentId, limit: 10 },
  }).catch(() => null)
  const refunds = Array.isArray(listed?.body?.data) ? (listed?.body?.data as Array<Record<string, unknown>>) : []
  const found = refunds.find(
    (refund) => refund?.['id'] && (refund?.['status'] === 'succeeded' || refund?.['status'] === 'pending'),
  )
  return found ? { id: String(found['id']), amount: Number(found['amount'] ?? 0) } : null
}

export async function cancelAndRefundPosHardwareOrder(
  request: PosHardwareCancelRequest,
): Promise<PosHardwareCancelResult> {
  const { orgId, orderId, finalStatus, reason } = request
  const now = request.now ?? Date.now
  const firestore = firebaseAdmin.app().firestore()
  const ref = hardwareOrdersRef(orgId).doc(orderId)

  const claim = await firestore.runTransaction(async (transaction: any): Promise<PosHardwareCancelResult | { outcome: 'claimed'; order: ClaimedOrder }> => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return { outcome: 'missing' }
    const order = snapshot.data() as ClaimedOrder
    if (order.status === finalStatus) return { outcome: 'already', order }
    if (!posHardwareRefundable(order.status)) return { outcome: 'not-refundable', order }
    if (!order.stripePaymentIntentId) return { outcome: 'no-payment', order }
    transaction.update(ref, { refundRequestedAtMs: now() })
    return { outcome: 'claimed', order }
  })
  if (claim.outcome !== 'claimed') return claim
  const before = claim.order

  const asked = await posStripe('POST', 'refunds', {
    // The same parameters for every caller: see the module note.
    params: {
      payment_intent: before.stripePaymentIntentId,
      'metadata[type]': 'pos-hardware-order',
      'metadata[orderId]': orderId,
      'metadata[orgId]': orgId,
    },
    idempotencyKey: posHardwareRefundKey(orderId),
  })
  let refund: { id: string; amount: number } | null =
    asked.ok && asked.body?.id ? { id: String(asked.body.id), amount: Number(asked.body.amount ?? 0) } : null
  const code = asked.ok ? null : String(asked.body?.error?.code ?? '') || null
  if (!refund && code === 'charge_already_refunded') {
    refund = await existingRefund(String(before.stripePaymentIntentId))
  }
  if (!refund) {
    await ref.update({ refundRequestedAtMs: firebaseAdmin.firestore.FieldValue.delete() }).catch(() => undefined)
    console.error('[pos-hardware] refund refused', orderId, asked.status, code)
    const settledBefore = { ...before }
    delete settledBefore.refundRequestedAtMs
    return {
      outcome: 'refused',
      order: settledBefore,
      message: String(asked.body?.error?.message ?? '') || 'Stripe refused the refund.',
      code,
    }
  }

  const at = now()
  const refundedCents = refund.amount > 0 ? refund.amount : Number(before.totalCents ?? 0)
  const patch = {
    status: finalStatus,
    [POS_HARDWARE_STATUS_STAMP[finalStatus]]: at,
    updatedAtMs: at,
    refundId: refund.id,
    refundedCents,
    cancelReason: reason,
    refundRequestedAtMs: firebaseAdmin.firestore.FieldValue.delete(),
  }
  const settled: ClaimedOrder = { ...before }
  delete settled.refundRequestedAtMs
  const after: PosHardwareOrder = {
    ...settled,
    status: finalStatus,
    [POS_HARDWARE_STATUS_STAMP[finalStatus]]: at,
    updatedAtMs: at,
    refundId: refund.id,
    refundedCents,
    cancelReason: reason,
  }
  // The order and its retained sale record move together: the record is
  // what the refund is accounted from once the workspace is gone.
  await firestore.runTransaction(async (transaction: any) => {
    transaction.update(ref, patch)
    transaction.set(posHardwareSaleRef(orderId), posHardwareSaleRecord(orderId, after))
  })
  return { outcome: 'settled', before: settled, order: after }
}
