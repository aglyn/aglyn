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

import {
  consumeRateLimit,
  firebaseAdmin,
  getPluginConfig,
} from '@aglyn/tenant-data-admin'
import { buildRoute, Route, type PluginApiHandler } from '@aglyn/aglyn/server'
import recordCapturedContact from '@aglyn/aglyn/plugin-manager/record-captured-contact'
import { pluginSmsAvailable } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { finishPosDisplayReceipt } from './pos-display'
import * as CommerceModel from '../model'
import { posRegisterSettings } from '../plugin-config'
import {
  authorizePosStaff,
  posIdempotencyKey,
  posQueryBody,
  posRequestBody,
  type PosStaff,
} from './pos-auth'
import {
  applyPosPayment,
  deliverChosenPosReceipt,
  posPaymentId,
  posSaleSummary,
  readPosSale,
  releasePosSaleDiscount,
  type PosLiftedOrder,
  type PosPaymentOutcome,
} from './pos-sale'
import { posPaymentCashierId } from './pos-sale-stamp'
import { printPosSaleReceipt } from './pos-print'
import {
  POS_CURRENCY,
  posStripe,
  posStripeErrorMessage,
  posStripeTestMode,
  posTerminalAvailable,
} from './pos-stripe'
import {
  cancelPosCardPayment,
  createCardPresentIntent,
  refreshPosCardPayment,
  retryCardPresentPayment,
  simulatePosReaderTap,
  startCardKeyedPayment,
  startCardLinkPayment,
  startCardPresentPayment,
} from './pos-terminal'

/**
 * `POST /api/commerce/pos-payment` (AGL-3607): every tender against an OPEN
 * register sale, one `action` per request.
 *
 * The sale was priced by `pos-order.ts` (`payment: 'open'`); nothing here
 * re-prices it or lets the register name a total. Each payment-starting action
 * needs the register's `Idempotency-Key`, from which the payment's id is
 * derived: pressing a tender twice, or retrying after a lost response, finds
 * the payment the first press started instead of taking the money twice.
 */
