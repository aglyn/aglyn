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
  ClosureNotice,
  ClosureNoticeSource,
  ClosureSubject,
} from '@aglyn/aglyn/plugin-manager/plugin-closure-notices'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  formatPosHardwareCents,
  POS_HARDWARE_ORDERS_COLLECTION,
  posHardwareRefundable,
  type PosHardwareOrder,
} from '../model/pos-hardware'

/*==========================================
 * BEFORE A CLOSURE: WHICH HARDWARE ORDERS IT WILL CANCEL AND REFUND (AGL-4038).
 *
 * Deleting a workspace, or closing the account that placed an order, cancels
 * every card reader order that has not shipped — paid, or already placed
 * with Stripe — and refunds it in full (`pos-hardware-closure.ts`). The
 * delete-workspace and close-account screens ask core's closure notices
 * before the confirm, and this answers for the hardware shop: one warning
 * listing each such order, its number, its items and what is refunded.
 *
 * The same orders the closure reads: a workspace's own (`paid` or `ordered`),
 * or every one the person placed in any workspace (by `createdBy`, the
 * collection-group override the account eraser uses). Nothing is held back:
 * the closure goes ahead, and this only says what it will do.
 *=========================================*/

/** The notice's id. */
export const POS_HARDWARE_CLOSURE_NOTICE_ID = 'pos-hardware-unshipped-orders'

/** The number a person reads: `HW-` and six characters of the id. */
function orderNumber(orderId: string): string {
  return `HW-${orderId.replace(/^hw_/, '').slice(0, 6).toUpperCase()}`
}

/** The warning for these unshipped orders, or none when there are none. Pure. */
export function posHardwareClosureNotice(
  subject: ClosureSubject['kind'],
  orders: ReadonlyArray<{ orderId: string; order: Pick<PosHardwareOrder, 'status' | 'lines' | 'totalCents'> }>,
): ClosureNotice[] {
  const unshipped = orders.filter(({ order }) => posHardwareRefundable(order?.status))
  if (!unshipped.length) return []
  const count = unshipped.length
  const one = count === 1
  return [
    {
      id: POS_HARDWARE_CLOSURE_NOTICE_ID,
      severity: 'warning',
      title: one
        ? 'A card reader order will be canceled and refunded'
        : `${count} card reader orders will be canceled and refunded`,
      body:
        subject === 'workspace'
          ? `${one ? 'This order has' : 'These orders have'} not shipped yet. When the workspace is deleted, ` +
            `${one ? 'it is' : 'each is'} canceled and refunded in full, shipping and tax included, to the card ` +
            `it was paid with, and the person who placed ${one ? 'it gets an email' : 'each gets an email'}. ` +
            `Nothing will ship. Keep the workspace if you still want ${one ? 'it' : 'them'}.`
          : `${one ? 'This order you placed has' : 'These orders you placed have'} not shipped yet. When your ` +
            `account is closed, ${one ? 'it is' : 'each is'} canceled and refunded in full, shipping and tax ` +
            `included, to the card it was paid with, and you get an email about ${one ? 'it' : 'each'}. Nothing ` +
            `will ship. Keep your account if you still want ${one ? 'it' : 'them'}.`,
      items: unshipped.map(({ orderId, order }) => ({
        id: orderId,
        primary: `Order ${orderNumber(orderId)}`,
        secondary: (order.lines ?? []).map((line) => `${line.name} × ${line.quantity}`).join(', ') || undefined,
        amount: formatPosHardwareCents(Number(order.totalCents ?? 0)),
      })),
    },
  ]
}

/** Reads the unshipped orders a closure of `subject` would cancel. */
async function unshippedOrders(
  subject: ClosureSubject,
): Promise<Array<{ orderId: string; order: PosHardwareOrder }>> {
  const firestore = firebaseAdmin.app().firestore()
  if (subject.kind === 'workspace') {
    const orders = firestore.collection('orgs').doc(subject.orgId).collection(POS_HARDWARE_ORDERS_COLLECTION)
    // One equality query per status, as the closure reads them.
    const found = await Promise.all(['paid', 'ordered'].map((status) => orders.where('status', '==', status).get()))
    return found.flatMap((snapshot) =>
      snapshot.docs.map((doc: { id: string; data: () => unknown }) => ({ orderId: doc.id, order: doc.data() as PosHardwareOrder })),
    )
  }
  const placed = await firestore.collectionGroup(POS_HARDWARE_ORDERS_COLLECTION).where('createdBy', '==', subject.uid).get()
  return placed.docs.map((doc: { id: string; data: () => unknown }) => ({ orderId: doc.id, order: doc.data() as PosHardwareOrder }))
}

/** The hardware shop's closure notices, as the declarations register them. */
export const posHardwareClosureNoticeSource: ClosureNoticeSource = {
  async notices(subject) {
    return posHardwareClosureNotice(subject.kind, await unshippedOrders(subject))
  },
}
