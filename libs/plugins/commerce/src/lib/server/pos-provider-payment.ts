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
  listPluginPaymentOptions,
  pluginPaymentProvider,
  type PluginPaymentApproval,
  type PluginPaymentCheckoutOwner,
  type PluginPaymentCheckoutRef,
  type PluginPaymentEvent,
  type PluginPaymentOption,
  type PluginPaymentSettlement,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { firebaseAdmin, notifyHostManagers } from '@aglyn/tenant-data-admin'
import { createHash } from 'node:crypto'
import * as CommerceModel from '../model'
import { applyPosPayment, readPosSale, type PosPaymentOutcome } from './pos-sale'

/**
 * Another plugin's payment provider at the register (AGL-3630): the
 * cashier picks it, the customer scans a QR code and pays on the provider's
 * page — PayPal, or Venmo where PayPal offers it — and the sale's ledger
 * takes a `wallet_link` payment when the money moves.
 *
 * The payment is reserved on the ledger FIRST (`applyPosPayment`, the one
 * writer of a sale's payments), so the amount cannot be tendered twice
 * while the customer is paying; the provider's checkout is opened for it
 * with the payment's id as its key, so a repeated press opens one; and the
 * provider calls back as this checkout owner — to confirm the payment is
 * still wanted, to settle it, to lapse it — and every one of those goes
 * through the same ledger writer.
 */

export const COMMERCE_POS_CHECKOUT_KIND = 'commerce-pos'

/** How long the customer has to pay before the register gives the amount back. */
const POS_PROVIDER_CHECKOUT_TTL_MS = 31 * 60 * 1000

/** The providers the register may offer for in-person sales. */
export async function posPaymentOptions(orgId: string, hostId: string): Promise<PluginPaymentOption[]> {
  return listPluginPaymentOptions({ orgId, hostId, currency: 'usd', channel: 'in-person' }, { timeoutMs: 1_500 })
}

/** The provider checkout id a register payment is known by: one per payment. */
export function posProviderCheckoutId(providerId: string, paymentId: string): string {
  return `pay_${providerId.replace(/-/g, '')}_${createHash('sha256').update(`pos:${paymentId}`).digest('hex').slice(0, 32)}`
}

