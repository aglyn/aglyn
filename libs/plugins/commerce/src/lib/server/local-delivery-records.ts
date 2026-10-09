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

import { resolveHostToken, type HostTokenSource } from '@aglyn/aglyn/app-utils/host-tokens'
import { normalizePhone } from '@aglyn/aglyn/foundation/definitions/contact.types'
import type {
  PluginLocalDeliveryPlace,
  PluginLocalDeliveryRecord,
  PluginLocalDeliveryRecords,
  PluginRecordCourier,
  PluginRecordCourierOutcome,
  PluginRecordCourierWrite,
} from '@aglyn/aglyn/plugin-manager/plugin-local-deliveries'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { moveLocalFulfillment, type LocalFulfillmentAction } from './local-fulfillment-status'
import { notifyOrderBuyer } from './order-notifications'

/**
 * THIS PLUGIN'S LOCAL DELIVERIES, AS A COURIER SEES THEM (AGL-3695):
 * commerce's implementation of core's `core.local-delivery-records`,
 * registered from the server declarations so it is there wherever a courier
 * is booked or a courier's webhook lands.
 *
 * A courier plugin never reads `hosts/{id}/orders`. It reads a drop here —
 * the location it leaves from, the buyer's door, the window — and writes the
 * run back here, and every step it brings goes through `moveLocalFulfillment`:
 * the same transition rule, timeline, handover and buyer messages as the
 * store's own driver, so "Delivered" by a courier fulfills the order exactly
 * as "Delivered" from the queue does.
 */

const firestore = () => firebaseAdmin.app().firestore()
const hostRef = (hostId: string) => firestore().collection('hosts').doc(hostId)

const badId = (value: string) => !value || value.includes('/') || /^__.*__$/.test(value)

/** The order statuses a courier may be sent from. */
const DISPATCHABLE_ORDER = new Set(['paid', 'partially_fulfilled', 'fulfilled'])
/** The delivery statuses a courier may be sent from: not yet out, or a failed drop going out again. */
const DISPATCHABLE_DELIVERY = new Set(['scheduled', 'failed'])

const COURIER_STATES = new Set([
  'requested',
  'assigned',
  'at_pickup',
  'picked_up',
  'at_dropoff',
  'delivered',
  'cancelled',
  'returning',
  'returned',
])

const text = (value: unknown, max = 200): string => String(value ?? '').trim().slice(0, max)

function place(
  name: string,
  address: CommerceModel.OrderAddress | CommerceModel.PostalAddress | undefined,
  fallbackCountry: string,
  phone: unknown,
  instructions?: string,
): PluginLocalDeliveryPlace | null {
  const line1 = text(address?.line1, 120)
  const postalCode = text(address?.postalCode, 20)
  const country = text(address?.country || fallbackCountry, 2).toUpperCase()
  if (!line1 || !postalCode || !/^[A-Z]{2}$/.test(country)) return null
  const e164 = normalizePhone(text(phone, 40) || null, country)
  return {
    name: text(name, 80) || 'Store',
    address: {
      country,
      line1,
      postalCode,
      ...(address?.line2 ? { line2: text(address.line2, 120) } : {}),
      ...(address?.city ? { city: text(address.city, 80) } : {}),
      ...(address?.state ? { state: text(address.state, 40) } : {}),
    },
    ...(e164 ? { phone: e164 } : {}),
    ...(instructions ? { instructions: text(instructions, 300) } : {}),
  }
}

