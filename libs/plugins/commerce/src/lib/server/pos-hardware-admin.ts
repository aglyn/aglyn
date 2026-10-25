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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  isPosHardwareOrderStatus,
  nextPosHardwareStatus,
  POS_HARDWARE_ORDER_ID,
  POS_HARDWARE_ORDERS_COLLECTION,
  POS_HARDWARE_STATUS_STAMP,
  posHardwareRefundable,
  posHardwareSaleRecord,
  type PosHardwareOrder,
  type PosHardwareOrderStatus,
  type PosHardwareTracking,
} from '../model/pos-hardware'
import { fulfillmentTrackingUrl } from '../model/tracking-url'
import { hardwareOrdersRef, posHardwareOrderNumber, posHardwareSaleRef } from './pos-hardware'
import { sendPosHardwareEmail } from './pos-hardware-notify'
import { posStripe } from './pos-stripe'

/*==========================================
 * `/api/commerce/admin/hardware-orders` (AGL-4038): the staff end of the POS
 * hardware shop, for the Hardware orders staff page.
 *
 *   GET   every workspace's orders, newest first, optionally one status
 *   POST  update  record Stripe's order id and the tracking, or move the
 *                 order one step on (Ordered → Shipped → Delivered →
 *                 Registered); Shipped needs a tracking number
 *         cancel  cancel and refund in full, before it ships
 *         refund  refund in full, before it ships
 *
 * Staff only. Reading is open to every staff role; every write is `super` or
 * `billing`, because each one changes what a customer is told or returns
 * their money. Every write is an `adminAudit` row, and each one rewrites the
 * order's retained sale record (`posHardwareSales/{orderId}`) from the order
 * as it now stands, in the same transaction.
 *=========================================*/

/** One page of the staff list. */
const PAGE = 25
/** A page cursor is the path of the last order the previous page showed. */
const CURSOR = /^orgs\/[^/]+\/hardwareOrders\/[^/]+$/
const WRITE_ROLES = ['super', 'billing']

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/** An order as the staff page lists it. */
function staffView(id: string, order: PosHardwareOrder) {
  return {
    id,
    number: posHardwareOrderNumber(id),
    orgId: order.orgId,
    hostId: order.hostId,
    status: order.status,
    contactEmail: order.contactEmail ?? null,
    lines: order.lines ?? [],
    subtotalCents: order.subtotalCents ?? 0,
    shipping: order.shipping ?? null,
    taxCents: order.taxCents ?? 0,
    totalCents: order.totalCents ?? 0,
    stripeCheckoutSessionId: order.stripeCheckoutSessionId ?? null,
    stripePaymentIntentId: order.stripePaymentIntentId ?? null,
    stripeHardwareOrderId: order.stripeHardwareOrderId ?? null,
    tracking: order.tracking ?? null,
    livemode: order.livemode === true,
    refundPending: Boolean((order as { refundRequestedAtMs?: number }).refundRequestedAtMs),
    createdAtMs: order.createdAtMs ?? 0,
    updatedAtMs: order.updatedAtMs ?? 0,
  }
}

export type StaffHardwareOrderView = ReturnType<typeof staffView>

class Refusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** A tracking entry from the request, or `undefined` when none was sent. */
function trackingFrom(raw: unknown): PosHardwareTracking | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  const carrier = String((raw as { carrier?: unknown })?.carrier ?? '').trim().slice(0, 60)
  const number = String((raw as { number?: unknown })?.number ?? '').trim().slice(0, 80)
  const url = String((raw as { url?: unknown })?.url ?? '').trim().slice(0, 500)
  if (!carrier || !number) throw new Refusal('Enter the carrier and the tracking number.', 400)
  return {
    carrier,
    number,
    // An https link typed by staff wins; otherwise one is built for a known
    // carrier, and an unknown one has none.
    url: fulfillmentTrackingUrl({ carrier, trackingNumber: number, trackingUrl: url || null }),
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
    if (!decoded['staff']) return json({ error: 'Staff only' }, 403)
    // A missing role claim reads as the least one, never as super.
    const role = String(decoded['staffRole'] ?? 'support')
    const firestore = firebaseAdmin.app().firestore()

    if (method === 'GET') {
      const requested = String(query?.['status'] ?? '')
      let ordersQuery: any = firestore.collectionGroup(POS_HARDWARE_ORDERS_COLLECTION)
      if (requested) {
        if (!isPosHardwareOrderStatus(requested)) return json({ error: 'Unknown status' }, 400)
        ordersQuery = ordersQuery.where('status', '==', requested)
      }
      ordersQuery = ordersQuery.orderBy('createdAtMs', 'desc')
      const after = String(query?.['after'] ?? '')
      if (after) {
        if (!CURSOR.test(after)) return json({ error: 'Unknown page' }, 400)
        const cursor = await firestore.doc(after).get()
        // An order deleted since the page was read starts the list over
        // rather than answering an empty page.
        if (cursor.exists) ordersQuery = ordersQuery.startAfter(cursor)
      }
      const snapshot = await ordersQuery.limit(PAGE + 1).get()
      const docs = snapshot.docs as Array<{ id: string; ref: { path: string }; data: () => PosHardwareOrder }>
      const shown = docs.slice(0, PAGE)
      return json({
        orders: shown.map((doc) => staffView(doc.id, doc.data())),
        next: docs.length > PAGE ? (shown[shown.length - 1]?.ref.path ?? null) : null,
        pageSize: PAGE,
        canWrite: WRITE_ROLES.includes(role),
      })
    }

    if (method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    if (!WRITE_ROLES.includes(role)) {
      return json({ error: 'Changing a hardware order requires the super or billing staff role.' }, 403)
    }
    const input = (body ?? {}) as Record<string, unknown>
    const action = String(input['action'] ?? '')
    const orgId = String(input['orgId'] ?? '')
    const orderId = String(input['orderId'] ?? '')
    if (!orgId || !/^[A-Za-z0-9_-]{1,128}$/.test(orgId) || !POS_HARDWARE_ORDER_ID.test(orderId)) {
      return json({ error: 'orgId or orderId is missing or malformed' }, 400)
    }
    const ref = hardwareOrdersRef(orgId).doc(orderId)
    const actor = { actorUid: decoded.uid, actorEmail: decoded.email ? String(decoded.email) : null }

    if (action === 'update') return await updateOrder(firestore, ref, orgId, orderId, input, actor)
    if (action === 'cancel' || action === 'refund') {
      return await refundOrder(firestore, ref, orgId, orderId, action, actor)
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (error) {
    if (error instanceof Refusal) return json({ error: error.message }, error.status)
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[pos-hardware-admin]', error)
    return json({ error: 'Hardware orders failed' }, 500)
  }
}

type Actor = { actorUid: string; actorEmail: string | null }

async function updateOrder(
  firestore: any,
  ref: any,
  orgId: string,
  orderId: string,
  input: Record<string, unknown>,
  actor: Actor,
): Promise<Response> {
  const tracking = trackingFrom(input['tracking'])
  const hardwareOrderIdRaw = input['stripeHardwareOrderId']
  const stripeHardwareOrderId =
    hardwareOrderIdRaw === undefined ? undefined : String(hardwareOrderIdRaw ?? '').trim().slice(0, 120) || null
  const advanceTo = input['status'] === undefined ? undefined : String(input['status'])
  if (advanceTo !== undefined && !isPosHardwareOrderStatus(advanceTo)) {
    return json({ error: 'Unknown status' }, 400)
  }

  const outcome = await firestore.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new Refusal('No such order', 404)
    const before = snapshot.data() as PosHardwareOrder & { refundRequestedAtMs?: number }
    if (before.status === 'canceled' || before.status === 'refunded') {
      throw new Refusal('This order was canceled or refunded and can no longer change.', 409)
    }
    const now = Date.now()
    const patch: Record<string, unknown> = { updatedAtMs: now }
    if (stripeHardwareOrderId !== undefined) patch['stripeHardwareOrderId'] = stripeHardwareOrderId
    if (tracking !== undefined) patch['tracking'] = tracking
    let reached: PosHardwareOrderStatus | null = null
    if (advanceTo !== undefined && advanceTo !== before.status) {
      if (nextPosHardwareStatus(before.status) !== advanceTo) {
        throw new Refusal(`An order that is ${before.status} cannot move to ${advanceTo}.`, 409)
      }
      if (before.refundRequestedAtMs) throw new Refusal('A refund is in progress for this order.', 409)
      const trackingAfter = tracking !== undefined ? tracking : before.tracking
      if (advanceTo === 'shipped' && !trackingAfter?.number) {
        throw new Refusal('Add the tracking number before marking the order shipped.', 400)
      }
      patch['status'] = advanceTo
      patch[POS_HARDWARE_STATUS_STAMP[advanceTo]] = now
      reached = advanceTo
    }
    const after = { ...before, ...patch } as PosHardwareOrder
    transaction.update(ref, patch)
    transaction.set(posHardwareSaleRef(orderId), posHardwareSaleRecord(orderId, after))
    return { before, after, reached }
  })

  await addAdminAudit(firestore, {
    action: 'pos-hardware-order-update',
    ...actor,
    scope: 'posHardwareOrder',
    target: `orgs/${orgId}/${POS_HARDWARE_ORDERS_COLLECTION}/${orderId}`,
    orgId,
    before: {
      status: outcome.before.status,
      stripeHardwareOrderId: outcome.before.stripeHardwareOrderId ?? null,
      tracking: outcome.before.tracking ?? null,
    },
    after: {
      status: outcome.after.status,
      stripeHardwareOrderId: outcome.after.stripeHardwareOrderId ?? null,
      tracking: outcome.after.tracking ?? null,
    },
    at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  })
  // Told once per step: the transaction above lets only one caller reach it.
  if (outcome.reached === 'shipped') await sendPosHardwareEmail('shipped', orderId, outcome.after)
  if (outcome.reached === 'delivered') await sendPosHardwareEmail('delivered', orderId, outcome.after)
  return json({ ok: true, order: staffView(orderId, outcome.after) })
}

