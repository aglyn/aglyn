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

import { serialize } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { fulfillmentLineQuantities } from '../../model/order-fulfillment'
import { fulfillmentTrackingUrl } from '../../model/tracking-url'
import { orderTaxEngineView } from '../../model/commerce-tax-engine'

/**
 * The public order shape from an order's data (AGL-3611): the same object the
 * API returns, so an order event and an outbound webhook carry exactly what
 * `GET /v1/sites/{id}/orders/{id}` would.
 */
export function orderViewFromData(id: string, data: Record<string, any>) {
  const totals = (data.totals ?? {}) as Record<string, unknown>
  const legacyTotal = Number(data.amountCents ?? NaN)
  const totalCents = Number.isFinite(Number(totals.totalCents))
    ? Number(totals.totalCents)
    : Number.isFinite(legacyTotal)
      ? legacyTotal
      : null
  const legacyFee = Number(data.feeCents ?? NaN)
  return {
    id,
    object: 'order',
    number: typeof data.number === 'number' ? data.number : null,
    status: (data.status as string) ?? null,
    channel: (data.channel as string) ?? 'online',
    currency: 'usd',
    customerEmail: data.customerEmail ?? null,
    customerName: data.customerName ?? null,
    lineItems: serialize(data.lineItems ?? []),
    totals: {
      itemsCents: Number(totals.itemsCents ?? 0),
      shippingCents: Number(totals.shippingCents ?? 0),
      taxCents: Number(totals.taxCents ?? 0),
      discountCents: Number(totals.discountCents ?? 0),
      totalCents,
      // The Connect application fee. NOT subtracted from `totalCents` — it is
      // Aglyn's cut of a total the shopper already paid in full, so a client
      // that nets it out of revenue would understate what it collected.
      feeCents: Number.isFinite(Number(totals.feeCents))
        ? Number(totals.feeCents)
        : Number.isFinite(legacyFee)
          ? legacyFee
          : 0,
    },
    // Money already handed back, for any reason. A chargeback lands here too,
    // so `refundedCents > 0` does not by itself mean the merchant chose it.
    refundedCents: Number(data.refundedCents ?? 0),
    // Who the tax was charged under (AGL-3614): `stripe-automatic` tax is
    // Aglyn's to remit as marketplace facilitator and never reaches the
    // merchant's account, which a ledger posting the sale has to know. An
    // order from before the regime was recorded says `null`, never a guess.
    taxMode: typeof data.taxMode === 'string' && data.taxMode ? data.taxMode : null,
    // The merchant's own tax service (AGL-3631): which one priced the sale, or
    // that it was asked and the store's own rates were charged instead
    // (`status: 'fallback'`). `null` when no service was asked. The regime is
    // still `taxMode` — a service the merchant connected answers for tax the
    // merchant remits.
    taxEngine: orderTaxEngineView(data.taxEngine),
    disputed: Boolean(data.dispute),
    shippingAddress: serialize(data.shippingAddress) ?? null,
    couponCode: data.couponCode ?? null,
    // Shipment records — the half of fulfilment an integration can use
    // without a write (AGL-2460). `status` says an order is `fulfilled`; it
    // does not say which carrier took it or under what tracking number, so a
    // 3PL or accounting reconcile could see THAT an order shipped and never
    // WHICH shipment it was. The console's order dialog shows both, and an
    // order that has been shipped twice (a split shipment) is indistinguish-
    // able from one shipped once when only the status is published.
    //
    // `atMs` is a number of milliseconds, not a Firestore Timestamp, so
    // `serialize` passes it through untouched. It is republished as `at` in
    // ISO 8601 to match `created` and every other time this API emits: one
    // object publishing two time formats is a bug an integrator finds late,
    // in their own timezone conversion, and blames on their own code.
    fulfillments: (Array.isArray(data.fulfillments) ? data.fulfillments : []).map(
      (entry: Record<string, unknown>) => {
        const atMs = Number((entry ?? {}).atMs)
        return {
          id: (entry ?? {}).id ?? null,
          lineItemIds: Array.isArray((entry ?? {}).lineItemIds)
            ? (entry as { lineItemIds: unknown[] }).lineItemIds
            : [],
          // Units per line (AGL-3611); a fulfillment recorded before
          // quantities shipped every unit of the lines it names.
          lines: fulfillmentLineQuantities(
            { lineItems: Array.isArray(data.lineItems) ? data.lineItems : [] },
            (entry ?? {}) as never,
          ),
          status: (entry ?? {}).status === 'cancelled' ? 'cancelled' : 'active',
          carrier: (entry ?? {}).carrier ?? null,
          trackingNumber: (entry ?? {}).trackingNumber ?? null,
          trackingUrl: fulfillmentTrackingUrl((entry ?? {}) as never),
          labelUrl: (entry ?? {}).labelUrl ?? null,
          at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
        }
      },
    ),
    created: serialize(data.createdAt) ?? null,
  }
}

