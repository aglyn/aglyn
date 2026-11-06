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
 * ONE STRIPE REFUND, the way every commerce refund sends one (AGL-3609).
 *
 * Shared by the order dialog's refund (`refund.ts`) and a return at the
 * register (`pos-return.ts`), so both take the money back the same way:
 *
 * - `reverse_transfer`: a destination charge's money sits in the
 *   merchant's connected account, so the refund pulls it back from there
 *   rather than out of the platform's balance.
 * - `refund_application_fee`: the platform hands its fee back on the
 *   refunded share, as it always has.
 * - the caller's IDEMPOTENCY KEY, so a retried request is the same refund
 *   at Stripe and never a second one.
 *
 * A DIRECT charge (the seller's own Stripe account sold it) is refunded ON
 * that account with the `Stripe-Account` header: the money comes out of the
 * seller's balance, where the sale settled, so there is no transfer to
 * reverse and `reverse_transfer` is never sent. `refund_application_fee` is
 * kept, so Aglyn hands its fee back on the refunded share exactly as it does
 * on a destination charge. A payment intent the seller's account does not
 * know (a sale from before the seller switched, or Aglyn's own hardware) is
 * refunded on the platform as a destination charge, so a caller may pass the
 * site's direct-charge account without first asking which kind the sale was.
 */
export type StripeRefundResult =
  | { ok: true; refundId: string }
  | { ok: false; status: number; error: string; code: string }

export async function createStripeRefund(input: {
  paymentIntentId: string
  amountCents: number
  idempotencyKey?: string | null
  metadata?: Record<string, string>
  /**
   * The seller's connected account when the sale was (or may have been) a
   * DIRECT charge. Absent for a destination sale.
   */
  stripeAccount?: string | null
  fetch?: typeof fetch
  secretKey?: string
}): Promise<StripeRefundResult> {
  const secretKey = input.secretKey ?? process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return { ok: false, status: 501, error: 'Payments are not configured.', code: 'not_configured' }
  }
  const send = input.fetch ?? fetch
  const post = (stripeAccount: string | null) => {
    const params = new URLSearchParams({
      payment_intent: input.paymentIntentId,
      amount: String(Math.round(input.amountCents)),
      ...(stripeAccount ? {} : { reverse_transfer: 'true' }),
      refund_application_fee: 'true',
    })
    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      params.set(`metadata[${key}]`, value)
    }
    return send('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
        ...(stripeAccount ? { 'Stripe-Account': stripeAccount } : {}),
      },
      body: params.toString(),
    })
  }
  const stripeAccount =
    typeof input.stripeAccount === 'string' && input.stripeAccount.trim()
      ? input.stripeAccount.trim()
      : null
  type RefundBody = {
    id?: string
    error?: { code?: string; message?: string; param?: string }
  }
  const read = async (sent: Response): Promise<RefundBody> =>
    (await Promise.resolve()
      .then(() => sent.json())
      .catch(() => ({}))) as RefundBody
  let response = await post(stripeAccount)
  let refund = await read(response)
  // Not the seller's payment: a destination sale on the platform. Stripe
  // answers a payment intent another account owns as `resource_missing`, and
  // scopes idempotency keys per account, so the same key is safe there.
  if (
    stripeAccount &&
    !response.ok &&
    (response.status === 404 ||
      (refund?.error?.code === 'resource_missing' &&
        (refund?.error?.param ?? 'payment_intent') === 'payment_intent'))
  ) {
    response = await post(null)
    refund = await read(response)
  }
  if (!response.ok) {
    const code = String(refund?.error?.code ?? '')
    if (code === 'charge_disputed' || code === 'refund_disputed_payment') {
      return {
        ok: false,
        status: 409,
        code,
        error:
          'Stripe refused this refund because the charge is disputed. ' +
          'Respond to the dispute or accept it in the Stripe dashboard; ' +
          'refund any remainder once it settles.',
      }
    }
    return { ok: false, status: 502, code, error: refund?.error?.message ?? 'Refund failed' }
  }
  return { ok: true, refundId: String(refund?.id ?? '') }
}
