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

import { createHash } from 'node:crypto'
import {
  pluginPaymentCheckoutOwner,
  pluginPaymentCheckoutProblem,
  pluginPaymentCheckoutTotals,
  type PluginPaymentAddress,
  type PluginPaymentApproval,
  type PluginPaymentCheckoutRef,
  type PluginPaymentCheckoutRequest,
  type PluginPaymentCheckoutStarted,
  type PluginPaymentLine,
  type PluginPaymentSettlement,
  type PluginPaymentShipping,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { PAYPAL_API_ROUTES, PAYPAL_PROVIDER_ID } from '../constants'
import type { PayPalConfig } from './config'
import { checkoutsCollection, payPalDb } from './db'
import { minorFromPayPal, PAYPAL_CURRENCIES, payPalMoney, VENMO_CURRENCY } from './money'
import { payPalIssue, payPalOk, payPalRequest } from './paypal-api'
import { readySeller } from './sellers'

/**
 * One buyer's PayPal checkout (AGL-3630), from the owner's priced request
 * to the captured payment.
 *
 * ## The order is opened when the buyer picks a button, not before
 *
 * The owner's request is RECORDED here and the buyer is sent to this
 * plugin's page; the PayPal order is created only when they press PayPal or
 * Venmo, for that funding source — PayPal's own guidance, and the only way
 * one checkout can offer both. Each source's order is kept on the record,
 * and its creation carries a `PayPal-Request-Id`, so a double click opens
 * one order.
 *
 * ## One capture per checkout, whatever asks
 *
 * The buyer's browser captures on approval; PayPal's
 * `CHECKOUT.ORDER.APPROVED` webhook captures too, for a browser that closed
 * in between. Both go through {@link capturePayPalCheckout}, which takes a
 * claim on the record in a transaction before it calls PayPal — a second
 * caller is told the first is busy — and calls PayPal with a request id
 * derived from the record and the order, so even a claim that lapsed mid
 * flight cannot capture twice: PayPal answers the repeat with the first
 * capture. Only one of a checkout's orders (its PayPal one or its Venmo one)
 * can ever hold the claim.
 *
 * ## The owner decides, then is told
 *
 * Before money moves the owner is asked to approve what the buyer chose —
 * the address they picked inside PayPal is the first time anyone has seen
 * it — and after it moves the owner is told, as many times as it takes; its
 * settlement is idempotent on its own checkout id.
 */

export type PayPalFundingSource = 'paypal' | 'venmo'

export type PayPalCheckoutStatus = 'open' | 'capturing' | 'pending' | 'captured' | 'declined' | 'expired'

export interface PayPalCheckoutRecord {
  ownerKind: string
  checkoutId: string
  orgId: string
  hostId: string
  currency: string
  channel: PluginPaymentCheckoutRequest['channel']
  environment: PayPalConfig['environment']
  merchantId: string
  lines: PluginPaymentLine[]
  discountCents: number
  taxCents: number
  shipping: PluginPaymentShipping | null
  platformFeeCents: number
  merchantName: string
  buyerEmail: string | null
  metadata: Record<string, string>
  returnUrl: string
  cancelUrl: string
  expiresAtMs: number
  status: PayPalCheckoutStatus
  /** The PayPal order opened for each funding source. */
  orders: Partial<Record<PayPalFundingSource, { id: string; createdAtMs: number }>>
  /** Every PayPal order id this checkout opened, for a webhook's lookup. */
  orderIds: string[]
  /** The delivery option last chosen in PayPal. */
  selectedShippingId: string | null
  captureClaimAtMs?: number
  captureOrderId?: string
  captureId?: string
  capturedCents?: number
  /** The PayPal order the money moved on, and what the buyer chose there. */
  capturedOrderId?: string
  payerEmail?: string | null
  payerName?: string | null
  shippingAddress?: PluginPaymentAddress | null
  refunds?: Record<string, { cents: number; feeCents: number; status: string; atMs: number }>
  refundedCents?: number
  refundedFeeCents?: number
  /** When the owner was told it is paid; `null` until then, so the sweep can find it. */
  settledAtMs: number | null
  expiredAtMs?: number
  createdAtMs: number
  updatedAtMs: number
}

/** A PayPal order is approvable for about three hours; reopen well before. */
const ORDER_REUSE_MS = 2 * 60 * 60 * 1000

/** A capture claim older than this belongs to a caller that died. */
export const CAPTURE_CLAIM_MS = 2 * 60 * 1000

/** The record id for an owner's checkout: deterministic, so a retry finds it. */
export function payPalCheckoutRecordId(ownerKind: string, checkoutId: string): string {
  return `ppc_${createHash('sha256').update(`${ownerKind}:${checkoutId}`).digest('hex').slice(0, 40)}`
}

export function isPayPalCheckoutRecordId(value: unknown): value is string {
  return typeof value === 'string' && /^ppc_[0-9a-f]{40}$/.test(value)
}

export async function readCheckout(recordId: string): Promise<PayPalCheckoutRecord | null> {
  if (!isPayPalCheckoutRecordId(recordId)) return null
  const snapshot = await checkoutsCollection().doc(recordId).get()
  return snapshot.exists ? (snapshot.data() as PayPalCheckoutRecord) : null
}

/** The checkout a PayPal order id belongs to, from a webhook. */
export async function findCheckoutByOrderId(
  orderId: string,
): Promise<{ id: string; record: PayPalCheckoutRecord } | null> {
  if (!orderId) return null
  const matches = await checkoutsCollection().where('orderIds', 'array-contains', orderId).limit(2).get()
  if (matches.docs.length !== 1) return null
  return { id: matches.docs[0].id, record: matches.docs[0].data() as PayPalCheckoutRecord }
}

/** The checkout a capture id belongs to. */
export async function findCheckoutByCaptureId(
  captureId: string,
): Promise<{ id: string; record: PayPalCheckoutRecord } | null> {
  if (!captureId) return null
  const matches = await checkoutsCollection().where('captureId', '==', captureId).limit(2).get()
  if (matches.docs.length !== 1) return null
  return { id: matches.docs[0].id, record: matches.docs[0].data() as PayPalCheckoutRecord }
}

/** The checkout as its owner is handed it on every callback. */
export function checkoutRef(record: PayPalCheckoutRecord, recordId: string): PluginPaymentCheckoutRef {
  return {
    providerId: PAYPAL_PROVIDER_ID,
    providerLabel: 'PayPal',
    providerCheckoutId: recordId,
    ownerKind: record.ownerKind,
    checkoutId: record.checkoutId,
    orgId: record.orgId,
    hostId: record.hostId,
    currency: record.currency,
    metadata: { ...record.metadata },
  }
}

export class PayPalCheckoutRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'PayPalCheckoutRefusal'
  }
}

