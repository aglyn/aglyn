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

import * as Aglyn from '@aglyn/aglyn/server'
import type { PluginApiHandler, PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import {
  findUserByUidAcrossPools,
  firebaseAdmin,
  getOrgForHost,
  hostSendingIdentity,
  meterHostEmail,
  notifyHostManagers,
  renderHostEmailWithTokens,
} from '@aglyn/tenant-data-admin'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import * as CommerceModel from '../model'
import { RETURN_REFUNDED_EVENT, RETURN_REQUESTED_EVENT } from '../model/order-events'
import { raiseOrderEvent, stageOrderEvent } from './order-events'
import { orderStatusUrl, verifyOrderStatusToken } from './order-status-token'
import { readActiveMemberSession } from './membership'
import { resolveTrackedRestockLines } from './restock-flag'
import { refundHandler } from './refund'

/**
 * Returns (RMA, AGL-3611): the buyer's door, the merchant's door, and the
 * writes behind both. The rules — what is returnable, the window, the state
 * machine, what a refund is worth — are the model's (`commerce-returns.ts`);
 * this is where they are re-asked under the write.
 *
 * EVERY WRITE IS A TRANSACTION that reads the return, the order and, when it
 * opens one, every return already on the order — so two requests for the last
 * unit cannot both be granted, and a stale console cannot approve a return a
 * colleague declined a moment ago.
 *
 * THE MONEY MOVES THROUGH THE ORDER'S REFUND ROUTE, never here. A return's
 * refund calls `refund.ts` with the merchant's own credentials and a key
 * derived from the return, so its gates (an admin of the whole workspace,
 * the over-refund cap, the open-dispute block, Stripe's idempotency) are the
 * ones every refund passes, and asking twice refunds once.
 *
 * STOCK COMES BACK WHEN THE PARCEL DOES. Receiving a return puts the units
 * the merchant chose back on the shelf, at the location they chose, with an
 * inventory adjustment row — the products hub's history shows it beside the
 * sale. A refund then answers the order's restock question with what the
 * return already did, so nobody is asked to restock the same units twice.
 */

export const RETURNS_COLLECTION = 'returns'

type Firestore = FirebaseFirestore.Firestore

const hostRefFor = (firestore: Firestore, hostId: string) => firestore.collection('hosts').doc(hostId)

const isId = (value: string) => Boolean(value) && value.length <= 200 && !/^__.*__$/.test(value) && !value.includes('/')

/** The store's settings document and what the return emails need from the host. */
async function readStore(firestore: Firestore, hostId: string) {
  const hostRef = hostRefFor(firestore, hostId)
  const [host, store] = await Promise.all([
    hostRef.get().catch(() => null),
    hostRef.collection('settings').doc('store').get().catch(() => null),
  ])
  const settings = (store?.data() ?? {}) as Record<string, unknown>
  return {
    host: (host?.data() ?? {}) as Record<string, unknown>,
    returnSettings: CommerceModel.readReturnSettings(settings['returns']),
    currency: String(settings['currency'] ?? 'USD').toUpperCase(),
  }
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `$${(cents / 100).toFixed(2)}`
  }
}

/** The return as an event carries it. */
function returnEventView(id: string, entry: CommerceModel.HostReturn) {
  return {
    id,
    status: entry.status,
    lines: entry.lines.map((line) => ({ ...line })),
    refundCents: entry.refundCents ?? null,
  }
}

/** "1× House Blend — Arrived damaged", one per line. */
function returnItemsText(order: CommerceModel.HostOrder, entry: Pick<CommerceModel.HostReturn, 'lines'>): string {
  return entry.lines
    .map(
      (line) =>
        `${line.quantity}× ${order.lineItems?.[line.lineItemId]?.name ?? `line ${line.lineItemId}`} — ${
          CommerceModel.RETURN_REASON_LABELS[line.reason] ?? line.reason
        }`,
    )
    .join('\n')
}

export type OpenReturnOutcome =
  | { outcome: 'created'; returnId: string; entry: CommerceModel.HostReturn; order: CommerceModel.HostOrder }
  | { outcome: 'refused'; message: string }
  | { outcome: 'no_such_order' }

/**
 * Opens a return. A buyer's starts `requested`; a merchant's starts
 * `approved`, since the merchant asking is the approval.
 */
