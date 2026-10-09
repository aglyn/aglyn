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

import type { PluginDomainEvent } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  type PluginEventWriter,
  raisePluginEvent,
  stagePluginEvent,
} from '@aglyn/tenant-data-admin/server/plugin-event-outbox'
import { BUNDLE_ID } from '../constants/bundle-common'
import type { OrderFulfillment } from '../model/commerce-orders'
import {
  CHECKOUT_STARTED_EVENT,
  type CheckoutStartedEventPayload,
} from '../model/order-events'
import type {
  OrderEventFulfillment,
  OrderEventOrder,
  OrderEventPayload,
} from '../model/order-events'
import { fulfillmentLineQuantities } from '../model/order-fulfillment'
import { fulfillmentTrackingUrl } from '../model/tracking-url'
import { orderViewFromData } from './api-v1/order-view'

/**
 * Raising commerce's order events (AGL-3611). Two doors, one per kind of
 * caller, so every status-change site raises its event in one line:
 *
 *  - `stageOrderEvent` rides the caller's transaction, so the event exists
 *    exactly when the status does. For a write that already holds the order
 *    it is about to store.
 *  - `raiseOrderEvent` reads the order once the write has landed and queues
 *    the event, keyed so a redelivered webhook or a retried request raises it
 *    once. For a write with no transaction to ride.
 *
 * Neither ever throws into the write it reports: a fact that happened is not
 * undone because its announcement could not be queued.
 */

/** A shipment in the event's words. */
export function fulfillmentEventView(
  order: { lineItems?: unknown },
  fulfillment: OrderFulfillment,
): OrderEventFulfillment {
  return {
    id: fulfillment.id,
    lines: fulfillmentLineQuantities(order as never, fulfillment),
    carrier: fulfillment.carrier ?? null,
    trackingNumber: fulfillment.trackingNumber ?? null,
    trackingUrl: fulfillmentTrackingUrl(fulfillment),
    labelUrl: fulfillment.labelUrl ?? null,
    labelCostCents: fulfillment.labelCostCents ?? null,
    at: new Date(fulfillment.atMs).toISOString(),
  }
}

export interface OrderEventRequest<Payload extends OrderEventPayload> {
  hostId: string
  orderId: string
  /** The occurrence: the same key raises the event once. */
  key: string
  /** Everything the payload carries beside `order`. */
  extra?: Omit<Payload, 'order'>
}

/**
 * Stages an event inside the caller's transaction, from the order data the
 * transaction is about to store (the read merged with its patch).
 */
export function stageOrderEvent<Payload extends OrderEventPayload>(
  writer: PluginEventWriter,
  event: PluginDomainEvent<Payload>,
  request: OrderEventRequest<Payload> & { order: Record<string, unknown> },
): void {
  try {
    const firestore = firebaseAdmin.app().firestore()
    stagePluginEvent(writer, firestore, {
      event,
      pluginId: BUNDLE_ID,
      hostId: request.hostId,
      key: `${request.orderId}:${request.key}`,
      payload: {
        order: orderViewFromData(request.orderId, request.order) as OrderEventOrder,
        ...(request.extra ?? {}),
      },
    })
  } catch (error) {
    console.error(`[commerce] ${event.id} not staged for ${request.orderId}`, error)
  }
}

/** Queues an event after the write, reading the order as it now stands. */
export async function raiseOrderEvent<Payload extends OrderEventPayload>(
  event: PluginDomainEvent<Payload>,
  request: OrderEventRequest<Payload>,
): Promise<void> {
  try {
    const firestore = firebaseAdmin.app().firestore()
    const snapshot = await firestore
      .collection('hosts')
      .doc(request.hostId)
      .collection('orders')
      .doc(request.orderId)
      .get()
    if (!snapshot.exists) return
    await raisePluginEvent(firestore, {
      event,
      pluginId: BUNDLE_ID,
      hostId: request.hostId,
      key: `${request.orderId}:${request.key}`,
      payload: {
        order: orderViewFromData(request.orderId, snapshot.data() ?? {}) as OrderEventOrder,
        ...(request.extra ?? {}),
      },
    })
  } catch (error) {
    console.error(`[commerce] ${event.id} not raised for ${request.orderId}`, error)
  }
}

/**
 * Raises `checkout.started` (AGL-3639) for a checkout a shopper reached with
 * an address, keyed by the session so a retried request raises it once.
 * Never throws into the checkout it reports.
 */
export async function raiseCheckoutStarted(
  hostId: string,
  checkout: CheckoutStartedEventPayload['checkout'],
): Promise<void> {
  if (!checkout.email) return
  try {
    await raisePluginEvent(firebaseAdmin.app().firestore(), {
      event: CHECKOUT_STARTED_EVENT,
      pluginId: BUNDLE_ID,
      hostId,
      key: `checkout:${checkout.id}`,
      payload: { checkout },
    })
  } catch (error) {
    console.error(`[commerce] checkout.started not raised for ${checkout.id}`, error)
  }
}