/**
 * Records the owner's priced checkout and answers the page the buyer pays
 * on. Refuses (throws) a malformed request, a currency PayPal does not take,
 * or a workspace whose seller is not ready — before anything is written.
 */
export async function createPayPalCheckout(
  config: PayPalConfig,
  request: PluginPaymentCheckoutRequest,
  nowMs = Date.now(),
): Promise<PluginPaymentCheckoutStarted> {
  const problem = pluginPaymentCheckoutProblem(request)
  if (problem) throw new PayPalCheckoutRefusal(400, `PayPal checkout refused: ${problem}`)
  if (!PAYPAL_CURRENCIES.has(request.currency)) {
    throw new PayPalCheckoutRefusal(409, 'PayPal does not take this store’s currency.')
  }
  const seller = await readySeller(request.orgId, config)
  if (!seller?.merchantId) throw new PayPalCheckoutRefusal(409, 'PayPal is not set up for this store.')
  const recordId = payPalCheckoutRecordId(request.ownerKind, request.checkoutId)
  const record: PayPalCheckoutRecord = {
    ownerKind: request.ownerKind,
    checkoutId: request.checkoutId,
    orgId: request.orgId,
    hostId: request.hostId,
    currency: request.currency,
    channel: request.channel,
    environment: config.environment,
    merchantId: seller.merchantId,
    lines: request.lines.map((line) => ({
      name: cleanText(line.name, 127),
      quantity: line.quantity,
      unitCents: line.unitCents,
      ...(line.sku ? { sku: cleanText(line.sku, 127) } : {}),
      ships: line.ships === true,
    })),
    discountCents: request.discountCents,
    taxCents: request.taxCents,
    shipping: request.shipping
      ? {
          options: request.shipping.options.map((option) => ({
            id: option.id,
            label: cleanText(option.label, 127),
            amountCents: option.amountCents,
          })),
          countries: [...request.shipping.countries],
        }
      : null,
    platformFeeCents: request.platformFeeCents,
    merchantName: cleanText(request.merchantName ?? '', 127),
    buyerEmail: request.buyerEmail ? String(request.buyerEmail).slice(0, 254) : null,
    metadata: { ...request.metadata },
    returnUrl: request.returnUrl,
    cancelUrl: request.cancelUrl,
    expiresAtMs: request.expiresAtMs,
    status: 'open',
    orders: {},
    orderIds: [],
    selectedShippingId: request.shipping?.options[0]?.id ?? null,
    settledAtMs: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
  const ref = checkoutsCollection().doc(recordId)
  try {
    await ref.create(record)
  } catch (error) {
    // A retry of the same attempt: the record is already there, unchanged.
    const existing = (await ref.get()).data() as PayPalCheckoutRecord | undefined
    if (!existing || existing.checkoutId !== request.checkoutId || existing.ownerKind !== request.ownerKind) throw error
  }
  return {
    providerId: PAYPAL_PROVIDER_ID,
    providerCheckoutId: recordId,
    redirectUrl: payPageUrl(new URL(request.returnUrl).origin, recordId),
    livemode: config.environment === 'live',
  }
}

/** The page a checkout is paid on, on the host the buyer started from. */
export function payPageUrl(origin: string, recordId: string): string {
  return `${origin}/api/${PAYPAL_API_ROUTES.pay}?c=${encodeURIComponent(recordId)}`
}

function cleanText(value: unknown, max: number): string {
  return Array.from(String(value ?? ''), (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Whether a checkout may still be paid, with the refusal a buyer reads when not. */
export function checkoutPayable(record: PayPalCheckoutRecord, nowMs = Date.now()): string | null {
  if (record.status === 'captured' || record.status === 'pending') return 'This order is already paid.'
  if (record.status === 'expired' || nowMs > record.expiresAtMs) {
    return 'This checkout expired before it was paid. Nothing was charged.'
  }
  if (record.status === 'declined') return 'PayPal declined this payment. Nothing was charged.'
  return null
}

/** A PayPal amount object with its breakdown, for one delivery option. */
export function payPalAmount(record: PayPalCheckoutRecord, shippingOptionId: string | null) {
  const totals = pluginPaymentCheckoutTotals(
    {
      lines: record.lines,
      discountCents: record.discountCents,
      taxCents: record.taxCents,
      ...(record.shipping ? { shipping: record.shipping } : {}),
    },
    shippingOptionId ?? undefined,
  )
  const money = (cents: number) => payPalMoney(cents, record.currency)
  return {
    totals,
    amount: {
      ...money(totals.totalCents),
      breakdown: {
        item_total: money(totals.itemsCents),
        ...(record.shipping ? { shipping: money(totals.shippingCents) } : {}),
        ...(totals.taxCents > 0 ? { tax_total: money(totals.taxCents) } : {}),
        ...(totals.discountCents > 0 ? { discount: money(totals.discountCents) } : {}),
      },
    },
  }
}

function shippingOptionsBody(record: PayPalCheckoutRecord, selectedId: string | null) {
  const options = record.shipping?.options ?? []
  const chosen = options.find((option) => option.id === selectedId)?.id ?? options[0]?.id
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    type: 'SHIPPING',
    selected: option.id === chosen,
    amount: payPalMoney(option.amountCents, record.currency),
  }))
}

/** The Orders v2 body for one funding source. Exported for the spec. */
export function payPalOrderBody(record: PayPalCheckoutRecord, source: PayPalFundingSource) {
  const { amount } = payPalAmount(record, record.selectedShippingId)
  const merchantName = record.merchantName || undefined
  const shipping = record.shipping ? 'GET_FROM_FILE' : 'NO_SHIPPING'
  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: 'default',
        custom_id: record.checkoutId.slice(0, 127),
        ...(merchantName ? { description: `Order from ${merchantName}`.slice(0, 127) } : {}),
        amount,
        payee: { merchant_id: record.merchantId },
        payment_instruction: {
          disbursement_mode: 'INSTANT',
          ...(record.platformFeeCents > 0
            ? { platform_fees: [{ amount: payPalMoney(record.platformFeeCents, record.currency) }] }
            : {}),
        },
        items: record.lines.map((line) => ({
          name: line.name,
          quantity: String(line.quantity),
          unit_amount: payPalMoney(line.unitCents, record.currency),
          ...(line.sku ? { sku: line.sku } : {}),
          category: line.ships ? 'PHYSICAL_GOODS' : 'DIGITAL_GOODS',
        })),
        ...(record.shipping ? { shipping: { options: shippingOptionsBody(record, record.selectedShippingId) } } : {}),
      },
    ],
    payment_source: {
      [source]: {
        experience_context:
          source === 'paypal'
            ? {
                ...(merchantName ? { brand_name: merchantName } : {}),
                shipping_preference: shipping,
                user_action: 'PAY_NOW',
                return_url: record.returnUrl,
                cancel_url: record.cancelUrl,
              }
            : { ...(merchantName ? { brand_name: merchantName } : {}), shipping_preference: shipping },
      },
    },
  }
}

