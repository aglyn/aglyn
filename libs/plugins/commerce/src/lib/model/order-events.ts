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
  definePluginDomainEvent,
  type PluginDomainEvent,
  type PluginDomainEventDeclaration,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'

/**
 * The order and return events commerce raises (AGL-3611), for other plugins
 * — accounting, shipping, workflows — and for the merchant's own webhooks.
 *
 * Each payload carries `order` in the public API's shape (`GET
 * /v1/sites/{siteId}/orders/{orderId}`), as it stood once the fact was
 * written, so a subscriber reads one documented object rather than the
 * plugin's storage. A subscriber in another plugin restates the fields it
 * reads; these types are this plugin's own.
 */

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
  lineItems: unknown
  totals: {
    itemsCents: number
    shippingCents: number
    taxCents: number
    discountCents: number
    totalCents: number | null
    feeCents: number
  }
  refundedCents: number
  /** The tax regime: `stripe-automatic`, `manual`, `none`, or `null` when not recorded. */
  taxMode: string | null
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

/** Every event commerce raises, by name. */
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

/** The events, in the order pickers list them, with their words. */
export const COMMERCE_EVENT_DECLARATIONS: ReadonlyArray<
  PluginDomainEventDeclaration & { event: PluginDomainEvent<unknown>; hostEvent: string }
> = [
  {
    event: ORDER_PAID_EVENT,
    hostEvent: 'orderPaid',
    label: 'Order paid',
    description:
      'An order was paid: a storefront checkout, a buy-now, a paid payment link, a POS sale or a subscription renewal.',
    payloadKeys: ['order'],
  },
  {
    event: ORDER_FULFILLED_EVENT,
    hostEvent: 'orderFulfilled',
    label: 'Order fulfilled',
    description: 'A shipment was recorded on an order, once per shipment, with the units it carried.',
    payloadKeys: ['order', 'fulfillment'],
  },
  {
    event: ORDER_DELIVERED_EVENT,
    hostEvent: 'orderDelivered',
    label: 'Order delivered',
    description: 'An order was marked delivered.',
    payloadKeys: ['order'],
  },
  {
    event: ORDER_REFUNDED_EVENT,
    hostEvent: 'orderRefunded',
    label: 'Order refunded',
    description: 'Money went back to the buyer, in part or in full, once per refund.',
    payloadKeys: ['order', 'refund'],
  },
  {
    event: ORDER_CANCELLED_EVENT,
    hostEvent: 'orderCancelled',
    label: 'Order canceled',
    description: 'An order was canceled and its stock returned.',
    payloadKeys: ['order'],
  },
  {
    event: RETURN_REQUESTED_EVENT,
    hostEvent: 'returnRequested',
    label: 'Return requested',
    description: 'A buyer asked to return items, or the merchant opened a return for them.',
    payloadKeys: ['order', 'return'],
  },
  {
    event: RETURN_APPROVED_EVENT,
    hostEvent: 'returnApproved',
    label: 'Return approved',
    description: 'The store approved a return, or opened one itself.',
    payloadKeys: ['order', 'return'],
  },
  {
    event: RETURN_DECLINED_EVENT,
    hostEvent: 'returnDeclined',
    label: 'Return declined',
    description: 'The store declined a return request.',
    payloadKeys: ['order', 'return'],
  },
  {
    event: RETURN_RECEIVED_EVENT,
    hostEvent: 'returnReceived',
    label: 'Return received',
    description: 'The returned items arrived, with what went back in stock.',
    payloadKeys: ['order', 'return'],
  },
  {
    event: RETURN_REFUNDED_EVENT,
    hostEvent: 'returnRefunded',
    label: 'Return refunded',
    description: 'A return was refunded.',
    payloadKeys: ['order', 'return'],
  },
]

/** The workflow trigger an event is offered as. */
export function commerceHostEventFor(event: string): string | null {
  return COMMERCE_EVENT_DECLARATIONS.find((entry) => entry.event.id === event)?.hostEvent ?? null
}

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
