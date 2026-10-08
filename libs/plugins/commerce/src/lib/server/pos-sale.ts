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

import { createHash } from 'crypto'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import recordCapturedContact from '@aglyn/aglyn/plugin-manager/record-captured-contact'
import * as CommerceModel from '../model'
import { alertLowStockCrossing } from './low-stock'
import { decrementVariantStock } from './reserve-stock'
import { releasePromotionHold, settlePromotionSlot } from './promotion-hold'
import { offlineFeeMonthKey } from './pos-fee-month'
import { resetPosDisplay } from './pos-display'
import { notifyOrderBuyer, sendOrderReceipt } from './order-notifications'
import { raiseOrderEvent } from './order-events'
import { ORDER_PAID_EVENT } from '../model/order-events'

/*==========================================
 * AN OPEN REGISTER SALE (AGL-3607).
 *
 * A split-tender sale is an order written `pending` with an empty
 * `payments[]`, priced once by `pos-order.ts` (`payment: 'open'`). Each tender
 * then adds one payment through {@link applyPosPayment}, which is the ONLY
 * writer of the ledger and runs every change in one transaction on the order
 * document. When the settled payments cover the total, the same transaction
 * flips the order to `paid` and accrues the invoiced part of the fee, so a
 * sale is completed exactly once however many webhooks, polls and retries
 * race to report its last payment. Stock, the promotion slot, the contact and
 * the receipt follow from that one flip ({@link completePosSale}).
 *=========================================*/

export type PosLiftedOrder = CommerceModel.HostOrder & {
  $id: string
  /** The sale's platform take, before any card processing (AGL-2111). */
  posTakeFeeCents?: number
  /** The org the invoiced part of the take accrues to. */
  posFeeOrgId?: string
  /** The promotion slot this sale holds until it completes (AGL-305). */
  discountId?: string
  discountHoldKey?: string
  paymentIntentIds?: string[]
  reservationId?: string
}

/**
 * A payment's id, derived from the register's attempt key so a retried tap
 * finds the payment it already started instead of starting a second one.
 */
export function posPaymentId(orderId: string, attemptKey: string): string {
  return `pay_${createHash('sha256')
    .update(`${orderId}:${attemptKey}`)
    .digest('hex')
    .slice(0, 24)}`
}

/** What one ledger change decided. */
export type PosPaymentStep =
  | { kind: 'refuse'; status: number; error: string }
  /** Nothing to change: the payment is already in the state asked for. */
  | { kind: 'keep' }
  | {
      kind: 'put'
      payment: CommerceModel.OrderPayment
      /** A timeline line for the order, when the change is worth one. */
      event?: { event: string; detail?: string }
    }

export type PosPaymentOutcome =
  | { ok: false; status: number; error: string }
  | {
      ok: true
      order: PosLiftedOrder
      payment: CommerceModel.OrderPayment | null
      /** True only on the call whose change completed the sale. */
      completed: boolean
      changed: boolean
    }

/** The open sale's ledger, as the register reads it back after any change. */
export function posSaleSummary(order: PosLiftedOrder) {
  const payments = CommerceModel.orderPayments(order)
  const totalCents = Number(order.totals?.totalCents ?? 0)
  return {
    orderId: order.$id,
    status: order.status,
    totalCents,
    paidCents: CommerceModel.posSettledCents(payments),
    dueCents: CommerceModel.posBalanceDueCents(totalCents, payments),
    tenderableCents: CommerceModel.posTenderableCents(totalCents, payments),
    tipCents: CommerceModel.posTipCents(payments),
    payments: payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amountCents: payment.amountCents,
      ...(payment.tipCents ? { tipCents: payment.tipCents } : {}),
      status: payment.status,
      ...(payment.cardBrand ? { cardBrand: payment.cardBrand } : {}),
      ...(payment.last4 ? { last4: payment.last4 } : {}),
      ...(payment.changeCents != null ? { changeCents: payment.changeCents } : {}),
      ...(payment.checkoutUrl && payment.status === 'pending'
        ? { checkoutUrl: payment.checkoutUrl }
        : {}),
      ...(payment.readerId ? { readerId: payment.readerId } : {}),
      ...(payment.failureMessage ? { failureMessage: payment.failureMessage } : {}),
      ...(payment.livemode != null ? { livemode: payment.livemode } : {}),
      // A provider's QR names the provider on the register (AGL-3630).
      ...(payment.providerLabel ? { providerLabel: payment.providerLabel } : {}),
    })),
  }
}