/**
 * Opens (or reuses) the PayPal order for the funding source the buyer
 * pressed, and answers its id for the buttons' `createOrder`.
 */
export async function openPayPalOrder(
  config: PayPalConfig,
  recordId: string,
  source: PayPalFundingSource,
  nowMs = Date.now(),
): Promise<string> {
  const record = await readCheckout(recordId)
  if (!record) throw new PayPalCheckoutRefusal(404, 'This checkout was not found.')
  const refusal = checkoutPayable(record, nowMs)
  if (refusal) throw new PayPalCheckoutRefusal(409, refusal)
  if (source === 'venmo' && record.currency !== VENMO_CURRENCY) {
    throw new PayPalCheckoutRefusal(409, 'Venmo takes US dollars only.')
  }
  if (record.environment !== config.environment) throw new PayPalCheckoutRefusal(409, 'PayPal is not available here.')
  const existing = record.orders[source]
  if (existing && nowMs - existing.createdAtMs < ORDER_REUSE_MS) return existing.id
  // A new generation each time an old order is retired, so its request id
  // is new too; within one generation a repeated press is the same order.
  const generation = Math.floor(nowMs / ORDER_REUSE_MS)
  const created = payPalOk(
    await payPalRequest<{ id?: string }>(config, {
      method: 'POST',
      path: '/v2/checkout/orders',
      body: payPalOrderBody(record, source),
      requestId: `${recordId}-${source}-${generation}`,
      representation: false,
    }),
    'open the PayPal order',
  )
  const orderId = String(created.id ?? '')
  if (!orderId) throw new Error('PayPal answered no order id')
  await payPalDb().runTransaction(async (transaction) => {
    const ref = checkoutsCollection().doc(recordId)
    const fresh = (await transaction.get(ref)).data() as PayPalCheckoutRecord | undefined
    if (!fresh) return
    transaction.set(
      ref,
      {
        orders: { ...fresh.orders, [source]: { id: orderId, createdAtMs: nowMs } },
        orderIds: [...new Set([...(fresh.orderIds ?? []), orderId])],
        updatedAtMs: nowMs,
      },
      { merge: true },
    )
  })
  return orderId
}

