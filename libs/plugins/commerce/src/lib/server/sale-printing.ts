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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { HostOrder } from '../model/commerce-orders'
import { orderReceipt, queueRegisterPrint } from './printers'
import type { PosSaleCompletedEvent } from './pos-sale'

/**
 * What a completed register sale prints (AGL-3619): the customer receipt on
 * the register's auto-print printers (or none, when the customer chose an
 * emailed or texted receipt, or no receipt), a kitchen ticket on the printers
 * set to print them, and a cash drawer kick when any part of the sale was
 * paid in cash.
 *
 * The order is READ BACK rather than taken from the event: the single-tender
 * cash path announces a partial order (no number, no payments), and the
 * receipt must print what was stored. Every job is keyed by the order id, so
 * a sale announced twice (a retried request, a replayed webhook) prints once.
 */

/** True when any settled tender on the order took cash. */
export function saleTookCash(order: HostOrder & Record<string, any>): boolean {
  const payments: any[] = Array.isArray(order['payments']) ? order['payments'] : []
  return payments.some((payment) => payment?.method === 'cash' && payment?.status === 'succeeded')
}

/** The customer's receipt choice, as the printers read it. */
export function receiptChoiceForPrinting(
  order: HostOrder & Record<string, any>,
): 'print' | 'none' | undefined {
  const channel = order['receiptRequest']?.channel
  if (channel === 'print') return 'print'
  // A receipt sent by email or text is the receipt; a printed copy as well
  // is paper the customer said they did not want.
  if (channel === 'none' || channel === 'email' || channel === 'sms') return 'none'
  return undefined
}

export async function printCompletedSale(
  event: PosSaleCompletedEvent,
  firestore: any = firebaseAdmin.app().firestore(),
): Promise<{ jobIds: string[] }> {
  const snapshot = await firestore
    .collection('hosts')
    .doc(event.hostId)
    .collection('orders')
    .doc(event.orderId)
    .get()
  if (!snapshot.exists) return { jobIds: [] }
  const order = snapshot.data() as HostOrder & Record<string, any>
  const registerId = String(order['registerId'] ?? event.order?.registerId ?? '')
  if (!registerId || order.channel !== 'pos' || order.status !== 'paid') return { jobIds: [] }
  const receipt = await orderReceipt(event.hostId, event.orderId, order, { firestore })
  const receiptChoice = receiptChoiceForPrinting(order)
  return queueRegisterPrint({
    hostId: event.hostId,
    registerId,
    receipt,
    kitchenTicket: receipt,
    ...(receiptChoice ? { receiptChoice } : {}),
    openDrawer: saleTookCash(order),
    orderId: event.orderId,
    reason: 'sale',
    idempotencyKey: event.orderId,
    ...(order['cashierId'] ? { createdBy: String(order['cashierId']) } : {}),
    firestore,
  })
}
