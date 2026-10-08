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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import type {
  PluginChannelOrderHandoff,
  PluginChannelOrderHandoffOutcome,
  PluginChannelOrderRefund,
  PluginChannelOrderRefundOutcome,
} from '@aglyn/aglyn/plugin-manager/plugin-channel-orders'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import * as CommerceModel from '../model'
import { ORDER_FULFILLED_EVENT, ORDER_REFUNDED_EVENT } from '../model/order-events'
import { createHash } from 'node:crypto'
import { fulfillmentEventView, stageOrderEvent } from './order-events'
import { restockCapKey, saleReleaseCaps } from './restock-flag'

/**
 * WHAT A CHANNEL SAYS AFTER ITS ORDER CAME IN (AGL-3644): commerce's half of
 * `completeOrder` and `recordRefund` on core's `core.channel-orders`.
 *
 * A delivery app's order is handed to its own courier over the counter, and
 * the app — not the store — refunds its buyer or takes an item off the order.
 * So, for an order the channel sent (`channel: 'marketplace'`):
 *
 * - **A hand-off** closes the order as fulfilled with one fulfillment for
 *   every unit still open, carrying the channel as its carrier and no
 *   tracking: nothing was shipped from here. Keyed, so a second report of the
 *   same pickup writes nothing.
 * - **A refund or adjustment** is RECORDED: `refundedCents` grows by the
 *   amount (never past the order's total), the order is `refunded` once the
 *   whole of it is, and the channel's id for it is kept so the same report
 *   twice records once. No money moves: the channel refunded its own buyer.
 *   Units the channel names as never having left go back on the shelf, at
 *   most what the order's own sale took less what was already put back —
 *   the ledger bound the console's cancel uses.
 *
 * Each is ONE transaction that reads the order (and, for a restock, each
 * product) before it writes, and stages its order event in the same write.
 */

type Firestore = FirebaseFirestore.Firestore

const DOC_ID = /^[A-Za-z0-9_-]{1,200}$/
const MAX_CENTS = 100_000_000_00
const HANDOFF_KEY = 'channel-handoff'
/** Refund ids kept on an order: far more than any channel sends for one. */
const MAX_REFUND_IDS = 100

const restockKey = restockCapKey

/** The hand-off's fulfillment id: one per order, so a second report finds the first. */
const handoffFulfillmentId = (orderId: string) =>
  `f-${createHash('sha256').update(`${orderId}:${HANDOFF_KEY}`).digest('hex').slice(0, 20)}`

export interface ChannelOrderUpdateDeps {
  firestore: () => Firestore
  now: () => number
}

const defaultDeps = (): ChannelOrderUpdateDeps => ({ firestore: () => firebaseAdmin.app().firestore(), now: Date.now })

const clip = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max)

const validIds = (hostId: unknown, recordId: unknown): boolean =>
  DOC_ID.test(String(hostId ?? '')) &&
  DOC_ID.test(String(recordId ?? '')) &&
  !/^__.*__$/.test(String(hostId)) &&
  !/^__.*__$/.test(String(recordId))

