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

import { formatOperatorAlertAmount } from '@aglyn/aglyn/app-utils/operator-alerts'
import { firebaseAdmin, raiseOperatorAlert } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { posOrderRefundRecord, POS_ORDER_REFUNDS_COLLECTION } from '../model/commerce-pos-day-report'
import { POS_STRIPE_TENDERS, type PosTenderSource } from '../model/commerce-pos-ops'
import {
  formatPosHardwareCents,
  isPosHardwareSkuId,
  POS_HARDWARE_ORDER_ID,
  POS_HARDWARE_RETURN_REASON_MAX,
  posHardwareSaleRecord,
  posHardwareSaleSetOptions,
  type PosHardwareInPersonConfig,
  type PosHardwareOrder,
  type PosHardwareRefund,
} from '../model/pos-hardware'
import { COMMERCE_POS_HARDWARE_RETURN_REQUESTED } from '../constants/operator-alerts'
import { hardwareOrdersRef, posHardwareOrderNumber, posHardwareSaleRef } from './pos-hardware'
import { createStripeRefund } from './stripe-refund'

/*==========================================
 * RETURNING A CARD READER SOLD IN PERSON (AGL-4038).
 *
 * Three ways, and all of them pay back from the SELLING store's takings,
 * the way the sale was paid — never from the platform's Checkout, which an
 * in-person sale never used:
 *
 *   1. At the selling store's register, at a later event: the register's own
 *      return (`pos-return.ts`) refunds the sale's tenders as for anything
 *      else, and the hardware's share of it is written here onto the
 *      hardware order and its retained sale record.
 *   2. From the staff Hardware orders page: the card the sale was paid with
 *      is refunded through the register sale's own Stripe refund (a
 *      destination charge, so the money comes back out of the store's
 *      connected account), recorded on the register sale as any refund is,
 *      and on the hardware order. A sale paid in cash can only be refunded
 *      at the register.
 *   3. Requested by the buyer from their own purchase history: staff are
 *      alerted, and refund it (2) or decline it.
 *
 * Each refund is written once by its key, and the order says Refunded once
 * every hardware item on it has come back. Returns follow Stripe's hardware
 * terms; nothing here decides them.
 *=========================================*/

export class PosHardwareReturnRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function firestore() {
  return firebaseAdmin.app().firestore()
}

const units = (order: Pick<PosHardwareOrder, 'lines'>) =>
  (order.lines ?? []).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)

/** The order with one more refund on it, or as it was when the key was already used. */
export function withPosHardwareRefund(order: PosHardwareOrder, refund: PosHardwareRefund): PosHardwareOrder {
  const refunds = order.refunds ?? []
  if (refunds.some((held) => held.key === refund.key)) return order
  const next = [...refunds, refund]
  const refundedCents = next.reduce((sum, held) => sum + held.cents, 0)
  const returned = next.reduce((sum, held) => sum + held.quantity, 0)
  const whole = refundedCents >= (order.totalCents ?? 0) || (returned > 0 && returned >= units(order))
  return {
    ...order,
    refunds: next,
    refundedCents,
    refundedAtMs: refund.atMs,
    refundId: refund.stripeRefundId ?? order.refundId ?? null,
    ...(whole ? { status: 'refunded' as const } : {}),
    ...(order.returnRequest && order.returnRequest.state === 'requested'
      ? { returnRequest: { ...order.returnRequest, state: 'refunded' as const, decidedAtMs: refund.atMs } }
      : {}),
    updatedAtMs: refund.atMs,
  }
}

/** Writes one refund onto a hardware order and its sale record, once. */
async function applyRefund(orderId: string, refund: PosHardwareRefund): Promise<PosHardwareOrder | null> {
  const saleRef = posHardwareSaleRef(orderId)
  return firestore().runTransaction(async (transaction: any) => {
    const sale = await transaction.get(saleRef)
    if (!sale.exists) return null
    const ref = hardwareOrdersRef(String(sale.get('orgId') ?? '')).doc(orderId)
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    const before = snapshot.data() as PosHardwareOrder
    const after = withPosHardwareRefund(before, refund)
    if (after === before) return before
    transaction.set(ref, after)
    transaction.set(saleRef, posHardwareSaleRecord(orderId, after), posHardwareSaleSetOptions(after))
    return after
  })
}

