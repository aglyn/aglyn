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
  SITE_CARE_EXTRA_HOUR_USD,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { SITE_CARE_EXTRA_TIME_TAX_CODE } from '@aglyn/aglyn/app-utils/site-care'
import { isLiveSubscriptionStatus } from '@aglyn/aglyn/app-utils/org-billing-doc'
import { USAGE_INVOICE_API_VERSION } from './usage-invoice'

/**
 * SITE CARE EXTRA TIME, IN STRIPE (AGL-3959).
 *
 * Every Stripe call the extra-time charge makes, and nothing else: the item
 * on the org's subscription that rides its next invoice, a correction of it
 * while that invoice is still a draft, and its reversal — deleted before the
 * invoice finalizes, credited after, refunded once paid. Staff never do any
 * of this by hand in the Stripe dashboard; the request is the only door, and
 * the caller writes the request's history row in the same step as each call
 * (`site-care-requests.ts`).
 *
 * The same pinned API version and form-encoded fetch `usage-invoice.ts`
 * uses, for the same reason: an invoice item's parameters have moved between
 * versions, and a charge that silently changed shape under a Dashboard
 * upgrade is what pinning prevents. `fetchImpl` and `secretKey` are the
 * specs' seams.
 *
 * ## The tax code is the product's, and it is checked
 *
 * The line is priced against the Site Care product (`price_data[product]`),
 * because the product is what carries the tax code Stripe Tax computes from;
 * the product is read off the Site Care price the subscription already
 * carries, and a product whose tax code is not `txcd_10103001` refuses the
 * charge rather than billing it untaxed or under the wrong code.
 */

type StripeFetch = typeof fetch

export interface SiteCareStripeOptions {
  secretKey?: string
  fetchImpl?: StripeFetch
}

interface StripeAnswer {
  ok: boolean
  status: number
  body: Record<string, unknown>
}

async function stripeCall(
  options: SiteCareStripeOptions,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, string> | null = null,
  idempotencyKey: string | null = null,
): Promise<StripeAnswer> {
  const secretKey = options.secretKey ?? process.env['STRIPE_SECRET_KEY'] ?? ''
  if (!secretKey) {
    return { ok: false, status: 501, body: { error: { message: 'Stripe is not configured' } } }
  }
  const fetchImpl = options.fetchImpl ?? fetch
  const query = method === 'GET' && params ? `?${new URLSearchParams(params).toString()}` : ''
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': USAGE_INVOICE_API_VERSION,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(method !== 'GET' && idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: method === 'POST' && params ? new URLSearchParams(params).toString() : undefined,
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: response.ok, status: response.status, body }
}

function stripeMessage(answer: StripeAnswer, fallback: string): string {
  const message = (answer.body?.['error'] as { message?: unknown } | undefined)?.message
  return typeof message === 'string' && message ? message : fallback
}

function metadataParams(metadata: Readonly<Record<string, string>>): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) params[`metadata[${key}]`] = String(value)
  return params
}

/**
 * The pinned, form-encoded Stripe call and its helpers, shared with the
 * flat-quoted project invoice (AGL-3970, `site-care-project-stripe.ts`) so
 * both Site Care money paths speak to Stripe the same way.
 */
export {
  metadataParams as siteCareStripeMetadata,
  stripeCall as siteCareStripeCall,
  stripeMessage as siteCareStripeMessage,
}
export type { StripeAnswer as SiteCareStripeAnswer }

export type SiteCareStripeResult<T> = ({ ok: true } & T) | { ok: false; error: string }

/**
 * The org's live subscription, which the item is attached to so it rides
 * that subscription's next invoice.
 */
export async function siteCareSubscriptionId(
  customerId: string,
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ subscriptionId: string }>> {
  if (!customerId) return { ok: false, error: 'The workspace has no Stripe customer.' }
  const answer = await stripeCall(options, 'GET', 'subscriptions', {
    customer: customerId,
    status: 'all',
    limit: '10',
  })
  if (answer.ok === false) return { ok: false, error: stripeMessage(answer, 'Reading the subscription failed') }
  const rows = (answer.body['data'] as Array<Record<string, unknown>> | undefined) ?? []
  const live = rows.find((row) => isLiveSubscriptionStatus(String(row['status'] ?? '')))
  return live
    ? { ok: true, subscriptionId: String(live['id']) }
    : { ok: false, error: 'The workspace has no live subscription to add extra time to.' }
}

