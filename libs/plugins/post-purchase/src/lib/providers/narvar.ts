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

import { narvarCarrierFor } from '../model/carriers'
import { callProvider, centsToDecimal, type ProviderFetch } from './http'

/**
 * The Narvar adapter (AGL-3635): the retailer's own Narvar account, its
 * Order API with the account id and auth token it issues (HTTP Basic).
 *
 * Narvar keys an order by its number and takes the whole order each time,
 * so the adapter always sends everything it knows — the lines, the buyer,
 * every parcel so far — and a retried event sends the same document again
 * rather than adding to it. Its tracking page is the retailer's own
 * (`{moniker}.narvar.com`), linked per carrier it recognizes.
 */

export interface NarvarCall {
  accountId: string
  authToken: string
  apiBase: string
  fetchImpl?: ProviderFetch
}

export interface NarvarOrder {
  orderNumber: string
  createdAtMs: number
  status: 'PROCESSING' | 'SHIPPED' | 'PARTIAL' | 'DELIVERED' | 'CANCELLED'
  currency: string
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
  shipments: Array<{
    carrier: string | null
    trackingNumber: string
    atMs: number
    lines: Array<{ itemId: string; sku?: string | null; quantity: number }>
  }>
}

function basicAuth(call: NarvarCall): string {
  return `Basic ${Buffer.from(`${call.accountId}:${call.authToken}`, 'utf8').toString('base64')}`
}

/** Sends the whole order; Narvar keeps the latest. */
export async function upsertNarvarOrder(call: NarvarCall, order: NarvarOrder): Promise<void> {
  const parts = String(order.customer.name ?? '').trim().split(/\s+/).filter(Boolean)
  const address = order.shipTo
    ? {
        street_1: order.shipTo.line1 ?? '',
        street_2: order.shipTo.line2 ?? '',
        city: order.shipTo.city ?? '',
        state: order.shipTo.state ?? '',
        zip: order.shipTo.postalCode ?? '',
        country: order.shipTo.country ?? '',
      }
    : undefined
  await callProvider({
    vendor: 'Narvar',
    url: `${call.apiBase}/orders`,
    method: 'POST',
    headers: { Authorization: basicAuth(call) },
    body: {
      order_info: {
        order_number: order.orderNumber,
        order_date: new Date(order.createdAtMs || Date.now()).toISOString(),
        status: order.status,
        currency_code: order.currency.toUpperCase(),
        checkout_locale: 'en_US',
        order_items: order.items.map((item, index) => ({
          item_id: item.id,
          line_number: index + 1,
          name: item.name,
          ...(item.sku ? { sku: item.sku } : {}),
          quantity: item.quantity,
          unit_price: centsToDecimal(item.unitCents),
        })),
        shipments: order.shipments.map((shipment) => ({
          ...(narvarCarrierFor(shipment.carrier) ? { carrier: narvarCarrierFor(shipment.carrier) } : {}),
          tracking_number: shipment.trackingNumber,
          ship_date: new Date(shipment.atMs || Date.now()).toISOString(),
          items_info: shipment.lines.map((line) => ({
            item_id: line.itemId,
            ...(line.sku ? { sku: line.sku } : {}),
            quantity: line.quantity,
          })),
          ...(address ? { shipped_to: { first_name: parts[0] ?? '', last_name: parts.slice(1).join(' '), address } } : {}),
        })),
        customer: {
          first_name: parts[0] ?? '',
          last_name: parts.slice(1).join(' '),
          email: order.customer.email ?? '',
          ...(address ? { address } : {}),
        },
      },
    },
    fetchImpl: call.fetchImpl,
  })
}

/** The retailer's Narvar tracking page for a parcel, or `null` for a carrier it cannot name. */
export function narvarTrackingPage(moniker: string, carrier: string | null | undefined, trackingNumber: string): string | null {
  const code = narvarCarrierFor(carrier)
  const number = trackingNumber.replace(/\s+/g, '')
  if (!code || !number || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(moniker)) return null
  return `https://${moniker}.narvar.com/${moniker}/tracking/${code}?tracking_numbers=${encodeURIComponent(number)}`
}
