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
import { returnRequestHref } from '../constants/return-request'
import {
  RETURNABLE_ORDER_STATUSES,
  readReturnSettings,
  returnableLines,
  returnWindowEndsAtMs,
  type HostReturn,
} from '../model/commerce-returns'
import type { HostOrder } from '../model/commerce-orders'
import type { OrderStatusAction } from '../model/order-status-view'

/** What the order-status page hands each action provider. */
export interface ReturnStatusActionInput {
  hostId: string
  orderId: string
  order: Pick<HostOrder, 'status' | 'lineItems' | 'fulfillments' | 'refundedLineItemIds' | 'createdAtMs'>
  /** The order's signed status token, which the return page needs as well. */
  token: string
}

/**
 * The order-status page's "Request a return" button (AGL-3611): offered only
 * on an order a return can be opened against, in a store that takes return
 * requests online, while the window is open and at least one unit can still
 * come back. The per-line rules are the return page's to explain; this only
 * decides whether the door is worth showing.
 *
 * A read that fails hides the button rather than failing the page.
 */
export async function returnRequestStatusAction(input: ReturnStatusActionInput): Promise<OrderStatusAction[]> {
  const { hostId, orderId, order, token } = input
  if (!RETURNABLE_ORDER_STATUSES.includes(String(order?.status ?? ''))) return []
  try {
    const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
    const [store, existing] = await Promise.all([
      hostRef.collection('settings').doc('store').get(),
      hostRef.collection('returns').where('orderId', '==', orderId).get(),
    ])
    const settings = readReturnSettings(store.get('returns'))
    if (!settings.enabled) return []
    const endsAt = returnWindowEndsAtMs(order, settings)
    if (endsAt !== null && Date.now() > endsAt) return []
    const returns = existing.docs.map((entry) => entry.data() as HostReturn)
    if (!returnableLines(order, returns, settings).some((line) => line.returnable > 0)) return []
  } catch (error) {
    console.error('return status action: returns read failed', error)
    return []
  }
  return [{ id: 'request-return', label: 'Request a return', url: returnRequestHref(orderId, token) }]
}

export default returnRequestStatusAction
