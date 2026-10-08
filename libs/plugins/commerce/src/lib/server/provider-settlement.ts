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

import type {
  PluginPaymentApproval,
  PluginPaymentCheckoutOwner,
  PluginPaymentCheckoutRef,
  PluginPaymentEvent,
  PluginPaymentSettlement,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { firebaseAdmin, notifyHostManagers } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { ORDER_REFUNDED_EVENT } from '../model/order-events'
import { commerceBillingWebhookHandler } from './billing-webhook'
import { applyExternalRefundToGiftCards } from './gift-card-risk'
import { raiseOrderEvent } from './order-events'
import { COMMERCE_CART_CHECKOUT_KIND, isProviderCheckoutId } from './provider-checkout'

/**
 * A storefront cart paid through another plugin's payment provider
 * (AGL-3630), as commerce's checkout owner.
 *
 * ## One fulfilment, the card path's own
 *
 * {@link settleProviderCart} turns the provider's settlement into the
 * shape a paid Checkout Session has — the same `metadata[…]` the cart
 * handler set, the totals, the buyer, the address — and hands it to the
 * `commerce-cart` branch of `billing-webhook.ts`. That branch writes the
 * order in a transaction keyed on the checkout id and returns early when it
 * exists, so a settlement told twice (the buyer's return and the provider's
 * webhook) records one order, one receipt, one stock movement and one
 * redemption. An abandoned checkout is handed to the same file's expiry
 * branch, which gives back the stock, discount slots and gift-card balance
 * it held.
 *
 * Afterwards the order is stamped with the provider and its payment id —
 * what the refund route reads to send a refund back the way the money came.
 */

const ordersRef = (hostId: string) =>
  firebaseAdmin.app().firestore().collection('hosts').doc(hostId).collection('orders')

function isOurs(ref: Pick<PluginPaymentCheckoutRef, 'checkoutId' | 'hostId' | 'metadata'>): boolean {
  return (
    isProviderCheckoutId(ref.checkoutId) &&
    ref.metadata?.['type'] === 'commerce-cart' &&
    String(ref.metadata?.['hostId'] ?? '') === ref.hostId
  )
}

const normalizePostal = (value: unknown): string => String(value ?? '').replace(/\s+/g, '').toUpperCase()

/** Before money moves: is this cart's checkout still payable as the buyer chose it? */
export async function approveProviderCart(approval: PluginPaymentApproval): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isOurs(approval)) return { ok: false, reason: 'This checkout is not this store’s.' }
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(approval.hostId)
  const [order, checkout] = await Promise.all([
    hostRef.collection('orders').doc(approval.checkoutId).get(),
    hostRef.collection('checkouts').doc(approval.checkoutId).get(),
  ])
  if (order.exists || checkout.get('status') === 'completed') {
    return { ok: false, reason: 'This order is already paid.' }
  }
  if (approval.shippingOptionId) {
    if (!approval.shippingAddress?.country) {
      return { ok: false, reason: 'Choose a delivery address for this order.' }
    }
    // A carrier rate was quoted for the postal code the buyer declared in the
    // cart; an address elsewhere would be delivered at someone else's price.
    const quoted = normalizePostal(approval.metadata?.['shippingQuotePostalCode'])
    if (quoted && normalizePostal(approval.shippingAddress.postalCode) !== quoted) {
      return {
        ok: false,
        reason: `Your delivery price was quoted for postal code ${quoted}. Choose an address there, or go back to the store and check out again.`,
      }
    }
  }
  return { ok: true }
}

/**
 * The shape a paid card session has, built from a provider's settlement:
 * what the `commerce-cart` webhook branch reads. Exported for the spec.
 */