/**
 * A return at the selling store's register (way 1): the hardware's share of
 * what the return refunded, by the lines it took back. Never throws into the
 * return; the money has already gone back.
 */
export async function recordRegisterHardwareReturn(input: {
  config: PosHardwareInPersonConfig | null
  hostId: string
  registerOrderId: string
  returnId: string
  refundCents: number
  lines: ReadonlyArray<{ index: number; quantity: number; refundCents: number }>
  now?: number
}): Promise<PosHardwareOrder | null> {
  const { config } = input
  if (!config || input.hostId !== config.sellerHostId || !input.lines.length) return null
  try {
    const hostRef = firestore().collection('hosts').doc(input.hostId)
    const register = await hostRef.collection('orders').doc(input.registerOrderId).get()
    const orderId = String(register.get('hardwareOrderId') ?? '')
    if (!POS_HARDWARE_ORDER_ID.test(orderId)) return null
    const lineItems = (register.get('lineItems') ?? []) as CommerceModel.OrderLineItem[]
    const productIds = [...new Set(input.lines.map((line) => String(lineItems[line.index]?.productId ?? '')))].filter(Boolean)
    const products = new Map(
      (await Promise.all(productIds.map((id) => hostRef.collection('products').doc(id).get()))).map((doc: any) => [
        String(doc.id),
        doc.get('hardwareSku'),
      ]),
    )
    const hardware = input.lines.filter((line) =>
      isPosHardwareSkuId(products.get(String(lineItems[line.index]?.productId ?? ''))),
    )
    if (!hardware.length) return null
    const linesCents = input.lines.reduce((sum, line) => sum + Math.max(0, Math.round(line.refundCents)), 0)
    const hardwareCents = hardware.reduce((sum, line) => sum + Math.max(0, Math.round(line.refundCents)), 0)
    // What actually went back, in the lines' own proportion: a card that
    // refused after another tender paid back leaves a part-return.
    const refunded = Math.max(0, Math.round(input.refundCents))
    const cents =
      linesCents > 0 && refunded < linesCents
        ? Math.floor((refunded * hardwareCents * 2 + linesCents) / (linesCents * 2))
        : hardwareCents
    return await applyRefund(orderId, {
      key: `register:${input.returnId}`,
      via: 'register',
      cents,
      quantity: hardware.reduce((sum, line) => sum + Math.max(0, Math.round(line.quantity)), 0),
      atMs: input.now ?? Date.now(),
      stripeRefundId: null,
    })
  } catch (error) {
    console.error('[pos-hardware-returns] a register return was not written to its hardware order', input.registerOrderId, error)
    return null
  }
}

/**
 * Refunds what is left of an in-person order from the staff page (way 2),
 * through the register sale's own card refund. Refused for a sale paid by
 * anything Stripe cannot refund, which goes back at the register instead.
 */
