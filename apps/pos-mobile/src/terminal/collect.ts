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

import type { PaymentIntent, PaymentIntentResultType, Reader, StripeError } from '@stripe/stripe-terminal-react-native'

/*==========================================
 * TAKING ONE CARD PAYMENT ON THE PHONE (AGL-3618).
 *
 * The register (the console POS page in the WebView) has already asked the
 * server for a `card_present` PaymentIntent for this sale: a DESTINATION
 * charge on the platform, `on_behalf_of` the merchant, MANUAL capture, keyed
 * to one payment in the order's ledger (AGL-3607). The app's job is only the
 * card: retrieve that intent, collect a card (Tap to Pay or a Bluetooth
 * reader) and confirm it, which AUTHORIZES the charge. The server then
 * captures it with the fee re-priced for any tip, exactly as it does for a
 * smart reader, when the register asks it to refresh the payment.
 *
 * So the app never creates, prices or captures money, and a result it
 * reports is a hint the server re-reads from Stripe, never a fact it trusts.
 *
 * Every outcome is one of three, because that is all the register can act
 * on: `collected` (authorized, ask the server to settle), `canceled` (the
 * cashier or customer stopped it; the same intent can be collected again),
 * `failed` (declined or broken, with words to read out).
 *=========================================*/

export type CollectOutcome =
  | { status: 'collected'; paymentIntentId: string; amountCents: number; tipCents: number }
  | { status: 'canceled'; paymentIntentId: string }
  | { status: 'failed'; paymentIntentId: string; message: string; code?: string }

export interface CollectRequest {
  paymentIntentId: string
  clientSecret: string
  /** Offer on-reader tipping, when the connected reader can show it. */
  tipEligible: boolean
  /**
   * What the register shows the customer, tip included. When given, an
   * intent for any other amount is refused before the card is asked for.
   */
  amountCents: number | null
}

/** The slice of `useStripeTerminal()` this needs; a spec passes a fake. */
export interface TerminalPaymentApi {
  retrievePaymentIntent(clientSecret: string): Promise<PaymentIntentResultType>
  collectPaymentMethod(params: {
    paymentIntent: PaymentIntent.Type
    skipTipping?: boolean
    customerCancellation?: 'enableIfAvailable' | 'disableIfAvailable' | 'unspecified'
  }): Promise<PaymentIntentResultType>
  confirmPaymentIntent(params: { paymentIntent: PaymentIntent.Type }): Promise<PaymentIntentResultType>
}

const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]{8,64}$/
const CLIENT_SECRET = /^(pi_[A-Za-z0-9]{8,64})_secret_[A-Za-z0-9]{8,128}$/

/** Validates what the page sent; null when it is a well-formed request. */
export function collectRequestProblem(params: Record<string, unknown>): string | null {
  const id = params['paymentIntentId']
  const secret = params['clientSecret']
  if (typeof id !== 'string' || !PAYMENT_INTENT_ID.test(id)) return 'The payment to collect is missing.'
  if (typeof secret !== 'string') return 'The payment to collect is missing.'
  const match = CLIENT_SECRET.exec(secret)
  // The secret names its own intent; one for a different intent is refused,
  // so a page cannot ask to collect A while the register records B.
  if (!match || match[1] !== id) return 'The payment to collect does not match its secret.'
  return null
}

export function readCollectRequest(params: Record<string, unknown>): CollectRequest {
  const problem = collectRequestProblem(params)
  if (problem) throw new Error(problem)
  return {
    paymentIntentId: String(params['paymentIntentId']),
    clientSecret: String(params['clientSecret']),
    tipEligible: params['tipEligible'] === true,
    amountCents:
      typeof params['amountCents'] === 'number' && Number.isInteger(params['amountCents']) && params['amountCents'] > 0
        ? params['amountCents']
        : null,
  }
}

/**
 * Readers that can show a tip screen. Tap to Pay and the M2 have no
 * customer-facing tip prompt here, so a tip on those is chosen on the
 * register (or the customer display) before the intent is created.
 */
export function readerCanTip(reader: Pick<Reader.Type, 'deviceType'> | null | undefined): boolean {
  return reader?.deviceType === 'wisePad3' || reader?.deviceType === 'wisePad3s'
}