/**
 * The Site Care product, read off the add-on's price, with its tax code
 * checked. `priceId` defaults to the monthly add-on price; the product is
 * the same for the yearly one.
 */
export async function siteCareExtraTimeProduct(
  options: SiteCareStripeOptions & { priceId?: string | null } = {},
): Promise<SiteCareStripeResult<{ productId: string }>> {
  const priceId =
    options.priceId ??
    process.env['STRIPE_PRICE_SITE_CARE'] ??
    process.env['STRIPE_PRICE_SITE_CARE_YEARLY'] ??
    ''
  if (!priceId) return { ok: false, error: 'The Site Care price is not configured (STRIPE_PRICE_SITE_CARE).' }
  const answer = await stripeCall(options, 'GET', `prices/${encodeURIComponent(priceId)}`, {
    'expand[]': 'product',
  })
  if (answer.ok === false) return { ok: false, error: stripeMessage(answer, 'Reading the Site Care price failed') }
  const product = answer.body['product'] as Record<string, unknown> | string | undefined
  const productId = typeof product === 'string' ? product : String(product?.['id'] ?? '')
  if (!productId) return { ok: false, error: 'The Site Care price names no product.' }
  const taxCode =
    typeof product === 'object' && product
      ? typeof product['tax_code'] === 'string'
        ? product['tax_code']
        : String((product['tax_code'] as Record<string, unknown> | null)?.['id'] ?? '')
      : ''
  if (taxCode !== SITE_CARE_EXTRA_TIME_TAX_CODE) {
    return {
      ok: false,
      error: `The Site Care product carries tax code ${taxCode || 'none'}, not ${SITE_CARE_EXTRA_TIME_TAX_CODE}; nothing was charged.`,
    }
  }
  return { ok: true, productId }
}

export interface ExtraTimeItemInput {
  customerId: string
  subscriptionId: string
  productId: string
  hours: number
  description: string
  metadata: Readonly<Record<string, string>>
  idempotencyKey: string
}

/** Adds the extra time to the subscription's next invoice. */
export async function createExtraTimeItem(
  input: ExtraTimeItemInput,
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ invoiceItemId: string; amountCents: number }>> {
  const hours = Math.floor(input.hours)
  if (!Number.isInteger(hours) || hours < 1) return { ok: false, error: 'Extra time bills in whole hours, at least one.' }
  const answer = await stripeCall(
    options,
    'POST',
    'invoiceitems',
    {
      customer: input.customerId,
      subscription: input.subscriptionId,
      'price_data[product]': input.productId,
      'price_data[currency]': 'usd',
      'price_data[unit_amount]': String(SITE_CARE_EXTRA_HOUR_USD * 100),
      // US sales tax is added on top of the platform's prices, and automatic
      // tax refuses an unspecified behavior outright.
      'price_data[tax_behavior]': 'exclusive',
      quantity: String(hours),
      description: input.description,
      ...metadataParams(input.metadata),
    },
    input.idempotencyKey,
  )
  if (answer.ok === false) return { ok: false, error: stripeMessage(answer, 'Stripe refused the extra-time item') }
  const invoiceItemId = String(answer.body['id'] ?? '')
  if (!invoiceItemId) return { ok: false, error: 'Stripe returned an item with no id' }
  return { ok: true, invoiceItemId, amountCents: Number(answer.body['amount'] ?? hours * SITE_CARE_EXTRA_HOUR_USD * 100) }
}

/** Corrects the hours and description of an item not yet on a finalized invoice. */
export async function updateExtraTimeItem(
  input: { invoiceItemId: string; hours: number; description: string; idempotencyKey: string },
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ amountCents: number }>> {
  const answer = await stripeCall(
    options,
    'POST',
    `invoiceitems/${encodeURIComponent(input.invoiceItemId)}`,
    { quantity: String(Math.floor(input.hours)), description: input.description },
    input.idempotencyKey,
  )
  if (answer.ok === false) return { ok: false, error: stripeMessage(answer, 'Stripe refused the correction') }
  return { ok: true, amountCents: Number(answer.body['amount'] ?? 0) }
}