async function refundOrder(
  firestore: any,
  ref: any,
  orgId: string,
  orderId: string,
  action: 'cancel' | 'refund',
  actor: Actor,
): Promise<Response> {
  const finalStatus: PosHardwareOrderStatus = action === 'cancel' ? 'canceled' : 'refunded'
  // Claim the refund under the lock first, so the order cannot be marked
  // shipped while the money is on its way back, and two presses refund once.
  const claim = await firestore.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new Refusal('No such order', 404)
    const order = snapshot.data() as PosHardwareOrder & { refundRequestedAtMs?: number }
    if (order.status === finalStatus) return { order, already: true }
    if (!posHardwareRefundable(order.status)) {
      throw new Refusal(
        'This order has shipped, so it can no longer be canceled or refunded here. Arrange a return with Stripe instead.',
        409,
      )
    }
    if (!order.stripePaymentIntentId) throw new Refusal('This order has no payment to refund.', 409)
    transaction.update(ref, { refundRequestedAtMs: Date.now() })
    return { order, already: false }
  })
  if (claim.already) return json({ ok: true, order: staffView(orderId, claim.order) })

  const refund = await posStripe('POST', 'refunds', {
    params: {
      payment_intent: claim.order.stripePaymentIntentId,
      'metadata[type]': 'pos-hardware-order',
      'metadata[orderId]': orderId,
      'metadata[orgId]': orgId,
    },
    // One refund per order, whichever of the two acts asked for it.
    idempotencyKey: `pos-hw-refund-${orderId}`,
  })
  if (!refund.ok || !refund.body?.id) {
    await ref.update({ refundRequestedAtMs: firebaseAdmin.firestore.FieldValue.delete() }).catch(() => undefined)
    console.error('[pos-hardware-admin] refund refused', orderId, refund.status, refund.body?.error?.code)
    return json({ error: String(refund.body?.error?.message ?? '') || 'Stripe refused the refund.' }, 502)
  }
  const now = Date.now()
  const patch = {
    status: finalStatus,
    [POS_HARDWARE_STATUS_STAMP[finalStatus]]: now,
    updatedAtMs: now,
    refundId: String(refund.body.id),
    refundedCents: Number(refund.body.amount ?? claim.order.totalCents ?? 0),
    refundRequestedAtMs: firebaseAdmin.firestore.FieldValue.delete(),
  }
  const settled = { ...claim.order }
  delete settled.refundRequestedAtMs
  const after: PosHardwareOrder = {
    ...settled,
    status: finalStatus,
    [POS_HARDWARE_STATUS_STAMP[finalStatus]]: now,
    updatedAtMs: now,
    refundId: patch.refundId,
    refundedCents: patch.refundedCents,
  }
  // The order and its retained sale record move together: the record is
  // what the refund is accounted from once the workspace is gone.
  await firestore.runTransaction(async (transaction: any) => {
    transaction.update(ref, patch)
    transaction.set(posHardwareSaleRef(orderId), posHardwareSaleRecord(orderId, after))
  })
  await addAdminAudit(firestore, {
    action: `pos-hardware-order-${action}`,
    ...actor,
    scope: 'posHardwareOrder',
    target: `orgs/${orgId}/${POS_HARDWARE_ORDERS_COLLECTION}/${orderId}`,
    orgId,
    before: { status: claim.order.status },
    after: { status: finalStatus, refundId: patch.refundId, refundedCents: patch.refundedCents },
    at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  })
  return json({ ok: true, order: staffView(orderId, after) })
}

export { handler as posHardwareAdminOrders }