/**
 * The fields that complete a sale, when its settled payments now cover the
 * total; null when the balance is still open or the sale is not pending.
 *
 * Pure, so the spec can hold the arithmetic: the fee is every card payment's
 * own `application_fee_amount` plus the take the cards did not carry, the tip
 * is summed beside the total and never inside it.
 */
export function posCompletionPatch(
  order: PosLiftedOrder,
  payments: CommerceModel.OrderPayment[],
  nowMs: number,
): {
  patch: Record<string, unknown>
  invoiceTakeCents: number
} | null {
  if (order.status !== 'pending') return null
  const totalCents = Number(order.totals?.totalCents ?? 0)
  if (CommerceModel.posBalanceDueCents(totalCents, payments) > 0) return null
  const takeFeeCents = Math.max(0, Math.round(Number(order.posTakeFeeCents ?? 0)))
  const invoiceTakeCents = CommerceModel.posInvoiceTakeCents({ takeFeeCents, payments })
  const settled = payments.filter((payment) => payment.status === 'succeeded')
  const cardFeeCents = settled
    .filter((payment) => CommerceModel.isNettedPaymentMethod(payment.method))
    .reduce((sum, payment) => sum + Math.max(0, Math.round(Number(payment.feeCents ?? 0))), 0)
  const feeCents = cardFeeCents + invoiceTakeCents
  const tipCents = CommerceModel.posTipCents(payments)
  const intents = settled
    .map((payment) => payment.paymentIntentId)
    .filter((id): id is string => Boolean(id))
  const tenders = settled.map((payment) => CommerceModel.describeOrderPayment(payment))
  const overpaid = CommerceModel.posSettledCents(payments) - totalCents
  return {
    invoiceTakeCents,
    patch: {
      status: 'paid',
      paidAtMs: nowMs,
      totals: {
        ...(order.totals ?? {}),
        feeCents,
        ...(tipCents > 0 ? { tipCents } : {}),
      },
      ...(feeCents > 0 ? { feeCollection: CommerceModel.posFeeCollection(payments) } : {}),
      ...(intents.length ? { paymentIntentIds: intents } : {}),
      // The single-charge readers (refund, dispute lookup) key on this; a
      // sale with one card payment keeps working with every one of them.
      ...(intents.length === 1 ? { paymentIntentId: intents[0] } : {}),
      ...(settled.some((payment) => payment.livemode === false) ? { livemode: false } : {}),
      timeline: CommerceModel.appendOrderEvent(
        order,
        'paid',
        `Paid — ${tenders.join(', ')}` +
          (overpaid > 0
            ? `. Overpaid by $${(overpaid / 100).toFixed(2)}: refund the difference.`
            : ''),
        nowMs,
      ),
    },
  }
}

/** The order document, lifted, with its id. */
function liftOrder(id: string, data: unknown): PosLiftedOrder {
  return {
    ...(CommerceModel.liftLegacyOrder((data ?? {}) as any) as any),
    $id: id,
  }
}

/**
 * The ONE writer of a sale's ledger. Runs `prepare` (extra reads) and
 * `decide` inside one transaction on the order, writes the payment, and
 * completes the sale in the same commit when the balance reaches zero.
 */
