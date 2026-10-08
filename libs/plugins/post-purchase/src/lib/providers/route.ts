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

import { callProvider, centsToDecimal, decimalToCents, PostPurchaseProviderError, type ProviderFetch } from './http'

/**
 * The Route adapter (AGL-3635): package protection through the merchant's
 * own Route account, reached with the secret token Route issues it (`Token`
 * header). Every amount crosses as a two-place decimal string and comes back
 * to integer cents through {@link decimalToCents}, which refuses rather than
 * rounds a figure it cannot read exactly.
 *
 * - **Quote** (`POST /quotes`): the premium for a basket's shipped goods,
 *   asked when the cart is shown and again when the buyer pays.
 * - **Order** (`POST /orders`): the policy, once the sale is paid with the
 *   protection line on it, under the order's own id (`source_order_id`), so
 *   Route itself refuses a second policy for one order (409, read as
 *   success).
 * - **Shipment** (`POST /shipments`): each parcel's tracking number, which
 *   is what a claim is checked against.
 * - **Cancel** (`POST /orders/{id}/cancel`): when the whole sale is refunded
 *   or canceled, so the merchant is not invoiced for cover nobody bought.
 */

export interface RouteCall {
  token: string
  apiBase: string
  fetchImpl?: ProviderFetch
  signal?: AbortSignal
}

export interface RouteQuote {
  quoteId: string | null
  premiumCents: number
  currency: string
}

/** The longest a quote may hold up a cart. */
export const ROUTE_QUOTE_TIMEOUT_MS = 2_000

/** The premium for `subtotalCents` of shipped goods. Throws when Route does not give a usable one. */
export async function quoteRoute(
  call: RouteCall,
  request: { subtotalCents: number; currency: string; items: Array<{ name: string; sku?: string; quantity: number; unitCents: number }> },
): Promise<RouteQuote> {
  const { body } = await callProvider<{
    id?: string
    premium?: { amount?: unknown; currency?: unknown }
  }>({
    vendor: 'Route',
    url: `${call.apiBase}/quotes`,
    method: 'POST',
    headers: { Token: call.token },
    body: {
      subtotal: centsToDecimal(request.subtotalCents),
      currency: request.currency.toUpperCase(),
      cart_items: request.items.map((item) => ({
        name: item.name,
        ...(item.sku ? { sku: item.sku } : {}),
        quantity: item.quantity,
        unit_price: centsToDecimal(item.unitCents),
      })),
    },
    timeoutMs: ROUTE_QUOTE_TIMEOUT_MS,
    signal: call.signal,
    fetchImpl: call.fetchImpl,
  })
  const premiumCents = decimalToCents(body?.premium?.amount)
  const currency = String(body?.premium?.currency ?? request.currency).toLowerCase()
  if (premiumCents === null || premiumCents <= 0 || currency !== request.currency.toLowerCase()) {
    throw new PostPurchaseProviderError('Route', 200, 'Route answered no usable premium', body)
  }
  return { quoteId: typeof body?.id === 'string' ? body.id : null, premiumCents, currency }
}

export interface RouteOrderRequest {
  sourceOrderId: string
  sourceOrderNumber: string
  createdAtMs: number
  currency: string
  /** The shipped goods covered, integer cents. */
  subtotalCents: number
  /** What the buyer paid for the cover, integer cents. */
  premiumCents: number
  quoteId?: string | null
  customer: { name: string | null; email: string | null }
  shipTo: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  } | null
  items: Array<{ id: string; name: string; sku?: string | null; quantity: number; unitCents: number }>
}

function splitName(name: string | null): { first_name: string; last_name: string } {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  return { first_name: parts[0] ?? '', last_name: parts.slice(1).join(' ') }
}

/** Opens the policy. `already` when Route has one for this order. */
export async function createRouteOrder(
  call: RouteCall,
  request: RouteOrderRequest,
): Promise<{ outcome: 'created' | 'already'; policyId: string | null }> {
  try {
    const { body } = await callProvider<{ id?: string }>({
      vendor: 'Route',
      url: `${call.apiBase}/orders`,
      method: 'POST',
      headers: { Token: call.token },
      body: {
        source_order_id: request.sourceOrderId,
        source_order_number: request.sourceOrderNumber,
        source_created_on: new Date(request.createdAtMs || Date.now()).toISOString(),
        currency: request.currency.toUpperCase(),
        subtotal: centsToDecimal(request.subtotalCents),
        amount_covered: centsToDecimal(request.subtotalCents),
        paid_to_insure: centsToDecimal(request.premiumCents),
        insurance_selected: true,
        ...(request.quoteId ? { quote_id: request.quoteId } : {}),
        customer_details: { ...splitName(request.customer.name), email: request.customer.email ?? '' },
        ...(request.shipTo
          ? {
              shipping_details: {
                ...splitName(request.customer.name),
                street_address1: request.shipTo.line1 ?? '',
                street_address2: request.shipTo.line2 ?? '',
                city: request.shipTo.city ?? '',
                province: request.shipTo.state ?? '',
                zip: request.shipTo.postalCode ?? '',
                country_code: request.shipTo.country ?? '',
              },
            }
          : {}),
        line_items: request.items.map((item) => ({
          source_product_id: item.id,
          name: item.name,
          ...(item.sku ? { sku: item.sku } : {}),
          quantity: item.quantity,
          unit_price: centsToDecimal(item.unitCents),
        })),
      },
      signal: call.signal,
      fetchImpl: call.fetchImpl,
    })
    return { outcome: 'created', policyId: typeof body?.id === 'string' ? body.id : null }
  } catch (error) {
    if (error instanceof PostPurchaseProviderError && error.status === 409) {
      return { outcome: 'already', policyId: null }
    }
    throw error
  }
}

/** Tells Route a parcel left, by its tracking number. */
export async function createRouteShipment(
  call: RouteCall,
  request: { sourceOrderId: string; trackingNumber: string; carrier?: string | null; itemIds: string[] },
): Promise<void> {
  try {
    await callProvider({
      vendor: 'Route',
      url: `${call.apiBase}/shipments`,
      method: 'POST',
      headers: { Token: call.token },
      body: {
        source_order_id: request.sourceOrderId,
        tracking_number: request.trackingNumber,
        ...(request.carrier ? { courier_id: request.carrier } : {}),
        source_product_ids: request.itemIds,
      },
      signal: call.signal,
      fetchImpl: call.fetchImpl,
    })
  } catch (error) {
    // The same parcel told twice — a retried event — is not a failure.
    if (error instanceof PostPurchaseProviderError && error.status === 409) return
    throw error
  }
}

/** Ends the policy. */
export async function cancelRouteOrder(call: RouteCall, policyId: string): Promise<void> {
  await callProvider({
    vendor: 'Route',
    url: `${call.apiBase}/orders/${encodeURIComponent(policyId)}/cancel`,
    method: 'POST',
    headers: { Token: call.token },
    body: {},
    signal: call.signal,
    fetchImpl: call.fetchImpl,
  })
}