export function providerSessionObject(
  settlement: PluginPaymentSettlement,
  checkout: { email?: string; resumeUrl?: string },
) {
  const address = settlement.shippingAddress
  const email = String(checkout.email ?? '').trim() || settlement.payer.email || null
  const name = settlement.payer.name ?? address?.name ?? null
  const resumeUrl = String(checkout.resumeUrl ?? '')
  return {
    id: settlement.checkoutId,
    object: 'checkout.session',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    currency: settlement.currency,
    amount_total: settlement.amountCents,
    amount_subtotal: settlement.breakdown.itemsCents,
    total_details: {
      amount_discount: settlement.breakdown.discountCents,
      amount_shipping: settlement.breakdown.shippingCents,
      amount_tax: settlement.breakdown.taxCents,
    },
    automatic_tax: { enabled: false },
    customer_details: { email, name },
    shipping_details: address
      ? {
          name: address.name ?? name,
          address: {
            line1: address.line1 ?? null,
            line2: address.line2 ?? null,
            city: address.city ?? null,
            state: address.state ?? null,
            postal_code: address.postalCode ?? null,
            country: address.country ?? null,
          },
        }
      : null,
    payment_intent: null,
    // The download links in the receipt are built from the store's origin.
    success_url: resumeUrl ? `${resumeUrl}${resumeUrl.includes('?') ? '&' : '?'}order=success` : '',
    metadata: { ...settlement.metadata },
  }
}

/** The money moved: record the order through the card path's own branch. Idempotent. */
export async function settleProviderCart(settlement: PluginPaymentSettlement): Promise<void> {
  if (!isOurs(settlement)) throw new Error(`settlement ${settlement.checkoutId} is not a commerce cart`)
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(settlement.hostId)
  const checkout = (await hostRef.collection('checkouts').doc(settlement.checkoutId).get()).data() ?? {}
  const object = providerSessionObject(settlement, checkout as { email?: string; resumeUrl?: string })
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    event: {
      id: `${settlement.providerId}:${settlement.paymentId}`,
      type: 'checkout.session.completed',
      livemode: settlement.livemode,
      data: { object },
    },
  })
  const orderRef = ordersRef(settlement.hostId).doc(settlement.checkoutId)
  if (!(await orderRef.get()).exists) {
    // The branch wrote nothing — the cart's host or metadata did not resolve.
    // Thrown, so the provider tells us again rather than the money going
    // unrecorded; and said, so somebody can find out why.
    throw new Error(`provider settlement ${settlement.checkoutId} on ${settlement.hostId} recorded no order`)
  }
  await orderRef.set(
    {
      paymentProvider: settlement.providerId,
      paymentProviderLabel: settlement.providerLabel,
      providerPaymentId: settlement.paymentId,
      providerCheckoutId: settlement.providerCheckoutId,
    },
    { merge: true },
  )
}

/** The checkout lapsed unpaid: give back what it held, through the card path's expiry branch. */
export async function expireProviderCart(ref: PluginPaymentCheckoutRef): Promise<void> {
  if (!isOurs(ref)) return
  const object = { id: ref.checkoutId, object: 'checkout.session', status: 'expired', metadata: { ...ref.metadata } }
  await commerceBillingWebhookHandler({
    type: 'checkout.session.expired',
    object,
    event: { id: `${ref.providerId}:${ref.providerCheckoutId}:expired`, type: 'checkout.session.expired', data: { object } },
  })
}

