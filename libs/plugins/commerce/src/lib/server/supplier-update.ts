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

import * as Aglyn from '@aglyn/aglyn'
import { firebaseAdmin, notifyHostManagers } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn'

/**
 * Supplier tracking callback (AGL-289): the routed order carried a
 * per-order token; posting (or GET-ing, for email links) tracking with
 * it fulfills the order. Token-gated — suppliers have no Aglyn account.
 */
export const supplierUpdateHandler: PluginApiHandler = async (req, res) => {
  const source = req.method === 'POST' ? { ...req.query, ...(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})) } : req.query
  const hostId = String(source.hostId ?? '')
  const orderId = String(source.orderId ?? '')
  const token = String(source.token ?? '')
  const trackingNumber = String(source.trackingNumber ?? '').slice(0, 60)
  const carrier = String(source.carrier ?? '').slice(0, 40)
  if (!hostId || !orderId || !token) {
    return res.status(400).json({ error: 'Missing hostId, orderId, or token' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const orderRef = firestore
      .collection('hosts')
      .doc(hostId)
      .collection('orders')
      .doc(orderId)
    const orderSnapshot = await orderRef.get()
    if (!orderSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown order' })
    }
    if (orderSnapshot.get('supplierToken') !== token) {
      return res.status(403).json({ error: 'Invalid token' })
    }
    const order = Aglyn.liftLegacyOrder(orderSnapshot.data() as any)
    if (!Aglyn.canTransitionOrder(order.status, 'fulfilled')) {
      return res
        .status(409)
        .json({ error: `Order is already ${order.status}` })
    }
    const fulfillment: Aglyn.OrderFulfillment = {
      id: `supplier-${Date.now().toString(36)}`,
      lineItemIds: (order.lineItems ?? []).map((_line, index) => index),
      ...(carrier ? { carrier } : {}),
      ...(trackingNumber ? { trackingNumber } : {}),
      atMs: Date.now(),
    }
    await orderRef.set(
      {
        status: 'fulfilled',
        fulfillments: [...(order.fulfillments ?? []), fulfillment],
        timeline: Aglyn.appendOrderEvent(
          order,
          'fulfilled',
          `Supplier shipped${trackingNumber ? ` — ${carrier || 'tracking'} ${trackingNumber}` : ''}`,
        ),
      },
      { merge: true },
    )
    void notifyHostManagers(hostId, {
      type: 'content.order',
      title: `Supplier shipped ${Aglyn.formatOrderNumber(order, orderId)}`,
      ...(trackingNumber ? { body: `${carrier} ${trackingNumber}` } : {}),
      link: `/${hostId}/products`,
    })
    // Email links land here as GETs — answer with a human page.
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html')
      return res
        .status(200)
        .send('<h3>Thanks — tracking recorded. You can close this tab.</h3>')
    }
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Update failed' })
  }
}