export async function openReturn(request: {
  hostId: string
  orderId: string
  lines: ReadonlyArray<{ lineItemId: unknown; quantity: unknown; reason: unknown }>
  note?: string
  by: 'buyer' | 'merchant'
  now?: number
}): Promise<OpenReturnOutcome> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = hostRefFor(firestore, request.hostId)
  const orderRef = hostRef.collection('orders').doc(request.orderId)
  const { returnSettings } = await readStore(firestore, request.hostId)
  const now = request.now ?? Date.now()
  const note = String(request.note ?? '').trim().slice(0, CommerceModel.RETURN_NOTE_MAX)
  return firestore.runTransaction(async (transaction): Promise<OpenReturnOutcome> => {
    const orderSnapshot = await transaction.get(orderRef)
    if (!orderSnapshot.exists) return { outcome: 'no_such_order' }
    const existing = await transaction.get(
      hostRef.collection(RETURNS_COLLECTION).where('orderId', '==', request.orderId),
    )
    const order = CommerceModel.liftLegacyOrder((orderSnapshot.data() ?? {}) as never)
    const verdict = CommerceModel.validateReturnRequest({
      order,
      existing: existing.docs.map((entry) => entry.data() as CommerceModel.HostReturn),
      settings: returnSettings,
      lines: request.lines,
      by: request.by,
      now,
    })
    if (!('lines' in verdict)) {
      return { outcome: 'refused', message: CommerceModel.describeReturnRequestProblem(verdict) }
    }
    const status: CommerceModel.ReturnStatus = request.by === 'merchant' ? 'approved' : 'requested'
    const entry: CommerceModel.HostReturn = {
      orderId: request.orderId,
      orderNumber: CommerceModel.returnOrderNumber(order, request.orderId),
      customerEmail: order.customerEmail ?? null,
      customerName: order.customerName ?? null,
      lines: verdict.lines,
      status,
      requestedBy: request.by,
      ...(note ? (request.by === 'buyer' ? { customerNote: note } : { merchantNote: note }) : {}),
      timeline: [
        {
          atMs: now,
          event: status,
          detail: `${request.by === 'buyer' ? 'Requested by the buyer' : 'Opened by the store'}: ${CommerceModel.describeReturnLines(order, verdict.lines)}`,
        },
      ],
      createdAtMs: now,
      updatedAtMs: now,
    }
    const returnRef = hostRef.collection(RETURNS_COLLECTION).doc()
    transaction.create(returnRef, entry)
    const orderPatch = {
      timeline: CommerceModel.appendOrderEvent(
        order,
        'return-requested',
        CommerceModel.describeReturnLines(order, verdict.lines),
        now,
      ),
    }
    transaction.update(orderRef, orderPatch)
    stageOrderEvent(transaction, RETURN_REQUESTED_EVENT, {
      hostId: request.hostId,
      orderId: request.orderId,
      key: `return:${returnRef.id}`,
      order: { ...orderSnapshot.data(), ...orderPatch },
      extra: { return: returnEventView(returnRef.id, entry) },
    })
    return { outcome: 'created', returnId: returnRef.id, entry, order }
  })
}

export type ReturnAction = 'approve' | 'decline' | 'close' | 'note' | 'attach-label'

export type ChangeReturnOutcome =
  | { outcome: 'changed'; entry: CommerceModel.HostReturn; order: CommerceModel.HostOrder | null }
  | { outcome: 'already'; entry: CommerceModel.HostReturn }
  | { outcome: 'refused'; message: string }
  | { outcome: 'no_such_return' }

const ACTION_TARGET: Partial<Record<ReturnAction, CommerceModel.ReturnStatus>> = {
  approve: 'approved',
  decline: 'declined',
  close: 'closed',
}

/**
 * Approve, decline, close, a note, or a return label — the writes that move
 * no stock and no money. The transition is re-asked under the write.
 */