export async function refundInPersonPosHardwareOrder(input: {
  config: PosHardwareInPersonConfig | null
  orgId: string
  orderId: string
  actorUid: string
  now?: number
}): Promise<{ before: PosHardwareOrder; order: PosHardwareOrder }> {
  const { config } = input
  if (!config) throw new PosHardwareReturnRefusal('Card reader sales in person are off.', 409)
  const ref = hardwareOrdersRef(input.orgId).doc(input.orderId)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new PosHardwareReturnRefusal('No such order', 404)
  const before = snapshot.data() as PosHardwareOrder
  if (before.source !== 'in_person' || before.posSale?.hostId !== config.sellerHostId) {
    throw new PosHardwareReturnRefusal('Only a card reader sold in person here is refunded this way.', 409)
  }
  if (before.status === 'refunded' || before.status === 'canceled') return { before, order: before }
  const cents = Math.max(0, (before.totalCents ?? 0) - (before.refundedCents ?? 0))
  if (!cents) throw new PosHardwareReturnRefusal('Nothing is left to refund on this order.', 409)
  const registerOrderId = String(before.posSale?.orderId ?? '')
  const registerRef = firestore().collection('hosts').doc(config.sellerHostId).collection('orders').doc(registerOrderId)
  const register = await registerRef.get()
  if (!register.exists) throw new PosHardwareReturnRefusal('The register sale is missing.', 404)
  const sale = register.data() as PosTenderSource & CommerceModel.HostOrder & { refundedCents?: number }
  const card = CommerceModel.orderPayments(sale as never)
    .filter((payment) => payment.status === 'succeeded' && POS_STRIPE_TENDERS.has(payment.method) && payment.paymentIntentId)
    .find((payment) => payment.amountCents >= cents)
  if (!card?.paymentIntentId) {
    throw new PosHardwareReturnRefusal(
      'This card reader was not paid by one card that can take this refund. Refund it as a return at the selling store’s register instead.',
      409,
    )
  }
  const totalCents = Number(sale.totals?.totalCents ?? 0)
  // Reserve on the register sale first, as its own refunds do, so a refund
  // there and one here cannot both take the same money.
  const reserved = await firestore().runTransaction(async (transaction: any) => {
    const fresh = (await transaction.get(registerRef)).data() ?? {}
    const already = Number(fresh['refundedCents'] ?? 0)
    if (already + cents > totalCents) return false
    transaction.set(registerRef, { refundedCents: already + cents }, { merge: true })
    return true
  })
  if (!reserved) {
    throw new PosHardwareReturnRefusal('The register sale was already refunded. Check it on the store’s orders.', 409)
  }
  const attempt = (before.refunds ?? []).filter((held) => held.via === 'staff').length + 1
  const refund = await createStripeRefund({
    paymentIntentId: card.paymentIntentId,
    amountCents: cents,
    idempotencyKey: `pos-hw-refund-${input.orderId}-${attempt}`,
    metadata: {
      hostId: config.sellerHostId,
      orderId: registerOrderId,
      hardwareOrderId: input.orderId,
      kind: 'pos-hardware-refund',
    },
  })
  if ('error' in refund) {
    // Stripe said no, so no money moved: the reservation goes back.
    await firestore()
      .runTransaction(async (transaction: any) => {
        const current = Number((await transaction.get(registerRef)).get('refundedCents') ?? 0)
        transaction.set(registerRef, { refundedCents: Math.max(0, current - cents) }, { merge: true })
      })
      .catch(() => undefined)
    throw new PosHardwareReturnRefusal(refund.error, refund.status === 409 ? 409 : 502)
  }
  const now = input.now ?? Date.now()
  const registerRefund = posOrderRefundRecord({
    orderId: registerOrderId,
    order: sale as PosTenderSource & { registerId?: unknown },
    refundedCents: cents,
    paymentIntentId: card.paymentIntentId,
    cashierId: null,
    source: 'staff',
    stripeRefundId: refund.refundId || null,
    atMs: now,
  })
  await firestore().runTransaction(async (transaction: any) => {
    const fresh = (await transaction.get(registerRef)).data() ?? {}
    const refundedCents = Number(fresh['refundedCents'] ?? 0)
    transaction.set(
      registerRef,
      {
        ...(refundedCents >= totalCents ? { status: 'refunded' } : {}),
        updatedAtMs: now,
        timeline: firebaseAdmin.firestore.FieldValue.arrayUnion({
          atMs: now,
          event: 'refund',
          detail: `Card reader refunded from the staff hardware page: ${formatPosHardwareCents(cents)}`,
        }),
      },
      { merge: true },
    )
    if (registerRefund) {
      transaction.set(
        firestore()
          .collection('hosts')
          .doc(config.sellerHostId)
          .collection('registers')
          .doc(registerRefund.registerId)
          .collection(POS_ORDER_REFUNDS_COLLECTION)
          .doc(refund.refundId || `${registerOrderId}-hw-${attempt}`),
        registerRefund,
      )
    }
  })
  const order = await applyRefund(input.orderId, {
    key: `staff:${attempt}`,
    via: 'staff',
    cents,
    quantity: Math.max(0, units(before) - (before.refunds ?? []).reduce((sum, held) => sum + held.quantity, 0)),
    atMs: now,
    stripeRefundId: refund.refundId || null,
  })
  return { before, order: order ?? before }
}

