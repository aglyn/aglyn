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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type {
  PluginPaymentProvider,
  PluginPaymentRefundRequest,
  PluginPaymentRefundResult,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { getOrgForHost } from '@aglyn/tenant-data-admin'
import { PAYPAL_ENTITLEMENT, PAYPAL_PROVIDER_ID } from '../constants'
import { createPayPalCheckout, findCheckoutByCaptureId, type PayPalCheckoutRecord } from './checkouts'
import { payPalConfigForMoney } from './config'
import { checkoutsCollection, payPalDb } from './db'
import { PAYPAL_CURRENCIES, payPalMoney, VENMO_CURRENCY } from './money'
import { payPalIssue, payPalRequest } from './paypal-api'
import { readySeller } from './sellers'

/**
 * PayPal behind core's payment-provider seam (AGL-3630). Offered for a sale
 * only when the deployment is configured for money (`config.ts`), the
 * workspace's plan sells, the store's currency is one PayPal takes, and the
 * workspace's seller account is ready. Venmo is listed for US dollars; the
 * buyer's own eligibility (US account, device) is PayPal's to decide on the
 * page, which hides the button when it says no.
 */
export const payPalProvider: PluginPaymentProvider = {
  async available(request) {
    const config = payPalConfigForMoney()
    if (!config) return null
    const currency = String(request.currency ?? '').toLowerCase()
    if (!PAYPAL_CURRENCIES.has(currency)) return null
    const resolved = await getOrgForHost(request.hostId)
    if (!resolved || (request.orgId && resolved.orgId !== request.orgId)) return null
    if (!checkEntitlement(resolved.org as never, PAYPAL_ENTITLEMENT as never)) return null
    if (!(await readySeller(resolved.orgId, config))) return null
    return {
      providerId: PAYPAL_PROVIDER_ID,
      label: 'PayPal',
      methods: [
        { id: 'paypal', label: 'PayPal' },
        ...(currency === VENMO_CURRENCY ? [{ id: 'venmo', label: 'Venmo' }] : []),
      ],
      livemode: config.environment === 'live',
    }
  },

  async createCheckout(request) {
    const config = payPalConfigForMoney()
    if (!config) throw new Error('PayPal is not configured on this deployment')
    return createPayPalCheckout(config, request)
  },

  async refund(request) {
    return refundPayPalCapture(request)
  },
}

/**
 * Refunds part or all of a capture, for the seller, with the platform's fee
 * returned in proportion — what the card path does with
 * `refund_application_fee`, so a refunded sale costs the merchant no fee on
 * money they no longer have. The last refund of a capture returns whatever
 * of the fee is left, so rounding never strands a cent of it.
 */
export async function refundPayPalCapture(request: PluginPaymentRefundRequest): Promise<PluginPaymentRefundResult> {
  const config = payPalConfigForMoney()
  if (!config) return { ok: false, status: 501, error: 'PayPal is not configured on this deployment.' }
  if (!Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) {
    return { ok: false, status: 400, error: 'Refund a whole amount above zero.' }
  }
  const found = await findCheckoutByCaptureId(request.paymentId)
  if (!found || found.record.orgId !== request.orgId || found.record.hostId !== request.hostId) {
    return { ok: false, status: 404, error: 'That PayPal payment was not found.' }
  }
  const { id: recordId, record } = found
  if (record.currency !== String(request.currency ?? '').toLowerCase()) {
    return { ok: false, status: 400, error: 'That refund is in another currency than the payment.' }
  }
  const captured = Number(record.capturedCents ?? 0)
  const refunded = Number(record.refundedCents ?? 0)
  if (request.amountCents > captured - refunded) {
    return { ok: false, status: 409, error: 'That is more than is left to refund on this PayPal payment.' }
  }
  const feeLeft = Math.max(0, record.platformFeeCents - Number(record.refundedFeeCents ?? 0))
  const closing = refunded + request.amountCents >= captured
  const feeCents = closing ? feeLeft : Math.min(feeLeft, Math.floor((record.platformFeeCents * request.amountCents) / Math.max(1, captured)))
  const response = await payPalRequest<{ id?: string; status?: string }>(config, {
    method: 'POST',
    path: `/v2/payments/captures/${encodeURIComponent(request.paymentId)}/refund`,
    requestId: `refund-${request.idempotencyKey}`.slice(0, 108),
    sellerMerchantId: record.merchantId,
    representation: true,
    body: {
      amount: payPalMoney(request.amountCents, record.currency),
      ...(request.note ? { note_to_payer: request.note.slice(0, 255) } : {}),
      ...(feeCents > 0
        ? { payment_instruction: { platform_fees: [{ amount: payPalMoney(feeCents, record.currency) }] } }
        : {}),
    },
  })
  if (!response.ok) {
    const issue = payPalIssue(response.body)
    console.error('[paypal] refund refused', { recordId, issue, status: response.status, debugId: response.debugId })
    if (issue === 'REFUND_AMOUNT_EXCEEDED' || issue === 'CAPTURE_FULLY_REFUNDED') {
      return { ok: false, status: 409, error: 'PayPal says there is less left to refund on this payment.' }
    }
    if (issue === 'PERMISSION_DENIED' || issue === 'NOT_AUTHORIZED' || response.status === 403) {
      return {
        ok: false,
        status: 409,
        error: 'PayPal refused: Aglyn no longer has permission to refund for this PayPal account. Refund it in PayPal, or connect PayPal again.',
      }
    }
    if (issue === 'TRANSACTION_REFUSED' || issue === 'REFUND_NOT_ALLOWED') {
      return {
        ok: false,
        status: 409,
        error: 'PayPal would not refund this payment — it may be disputed or too old. Refund it in PayPal.',
      }
    }
    return { ok: false, status: 502, error: 'PayPal could not refund this payment. Try again.' }
  }
  const refundId = String(response.body.id ?? '')
  const status = String(response.body.status ?? '')
  if (!refundId || status === 'CANCELLED' || status === 'FAILED') {
    return { ok: false, status: 502, error: 'PayPal could not refund this payment.' }
  }
  await recordRefund(recordId, refundId, request.amountCents, feeCents, status)
  return { ok: true, refundId, status: status === 'COMPLETED' ? 'completed' : 'pending' }
}

/** Adds one refund to the checkout's tally, once. */
export async function recordRefund(
  recordId: string,
  refundId: string,
  cents: number,
  feeCents: number,
  status: string,
  nowMs = Date.now(),
): Promise<PayPalCheckoutRecord | null> {
  return payPalDb().runTransaction(async (transaction) => {
    const ref = checkoutsCollection().doc(recordId)
    const fresh = (await transaction.get(ref)).data() as PayPalCheckoutRecord | undefined
    if (!fresh) return null
    const refunds = { ...(fresh.refunds ?? {}) }
    if (refunds[refundId]) {
      // Known: only its status may move.
      refunds[refundId] = { ...refunds[refundId], status }
    } else {
      refunds[refundId] = { cents, feeCents, status, atMs: nowMs }
    }
    const live = Object.values(refunds).filter((one) => one.status !== 'CANCELLED' && one.status !== 'FAILED')
    const next = {
      refunds,
      refundedCents: live.reduce((sum, one) => sum + one.cents, 0),
      refundedFeeCents: live.reduce((sum, one) => sum + one.feeCents, 0),
      updatedAtMs: nowMs,
    }
    transaction.set(ref, next, { merge: true })
    return { ...fresh, ...next }
  })
}