export async function applyPosPayment<C = undefined>(options: {
  hostId: string
  orderId: string
  paymentId: string
  /** Reads beyond the order (a gift card, a stay), before any write. */
  prepare?: (transaction: any) => Promise<C>
  decide: (sale: {
    order: PosLiftedOrder
    payments: CommerceModel.OrderPayment[]
    existing: CommerceModel.OrderPayment | undefined
    context: C
  }) => PosPaymentStep
  /** Writes beyond the order, in the same transaction, for a `put`. */
  write?: (
    transaction: any,
    context: C,
    payment: CommerceModel.OrderPayment,
    previous: CommerceModel.OrderPayment | undefined,
  ) => void
  nowMs?: number
}): Promise<PosPaymentOutcome> {
  const firestore = firebaseAdmin.app().firestore()
  const orderRef = firestore
    .collection('hosts')
    .doc(options.hostId)
    .collection('orders')
    .doc(options.orderId)
  const nowMs = options.nowMs ?? Date.now()
  const outcome = await firestore.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(orderRef)
    if (!snapshot.exists) {
      return { ok: false as const, status: 404, error: 'Unknown sale' }
    }
    const order = liftOrder(orderRef.id, snapshot.data())
    if (order.channel !== 'pos' || !Array.isArray(order.payments)) {
      return { ok: false as const, status: 409, error: 'This order is not an open register sale' }
    }
    const context = (options.prepare
      ? await options.prepare(transaction)
      : undefined) as C
    const payments = CommerceModel.orderPayments(order)
    const existing = payments.find((payment) => payment.id === options.paymentId)
    const step = options.decide({ order, payments, existing, context })
    if (step.kind === 'refuse') {
      return { ok: false as const, status: step.status, error: step.error }
    }
    if (step.kind === 'keep') {
      return {
        ok: true as const,
        order,
        payment: existing ?? null,
        completed: false,
        changed: false,
      }
    }
    const nextPayments = existing
      ? payments.map((payment) => (payment.id === step.payment.id ? step.payment : payment))
      : [...payments, step.payment]
    let next: PosLiftedOrder = { ...order, payments: nextPayments }
    if (step.event) {
      next = {
        ...next,
        timeline: CommerceModel.appendOrderEvent(
          order,
          step.event.event,
          step.event.detail,
          nowMs,
        ),
      }
    }
    const completion = posCompletionPatch(next, nextPayments, nowMs)
    const write: Record<string, unknown> = {
      payments: nextPayments,
      ...(next.timeline !== order.timeline ? { timeline: next.timeline } : {}),
    }
    if (completion) {
      Object.assign(write, completion.patch)
      next = { ...next, ...(completion.patch as Partial<PosLiftedOrder>) }
      Object.assign(write, CommerceModel.orderListFields(next, orderRef.id))
      // ACCRUED IN THE SAME COMMIT AS THE FLIP (the AGL-2111 rule): the part
      // of the take no card payout carried goes on the org's invoice, and an
      // order and the fee it owes cannot diverge.
      const feeOrgId = String(order.posFeeOrgId ?? '')
      if (completion.invoiceTakeCents > 0 && feeOrgId) {
        const month = offlineFeeMonthKey(new Date(nowMs))
        transaction.set(
          firestore.collection('orgs').doc(feeOrgId).collection('offlineFees').doc(month),
          {
            month,
            feeCents: firebaseAdmin.firestore.FieldValue.increment(completion.invoiceTakeCents),
            orders: firebaseAdmin.firestore.FieldValue.increment(1),
          },
          { merge: true },
        )
      }
    } else if (
      order.status === 'paid' &&
      step.payment.status === 'succeeded' &&
      existing?.status !== 'succeeded'
    ) {
      // MONEY THAT ARRIVED AFTER THE SALE WAS ALREADY PAID: a QR page paid
      // after the cashier took another tender. It is recorded, never
      // dropped, and said on the order so the merchant can refund it.
      write['timeline'] = CommerceModel.appendOrderEvent(
        next,
        'pos-overpaid',
        `${CommerceModel.describeOrderPayment(step.payment)} arrived after the ` +
          'sale was already paid. Refund it from Stripe.',
        nowMs,
      )
    }
    transaction.set(orderRef, write, { merge: true })
    options.write?.(transaction, context, step.payment, existing)
    return {
      ok: true as const,
      order: next,
      payment: step.payment,
      completed: Boolean(completion),
      changed: true,
    }
  })
  if (outcome.ok && outcome.completed) {
    await completePosSale(options.hostId, outcome.order)
  }
  return outcome
}

/*==========================================
 * "A REGISTER SALE COMPLETED" — the one point every POS sale passes through
 * (AGL-3607), whichever way it was paid: the ledger's last payment
 * ({@link completePosSale}), a single-tender cash or room sale
 * (`pos-order.ts`), or a legacy QR sale paid through the `commerce-draft`
 * webhook branch. Peripherals (a cloud receipt printer, a cash drawer kick)
 * and anything else that must follow a sale subscribe here rather than
 * patching each path.
 *=========================================*/

export interface PosSaleCompletedEvent {
  hostId: string
  orderId: string
  order: CommerceModel.HostOrder
}

export type PosSaleCompletedListener = (event: PosSaleCompletedEvent) => void | Promise<void>

const saleCompletedListeners = new Set<PosSaleCompletedListener>()

/** Subscribes to completed register sales; returns the unsubscribe. */
export function onPosSaleCompleted(listener: PosSaleCompletedListener): () => void {
  saleCompletedListeners.add(listener)
  return () => saleCompletedListeners.delete(listener)
}

