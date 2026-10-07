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

import * as CommerceModel from '../model'
import { announcePluginShipment } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { createResourceUid, type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { notifyOrderBuyer } from './order-notifications'
import { ORDER_DELIVERED_EVENT, ORDER_FULFILLED_EVENT } from '../model/order-events'
import { fulfillmentEventView, stageOrderEvent } from './order-events'
import { createHash } from 'crypto'

/**
 * The two fulfilment-side transitions, and ONLY those.
 *
 * `cancelled` releases stock under its own transaction and `refunded` moves
 * money under another, so neither belongs to a write whose contract is "a
 * forward status flip plus a timeline entry, no stock moved, no money moved".
 * Widening this union is how a caller gets a door around the specifics those
 * routes exist to enforce — the type is the door being shut.
 */
export type OrderFulfilmentTarget = 'fulfilled' | 'delivered'

/** How long a carrier name and a tracking number may be, on every door. */
export const CARRIER_MAX = 40
export const TRACKING_NUMBER_MAX = 60
const URL_MAX = 2048

export interface RecordShipmentRequest {
  /** Site that owns the order. The CALLER has already proven ownership. */
  hostId: string
  orderId: string
  to: OrderFulfilmentTarget
  /** Free text, e.g. `'UPS'`. Bounded by the caller. */
  carrier?: string
  trackingNumber?: string
  /**
   * Which units this shipment covers (AGL-3611). Absent means everything
   * still to ship, which is what a fulfil meant before quantities existed.
   * Ignored for `delivered`.
   */
  lineItems?: ReadonlyArray<{ lineItemId: number; quantity: number }>
  /** An explicit tracking link; without one it is derived from the carrier. */
  trackingUrl?: string
  /** A label a shipping plugin bought for this parcel. */
  labelUrl?: string
  /** That plugin's id for the label (AGL-3612), kept on the fulfillment. */
  labelRef?: string
  /** Whether the buyer is to be told; recorded on the fulfillment. Default on. */
  notify?: boolean
  /**
   * One shipment attempt. A retry carrying the same key finds the fulfillment
   * it already wrote and answers `already`, so a partial shipment, which
   * leaves the order open to more, still cannot be recorded twice.
   */
  idempotencyKey?: string
  /**
   * A shipment whose tracking number an active fulfillment of this order
   * already carries is the same parcel, answered `already` (AGL-3613). For
   * the doors a shipping tool posts to — ShipStation's ShipNotice, a tracking
   * file — where the number is the parcel's identity and the same parcel may
   * have been recorded by hand first.
   */
  onceByTracking?: boolean
}

/**
 * What happened, as a domain fact rather than an HTTP status — each caller
 * maps it into its own error vocabulary (the console route into its JSON
 * shape, `/v1` into the published error envelope), because those two
 * vocabularies are contracts with different audiences and neither may leak
 * into the other.
 *
 * `already` is a SUCCESS and is distinct from `recorded` on purpose: a retried
 * request finds the order in the target status (or its keyed fulfillment
 * already written) and returns without writing, so a lost response can never
 * append a second copy of the same shipment.
 *
 * `recorded` carries the fulfillment it wrote (absent for `delivered`) and the
 * status the order is now in, so a caller can tell the buyer what shipped.
 */
export type RecordShipmentOutcome =
  | {
      outcome: 'recorded'
      status: CommerceModel.OrderStatus
      fulfillment?: CommerceModel.OrderFulfillment
    }
  | { outcome: 'already'; fulfillment?: CommerceModel.OrderFulfillment }
  | { outcome: 'no_such_order' }
  /** The transition rule refused. `from` is the status that refused it. */
  | { outcome: 'blocked'; from: string }
  /** The requested lines or quantities were refused; nothing was written. */
  | { outcome: 'invalid_lines'; problem: CommerceModel.FulfillmentLinesProblem; message: string }

/** Trims a carrier and a tracking number to what every door stores. */
export function boundTracking(input: { carrier?: unknown; trackingNumber?: unknown }): {
  carrier: string
  trackingNumber: string
} {
  return {
    carrier: String(input.carrier ?? '').trim().slice(0, CARRIER_MAX),
    trackingNumber: String(input.trackingNumber ?? '').trim().slice(0, TRACKING_NUMBER_MAX),
  }
}

/** An https link or nothing: a stored link is rendered to buyers as an anchor. */
export function safeHttpsUrl(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  if (!text || text.length > URL_MAX) return undefined
  try {
    const url = new URL(text)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** The fulfillment id a keyed attempt writes, so a retry finds it. */
export function fulfillmentIdForKey(orderId: string, key: string): string {
  return `f-${createHash('sha256').update(`${orderId}:${key}`).digest('hex').slice(0, 20)}`
}

/** The tracking keys a fulfillment stores: the number, the carrier and the link. */
function trackingFields(
  carrier: string,
  trackingNumber: string,
  explicitUrl: string | undefined,
): Pick<CommerceModel.OrderFulfillment, 'carrier' | 'trackingNumber' | 'trackingUrl'> {
  const trackingUrl =
    explicitUrl ?? (trackingNumber ? CommerceModel.trackingUrlFor(carrier, trackingNumber) ?? undefined : undefined)
  return {
    ...(carrier ? { carrier } : {}),
    ...(trackingNumber ? { trackingNumber } : {}),
    ...(trackingUrl ? { trackingUrl } : {}),
  }
}

/** The timeline's words for a shipment. */
function shipmentDetail(
  order: CommerceModel.HostOrder,
  lines: readonly CommerceModel.OrderFulfillmentLine[],
  partial: boolean,
  carrier: string,
  trackingNumber: string,
): string {
  const tracking = trackingNumber ? `${carrier || 'Shipped'} ${trackingNumber}` : ''
  if (!partial) return tracking || 'Fulfilled'
  const what = CommerceModel.describeFulfillmentLines(order, lines)
  return tracking ? `${what} — ${tracking}` : `${what} shipped`
}

function orderRefFor(hostId: string, orderId: string) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('orders')
    .doc(orderId)
}

/**
 * Record a shipment — the transaction, with NO authorization of any kind
 * (AGL-2461).
 *
 * This is the whole of what `fulfillOrderHandler` used to do below its auth
 * preamble, lifted out unchanged so a SECOND caller can have it: the customer
 * REST API's `PATCH /v1/sites/{id}/orders/{id}`
 * (`api-v1/orders-and-products.ts`), which authenticates an org API key and
 * so shares not one line of this function's former preamble.
 *
 * Lifted rather than copied, and that is the entire point: a second
 * `ORDER_TRANSITIONS` inside `/v1` would be two tables that drift into the
 * API writing a status the console forbids.
 *
 * **The caller authorizes.** Everything this function knows is the transition
 * rule. It does not know who is asking, and it will happily move any order on
 * any host — `hostId` is taken on trust because its two callers establish
 * trust in ways that have nothing in common (a Firebase uid in `memberRoles`
 * for the console; an org credential that owns the host for `/v1`).
 *
 * QUANTITIES (AGL-3611). A shipment names units, not just lines, and the
 * remaining count is computed from the transaction's own read, so two admins
 * shipping the last 3 mugs at once cannot ship 6: the second meets
 * `invalid_lines` with `over_fulfilled`. The resulting status is computed
 * from the fulfillments (`statusFromFulfillments`) — `partially_fulfilled`
 * until every shippable unit is covered — and the transition rule is re-asked
 * only when the status actually moves, since a second partial shipment on a
 * `partially_fulfilled` order changes nothing the table speaks to.
 *
 * Every guarantee AGL-1819 built is inside the transaction and therefore
 * inherited by both callers: `canTransitionOrder` is re-asked under the write
 * so a stale caller cannot skip a state, the already-in-target case returns
 * without writing so a retry cannot append a duplicate shipment, and the
 * lines and the timeline are computed from the transaction's OWN read so a
 * note landed from another tab survives.
 */
export async function recordOrderShipment(
  request: RecordShipmentRequest,
): Promise<RecordShipmentOutcome> {
  const { hostId, orderId, to } = request
  const { carrier, trackingNumber } = boundTracking(request)
  const explicitUrl = safeHttpsUrl(request.trackingUrl)
  const labelUrl = safeHttpsUrl(request.labelUrl)
  const firestore = firebaseAdmin.app().firestore()
  const orderRef = orderRefFor(hostId, orderId)
  const keyedId = request.idempotencyKey
    ? fulfillmentIdForKey(orderId, String(request.idempotencyKey).slice(0, 200))
    : null

  const result = await firestore.runTransaction(
    async (transaction): Promise<RecordShipmentOutcome> => {
      const snapshot = await transaction.get(orderRef)
      if (!snapshot.exists) return { outcome: 'no_such_order' }
      const order = CommerceModel.liftLegacyOrder(
        (snapshot.data() ?? {}) as never,
      )
      const atMs = Date.now()

      if (to === 'delivered') {
        if (order.status === 'delivered') return { outcome: 'already' }
        if (!CommerceModel.canTransitionOrder(order.status, 'delivered')) {
          return { outcome: 'blocked', from: order.status }
        }
        const delivered = {
          status: 'delivered',
          updatedAtMs: atMs,
          timeline: CommerceModel.appendOrderEvent(order, 'delivered', undefined, atMs),
        }
        transaction.update(orderRef, delivered)
        stageOrderEvent(transaction, ORDER_DELIVERED_EVENT, { hostId, orderId, key: 'delivered', order: { ...snapshot.data(), ...delivered } })
        return { outcome: 'recorded', status: 'delivered' }
      }

      // A redelivered keyed attempt: the fulfillment it wrote is there.
      if (keyedId) {
        const existing = (order.fulfillments ?? []).find((entry) => entry.id === keyedId)
        if (existing) return { outcome: 'already', fulfillment: existing }
      }
      if (request.onceByTracking && trackingNumber) {
        const same = CommerceModel.fulfillmentWithTracking(order, trackingNumber)
        if (same) return { outcome: 'already', fulfillment: same }
      }
      const named = (request.lineItems ?? []).length > 0
      // A redelivered click, or the second of two admins, on a "fulfil
      // everything". Success because it IS the state the caller asked for —
      // but nothing is written, so a retry cannot append a second copy.
      if (!named && order.status === 'fulfilled') return { outcome: 'already' }
      if (
        order.status !== 'partially_fulfilled' &&
        order.status !== 'fulfilled' &&
        !CommerceModel.canTransitionOrder(order.status, 'partially_fulfilled') &&
        !CommerceModel.canTransitionOrder(order.status, 'fulfilled')
      ) {
        return { outcome: 'blocked', from: order.status }
      }

      let lines: CommerceModel.OrderFulfillmentLine[]
      if (named) {
        const resolved = CommerceModel.resolveFulfillmentLines(order, request.lineItems ?? [])
        if (!('lines' in resolved)) {
          return {
            outcome: 'invalid_lines',
            problem: resolved,
            message: CommerceModel.describeFulfillmentLinesProblem(resolved),
          }
        }
        lines = resolved.lines
      } else {
        lines = CommerceModel.remainingFulfillmentLines(order)
        // Nothing physical left: a fulfil closes the digital and service
        // lines instead, which is what it did before quantities existed.
        if (lines.length === 0) {
          lines = CommerceModel.orderLineFulfillmentStates(order)
            .filter((state) => state.remainingQuantity > 0)
            .map((state) => ({ lineItemId: state.lineItemId, quantity: state.remainingQuantity }))
        }
      }

      const fulfillment: CommerceModel.OrderFulfillment = {
        id: keyedId ?? createResourceUid(),
        lineItemIds: lines.map((entry) => entry.lineItemId),
        lines,
        ...trackingFields(carrier, trackingNumber, explicitUrl),
        ...(labelUrl ? { labelUrl } : {}),
        ...(request.labelRef ? { labelRef: String(request.labelRef).slice(0, 80) } : {}),
        status: 'active',
        notify: request.notify !== false,
        atMs,
      }
      const fulfillments = [...(order.fulfillments ?? []), fulfillment]
      let status: CommerceModel.OrderStatus = CommerceModel.statusFromFulfillments({
        lineItems: order.lineItems,
        fulfillments,
      })
      // A fulfil with nothing left to cover still closes the order.
      if (status === 'paid') status = 'fulfilled'
      if (status !== order.status && !CommerceModel.canTransitionOrder(order.status, status)) {
        return { outcome: 'blocked', from: order.status }
      }
      const shipped = {
        status,
        fulfillments,
        // What a shipping tool's feed asks (AGL-3613): which orders changed.
        updatedAtMs: atMs,
        timeline: CommerceModel.appendOrderEvent(
          order,
          status,
          shipmentDetail(order, lines, status === 'partially_fulfilled', carrier, trackingNumber),
          atMs,
        ),
      }
      transaction.update(orderRef, shipped)
      // Once per shipment (AGL-3611), in the same write, so the event exists
      // exactly when the shipment does.
      stageOrderEvent(transaction, ORDER_FULFILLED_EVENT, { hostId, orderId, key: fulfillment.id, order: { ...snapshot.data(), ...shipped }, extra: { fulfillment: fulfillmentEventView(order, fulfillment) } })
      return { outcome: 'recorded', status, fulfillment }
    },
  )
  // The BUYER hears about it (AGL-3610): shipped with the tracking link, or
  // delivered. Once per shipment, after the write, and never fails the
  // shipment — see `order-notifications.ts`. A retry returns `already` above
  // and never reaches here. A merchant who unticked "Notify customer"
  // (AGL-3611) recorded the shipment with `notify: false`, and nobody is told.
  // Every shipment recorded, by any door, is announced (AGL-3612), so a
  // plugin that follows parcels can follow one typed in by hand too.
  if (result.outcome === 'recorded' && result.fulfillment?.trackingNumber) {
    await announcePluginShipment({
      hostId,
      recordId: orderId,
      shipmentId: result.fulfillment.id,
      ...(result.fulfillment.carrier ? { carrier: result.fulfillment.carrier } : {}),
      trackingNumber: result.fulfillment.trackingNumber,
      ...(request.labelRef ? { labelRef: request.labelRef } : {}),
    })
  }
  if (result.outcome === 'recorded' && result.fulfillment?.notify !== false) {
    await notifyOrderBuyer(
      { hostId, orderId },
      to === 'fulfilled' ? 'shipped' : 'delivered',
      result.fulfillment ? { fulfillmentId: result.fulfillment.id } : {},
    )
  }
  return result
}

/** What an edit or a cancel of one fulfillment came to. */
export type FulfillmentChangeOutcome =
  | { outcome: 'updated'; status: CommerceModel.OrderStatus; fulfillment: CommerceModel.OrderFulfillment }
  | { outcome: 'already'; fulfillment: CommerceModel.OrderFulfillment }
  | { outcome: 'no_such_order' }
  | { outcome: 'no_such_fulfillment' }
  /** The order is history (delivered, refunded, cancelled); `from` names it. */
  | { outcome: 'locked'; from: string }

/**
 * Corrects the tracking on one fulfillment (AGL-3611): a mistyped number, a
 * carrier swapped, a label bought after the parcel was recorded. Moves no
 * status and no stock. A cancelled fulfillment is history and is refused.
 */
export async function updateFulfillmentTracking(request: {
  hostId: string
  orderId: string
  fulfillmentId: string
  carrier?: string
  trackingNumber?: string
  trackingUrl?: string
}): Promise<FulfillmentChangeOutcome> {
  const { carrier, trackingNumber } = boundTracking(request)
  const explicitUrl = safeHttpsUrl(request.trackingUrl)
  const orderRef = orderRefFor(request.hostId, request.orderId)
  return firebaseAdmin
    .app()
    .firestore()
    .runTransaction(async (transaction): Promise<FulfillmentChangeOutcome> => {
      const snapshot = await transaction.get(orderRef)
      if (!snapshot.exists) return { outcome: 'no_such_order' }
      const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
      const index = (order.fulfillments ?? []).findIndex((entry) => entry.id === request.fulfillmentId)
      if (index < 0) return { outcome: 'no_such_fulfillment' }
      const current = (order.fulfillments ?? [])[index]
      if (!CommerceModel.fulfillmentIsActive(current) || !['paid', 'partially_fulfilled', 'fulfilled', 'delivered'].includes(order.status)) {
        return { outcome: 'locked', from: CommerceModel.fulfillmentIsActive(current) ? order.status : 'cancelled' }
      }
      const atMs = Date.now()
      const next: CommerceModel.OrderFulfillment = { ...current, updatedAtMs: atMs }
      delete next.carrier
      delete next.trackingNumber
      delete next.trackingUrl
      Object.assign(next, trackingFields(carrier, trackingNumber, explicitUrl))
      if (
        (current.carrier ?? '') === (next.carrier ?? '') &&
        (current.trackingNumber ?? '') === (next.trackingNumber ?? '') &&
        (current.trackingUrl ?? '') === (next.trackingUrl ?? '')
      ) {
        return { outcome: 'already', fulfillment: current }
      }
      const fulfillments = [...(order.fulfillments ?? [])]
      fulfillments[index] = next
      transaction.update(orderRef, {
        fulfillments,
        updatedAtMs: atMs,
        timeline: CommerceModel.appendOrderEvent(
          order,
          'tracking-updated',
          trackingNumber ? `${carrier || 'Tracking'} ${trackingNumber}` : 'Tracking removed',
          atMs,
        ),
      })
      return { outcome: 'updated', status: order.status, fulfillment: next }
    })
}

/**
 * Cancels one fulfillment (AGL-3611): the parcel was never handed over, or was
 * recorded against the wrong items. Its units go back to unfulfilled and the
 * order's status is recomputed from what remains — `fulfilled` can step back
 * to `partially_fulfilled` or `paid`.
 *
 * That step back is NOT an `ORDER_TRANSITIONS` edge, on purpose: the table
 * says what may happen to an order going forward, and admitting
 * `fulfilled → paid` there would open it to every other caller. This is the one writer
 * that may take it, and only from a status whose fulfillments are still open
 * (`orderFulfillmentsEditable`): a delivered, refunded or cancelled order's
 * shipments are what happened and stay that way.
 */
export async function cancelOrderFulfillment(request: {
  hostId: string
  orderId: string
  fulfillmentId: string
}): Promise<FulfillmentChangeOutcome> {
  const orderRef = orderRefFor(request.hostId, request.orderId)
  return firebaseAdmin
    .app()
    .firestore()
    .runTransaction(async (transaction): Promise<FulfillmentChangeOutcome> => {
      const snapshot = await transaction.get(orderRef)
      if (!snapshot.exists) return { outcome: 'no_such_order' }
      const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
      const index = (order.fulfillments ?? []).findIndex((entry) => entry.id === request.fulfillmentId)
      if (index < 0) return { outcome: 'no_such_fulfillment' }
      const current = (order.fulfillments ?? [])[index]
      if (!CommerceModel.fulfillmentIsActive(current)) return { outcome: 'already', fulfillment: current }
      if (!CommerceModel.orderFulfillmentsEditable(order)) {
        return { outcome: 'locked', from: order.status }
      }
      const atMs = Date.now()
      const next: CommerceModel.OrderFulfillment = {
        ...current,
        status: 'cancelled',
        cancelledAtMs: atMs,
        updatedAtMs: atMs,
      }
      const fulfillments = [...(order.fulfillments ?? [])]
      fulfillments[index] = next
      const status = CommerceModel.statusFromFulfillments({ lineItems: order.lineItems, fulfillments })
      transaction.update(orderRef, {
        status,
        fulfillments,
        updatedAtMs: atMs,
        timeline: CommerceModel.appendOrderEvent(
          order,
          'fulfillment-cancelled',
          CommerceModel.describeFulfillmentLines(order, CommerceModel.fulfillmentLineQuantities(order, current)) +
            ' back to unfulfilled',
          atMs,
        ),
      })
      return { outcome: 'updated', status, fulfillment: next }
    })
}

/**
 * Fulfil and mark-delivered, with the transition re-asked under the write
 * (AGL-1819) — the last two order-status writes the console made with a client
 * `updateDoc`, moved behind the same shape as `cancel-order.ts`.
 *
 * THE STALE-DIALOG HOLE IS THE SAME ONE AGL-1818 CLOSED FOR CANCEL.
 * `canTransitionOrder` was consulted only to RENDER the buttons, so a dialog
 * opened on a `paid` order that was refunded (or cancelled) in another tab
 * could still write `fulfilled` straight onto it — `ORDER_TRANSITIONS` stayed
 * advisory because nothing consulted it on the way IN. Re-reading the order
 * inside the transaction that writes the status is what turns the table into
 * a guarantee; the race comes back as a 409 naming the state that refused.
 *
 * ONE ROUTE FOR THE TWO FULFILMENT-SIDE TRANSITIONS, and ONLY those. They are
 * the same act — a forward status flip plus a timeline entry, no stock moved,
 * no money moved — so they share a handler parameterized on `to`. It refuses
 * every other target with a 400 on purpose: `cancelled` releases stock under
 * its own transaction (`cancel-order.ts`) and `refunded` moves money
 * (`refund.ts`), so admitting them here would hand callers a door around
 * exactly the specifics those routes exist to enforce.
 *
 * NO STOCK MOVES HERE. The sale decremented inventory when the money landed
 * (see `cancel-order.ts`'s header); shipping the goods changes what is on the
 * shelf not at all. An open `restockCheck` — a partial refund's question,
 * flagged before the merchant ships the rest — survives untouched: the write
 * is an `update()` naming only status, fulfillments and timeline, and the
 * question is still the merchant's to answer.
 *
 * NO MANAGER NOTIFICATION, matching the client write this replaces: the
 * merchant fulfilled the order themselves, and `notifyHostManagers` would
 * tell them what they just did. (`supplier-update.ts` notifies because there
 * the SUPPLIER acted and the merchant is the one who needs to hear it.) The
 * BUYER is told, through `recordOrderShipment` (AGL-3610).
 *
 * ONCE. A retried request — a lost response, a second click — finds the order
 * already in the target status and returns success WITHOUT writing: appending
 * a second copy of the same fulfillment is the double this guard exists to
 * stop. It reports `already: true` so the console can say so. A fulfil retried
 * after the order moved on to `delivered` in another tab is a 409 instead,
 * which is the truth: that state cannot be fulfilled (again).
 *
 * THE SERVER'S ORDER, NOT THE DIALOG'S: `lineItemIds` and the timeline append
 * are computed from the transaction's own read, so a note landed from another
 * tab survives — the client write it replaces appended to the dialog's stale
 * copy and dropped it.
 *
 * Role gate: `admin` and `editor`, the role the client write already had
 * under the rules' host catch-all — same reasoning as `cancel-order.ts`.
 */
export const fulfillOrderHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const orderId = String(body.orderId ?? '')
  if (!hostId || !orderId) {
    return res.status(400).json({ error: 'Missing hostId or orderId' })
  }
  // Firestore reserves `__…__` ids and `.doc()` throws SYNCHRONOUSLY on one,
  // which would surface as a 500 on a caller's typo rather than the 400 it is.
  if (/^__.*__$/.test(hostId) || /^__.*__$/.test(orderId)) {
    return res.status(400).json({ error: 'Missing hostId or orderId' })
  }
  // Two more acts on one fulfillment (AGL-3611): correct its tracking, or
  // cancel it. Same route, same role gate; neither moves stock or money.
  const action = String(body.action ?? '')
  const fulfillmentId = String(body.fulfillmentId ?? '').slice(0, 100)
  if ((action === 'update-tracking' || action === 'cancel-fulfillment') && !fulfillmentId) {
    return res.status(400).json({ error: 'Missing fulfillmentId' })
  }
  const to = String(body.to ?? '') as OrderFulfilmentTarget
  if (!action && to !== 'fulfilled' && to !== 'delivered') {
    // Deliberately NOT a generic transition endpoint — see the header.
    return res.status(400).json({ error: 'to must be fulfilled or delivered' })
  }
  if (action && action !== 'update-tracking' && action !== 'cancel-fulfillment') {
    return res.status(400).json({ error: 'Unknown action' })
  }
  const { carrier, trackingNumber } = boundTracking(body)
  const lineItems = Array.isArray(body.lineItems)
    ? (body.lineItems as unknown[]).slice(0, 500).map((entry) => ({
        lineItemId: Number((entry as Record<string, unknown>)?.lineItemId),
        quantity: Number((entry as Record<string, unknown>)?.quantity),
      }))
    : undefined
  const idempotencyKey = String(req.headers['idempotency-key'] ?? body.idempotencyKey ?? '').slice(0, 200)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not permitted' })
    }

    if (action) {
      const change =
        action === 'update-tracking'
          ? await updateFulfillmentTracking({
              hostId,
              orderId,
              fulfillmentId,
              carrier,
              trackingNumber,
              trackingUrl: body.trackingUrl,
            })
          : await cancelOrderFulfillment({ hostId, orderId, fulfillmentId })
      // A corrected tracking number is a parcel to follow (AGL-3612).
      if (change.outcome === 'updated' && action === 'update-tracking' && change.fulfillment.trackingNumber) {
        await announcePluginShipment({
          hostId,
          recordId: orderId,
          shipmentId: change.fulfillment.id,
          ...(change.fulfillment.carrier ? { carrier: change.fulfillment.carrier } : {}),
          trackingNumber: change.fulfillment.trackingNumber,
        })
      }
      if (change.outcome === 'no_such_order') return res.status(404).json({ error: 'Unknown order' })
      if (change.outcome === 'no_such_fulfillment') {
        return res.status(404).json({ error: 'That shipment is no longer on this order' })
      }
      if (change.outcome === 'locked') {
        return res.status(409).json({
          error:
            change.from === 'cancelled'
              ? 'That shipment was canceled and can no longer be edited'
              : `Shipments on an order in "${change.from}" can no longer be changed`,
        })
      }
      return res.status(200).json({
        ok: true,
        ...(change.outcome === 'already' ? { already: true } : { status: change.status }),
        fulfillment: change.fulfillment,
      })
    }

    // Authorized above; the shipment itself is the shared transaction. The
    // console dialog branches on `ok`, `already` and the 409's `error`
    // string, and this route's contract is with that dialog, not with the
    // registry's vocabulary.
    const outcome = await recordOrderShipment({
      hostId,
      orderId,
      to,
      carrier,
      trackingNumber,
      ...(lineItems ? { lineItems } : {}),
      ...(body.trackingUrl ? { trackingUrl: String(body.trackingUrl) } : {}),
      ...(body.labelUrl ? { labelUrl: String(body.labelUrl) } : {}),
      ...(body.notify === false ? { notify: false } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    })
    if (outcome.outcome === 'no_such_order') {
      return res.status(404).json({ error: 'Unknown order' })
    }
    if (outcome.outcome === 'invalid_lines') {
      return res
        .status(outcome.problem.problem === 'over_fulfilled' ? 409 : 400)
        .json({ error: outcome.message })
    }
    if (outcome.outcome === 'blocked') {
      return res.status(409).json({
        error:
          to === 'delivered'
            ? `Orders in "${outcome.from}" cannot be marked delivered`
            : `Orders in "${outcome.from}" cannot be fulfilled`,
      })
    }
    if (outcome.outcome === 'already') {
      return res.status(200).json({
        ok: true,
        already: true,
        ...(outcome.fulfillment ? { fulfillment: outcome.fulfillment } : {}),
      })
    }
    return res.status(200).json({
      ok: true,
      status: outcome.status,
      ...(outcome.fulfillment ? { fulfillment: outcome.fulfillment } : {}),
    })
  } catch (error) {
    // Nothing landed — the transaction is all-or-nothing — so the order is
    // still where it was and the merchant can try again.
    console.error('fulfillOrder failed', error)
    return res.status(500).json({
      error: to === 'delivered' ? 'Mark delivered failed' : 'Fulfill failed',
    })
  }
}