/**
 * The buyer chose a delivery option inside PayPal: re-price the order to it.
 * Refuses an option the owner did not offer, and an order that is not this
 * checkout's.
 */
export async function changePayPalShipping(
  config: PayPalConfig,
  recordId: string,
  orderId: string,
  optionId: string,
  nowMs = Date.now(),
): Promise<void> {
  const record = await readCheckout(recordId)
  if (!record || !record.orderIds.includes(orderId)) throw new PayPalCheckoutRefusal(404, 'This checkout was not found.')
  const refusal = checkoutPayable(record, nowMs)
  if (refusal) throw new PayPalCheckoutRefusal(409, refusal)
  if (!record.shipping?.options.some((option) => option.id === optionId)) {
    throw new PayPalCheckoutRefusal(400, 'That delivery option is not offered.')
  }
  const { amount } = payPalAmount(record, optionId)
  const patched = await payPalRequest(config, {
    method: 'PATCH',
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    body: [
      { op: 'replace', path: "/purchase_units/@reference_id=='default'/amount", value: amount },
      {
        op: 'replace',
        path: "/purchase_units/@reference_id=='default'/shipping/options",
        value: shippingOptionsBody(record, optionId),
      },
    ],
  })
  payPalOk(patched, 'change the delivery option')
  await checkoutsCollection().doc(recordId).set({ selectedShippingId: optionId, updatedAtMs: nowMs }, { merge: true })
}