export const posPaymentHandler: PluginApiHandler = async (req, res) => {
  // `sale` is a read and may be a GET, so a register re-reading its sale does
  // not spend the console's write budget; everything else moves money.
  const body = req.method === 'GET' ? posQueryBody(req) : posRequestBody(req)
  if (
    !(
      req.method === 'POST' ||
      (req.method === 'GET' && (body['action'] === 'sale' || body['action'] === 'context'))
    )
  ) {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(body['hostId'] ?? '')
  const gate = await authorizePosStaff(req, hostId)
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error })
  let staff = gate.staff
  const action = String(body['action'] ?? '')
  const orderId = String(body['orderId'] ?? '')
  try {
    if (action === 'gift-card-balance') {
      return await giftCardBalance(staff, body, res)
    }
    if (action === 'context') {
      // What the register needs to draw its tenders: the site's tip and
      // receipt settings, whether card readers are offered at all, and the
      // key the typed-card form loads Stripe with.
      const readers = posTerminalAvailable()
        ? (
            await firebaseAdmin
              .app()
              .firestore()
              .collection('hosts')
              .doc(hostId)
              .collection('terminalReaders')
              .limit(50)
              .get()
          ).docs.map((doc: any) => ({
            id: doc.id as string,
            label: String(doc.get('label') ?? 'Card reader'),
            registerId: (doc.get('registerId') as string | undefined) ?? null,
            status: String(doc.get('status') ?? 'offline'),
            livemode: Boolean(doc.get('livemode')),
          }))
        : []
      return res.status(200).json({
        settings: posRegisterSettings(
          await getPluginConfig(staff.orgId || undefined, 'commerce', { hostId }),
        ),
        terminal: { available: posTerminalAvailable(), testMode: posStripeTestMode() },
        readers,
        publishableKey: String(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''),
        // A text receipt is offered only when an SMS provider is on (AGL-3610).
        smsReceipts: pluginSmsAvailable(),
      })
    }
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' })
    const startsPayment = [
      'card-present-sdk',
      'cash',
      'gift-card',
      'folio',
      'card-present',
      'card-keyed',
      'card-link',
    ].includes(action)
    const attemptKey = posIdempotencyKey(req)
    if (startsPayment && !attemptKey) {
      return res.status(400).json({ error: 'Missing Idempotency-Key' })
    }
    const paymentId = startsPayment
      ? posPaymentId(orderId, attemptKey)
      : String(body['paymentId'] ?? '')
    // The cashier a PIN switched in takes the payment (AGL-3609).
    if (startsPayment && body['cashierAssertion']) {
      staff = {
        ...staff,
        uid: await posPaymentCashierId({
          hostId,
          orderId,
          signedInUid: staff.uid,
          assertion: body['cashierAssertion'],
        }),
      }
    }
    const amountCents = Math.round(Number(body['amountCents'] ?? 0))
    const tipCents = Math.round(Number(body['tipCents'] ?? 0)) || 0
    const settings = posRegisterSettings(
      await getPluginConfig(staff.orgId || undefined, 'commerce', { hostId }),
    )
    let outcome: (PosPaymentOutcome & { clientSecret?: string; paymentIntentId?: string }) | null = null
    switch (action) {
      case 'sale': {
        const order = await readPosSale(hostId, orderId)
        if (!order) return res.status(404).json({ error: 'Unknown sale' })
        outcome = { ok: true, order, payment: null, completed: false, changed: false }
        break
      }
      case 'cash':
        outcome = await takeCash(staff, orderId, paymentId, body, tipCents)
        break
      case 'gift-card':
        outcome = await takeGiftCard(staff, orderId, paymentId, body)
        break
      case 'folio':
        outcome = await takeFolio(staff, orderId, paymentId, body)
        break
      case 'card-present':
        outcome = await startCardPresentPayment({
          hostId,
          orderId,
          paymentId,
          amountCents,
          tipCents,
          cashierId: staff.uid,
          org: staff.org,
          readerId: String(body['readerId'] ?? ''),
          settings,
        })
        break
      case 'card-present-sdk':
        // Collected by a native app's Stripe Terminal SDK (Tap to Pay or a
        // Bluetooth reader, AGL-3618) against this server-made intent; it
        // settles exactly like a smart-reader payment.
        outcome = await createCardPresentIntent({
          hostId,
          orderId,
          paymentId,
          amountCents,
          tipCents,
          cashierId: staff.uid,
          org: staff.org,
        })
        break
      case 'card-keyed':
        outcome = await startCardKeyedPayment({
          hostId,
          orderId,
          paymentId,
          amountCents,
          tipCents,
          cashierId: staff.uid,
          org: staff.org,
        })
        break
      case 'card-link':
        outcome = await startCardLinkPayment({
          hostId,
          orderId,
          paymentId,
          amountCents,
          tipCents,
          cashierId: staff.uid,
          org: staff.org,
          returnUrl: await registerReturnUrl(req.headers.host, hostId, staff),
        })
        break
      case 'status':
        outcome = await refreshPosCardPayment({ hostId, orderId, paymentId })
        break
      case 'cancel':
        outcome = await cancelPosCardPayment({ hostId, orderId, paymentId })
        break
      case 'retry':
        outcome = await retryCardPresentPayment({ hostId, orderId, paymentId, settings })
        break
      case 'simulate':
        outcome = await simulatePosReaderTap({
          hostId,
          orderId,
          paymentId,
          cardNumber: String(body['cardNumber'] ?? ''),
        })
        break
      case 'void':
        outcome = await voidPosSale(staff, orderId)
        break
      case 'receipt':
        outcome = await recordReceiptChoice(staff, orderId, body)
        break
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
    if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error })
    return res.status(200).json({
      sale: posSaleSummary(outcome.order),
      ...(outcome.payment ? { paymentId: outcome.payment.id } : {}),
      completed: outcome.order.status === 'paid',
      ...(outcome.clientSecret ? { clientSecret: outcome.clientSecret } : {}),
      ...(outcome.paymentIntentId ? { paymentIntentId: outcome.paymentIntentId } : {}),
    })
  } catch (error) {
    console.error('[pos-payment]', action, error)
    return res.status(500).json({ error: 'Payment failed — check the sale before trying again' })
  }
}

