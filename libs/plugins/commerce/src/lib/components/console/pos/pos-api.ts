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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import type * as CommerceModel from '../../../model'
import type { PosRegisterSettings } from '../../../plugin-config'

/**
 * The register's client half (AGL-3607): one place that knows the routes, so
 * the components ask "take cash" rather than building requests. Every call
 * that starts a payment carries the attempt key it is given; the server
 * derives the payment from it, so a retried press finds the same payment.
 */

/** The open sale as the server reports it after every change. */
export interface PosSaleSummary {
  orderId: string
  status: string
  totalCents: number
  paidCents: number
  dueCents: number
  tenderableCents: number
  tipCents: number
  payments: Array<{
    id: string
    method: CommerceModel.OrderPaymentMethod
    amountCents: number
    tipCents?: number
    status: CommerceModel.OrderPaymentStatus
    cardBrand?: string
    last4?: string
    changeCents?: number
    checkoutUrl?: string
    readerId?: string
    failureMessage?: string
    livemode?: boolean
  }>
}

export interface PosTenderResult {
  sale: PosSaleSummary
  paymentId?: string
  completed: boolean
  clientSecret?: string
  paymentIntentId?: string
}

export interface PosRegisterContext {
  settings: PosRegisterSettings
  terminal: { available: boolean; testMode: boolean }
  readers: Array<{
    id: string
    label: string
    registerId: string | null
    status: string
    livemode: boolean
  }>
  publishableKey: string
  smsReceipts: boolean
}

type User = Parameters<typeof authorizedFetch>[0]

export class PosRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function call<T>(
  user: User,
  route: string,
  body: Record<string, unknown>,
  options: { attemptKey?: string; method?: 'GET' | 'POST' } = {},
): Promise<T> {
  const method = options.method ?? 'POST'
  const url =
    method === 'GET'
      ? `${route}?${new URLSearchParams(
          Object.entries(body).map(([key, value]) => [key, String(value)]),
        ).toString()}`
      : route
  const response = await authorizedFetch(user, url, {
    method,
    headers: {
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...(options.attemptKey ? { 'Idempotency-Key': options.attemptKey } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new PosRequestError(String(payload?.error ?? 'Something went wrong'), response.status)
  }
  return payload as T
}

/** A fresh attempt key, for one press of one tender. */
export function newAttemptKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

export function posRegisterContext(user: User, hostId: string) {
  return call<PosRegisterContext>(user, '/api/commerce/pos-payment', { action: 'context', hostId }, { method: 'GET' })
}

/** Prices the basket on the server and opens a sale with an empty ledger. */
export function openPosSale(
  user: User,
  attemptKey: string,
  body: {
    hostId: string
    registerId: string
    lines: unknown[]
    discountPct: number
    customerEmail?: string
    locationId?: string
  },
) {
  return call<{ orderId: string; totals: CommerceModel.OrderTotals; dueCents: number; stockWarnings?: unknown[] }>(
    user,
    '/api/commerce/pos-order',
    { ...body, payment: 'open' },
    { attemptKey },
  )
}

export type PosTenderAction =
  | 'cash'
  | 'gift-card'
  | 'folio'
  | 'card-present'
  | 'card-present-sdk'
  | 'card-keyed'
  | 'card-link'
  | 'status'
  | 'cancel'
  | 'retry'
  | 'simulate'
  | 'void'
  | 'receipt'

export function posTender(
  user: User,
  hostId: string,
  orderId: string,
  action: PosTenderAction,
  body: Record<string, unknown> = {},
  attemptKey?: string,
) {
  return call<PosTenderResult>(
    user,
    '/api/commerce/pos-payment',
    { ...body, action, hostId, orderId },
    attemptKey ? { attemptKey } : {},
  )
}

export function posGiftCardBalance(user: User, hostId: string, code: string) {
  return call<{ availableCents: number; frozen: boolean; voided: boolean; last4: string }>(
    user,
    '/api/commerce/pos-payment',
    { action: 'gift-card-balance', hostId, code },
  )
}

export function posDisplayCall<T = any>(
  user: User,
  body: Record<string, unknown>,
  method: 'GET' | 'POST' = 'POST',
) {
  return call<T>(user, '/api/commerce/pos-display', body, { method })
}

export function posReadersCall<T = any>(user: User, body: Record<string, unknown>) {
  return call<T>(user, '/api/commerce/pos-readers', body)
}

/** Cents as the register shows them. */
export const usd = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`

/** A dollar string the cashier typed, as whole cents (NaN-safe, never negative). */
export function centsFromInput(value: string): number {
  const number = Math.round(Number(String(value).replace(/[^0-9.]/g, '')) * 100)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/*==========================================
 * THE NATIVE BRIDGE (AGL-3618).
 *
 * The POS companion app loads this register in a WebView and injects
 * `window.AglynPosBridge`. When it is there, the register offers a third
 * card option — Tap to Pay or a Bluetooth reader — and hands the app a
 * PaymentIntent the SERVER created (`card-present-sdk`); the app collects
 * the card with the Stripe Terminal SDK and the register settles it exactly
 * like a smart-reader payment, by asking the server.
 *=========================================*/

export interface AglynPosBridge {
  collectCardPayment(input: {
    paymentIntentId: string
    clientSecret: string
    amountCents: number
  }): Promise<{ status: 'collected' | 'canceled' | 'failed'; message?: string }>
}

export function posNativeBridge(): AglynPosBridge | null {
  const bridge = (globalThis as { AglynPosBridge?: AglynPosBridge }).AglynPosBridge
  return bridge && typeof bridge.collectCardPayment === 'function' ? bridge : null
}
