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
  declarePluginDomainEvents,
  subscribePluginDomainEvent,
  type PluginDomainEventEnvelope,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { BUNDLE_ID } from '../constants/bundle-common'
import { COMMERCE_EVENT_DECLARATIONS } from '../model/order-events'

/**
 * Commerce's events as workflow triggers (AGL-3611).
 *
 * The workflows plugin listens to host events, flat key/value payloads it
 * puts in an automation's scope. Commerce subscribes to its own order and
 * return events and raises each as the host event its declaration names
 * (`orderPaid`, `orderFulfilled`, …), declared in `plugins.config.json` so
 * every trigger picker lists them. The automation engine is never imported:
 * the host event bus is the seam.
 */

/** The flat scope an automation reads: the order's facts, then the event's own. */
export function hostEventPayloadFor(
  envelope: Pick<PluginDomainEventEnvelope, 'event' | 'payload'>,
): Record<string, string | number | boolean> {
  const payload = (envelope.payload ?? {}) as Record<string, any>
  const order = (payload.order ?? {}) as Record<string, any>
  const flat: Record<string, string | number | boolean> = {}
  const put = (key: string, value: unknown) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      flat[key] = value
    }
  }
  put('orderId', order.id)
  put('orderNumber', typeof order.number === 'number' ? `#${order.number}` : order.id)
  put('status', order.status)
  put('channel', order.channel)
  put('email', order.customerEmail)
  put('name', order.customerName)
  put('totalCents', order.totals?.totalCents)
  put('currency', order.currency)
  const fulfillment = payload.fulfillment as Record<string, any> | undefined
  if (fulfillment) {
    put('fulfillmentId', fulfillment.id)
    put('carrier', fulfillment.carrier)
    put('trackingNumber', fulfillment.trackingNumber)
    put('trackingUrl', fulfillment.trackingUrl)
  }
  const refund = payload.refund as Record<string, any> | undefined
  if (refund) {
    put('refundCents', refund.amountCents)
    put('fullRefund', refund.full)
  }
  const returned = payload.return as Record<string, any> | undefined
  if (returned) {
    put('returnId', returned.id)
    put('returnStatus', returned.status)
    put('returnRefundCents', returned.refundCents)
  }
  return flat
}

/**
 * Declares commerce's events and subscribes the trigger bridge, from the
 * server declarations. `emitHostEvent` arrives with the first event, not
 * with the boot.
 */
export function registerCommerceEventTriggers(): void {
  declarePluginDomainEvents(COMMERCE_EVENT_DECLARATIONS, { pluginId: BUNDLE_ID })
  for (const declaration of COMMERCE_EVENT_DECLARATIONS) {
    subscribePluginDomainEvent(
      declaration.event,
      async (envelope) => {
        const { emitCommerceHostEvent } = await import('./order-event-host-emit')
        await emitCommerceHostEvent(envelope.hostId, declaration.hostEvent, hostEventPayloadFor(envelope))
      },
      // Named, so the outbox records it apart from the webhook subscriber
      // this plugin also registers.
      { pluginId: BUNDLE_ID, name: 'workflow-triggers' },
    )
  }
}