/** Where a QR payment page sends the customer back to: the register. */
async function registerReturnUrl(
  requestHost: string | string[] | undefined,
  hostId: string,
  staff: PosStaff,
): Promise<string> {
  const origin = `https://${String(requestHost ?? '')}`
  const subdomain = (
    await firebaseAdmin.app().firestore().collection('hostIndex').doc(hostId).get()
  ).get('subdomain') as string | undefined
  const orgSlug = staff.org?.['slug'] as string | undefined
  return orgSlug && subdomain
    ? `${origin}${buildRoute(Route.HOST_PLUGIN, { orgSlug, host: subdomain, pluginSlug: 'pos' })}`
    : origin
}

/** The balance a new tender may take, or a refusal. */
function tenderable(
  order: PosLiftedOrder,
  payments: CommerceModel.OrderPayment[],
): number {
  return CommerceModel.posTenderableCents(Number(order.totals?.totalCents ?? 0), payments)
}

const NOT_OPEN = { kind: 'refuse' as const, status: 409, error: 'This sale is no longer open' }

/**
 * Cash: the amount defaults to whatever is left, the change is what the
 * customer handed over beyond it (and beyond any tip they chose).
 */
async function takeCash(
  staff: PosStaff,
  orderId: string,
  paymentId: string,
  body: Record<string, any>,
  tipCents: number,
): Promise<PosPaymentOutcome> {
  const tenderedCents = Math.round(Number(body['tenderedCents'] ?? 0))
  const askedCents = Math.round(Number(body['amountCents'] ?? 0))
  return await applyPosPayment({
    hostId: staff.hostId,
    orderId,
    paymentId,
    decide: ({ order, payments, existing }) => {
      if (existing) return { kind: 'keep' }
      if (order.status !== 'pending') return NOT_OPEN
      if (!Number.isFinite(tenderedCents) || tenderedCents <= 0) {
        return { kind: 'refuse', status: 400, error: 'Enter the cash received.' }
      }
      const open = tenderable(order, payments)
      if (open <= 0) return { kind: 'refuse', status: 409, error: 'Nothing is left to pay on this sale.' }
      const amountCents =
        askedCents > 0 ? Math.min(askedCents, open) : Math.min(open, Math.max(0, tenderedCents - tipCents))
      if (!(amountCents > 0)) {
        return { kind: 'refuse', status: 400, error: 'The cash received does not cover the tip.' }
      }
      const tipProblem = CommerceModel.posTipProblem(tipCents, amountCents)
      if (tipProblem) return { kind: 'refuse', status: 400, error: tipProblem }
      if (tenderedCents < amountCents + tipCents) {
        return { kind: 'refuse', status: 400, error: 'Cash received is short' }
      }
      const total = Number(order.totals?.totalCents ?? 0)
      const now = Date.now()
      return {
        kind: 'put',
        payment: {
          id: paymentId,
          method: 'cash',
          amountCents,
          ...(tipCents > 0 ? { tipCents } : {}),
          status: 'succeeded',
          atMs: now,
          settledAtMs: now,
          cashTenderedCents: tenderedCents,
          changeCents: tenderedCents - amountCents - tipCents,
          takeFeeCents: CommerceModel.posTakeShareCents({
            takeFeeCents: Number(order.posTakeFeeCents ?? 0),
            totalCents: total,
            amountCents,
          }),
          feeCents: 0,
          cashierId: staff.uid,
        },
      }
    },
  })
}

function giftCardRef(hostId: string, code: string) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('giftCards')
    .doc(code)
}

/** A gift card's spendable balance, for the cashier to read to the customer. */
async function giftCardBalance(
  staff: PosStaff,
  body: Record<string, any>,
  res: Parameters<PluginApiHandler>[1],
): Promise<void> {
  const code = CommerceModel.giftCardCodeOf(body['code'])
  const rate = await consumeRateLimit(`pos-gift-balance:${staff.uid}`, {
    limit: 30,
    windowMs: 60_000,
  })
  if (!rate.allowed) {
    return res.status(429).json({ error: 'Too many balance checks. Wait a minute and try again.' })
  }
  if (CommerceModel.giftCardCodeProblem(code)) {
    return res.status(404).json({ error: 'No gift card has that code.' })
  }
  const snapshot = await giftCardRef(staff.hostId, code).get()
  if (!snapshot.exists) return res.status(404).json({ error: 'No gift card has that code.' })
  const card = snapshot.data() as CommerceModel.HostGiftCard
  return res.status(200).json({
    availableCents: CommerceModel.giftCardAvailableCents(card, Date.now()),
    frozen: CommerceModel.isGiftCardFrozen(card),
    voided: Number(card.voidedAtMs) > 0,
    last4: code.slice(-4),
  })
}

