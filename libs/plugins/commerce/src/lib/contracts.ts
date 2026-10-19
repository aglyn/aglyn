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

import { definePluginDomainEvent } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { definePluginServiceContract } from '@aglyn/aglyn/plugin-manager/plugin-services'

/**
 * What commerce publishes for other plugins (AGL-3980): the order and return
 * events it raises, the checkout it reports, and the order history service it
 * registers — each by its id and its shape, and nothing that runs commerce.
 *
 * Another plugin imports this module as `@aglyn/plugins-commerce/contracts`,
 * names `commerce` in its `uses` in plugins.config.json, and carries
 * `@aglyn/plugins-commerce` as an optional peer. Importing it never loads
 * commerce, so the subscriber still runs with commerce absent: an event it
 * listens for is simply never raised, and the history service resolves to
 * `null`. `check:lib-boundaries` refuses a runtime import here other than
 * `@aglyn/aglyn`, and any other import of commerce from another plugin.
 */

// ── Events (AGL-3611) ────────────────────────────────────────────────────────
//
// Each payload carries `order` in the public API's shape (`GET
// /v1/sites/{siteId}/orders/{orderId}`), as it stood once the fact was
// written, so a subscriber reads one documented object rather than the
// plugin's storage.

/** A shipment as the order itself lists it. */
export interface OrderViewFulfillment {
  id: string | null
  lineItemIds: unknown[]
  /** Units per line; a fulfillment recorded before quantities shipped every unit of the lines it names. */
  lines: Array<{ lineItemId: number; quantity: number }>
  status: 'active' | 'cancelled'
  carrier: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  labelUrl: string | null
  /** ISO 8601. */
  at: string | null
}

/** An order as the public API returns it. Money is integer cents. */
export interface OrderEventOrder {
  id: string
  object: 'order'
  number: number | null
  status: string | null
  channel: string
  currency: string
  customerEmail: string | null
  customerName: string | null
  /** The lines as stored, serialized; their fields are not a contract yet. */
  lineItems: unknown
  totals: {
    itemsCents: number
    shippingCents: number
    taxCents: number
    discountCents: number
    totalCents: number | null
    feeCents: number
    /** Optional lines the buyer added at checkout (AGL-3635), inside `totalCents` and outside `itemsCents`. */
    extrasCents?: number
  }
  refundedCents: number
  /** The tax regime: `stripe-automatic`, `manual`, `none`, or `null` when not recorded. */
  taxMode: string | null
  /** Whether real money moved (AGL-3699): `false` for a Stripe test-mode order. */
  livemode?: boolean
  /** The optional lines the buyer added at checkout and whose offer each was (AGL-3635). */
  extras?: Array<{
    id: string
    pluginId: string
    key: string
    label: string
    amountCents: number
    quoteRef: string | null
  }>
  /** Store credit another plugin kept that paid part of the sale (AGL-3640). */
  credits?: Array<{
    providerId: string
    pluginId: string
    reference: string
    label: string
    last4: string
    amountCents: number
    appliedAs: 'discount' | 'tender'
  }>
  /** The merchant's own tax service that priced the sale (AGL-3631); `null` when none was asked. */
  taxEngine?: {
    provider: string
    providerLabel: string
    status: 'quoted' | 'fallback'
    reason: string | null
    sandbox: boolean
  } | null
  disputed?: boolean
  /** The address as stored, serialized; `null` for an order that ships nowhere. */
  shippingAddress?: Record<string, unknown> | null
  couponCode?: string | null
  fulfillments?: OrderViewFulfillment[]
  /** ISO 8601. */
  created?: string | null
  [key: string]: unknown
}

/** A shipment as an event carries it. */
export interface OrderEventFulfillment {
  id: string
  lines: Array<{ lineItemId: number; quantity: number }>
  carrier: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  labelUrl: string | null
  /** What the shipment cost to send — its label's cost, or the merchant's hand-entered one (AGL-3705) — in integer cents of the order's currency; `null` when unknown (AGL-3693). */
  labelCostCents: number | null
  at: string
}

/** A refund as an event carries it: what THIS refund moved. */
export interface OrderEventRefund {
  /** Stripe's refund id, when there is one. */
  id: string | null
  amountCents: number
  /** The line indexes refunded by name; empty for an amount-only refund. */
  lineItemIds: number[]
  /** Whether this refund left nothing more to refund. */
  full: boolean
}

/** A return as an event carries it. */
export interface OrderEventReturn {
  id: string
  status: string
  lines: Array<{ lineItemId: number; quantity: number; reason: string }>
  refundCents: number | null
  /** What went back in stock when the parcel arrived; `null` before then. */
  restock?: Array<{ lineItemId: number; quantity: number }> | null
}