/** Whether the owner delivers to a country the buyer picked inside PayPal. */
export async function checkPayPalAddress(recordId: string, country: string): Promise<boolean> {
  const record = await readCheckout(recordId)
  if (!record?.shipping) return Boolean(record)
  return record.shipping.countries.includes(String(country ?? '').toUpperCase())
}

interface PayPalOrder {
  id?: string
  status?: string
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } }
  purchase_units?: Array<{
    reference_id?: string
    amount?: { currency_code?: string; value?: string }
    payee?: { merchant_id?: string }
    shipping?: {
      name?: { full_name?: string }
      address?: {
        address_line_1?: string
        address_line_2?: string
        admin_area_2?: string
        admin_area_1?: string
        postal_code?: string
        country_code?: string
      }
      options?: Array<{ id?: string; selected?: boolean }>
    }
    payments?: {
      captures?: Array<{
        id?: string
        status?: string
        amount?: { currency_code?: string; value?: string }
        status_details?: { reason?: string }
      }>
    }
  }>
}

function addressOf(unit: NonNullable<PayPalOrder['purchase_units']>[number] | undefined): PluginPaymentAddress | undefined {
  const address = unit?.shipping?.address
  if (!address) return undefined
  return {
    ...(unit?.shipping?.name?.full_name ? { name: unit.shipping.name.full_name } : {}),
    ...(address.address_line_1 ? { line1: address.address_line_1 } : {}),
    ...(address.address_line_2 ? { line2: address.address_line_2 } : {}),
    ...(address.admin_area_2 ? { city: address.admin_area_2 } : {}),
    ...(address.admin_area_1 ? { state: address.admin_area_1 } : {}),
    ...(address.postal_code ? { postalCode: address.postal_code } : {}),
    ...(address.country_code ? { country: address.country_code.toUpperCase() } : {}),
  }
}