/**
 * A gift card: takes the smaller of what the card can give and what is left
 * to pay, in ONE transaction with the sale. The card's spendable balance
 * honours every live hold an online checkout placed on it (AGL-2449), and a
 * frozen card gives nothing (AGL-3363), so the till and the website can
 * never spend the same dollars.
 */
async function takeGiftCard(
  staff: PosStaff,
  orderId: string,
  paymentId: string,
  body: Record<string, any>,
): Promise<PosPaymentOutcome> {
  const code = CommerceModel.giftCardCodeOf(body['code'])
  if (CommerceModel.giftCardCodeProblem(code)) {
    return { ok: false, status: 404, error: 'No gift card has that code.' }
  }
  const askedCents = Math.round(Number(body['amountCents'] ?? 0))
  const cardRef = giftCardRef(staff.hostId, code)
  return await applyPosPayment({
    hostId: staff.hostId,
    orderId,
    paymentId,
    prepare: async (transaction) => {
      const snapshot = await transaction.get(cardRef)
      return snapshot.exists ? (snapshot.data() as CommerceModel.HostGiftCard) : null
    },
    decide: ({ order, payments, existing, context: card }) => {
      if (existing) return { kind: 'keep' }
      if (order.status !== 'pending') return NOT_OPEN
      if (!card) return { kind: 'refuse', status: 404, error: 'No gift card has that code.' }
      const available = CommerceModel.giftCardAvailableCents(card, Date.now())
      if (available <= 0) {
        return {
          kind: 'refuse',
          status: 409,
          error: CommerceModel.isGiftCardFrozen(card)
            ? 'This gift card is on hold and cannot be used right now.'
            : 'This gift card has no balance left.',
        }
      }
      const open = tenderable(order, payments)
      const amountCents = Math.min(available, open, askedCents > 0 ? askedCents : open)
      if (!(amountCents > 0)) {
        return { kind: 'refuse', status: 409, error: 'Nothing is left to pay on this sale.' }
      }
      const now = Date.now()
      return {
        kind: 'put',
        payment: {
          id: paymentId,
          method: 'gift_card',
          amountCents,
          status: 'succeeded',
          atMs: now,
          settledAtMs: now,
          giftCardId: code,
          last4: code.slice(-4),
          takeFeeCents: CommerceModel.posTakeShareCents({
            takeFeeCents: Number(order.posTakeFeeCents ?? 0),
            totalCents: Number(order.totals?.totalCents ?? 0),
            amountCents,
          }),
          feeCents: 0,
          cashierId: staff.uid,
        },
      }
    },
    write: (transaction, card, payment) => {
      transaction.set(
        cardRef,
        {
          balanceCents: Math.max(0, Number(card?.balanceCents ?? 0) - payment.amountCents),
          lastUsedAtMs: Date.now(),
        },
        { merge: true },
      )
    },
  })
}

function reservationRef(hostId: string, reservationId: string) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('reservations')
    .doc(reservationId)
}