export async function changeReturn(request: {
  hostId: string
  returnId: string
  action: ReturnAction
  merchantNote?: string
  label?: { carrier: string; trackingNumber: string; labelUrl: string; trackingUrl?: string }
  now?: number
}): Promise<ChangeReturnOutcome> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = hostRefFor(firestore, request.hostId)
  const returnRef = hostRef.collection(RETURNS_COLLECTION).doc(request.returnId)
  const now = request.now ?? Date.now()
  const note = request.merchantNote === undefined ? undefined : String(request.merchantNote).trim().slice(0, CommerceModel.RETURN_NOTE_MAX)
  return firestore.runTransaction(async (transaction): Promise<ChangeReturnOutcome> => {
    const snapshot = await transaction.get(returnRef)
    if (!snapshot.exists) return { outcome: 'no_such_return' }
    const entry = snapshot.data() as CommerceModel.HostReturn
    const orderSnapshot = await transaction.get(hostRef.collection('orders').doc(entry.orderId))
    const order = orderSnapshot.exists ? CommerceModel.liftLegacyOrder((orderSnapshot.data() ?? {}) as never) : null
    const target = ACTION_TARGET[request.action]
    let patch: Partial<CommerceModel.HostReturn>
    if (target) {
      if (entry.status === target) return { outcome: 'already', entry }
      if (!CommerceModel.canTransitionReturn(entry.status, target)) {
        return {
          outcome: 'refused',
          message: `A return that is ${CommerceModel.RETURN_STATUS_LABELS[entry.status].toLowerCase()} cannot be ${CommerceModel.RETURN_STATUS_LABELS[target].toLowerCase()}`,
        }
      }
      patch = {
        status: target,
        ...(note !== undefined && note ? { merchantNote: note } : {}),
        timeline: CommerceModel.appendReturnEvent(entry, target, note || undefined, now),
      }
    } else if (request.action === 'attach-label') {
      const label = request.label
      if (!label?.labelUrl || !/^https:\/\//i.test(label.labelUrl)) {
        return { outcome: 'refused', message: 'A return label needs an https link' }
      }
      if (!CommerceModel.returnIsOpen(entry) || entry.status === 'refunded') {
        return { outcome: 'refused', message: 'This return is finished; a label can no longer be attached' }
      }
      const carrier = String(label.carrier ?? '').trim().slice(0, 40)
      const trackingNumber = String(label.trackingNumber ?? '').trim().slice(0, 60)
      const trackingUrl =
        (label.trackingUrl && /^https:\/\//i.test(label.trackingUrl) ? label.trackingUrl : null) ??
        CommerceModel.trackingUrlFor(carrier, trackingNumber)
      patch = {
        returnLabel: {
          carrier,
          trackingNumber,
          labelUrl: String(label.labelUrl).slice(0, 2048),
          ...(trackingUrl ? { trackingUrl } : {}),
          attachedAtMs: now,
        },
        timeline: CommerceModel.appendReturnEvent(entry, 'label', `${carrier} ${trackingNumber}`.trim() || 'Return label attached', now),
      }
    } else {
      patch = {
        merchantNote: note ?? '',
        timeline: CommerceModel.appendReturnEvent(entry, 'note', note || 'Note cleared', now),
      }
    }
    transaction.update(returnRef, { ...patch, updatedAtMs: now })
    return { outcome: 'changed', entry: { ...entry, ...patch, updatedAtMs: now }, order }
  })
}

/**
 * The parcel arrived: the return is `received`, and the units the merchant
 * chose go back on the shelf, at the location they chose. A unit the sale
 * never took off a tracked count (an untracked variant, a deleted product)
 * has nothing to go back to and is left out, as a cancellation leaves it.
 */
