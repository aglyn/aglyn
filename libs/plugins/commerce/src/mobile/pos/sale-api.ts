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

import type { MobileApiClient } from '@aglyn/mobile-plugin-host'
import type { OrderPaymentMethod, OrderPaymentStatus, PosReceiptChannel } from '../../lib/model/commerce-pos'
import { type PosCart, cartSaleLines } from './cart'

/*==========================================
 * THE REGISTER'S ROUTES (AGL-3618).
 *
 * The app sells through the SAME routes the console register sells through,
 * with the member's ID token, so every gate the console has (a site role
 * that may sell, `managePos`, the `pos` entitlement, the register's plan
 * seat, the discount ceiling) holds on the phone unchanged:
 *
 * - `commerce/pos-order` with `payment: 'open'` prices the basket on the
 *   server and opens a PENDING sale with an empty tender ledger;
 * - `commerce/pos-payment` takes each tender against it (`card-present-sdk`
 *   for this device's reader, `card-present` for a smart reader on the
 *   counter, `cash`), re-reads a card payment from Stripe (`status`), stops
 *   one (`cancel`), voids an unpaid sale (`void`) and records the receipt.
 *
 * Every money-moving call carries an Idempotency-Key the caller keeps for
 * that one attempt, so a retry after a lost answer finds the payment the
 * first press started instead of taking the money twice.
 *=========================================*/

const ORDER_ROUTE = '/api/commerce/pos-order'
const PAYMENT_ROUTE = '/api/commerce/pos-payment'

export interface PosRegisterSettings {
  tippingEnabled: boolean
  tipPercentages: number[]
  receiptDefault: 'ask' | 'print' | 'none'
}

export interface PosSmartReader {
  id: string
  label: string
  registerId: string | null
  status: string
  livemode: boolean
}

export interface PosContext {
  settings: PosRegisterSettings
  /** Card readers are offered on this deployment at all. */
  terminalAvailable: boolean
  testMode: boolean
  /** The site's smart (internet) readers, driven through the server. */
  readers: PosSmartReader[]
  smsReceipts: boolean
}

function numberList(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.map(Number).filter((value) => Number.isFinite(value) && value > 0) : []
}

export function readPosContext(body: unknown): PosContext {
  const record = (body ?? {}) as Record<string, any>
  const settings = (record['settings'] ?? {}) as Record<string, unknown>
  const receipt = String(settings['receiptDefault'] ?? 'ask')
  return {
    settings: {
      tippingEnabled: settings['tippingEnabled'] === true,
      tipPercentages: numberList(settings['tipPercentages']).slice(0, 4),
      receiptDefault: receipt === 'print' || receipt === 'none' ? receipt : 'ask',
    },
    terminalAvailable: record['terminal']?.['available'] === true,
    testMode: record['terminal']?.['testMode'] === true,
    readers: (Array.isArray(record['readers']) ? record['readers'] : [])
      .filter((reader: any) => typeof reader?.id === 'string')
      .map((reader: any) => ({
        id: String(reader.id),
        label: String(reader.label ?? 'Card reader'),
        registerId: typeof reader.registerId === 'string' ? reader.registerId : null,
        status: String(reader.status ?? 'offline'),
        livemode: reader.livemode === true,
      })),
    smsReceipts: record['smsReceipts'] === true,
  }
}

export async function fetchPosContext(api: MobileApiClient, hostId: string): Promise<PosContext> {
  return readPosContext(await api.request(PAYMENT_ROUTE, { method: 'GET', query: { hostId, action: 'context' } }))
}

/** A sale as the payment route answers it (`posSaleSummary`). */
export interface PosSalePayment {
  id: string
  method: OrderPaymentMethod
  amountCents: number
  tipCents?: number
  status: OrderPaymentStatus
  cardBrand?: string
  last4?: string
  changeCents?: number
  readerId?: string
  failureMessage?: string
  livemode?: boolean
}

export interface PosSale {
  orderId: string
  status: string
  totalCents: number
  paidCents: number
  dueCents: number
  tenderableCents: number
  tipCents: number
  payments: PosSalePayment[]
}

export interface PosOpenedSale {
  orderId: string
  totals: { subtotalCents?: number; discountCents?: number; taxCents?: number; totalCents: number }
  dueCents: number
  stockWarnings: Array<{ name?: string; requested?: number; available?: number }>
}