/** Charged to a checked-in stay's folio, in the same commit as the payment. */
async function takeFolio(
  staff: PosStaff,
  orderId: string,
  paymentId: string,
  body: Record<string, any>,
): Promise<PosPaymentOutcome> {
  const reservationId = String(body['reservationId'] ?? '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(reservationId)) {
    return { ok: false, status: 400, error: 'Pick a reservation' }
  }
  const askedCents = Math.round(Number(body['amountCents'] ?? 0))
  const stayRef = reservationRef(staff.hostId, reservationId)
  return await applyPosPayment({
    hostId: staff.hostId,
    orderId,
    paymentId,
    prepare: async (transaction) => (await transaction.get(stayRef)).exists as boolean,
    decide: ({ order, payments, existing, context: stayExists }) => {
      if (existing) return { kind: 'keep' }
      if (order.status !== 'pending') return NOT_OPEN
      if (!stayExists) return { kind: 'refuse', status: 404, error: 'Unknown reservation' }
      const open = tenderable(order, payments)
      const amountCents = Math.min(open, askedCents > 0 ? askedCents : open)
      if (!(amountCents > 0)) {
        return { kind: 'refuse', status: 409, error: 'Nothing is left to pay on this sale.' }
      }
      const now = Date.now()
      return {
        kind: 'put',
        payment: {
          id: paymentId,
          method: 'folio',
          amountCents,
          status: 'succeeded',
          atMs: now,
          settledAtMs: now,
          reservationId,
          folioAtMs: now,
          takeFeeCents: CommerceModel.posTakeShareCents({
            takeFeeCents: Number(order.posTakeFeeCents ?? 0),
            totalCents: Number(order.totals?.totalCents ?? 0),
            amountCents,
          }),
          feeCents: 0,
          cashierId: staff.uid,
        },
        event: { event: 'folio', detail: `Charged to reservation ${reservationId}` },
      }
    },
    write: (transaction, _stay, payment) => {
      // `update`, never a merge-set: a missing stay must not be minted as a
      // stub holding one folio line (AGL-1760). It exists — read above.
      transaction.update(stayRef, {
        folio: firebaseAdmin.firestore.FieldValue.arrayUnion({
          orderId,
          paymentId: payment.id,
          amountCents: payment.amountCents,
          note: 'Register sale',
          atMs: payment.folioAtMs ?? Date.now(),
        }),
      })
    },
  })
}

/**
 * Abandons an open sale: everything it took is handed back first — cards
 * refunded in full (tip included, fee and transfer reversed), gift cards
 * re-credited, the room charge taken off the folio, cash marked as returned —
 * and only then is the order cancelled. A refund Stripe refuses stops the void
 * with the sale still open and its payment still recorded, never cancelled
 * over money that did not come back.
 */
export async function voidPosSale(
  staff: PosStaff,
  orderId: string,
): Promise<PosPaymentOutcome> {
  const hostId = staff.hostId
  const order = await readPosSale(hostId, orderId)
  if (!order) return { ok: false, status: 404, error: 'Unknown sale' }
  if (order.status === 'cancelled') return { ok: true, order, payment: null, completed: false, changed: false }
  if (order.status !== 'pending' || !Array.isArray(order.payments)) {
    return {
      ok: false,
      status: 409,
      error: 'This sale is already paid. Refund it from the order instead.',
    }
  }
  for (const payment of CommerceModel.orderPayments(order)) {
    if (payment.status === 'pending' && CommerceModel.isCardPaymentMethod(payment.method)) {
      const cancelled = await cancelPosCardPayment({ hostId, orderId, paymentId: payment.id })
      if (!cancelled.ok) return cancelled
    }
  }
  // Re-read after the cancels: one may have completed the sale in the gap.
  const current = await readPosSale(hostId, orderId)
  if (!current) return { ok: false, status: 404, error: 'Unknown sale' }
  if (current.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      error: 'The last card payment went through and the sale is paid. Refund it from the order instead.',
    }
  }
  for (const payment of CommerceModel.orderPayments(current)) {
    if (payment.status !== 'succeeded') continue
    const reversed = await reversePayment(staff, current, payment)
    if (!reversed.ok) return reversed
  }
  const firestore = firebaseAdmin.app().firestore()
  const orderRef = firestore.collection('hosts').doc(hostId).collection('orders').doc(orderId)
  const cancelled = await firestore.runTransaction(async (transaction: any) => {
    const fresh = {
      ...(CommerceModel.liftLegacyOrder(((await transaction.get(orderRef)).data() ?? {}) as any) as any),
      $id: orderId,
    } as PosLiftedOrder
    if (fresh.status !== 'pending') return null
    const open = CommerceModel.orderPayments(fresh).some(
      (payment) => payment.status === 'pending' || payment.status === 'succeeded',
    )
    if (open) return null
    const next = {
      ...fresh,
      status: 'cancelled' as const,
      timeline: CommerceModel.appendOrderEvent(fresh, 'pos-sale-voided', 'Voided at the register'),
    }
    transaction.set(
      orderRef,
      {
        status: 'cancelled',
        cancelledAtMs: Date.now(),
        timeline: next.timeline,
        ...CommerceModel.orderListFields(next, orderId),
      },
      { merge: true },
    )
    return next
  })
  if (!cancelled) {
    return { ok: false, status: 409, error: 'A payment on this sale changed. Check it and try again.' }
  }
  await releasePosSaleDiscount(hostId, current)
  return { ok: true, order: cancelled, payment: null, completed: false, changed: true }
}

