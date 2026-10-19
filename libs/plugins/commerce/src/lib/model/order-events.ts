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

import type {
  PluginDomainEvent,
  PluginDomainEventDeclaration,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import {
  CHECKOUT_STARTED_EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_DELIVERED_EVENT,
  ORDER_FULFILLED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_REFUNDED_EVENT,
  RETURN_APPROVED_EVENT,
  RETURN_DECLINED_EVENT,
  RETURN_RECEIVED_EVENT,
  RETURN_REFUNDED_EVENT,
  RETURN_REQUESTED_EVENT,
} from '../contracts'

/**
 * The order and return events commerce raises (AGL-3611), for other plugins
 * — accounting, shipping, workflows — and for the merchant's own webhooks.
 *
 * Their names and payloads are commerce's contract with other plugins and
 * live in `../contracts` (AGL-3980), which a subscriber imports as
 * `@aglyn/plugins-commerce/contracts`; they are re-exported here for
 * commerce's own code. What stays here is how commerce offers them to the
 * merchant: the labels, the workflow triggers, the picker order.
 */

export {
  CHECKOUT_STARTED_EVENT,
  COMMERCE_EVENT_NAMES,
  ORDER_CANCELLED_EVENT,
  ORDER_DELIVERED_EVENT,
  ORDER_FULFILLED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_REFUNDED_EVENT,
  RETURN_APPROVED_EVENT,
  RETURN_DECLINED_EVENT,
  RETURN_RECEIVED_EVENT,
  RETURN_REFUNDED_EVENT,
  RETURN_REQUESTED_EVENT,
} from '../contracts'
export type {
  CheckoutStartedEventPayload,
  CommerceEventName,
  OrderEventFulfillment,
  OrderEventOrder,
  OrderEventPayload,
  OrderEventRefund,
  OrderEventReturn,
  OrderFulfilledEventPayload,
  OrderRefundedEventPayload,
  OrderViewFulfillment,
  ReturnEventPayload,
} from '../contracts'

export const CHECKOUT_STARTED_EVENT_DECLARATION: PluginDomainEventDeclaration = {
  event: CHECKOUT_STARTED_EVENT as PluginDomainEvent<unknown>,
  label: 'Checkout started',
  description:
    'A shopper reached checkout with an email address: the basket, its value and the link back to it. Raised once per checkout, whether or not it is paid.',
  payloadKeys: ['checkout'],
}

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
