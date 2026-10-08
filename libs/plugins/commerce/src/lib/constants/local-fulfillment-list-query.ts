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

import type { OrderFulfillmentKey } from '../model/order-local-fulfillment'

/*
 * THE PICKUP AND DELIVERY QUEUE, ON ITS QUERY (AGL-3624).
 *
 * `hosts/{hostId}/orders` where `fulfillmentKey` is one tab's key, the order
 * is still open (`status` in the three that can be handed over), and — when
 * a location is chosen — `fulfillmentLocationId` is that location; soonest
 * `fulfillmentDueMs` first. Every writer of a pickup or a local delivery
 * stamps the three fields (`orderLocalFulfillmentListFields`), so a tab is ONE
 * Firestore query and two composites serve every tab, with or without a
 * location: `(fulfillmentKey, status, fulfillmentDueMs)` and
 * `(fulfillmentLocationId, fulfillmentKey, status, fulfillmentDueMs)`.
 *
 * Pure and import-free but for a type, because the native Aglyn app runs the
 * same query (`tools/scripts/native-contracts.json`): each platform builds it
 * from these values and nothing else.
 */

export interface LocalFulfillmentQueueTab {
  key: OrderFulfillmentKey
  label: string
  /** Which side of the queue the tab belongs to. */
  method: 'pickup' | 'local_delivery'
}

export const LOCAL_FULFILLMENT_QUEUE_TABS: readonly LocalFulfillmentQueueTab[] = [
  { key: 'pickup_preparing', label: 'To prepare', method: 'pickup' },
  { key: 'pickup_ready', label: 'Ready for pickup', method: 'pickup' },
  { key: 'delivery_scheduled', label: 'To deliver', method: 'local_delivery' },
  { key: 'delivery_out_for_delivery', label: 'Out for delivery', method: 'local_delivery' },
  { key: 'delivery_failed', label: 'Delivery failed', method: 'local_delivery' },
]

/** The order statuses an order can still be handed over in. */
export const LOCAL_FULFILLMENT_OPEN_STATUSES: readonly string[] = ['paid', 'partially_fulfilled', 'fulfilled']

/** One page of the queue. */
export const LOCAL_FULFILLMENT_QUEUE_LIMIT = 50

export const LOCAL_FULFILLMENT_QUEUE_FIELDS = {
  key: 'fulfillmentKey',
  status: 'status',
  location: 'fulfillmentLocationId',
  due: 'fulfillmentDueMs',
} as const

export interface LocalFulfillmentQueueQuery {
  where: Array<{ field: string; op: '==' | 'in'; value: string | readonly string[] }>
  orderBy: { field: string; direction: 'asc' }
  limit: number
}

/** The one query a tab runs, as data each platform turns into its own Firestore call. */
export function localFulfillmentQueueQuery(
  key: OrderFulfillmentKey,
  locationId?: string | null,
): LocalFulfillmentQueueQuery {
  return {
    where: [
      ...(locationId ? [{ field: LOCAL_FULFILLMENT_QUEUE_FIELDS.location, op: '==' as const, value: locationId }] : []),
      { field: LOCAL_FULFILLMENT_QUEUE_FIELDS.key, op: '==' as const, value: key },
      { field: LOCAL_FULFILLMENT_QUEUE_FIELDS.status, op: 'in' as const, value: LOCAL_FULFILLMENT_OPEN_STATUSES },
    ],
    orderBy: { field: LOCAL_FULFILLMENT_QUEUE_FIELDS.due, direction: 'asc' },
    limit: LOCAL_FULFILLMENT_QUEUE_LIMIT,
  }
}
