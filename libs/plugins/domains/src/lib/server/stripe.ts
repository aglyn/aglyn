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
  chargeOrgUsageInvoice,
  USAGE_INVOICE_API_VERSION,
} from '@aglyn/tenant-data-admin/server/usage-invoice'
import { BUNDLE_ID } from '../constants/bundle-common'

/*
 * CHARGING FOR A DOMAIN (AGL-3962): a one-off invoice to the workspace's own
 * card, through core's usage-invoice charge, and the two ways back out of one
 * — voiding an invoice that never collected, and refunding one that did.
 *
 * The invoice line is billed against a product rather than a bare amount
 * because the PRODUCT carries the tax code automatic tax computes from.
 * `setup-stripe.mjs` makes it (`aglynProduct: domain_registration`) and
 * names it in `STRIPE_PRODUCT_DOMAIN_REGISTRATION`; with the variable unset,
 * no charge is attempted and buying stays hidden.
 */

export const DOMAIN_PRODUCT_ENV = 'STRIPE_PRODUCT_DOMAIN_REGISTRATION'

/** The metadata `kind` a domain invoice carries, which the webhook routes on. */
export const DOMAIN_CHARGE_KIND = {
  purchase: 'domain-purchase',
  renewal: 'domain-renewal',
  /** A name moved here from another registrar, a year added (AGL-4040). */
  transfer: 'domain-transfer',
} as const

export function domainProductId(): string {
  return String(process.env[DOMAIN_PRODUCT_ENV] ?? '').trim()
}

export interface DomainChargeResult {
  ok: boolean
  invoiceId: string | null
  /** What Stripe took, in cents. */
  paidCents: number
  /** A code the registration stores; Stripe's prose is never kept. */
  code: string | null
}

export async function chargeDomain(request: {
  orgId: string
  stripeCustomerId: string
  amountCents: number
  description: string
  domain: string
  kind: (typeof DOMAIN_CHARGE_KIND)[keyof typeof DOMAIN_CHARGE_KIND]
  /** Unique per attempt; a retry with the same key re-reads, never re-charges. */
  attemptKey: string
}): Promise<DomainChargeResult> {
  const productId = domainProductId()
  if (!productId) return { ok: false, invoiceId: null, paidCents: 0, code: 'no-product' }
  const result = await chargeOrgUsageInvoice({
    orgId: request.orgId,
    stripeCustomerId: request.stripeCustomerId,
    productId,
    amountCents: request.amountCents,
    currency: 'usd',
    description: request.description,
    metadata: {
      orgId: request.orgId,
      pluginId: BUNDLE_ID,
      kind: request.kind,
      domain: request.domain,
    },
    idempotencyKey: `dom-${request.attemptKey}`,
  })
  if (result.ok) {
    return {
      ok: true,
      invoiceId: result.invoiceId,
      paidCents: result.amountPaidCents,
      code: null,
    }
  }
  // An invoice that exists but did not collect is voided, so the Billing
  // page does not show the workspace an open domain invoice that nothing
  // will ever retry — the next attempt makes a fresh one.
  if (result.invoiceId) await voidInvoice(result.invoiceId)
  return {
    ok: false,
    invoiceId: result.invoiceId,
    paidCents: 0,
    code: result.requiresAction ? 'requires-action' : 'declined',
  }
}

type Answer = { ok: boolean; status: number; body: Record<string, unknown> }

async function stripe(
  path: string,
  params: Record<string, string> | null,
  idempotencyKey?: string,
): Promise<Answer> {
  const secretKey = String(process.env['STRIPE_SECRET_KEY'] ?? '')
  if (!secretKey) return { ok: false, status: 0, body: {} }
  try {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: params ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Stripe-Version': USAGE_INVOICE_API_VERSION,
        ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(params && idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: params ? new URLSearchParams(params).toString() : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: response.ok, status: response.status, body }
  } catch {
    return { ok: false, status: 0, body: {} }
  }
}

/** Voids an invoice that never collected. Never throws; true when void. */
export async function voidInvoice(invoiceId: string): Promise<boolean> {
  const answer = await stripe(
    `invoices/${encodeURIComponent(invoiceId)}/void`,
    {},
    `dom-void-${invoiceId}`,
  )
  return answer.ok || answer.body?.['status'] === 'void'
}

/**
 * Refunds a paid domain invoice in full. Never throws.
 *
 * Idempotent per invoice: a sweep that refunds again after a lost answer
 * re-reads the first refund instead of making a second.
 */
export async function refundInvoice(
  invoiceId: string,
  reason: string,
): Promise<{ ok: boolean; refundedCents: number }> {
  const invoice = await stripe(
    `invoices/${encodeURIComponent(invoiceId)}?expand[]=payment_intent`,
    null,
  )
  if (!invoice.ok) return { ok: false, refundedCents: 0 }
  const paymentIntent = invoice.body?.['payment_intent'] as
    | { id?: unknown }
    | string
    | null
    | undefined
  const paymentIntentId =
    typeof paymentIntent === 'string' ? paymentIntent : String(paymentIntent?.id ?? '')
  if (!paymentIntentId) {
    // Nothing collected: a $0 first year, or an invoice paid out of band.
    return { ok: true, refundedCents: 0 }
  }
  const refund = await stripe(
    'refunds',
    {
      payment_intent: paymentIntentId,
      'metadata[pluginId]': BUNDLE_ID,
      'metadata[invoiceId]': invoiceId,
      'metadata[reason]': reason,
    },
    `dom-refund-${invoiceId}`,
  )
  if (!refund.ok) return { ok: false, refundedCents: 0 }
  return { ok: true, refundedCents: Number(refund.body?.['amount'] ?? 0) }
}