/** The channel's courier took the order: every open unit is fulfilled, with nothing shipped from here. */
export async function completeChannelOrder(
  request: PluginChannelOrderHandoff,
  deps: ChannelOrderUpdateDeps = defaultDeps(),
): Promise<PluginChannelOrderHandoffOutcome> {
  if (!validIds(request?.hostId, request?.recordId)) return { outcome: 'no_such_record' }
  const firestore = deps.firestore()
  const orderRef = firestore.collection('hosts').doc(request.hostId).collection('orders').doc(request.recordId)
  const nowMs = deps.now()
  const fulfillmentId = handoffFulfillmentId(request.recordId)
  return firestore.runTransaction(async (transaction): Promise<PluginChannelOrderHandoffOutcome> => {
    const snapshot = await transaction.get(orderRef)
    if (!snapshot.exists) return { outcome: 'no_such_record' }
    const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
    if (order.channel !== 'marketplace' || !order.channelSource) return { outcome: 'not_completable', status: order.status }
    if ((order.fulfillments ?? []).some((entry) => entry.id === fulfillmentId)) return { outcome: 'already' }
    if (order.status === 'fulfilled' || order.status === 'delivered') return { outcome: 'already' }
    if (!CommerceModel.canTransitionOrder(order.status, 'fulfilled')) {
      return { outcome: 'not_completable', status: order.status }
    }
    let lines = CommerceModel.remainingFulfillmentLines(order)
    if (!lines.length) {
      lines = CommerceModel.orderLineFulfillmentStates(order)
        .filter((state) => state.remainingQuantity > 0)
        .map((state) => ({ lineItemId: state.lineItemId, quantity: state.remainingQuantity }))
    }
    const carrier = clip(order.channelSource.channelLabel, 40) || 'Courier'
    const fulfillment: CommerceModel.OrderFulfillment = {
      id: fulfillmentId,
      lineItemIds: lines.map((entry) => entry.lineItemId),
      lines,
      carrier,
      status: 'active',
      // The channel tells its own buyer; nobody is emailed from here.
      notify: false,
      atMs: nowMs,
    }
    const patch = {
      status: 'fulfilled' as const,
      fulfillments: [...(order.fulfillments ?? []), fulfillment],
      updatedAtMs: nowMs,
      timeline: CommerceModel.appendOrderEvent(
        order,
        'fulfilled',
        clip(request.note, 200) || `Picked up by the ${carrier} courier`,
        nowMs,
      ),
    }
    transaction.update(orderRef, patch)
    stageOrderEvent(transaction, ORDER_FULFILLED_EVENT, {
      hostId: request.hostId,
      orderId: request.recordId,
      key: fulfillment.id,
      order: { ...(snapshot.data() ?? {}), ...patch },
      extra: { fulfillment: fulfillmentEventView(order, fulfillment) },
    })
    return { outcome: 'completed' }
  })
}

/**
 * What the order's sale took off each shelf, less what has gone back since
 * (a cancel's or an earlier adjustment's rows): the most a restock may still
 * return, by product and variant.
 */
function remainingReleaseCaps(rows: readonly { get: (field: string) => unknown }[]): Map<string, number> {
  const caps = saleReleaseCaps(rows.filter((row) => row.get('reason') === 'sale'))
  for (const row of rows) {
    const reason = row.get('reason')
    if (reason !== 'refund' && reason !== 'cancellation') continue
    const delta = Number(row.get('appliedDelta') ?? row.get('delta') ?? 0)
    if (!(delta > 0)) continue
    const key = restockKey(String(row.get('productId') ?? ''), String(row.get('variantId') ?? ''))
    if (caps.has(key)) caps.set(key, Math.max(0, (caps.get(key) ?? 0) - delta))
  }
  return caps
}

