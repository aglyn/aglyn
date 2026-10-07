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
  PluginShipFromAddress,
  PluginShippableRecord,
  PluginShipmentLine,
  PluginShipmentRecords,
  PluginTrackingOutcome,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { recordOrderShipment } from './fulfill-order'

/**
 * THIS PLUGIN'S ORDERS, AS A SHIPPER SEES THEM (AGL-3612): commerce's
 * implementation of core's `core.shipment-records`, registered from the
 * server declarations so it is there wherever a label is bought or a
 * tracking webhook lands.
 *
 * A label buyer never reads `hosts/{id}/orders` itself. It asks here, and
 * every write it makes is this plugin's own: a shipment through
 * `recordOrderShipment` — the transition rule, the quantity check, the
 * timeline and the buyer's shipped email — and a delivery through the same
 * function's `delivered` door, which sends the delivered email.
 */

const ordersOf = (hostId: string) =>
  firebaseAdmin.app().firestore().collection('hosts').doc(hostId).collection('orders')

/** The statuses a new shipment may be recorded from. */
const SHIPPABLE = new Set(['paid', 'partially_fulfilled'])

function toPluginAddress(
  address: CommerceModel.OrderAddress | undefined,
): PluginShippableRecord['shipTo'] {
  const country = String(address?.country ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return undefined
  return {
    country,
    ...(address?.name ? { name: address.name } : {}),
    ...(address?.line1 ? { line1: address.line1 } : {}),
    ...(address?.line2 ? { line2: address.line2 } : {}),
    ...(address?.city ? { city: address.city } : {}),
    ...(address?.state ? { state: address.state } : {}),
    ...(address?.postalCode ? { postalCode: address.postalCode } : {}),
    ...(address?.phone ? { phone: address.phone } : {}),
  }
}

/** The order as a shippable record, with each line's weight and customs facts. */
export async function readShippableOrder(
  hostId: string,
  orderId: string,
): Promise<PluginShippableRecord | null> {
  if (!hostId || !orderId || /^__.*__$/.test(orderId)) return null
  const snapshot = await ordersOf(hostId).doc(orderId).get()
  if (!snapshot.exists) return null
  const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
  const states = CommerceModel.orderLineFulfillmentStates(order)
  const productIds = [...new Set((order.lineItems ?? []).map((line) => line.productId).filter(Boolean))]
  const products = new Map<string, CommerceModel.HostProduct>()
  await Promise.all(
    productIds.map(async (productId) => {
      const product = await firebaseAdmin
        .app()
        .firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('products')
        .doc(productId)
        .get()
        .catch(() => null)
      if (product?.exists) {
        products.set(productId, CommerceModel.liftLegacyProduct(product.data() as never))
      }
    }),
  )
  const lines: PluginShipmentLine[] = []
  ;(order.lineItems ?? []).forEach((line, index) => {
    const state = states[index]
    if (!state?.requiresShipping) return
    const product = products.get(line.productId)
    const variant = product?.variants.find((one) => one.id === line.variantId) ?? product?.variants[0]
    const facts = product?.shipping
    const dims = CommerceModel.productParcelDimensions(product)
    lines.push({
      lineIndex: index,
      name: [line.name, line.variantLabel].filter(Boolean).join(' — ') || 'Item',
      ...(line.sku ? { sku: line.sku } : {}),
      quantity: state.quantity,
      quantityUnshipped: state.remainingQuantity,
      unitValueCents: Math.max(0, Math.round(Number(line.unitAmountCents ?? 0))),
      ...(Number(variant?.weightGrams) > 0 ? { weightGrams: Number(variant?.weightGrams) } : {}),
      ...(dims ?? {}),
      ...(facts?.hsCode ? { hsCode: facts.hsCode } : {}),
      ...(facts?.originCountry ? { originCountry: facts.originCountry } : {}),
    })
  })
  return {
    hostId,
    recordId: orderId,
    displayRef: order.number ? `#${order.number}` : `#${orderId.slice(0, 8)}`,
    status: order.status,
    shippable: SHIPPABLE.has(order.status),
    currency: 'usd',
    ...(toPluginAddress(order.shippingAddress)
      ? {
          shipTo: {
            ...toPluginAddress(order.shippingAddress),
            ...(!order.shippingAddress?.name && order.customerName ? { name: order.customerName } : {}),
          } as NonNullable<PluginShippableRecord['shipTo']>,
        }
      : {}),
    ...(order.customerEmail ? { customerEmail: order.customerEmail } : {}),
    lines,
    shipments: (order.fulfillments ?? [])
      .filter((fulfillment) => CommerceModel.fulfillmentIsActive(fulfillment))
      .map((fulfillment) => ({
        id: fulfillment.id,
        ...(fulfillment.carrier ? { carrier: fulfillment.carrier } : {}),
        ...(fulfillment.trackingNumber ? { trackingNumber: fulfillment.trackingNumber } : {}),
        ...(fulfillment.trackingUrl ? { trackingUrl: fulfillment.trackingUrl } : {}),
        ...(fulfillment.labelRef ? { labelRef: fulfillment.labelRef } : {}),
        lineIndexes: fulfillment.lineItemIds ?? [],
        atMs: fulfillment.atMs,
      })),
    ...(order.createdAtMs ? { createdAtMs: order.createdAtMs } : {}),
  }
}

/**
 * Records what the carrier says on the shipment it is about, once, and
 * moves the order to delivered when every parcel of a fully shipped order
 * has arrived — through `recordOrderShipment`, so the buyer's delivered email
 * is this plugin's to send.
 */
export async function recordShipmentTracking(update: {
  hostId: string
  recordId: string
  trackingNumber: string
  status: string
  detail?: string
  atMs: number
}): Promise<PluginTrackingOutcome> {
  const orderRef = ordersOf(update.hostId).doc(update.recordId)
  const result = await firebaseAdmin
    .app()
    .firestore()
    .runTransaction(async (transaction) => {
      const snapshot = await transaction.get(orderRef)
      if (!snapshot.exists) return { outcome: 'no_such_record' as const }
      const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
      const fulfillments = [...(order.fulfillments ?? [])]
      const index = fulfillments.findIndex(
        (fulfillment) =>
          CommerceModel.fulfillmentIsActive(fulfillment) &&
          String(fulfillment.trackingNumber ?? '').trim().toUpperCase() ===
            update.trackingNumber.trim().toUpperCase(),
      )
      if (index < 0) return { outcome: 'no_such_shipment' as const }
      if (fulfillments[index].trackingStatus === update.status) {
        return { outcome: 'unchanged' as const, order, fulfillments }
      }
      fulfillments[index] = {
        ...fulfillments[index],
        trackingStatus: update.status,
        trackingStatusAtMs: update.atMs,
      }
      transaction.update(orderRef, {
        fulfillments,
        timeline: CommerceModel.appendOrderEvent(
          order,
          'tracking',
          [CommerceModel.trackingStatusLabel(update.status), update.detail].filter(Boolean).join(': ').slice(0, 300),
          update.atMs,
        ),
      })
      return { outcome: 'recorded' as const, order, fulfillments }
    })
  if (result.outcome === 'no_such_record' || result.outcome === 'no_such_shipment') {
    return { outcome: result.outcome }
  }
  const everyDelivered = result.fulfillments
    .filter((fulfillment) => CommerceModel.fulfillmentIsActive(fulfillment) && fulfillment.trackingNumber)
    .every((fulfillment) => fulfillment.trackingStatus === 'delivered')
  if (update.status === 'delivered' && everyDelivered && result.order.status === 'fulfilled') {
    await recordOrderShipment({ hostId: update.hostId, orderId: update.recordId, to: 'delivered' })
  }
  return { outcome: result.outcome }
}

/** The site's locations that have a postal address complete enough to ship from. */
export async function readShipFromAddresses(hostId: string): Promise<PluginShipFromAddress[]> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('locations')
    .limit(50)
    .get()
  const places: PluginShipFromAddress[] = []
  for (const doc of snapshot.docs) {
    const location = doc.data() as CommerceModel.InventoryLocation
    const address = CommerceModel.normalizePostalAddress(location.postalAddress)
    if (!address?.country || !address.line1 || !address.city || !address.postalCode) continue
    places.push({
      id: doc.id,
      name: String(location.name ?? 'Location'),
      address: { ...address, country: address.country, name: String(location.name ?? '') },
    })
  }
  return places.sort((a, b) => a.name.localeCompare(b.name))
}