/**
 * Tells every listener a register sale completed. Awaited, and never throws:
 * the money is already taken, so a listener's failure is logged, not
 * returned to a cashier who would ring the sale again.
 */
export async function notifyPosSaleCompleted(event: PosSaleCompletedEvent): Promise<void> {
  for (const listener of [...saleCompletedListeners]) {
    try {
      await listener(event)
    } catch (error) {
      console.error('[pos-sale] sale-completed listener failed', event.orderId, error)
    }
  }
}

/** Reads the sale as it stands, for the register's status polls. */
export async function readPosSale(
  hostId: string,
  orderId: string,
): Promise<PosLiftedOrder | null> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('orders')
    .doc(orderId)
    .get()
  if (!snapshot.exists) return null
  return liftOrder(snapshot.id, snapshot.data())
}

/**
 * Everything that follows a sale being paid, run once by the call whose
 * commit completed it. Each step is guarded on its own and none can undo the
 * sale: the money is taken, so a failure here is logged and said on the order
 * rather than thrown back at a cashier who would ring it again.
 */
export async function completePosSale(
  hostId: string,
  order: PosLiftedOrder,
): Promise<void> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const orderRef = hostRef.collection('orders').doc(order.$id)
  const notes: Array<{ event: string; detail: string }> = []

  // The promotion's slot becomes a redemption only now: a sale that was
  // voided half-paid never counted against the merchant's cap (AGL-305).
  if (order.discountId && order.discountHoldKey) {
    const settled = await settlePromotionSlot({
      firestore,
      ref: hostRef.collection('discounts').doc(order.discountId),
      holdKey: order.discountHoldKey,
      label: `pos discount ${order.discountId}`,
    })
    if (settled === 'missing' || settled === 'error') {
      notes.push({
        event: 'redemption-orphaned',
        detail:
          `Discount ${order.discountId} was applied to this sale but its ` +
          'redemption could not be counted against its limit.',
      })
    }
  }

  // Stock comes off exactly once, here, compounding across lines of one
  // product (AGL-1828) and atomically against other channels (AGL-2320).
  const products = new Map<string, CommerceModel.HostProduct>()
  for (const line of order.lineItems ?? []) {
    try {
      if (!products.has(line.productId)) {
        const snapshot = await hostRef.collection('products').doc(line.productId).get()
        if (!snapshot.exists) continue
        products.set(line.productId, CommerceModel.liftLegacyProduct(snapshot.data() as any))
      }
      const product = products.get(line.productId) as CommerceModel.HostProduct
      const variantId = line.variantId ?? product.variants[0]?.id
      const tracked = product.variants.some(
        (variant) => variant.id === variantId && variant.inventory != null,
      )
      if (!variantId || !tracked) continue
      const moved = await decrementVariantStock({
        firestore,
        hostRef,
        hostId,
        productId: line.productId,
        variantId,
        quantity: line.quantity,
        locationId: order.locationId || undefined,
        ledger: { reason: 'sale', orderId: order.$id },
      })
      if (!moved.before || !moved.after) continue
      products.set(line.productId, moved.after)
      alertLowStockCrossing(hostId, moved.before, moved.after)
    } catch (error) {
      console.error('[pos-sale] stock decrement failed', order.$id, line.productId, error)
    }
  }

  const receipt = order.receiptRequest
  const receiptEmail = receipt?.channel === 'email' ? String(receipt.to ?? '') : ''
  const contactEmail = receiptEmail || String(order.customerEmail ?? '')
  const marketingOptIn = Boolean((receipt as { marketingOptIn?: boolean } | undefined)?.marketingOptIn)
  const totalCents = Number(order.totals?.totalCents ?? 0)
  if (contactEmail) {
    await recordCapturedContact({
      orgId: '',
      hostId,
      identity: { email: contactEmail },
      surface: 'relationship',
      lifecycleFloor: 'customer',
      // The customer's own tick on the display, the same opt-in the online
      // checkout records (AGL-3608); an unticked box records nothing.
      ...(marketingOptIn ? { marketingConsent: true } : {}),
      purchaseCents: totalCents,
      interaction: {
        source: 'order',
        refId: order.$id,
        summary: `In-store purchase ($${(totalCents / 100).toFixed(2)})`,
      },
    }).catch((error: unknown) => {
      console.error('[pos-sale] contact capture failed', error)
    })
  }

  // The receipt and the paid event, through the same doors every sale uses
  // (AGL-3610, AGL-3611): the buyer-notification door claims each message
  // per channel, so a second completion path can never mail twice, and it
  // texts the receipt when the customer chose a text and a provider is on.
  if ((receipt?.channel === 'email' || receipt?.channel === 'sms') && receipt.to) {
    // The customer named where it goes: it goes there, whatever else the
    // order holds (AGL-3608).
    const sent = await deliverChosenPosReceipt(
      { hostId, orderId: order.$id },
      { channel: receipt.channel, to: receipt.to, orderEmail: String(order.customerEmail ?? '') },
    )
    if (sent !== 'sent') {
      notes.push({
        event: 'receipt-unsent',
        detail: `The ${receipt.channel === 'sms' ? 'text' : 'email'} receipt could not be sent.`,
      })
    }
  } else if (contactEmail) {
    await notifyOrderBuyer({ hostId, orderId: order.$id }, 'receipt', { email: contactEmail })
  }
  await raiseOrderEvent(ORDER_PAID_EVENT, { hostId, orderId: order.$id, key: 'paid' }).catch(
    (error: unknown) => console.error('[pos-sale] order.paid event failed', error),
  )

  if (notes.length) {
    await firestore
      .runTransaction(async (transaction: any) => {
        const fresh = liftOrder(orderRef.id, (await transaction.get(orderRef)).data())
        let timeline = fresh.timeline ?? []
        for (const note of notes) {
          timeline = CommerceModel.appendOrderEvent({ timeline }, note.event, note.detail)
        }
        transaction.set(orderRef, { timeline }, { merge: true })
      })
      .catch((error: unknown) => console.error('[pos-sale] note failed', error))
  }

  await notifyPosSaleCompleted({ hostId, orderId: order.$id, order })

  // The customer screen says thank you and forgets the customer: the state
  // is rewritten whole, so no address or phone outlives the sale (AGL-3608).
  if (order.registerId) {
    await resetPosDisplay(hostId, order.registerId).catch((error: unknown) =>
      console.error('[pos-sale] display reset failed', error),
    )
  }
}