function isCanceled(error: StripeError | undefined): boolean {
  return String(error?.code ?? '').toUpperCase() === 'CANCELED'
}

/** Words for a cashier: Stripe's decline message when it has one. */
export function collectErrorMessage(error: StripeError | undefined, fallback: string): string {
  const api = (error as unknown as { apiError?: { message?: string; declineCode?: string } })?.apiError
  if (api?.declineCode === 'insufficient_funds') return 'Declined: insufficient funds. Ask for another card.'
  if (api?.message) return api.message
  const code = String(error?.code ?? '').toUpperCase()
  if (code.startsWith('DECLINED')) return 'The card was declined. Ask for another card.'
  if (code === 'NOT_CONNECTED_TO_READER') return 'The card reader disconnected. Reconnect it and try again.'
  if (code === 'READER_BUSY') return 'The card reader is busy. Finish or cancel the other payment first.'
  if (code === 'TAP_TO_PAY_INSECURE_ENVIRONMENT') {
    return 'This phone cannot take a PIN right now. Turn off screen recording and overlays, then try again.'
  }
  return error?.message || fallback
}

export async function collectCardPayment(
  api: TerminalPaymentApi,
  request: CollectRequest,
  reader: Pick<Reader.Type, 'deviceType'> | null,
): Promise<CollectOutcome> {
  const id = request.paymentIntentId
  if (!reader) {
    return { status: 'failed', paymentIntentId: id, message: 'Connect Tap to Pay or a card reader first.' }
  }
  const retrieved = await api.retrievePaymentIntent(request.clientSecret)
  if (retrieved.error || !retrieved.paymentIntent) {
    return {
      status: 'failed',
      paymentIntentId: id,
      message: collectErrorMessage(retrieved.error, 'The payment could not be loaded. Try again.'),
      code: retrieved.error?.code,
    }
  }
  if (retrieved.paymentIntent.id !== id) {
    return { status: 'failed', paymentIntentId: id, message: 'The payment to collect does not match.' }
  }
  if (retrieved.paymentIntent.status === 'requiresCapture' || retrieved.paymentIntent.status === 'succeeded') {
    // Already authorized (a retry after a lost answer): report it again
    // rather than asking for the card twice.
    return succeeded(retrieved.paymentIntent)
  }
  if (request.amountCents !== null && Math.round(Number(retrieved.paymentIntent.amount)) !== request.amountCents) {
    return {
      status: 'failed',
      paymentIntentId: id,
      message: 'The amount to charge does not match the register. Start the payment again.',
    }
  }
  const collected = await api.collectPaymentMethod({
    paymentIntent: retrieved.paymentIntent,
    skipTipping: !(request.tipEligible && readerCanTip(reader)),
    customerCancellation: 'enableIfAvailable',
  })
  if (collected.error || !collected.paymentIntent) {
    if (isCanceled(collected.error)) return { status: 'canceled', paymentIntentId: id }
    return {
      status: 'failed',
      paymentIntentId: id,
      message: collectErrorMessage(collected.error, 'The card could not be read. Try again.'),
      code: collected.error?.code,
    }
  }
  const confirmed = await api.confirmPaymentIntent({ paymentIntent: collected.paymentIntent })
  if (confirmed.error || !confirmed.paymentIntent) {
    if (isCanceled(confirmed.error)) return { status: 'canceled', paymentIntentId: id }
    const after = confirmed.error?.paymentIntent
    if (after && (after.status === 'requiresCapture' || after.status === 'succeeded')) {
      return succeeded(after)
    }
    return {
      status: 'failed',
      paymentIntentId: id,
      message: collectErrorMessage(confirmed.error, 'The payment did not go through. Try again.'),
      code: confirmed.error?.code,
    }
  }
  return succeeded(confirmed.paymentIntent)
}

function succeeded(intent: PaymentIntent.Type): CollectOutcome {
  const tipCents = Math.max(0, Math.round(Number(intent.amountDetails?.tip?.amount ?? intent.amountTip ?? 0)))
  return {
    status: 'collected',
    paymentIntentId: intent.id,
    amountCents: Math.max(0, Math.round(Number(intent.amount ?? 0))),
    tipCents,
  }
}