function payerOf(order: PayPalOrder): { email?: string; name?: string } {
  const name = [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(' ').trim()
  return {
    ...(order.payer?.email_address ? { email: order.payer.email_address } : {}),
    ...(name ? { name } : {}),
  }
}

export type PayPalCaptureOutcome =
  | { kind: 'captured'; redirectUrl: string }
  | { kind: 'pending'; message: string }
  | { kind: 'restart'; message: string }
  | { kind: 'refused'; status: number; message: string }

const PENDING_MESSAGE =
  'PayPal is still processing this payment. Your order is placed once it completes, and the receipt is emailed to you then.'

async function getOrder(config: PayPalConfig, orderId: string): Promise<PayPalOrder> {
  return payPalOk(
    await payPalRequest<PayPalOrder>(config, { method: 'GET', path: `/v2/checkout/orders/${encodeURIComponent(orderId)}` }),
    'read the PayPal order',
  )
}

/**
 * Captures the approved order — from the buyer's browser or PayPal's
 * webhook — and tells the owner. See the module comment for why this can
 * run twice and capture once.
 */
export async function capturePayPalCheckout(
  config: PayPalConfig,
  recordId: string,
  orderId: string,
  nowMs = Date.now(),
): Promise<PayPalCaptureOutcome> {
  const record = await readCheckout(recordId)
  if (!record || !record.orderIds.includes(orderId)) {
    return { kind: 'refused', status: 404, message: 'This checkout was not found.' }
  }
  if (record.status === 'captured') {
    await settleWithOwner(config, recordId).catch(() => undefined)
    return { kind: 'captured', redirectUrl: record.returnUrl }
  }
  if (record.status === 'pending') return { kind: 'pending', message: PENDING_MESSAGE }
  const order = await getOrder(config, orderId)
  const unit = order.purchase_units?.find((one) => (one.reference_id ?? 'default') === 'default') ?? order.purchase_units?.[0]
  // Captured already — by the other path, or by a call whose answer was lost.
  if (order.status === 'COMPLETED') {
    const capture = unit?.payments?.captures?.[0]
    if (capture?.id) return finishCapture(config, recordId, order, capture, nowMs)
  }
  const refusal = checkoutPayable(record, nowMs)
  if (refusal) {
    if (record.status === 'open' && nowMs > record.expiresAtMs) await expireCheckout(recordId, nowMs).catch(() => undefined)
    return { kind: 'refused', status: 409, message: refusal }
  }
  if (order.status !== 'APPROVED') {
    return { kind: 'refused', status: 409, message: 'This payment was not approved in PayPal. Nothing was charged.' }
  }
  // The order must still say what was priced: the payee, the currency, and
  // the total for the delivery option the buyer settled on.
  const selectedId = unit?.shipping?.options?.find((option) => option.selected)?.id ?? record.selectedShippingId
  const expected = payPalAmount(record, selectedId ?? null).totals
  const ordered = minorFromPayPal(unit?.amount, record.currency)
  if (unit?.payee?.merchant_id && unit.payee.merchant_id !== record.merchantId) {
    console.error('[paypal] order payee differs from the checkout seller', { recordId, orderId })
    return { kind: 'refused', status: 409, message: 'This payment could not be taken. Nothing was charged.' }
  }
  if (ordered !== expected.totalCents) {
    console.error('[paypal] order amount differs from the priced checkout', { recordId, orderId, ordered, expected })
    return { kind: 'refused', status: 409, message: 'This payment could not be taken. Nothing was charged.' }
  }
  const owner = pluginPaymentCheckoutOwner(record.ownerKind)
  if (!owner) return { kind: 'refused', status: 503, message: 'This checkout cannot be completed right now. Nothing was charged.' }
  const shippingAddress = addressOf(unit)
  if (record.shipping && shippingAddress?.country && !record.shipping.countries.includes(shippingAddress.country)) {
    return { kind: 'restart', message: 'This store does not deliver to that address. Choose another address in PayPal.' }
  }
  const approval: PluginPaymentApproval = {
    ...checkoutRef(record, recordId),
    totalCents: expected.totalCents,
    ...(selectedId ? { shippingOptionId: selectedId } : {}),
    ...(shippingAddress ? { shippingAddress } : {}),
    payer: payerOf(order),
  }
  const answer = await owner.approve(approval)
  if ('reason' in answer) return { kind: 'refused', status: 409, message: answer.reason }

  // The claim: one caller at a time captures this checkout.
  const claimed = await payPalDb().runTransaction(async (transaction) => {
    const ref = checkoutsCollection().doc(recordId)
    const fresh = (await transaction.get(ref)).data() as PayPalCheckoutRecord | undefined
    if (!fresh) return 'gone' as const
    if (fresh.status === 'captured' || fresh.status === 'pending') return 'done' as const
    const stale = fresh.status === 'capturing' && nowMs - Number(fresh.captureClaimAtMs ?? 0) > CAPTURE_CLAIM_MS
    if (fresh.status !== 'open' && !stale) return 'busy' as const
    transaction.set(
      ref,
      { status: 'capturing', captureClaimAtMs: nowMs, captureOrderId: orderId, updatedAtMs: nowMs },
      { merge: true },
    )
    return 'mine' as const
  })
  if (claimed === 'gone') return { kind: 'refused', status: 404, message: 'This checkout was not found.' }
  if (claimed === 'done') return capturePayPalCheckout(config, recordId, orderId, nowMs)
  if (claimed === 'busy') return { kind: 'pending', message: 'This payment is already being completed.' }

  const response = await payPalRequest<PayPalOrder>(config, {
    method: 'POST',
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    body: {},
    requestId: `${recordId}-capture-${orderId}`.slice(0, 108),
    representation: true,
  })
  const release = (status: PayPalCheckoutStatus = 'open') =>
    checkoutsCollection()
      .doc(recordId)
      .set({ status, captureClaimAtMs: 0, updatedAtMs: Date.now() }, { merge: true })
  if (!response.ok) {
    const issue = payPalIssue(response.body)
    if (issue === 'ORDER_ALREADY_CAPTURED') {
      const captured = await getOrder(config, orderId)
      const capture = captured.purchase_units?.[0]?.payments?.captures?.[0]
      if (capture?.id) return finishCapture(config, recordId, captured, capture, nowMs)
    }
    await release()
    if (issue === 'INSTRUMENT_DECLINED' || issue === 'PAYER_ACTION_REQUIRED') {
      return { kind: 'restart', message: 'PayPal declined that payment method. Choose another one in PayPal.' }
    }
    console.error('[paypal] capture refused', { recordId, orderId, status: response.status, issue, debugId: response.debugId })
    return { kind: 'refused', status: 502, message: 'PayPal could not complete the payment. Nothing was charged.' }
  }
  const capture = response.body.purchase_units?.[0]?.payments?.captures?.[0]
  if (!capture?.id) {
    await release()
    return { kind: 'refused', status: 502, message: 'PayPal could not complete the payment. Nothing was charged.' }
  }
  return finishCapture(config, recordId, { ...order, ...response.body, purchase_units: response.body.purchase_units ?? order.purchase_units }, capture, nowMs)
}

async function finishCapture(
  config: PayPalConfig,
  recordId: string,
  order: PayPalOrder,
  capture: NonNullable<NonNullable<NonNullable<PayPalOrder['purchase_units']>[number]['payments']>['captures']>[number],
  nowMs: number,
): Promise<PayPalCaptureOutcome> {
  const record = await readCheckout(recordId)
  if (!record) return { kind: 'refused', status: 404, message: 'This checkout was not found.' }
  const unit = order.purchase_units?.[0]
  const status = String(capture.status ?? '')
  const capturedCents = minorFromPayPal(capture.amount, record.currency) ?? 0
  const shippingAddress = addressOf(unit) ?? null
  const payer = payerOf(order)
  const selectedId = unit?.shipping?.options?.find((option) => option.selected)?.id ?? record.selectedShippingId
  if (status === 'DECLINED' || status === 'FAILED') {
    await checkoutsCollection()
      .doc(recordId)
      .set({ status: 'open', captureClaimAtMs: 0, updatedAtMs: nowMs }, { merge: true })
    return { kind: 'restart', message: 'PayPal declined that payment method. Choose another one in PayPal.' }
  }
  await checkoutsCollection()
    .doc(recordId)
    .set(
      {
        status: status === 'COMPLETED' ? 'captured' : 'pending',
        captureId: String(capture.id),
        capturedCents,
        capturedOrderId: String(order.id ?? record.captureOrderId ?? ''),
        selectedShippingId: selectedId ?? null,
        payerEmail: payer.email ?? null,
        payerName: payer.name ?? null,
        shippingAddress,
        captureClaimAtMs: 0,
        updatedAtMs: nowMs,
      },
      { merge: true },
    )
  if (status !== 'COMPLETED') return { kind: 'pending', message: PENDING_MESSAGE }
  // The money moved: the buyer is sent on whatever the owner says, and an
  // owner that failed is told again by the webhook and the sweep.
  await settleWithOwner(config, recordId).catch((error) => {
    console.error('[paypal] owner settlement failed; it will be retried', { recordId }, error)
  })
  return { kind: 'captured', redirectUrl: record.returnUrl }
}

/**
 * Records a capture PayPal reports from the order itself — a webhook for a
 * capture whose caller died, or a sweep finding one — with the payer and
 * the address the order holds, then tells the owner.
 */
export async function finishCaptureFromOrder(
  config: PayPalConfig,
  recordId: string,
  orderId: string,
  nowMs = Date.now(),
): Promise<PayPalCaptureOutcome | null> {
  const order = await getOrder(config, orderId)
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0]
  if (!capture?.id) return null
  return finishCapture(config, recordId, order, capture, nowMs)
}

