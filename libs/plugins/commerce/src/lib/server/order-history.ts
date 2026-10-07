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

/**
 * The order history another plugin reads (AGL-3614): a page of a site's
 * orders by when they were created, in the public API's shape. See
 * `model/order-history.ts` for the contract.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { OrderHistoryEntry, OrderHistoryPageRequest } from '../model/order-history'
import type { OrderStatus } from '../model/commerce-orders'
import type { OrderEventOrder } from '../model/order-events'
import { orderViewFromData } from './api-v1/order-view'

/** The statuses of an order that was paid. */
const PAID_STATUSES: ReadonlySet<string> = new Set<OrderStatus>(['paid', 'partially_fulfilled', 'fulfilled', 'delivered', 'refunded'])

/** The most one page hands out. */
export const ORDER_HISTORY_MAX_PAGE = 200

const finiteMs = (value: unknown): number | null => {
  const ms = Number(value)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

/** One stored order → its history entry. */
export function orderHistoryEntry(id: string, data: Record<string, unknown>): OrderHistoryEntry {
  const timeline = Array.isArray(data['timeline']) ? (data['timeline'] as Array<Record<string, unknown>>) : []
  const refunds = timeline
    .filter((event) => /refund/i.test(String(event['event'] ?? '')))
    .map((event) => finiteMs(event['atMs']))
    .filter((at): at is number => at !== null)
  const createdAtMs = finiteMs(data['createdAtMs']) ?? 0
  const status = String(data['status'] ?? '')
  // An order is paid as it is created; a cancelled one was paid only if
  // money came back from it.
  const paid = PAID_STATUSES.has(status) || (status === 'cancelled' && Number(data['refundedCents'] ?? 0) > 0)
  return {
    id,
    createdAtMs,
    paidAtMs: paid ? (finiteMs(data['paidAtMs']) ?? createdAtMs) : null,
    lastRefundAtMs: refunds.length ? Math.max(...refunds) : null,
    taxInclusive: data['taxInclusive'] === true,
    taxRateId: typeof data['taxRateId'] === 'string' && data['taxRateId'] ? data['taxRateId'] : null,
    order: orderViewFromData(id, data) as unknown as OrderEventOrder,
  }
}

/** A page of a site's orders created in [fromMs, untilMs), oldest first. */
export async function listOrderHistory(
  request: OrderHistoryPageRequest,
  firestore: FirebaseFirestore.Firestore = firebaseAdmin.app().firestore(),
): Promise<OrderHistoryEntry[]> {
  const hostId = String(request.hostId ?? '').trim()
  if (!hostId || !(request.untilMs > request.fromMs)) return []
  const limit = Math.max(1, Math.min(ORDER_HISTORY_MAX_PAGE, Math.floor(request.limit) || 1))
  const page = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('orders')
    .where('createdAtMs', '>=', request.fromMs)
    .where('createdAtMs', '<', request.untilMs)
    .orderBy('createdAtMs', 'asc')
    .limit(limit)
    .get()
  return page.docs.map((doc) => orderHistoryEntry(doc.id, doc.data()))
}