export async function receiveReturn(request: {
  hostId: string
  returnId: string
  restock: ReadonlyArray<{ lineItemId: unknown; quantity: unknown }>
  locationId?: string
  now?: number
}): Promise<ChangeReturnOutcome & { units?: number }> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = hostRefFor(firestore, request.hostId)
  const returnRef = hostRef.collection(RETURNS_COLLECTION).doc(request.returnId)
  const now = request.now ?? Date.now()
  const locationId = String(request.locationId ?? '').trim().slice(0, 100)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(returnRef)
    if (!snapshot.exists) return { outcome: 'no_such_return' as const }
    const entry = snapshot.data() as CommerceModel.HostReturn
    if (entry.status === 'received' || entry.restock) return { outcome: 'already' as const, entry }
    if (!CommerceModel.canTransitionReturn(entry.status, 'received')) {
      return {
        outcome: 'refused' as const,
        message: `A return that is ${CommerceModel.RETURN_STATUS_LABELS[entry.status].toLowerCase()} cannot be received`,
      }
    }
    // What may go back: at most what the return covers, per line.
    const covered = new Map(entry.lines.map((line) => [line.lineItemId, line.quantity]))
    const wanted = new Map<number, number>()
    for (const line of request.restock) {
      const lineItemId = Number(line?.lineItemId)
      const quantity = Number(line?.quantity)
      if (!covered.has(lineItemId)) {
        return { outcome: 'refused' as const, message: `Line ${lineItemId} is not part of this return` }
      }
      if (!Number.isInteger(quantity) || quantity < 0) {
        return { outcome: 'refused' as const, message: 'Restock quantities must be whole numbers' }
      }
      const total = (wanted.get(lineItemId) ?? 0) + quantity
      if (total > (covered.get(lineItemId) ?? 0)) {
        return { outcome: 'refused' as const, message: `Only ${covered.get(lineItemId)} of line ${lineItemId} came back` }
      }
      if (quantity > 0) wanted.set(lineItemId, total)
    }
    if (locationId && wanted.size > 0) {
      const location = await transaction.get(hostRef.collection('locations').doc(locationId))
      if (!location.exists) return { outcome: 'refused' as const, message: 'That stock location no longer exists' }
    }
    const orderRef = hostRef.collection('orders').doc(entry.orderId)
    const orderSnapshot = await transaction.get(orderRef)
    const order = orderSnapshot.exists ? CommerceModel.liftLegacyOrder((orderSnapshot.data() ?? {}) as never) : null
    // Every read before any write, as a transaction requires.
    const tracked =
      order && wanted.size > 0
        ? await resolveTrackedRestockLines(hostRef, order, (ref) => transaction.get(ref))
        : { lines: [], products: new Map<string, CommerceModel.HostProduct>() }
    const byProduct = new Map<string, Array<{ variantId: string; quantity: number }>>()
    for (const line of tracked.lines) {
      const quantity = Math.min(line.quantity, wanted.get(line.lineIndex ?? -1) ?? 0)
      if (quantity <= 0) continue
      byProduct.set(line.productId, [...(byProduct.get(line.productId) ?? []), { variantId: line.variantId, quantity }])
    }
    let units = 0
    for (const [productId, lines] of byProduct) {
      const product = tracked.products.get(productId)
      if (!product) continue
      let variants = product.variants
      for (const line of lines) {
        variants = CommerceModel.adjustVariantInventory({ variants }, line.variantId, line.quantity, locationId || undefined)
      }
      transaction.update(hostRef.collection('products').doc(productId), {
        variants,
        ...CommerceModel.productStockFields({ ...product, variants }),
        updatedAtMs: now,
      })
      for (const line of lines) {
        units += line.quantity
        transaction.create(hostRef.collection('inventoryAdjustments').doc(), {
          productId,
          variantId: line.variantId,
          delta: line.quantity,
          reason: 'restock',
          orderId: entry.orderId,
          ...(locationId ? { locationId } : {}),
          atMs: now,
        } satisfies CommerceModel.InventoryAdjustment)
      }
    }
    const restock: CommerceModel.ReturnRestock = {
      lines: [...wanted.entries()].map(([lineItemId, quantity]) => ({ lineItemId, quantity })),
      ...(locationId ? { locationId } : {}),
      atMs: now,
    }
    const patch = {
      status: 'received' as const,
      restock,
      timeline: CommerceModel.appendReturnEvent(
        entry,
        'received',
        units > 0 ? `${units} ${units === 1 ? 'unit' : 'units'} back in stock` : 'Nothing restocked',
        now,
      ),
      updatedAtMs: now,
    }
    transaction.update(returnRef, patch)
    if (order) {
      transaction.update(orderRef, {
        timeline: CommerceModel.appendOrderEvent(order, 'return-received', units > 0 ? `${units} restocked` : undefined, now),
      })
    }
    return { outcome: 'changed' as const, entry: { ...entry, ...patch }, order, units }
  })
}

/**
 * Records a refund that went through the order's refund route against the
 * return, and answers the order's restock question with what the return
 * already did, so the merchant is not asked to restock the same units again.
 */