/**
 * Tells the owner a captured checkout is paid, unless it already knows.
 * Throws when the owner did, so a webhook redelivers.
 */
export async function settleWithOwner(config: PayPalConfig, recordId: string, nowMs = Date.now()): Promise<boolean> {
  const record = await readCheckout(recordId)
  if (!record || record.status !== 'captured' || !record.captureId) return false
  if (record.settledAtMs) return true
  const owner = pluginPaymentCheckoutOwner(record.ownerKind)
  if (!owner) throw new Error(`no owner registered for checkout kind "${record.ownerKind}"`)
  const breakdown = payPalAmount(record, record.selectedShippingId).totals
  const settlement: PluginPaymentSettlement = {
    ...checkoutRef(record, recordId),
    totalCents: breakdown.totalCents,
    ...(record.selectedShippingId ? { shippingOptionId: record.selectedShippingId } : {}),
    ...(record.shippingAddress ? { shippingAddress: record.shippingAddress } : {}),
    payer: {
      ...(record.payerEmail ? { email: record.payerEmail } : {}),
      ...(record.payerName ? { name: record.payerName } : {}),
    },
    paymentId: record.captureId,
    amountCents: Number(record.capturedCents ?? breakdown.totalCents),
    breakdown,
    platformFeeCents: record.platformFeeCents,
    livemode: record.environment === 'live' && config.environment === 'live',
    settledAtMs: nowMs,
  }
  await owner.settle(settlement)
  await checkoutsCollection().doc(recordId).set({ settledAtMs: nowMs, updatedAtMs: nowMs }, { merge: true })
  return true
}