/** The stored run, read defensively; `null` when the order carries none. */
export function readOrderCourier(value: unknown): PluginRecordCourier | null {
  const raw = (value ?? null) as Record<string, unknown> | null
  if (!raw || !COURIER_STATES.has(String(raw['state'])) || !text(raw['provider'])) return null
  const number = (field: string) => {
    const parsed = Number(raw[field])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
  const etaMs = number('etaMs')
  const pickupEtaMs = number('pickupEtaMs')
  return {
    provider: text(raw['provider'], 40),
    providerLabel: text(raw['providerLabel'], 40) || text(raw['provider'], 40),
    deliveryRef: text(raw['deliveryRef'], 120),
    state: raw['state'] as PluginRecordCourier['state'],
    ...(text(raw['trackingUrl'], 500) ? { trackingUrl: text(raw['trackingUrl'], 500) } : {}),
    ...(etaMs ? { etaMs } : {}),
    ...(pickupEtaMs ? { pickupEtaMs } : {}),
    ...(text(raw['reason'], 300) ? { reason: text(raw['reason'], 300) } : {}),
    ...(raw['testMode'] === true ? { testMode: true } : {}),
    updatedAtMs: Number(raw['updatedAtMs']) || 0,
  }
}

/** The run as it is stored on the order: only the fields the order keeps, nothing undefined. */
function storedCourier(courier: PluginRecordCourier): CommerceModel.OrderLocalDeliveryCourier {
  const read = readOrderCourier(courier)
  if (!read) throw new Error('Not a courier run')
  return read as CommerceModel.OrderLocalDeliveryCourier
}

/** One local delivery, or `null` when there is none by that id. */
export async function readLocalDeliveryRecord(
  hostId: string,
  recordId: string,
): Promise<PluginLocalDeliveryRecord | null> {
  if (badId(hostId) || badId(recordId)) return null
  const [orderSnapshot, hostSnapshot, settingsSnapshot] = await Promise.all([
    hostRef(hostId).collection('orders').doc(recordId).get(),
    hostRef(hostId).get(),
    hostRef(hostId).collection('settings').doc('store').get(),
  ])
  if (!orderSnapshot.exists) return null
  const order = CommerceModel.liftLegacyOrder((orderSnapshot.data() ?? {}) as never)
  const delivery = order.localDelivery
  if (order.fulfillmentMethod !== 'local_delivery' || !delivery) return null

  const storeName =
    String(resolveHostToken('businessName', hostSnapshot.data() as HostTokenSource) ?? '') || 'Store'
  const settings = CommerceModel.normalizeLocalDeliverySettings(settingsSnapshot.get('localDelivery'))
  // Where it leaves from: the location the order names, else the one the
  // delivery settings name, else the store's default location.
  const locationId = String(delivery.locationId || settings.locationId || '')
  let location: CommerceModel.InventoryLocation | null = null
  if (locationId && !badId(locationId)) {
    const snapshot = await hostRef(hostId).collection('locations').doc(locationId).get()
    location = snapshot.exists ? (snapshot.data() as CommerceModel.InventoryLocation) : null
  }
  if (!location) {
    const fallback = await hostRef(hostId).collection('locations').where('isDefault', '==', true).limit(1).get()
    location = fallback.empty ? null : (fallback.docs[0].data() as CommerceModel.InventoryLocation)
  }
  const pickupAddress = CommerceModel.normalizePostalAddress(location?.postalAddress)
  const homeCountry = text(pickupAddress?.country, 2) || 'US'
  const pickup = pickupAddress
    ? place(
        location?.name ? `${storeName} — ${location.name}` : storeName,
        pickupAddress,
        homeCountry,
        pickupAddress.phone,
        location?.pickup?.instructions,
      )
    : null
  const shipTo = order.shippingAddress
  const dropoff = shipTo
    ? place(
        shipTo.name || order.customerName || 'Customer',
        shipTo,
        homeCountry,
        order.customerPhone || shipTo.phone,
      )
    : null
  const status = CommerceModel.orderLocalDeliveryStatus(delivery.status)
  const states = CommerceModel.orderLineFulfillmentStates(order)
  const itemCount = states.reduce((sum, state) => sum + Math.max(0, state.quantity), 0)
  return {
    hostId,
    recordId,
    displayRef: CommerceModel.formatOrderNumber(order, recordId),
    sellerStatus: order.status,
    status,
    dispatchable: DISPATCHABLE_ORDER.has(order.status) && DISPATCHABLE_DELIVERY.has(status),
    currency: String(settingsSnapshot.get('currency') ?? 'usd').toLowerCase(),
    valueCents: Math.max(0, Math.round(Number(order.totals?.itemsCents ?? order.amountCents ?? 0)) || 0),
    itemCount,
    pickup,
    dropoff,
    ...(delivery.windowStartMs ? { windowStartMs: delivery.windowStartMs } : {}),
    ...(delivery.windowEndMs ? { windowEndMs: delivery.windowEndMs } : {}),
    testMode: CommerceModel.orderIsTestMode({
      checkoutSessionId: order.checkoutSessionId,
      livemode: (order as unknown as { livemode?: unknown }).livemode,
      $id: recordId,
    }),
    courier: readOrderCourier(delivery.courier),
  }
}

const sameCourier = (a: PluginRecordCourier | null, b: PluginRecordCourier | null): boolean => {
  if (!a || !b) return a === b
  return (
    a.provider === b.provider &&
    a.deliveryRef === b.deliveryRef &&
    a.state === b.state &&
    (a.trackingUrl ?? '') === (b.trackingUrl ?? '') &&
    (a.etaMs ?? 0) === (b.etaMs ?? 0) &&
    (a.pickupEtaMs ?? 0) === (b.pickupEtaMs ?? 0) &&
    (a.reason ?? '') === (b.reason ?? '')
  )
}

const MOVE_ACTION: Record<NonNullable<PluginRecordCourierWrite['move']>, LocalFulfillmentAction> = {
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed: 'delivery_failed',
}

/**
 * Writes the run onto the order — one transaction that re-reads it, so two
 * webhooks racing cannot interleave — then takes the step it brings through
 * `moveLocalFulfillment`, which re-asks the transition itself. A repeat of a
 * run the order already shows writes nothing, and a step the order already
 * took answers `already` there, so a redelivered webhook is a no-op.
 */
export async function recordLocalDeliveryCourier(
  write: PluginRecordCourierWrite,
  nowMs: number = Date.now(),
): Promise<PluginRecordCourierOutcome> {
  const { hostId, recordId } = write
  if (badId(hostId) || badId(recordId)) return { outcome: 'no_such_record' }
  const courier = write.courier ? storedCourier(write.courier) : null
  const orderRef = hostRef(hostId).collection('orders').doc(recordId)
  const written = await firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef)
    if (!snapshot.exists) return { outcome: 'no_such_record' as const }
    const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
    const delivery = order.localDelivery
    if (order.fulfillmentMethod !== 'local_delivery' || !delivery) return { outcome: 'not_local_delivery' as const }
    const before = readOrderCourier(delivery.courier)
    const status = CommerceModel.orderLocalDeliveryStatus(delivery.status)
    if (sameCourier(before, courier as PluginRecordCourier | null)) return { outcome: 'unchanged' as const, status }
    const next: CommerceModel.OrderLocalDelivery = { ...delivery, updatedAtMs: nowMs }
    if (courier) next.courier = courier
    else delete next.courier
    const stateChanged = (before?.state ?? null) !== (courier?.state ?? null) || before?.deliveryRef !== courier?.deliveryRef
    const timeline = stateChanged
      ? CommerceModel.appendOrderEvent(
          order,
          'courier',
          courier
            ? [
                `${courier.providerLabel}: ${CommerceModel.ORDER_COURIER_STATE_LABELS[courier.state]}`,
                courier.testMode ? '(test)' : '',
                courier.reason ? `— ${courier.reason}` : '',
              ]
                .filter(Boolean)
                .join(' ')
                .slice(0, 300)
            : `${before?.providerLabel ?? 'Courier'} canceled; the store delivers`,
          nowMs,
        )
      : order.timeline
    transaction.update(orderRef, {
      localDelivery: next,
      ...(stateChanged ? { timeline } : {}),
      updatedAtMs: nowMs,
    })
    return { outcome: 'recorded' as const, status }
  })
  if (written.outcome === 'no_such_record' || written.outcome === 'not_local_delivery') return written
  if (!write.move) return written
  const moved = await moveLocalFulfillment({
    hostId,
    orderId: recordId,
    action: MOVE_ACTION[write.move],
    ...(write.reason ? { reason: write.reason } : {}),
    nowMs,
  })
  if (moved.outcome === 'updated') {
    // After the write, never inside it, and never failing it (AGL-3610).
    if (moved.notify) await notifyOrderBuyer({ hostId, orderId: recordId }, moved.notify)
    return { outcome: 'recorded', status: write.move }
  }
  if (moved.outcome === 'already') {
    return written.outcome === 'unchanged' ? written : { outcome: 'recorded', status: write.move }
  }
  if (moved.outcome === 'blocked') return { outcome: 'blocked', from: moved.from }
  if (moved.outcome === 'no_such_order') return { outcome: 'no_such_record' }
  return { outcome: 'not_local_delivery' }
}

export const commerceLocalDeliveryRecords: PluginLocalDeliveryRecords = {
  read: (hostId, recordId) => readLocalDeliveryRecord(hostId, recordId),
  recordCourier: (write) => recordLocalDeliveryCourier(write),
}