export async function markReturnRefunded(request: {
  hostId: string
  returnId: string
  refundCents: number
  uid: string
  now?: number
}): Promise<ChangeReturnOutcome> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = hostRefFor(firestore, request.hostId)
  const returnRef = hostRef.collection(RETURNS_COLLECTION).doc(request.returnId)
  const now = request.now ?? Date.now()
  return firestore.runTransaction(async (transaction): Promise<ChangeReturnOutcome> => {
    const snapshot = await transaction.get(returnRef)
    if (!snapshot.exists) return { outcome: 'no_such_return' }
    const entry = snapshot.data() as CommerceModel.HostReturn
    if (entry.status === 'refunded' || entry.refundedAtMs) return { outcome: 'already', entry }
    const orderRef = hostRef.collection('orders').doc(entry.orderId)
    const orderSnapshot = await transaction.get(orderRef)
    const order = orderSnapshot.exists ? CommerceModel.liftLegacyOrder((orderSnapshot.data() ?? {}) as never) : null
    const patch = {
      status: 'refunded' as const,
      refundedAtMs: now,
      refundCents: Math.max(0, Math.round(request.refundCents)),
      timeline: CommerceModel.appendReturnEvent(entry, 'refunded', undefined, now),
      updatedAtMs: now,
    }
    transaction.update(returnRef, patch)
    const check = order?.restockCheck
    if (order && check && !check.resolution && entry.restock) {
      const restocked = entry.restock.lines.some((line) => line.quantity > 0)
      transaction.update(orderRef, {
        restockCheck: {
          ...check,
          resolution: restocked ? 'restocked' : 'dismissed',
          resolvedAtMs: now,
          ...(request.uid ? { resolvedBy: request.uid } : {}),
        } satisfies CommerceModel.OrderRestockCheck,
        timeline: CommerceModel.appendOrderEvent(
          order,
          'restock-check',
          restocked ? 'answered by the return — restocked' : 'answered by the return — no restock',
          now,
        ),
      })
    }
    return { outcome: 'changed', entry: { ...entry, ...patch }, order }
  })
}