/** The channel refunded its buyer or took items off the order: recorded once, with the named units back on the shelf. */
export async function recordChannelOrderRefund(
  request: PluginChannelOrderRefund,
  deps: ChannelOrderUpdateDeps = defaultDeps(),
): Promise<PluginChannelOrderRefundOutcome> {
  if (!validIds(request?.hostId, request?.recordId)) return { outcome: 'no_such_record' }
  const refundId = clip(request.refundId, 200)
  if (!refundId) return { outcome: 'refused', reason: 'The refund has no id on its channel.' }
  const amount = Number(request.amountCents)
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_CENTS) {
    return { outcome: 'refused', reason: 'The refund is not a whole amount.' }
  }
  const asked = (Array.isArray(request.restock) ? request.restock : [])
    .map((entry) => ({ lineIndex: Number(entry?.lineIndex), quantity: Number(entry?.quantity) }))
    .filter((entry) => Number.isInteger(entry.lineIndex) && entry.lineIndex >= 0 && Number.isInteger(entry.quantity) && entry.quantity > 0)
  if (amount === 0 && !asked.length) return { outcome: 'refused', reason: 'The refund moves no money and no stock.' }

  const firestore = deps.firestore()
  const hostRef = firestore.collection('hosts').doc(request.hostId)
  const orderRef = hostRef.collection('orders').doc(request.recordId)
  const nowMs = deps.now()
  return firestore.runTransaction(async (transaction): Promise<PluginChannelOrderRefundOutcome> => {
    const snapshot = await transaction.get(orderRef)
    if (!snapshot.exists) return { outcome: 'no_such_record' }
    const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
    const source = order.channelSource
    if (order.channel !== 'marketplace' || !source) return { outcome: 'no_such_record' }
    if ((source.refundIds ?? []).includes(refundId)) return { outcome: 'already' }

    // Every read before any write: the ledger, then each product a restock touches.
    const lineItems = order.lineItems ?? []
    const wanted = new Map<number, number>()
    for (const entry of asked) {
      const line = lineItems[entry.lineIndex]
      if (!line?.productId || !line.variantId || /^__.*__$/.test(line.productId)) continue
      wanted.set(entry.lineIndex, Math.min(Number(line.quantity) || 0, (wanted.get(entry.lineIndex) ?? 0) + entry.quantity))
    }
    const rows = wanted.size
      ? (await transaction.get(hostRef.collection('inventoryAdjustments').where('orderId', '==', request.recordId))).docs
      : []
    const caps = remainingReleaseCaps(rows)
    const productIds = [...new Set([...wanted.keys()].map((index) => lineItems[index].productId))]
    const productSnaps = await Promise.all(productIds.map((id) => transaction.get(hostRef.collection('products').doc(id))))
    const products = new Map<string, CommerceModel.HostProduct>()
    productSnaps.forEach((product, index) => {
      if (product.exists && !product.get('deletedAt')) {
        products.set(productIds[index], CommerceModel.liftLegacyProduct(product.data() as never))
      }
    })

    let restockedUnits = 0
    const restockedLines: number[] = []
    const ledger: CommerceModel.InventoryAdjustment[] = []
    const changed = new Set<string>()
    for (const [lineIndex, quantity] of wanted) {
      const line = lineItems[lineIndex]
      const product = products.get(line.productId)
      const variantId = String(line.variantId)
      const variant = product?.variants.find((entry) => entry.id === variantId)
      if (!product || !variant || variant.inventory == null) continue
      const key = restockKey(line.productId, variantId)
      // A pair the ledger never recorded a sale for gave up nothing to return.
      const budget = caps.get(key) ?? 0
      const back = Math.min(quantity, budget)
      if (back <= 0) continue
      caps.set(key, budget - back)
      products.set(line.productId, {
        ...product,
        variants: CommerceModel.adjustVariantInventory(product, variantId, back),
      })
      changed.add(line.productId)
      restockedUnits += back
      restockedLines.push(lineIndex)
      ledger.push({
        productId: line.productId,
        variantId,
        delta: back,
        reason: 'refund',
        orderId: request.recordId,
        source: source.channelLabel,
        atMs: nowMs,
      })
    }

    const total = Number(order.totals?.totalCents ?? order.amountCents ?? 0)
    const before = Number(order.refundedCents ?? 0)
    const recorded = Math.max(0, Math.min(amount, total - before))
    const refundedCents = before + recorded
    const full = total > 0 && refundedCents >= total
    let status = order.status
    if (full && status !== 'refunded' && CommerceModel.canTransitionOrder(status, 'refunded')) status = 'refunded'

    for (const productId of changed) {
      const product = products.get(productId) as CommerceModel.HostProduct
      transaction.update(hostRef.collection('products').doc(productId), {
        variants: product.variants,
        ...CommerceModel.productStockFields(product),
        updatedAtMs: nowMs,
      })
    }
    for (const row of ledger) transaction.set(hostRef.collection('inventoryAdjustments').doc(createResourceUid()), row)

    const money = (cents: number) => `${(cents / 100).toFixed(2)} ${source.currency}`
    const reason = clip(request.reason, 200) || `Refunded on ${source.channelLabel}`
    const parts = [
      recorded > 0 ? `${reason}: ${money(recorded)} refunded by ${source.channelLabel}` : reason,
      ...(recorded < amount ? [`${money(amount - recorded)} more than the order had left was not recorded`] : []),
      ...(restockedUnits > 0 ? [`${restockedUnits} ${restockedUnits === 1 ? 'unit' : 'units'} returned to stock`] : []),
    ]
    const patch = {
      status,
      refundedCents,
      channelSource: { ...source, refundIds: [...(source.refundIds ?? []), refundId].slice(-MAX_REFUND_IDS) },
      updatedAtMs: nowMs,
      timeline: CommerceModel.appendOrderEvent(order, 'refund', `${parts.join('. ')}.`, nowMs),
    }
    transaction.update(orderRef, patch)
    if (recorded > 0) {
      stageOrderEvent(transaction, ORDER_REFUNDED_EVENT, {
        hostId: request.hostId,
        orderId: request.recordId,
        key: `refund:channel:${refundId}`,
        order: { ...(snapshot.data() ?? {}), ...patch },
        extra: { refund: { id: null, amountCents: recorded, lineItemIds: restockedLines, full } },
      })
    }
    return { outcome: 'recorded', refundedCents, restockedUnits }
  })
}