/**
 * Where an item stands: still pending (no invoice), on a draft invoice, or
 * on one that finalized — open, paid, void or uncollectible — or gone.
 */
export type ExtraTimeItemStage =
  | 'pending'
  | 'draft'
  | 'open'
  | 'paid'
  | 'void'
  | 'uncollectible'
  | 'deleted'

export interface ExtraTimeItemState {
  stage: ExtraTimeItemStage
  invoiceId: string | null
  amountCents: number
  quantity: number
  description: string
  metadata: Record<string, string>
}

/** Reads an item and, when it is on one, its invoice. */
export async function readExtraTimeItem(
  invoiceItemId: string,
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ state: ExtraTimeItemState }>> {
  const answer = await stripeCall(options, 'GET', `invoiceitems/${encodeURIComponent(invoiceItemId)}`)
  if (answer.status === 404) {
    return {
      ok: true,
      state: { stage: 'deleted', invoiceId: null, amountCents: 0, quantity: 0, description: '', metadata: {} },
    }
  }
  if (answer.ok === false) return { ok: false, error: stripeMessage(answer, 'Reading the extra-time item failed') }
  const item = answer.body
  const base = {
    amountCents: Number(item['amount'] ?? 0),
    quantity: Number(item['quantity'] ?? 0),
    description: String(item['description'] ?? ''),
    metadata: (item['metadata'] as Record<string, string> | undefined) ?? {},
  }
  if (item['deleted'] === true) return { ok: true, state: { stage: 'deleted', invoiceId: null, ...base } }
  const invoiceId =
    typeof item['invoice'] === 'string'
      ? item['invoice']
      : String((item['invoice'] as Record<string, unknown> | null)?.['id'] ?? '') || null
  if (!invoiceId) return { ok: true, state: { stage: 'pending', invoiceId: null, ...base } }
  const invoice = await stripeCall(options, 'GET', `invoices/${encodeURIComponent(invoiceId)}`)
  if (invoice.ok === false) return { ok: false, error: stripeMessage(invoice, 'Reading the invoice failed') }
  const status = String(invoice.body['status'] ?? '')
  const stage: ExtraTimeItemStage =
    status === 'draft' || status === 'open' || status === 'paid' || status === 'void' || status === 'uncollectible'
      ? status
      : 'open'
  return { ok: true, state: { stage, invoiceId, ...base } }
}

/** Whether the item can still be corrected or deleted rather than credited. */
export function extraTimeItemIsEditable(stage: ExtraTimeItemStage): boolean {
  return stage === 'pending' || stage === 'draft'
}

/** Deletes an item that has not reached a finalized invoice. */
export async function deleteExtraTimeItem(
  invoiceItemId: string,
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ deleted: true }>> {
  const answer = await stripeCall(options, 'DELETE', `invoiceitems/${encodeURIComponent(invoiceItemId)}`)
  if (answer.status === 404 || answer.ok) return { ok: true, deleted: true }
  return { ok: false, error: stripeMessage(answer, 'Stripe refused to delete the item') }
}

/**
 * Credits an item on a finalized invoice — and refunds it when the invoice
 * was paid. The credit note names the item's own line, so tax comes back
 * with it; on a paid invoice its whole total is refunded to the card.
 */