/** Calls the order's own refund route in-process, with the caller's credentials. */
async function callRefundRoute(
  req: PluginApiRequest,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<{ status: number; body: Record<string, any> }> {
  let status = 200
  let payload: Record<string, any> = {}
  const res = {
    status(code: number) {
      status = code
      return res
    },
    json(value: unknown) {
      payload = (value ?? {}) as Record<string, any>
      return res
    },
    send(value: unknown) {
      payload = { error: String(value ?? '') }
      return res
    },
    setHeader() {
      return res
    },
    end() {
      return res
    },
  } as unknown as PluginApiResponse
  await refundHandler(
    {
      ...req,
      method: 'POST',
      headers: { authorization: String(req.headers.authorization ?? ''), 'idempotency-key': idempotencyKey },
      body,
    } as PluginApiRequest,
    res,
  )
  return { status, body: payload }
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

type ReturnEmailKey = 'return-requested' | 'return-approved' | 'return-declined' | 'return-refunded'

async function sendReturnEmail(
  hostId: string,
  key: ReturnEmailKey,
  to: string,
  tokens: Record<string, string>,
  fallback: { subject: string; text: string },
): Promise<void> {
  if (!to || !isEmailConfigured()) return
  try {
    const firestore = firebaseAdmin.app().firestore()
    const designed = await renderHostEmailWithTokens(firestore, hostId, key, tokens)
    const org = await getOrgForHost(hostId).catch(() => null)
    await sendEmail({
      to,
      subject: designed?.subject ?? fallback.subject,
      text: designed?.text || fallback.text,
      ...(designed?.html ? { html: designed.html } : {}),
      fromName: Aglyn.resolveBrandingProfile(org?.org as never).fromName,
      sendingIdentity: await hostSendingIdentity(hostId),
      audience: 'tenant',
      context: key,
      // Owed to the recipient by their own order (AGL-3356).
      owedFor: 'order',
    })
    await meterHostEmail(hostId)
  } catch (error) {
    // A return that is recorded is not undone because its email failed.
    console.error(`[returns] ${key} not sent`, hostId, error)
  }
}

/** Tells the store a buyer asked, in the console and by email to the owner. */
async function tellStoreOfRequest(hostId: string, returnId: string, entry: CommerceModel.HostReturn, order: CommerceModel.HostOrder) {
  const items = returnItemsText(order, entry)
  await notifyHostManagers(
    hostId,
    {
      type: 'content.order',
      title: `Return requested for order ${entry.orderNumber}`,
      body: `${entry.customerEmail ?? 'A buyer'} wants to return ${CommerceModel.describeReturnLines(order, entry.lines)} from order ${entry.orderNumber} on {site}.`,
      link: `/${hostId}/products/returns?return=${encodeURIComponent(returnId)}`,
    },
    { skipOwnerEmail: true },
  ).catch(() => undefined)
  const ownerUid = (await getOrgForHost(hostId).catch(() => null))?.org?.ownerUid
  const owner = ownerUid ? (await findUserByUidAcrossPools(ownerUid).catch(() => null))?.record : null
  if (!owner?.email) return
  await sendReturnEmail(
    hostId,
    'return-requested',
    owner.email,
    {
      'order.number': entry.orderNumber,
      'return.items': items,
      'buyer.email': String(entry.customerEmail ?? ''),
      'return.customerNote': String(entry.customerNote ?? ''),
    },
    {
      subject: `Return requested for order ${entry.orderNumber}`,
      text:
        `${entry.customerEmail ?? 'A buyer'} wants to return items from order ${entry.orderNumber}.\n\n${items}` +
        (entry.customerNote ? `\n\n"${entry.customerNote}"` : '') +
        `\n\nApprove or decline it under Products → Returns.`,
    },
  )
}

/** Tells the buyer what happened to their return. */
async function tellBuyer(
  hostId: string,
  key: Exclude<ReturnEmailKey, 'return-requested'>,
  entry: CommerceModel.HostReturn,
  order: CommerceModel.HostOrder | null,
): Promise<void> {
  const to = String(entry.customerEmail ?? order?.customerEmail ?? '').trim()
  if (!to || !order) return
  const firestore = firebaseAdmin.app().firestore()
  const store = await readStore(firestore, hostId)
  const statusUrl = orderStatusUrl(store.host as never, hostId, entry.orderId) ?? ''
  const items = returnItemsText(order, entry)
  const label = entry.returnLabel
    ? `Print your return label: ${entry.returnLabel.labelUrl}` +
      (entry.returnLabel.trackingNumber ? ` (${[entry.returnLabel.carrier, entry.returnLabel.trackingNumber].filter(Boolean).join(' ')})` : '')
    : ''
  const refundTotal = money(entry.refundCents ?? 0, store.currency)
  const tokens: Record<string, string> = {
    'order.number': entry.orderNumber,
    'return.items': items,
    'return.note': String(entry.merchantNote ?? ''),
    'return.label': label,
    'return.refundTotal': refundTotal,
    'order.statusUrl': statusUrl,
  }
  const fallback =
    key === 'return-approved'
      ? {
          subject: `Your return for order ${entry.orderNumber} is approved`,
          text: `Your return is approved:\n\n${items}` + (entry.merchantNote ? `\n\n${entry.merchantNote}` : '') + (label ? `\n\n${label}` : ''),
        }
      : key === 'return-declined'
        ? {
            subject: `About your return for order ${entry.orderNumber}`,
            text: `We could not accept the return of:\n\n${items}` + (entry.merchantNote ? `\n\n${entry.merchantNote}` : ''),
          }
        : {
            subject: `Your refund for order ${entry.orderNumber}`,
            text: `We received your return and refunded ${refundTotal}.\n\n${items}`,
          }
  if (statusUrl) fallback.text += `\n\nView your order: ${statusUrl}`
  await sendReturnEmail(hostId, key, to, tokens, fallback)
}

// ---------------------------------------------------------------------------
// The buyer's door (tenant)
// ---------------------------------------------------------------------------

/**
 * Whether this request may act for the buyer of this order: the signed-in
 * site member whose email the order carries, or the holder of the order's
 * signed status link. Neither reveals whether the order exists to anyone
 * else — both refusals read the same.
 */
async function buyerMayActFor(
  req: PluginApiRequest,
  hostId: string,
  orderId: string,
  token: string,
  order: CommerceModel.HostOrder,
): Promise<boolean> {
  if (token && verifyOrderStatusToken(hostId, orderId, token)) return true
  const session = await readActiveMemberSession(req, hostId)
  if (session.status !== 'active') return false
  const memberEmail = String(session.member.get('email') ?? '').trim().toLowerCase()
  return Boolean(memberEmail) && memberEmail === String(order.customerEmail ?? '').trim().toLowerCase()
}

/**
 * `GET /api/commerce/return-request?hostId&orderId&t` — what the buyer may
 * send back and until when, and the returns already open.
 * `POST` with `{ hostId, orderId, t?, lines: [{ lineItemId, quantity, reason }], note? }`
 * opens a return.
 */
export const returnRequestHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const input = (req.method === 'GET' ? req.query : typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {}
  const hostId = String(input.hostId ?? '')
  const orderId = String(input.orderId ?? input.o ?? '')
  const token = String(input.t ?? input.token ?? '').slice(0, 100)
  if (!isId(hostId) || !isId(orderId)) return res.status(400).json({ error: 'Missing hostId or orderId' })
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = hostRefFor(firestore, hostId)
    const orderSnapshot = await hostRef.collection('orders').doc(orderId).get()
    const order = orderSnapshot.exists ? CommerceModel.liftLegacyOrder((orderSnapshot.data() ?? {}) as never) : null
    if (!order || !(await buyerMayActFor(req, hostId, orderId, token, order))) {
      return res.status(404).json({ error: 'We could not find that order' })
    }
    if (req.method === 'GET') {
      const [{ returnSettings }, existing] = await Promise.all([
        readStore(firestore, hostId),
        hostRef.collection(RETURNS_COLLECTION).where('orderId', '==', orderId).get(),
      ])
      const returns = existing.docs.map((entry) => ({ id: entry.id, ...(entry.data() as CommerceModel.HostReturn) }))
      const endsAt = CommerceModel.returnWindowEndsAtMs(order, returnSettings)
      return res.status(200).json({
        enabled: returnSettings.enabled,
        windowEndsAtMs: endsAt,
        windowOpen: endsAt === null || Date.now() <= endsAt,
        lines: CommerceModel.returnableLines(order, returns, returnSettings),
        reasons: CommerceModel.RETURN_REASONS.map((reason) => ({ value: reason, label: CommerceModel.RETURN_REASON_LABELS[reason] })),
        returns: returns.map((entry) => ({
          id: entry.id,
          status: entry.status,
          lines: entry.lines,
          createdAtMs: entry.createdAtMs,
          ...(entry.returnLabel ? { returnLabel: { labelUrl: entry.returnLabel.labelUrl, carrier: entry.returnLabel.carrier, trackingNumber: entry.returnLabel.trackingNumber } } : {}),
          ...(entry.status === 'declined' && entry.merchantNote ? { merchantNote: entry.merchantNote } : {}),
        })),
      })
    }
    const outcome = await openReturn({
      hostId,
      orderId,
      lines: Array.isArray(input.lines) ? (input.lines as unknown[]).slice(0, 100) as never : [],
      note: String(input.note ?? ''),
      by: 'buyer',
    })
    if (outcome.outcome === 'no_such_order') return res.status(404).json({ error: 'We could not find that order' })
    if (outcome.outcome === 'refused') return res.status(409).json({ error: outcome.message })
    await tellStoreOfRequest(hostId, outcome.returnId, outcome.entry, outcome.order)
    return res.status(200).json({ ok: true, returnId: outcome.returnId, status: outcome.entry.status })
  } catch (error) {
    console.error('return request failed', error)
    return res.status(500).json({ error: 'Your return could not be requested. Please try again.' })
  }
}

// ---------------------------------------------------------------------------
// The merchant's door (console)
// ---------------------------------------------------------------------------

const MERCHANT_ACTIONS = ['create', 'approve', 'decline', 'close', 'note', 'attach-label', 'receive', 'refund'] as const
type MerchantAction = (typeof MERCHANT_ACTIONS)[number]

/**
 * `POST /api/commerce/returns` with `{ hostId, action, … }`. Admins and
 * editors run the return; the refund goes through the order's refund route,
 * which asks for an admin of the whole workspace on its own.
 */
export const returnsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {}
  const hostId = String(body.hostId ?? '')
  const action = String(body.action ?? '') as MerchantAction
  const returnId = String(body.returnId ?? '')
  if (!isId(hostId)) return res.status(400).json({ error: 'Missing hostId' })
  if (!MERCHANT_ACTIONS.includes(action)) return res.status(400).json({ error: 'Unknown action' })
  if (action !== 'create' && !isId(returnId)) return res.status(400).json({ error: 'Missing returnId' })
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostSnapshot = await hostRefFor(firestore, hostId).get()
    if (!hostSnapshot.exists) return res.status(404).json({ error: 'Unknown site' })
    const role = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (role !== 'admin' && role !== 'editor') return res.status(403).json({ error: 'Not permitted' })

    if (action === 'create') {
      const orderId = String(body.orderId ?? '')
      if (!isId(orderId)) return res.status(400).json({ error: 'Missing orderId' })
      const outcome = await openReturn({
        hostId,
        orderId,
        lines: Array.isArray(body.lines) ? (body.lines as unknown[]).slice(0, 100) as never : [],
        note: String(body.note ?? ''),
        by: 'merchant',
      })
      if (outcome.outcome === 'no_such_order') return res.status(404).json({ error: 'Unknown order' })
      if (outcome.outcome === 'refused') return res.status(409).json({ error: outcome.message })
      if (body.notify !== false) await tellBuyer(hostId, 'return-approved', outcome.entry, outcome.order)
      return res.status(200).json({ ok: true, returnId: outcome.returnId, status: outcome.entry.status })
    }

    if (action === 'receive') {
      const outcome = await receiveReturn({
        hostId,
        returnId,
        restock: Array.isArray(body.restock) ? (body.restock as unknown[]).slice(0, 100) as never : [],
        locationId: body.locationId ? String(body.locationId) : undefined,
      })
      if (outcome.outcome === 'no_such_return') return res.status(404).json({ error: 'Unknown return' })
      if (outcome.outcome === 'refused') return res.status(409).json({ error: outcome.message })
      return res.status(200).json({
        ok: true,
        ...(outcome.outcome === 'already' ? { already: true } : { units: outcome.units ?? 0 }),
        status: outcome.entry.status,
      })
    }

    if (action === 'refund') {
      const returnSnapshot = await hostRefFor(firestore, hostId).collection(RETURNS_COLLECTION).doc(returnId).get()
      if (!returnSnapshot.exists) return res.status(404).json({ error: 'Unknown return' })
      const entry = returnSnapshot.data() as CommerceModel.HostReturn
      if (entry.status === 'refunded' || entry.refundedAtMs) {
        return res.status(200).json({ ok: true, already: true, status: entry.status })
      }
      if (!CommerceModel.canTransitionReturn(entry.status, 'refunded')) {
        return res.status(409).json({ error: `A return that is ${CommerceModel.RETURN_STATUS_LABELS[entry.status].toLowerCase()} cannot be refunded` })
      }
      const orderSnapshot = await hostRefFor(firestore, hostId).collection('orders').doc(entry.orderId).get()
      if (!orderSnapshot.exists) return res.status(404).json({ error: 'The order for this return is gone' })
      const order = CommerceModel.liftLegacyOrder((orderSnapshot.data() ?? {}) as never)
      const suggested = CommerceModel.returnRefundCents(order, entry.lines)
      const amountCents = body.amountCents == null ? suggested : Math.round(Number(body.amountCents))
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        return res.status(400).json({ error: 'The refund amount must be above zero' })
      }
      const wholeLines = CommerceModel.returnWholeLineIds(order, entry.lines).filter(
        (index) => !CommerceModel.orderLineRefunded(order, index),
      )
      const namedWorth = CommerceModel.orderLineRefundCents(order, wholeLines)
      // Lines are named only when the amount covers them in full, which is
      // what the refund route requires before it withdraws a line's
      // entitlements; a smaller amount refunds by amount alone.
      const refund = await callRefundRoute(
        req,
        {
          hostId,
          orderId: entry.orderId,
          amountCents,
          ...(wholeLines.length > 0 && amountCents >= namedWorth ? { lineItemIds: wholeLines } : {}),
        },
        // One refund per return: asking again replays rather than pays twice.
        `return:${hostId}:${returnId}`,
      )
      if (refund.status !== 200) {
        return res.status(refund.status).json({ error: refund.body?.error ?? 'Refund failed' })
      }
      const marked = await markReturnRefunded({ hostId, returnId, refundCents: amountCents, uid: decoded.uid })
      if (marked.outcome === 'changed') {
        await raiseOrderEvent(RETURN_REFUNDED_EVENT, {
          hostId,
          orderId: entry.orderId,
          key: `return-refunded:${returnId}`,
          extra: { return: returnEventView(returnId, marked.entry) },
        })
        await tellBuyer(hostId, 'return-refunded', marked.entry, marked.order)
      }
      return res.status(200).json({ ok: true, refundCents: amountCents, status: 'refunded' })
    }

    const outcome = await changeReturn({
      hostId,
      returnId,
      action: action as ReturnAction,
      ...(body.merchantNote !== undefined ? { merchantNote: String(body.merchantNote) } : {}),
      ...(action === 'attach-label' ? { label: body.label } : {}),
    })
    if (outcome.outcome === 'no_such_return') return res.status(404).json({ error: 'Unknown return' })
    if (outcome.outcome === 'refused') return res.status(409).json({ error: outcome.message })
    if (outcome.outcome === 'changed' && body.notify !== false) {
      if (action === 'approve') await tellBuyer(hostId, 'return-approved', outcome.entry, outcome.order)
      if (action === 'decline') await tellBuyer(hostId, 'return-declined', outcome.entry, outcome.order)
    }
    return res.status(200).json({
      ok: true,
      ...(outcome.outcome === 'already' ? { already: true } : {}),
      status: outcome.entry.status,
    })
  } catch (error) {
    console.error('returns action failed', action, error)
    // Every write here is a transaction or keyed (the refund), so asking
    // again lands once.
    return res.status(500).json({ error: 'The return could not be updated. Retrying is safe.' })
  }
}