const dollars = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`

/** A refund, reversal or dispute the provider reported, written on the order. */
export async function providerCartPaymentEvent(event: PluginPaymentEvent): Promise<void> {
  if (!isOurs(event)) return
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(event.hostId)
  const orderRef = hostRef.collection('orders').doc(event.checkoutId)
  const label = event.providerLabel || 'the payment provider'
  if (event.kind === 'refunded') {
    // Recorded once, as the card path records a refund made in Stripe's
    // dashboard: the console's own refunds are already in `refundedCents`,
    // earlier outside ones in `externalRefundedCents`; anything beyond both
    // is new.
    const external = await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(orderRef)
      if (!fresh.exists) return null
      const data = (fresh.data() ?? {}) as Record<string, unknown>
      const order = CommerceModel.liftLegacyOrder(data as never)
      const consoleCents = Math.max(0, Number(order.refundedCents ?? 0))
      const externalCents = Math.max(0, Number(data['externalRefundedCents'] ?? 0))
      const newCents = Math.max(0, Number(event.refundedCents ?? 0)) - consoleCents - externalCents
      if (!(newCents > 0)) return null
      transaction.set(
        orderRef,
        {
          externalRefundedCents: externalCents + newCents,
          timeline: CommerceModel.appendOrderEvent(order, 'refund', `${dollars(newCents)} refunded outside the dashboard (in ${label})`),
        },
        { merge: true },
      )
      const totalCents = Number(order.totals?.totalCents ?? order.amountCents ?? 0)
      return {
        newCents,
        fullyRefunded: Number(event.refundedCents ?? 0) >= totalCents,
        lines: (order.lineItems ?? []).map((line) => ({
          productId: String(line.productId ?? ''),
          totalCents: Math.round(Number(line.unitAmountCents ?? 0)) * Math.max(1, Math.round(Number(line.quantity ?? 1))),
        })),
      }
    })
    if (!external) return
    await raiseOrderEvent(ORDER_REFUNDED_EVENT, {
      hostId: event.hostId,
      orderId: event.checkoutId,
      key: `external-refund:${event.paymentId}:${Number(event.refundedCents ?? 0)}`,
      extra: { refund: { id: null, amountCents: external.newCents, lineItemIds: [], full: external.fullyRefunded } },
    })
    await applyExternalRefundToGiftCards({
      firestore,
      hostRef,
      orderId: event.checkoutId,
      lines: external.lines,
      refundCents: external.newCents,
      fullyRefunded: external.fullyRefunded,
    })
    return
  }
  const snapshot = await orderRef.get()
  if (!snapshot.exists) return
  const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
  const number = CommerceModel.formatOrderNumber(order, event.checkoutId)
  const amount = dollars(Number(event.amountCents ?? order.totals?.totalCents ?? 0))
  const link = `/${event.hostId}/products/orders?order=${encodeURIComponent(event.checkoutId)}`
  if (event.kind === 'disputed') {
    if (order.dispute?.id === `${event.providerId}:${event.paymentId}` && !order.dispute.closedAtMs) return
    await orderRef.set(
      {
        dispute: {
          id: `${event.providerId}:${event.paymentId}`,
          status: 'needs_response',
          ...(event.detail ? { reason: event.detail } : {}),
          amountCents: Math.max(0, Number(event.amountCents ?? 0)),
          openedAtMs: event.atMs,
        },
        timeline: CommerceModel.appendOrderEvent(order, 'dispute', `The buyer opened a ${label} dispute over ${amount}`, event.atMs),
      },
      { merge: true },
    )
    void notifyHostManagers(event.hostId, {
      type: 'content.order',
      title: `${label} dispute on order ${number}`,
      body: `The buyer opened a dispute in ${label} over ${amount} on {site}. Respond in ${label}; refunds here wait until it is settled.`,
      link,
    })
    return
  }
  if (event.kind === 'dispute-closed') {
    const detail = String(event.detail ?? '')
    const outcome = /buyer/.test(detail) ? 'lost' : /seller/.test(detail) ? 'won' : 'closed'
    await orderRef.set(
      {
        dispute: {
          ...(order.dispute ?? { id: `${event.providerId}:${event.paymentId}`, amountCents: Number(event.amountCents ?? 0), openedAtMs: event.atMs }),
          status: outcome,
          outcome,
          closedAtMs: event.atMs,
        },
        timeline: CommerceModel.appendOrderEvent(order, 'dispute', `The ${label} dispute closed (${outcome})`, event.atMs),
      },
      { merge: true },
    )
    return
  }
  if (event.kind === 'reversed') {
    await orderRef.set(
      {
        timeline: CommerceModel.appendOrderEvent(order, 'refund', `${label} took back ${amount} from this payment${event.detail ? ` (${event.detail.replace(/_/g, ' ').toLowerCase()})` : ''}`, event.atMs),
      },
      { merge: true },
    )
    void notifyHostManagers(event.hostId, {
      type: 'content.order',
      title: `${label} reversed a payment on order ${number}`,
      body: `${label} took back ${amount} from order ${number} on {site}. Check ${label} for why.`,
      link,
    })
  }
}

export const commerceCartCheckoutOwner: PluginPaymentCheckoutOwner = {
  approve: approveProviderCart,
  settle: settleProviderCart,
  expire: expireProviderCart,
  onPaymentEvent: providerCartPaymentEvent,
}

export { COMMERCE_CART_CHECKOUT_KIND }