export async function startProviderLinkPayment(start: {
  hostId: string
  orderId: string
  paymentId: string
  amountCents: number
  tipCents: number
  cashierId: string
  orgId: string
  providerId: string
  merchantName: string
  returnUrl: string
}): Promise<PosPaymentOutcome> {
  const option = (await posPaymentOptions(start.orgId, start.hostId)).find(
    (entry) => entry.providerId === start.providerId,
  )
  const provider = pluginPaymentProvider(start.providerId)
  if (!option || !provider) return { ok: false, status: 409, error: 'That way to pay is not available here.' }
  const reserved = await applyPosPayment({
    hostId: start.hostId,
    orderId: start.orderId,
    paymentId: start.paymentId,
    decide: ({ order, payments, existing }) => {
      if (existing) return { kind: 'keep' }
      if (order.status !== 'pending') return { kind: 'refuse', status: 409, error: 'This sale is no longer open' }
      const total = Number(order.totals?.totalCents ?? 0)
      const tenderable = CommerceModel.posTenderableCents(total, payments)
      if (!(start.amountCents > 0)) return { kind: 'refuse', status: 400, error: 'Enter an amount to charge.' }
      if (start.amountCents > tenderable) {
        return {
          kind: 'refuse',
          status: 409,
          error:
            tenderable > 0
              ? `Only $${(tenderable / 100).toFixed(2)} is left to pay on this sale.`
              : 'Nothing is left to pay on this sale.',
        }
      }
      const tipProblem = CommerceModel.posTipProblem(start.tipCents, start.amountCents)
      if (tipProblem) return { kind: 'refuse', status: 400, error: tipProblem }
      return {
        kind: 'put',
        payment: {
          id: start.paymentId,
          method: 'wallet_link',
          amountCents: start.amountCents,
          ...(start.tipCents > 0 ? { tipCents: start.tipCents } : {}),
          status: 'pending',
          atMs: Date.now(),
          takeFeeCents: CommerceModel.posTakeShareCents({
            takeFeeCents: Number(order.posTakeFeeCents ?? 0),
            totalCents: total,
            amountCents: start.amountCents,
          }),
          cashierId: start.cashierId,
          providerId: option.providerId,
          providerLabel: option.label,
        },
      }
    },
  })
  if (!reserved.ok || !reserved.payment) return reserved
  const payment = reserved.payment
  if (payment.checkoutUrl || payment.status !== 'pending') return reserved
  const checkoutId = posProviderCheckoutId(start.providerId, payment.id)
  const separator = start.returnUrl.includes('?') ? '&' : '?'
  let redirectUrl = ''
  let livemode = false
  try {
    const started = await provider.createCheckout({
      ownerKind: COMMERCE_POS_CHECKOUT_KIND,
      checkoutId,
      orgId: start.orgId,
      hostId: start.hostId,
      currency: 'usd',
      channel: 'in-person',
      lines: [
        { name: 'In-store purchase', quantity: 1, unitCents: payment.amountCents, ships: false },
        ...(Number(payment.tipCents ?? 0) > 0
          ? [{ name: 'Tip', quantity: 1, unitCents: Number(payment.tipCents), ships: false }]
          : []),
      ],
      discountCents: 0,
      taxCents: 0,
      // The platform's share of this payment, taken by the provider: the
      // transaction fee alone — the provider bills its own processing.
      platformFeeCents: Math.max(0, Math.min(Number(payment.takeFeeCents ?? 0), payment.amountCents)),
      ...(start.merchantName ? { merchantName: start.merchantName } : {}),
      returnUrl: `${start.returnUrl}${separator}paid=1`,
      cancelUrl: `${start.returnUrl}${separator}paid=0`,
      metadata: { type: 'pos-payment', hostId: start.hostId, orderId: start.orderId, paymentId: payment.id },
      expiresAtMs: Date.now() + POS_PROVIDER_CHECKOUT_TTL_MS,
    })
    redirectUrl = started.redirectUrl
    livemode = started.livemode
  } catch (error) {
    console.error(`[pos-provider] ${start.providerId} refused payment ${payment.id}`, error)
  }
  return await applyPosPayment({
    hostId: start.hostId,
    orderId: start.orderId,
    paymentId: payment.id,
    decide: ({ existing }) => {
      if (!existing || existing.status !== 'pending') return { kind: 'keep' }
      return redirectUrl
        ? { kind: 'put', payment: { ...existing, checkoutUrl: redirectUrl, providerCheckoutId: checkoutId, livemode } }
        : {
            kind: 'put',
            payment: { ...existing, status: 'failed', failureMessage: `${existing.providerLabel ?? 'The provider'}'s payment page could not be created.` },
          }
    },
  })
}

function posRef(ref: Pick<PluginPaymentCheckoutRef, 'hostId' | 'metadata'>): { orderId: string; paymentId: string } | null {
  if (ref.metadata?.['type'] !== 'pos-payment' || String(ref.metadata?.['hostId'] ?? '') !== ref.hostId) return null
  const orderId = String(ref.metadata?.['orderId'] ?? '')
  const paymentId = String(ref.metadata?.['paymentId'] ?? '')
  return orderId && paymentId ? { orderId, paymentId } : null
}

/** Is the register still waiting for this payment, for this amount? */
async function approvePosProviderPayment(approval: PluginPaymentApproval): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ids = posRef(approval)
  if (!ids) return { ok: false, reason: 'This payment is not this store’s.' }
  const order = await readPosSale(approval.hostId, ids.orderId)
  const payment = order ? CommerceModel.orderPayments(order).find((entry) => entry.id === ids.paymentId) : undefined
  if (!order || !payment || payment.status !== 'pending' || order.status !== 'pending') {
    return { ok: false, reason: 'The register is no longer waiting for this payment. Nothing was charged.' }
  }
  if (approval.totalCents !== payment.amountCents + Number(payment.tipCents ?? 0)) {
    return { ok: false, reason: 'This payment does not match the sale. Nothing was charged.' }
  }
  return { ok: true }
}

