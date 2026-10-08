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
  PluginChannelOrder,
  PluginChannelOrderCancelOutcome,
  PluginChannelOrderFee,
  PluginChannelOrderOutcome,
  PluginChannelOrders,
  PluginChannelOrderShortfall,
} from '@aglyn/aglyn/plugin-manager/plugin-channel-orders'
import { notifyHostManagers } from '@aglyn/tenant-data-admin'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { createHash } from 'node:crypto'
import * as CommerceModel from '../model'
import { ORDER_CANCELLED_EVENT, ORDER_PAID_EVENT } from '../model/order-events'
import { alertLowStockCrossing } from './low-stock'
import { stageOrderEvent } from './order-events'
import { capRestockLines, resolveTrackedRestockLines, saleReleaseCaps } from './restock-flag'

/**
 * ORDERS SOLD ON ANOTHER CHANNEL (AGL-3638): commerce's implementation of
 * core's `core.channel-orders`, which a marketplace plugin records each
 * order it brings in through.
 *
 * ## One transaction, so two channels cannot sell the last unit twice
 *
 * The order, its number, every product's count, every count's ledger row and
 * the `order.paid` event are ONE Firestore transaction. Each product is read
 * with `transaction.get`, which serializes this write with every other sale
 * of that product (the AGL-2320 reasoning): a storefront checkout landing at
 * the same moment decrements from the count this write left, never from the
 * one it read. The marketplace plugin then pushes the new count to every
 * other channel.
 *
 * A marketplace order is already sold and paid when it arrives, so a shelf
 * that cannot cover it does not refuse it: the units the shelf held are
 * taken, the order is recorded whole, and the merchant is told which units
 * are short — the same loud oversell `reserve-stock.ts` raises.
 *
 * ## Once per outside order
 *
 * The order's id is derived from the channel and its order id
 * ({@link channelOrderDocId}), and the transaction refuses to write over an
 * order that exists, so a retried import answers `already` and moves nothing.
 *
 * ## No money moves here
 *
 * The buyer paid the channel. `totals.feeCents` — Aglyn's own take — is 0,
 * the channel's charges are recorded on `channelSource.fees` for the
 * merchant's books, the tax is the channel's to remit, and refunds happen on
 * the channel. No buyer email is sent: a marketplace forbids contacting its
 * buyers outside it, and none of them hands over a real address.
 */

type Firestore = FirebaseFirestore.Firestore

const DOC_ID = /^[A-Za-z0-9_-]{1,200}$/
const CHANNEL_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const MAX_LINES = 250
const MAX_UNITS = 10_000
const MAX_CENTS = 100_000_000_00

/**
 * The order document's id for one outside order: the channel, then a hash of
 * the channel's own id. Deterministic, so a second import of the same order
 * finds the first; hashed, because a channel's id may hold characters a
 * document id may not.
 */
export function channelOrderDocId(channelId: string, externalOrderId: string): string {
  const digest = createHash('sha256').update(`${channelId}\u0000${externalOrderId}`).digest('hex').slice(0, 24)
  return `${channelId}-${digest}`
}

const whole = (value: unknown, max: number): number | null => {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number <= max ? number : null
}

const clip = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max)

/** What a seller refuses before reading anything, in the merchant's words; `null` when the order is well formed. */
export function channelOrderProblem(order: PluginChannelOrder): string | null {
  if (!DOC_ID.test(String(order?.hostId ?? '')) || /^__.*__$/.test(order.hostId)) return 'The order names no site.'
  if (!CHANNEL_ID.test(String(order.channel?.id ?? ''))) return 'The order names no channel.'
  if (!clip(order.externalOrderId, 200)) return 'The order has no id on its channel.'
  if (!/^[A-Za-z]{3}$/.test(String(order.currency ?? ''))) return 'The order names no currency.'
  const lines = Array.isArray(order.lines) ? order.lines : []
  if (!lines.length) return 'The order has no items.'
  if (lines.length > MAX_LINES) return `The order has more than ${MAX_LINES} items.`
  for (const line of lines) {
    if (whole(line?.quantity, MAX_UNITS) === null || Number(line.quantity) < 1) return 'An item of the order has no quantity.'
    if (whole(line?.unitPriceCents, MAX_CENTS) === null) return 'An item of the order has no price.'
    if (!clip(line?.externalLineId, 200)) return 'An item of the order has no id on its channel.'
  }
  for (const amount of [order.shippingCents, order.taxCents, order.discountCents, order.totalCents]) {
    if (whole(amount, MAX_CENTS) === null) return 'The order’s totals are not whole amounts.'
  }
  return null
}

