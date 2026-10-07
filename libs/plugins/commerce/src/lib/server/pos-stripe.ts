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
  CARD_PROCESSING_PERCENT,
  PROCESSING_FIXED_CENTS,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { NATIVE_CHECKOUT_STRIPE_VERSION } from './native-checkout'

/**
 * The register's Stripe calls (AGL-3607), over raw `fetch` like every other
 * money route in this plugin.
 *
 * ## Pinned to one API version
 *
 * The platform account's default version predates the fields this flow reads
 * — `amount_details.tip` on a PaymentIntent, a reader's `action` — so every
 * request here carries the same `Stripe-Version` the storefront Payment
 * Element pins. Webhook deliveries keep the endpoint's version, which is why
 * the webhook branch never trusts the event's object and re-reads the
 * PaymentIntent through {@link posStripe} instead.
 *
 * ## Every create is keyed
 *
 * A caller passes the idempotency key; Stripe replays the first answer for a
 * repeated key, so a lost response cannot become a second charge.
 */
export const POS_STRIPE_VERSION = NATIVE_CHECKOUT_STRIPE_VERSION

/** The currency every register sale is in: the store charges in US dollars. */
export const POS_CURRENCY = 'usd'

export interface PosStripeResult<T = any> {
  ok: boolean
  status: number
  body: T & { error?: { message?: string; code?: string; type?: string } }
}

/** Form-encodes nested params the way Stripe reads them. */
export function posStripeForm(
  params: Record<string, string | number | boolean | undefined | null | readonly string[]>,
): URLSearchParams {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) form.append(`${key}[]`, String(item))
    } else {
      form.set(key, String(value))
    }
  }
  return form
}

/** One Stripe API request from the register's server routes. */
export async function posStripe<T = any>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: {
    params?: Record<string, string | number | boolean | undefined | null | readonly string[]>
    idempotencyKey?: string
  } = {},
): Promise<PosStripeResult<T>> {
  const form = posStripeForm(options.params ?? {})
  const query = method === 'GET' && [...form.keys()].length ? `?${form.toString()}` : ''
  const response = await fetch(`https://api.stripe.com/v1/${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': POS_STRIPE_VERSION,
      ...(method === 'POST'
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : {}),
      ...(options.idempotencyKey && method === 'POST'
        ? { 'Idempotency-Key': options.idempotencyKey.slice(0, 255) }
        : {}),
    },
    ...(method === 'POST' ? { body: form.toString() } : {}),
  })
  const body = (await response.json().catch(() => ({}))) as PosStripeResult<T>['body']
  return { ok: response.ok, status: response.status, body }
}

/** Whether the platform key is a test key: simulated readers only work there. */
export function posStripeTestMode(): boolean {
  return String(process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test_')
}

/**
 * Whether Stripe Terminal card readers are offered at all.
 *
 * Always in test mode, where Stripe's simulated reader needs nothing turned
 * on. In live mode only once `STRIPE_TERMINAL_LIVE_ENABLED` is `true`, which
 * is set after Terminal is activated for live payments on the platform's
 * Stripe account. Until then the register and the settings hide every reader
 * control rather than offering hardware that would be refused.
 */
export function posTerminalAvailable(): boolean {
  if (!process.env.STRIPE_SECRET_KEY) return false
  return (
    posStripeTestMode() ||
    String(process.env.STRIPE_TERMINAL_LIVE_ENABLED ?? '').toLowerCase() === 'true'
  )
}

/**
 * Stripe's processing cost on a register CARD payment, passed through at cost
 * beside the platform's take (the AGL-2152 rule, on the register's tenders).
 *
 * At the CARD rate, not `saleProcessingCostCents`'s dearest-method rate: every
 * register card payment pins its payment method types to `card` or
 * `card_present`, so no buy-now-pay-later method can be chosen and 2.9% + 30¢
 * is at least what Stripe debits (an in-person tap costs less). The base is
 * the whole CHARGE, tip included, because Stripe's own fee is on the whole
 * charge; the platform's take is not.
 */
export function posCardProcessingCostCents(chargeCents: number): number {
  if (!Number.isFinite(chargeCents) || chargeCents <= 0) return 0
  return (
    Math.ceil((chargeCents * CARD_PROCESSING_PERCENT) / 100) + PROCESSING_FIXED_CENTS
  )
}

/** The `application_fee_amount` for a register card payment. */
export function posCardApplicationFeeCents(input: {
  takeShareCents: number
  chargeCents: number
}): number {
  // The processing half is owed even on a plan whose take is 0%: Stripe debits
  // it from the platform on every destination charge (AGL-2071).
  const take = Math.max(0, Math.round(input.takeShareCents))
  return take + posCardProcessingCostCents(input.chargeCents)
}

/** A refusal Stripe sent, in words a cashier can read out. */
export function posStripeErrorMessage(
  body: { error?: { message?: string; code?: string } } | undefined,
  fallback: string,
): string {
  const code = String(body?.error?.code ?? '')
  if (code === 'terminal_reader_offline') {
    return 'The card reader is offline. Check it is on and connected to the internet.'
  }
  if (code === 'terminal_reader_busy') {
    return 'The card reader is busy with another payment. Cancel it on the reader or wait a moment.'
  }
  if (code === 'terminal_reader_timeout') {
    return 'The card reader did not answer in time. Try again.'
  }
  return String(body?.error?.message ?? '') || fallback
}