/** Hands one settled payment back, recording `reversed` in the same commit. */
async function reversePayment(
  staff: PosStaff,
  order: PosLiftedOrder,
  payment: CommerceModel.OrderPayment,
): Promise<PosPaymentOutcome> {
  const hostId = staff.hostId
  if (CommerceModel.isCardPaymentMethod(payment.method)) {
    if (!payment.paymentIntentId) {
      return { ok: false, status: 409, error: 'A card payment on this sale has no charge to refund.' }
    }
    const refund = await posStripe('POST', 'refunds', {
      idempotencyKey: `pos-void:${payment.id}`,
      params: {
        payment_intent: payment.paymentIntentId,
        reverse_transfer: true,
        refund_application_fee: true,
        'metadata[kind]': 'pos-void',
        'metadata[orderId]': order.$id,
      },
    })
    if (!refund.ok) {
      return {
        ok: false,
        status: 502,
        error: posStripeErrorMessage(refund.body, 'The card refund failed. The sale is still open.'),
      }
    }
  }
  const cardRef = payment.giftCardId ? giftCardRef(hostId, payment.giftCardId) : null
  const stayRef = payment.reservationId ? reservationRef(hostId, payment.reservationId) : null
  return await applyPosPayment({
    hostId,
    orderId: order.$id,
    paymentId: payment.id,
    prepare: async (transaction) => {
      if (payment.method === 'gift_card' && cardRef) {
        const snapshot = await transaction.get(cardRef)
        return { card: snapshot.exists ? (snapshot.data() as CommerceModel.HostGiftCard) : null, folio: null }
      }
      if (payment.method === 'folio' && stayRef) {
        const snapshot = await transaction.get(stayRef)
        return { card: null, folio: snapshot.exists ? ((snapshot.get('folio') ?? []) as any[]) : null }
      }
      return { card: null, folio: null }
    },
    decide: ({ existing }) => {
      if (!existing) return { kind: 'refuse', status: 404, error: 'Unknown payment' }
      if (existing.status !== 'succeeded') return { kind: 'keep' }
      return {
        kind: 'put',
        payment: { ...existing, status: 'reversed' },
        event: {
          event: 'pos-payment-reversed',
          detail:
            existing.method === 'cash'
              ? `${CommerceModel.describeOrderPayment(existing)} handed back in cash`
              : `${CommerceModel.describeOrderPayment(existing)} returned`,
        },
      }
    },
    write: (transaction, context, reversed) => {
      if (reversed.method === 'gift_card' && cardRef && context.card) {
        transaction.set(
          cardRef,
          { balanceCents: Number(context.card.balanceCents ?? 0) + reversed.amountCents },
          { merge: true },
        )
      }
      if (reversed.method === 'folio' && stayRef && context.folio) {
        transaction.update(stayRef, {
          folio: context.folio.filter((entry) => entry?.paymentId !== reversed.id),
        })
      }
    },
  })
}

/** A repeat of the same receipt choice inside this window sends nothing more. */
const RECEIPT_REPEAT_WINDOW_MS = 2 * 60 * 1000

/**
 * How the customer wants their receipt, from the cashier or the customer
 * display. Kept on the order; an email chosen after the sale is paid is sent
 * at once, and one chosen before is sent when it completes.
 */
