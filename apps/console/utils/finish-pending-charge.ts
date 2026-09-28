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

import { getBrowserStripe } from './browser-stripe'

/**
 * What `/api/billing/subscription` (switch) and `/api/billing/addons` (set)
 * answer when the charge for a change did not go through on the spot
 * (AGL-3358): Stripe is holding the change until its invoice is paid.
 */
export interface PendingChargePayload {
  paymentPending?: boolean
  requiresAction?: boolean
  paymentClientSecret?: string
  declined?: boolean
  hostedInvoiceUrl?: string
}

export interface PendingChargeResult {
  /**
   * The bank confirmed the payment. Stripe pays the invoice and applies the
   * held change; the webhook mirrors it, so the caller reloads what it shows.
   */
  confirmed: boolean
  /** What to tell the customer when `confirmed` is false. */
  message: string
}

/**
 * Finish a held charge from the browser, the same way the first subscribe
 * finishes one.
 *
 * `handleNextAction` and not `confirmPayment`, for the reason the subscribe
 * path and `billing-sca-handles-next-action.spec.tsx` give: the route answers
 * `requiresAction` only for an intent in `requires_action`, which is the one
 * status `handleNextAction` is defined for, and the card is the one already on
 * the customer.
 *
 * When Stripe.js cannot load, the hosted invoice page is the other way to pay
 * the same invoice, and paying it there applies the change just the same.
 * A declined card has nothing to finish here: the customer needs a different
 * payment method first.
 */
export async function finishPendingCharge(
  payload: PendingChargePayload,
  what: string,
): Promise<PendingChargeResult> {
  if (payload.requiresAction && payload.paymentClientSecret) {
    const stripe = await getBrowserStripe()
    if (!stripe) {
      if (payload.hostedInvoiceUrl && typeof window !== 'undefined') {
        window.open(payload.hostedInvoiceUrl, '_blank', 'noopener')
        return {
          confirmed: false,
          message:
            'Your bank needs to confirm this payment. Finish it on the ' +
            `invoice page we just opened — ${what} once it's paid.`,
        }
      }
      return {
        confirmed: false,
        message:
          'Your bank needs to confirm this payment, but the payment library ' +
          'could not load. Nothing has changed and nothing has been charged.',
      }
    }
    const outcome = await stripe.handleNextAction({
      clientSecret: String(payload.paymentClientSecret),
    })
    if (outcome.error) {
      return {
        confirmed: false,
        message:
          (outcome.error.message
            ? `${outcome.error.message} `
            : 'Your bank did not confirm the payment. ') +
          'Nothing has changed and nothing has been charged.',
      }
    }
    return { confirmed: true, message: '' }
  }
  return {
    confirmed: false,
    message: payload.declined
      ? 'Your saved card was declined, so nothing has changed. Update your ' +
        'payment method and try again.'
      : 'The payment did not go through, so nothing has changed. Try again ' +
        'in a moment.',
  }
}