const cleanFees = (fees: readonly PluginChannelOrderFee[] | null | undefined) => {
  if (!Array.isArray(fees)) return { fees: null, totalCents: null }
  const kept = fees
    .map((fee) => ({ label: clip(fee?.label, 80) || 'Fee', amountCents: whole(fee?.amountCents, MAX_CENTS) }))
    .filter((fee): fee is { label: string; amountCents: number } => fee.amountCents !== null)
    .slice(0, 20)
  return { fees: kept, totalCents: kept.reduce((sum, fee) => sum + fee.amountCents, 0) }
}

const address = (value: PluginChannelOrder['shippingAddress']): CommerceModel.OrderAddress | null => {
  if (!value) return null
  const out: CommerceModel.OrderAddress = {}
  for (const key of ['name', 'line1', 'line2', 'city', 'state', 'postalCode', 'country', 'phone'] as const) {
    const text = clip(value[key], 200)
    if (text) out[key] = key === 'country' ? text.toUpperCase() : text
  }
  return Object.keys(out).length ? out : null
}

interface Located {
  productId: string
  variantId: string
}

/** The live variant whose SKU is `sku`, matched without regard to case; `null` when none or several products claim it. */
async function locateSku(firestore: Firestore, hostId: string, sku: string): Promise<Located | null> {
  const wanted = sku.trim().toLowerCase()
  if (!wanted) return null
  const snapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('products')
    .where('skus', 'array-contains', wanted)
    .limit(5)
    .get()
  const found: Located[] = []
  for (const doc of snapshot.docs) {
    if (doc.get('deletedAt')) continue
    const variants = Array.isArray(doc.get('variants')) ? (doc.get('variants') as Array<Record<string, unknown>>) : []
    const variant = variants.find((entry) => String(entry?.['sku'] ?? '').trim().toLowerCase() === wanted && entry?.['id'])
    if (variant) found.push({ productId: doc.id, variantId: String(variant['id']) })
  }
  // Two products sharing a SKU is ambiguous; taking either's stock would be a guess.
  return found.length === 1 ? found[0] : null
}

export interface ChannelOrderDeps {
  firestore: () => Firestore
  now: () => number
}

const defaultDeps = (): ChannelOrderDeps => ({ firestore: () => firebaseAdmin.app().firestore(), now: Date.now })