async function recordReceiptChoice(
  staff: PosStaff,
  orderId: string,
  body: Record<string, any>,
): Promise<PosPaymentOutcome> {
  const channel = String(body['channel'] ?? '') as CommerceModel.PosReceiptChannel
  if (!['email', 'sms', 'print', 'none'].includes(channel)) {
    return { ok: false, status: 400, error: 'Choose email, text, print or no receipt.' }
  }
  const to =
    channel === 'email'
      ? CommerceModel.posDisplayEmail(body['to'])
      : channel === 'sms'
        ? CommerceModel.posDisplayPhone(body['to'])
        : ''
  if ((channel === 'email' || channel === 'sms') && !to) {
    return {
      ok: false,
      status: 400,
      error: channel === 'email' ? 'Enter a valid email address.' : 'Enter a valid phone number.',
    }
  }
  if (channel === 'sms' && !pluginSmsAvailable()) {
    return { ok: false, status: 409, error: 'Text receipts are not set up for this store.' }
  }
  const marketingOptIn = channel === 'email' && body['marketingOptIn'] === true
  const firestore = firebaseAdmin.app().firestore()
  const orderRef = firestore.collection('hosts').doc(staff.hostId).collection('orders').doc(orderId)
  const order = await firestore.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(orderRef)
    if (!snapshot.exists) return null
    const fresh = {
      ...(CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as any) as any),
      $id: orderId,
    } as PosLiftedOrder
    if (fresh.channel !== 'pos') return null
    // The same choice twice in a row (a double tap, or the display and the
    // cashier answering together) is one receipt, not two.
    const previous = fresh.receiptRequest
    if (
      fresh.status === 'paid' &&
      previous &&
      previous.channel === channel &&
      String(previous.to ?? '') === to &&
      Date.now() - Number(previous.atMs ?? 0) < RECEIPT_REPEAT_WINDOW_MS
    ) {
      return { ...fresh, repeated: true } as PosLiftedOrder & { repeated?: boolean }
    }
    const receiptRequest = {
      channel,
      ...(to ? { to } : {}),
      ...(marketingOptIn ? { marketingOptIn: true } : {}),
      atMs: Date.now(),
    }
    transaction.set(
      orderRef,
      {
        receiptRequest,
        ...(channel === 'email' && !fresh.customerEmail
          ? {
              customerEmail: to,
              ...CommerceModel.orderListFields({ ...fresh, customerEmail: to }, orderId),
            }
          : {}),
        // The receipt door texts `customerPhone` (AGL-3610).
        ...(channel === 'sms' ? { customerPhone: to } : {}),
      },
      { merge: true },
    )
    return { ...fresh, receiptRequest } as PosLiftedOrder & { repeated?: boolean }
  })
  if (!order) return { ok: false, status: 404, error: 'Unknown sale' }
  if (order.repeated) return { ok: true, order, payment: null, completed: false, changed: false }
  if (order.status === 'paid' && channel === 'print') {
    // Chosen after the sale completed: printed now on the register's receipt
    // printer, under the sale's own key so it never prints twice (AGL-3609).
    await printPosSaleReceipt(staff.hostId, orderId)
  }
  if (order.status === 'paid' && order.registerId) {
    // The customer has answered (or the cashier for them): the display says
    // thank you and drops the address they typed (AGL-3608).
    await finishPosDisplayReceipt(staff.hostId, order.registerId).catch((error: unknown) =>
      console.error('[pos-payment] display finish failed', error),
    )
  }
  if (order.status === 'paid' && (channel === 'email' || channel === 'sms')) {
    // Chosen after the sale completed: sent now, to where they said.
    const sent = await deliverChosenPosReceipt(
      { hostId: staff.hostId, orderId },
      { channel, to, orderEmail: String(order.customerEmail ?? '') },
    )
    if (channel === 'email') {
      await recordCapturedContact({
        orgId: '',
        hostId: staff.hostId,
        identity: { email: to },
        surface: 'relationship',
        lifecycleFloor: 'customer',
        ...(marketingOptIn ? { marketingConsent: true } : {}),
        interaction: {
          source: 'order',
          refId: orderId,
          summary: `In-store purchase (${CommerceModel.formatReceiptMoney(
            Number(order.totals?.totalCents ?? 0),
            POS_CURRENCY,
          )})`,
        },
      }).catch((error: unknown) => console.error('[pos-payment] contact capture failed', error))
    }
    if (sent !== 'sent') {
      // A failed send is not a repeat: the cashier's retry goes out.
      await orderRef
        .set({ receiptRequest: { atMs: 0 } }, { merge: true })
        .catch((error: unknown) => console.error('[pos-payment] receipt retry reset failed', error))
    }
    if (sent === 'not_configured') {
      return {
        ok: false,
        status: 409,
        error: channel === 'sms' ? 'Text receipts are not set up for this store.' : 'Email is not set up.',
      }
    }
    if (sent !== 'sent') return { ok: false, status: 502, error: 'The receipt could not be sent.' }
  }
  return { ok: true, order, payment: null, completed: false, changed: true }
}