/** Opens the sale: the server prices the basket and holds it pending. */
export async function openSale(input: {
  api: MobileApiClient
  hostId: string
  registerId: string
  locationId: string | null
  cart: PosCart
  attemptKey: string
}): Promise<PosOpenedSale> {
  const body = (await input.api.request(ORDER_ROUTE, {
    method: 'POST',
    idempotencyKey: input.attemptKey,
    body: {
      hostId: input.hostId,
      registerId: input.registerId,
      ...(input.locationId ? { locationId: input.locationId } : {}),
      payment: 'open',
      lines: cartSaleLines(input.cart),
      ...(input.cart.discountPct > 0 ? { discountPct: input.cart.discountPct } : {}),
      ...(input.cart.customerEmail ? { customerEmail: input.cart.customerEmail } : {}),
    },
  })) as Record<string, any>
  const totals = (body['totals'] ?? {}) as PosOpenedSale['totals']
  return {
    orderId: String(body['orderId'] ?? ''),
    totals: { ...totals, totalCents: Math.round(Number(totals.totalCents ?? 0)) },
    dueCents: Math.round(Number(body['dueCents'] ?? totals.totalCents ?? 0)),
    stockWarnings: Array.isArray(body['stockWarnings']) ? body['stockWarnings'] : [],
  }
}

export interface PosPaymentAnswer {
  sale: PosSale
  paymentId: string | null
  completed: boolean
  clientSecret: string | null
  paymentIntentId: string | null
}

export function readPaymentAnswer(body: unknown): PosPaymentAnswer {
  const record = (body ?? {}) as Record<string, any>
  const sale = (record['sale'] ?? {}) as Record<string, any>
  const cents = (value: unknown) => Math.round(Number(value ?? 0)) || 0
  return {
    sale: {
      orderId: String(sale['orderId'] ?? ''),
      status: String(sale['status'] ?? ''),
      totalCents: cents(sale['totalCents']),
      paidCents: cents(sale['paidCents']),
      dueCents: cents(sale['dueCents']),
      tenderableCents: cents(sale['tenderableCents']),
      tipCents: cents(sale['tipCents']),
      payments: Array.isArray(sale['payments']) ? sale['payments'] : [],
    },
    paymentId: typeof record['paymentId'] === 'string' ? record['paymentId'] : null,
    completed: record['completed'] === true,
    clientSecret: typeof record['clientSecret'] === 'string' ? record['clientSecret'] : null,
    paymentIntentId: typeof record['paymentIntentId'] === 'string' ? record['paymentIntentId'] : null,
  }
}

type PaymentAction =
  | { action: 'card-present-sdk'; amountCents: number; tipCents: number }
  | { action: 'card-present'; amountCents: number; tipCents: number; readerId: string }
  | { action: 'cash'; amountCents?: number; tipCents: number; tenderedCents: number }
  | { action: 'status' | 'cancel' | 'retry' | 'simulate'; paymentId: string }
  | { action: 'sale' }
  | { action: 'void' }
  | { action: 'receipt'; channel: PosReceiptChannel; to?: string; marketingOptIn?: boolean }

const STARTS_PAYMENT = new Set(['card-present-sdk', 'card-present', 'cash'])

/** One call to the payment route; a payment-starting action needs its attempt key. */
export async function salePayment(input: {
  api: MobileApiClient
  hostId: string
  orderId: string
  step: PaymentAction
  attemptKey?: string
}): Promise<PosPaymentAnswer> {
  if (STARTS_PAYMENT.has(input.step.action) && !input.attemptKey) {
    throw new Error('A payment needs its attempt key.')
  }
  const body = await input.api.request(PAYMENT_ROUTE, {
    method: 'POST',
    ...(input.attemptKey ? { idempotencyKey: input.attemptKey } : {}),
    body: { hostId: input.hostId, orderId: input.orderId, ...input.step },
  })
  return readPaymentAnswer(body)
}

/** The payment the last answer started or re-read. */
export function paymentOf(answer: PosPaymentAnswer): PosSalePayment | null {
  return answer.sale.payments.find((payment) => payment.id === answer.paymentId) ?? null
}