/** Records one outside order; see the module header. */
export async function importChannelOrder(
  order: PluginChannelOrder,
  deps: ChannelOrderDeps = defaultDeps(),
): Promise<PluginChannelOrderOutcome> {
  const problem = channelOrderProblem(order)
  if (problem) return { outcome: 'refused', reason: problem }
  const firestore = deps.firestore()
  const hostRef = firestore.collection('hosts').doc(order.hostId)
  const orderId = channelOrderDocId(order.channel.id, clip(order.externalOrderId, 200))
  const orderRef = hostRef.collection('orders').doc(orderId)
  const channelLabel = clip(order.channel.label, 60) || order.channel.id

  // Already recorded: answered before any product is looked up.
  const existing = await orderRef.get()
  if (existing.exists) return alreadyOutcome(orderId, existing.data() ?? {})

  const store = await hostRef.collection('settings').doc('store').get()
  const storeCurrency = clip(store.get('currency'), 3).toUpperCase() || 'USD'
  const currency = order.currency.toUpperCase()
  if (currency !== storeCurrency) {
    return {
      outcome: 'refused',
      reason: `This order is in ${currency}, and the store sells in ${storeCurrency}. Ship it from ${channelLabel}.`,
    }
  }

  // Each line's product, found before the transaction (a query cannot run
  // inside one) and checked again inside it, where the stock is decided.
  const located: Array<Located | null> = []
  for (const line of order.lines) {
    const productId = clip(line.productId, 200)
    const variantId = clip(line.variantId, 200)
    if (productId && variantId && DOC_ID.test(productId) && !/^__.*__$/.test(productId)) {
      located.push({ productId, variantId })
    } else {
      located.push(line.sku ? await locateSku(firestore, order.hostId, line.sku) : null)
    }
  }

  const nowMs = deps.now()
  const placedAtMs = Number.isFinite(order.placedAtMs) && order.placedAtMs > 0 ? Math.min(order.placedAtMs, nowMs) : nowMs
  const productIds = [...new Set(located.filter((entry): entry is Located => entry !== null).map((entry) => entry.productId))]
  const crossings: Array<{ before: CommerceModel.HostProduct; after: CommerceModel.HostProduct }> = []

  const result = await firestore.runTransaction(async (transaction) => {
    const counterRef = hostRef.collection('counters').doc('orders')
    const [again, counter, ...productSnaps] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(counterRef),
      ...productIds.map((productId) => transaction.get(hostRef.collection('products').doc(productId))),
    ])
    if (again.exists) return { kind: 'already' as const, data: again.data() ?? {} }
    const products = new Map<string, { before: CommerceModel.HostProduct; current: CommerceModel.HostProduct }>()
    productSnaps.forEach((snapshot, index) => {
      if (!snapshot.exists || snapshot.get('deletedAt')) return
      const lifted = CommerceModel.liftLegacyProduct(snapshot.data() as never)
      products.set(productIds[index], { before: lifted, current: lifted })
    })

    const lineItems: CommerceModel.OrderLineItem[] = []
    const shortfalls: PluginChannelOrderShortfall[] = []
    const unmatched: number[] = []
    const ledger: CommerceModel.InventoryAdjustment[] = []
    order.lines.forEach((line, lineIndex) => {
      const quantity = Number(line.quantity)
      const place = located[lineIndex]
      const held = place ? products.get(place.productId) : undefined
      const variant = held?.current.variants.find((entry) => entry.id === place?.variantId)
      if (!place || !held || !variant) {
        unmatched.push(lineIndex)
        lineItems.push({
          productId: '',
          name: clip(line.name, 200) || clip(line.sku, 120) || 'Item',
          ...(line.sku ? { sku: clip(line.sku, 120) } : {}),
          productType: 'physical',
          quantity,
          unitAmountCents: Number(line.unitPriceCents),
        })
        return
      }
      const product = held.current
      const label = Object.values(variant.options ?? {}).filter(Boolean).join(' / ')
      lineItems.push({
        productId: place.productId,
        variantId: variant.id,
        name: product.name,
        ...(label ? { variantLabel: label } : {}),
        ...(variant.sku ? { sku: variant.sku } : line.sku ? { sku: clip(line.sku, 120) } : {}),
        productType: product.type ?? 'physical',
        quantity,
        unitAmountCents: Number(line.unitPriceCents),
      })
      if (variant.inventory == null) return
      const requested = -quantity
      const applied = CommerceModel.appliedVariantInventoryDelta(product, variant.id, requested)
      const variants = CommerceModel.adjustVariantInventory(product, variant.id, requested)
      held.current = { ...product, variants }
      ledger.push({
        productId: place.productId,
        variantId: variant.id,
        delta: requested,
        ...(applied !== requested ? { appliedDelta: applied } : {}),
        reason: 'sale',
        orderId,
        source: channelLabel,
        atMs: nowMs,
      })
      const short = applied - requested
      if (short > 0 && product.oversellPolicy !== 'backorder') {
        shortfalls.push({ lineIndex, sku: variant.sku ?? line.sku ?? null, short })
      }
    })

    const number = Number(counter.get('next') ?? 1)
    transaction.set(counterRef, { next: number + 1 }, { merge: true })
    for (const [productId, held] of products) {
      if (held.current === held.before) continue
      transaction.set(
        hostRef.collection('products').doc(productId),
        { variants: held.current.variants, ...CommerceModel.productStockFields(held.current), updatedAtMs: nowMs },
        { merge: true },
      )
      crossings.push({ before: held.before, after: held.current })
    }
    for (const row of ledger) transaction.set(hostRef.collection('inventoryAdjustments').doc(createResourceUid()), row)

    const itemsCents = lineItems.reduce((sum, line) => sum + line.unitAmountCents * line.quantity, 0)
    const fees = cleanFees(order.fees)
    const lines = order.lines.map((line, lineIndex) => ({ lineIndex, externalLineId: clip(line.externalLineId, 200) }))
    const externalRef = clip(order.externalRef, 120) || clip(order.externalOrderId, 120)
    const shipTo = address(order.shippingAddress)
    const timeline: CommerceModel.OrderTimelineEvent[] = [
      { atMs: nowMs, event: 'paid', detail: `Sold on ${channelLabel}, order ${externalRef}` },
      ...(unmatched.length
        ? [
            {
              atMs: nowMs,
              event: 'line-unmatched',
              detail:
                `${unmatched.length} ${unmatched.length === 1 ? 'item matches' : 'items match'} no product's SKU, ` +
                'so no stock was taken for ' +
                `${unmatched.length === 1 ? 'it' : 'them'}.`,
            },
          ]
        : []),
      ...(shortfalls.length
        ? [
            {
              atMs: nowMs,
              event: 'oversold',
              detail: `${shortfalls.reduce((sum, entry) => sum + entry.short, 0)} sold beyond what was in stock.`,
            },
          ]
        : []),
    ]
    const data = CommerceModel.withOrderListFields(orderId, {
      number,
      status: 'paid' as const,
      channel: 'marketplace' as const,
      channelSource: {
        channelId: order.channel.id,
        channelLabel,
        externalOrderId: clip(order.externalOrderId, 200),
        externalRef,
        lines,
        currency,
        taxRemittedByChannel: true as const,
        fees: fees.fees,
        feesTotalCents: fees.totalCents,
      },
      lineItems,
      totals: {
        itemsCents,
        shippingCents: Number(order.shippingCents),
        taxCents: Number(order.taxCents),
        discountCents: Number(order.discountCents),
        totalCents: Number(order.totalCents),
        // Aglyn takes nothing from a sale another channel was paid for.
        feeCents: 0,
      },
      timeline,
      livemode: order.testMode !== true,
      customerName: clip(order.customerName, 200) || shipTo?.name || null,
      customerEmail: null,
      ...(shipTo ? { shippingAddress: shipTo } : {}),
      amountCents: Number(order.totalCents),
      feeCents: 0,
      createdAtMs: placedAtMs,
      importedAtMs: nowMs,
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    transaction.set(orderRef, data)
    // The event carries the order as stored, less the sentinel only Firestore can read.
    const { createdAt: _sentinel, ...eventOrder } = data
    stageOrderEvent(transaction, ORDER_PAID_EVENT, { hostId: order.hostId, orderId, key: 'paid', order: eventOrder })
    return { kind: 'created' as const, number, lines, shortfalls, unmatched }
  })

  if (result.kind === 'already') return alreadyOutcome(orderId, result.data)
  const displayRef = CommerceModel.formatOrderNumber({ number: result.number }, orderId)
  for (const crossing of crossings) alertLowStockCrossing(order.hostId, crossing.before, crossing.after)
  const totalLabel = `${(Number(order.totalCents) / 100).toFixed(2)} ${currency}`
  const units = order.lines.reduce((sum, line) => sum + Number(line.quantity), 0)
  void notifyHostManagers(order.hostId, {
    type: 'content.order',
    title: `New ${channelLabel} order on {site} — ${totalLabel}`,
    body:
      `Order ${displayRef} came in from ${channelLabel} (their order ${clip(order.externalRef, 120) || order.externalOrderId}): ` +
      `${units} item${units === 1 ? '' : 's'}, ${totalLabel}. Ship it from the order here and the tracking goes back to ${channelLabel}.`,
    link: `/${order.hostId}/products`,
  })
  if (result.shortfalls.length) {
    const short = result.shortfalls.reduce((sum, entry) => sum + entry.short, 0)
    void notifyHostManagers(order.hostId, {
      type: 'content.lowStock',
      title: `Oversold on ${channelLabel} — order ${displayRef}`,
      body:
        `${channelLabel} sold ${short} unit${short === 1 ? '' : 's'} more than {site} had in stock ` +
        `(order ${displayRef}). Restock ${short === 1 ? 'it' : 'them'}, or cancel the items on ${channelLabel}.`,
      link: `/${order.hostId}/products`,
    })
  }
  return {
    outcome: 'created',
    recordId: orderId,
    displayRef,
    lines: result.lines,
    shortfalls: result.shortfalls,
    unmatched: result.unmatched,
  }
}

