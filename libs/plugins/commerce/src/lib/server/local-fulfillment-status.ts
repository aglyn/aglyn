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

import { pluginShippingRateQuoter } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { createResourceUid, type PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import * as CommerceModel from '../model'
import { ORDER_DELIVERED_EVENT, ORDER_FULFILLED_EVENT } from '../model/order-events'
import { notifyOrderBuyer, type OrderBuyerEvent } from './order-notifications'
import { fulfillmentEventView, stageOrderEvent } from './order-events'
import { placeDeliveryAddress } from './local-fulfillment'

/**
 * `commerce/local-fulfillment` (AGL-3624): the store moving a pickup or a
 * local delivery along — from the console's queue, the order dialog, or the
 * native Aglyn app, which posts the same body with the member's ID token.
 *
 *   POST { hostId, orderId, action }
 *     pickup:   `ready` · `preparing` (undo a ready) · `picked_up`
 *     delivery: `out_for_delivery` · `delivered` · `delivery_failed`
 *   POST { hostId, action: 'locate' }   places the store on the map for
 *     distance zones, through the shipping plugin's address check
 *   GET  ?hostId                        whether distance zones can work here
 *
 * Every status write is ONE transaction that re-reads the order and re-asks
 * the transition, so a stale queue row or a second device cannot skip a
 * step or hand the same order over twice: a repeat of the move the order
 * already made answers `already` and writes nothing.
 *
 * HANDING OVER IS FULFILLING. `picked_up` and `delivered` record a
 * fulfillment covering every unit still open (marked `handover`, so no
 * "shipped" message and no carrier), move the order to `fulfilled` and on to
 * `delivered`, and raise `order.fulfilled` and `order.delivered` exactly as a
 * shipment does — accounting, outbound webhooks and workflows hear the same
 * events whichever way the goods left. No stock moves: it came off the
 * location's shelf when the money landed.
 *
 * The buyer hears about each step through the AGL-3610 notifier, once per
 * step, and only after the write lands.
 *
 * Role gate: `admin` and `editor`, as `fulfill-order.ts`.
 */

type PickupAction = 'ready' | 'preparing' | 'picked_up'
type DeliveryAction = 'out_for_delivery' | 'delivered' | 'delivery_failed'
export type LocalFulfillmentAction = PickupAction | DeliveryAction

const PICKUP_ACTIONS: readonly string[] = ['ready', 'preparing', 'picked_up']
const DELIVERY_ACTIONS: readonly string[] = ['out_for_delivery', 'delivered', 'delivery_failed']

export type LocalFulfillmentOutcome =
  | { outcome: 'updated'; status: CommerceModel.OrderStatus; notify: OrderBuyerEvent | null }
  | { outcome: 'already' }
  | { outcome: 'no_such_order' }
  /** The order is not a pickup (or not a local delivery) order. */
  | { outcome: 'wrong_method' }
  /** The step is not allowed from where the order is; `from` names it. */
  | { outcome: 'blocked'; from: string }

const NOTE_MAX = 200

/**
 * Moves one order a step. The transaction, with NO authorization — the
 * caller has already proven the member may.
 */
export async function moveLocalFulfillment(request: {
  hostId: string
  orderId: string
  action: LocalFulfillmentAction
  /** `picked_up`: who collected it, when the counter noted a name. */
  pickedUpBy?: string
  /** `delivery_failed`: why. */
  reason?: string
  nowMs?: number
}): Promise<LocalFulfillmentOutcome> {
  const { hostId, orderId, action } = request
  const firestore = firebaseAdmin.app().firestore()
  const orderRef = firestore.collection('hosts').doc(hostId).collection('orders').doc(orderId)
  return firestore.runTransaction(async (transaction): Promise<LocalFulfillmentOutcome> => {
    const snapshot = await transaction.get(orderRef)
    if (!snapshot.exists) return { outcome: 'no_such_order' }
    const raw = (snapshot.data() ?? {}) as Record<string, unknown>
    const order = CommerceModel.liftLegacyOrder(raw as never)
    const atMs = request.nowMs ?? Date.now()
    const isPickup = PICKUP_ACTIONS.includes(action)
    if (isPickup ? order.fulfillmentMethod !== 'pickup' || !order.pickup : order.fulfillmentMethod !== 'local_delivery' || !order.localDelivery) {
      return { outcome: 'wrong_method' }
    }
    // Nothing to hand over on an order that was cancelled or refunded.
    if (order.status === 'cancelled' || order.status === 'refunded' || order.status === 'pending') {
      return { outcome: 'blocked', from: order.status }
    }

    const handover = action === 'picked_up' || action === 'delivered'
    let next: Record<string, unknown>
    let detail: string
    let event: string
    let notify: OrderBuyerEvent | null
    let status: CommerceModel.OrderStatus = order.status

    if (isPickup) {
      const pickup = order.pickup as CommerceModel.OrderPickup
      const from = CommerceModel.orderPickupStatus(pickup.status)
      const to: CommerceModel.OrderPickupStatus = action as PickupAction
      if (from === to) return { outcome: 'already' }
      if (!CommerceModel.canTransitionPickup(from, to)) return { outcome: 'blocked', from: CommerceModel.ORDER_PICKUP_STATUS_LABELS[from] }
      const pickedUpBy = String(request.pickedUpBy ?? '').trim().slice(0, NOTE_MAX)
      const updated: CommerceModel.OrderPickup = {
        ...pickup,
        status: to,
        updatedAtMs: atMs,
        ...(to === 'ready' ? { readyAtMs: atMs } : {}),
        ...(to === 'picked_up' ? { pickedUpAtMs: atMs, ...(pickedUpBy ? { pickedUpBy } : {}) } : {}),
      }
      if (to === 'preparing') delete updated.readyAtMs
      next = { pickup: updated }
      event = to === 'ready' ? 'ready-for-pickup' : to === 'picked_up' ? 'picked-up' : 'pickup-preparing'
      detail =
        to === 'ready'
          ? `Ready for pickup at ${pickup.locationName}`
          : to === 'picked_up'
            ? `Picked up at ${pickup.locationName}${pickedUpBy ? ` by ${pickedUpBy}` : ''}`
            : 'Back to preparing'
      notify = to === 'ready' ? 'ready_for_pickup' : to === 'picked_up' ? 'picked_up' : null
    } else {
      const delivery = order.localDelivery as CommerceModel.OrderLocalDelivery
      const from = CommerceModel.orderLocalDeliveryStatus(delivery.status)
      const to: CommerceModel.OrderLocalDeliveryStatus =
        action === 'delivery_failed' ? 'failed' : (action as 'out_for_delivery' | 'delivered')
      if (from === to) return { outcome: 'already' }
      if (!CommerceModel.canTransitionLocalDelivery(from, to)) {
        return { outcome: 'blocked', from: CommerceModel.ORDER_LOCAL_DELIVERY_STATUS_LABELS[from] }
      }
      const reason = String(request.reason ?? '').trim().slice(0, NOTE_MAX)
      const updated: CommerceModel.OrderLocalDelivery = {
        ...delivery,
        status: to,
        updatedAtMs: atMs,
        ...(to === 'out_for_delivery' ? { outForDeliveryAtMs: atMs } : {}),
        ...(to === 'delivered' ? { deliveredAtMs: atMs } : {}),
        ...(to === 'failed' ? { failedAtMs: atMs, ...(reason ? { failedReason: reason } : {}) } : {}),
      }
      next = { localDelivery: updated }
      event = to === 'out_for_delivery' ? 'out-for-delivery' : to === 'delivered' ? 'delivered-locally' : 'delivery-failed'
      detail =
        to === 'out_for_delivery'
          ? 'Out for delivery'
          : to === 'delivered'
            ? 'Delivered by the store'
            : `Delivery failed${reason ? `: ${reason}` : ''}`
      notify = to === 'out_for_delivery' ? 'out_for_delivery' : to === 'delivered' ? 'delivered' : null
    }

    let timeline = CommerceModel.appendOrderEvent(order, event, detail, atMs)
    let fulfillment: CommerceModel.OrderFulfillment | null = null
    if (handover) {
      // Every unit still open, whatever it is: the buyer has the whole order.
      const lines = CommerceModel.orderLineFulfillmentStates(order)
        .filter((state) => state.remainingQuantity > 0)
        .map((state) => ({ lineItemId: state.lineItemId, quantity: state.remainingQuantity }))
      if (lines.length) {
        fulfillment = {
          id: createResourceUid(),
          lineItemIds: lines.map((entry) => entry.lineItemId),
          lines,
          status: 'active',
          handover: isPickup ? 'pickup' : 'local_delivery',
          // The buyer is told by this route's own message, never "shipped".
          notify: false,
          atMs,
        }
      }
      const fulfillments = [...(order.fulfillments ?? []), ...(fulfillment ? [fulfillment] : [])]
      const fulfilled = CommerceModel.statusFromFulfillments({ lineItems: order.lineItems, fulfillments })
      const through = fulfilled === 'paid' ? 'fulfilled' : fulfilled
      if (order.status === 'delivered') {
        // Marked delivered by hand already: the handover only records itself.
        status = 'delivered'
      } else {
        if (through !== order.status && !CommerceModel.canTransitionOrder(order.status, through)) {
          return { outcome: 'blocked', from: order.status }
        }
        status = CommerceModel.canTransitionOrder(through, 'delivered') ? 'delivered' : through
      }
      if (fulfillment) {
        timeline = [...timeline, { atMs, event: 'fulfilled', detail: isPickup ? 'Handed over at pickup' : 'Handed over on delivery' }]
      }
      if (status === 'delivered') timeline = [...timeline, { atMs, event: 'delivered' }]
      next = { ...next, fulfillments }
    }
    const written = {
      ...next,
      status,
      updatedAtMs: atMs,
      timeline,
    }
    const listFields = CommerceModel.orderLocalFulfillmentListFields({
      ...order,
      ...(written as Partial<CommerceModel.HostOrder>),
    })
    transaction.update(orderRef, { ...written, ...(listFields ?? {}) })
    const after = { ...raw, ...written }
    if (fulfillment) {
      stageOrderEvent(transaction, ORDER_FULFILLED_EVENT, {
        hostId,
        orderId,
        key: fulfillment.id,
        order: after,
        extra: { fulfillment: fulfillmentEventView(order, fulfillment) },
      })
    }
    if (status === 'delivered' && order.status !== 'delivered') {
      stageOrderEvent(transaction, ORDER_DELIVERED_EVENT, { hostId, orderId, key: 'delivered', order: after })
    }
    return { outcome: 'updated', status, notify }
  })
}

function readBody(req: Parameters<PluginApiHandler>[0]): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body || '{}')
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
}

