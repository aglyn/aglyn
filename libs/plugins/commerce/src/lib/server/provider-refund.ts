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

import { pluginPaymentProvider } from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import type { StripeRefundResult } from './stripe-refund'

/**
 * A refund of an order paid through another plugin's payment provider
 * (AGL-3630), answered in the card refund's own shape so `refund.ts` runs
 * the same reservation, rollback and bookkeeping either way. The provider
 * returns its platform fee in proportion, as the card path's
 * `refund_application_fee` does.
 */
export async function refundThroughProvider(input: {
  providerId: string
  paymentId: string
  orgId: string
  hostId: string
  amountCents: number
  idempotencyKey: string
}): Promise<StripeRefundResult> {
  const provider = pluginPaymentProvider(input.providerId)
  if (!provider) {
    return {
      ok: false,
      status: 409,
      code: 'provider_unavailable',
      error: 'This order was paid with a payment method that is not available any more. Refund it with that provider directly.',
    }
  }
  try {
    const result = await provider.refund({
      orgId: input.orgId,
      hostId: input.hostId,
      paymentId: input.paymentId,
      amountCents: input.amountCents,
      currency: 'usd',
      idempotencyKey: input.idempotencyKey,
    })
    if ('error' in result) return { ok: false, status: result.status, code: 'provider_refused', error: result.error }
    return { ok: true, refundId: result.refundId }
  } catch (error) {
    console.error(`[provider-refund] ${input.providerId} refund failed`, error)
    return { ok: false, status: 502, code: 'provider_failed', error: 'Refund failed' }
  }
}