function alreadyOutcome(recordId: string, data: Record<string, unknown>): PluginChannelOrderOutcome {
  const source = data['channelSource'] as CommerceModel.OrderChannelSource | undefined
  return {
    outcome: 'already',
    recordId,
    displayRef: CommerceModel.formatOrderNumber({ number: Number(data['number']) || undefined }, recordId),
    lines: Array.isArray(source?.lines) ? source.lines : [],
  }
}

/**
 * The channel canceled an order it sent: the order is cancelled here, and
 * the units its sale took go back on the shelf — bounded by its own ledger,
 * exactly as the console's cancel bounds them. Refuses once anything shipped.
 */
export async function cancelChannelOrder(
  request: { hostId: string; recordId: string; reason: string },
  deps: ChannelOrderDeps = defaultDeps(),
): Promise<PluginChannelOrderCancelOutcome> {
  if (!DOC_ID.test(String(request?.hostId ?? '')) || !DOC_ID.test(String(request?.recordId ?? ''))) {
    return { outcome: 'no_such_record' }
  }
  if (/^__.*__$/.test(request.hostId) || /^__.*__$/.test(request.recordId)) return { outcome: 'no_such_record' }
  const firestore = deps.firestore()
  const hostRef = firestore.collection('hosts').doc(request.hostId)
  const orderRef = hostRef.collection('orders').doc(request.recordId)
  const nowMs = deps.now()
  const outcome = await firestore.runTransaction(async (transaction): Promise<PluginChannelOrderCancelOutcome> => {
    const snapshot = await transaction.get(orderRef)
    if (!snapshot.exists) return { outcome: 'no_such_record' }
    const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
    if (order.channel !== 'marketplace') return { outcome: 'not_cancellable', status: order.status }
    if (order.status === 'cancelled') return { outcome: 'already' }
    if (order.status !== 'paid' || (order.fulfillments ?? []).length) {
      return { outcome: 'not_cancellable', status: order.status }
    }
    const rows = await transaction.get(hostRef.collection('inventoryAdjustments').where('orderId', '==', request.recordId))
    const caps = saleReleaseCaps(rows.docs.filter((row) => row.get('reason') === 'sale'))
    const { lines, products } = await resolveTrackedRestockLines(hostRef as never, order, (ref) => transaction.get(ref))
    const byProduct = new Map<string, CommerceModel.OrderRestockLine[]>()
    for (const line of capRestockLines(lines, caps)) {
      byProduct.set(line.productId, [...(byProduct.get(line.productId) ?? []), line])
    }
    let units = 0
    for (const [productId, productLines] of byProduct) {
      const product = products.get(productId)
      if (!product) continue
      let variants = product.variants
      for (const line of productLines) {
        variants = CommerceModel.adjustVariantInventory({ variants }, line.variantId, line.quantity)
        units += line.quantity
      }
      transaction.update(hostRef.collection('products').doc(productId), {
        variants,
        ...CommerceModel.productStockFields({ ...product, variants }),
        updatedAtMs: nowMs,
      })
      for (const line of productLines) {
        transaction.set(hostRef.collection('inventoryAdjustments').doc(createResourceUid()), {
          productId,
          variantId: line.variantId,
          delta: line.quantity,
          reason: 'cancellation',
          orderId: request.recordId,
          atMs: nowMs,
        } satisfies CommerceModel.InventoryAdjustment)
      }
    }
    const reason = clip(request.reason, 200) || 'Canceled on its channel'
    const patch = {
      status: 'cancelled' as const,
      updatedAtMs: nowMs,
      timeline: CommerceModel.appendOrderEvent(
        order,
        'cancelled',
        units > 0 ? `${reason}. ${units} ${units === 1 ? 'unit' : 'units'} returned to stock.` : reason,
        nowMs,
      ),
    }
    transaction.update(orderRef, patch)
    stageOrderEvent(transaction, ORDER_CANCELLED_EVENT, {
      hostId: request.hostId,
      orderId: request.recordId,
      key: 'cancelled',
      order: { ...(snapshot.data() ?? {}), ...patch },
    })
    return { outcome: 'cancelled', restockedUnits: units }
  })
  return outcome
}

