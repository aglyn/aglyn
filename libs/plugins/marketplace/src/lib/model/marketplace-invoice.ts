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
  PLUGIN_SALE_METADATA_KEY,
  PLUGIN_SALE_METADATA_VALUE,
} from '@aglyn/aglyn/app-utils/plugin-sale'

/** The discriminator every Stripe object of a marketplace sale carries. */
export const MARKETPLACE_PURCHASE_TYPE = 'marketplace-purchase'

/** The facts a marketplace sale carries across Stripe, as the webhook reads them. */
export interface MarketplaceSaleFacts {
  listingId: string
  buyerUid: string
  buyerOrgId: string
  sellerOrgId: string
  feeCents: number
  transferCents: number
  /** The buyer's GA client id, so the server's `purchase` joins their session. */
  gaClientId?: string | null
}

/**
 * A sale's metadata as Stripe form params (AGL-4049): the same fields a
 * hosted checkout session carries, so the purchase record cannot tell the two
 * doors apart, plus the marker that keeps the sale out of the platform's own
 * revenue.
 */
export function marketplaceSaleMetadataParams(facts: MarketplaceSaleFacts): Record<string, string> {
  return {
    'metadata[type]': MARKETPLACE_PURCHASE_TYPE,
    [`metadata[${PLUGIN_SALE_METADATA_KEY}]`]: PLUGIN_SALE_METADATA_VALUE,
    'metadata[listingId]': facts.listingId,
    'metadata[buyerUid]': facts.buyerUid,
    'metadata[buyerOrgId]': facts.buyerOrgId,
    'metadata[sellerOrgId]': facts.sellerOrgId,
    'metadata[feeCents]': String(facts.feeCents),
    'metadata[transferCents]': String(facts.transferCents),
    ...(facts.gaClientId && /^\d+\.\d+$/.test(facts.gaClientId)
      ? { 'metadata[ga_client_id]': facts.gaClientId }
      : {}),
  }
}

/** Whether a Stripe invoice is a marketplace sale's. */
export function isMarketplaceInvoice(invoice: unknown): boolean {
  return (invoice as { metadata?: { type?: unknown } } | null | undefined)?.metadata?.type ===
    MARKETPLACE_PURCHASE_TYPE
}

/**
 * The tax on an invoice, in cents.
 *
 * The breakdown first, the scalar only when no array said anything: measured
 * on the live account, a computed invoice can send `tax: 0` or `tax: null`
 * beside a populated `total_taxes[]` (AGL-1811).
 */
export function invoiceTaxCents(invoice: any): number {
  const entries: any[] = Array.isArray(invoice?.total_taxes)
    ? invoice.total_taxes
    : Array.isArray(invoice?.total_tax_amounts)
      ? invoice.total_tax_amounts
      : []
  if (entries.length > 0) {
    return entries.reduce((sum: number, entry: any) => {
      const amount = Number(entry?.amount ?? 0)
      return sum + (Number.isFinite(amount) ? Math.round(amount) : 0)
    }, 0)
  }
  const scalar = Number(invoice?.tax ?? NaN)
  return Number.isFinite(scalar) && scalar > 0 ? Math.round(scalar) : 0
}

/**
 * The PaymentIntent an invoice settles through, whichever generation of the
 * field it carries: an id or an expanded object at the top level, or under
 * `payments[]` on newer API versions.
 */
export function invoicePaymentIntentId(invoice: any): string {
  const intent = invoice?.payment_intent
  if (typeof intent === 'string' && intent) return intent
  if (typeof intent?.id === 'string' && intent.id) return intent.id
  const nested = invoice?.payments?.data?.[0]?.payment?.payment_intent
  if (typeof nested === 'string' && nested) return nested
  return typeof nested?.id === 'string' ? nested.id : ''
}