/**
 * The buyer asks to return an in-person order (way 3), from their own
 * purchase history: once while a request is open, with a reason. Staff are
 * alerted. Never for an order already refunded.
 */
export async function requestPosHardwareReturn(input: {
  orgId: string
  orderId: string
  uid: string
  reason: unknown
  now?: number
}): Promise<PosHardwareOrder> {
  const reason = String(input.reason ?? '').trim().slice(0, POS_HARDWARE_RETURN_REASON_MAX)
  if (reason.length < 3) throw new PosHardwareReturnRefusal('Say why you are returning it.', 400)
  if (!POS_HARDWARE_ORDER_ID.test(input.orderId)) throw new PosHardwareReturnRefusal('No such order.', 404)
  const ref = hardwareOrdersRef(input.orgId).doc(input.orderId)
  const now = input.now ?? Date.now()
  const outcome = await firestore().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new PosHardwareReturnRefusal('No such order.', 404)
    const before = snapshot.data() as PosHardwareOrder
    if (before.source !== 'in_person') {
      throw new PosHardwareReturnRefusal('A return of an order shipped to you is arranged with support.', 409)
    }
    if (before.status === 'refunded' || before.status === 'canceled') {
      throw new PosHardwareReturnRefusal('This order was already refunded.', 409)
    }
    if (before.returnRequest?.state === 'requested') return { order: before, created: false }
    const after: PosHardwareOrder = {
      ...before,
      returnRequest: {
        state: 'requested',
        reason,
        requestedBy: input.uid,
        requestedAtMs: now,
        decidedBy: null,
        decidedAtMs: null,
        note: null,
      },
      updatedAtMs: now,
    }
    transaction.set(ref, after)
    return { order: after, created: true }
  })
  if (outcome.created) {
    try {
      await raiseOperatorAlert(COMMERCE_POS_HARDWARE_RETURN_REQUESTED, {
        dedupeKey: `${input.orderId}:${now}`,
        orgId: input.orgId,
        hostId: outcome.order.hostId || outcome.order.posSale?.hostId || '',
        context: {
          orderNumber: posHardwareOrderNumber(input.orderId),
          amount: formatOperatorAlertAmount(outcome.order.totalCents ?? 0),
          orgId: input.orgId,
          items: (outcome.order.lines ?? []).map((line) => `${line.quantity} × ${line.name}`).join(', '),
          reason,
        },
      })
    } catch (error) {
      console.error('[pos-hardware-returns] return request alert failed', input.orderId, error)
    }
  }
  return outcome.order
}

/** Staff decline an open return request, with a note for the buyer. */
export async function declinePosHardwareReturn(input: {
  orgId: string
  orderId: string
  actorUid: string
  note: unknown
  now?: number
}): Promise<{ before: PosHardwareOrder; order: PosHardwareOrder }> {
  const note = String(input.note ?? '').trim().slice(0, POS_HARDWARE_RETURN_REASON_MAX) || null
  const ref = hardwareOrdersRef(input.orgId).doc(input.orderId)
  const now = input.now ?? Date.now()
  return firestore().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new PosHardwareReturnRefusal('No such order', 404)
    const before = snapshot.data() as PosHardwareOrder
    if (before.returnRequest?.state !== 'requested') {
      throw new PosHardwareReturnRefusal('There is no open return request on this order.', 409)
    }
    const order: PosHardwareOrder = {
      ...before,
      returnRequest: { ...before.returnRequest, state: 'declined', decidedBy: input.actorUid, decidedAtMs: now, note },
      updatedAtMs: now,
    }
    transaction.set(ref, order)
    return { before, order }
  })
}