/** The channel's charges on a sale, recorded once it says; a later answer replaces an earlier one. */
export async function recordChannelOrderFees(
  request: { hostId: string; recordId: string; fees: PluginChannelOrderFee[] },
  deps: ChannelOrderDeps = defaultDeps(),
): Promise<'recorded' | 'no_such_record'> {
  if (!DOC_ID.test(String(request?.hostId ?? '')) || !DOC_ID.test(String(request?.recordId ?? ''))) return 'no_such_record'
  if (/^__.*__$/.test(request.hostId) || /^__.*__$/.test(request.recordId)) return 'no_such_record'
  const firestore = deps.firestore()
  const orderRef = firestore.collection('hosts').doc(request.hostId).collection('orders').doc(request.recordId)
  const fees = cleanFees(request.fees)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef)
    const source = snapshot.get('channelSource') as CommerceModel.OrderChannelSource | undefined
    if (!snapshot.exists || snapshot.get('channel') !== 'marketplace' || !source) return 'no_such_record' as const
    transaction.update(orderRef, {
      channelSource: { ...source, fees: fees.fees, feesTotalCents: fees.totalCents },
      updatedAtMs: deps.now(),
    })
    return 'recorded' as const
  })
}

export const commerceChannelOrders: PluginChannelOrders = {
  importOrder: (order) => importChannelOrder(order),
  cancelOrder: (request) => cancelChannelOrder(request),
  recordFees: (request) => recordChannelOrderFees(request),
}