/**
 * The checkout lapsed unpaid (or PayPal denied a pending capture): mark it
 * and tell the owner to give back what it held. Only an open checkout — or
 * a pending one PayPal refused — expires; a capture in flight never does.
 */
export async function expireCheckout(
  recordId: string,
  nowMs = Date.now(),
  options: { denied?: boolean } = {},
): Promise<boolean> {
  const expired = await payPalDb().runTransaction(async (transaction) => {
    const ref = checkoutsCollection().doc(recordId)
    const fresh = (await transaction.get(ref)).data() as PayPalCheckoutRecord | undefined
    if (!fresh) return null
    const may = options.denied ? fresh.status === 'pending' || fresh.status === 'open' : fresh.status === 'open'
    if (!may) return null
    transaction.set(
      ref,
      { status: options.denied ? 'declined' : 'expired', expiredAtMs: nowMs, updatedAtMs: nowMs },
      { merge: true },
    )
    return fresh
  })
  if (!expired) return false
  const owner = pluginPaymentCheckoutOwner(expired.ownerKind)
  if (owner) await owner.expire(checkoutRef(expired, recordId))
  return true
}

/**
 * The sweep (every fifteen minutes on the console): expire what lapsed,
 * finish a capture whose caller died, and retell an owner that missed a
 * settlement. Bounded per run, and stops at the deadline.
 */
export async function sweepPayPalCheckouts(
  config: PayPalConfig | null,
  context: { nowMs: number; deadlineMs: number },
): Promise<{ expired: number; recovered: number; settled: number }> {
  const report = { expired: 0, recovered: 0, settled: 0 }
  const lapsed = await checkoutsCollection()
    .where('status', '==', 'open')
    .where('expiresAtMs', '<=', context.nowMs)
    .orderBy('expiresAtMs', 'asc')
    .limit(100)
    .get()
  for (const doc of lapsed.docs) {
    if (Date.now() > context.deadlineMs) return report
    if (await expireCheckout(doc.id, context.nowMs).catch(() => false)) report.expired++
  }
  if (!config) return report
  const stuck = await checkoutsCollection()
    .where('status', '==', 'capturing')
    .where('captureClaimAtMs', '<=', context.nowMs - CAPTURE_CLAIM_MS)
    .orderBy('captureClaimAtMs', 'asc')
    .limit(25)
    .get()
  for (const doc of stuck.docs) {
    if (Date.now() > context.deadlineMs) return report
    const record = doc.data() as PayPalCheckoutRecord
    if (!record.captureOrderId) continue
    const order = await getOrder(config, record.captureOrderId).catch(() => null)
    const capture = order?.purchase_units?.[0]?.payments?.captures?.[0]
    if (order?.status === 'COMPLETED' && capture?.id) {
      await finishCapture(config, doc.id, order, capture, context.nowMs)
      report.recovered++
    } else if (order) {
      await checkoutsCollection().doc(doc.id).set({ status: 'open', captureClaimAtMs: 0 }, { merge: true })
    }
  }
  const unsettled = await checkoutsCollection()
    .where('status', '==', 'captured')
    .where('settledAtMs', '==', null)
    .limit(25)
    .get()
    .catch(() => ({ docs: [] as Array<{ id: string }> }))
  for (const doc of unsettled.docs) {
    if (Date.now() > context.deadlineMs) return report
    if (await settleWithOwner(config, doc.id, context.nowMs).catch(() => false)) report.settled++
  }
  return report
}