/** The money moved: the payment succeeds on the ledger, completing the sale when it is the last. */
async function settlePosProviderPayment(settlement: PluginPaymentSettlement): Promise<void> {
  const ids = posRef(settlement)
  if (!ids) throw new Error(`settlement ${settlement.checkoutId} is not a register payment`)
  const outcome = await applyPosPayment({
    hostId: settlement.hostId,
    orderId: ids.orderId,
    paymentId: ids.paymentId,
    decide: ({ existing }) => {
      if (!existing) return { kind: 'refuse', status: 404, error: 'Unknown payment' }
      if (existing.status === 'succeeded') return { kind: 'keep' }
      // A payment the cashier gave up on, paid anyway, is still money that
      // moved: it is recorded, and an overpaid sale says so on its timeline.
      return {
        kind: 'put',
        payment: {
          ...existing,
          status: 'succeeded',
          settledAtMs: settlement.settledAtMs,
          providerPaymentId: settlement.paymentId,
          feeCents: settlement.platformFeeCents,
          livemode: settlement.livemode,
        },
        event: {
          event: 'pos-payment',
          detail: `${settlement.providerLabel} paid $${(settlement.amountCents / 100).toFixed(2)}`,
        },
      }
    },
  })
  if ('error' in outcome) throw new Error(`register payment ${ids.paymentId} not settled: ${outcome.error}`)
}

/** The customer never paid: the amount goes back to the balance. */
async function expirePosProviderPayment(ref: PluginPaymentCheckoutRef): Promise<void> {
  const ids = posRef(ref)
  if (!ids) return
  await applyPosPayment({
    hostId: ref.hostId,
    orderId: ids.orderId,
    paymentId: ids.paymentId,
    decide: ({ existing }) =>
      existing?.status === 'pending'
        ? {
            kind: 'put',
            payment: { ...existing, status: 'failed', failureMessage: 'The customer did not finish paying.' },
          }
        : { kind: 'keep' },
  })
}

/** A refund, reversal or dispute on a register payment, written on the sale. */
async function posProviderPaymentEvent(event: PluginPaymentEvent): Promise<void> {
  const ids = posRef(event)
  if (!ids) return
  const orderRef = firebaseAdmin.app().firestore().collection('hosts').doc(event.hostId).collection('orders').doc(ids.orderId)
  const snapshot = await orderRef.get()
  if (!snapshot.exists) return
  const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
  const seen = (order.timeline ?? []).some((line) => String(line.detail ?? '').includes(`[${event.eventId}]`))
  if (seen) return
  const dollars = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`
  const detail =
    event.kind === 'refunded'
      ? `${event.providerLabel} has refunded ${dollars(Number(event.refundedCents ?? 0))} of this payment in total`
      : event.kind === 'disputed'
        ? `The customer opened a ${event.providerLabel} dispute over ${dollars(Number(event.amountCents ?? 0))}`
        : event.kind === 'dispute-closed'
          ? `The ${event.providerLabel} dispute closed`
          : event.kind === 'reversed'
            ? `${event.providerLabel} took back ${dollars(Number(event.amountCents ?? 0))}`
            : `${event.providerLabel} declined this payment`
  await orderRef.set(
    { timeline: CommerceModel.appendOrderEvent(order, event.kind === 'refunded' ? 'refund' : 'dispute', `${detail} [${event.eventId}]`, event.atMs) },
    { merge: true },
  )
  if (event.kind === 'disputed' || event.kind === 'reversed') {
    void notifyHostManagers(event.hostId, {
      type: 'content.order',
      title: `${event.providerLabel}: ${detail}`,
      body: `${detail} on register sale ${CommerceModel.formatOrderNumber(order, ids.orderId)} on {site}. Respond in ${event.providerLabel}.`,
      link: `/${event.hostId}/products/orders?order=${encodeURIComponent(ids.orderId)}`,
    })
  }
}

export const commercePosCheckoutOwner: PluginPaymentCheckoutOwner = {
  approve: approvePosProviderPayment,
  settle: settlePosProviderPayment,
  expire: expirePosProviderPayment,
  onPaymentEvent: posProviderPaymentEvent,
}

/** Refunds a settled register payment through its provider (a void, or a refund). */
export async function refundPosProviderPayment(input: {
  orgId: string
  hostId: string
  payment: CommerceModel.OrderPayment
  amountCents: number
  idempotencyKey: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = input.payment.providerId ? pluginPaymentProvider(input.payment.providerId) : null
  if (!provider || !input.payment.providerPaymentId) {
    return { ok: false, error: `${input.payment.providerLabel ?? 'That provider'} is not available to refund this payment. Refund it there directly.` }
  }
  const result = await provider.refund({
    orgId: input.orgId,
    hostId: input.hostId,
    paymentId: input.payment.providerPaymentId,
    amountCents: input.amountCents,
    currency: 'usd',
    idempotencyKey: input.idempotencyKey,
  })
  return 'error' in result ? { ok: false, error: result.error } : { ok: true }
}