/**
 * Sends a receipt the customer (or the cashier for them) explicitly asked
 * for, to the address or number they gave (AGL-3607, AGL-3608).
 *
 * It goes through the buyer-notification door first, so the order's
 * once-per-channel marker is claimed and a completion that races this call
 * cannot send a second copy. The door can skip it, though, for reasons that
 * do not apply to a request made at the counter: the store switched
 * automatic receipts or texts off, a receipt already went out on that
 * channel to an earlier address, or the door would use the email the order
 * was opened with rather than the one just typed. In each of those cases the
 * receipt is sent explicitly, as the order dialog's "Resend receipt" does.
 */
export async function deliverChosenPosReceipt(
  ref: { hostId: string; orderId: string },
  input: { channel: 'email' | 'sms'; to: string; orderEmail?: string },
): Promise<'sent' | 'failed' | 'not_configured'> {
  const orderEmail = String(input.orderEmail ?? '').trim().toLowerCase()
  const to = input.to.trim()
  const doorAddressesIt = input.channel === 'sms' || !orderEmail || orderEmail === to.toLowerCase()
  if (doorAddressesIt) {
    const door = await notifyOrderBuyer(ref, 'receipt', input.channel === 'email' ? { email: to } : {})
    const entry =
      door.outcome === 'handled'
        ? door.channels.find((channel) => channel.channel === input.channel)
        : undefined
    if (entry?.outcome === 'sent') return 'sent'
    if (entry?.outcome === 'failed') return 'failed'
    // Already sent to this very address: nothing more to do.
    if (entry?.outcome === 'already' && input.channel === 'email') return 'sent'
  }
  const explicit = await sendOrderReceipt(ref, { channel: input.channel, to })
  if (explicit.outcome === 'sent') return 'sent'
  return explicit.outcome === 'not_configured' ? 'not_configured' : 'failed'
}

/**
 * Hands back a promotion slot an open sale was holding, when the sale is
 * voided rather than paid.
 */
export async function releasePosSaleDiscount(
  hostId: string,
  order: PosLiftedOrder,
): Promise<void> {
  if (!order.discountId || !order.discountHoldKey) return
  await releasePromotionHold(
    firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('discounts')
      .doc(order.discountId),
    order.discountHoldKey,
  )
}
