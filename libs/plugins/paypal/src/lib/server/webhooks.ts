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
  pluginPaymentCheckoutOwner,
  type PluginPaymentEvent,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import {
  capturePayPalCheckout,
  checkoutRef,
  expireCheckout,
  findCheckoutByCaptureId,
  findCheckoutByOrderId,
  finishCaptureFromOrder,
  settleWithOwner,
  type PayPalCheckoutRecord,
} from './checkouts'
import type { PayPalConfig } from './config'
import { checkoutsCollection, webhookEventsCollection } from './db'
import { minorFromPayPal } from './money'
import { payPalRequest } from './paypal-api'
import { recordRefund } from './provider'
import { findSellerOrg, markSellerRevoked, refreshSeller } from './sellers'

/**
 * PayPal's webhook (AGL-3630), at `/api/paypal/webhook` on the console.
 *
 * ## Verified with PayPal before anything is read
 *
 * Every delivery is posted back to PayPal's `verify-webhook-signature` with
 * its five transmission headers and this deployment's webhook id; only a
 * `SUCCESS` is acted on. A forged event could otherwise mark an unpaid
 * order paid.
 *
 * ## Applied once
 *
 * An event id is written to `paypalWebhookEvents` only AFTER it has been
 * applied, so a delivery that failed part-way is redelivered and applied
 * again — every handler below is idempotent — and one that succeeded is
 * recognized and skipped.
 *
 * ## What each event does
 *
 * - `CHECKOUT.ORDER.APPROVED` — capture it, for a buyer whose browser closed
 *   between approving and returning (the same claimed, idempotent capture
 *   the browser runs).
 * - `PAYMENT.CAPTURE.COMPLETED` — a capture PayPal first held as pending, or
 *   one whose owner missed the news: tell the owner.
 * - `PAYMENT.CAPTURE.DENIED` / `DECLINED` — a pending capture was refused:
 *   the owner gives back what the checkout held.
 * - `PAYMENT.CAPTURE.REFUNDED` / `REVERSED` — tally it and tell the owner.
 * - `CUSTOMER.DISPUTE.CREATED` / `RESOLVED` — tell the owner.
 * - `MERCHANT.ONBOARDING.COMPLETED`, `MERCHANT.PARTNER-CONSENT.REVOKED`,
 *   `CUSTOMER.MERCHANT-INTEGRATION.*` — re-read the seller.
 */

export interface PayPalWebhookEvent {
  id?: string
  event_type?: string
  create_time?: string
  resource?: any
}

const TRANSMISSION_HEADERS = {
  auth_algo: 'paypal-auth-algo',
  cert_url: 'paypal-cert-url',
  transmission_id: 'paypal-transmission-id',
  transmission_sig: 'paypal-transmission-sig',
  transmission_time: 'paypal-transmission-time',
} as const

/** Whether PayPal vouches for this delivery. Never throws; anything but SUCCESS is `false`. */
export async function verifyPayPalWebhook(
  config: PayPalConfig,
  headers: Headers,
  event: PayPalWebhookEvent,
): Promise<boolean> {
  const values: Record<string, string> = {}
  for (const [field, header] of Object.entries(TRANSMISSION_HEADERS)) {
    const value = headers.get(header)
    if (!value) return false
    values[field] = value
  }
  // PayPal's certificate is served from PayPal; a delivery naming another
  // host is not PayPal's, whatever PayPal's verifier would say of it.
  try {
    const cert = new URL(values['cert_url'])
    if (cert.protocol !== 'https:' || !/(^|\.)paypal\.com$/.test(cert.hostname)) return false
  } catch {
    return false
  }
  const response = await payPalRequest<{ verification_status?: string }>(config, {
    method: 'POST',
    path: '/v1/notifications/verify-webhook-signature',
    body: { ...values, webhook_id: config.webhookId, webhook_event: event },
  }).catch(() => null)
  return Boolean(response?.ok && response.body?.verification_status === 'SUCCESS')
}