const badId = (value: string) => !value || value.includes('/') || /^__.*__$/.test(value)

export const localFulfillmentHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers.authorization ?? '')
  if (!authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthenticated' })
  const body = req.method === 'POST' ? readBody(req) : ((req.query ?? {}) as Record<string, unknown>)
  const hostId = String(body['hostId'] ?? '')
  if (badId(hostId)) return res.status(400).json({ error: 'Missing hostId' })
  const action = String(body['action'] ?? '')
  const orderId = String(body['orderId'] ?? '')
  if (req.method === 'POST' && action !== 'locate') {
    if (!PICKUP_ACTIONS.includes(action) && !DELIVERY_ACTIONS.includes(action)) {
      return res.status(400).json({ error: 'Unknown action' })
    }
    if (badId(orderId)) return res.status(400).json({ error: 'Missing orderId' })
  }

  let uid: string
  try {
    uid = (await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))).uid
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  try {
    const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
    const host = await hostRef.get()
    if (!host.exists) return res.status(404).json({ error: 'Unknown site' })
    const role = (host.get('memberRoles') ?? {})[uid]
    if (role !== 'admin' && role !== 'editor') return res.status(403).json({ error: 'Not permitted' })

    if (req.method === 'GET') {
      // Distance zones need the store and the buyer placed on a map, which
      // only the shipping plugin's address check can do here.
      const quoter = pluginShippingRateQuoter()
      const radius = Boolean(
        quoter?.validateAddress && (await quoter.available(hostId).catch(() => false)),
      )
      return res.status(200).json({ radius })
    }

    const ownerOrg = await getOrgForHost(hostId).catch(() => null)
    if (!Aglyn.checkEntitlement(ownerOrg?.org as any, 'commerce')) {
      return res.status(403).json({ error: 'Selling is not enabled on this plan' })
    }

    if (action === 'locate') {
      const locationId = String(body['locationId'] ?? '')
      if (badId(locationId)) return res.status(400).json({ error: 'Choose the location deliveries leave from' })
      const location = await hostRef.collection('locations').doc(locationId).get()
      const address = CommerceModel.normalizePostalAddress(location.get('postalAddress'))
      if (!location.exists || !address?.line1 || !address.postalCode || !address.country) {
        return res.status(409).json({ error: 'Add a full street address to that location first.' })
      }
      const coordinates = await placeDeliveryAddress(hostId, { ...address, country: address.country })
      if (!coordinates) {
        return res.status(409).json({
          error: 'Your address check could not place this address on a map. Use postal-code zones instead.',
        })
      }
      return res.status(200).json({ ok: true, origin: coordinates })
    }

    const outcome = await moveLocalFulfillment({
      hostId,
      orderId,
      action: action as LocalFulfillmentAction,
      pickedUpBy: typeof body['pickedUpBy'] === 'string' ? body['pickedUpBy'] : undefined,
      reason: typeof body['reason'] === 'string' ? body['reason'] : undefined,
    })
    if (outcome.outcome === 'no_such_order') return res.status(404).json({ error: 'Unknown order' })
    if (outcome.outcome === 'wrong_method') {
      return res.status(409).json({
        error: PICKUP_ACTIONS.includes(action)
          ? 'This order is not a pickup order'
          : 'This order is not a local delivery order',
      })
    }
    if (outcome.outcome === 'blocked') {
      return res.status(409).json({ error: `This order can’t move on from "${outcome.from}"` })
    }
    if (outcome.outcome === 'already') return res.status(200).json({ ok: true, already: true })
    // After the write, never inside it, and never failing it (AGL-3610).
    if (outcome.notify) await notifyOrderBuyer({ hostId, orderId }, outcome.notify)
    return res.status(200).json({ ok: true, status: outcome.status })
  } catch (error) {
    // The transaction is all-or-nothing: nothing landed, a retry is safe.
    console.error('[local-fulfillment] move failed', hostId, orderId, action, error)
    return res.status(500).json({ error: 'The order could not be updated' })
  }
}