export const commerceShipmentRecords: PluginShipmentRecords = {
  read: readShippableOrder,
  async recordShipment(write) {
    const outcome = await recordOrderShipment({
      hostId: write.hostId,
      orderId: write.recordId,
      to: 'fulfilled',
      carrier: write.carrier,
      trackingNumber: write.trackingNumber,
      ...(write.lines?.length
        ? { lineItems: write.lines.map((line) => ({ lineItemId: line.lineIndex, quantity: line.quantity })) }
        : {}),
      ...(write.trackingUrl ? { trackingUrl: write.trackingUrl } : {}),
      ...(write.labelUrl ? { labelUrl: write.labelUrl } : {}),
      ...(write.labelRef ? { labelRef: write.labelRef, idempotencyKey: `label:${write.labelRef}` } : {}),
    })
    switch (outcome.outcome) {
      case 'recorded':
        return { outcome: 'recorded', shipmentId: outcome.fulfillment?.id ?? '' }
      case 'already':
        return { outcome: 'already', ...(outcome.fulfillment ? { shipmentId: outcome.fulfillment.id } : {}) }
      case 'no_such_order':
        return { outcome: 'no_such_record' }
      case 'blocked':
        return { outcome: 'blocked', from: outcome.from }
      default:
        return { outcome: 'blocked', from: 'invalid', reason: outcome.message }
    }
  },
  recordTracking: recordShipmentTracking,
  shipFromAddresses: readShipFromAddresses,
}