/** The capture id a refund or reversal resource points up to. */
export function captureIdOfRefund(resource: any): string {
  const up = (resource?.links ?? []).find((link: any) => link?.rel === 'up')?.href
  const match = /\/v2\/payments\/captures\/([^/?#]+)/.exec(String(up ?? ''))
  return match ? decodeURIComponent(match[1]) : ''
}

/**
 * Applies one verified event. Answers whether it was applied (or had
 * nothing to do); throws when it should be redelivered.
 */
export async function applyPayPalWebhook(
  config: PayPalConfig,
  event: PayPalWebhookEvent,
  nowMs = Date.now(),
): Promise<'applied' | 'duplicate' | 'ignored'> {
  const eventId = String(event.id ?? '')
  const type = String(event.event_type ?? '')
  if (!eventId || !type) return 'ignored'
  const seen = webhookEventsCollection().doc(eventId)
  if ((await seen.get()).exists) return 'duplicate'
  const resource = event.resource ?? {}
  let applied = true
  switch (type) {
    case 'CHECKOUT.ORDER.APPROVED': {
      const orderId = String(resource.id ?? '')
      const found = await findCheckoutByOrderId(orderId)
      if (!found) {
        applied = false
        break
      }
      const outcome = await capturePayPalCheckout(config, found.id, orderId, nowMs)
      // A capture another caller holds finishes there; anything retryable
      // is retried by redelivery.
      if (outcome.kind === 'refused' && outcome.status >= 500) throw new Error(outcome.message)
      break
    }
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const found = await findForCapture(resource)
      if (!found) {
        applied = false
        break
      }
      if (found.record.status !== 'captured') {
        // The order holds the payer and the address; read them from it.
        const orderId = String(resource?.supplementary_data?.related_ids?.order_id ?? found.record.captureOrderId ?? '')
        const finished = orderId ? await finishCaptureFromOrder(config, found.id, orderId, nowMs) : null
        if (!finished) throw new Error(`capture ${String(resource.id ?? '')} has no order to read`)
        break
      }
      await settleWithOwner(config, found.id, nowMs)
      break
    }
    case 'PAYMENT.CAPTURE.PENDING': {
      const found = await findForCapture(resource)
      if (found && (found.record.status === 'open' || found.record.status === 'capturing')) {
        await checkoutsCollection()
          .doc(found.id)
          .set({ status: 'pending', captureId: String(resource.id ?? ''), captureClaimAtMs: 0, updatedAtMs: nowMs }, { merge: true })
      }
      break
    }
    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED': {
      const found = await findForCapture(resource)
      if (found && found.record.status !== 'captured') await expireCheckout(found.id, nowMs, { denied: true })
      break
    }
    case 'PAYMENT.CAPTURE.REFUNDED': {
      const captureId = captureIdOfRefund(resource)
      const found = await findCheckoutByCaptureId(captureId)
      if (!found) {
        applied = false
        break
      }
      const cents = minorFromPayPal(resource.amount, found.record.currency) ?? 0
      const fee = minorFromPayPal(resource.seller_payable_breakdown?.platform_fees?.[0]?.amount, found.record.currency) ?? 0
      const record = await recordRefund(found.id, String(resource.id ?? eventId), cents, fee, String(resource.status ?? 'COMPLETED'), nowMs)
      if (record) {
        await tellOwner(found.id, record, {
          kind: 'refunded',
          paymentId: captureId,
          refundedCents: Number(record.refundedCents ?? 0),
          amountCents: cents,
          eventId,
          atMs: nowMs,
        })
      }
      break
    }
    case 'PAYMENT.CAPTURE.REVERSED': {
      const captureId = captureIdOfRefund(resource) || String(resource.id ?? '')
      const found = await findCheckoutByCaptureId(captureId)
      if (!found) {
        applied = false
        break
      }
      await tellOwner(found.id, found.record, {
        kind: 'reversed',
        paymentId: captureId,
        amountCents: minorFromPayPal(resource.amount, found.record.currency) ?? Number(found.record.capturedCents ?? 0),
        eventId,
        ...(resource.status_details?.reason ? { detail: String(resource.status_details.reason) } : {}),
        atMs: nowMs,
      })
      break
    }
    case 'CUSTOMER.DISPUTE.CREATED':
    case 'CUSTOMER.DISPUTE.RESOLVED': {
      const captureId = String(resource.disputed_transactions?.[0]?.seller_transaction_id ?? '')
      const found = await findCheckoutByCaptureId(captureId)
      if (!found) {
        applied = false
        break
      }
      const amount = minorFromPayPal(resource.dispute_amount, found.record.currency)
      await tellOwner(found.id, found.record, {
        kind: type === 'CUSTOMER.DISPUTE.CREATED' ? 'disputed' : 'dispute-closed',
        paymentId: captureId,
        ...(amount !== null ? { amountCents: amount } : {}),
        eventId,
        detail: [resource.reason, resource.dispute_outcome?.outcome_code].filter(Boolean).join(' · ').replace(/_/g, ' ').toLowerCase(),
        atMs: nowMs,
      })
      break
    }
    case 'MERCHANT.ONBOARDING.COMPLETED':
    case 'CUSTOMER.MERCHANT-INTEGRATION.SELLER-EMAIL-CONFIRMED':
    case 'CUSTOMER.MERCHANT-INTEGRATION.CAPABILITY-UPDATED':
    case 'CUSTOMER.MERCHANT-INTEGRATION.PRODUCT-SUBSCRIPTION-UPDATED': {
      const orgId = await findSellerOrg({
        trackingId: String(resource.tracking_id ?? ''),
        merchantId: String(resource.merchant_id ?? ''),
      })
      if (orgId) await refreshSeller(config, orgId, nowMs)
      else applied = false
      break
    }
    case 'MERCHANT.PARTNER-CONSENT.REVOKED': {
      const orgId = await findSellerOrg({ merchantId: String(resource.merchant_id ?? '') })
      if (orgId) await markSellerRevoked(orgId, nowMs)
      else applied = false
      break
    }
    default:
      applied = false
  }
  await seen.set({
    type,
    applied,
    receivedAtMs: nowMs,
    // Kept thirty days, longer than PayPal retries a delivery.
    expiresAt: new Date(nowMs + 30 * 24 * 60 * 60 * 1000),
  })
  return applied ? 'applied' : 'ignored'
}

async function findForCapture(resource: any): Promise<{ id: string; record: PayPalCheckoutRecord } | null> {
  const orderId = String(resource?.supplementary_data?.related_ids?.order_id ?? '')
  return (await findCheckoutByOrderId(orderId)) ?? (await findCheckoutByCaptureId(String(resource?.id ?? '')))
}

async function tellOwner(
  recordId: string,
  record: PayPalCheckoutRecord,
  event: Omit<PluginPaymentEvent, keyof ReturnType<typeof checkoutRef>>,
): Promise<void> {
  const owner = pluginPaymentCheckoutOwner(record.ownerKind)
  if (!owner?.onPaymentEvent) return
  await owner.onPaymentEvent({ ...checkoutRef(record, recordId), ...event })
}