export interface OrderEventPayload {
  order: OrderEventOrder
}
export interface OrderFulfilledEventPayload extends OrderEventPayload {
  fulfillment: OrderEventFulfillment
}
export interface OrderRefundedEventPayload extends OrderEventPayload {
  refund: OrderEventRefund
}
export interface ReturnEventPayload extends OrderEventPayload {
  return: OrderEventReturn
}

export const ORDER_PAID_EVENT = definePluginDomainEvent<OrderEventPayload>('order.paid')
export const ORDER_FULFILLED_EVENT = definePluginDomainEvent<OrderFulfilledEventPayload>('order.fulfilled')
export const ORDER_DELIVERED_EVENT = definePluginDomainEvent<OrderEventPayload>('order.delivered')
export const ORDER_REFUNDED_EVENT = definePluginDomainEvent<OrderRefundedEventPayload>('order.refunded')
export const ORDER_CANCELLED_EVENT = definePluginDomainEvent<OrderEventPayload>('order.cancelled')
export const RETURN_REQUESTED_EVENT = definePluginDomainEvent<ReturnEventPayload>('return.requested')
export const RETURN_APPROVED_EVENT = definePluginDomainEvent<ReturnEventPayload>('return.approved')
export const RETURN_DECLINED_EVENT = definePluginDomainEvent<ReturnEventPayload>('return.declined')
export const RETURN_RECEIVED_EVENT = definePluginDomainEvent<ReturnEventPayload>('return.received')
export const RETURN_REFUNDED_EVENT = definePluginDomainEvent<ReturnEventPayload>('return.refunded')

/**
 * A checkout a shopper reached with an address (AGL-3639): the fact an
 * abandoned-cart flow in a merchant's own email platform starts from. Not an
 * order event — nothing was bought — so it is raised beside them rather than
 * among them: it is not a workflow trigger and not offered to the merchant's
 * outbound webhooks, whose events are about orders.
 */
export interface CheckoutStartedEventPayload {
  checkout: {
    /** The checkout session's id: one event per checkout. */
    id: string
    email: string
    /** Whether the shopper ticked the store's marketing box at checkout. */
    marketingOptIn: boolean
    currency: string
    /** The basket's list value, integer cents, before discounts and shipping. */
    itemsCents: number
    /** Where the shopper can pick the checkout up again. */
    resumeUrl: string | null
    items: Array<{
      productId: string
      variantId: string | null
      name: string
      sku: string | null
      quantity: number
      unitCents: number
    }>
  }
}

export const CHECKOUT_STARTED_EVENT = definePluginDomainEvent<CheckoutStartedEventPayload>('checkout.started')

/** Every order and return event commerce raises, by name. */
export type CommerceEventName =
  | 'order.paid'
  | 'order.fulfilled'
  | 'order.delivered'
  | 'order.refunded'
  | 'order.cancelled'
  | 'return.requested'
  | 'return.approved'
  | 'return.declined'
  | 'return.received'
  | 'return.refunded'

/** The order lifecycle's five events, by name. */
export type CommerceOrderEventName = Extract<CommerceEventName, `order.${string}`>

/** The event names, for a webhook's event picker. */
export const COMMERCE_EVENT_NAMES: readonly CommerceEventName[] = [
  'order.paid',
  'order.fulfilled',
  'order.delivered',
  'order.refunded',
  'order.cancelled',
  'return.requested',
  'return.approved',
  'return.declined',
  'return.received',
  'return.refunded',
]

// ── Order history (AGL-3614) ─────────────────────────────────────────────────
//
// The events bring every order from the moment a subscriber listens. A plugin
// that must also read the orders BEFORE that — accounting, posting a
// merchant's earlier sales from a start date — reads them through this
// service, in the same public shape the events carry, and never through
// commerce's storage. Commerce registers the one implementation from its
// console server declarations; with commerce absent it resolves to `null`.

/** One stored order, as the history hands it out. */
export interface OrderHistoryEntry {
  id: string
  createdAtMs: number
  /** When it was paid; `null` for one never paid. */
  paidAtMs: number | null
  /** The newest refund on its timeline, or `null`. */
  lastRefundAtMs: number | null
  /** Whether its prices include the tax. */
  taxInclusive: boolean
  /** The tax rate it was charged under, when one was named. */
  taxRateId: string | null
  /** The order in the public API's shape. */
  order: OrderEventOrder
}

export interface OrderHistoryPageRequest {
  hostId: string
  /** Orders created at or after this… */
  fromMs: number
  /** …and before this. */
  untilMs: number
  /** At most this many, oldest first; capped at 200. */
  limit: number
}

export interface OrderHistoryReader {
  listOrders(request: OrderHistoryPageRequest): Promise<OrderHistoryEntry[]>
}

export const ORDER_HISTORY_CONTRACT_ID = 'commerce.orderHistory'

export const ORDER_HISTORY_CONTRACT = definePluginServiceContract<OrderHistoryReader>(ORDER_HISTORY_CONTRACT_ID, {
  multiple: false,
})