export async function creditExtraTimeItem(
  input: {
    invoiceId: string
    invoiceItemId: string
    refund: boolean
    memo: string
    metadata: Readonly<Record<string, string>>
    idempotencyKey: string
  },
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ creditNoteId: string; refundId: string | null; amountCents: number }>> {
  const lines = await stripeCall(options, 'GET', `invoices/${encodeURIComponent(input.invoiceId)}/lines`, {
    limit: '100',
  })
  if (lines.ok === false) return { ok: false, error: stripeMessage(lines, 'Reading the invoice lines failed') }
  const line = ((lines.body['data'] as Array<Record<string, unknown>> | undefined) ?? []).find(
    (row) => row['invoice_item'] === input.invoiceItemId,
  )
  if (!line) return { ok: false, error: 'The extra-time line is not on that invoice.' }
  const lineParams = {
    invoice: input.invoiceId,
    'lines[0][type]': 'invoice_line_item',
    'lines[0][invoice_line_item]': String(line['id']),
    'lines[0][quantity]': String(Number(line['quantity'] ?? 1) || 1),
  }
  let refundParams: Record<string, string> = {}
  if (input.refund) {
    const preview = await stripeCall(options, 'GET', 'credit_notes/preview', lineParams)
    if (preview.ok === false) return { ok: false, error: stripeMessage(preview, 'Previewing the credit failed') }
    refundParams = { refund_amount: String(Number(preview.body['total'] ?? 0)) }
  }
  const created = await stripeCall(
    options,
    'POST',
    'credit_notes',
    {
      ...lineParams,
      ...refundParams,
      reason: 'order_change',
      memo: input.memo.slice(0, 500),
      ...metadataParams(input.metadata),
    },
    input.idempotencyKey,
  )
  if (created.ok === false) return { ok: false, error: stripeMessage(created, 'Stripe refused the credit note') }
  const refund = created.body['refund']
  return {
    ok: true,
    creditNoteId: String(created.body['id'] ?? ''),
    refundId:
      typeof refund === 'string'
        ? refund
        : String((refund as Record<string, unknown> | null)?.['id'] ?? '') || null,
    amountCents: Number(created.body['total'] ?? 0),
  }
}

/**
 * Whether a subscription invoice created since `sinceMs` has finalized —
 * the point after which a request's minutes are no longer edited, only its
 * charge reversed.
 */
export async function subscriptionInvoiceFinalizedSince(
  input: { subscriptionId: string; sinceMs: number },
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ finalized: boolean }>> {
  const answer = await stripeCall(options, 'GET', 'invoices', {
    subscription: input.subscriptionId,
    'created[gte]': String(Math.floor(input.sinceMs / 1000)),
    limit: '10',
  })
  if (answer.ok === false) return { ok: false, error: stripeMessage(answer, 'Reading the invoices failed') }
  const rows = (answer.body['data'] as Array<Record<string, unknown>> | undefined) ?? []
  return { ok: true, finalized: rows.some((row) => String(row['status'] ?? '') !== 'draft') }
}

/** One extra-time item as the reconciliation reads it. */
export interface StripeExtraTimeItem {
  id: string
  amountCents: number
  quantity: number
  description: string
  requestId: string
  /** The month the request counted in, from the item's metadata. */
  month: string
}

/** Every Site Care extra-time item on a customer created since `sinceMs`. */
export async function listSiteCareExtraTimeItems(
  input: { customerId: string; sinceMs: number },
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ items: StripeExtraTimeItem[] }>> {
  const items: StripeExtraTimeItem[] = []
  let startingAfter = ''
  for (let page = 0; page < 10; page++) {
    const answer = await stripeCall(options, 'GET', 'invoiceitems', {
      customer: input.customerId,
      'created[gte]': String(Math.floor(input.sinceMs / 1000)),
      limit: '100',
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    if (answer.ok === false) return { ok: false, error: stripeMessage(answer, 'Listing invoice items failed') }
    const rows = (answer.body['data'] as Array<Record<string, unknown>> | undefined) ?? []
    for (const row of rows) {
      const metadata = (row['metadata'] as Record<string, string> | undefined) ?? {}
      if (!metadata['siteCareRequestId']) continue
      items.push({
        id: String(row['id']),
        amountCents: Number(row['amount'] ?? 0),
        quantity: Number(row['quantity'] ?? 0),
        description: String(row['description'] ?? ''),
        requestId: String(metadata['siteCareRequestId']),
        month: String(metadata['month'] ?? ''),
      })
    }
    if (answer.body['has_more'] !== true || !rows.length) break
    startingAfter = String(rows[rows.length - 1]['id'])
  }
  return { ok: true, items }
}
