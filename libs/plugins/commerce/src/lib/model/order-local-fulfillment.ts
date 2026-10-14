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

/**
 * How an order reaches its buyer when it does not travel by carrier
 * (AGL-3624): picked up at one of the store's locations, or taken there by the
 * store's OWN driver. Marketplace delivery apps (AGL-3644) are a different
 * thing — an outside courier the delivery-apps plugin books — and never write
 * these fields.
 *
 * Pure and import-free, because the native apps read the same order document
 * (`tools/scripts/mobile-pure-modules.json`): the statuses, their labels, the
 * transitions and the fields the pickup and delivery lists query by are one
 * answer on every platform.
 */

/** A location's pickup offer (`hosts/{hostId}/locations/{id}.pickup`). */
export interface PickupLocationSettings {
  enabled?: boolean
  /** Pickup hours, one line per set of days: `Mo-Fr 09:00-17:00`. */
  hours?: string
  /** What the buyer does on arrival: "Ring the bell at the side door". */
  instructions?: string
  /** How long an order usually takes to prepare, shown to the buyer. */
  readyWithinMinutes?: number
}

/** How the buyer chose to receive the order. Absent on every order before AGL-3624: shipped. */
export type OrderFulfillmentMethod = 'shipping' | 'pickup' | 'local_delivery'

/** Where a pickup order stands: being put together, waiting at the counter, collected. */
export type OrderPickupStatus = 'preparing' | 'ready' | 'picked_up'

/** Where the store's own delivery stands. `failed` is a missed drop the store can send out again. */
export type OrderLocalDeliveryStatus = 'scheduled' | 'out_for_delivery' | 'delivered' | 'failed'

/**
 * The pickup the buyer chose, copied from the location at checkout so the
 * order says where to go even after the location is renamed or removed.
 */
export interface OrderPickup {
  locationId: string
  locationName: string
  /** The location's address on one line, when it has one. */
  address?: string
  /** What to do on arrival, in the store's words. */
  instructions?: string
  /** The location's hours as the store typed them (`Mo-Fr 09:00-17:00`). */
  hours?: string
  status: OrderPickupStatus
  readyAtMs?: number
  pickedUpAtMs?: number
  /** Who collected it, when the person at the counter noted a name. */
  pickedUpBy?: string
  updatedAtMs?: number
}

/** The local delivery the buyer chose and paid for. */
export interface OrderLocalDelivery {
  zoneId: string
  zoneName: string
  /** The fee charged, in cents (the shipping line of the order). */
  feeCents: number
  /** The window the buyer picked, as instants. */
  windowStartMs: number
  windowEndMs: number
  /** The window as the buyer was shown it, in the store's time zone. */
  windowLabel?: string
  /** The postal code the buyer declared at checkout and the zone was matched on. */
  postalCode?: string
  /** The location the order leaves from, when the store named one. */
  locationId?: string
  status: OrderLocalDeliveryStatus
  /**
   * The address the buyer then entered at payment is OUTSIDE the zone the
   * fee was charged for: the store is told, and decides.
   */
  addressOutsideZone?: boolean
  outForDeliveryAtMs?: number
  deliveredAtMs?: number
  failedAtMs?: number
  /** Why a drop failed, in the driver's words. */
  failedReason?: string
  /**
   * An outside courier the store sent for this drop (AGL-3695), as the
   * courier plugin last reported it through core's
   * `core.local-delivery-records`. Absent when the store's own driver takes it.
   */
  courier?: OrderLocalDeliveryCourier
  updatedAtMs?: number
}

/** Where an outside courier's run stands. `returning`/`returned`: it is coming back to the store. */
export type OrderCourierState =
  | 'requested'
  | 'assigned'
  | 'at_pickup'
  | 'picked_up'
  | 'at_dropoff'
  | 'delivered'
  | 'cancelled'
  | 'returning'
  | 'returned'

/**
 * An outside courier's run on a local delivery (AGL-3695): the merchant's own
 * DoorDash Drive account, booked from the console. The courier bills the
 * merchant's account directly, so no fee is kept here.
 */
export interface OrderLocalDeliveryCourier {
  /** The courier plugin's provider id: `doordash`. */
  provider: string
  /** `DoorDash`. */
  providerLabel: string
  /** The courier's reference for the run. */
  deliveryRef: string
  state: OrderCourierState
  /** The courier's live tracking page. */
  trackingUrl?: string
  /** When the courier expects to reach the door. */
  etaMs?: number
  /** When the courier expects to collect. */
  pickupEtaMs?: number
  /** Why the run was canceled or came back, in the courier's words. */
  reason?: string
  /** Booked in the courier's test environment: nobody is coming. */
  testMode?: boolean
  updatedAtMs: number
}

export const ORDER_COURIER_STATE_LABELS: Readonly<Record<OrderCourierState, string>> = {
  requested: 'Courier requested',
  assigned: 'Courier on the way to the store',
  at_pickup: 'Courier at the store',
  picked_up: 'On its way',
  at_dropoff: 'Courier arriving',
  delivered: 'Delivered',
  cancelled: 'Courier canceled',
  returning: 'Coming back to the store',
  returned: 'Returned to the store',
}

/** Whether a courier is still working the drop: requested, and neither done nor called off. */
export function orderCourierIsActive(courier: Pick<OrderLocalDeliveryCourier, 'state'> | null | undefined): boolean {
  return Boolean(courier) && !['delivered', 'cancelled', 'returned'].includes(String(courier?.state))
}

export const ORDER_PICKUP_STATUS_LABELS: Readonly<Record<OrderPickupStatus, string>> = {
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  picked_up: 'Picked up',
}

export const ORDER_LOCAL_DELIVERY_STATUS_LABELS: Readonly<Record<OrderLocalDeliveryStatus, string>> = {
  scheduled: 'Scheduled',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  failed: 'Delivery failed',
}

export const ORDER_FULFILLMENT_METHOD_LABELS: Readonly<Record<OrderFulfillmentMethod, string>> = {
  shipping: 'Shipping',
  pickup: 'Pickup',
  local_delivery: 'Local delivery',
}

/**
 * The forward moves of a pickup. `ready` → `preparing` is allowed: the
 * merchant marked the wrong order ready and takes it back before anyone is
 * told twice. Nothing leaves `picked_up`: the goods are gone.
 */
const PICKUP_TRANSITIONS: Readonly<Record<OrderPickupStatus, readonly OrderPickupStatus[]>> = {
  preparing: ['ready', 'picked_up'],
  ready: ['picked_up', 'preparing'],
  picked_up: [],
}

/** A failed drop goes out again; a delivered one is history. */
const LOCAL_DELIVERY_TRANSITIONS: Readonly<
  Record<OrderLocalDeliveryStatus, readonly OrderLocalDeliveryStatus[]>
> = {
  scheduled: ['out_for_delivery', 'delivered', 'failed'],
  out_for_delivery: ['delivered', 'failed'],
  failed: ['out_for_delivery', 'delivered'],
  delivered: [],
}

export function canTransitionPickup(from: OrderPickupStatus | undefined, to: OrderPickupStatus): boolean {
  return (PICKUP_TRANSITIONS[from ?? 'preparing'] ?? []).includes(to)
}

export function canTransitionLocalDelivery(
  from: OrderLocalDeliveryStatus | undefined,
  to: OrderLocalDeliveryStatus,
): boolean {
  return (LOCAL_DELIVERY_TRANSITIONS[from ?? 'scheduled'] ?? []).includes(to)
}

/**
 * The key the pickup and delivery lists query on (`fulfillmentKey`): the
 * method and its status in one field, so "orders ready for pickup" is ONE
 * equality and every tab of the list is one composite index.
 */
export type OrderFulfillmentKey =
  | 'pickup_preparing'
  | 'pickup_ready'
  | 'pickup_picked_up'
  | 'delivery_scheduled'
  | 'delivery_out_for_delivery'
  | 'delivery_delivered'
  | 'delivery_failed'

/** The fields the pickup and delivery lists query, stamped by every writer of either. */
export interface OrderLocalFulfillmentListFields {
  fulfillmentKey: OrderFulfillmentKey
  /** The location to prepare it at or send it from; `''` when the store named none. */
  fulfillmentLocationId: string
  /**
   * What the list sorts by, soonest first: a pickup by when it was ordered
   * (first in, first prepared), a delivery by the start of its window.
   */
  fulfillmentDueMs: number
}

const PICKUP_STATUSES: readonly OrderPickupStatus[] = ['preparing', 'ready', 'picked_up']
const DELIVERY_STATUSES: readonly OrderLocalDeliveryStatus[] = [
  'scheduled',
  'out_for_delivery',
  'delivered',
  'failed',
]

/** Reads a stored pickup status, defaulting a malformed one to where every pickup starts. */
export function orderPickupStatus(value: unknown): OrderPickupStatus {
  return PICKUP_STATUSES.includes(value as OrderPickupStatus) ? (value as OrderPickupStatus) : 'preparing'
}

export function orderLocalDeliveryStatus(value: unknown): OrderLocalDeliveryStatus {
  return DELIVERY_STATUSES.includes(value as OrderLocalDeliveryStatus)
    ? (value as OrderLocalDeliveryStatus)
    : 'scheduled'
}

/**
 * The list fields for an order, or `null` for one that is shipped: those
 * orders carry none of the three, so neither list ever reads them.
 */
export function orderLocalFulfillmentListFields(order: {
  fulfillmentMethod?: OrderFulfillmentMethod | string
  pickup?: Partial<OrderPickup> | null
  localDelivery?: Partial<OrderLocalDelivery> | null
  createdAtMs?: number
}): OrderLocalFulfillmentListFields | null {
  if (order.fulfillmentMethod === 'pickup' && order.pickup) {
    return {
      fulfillmentKey: `pickup_${orderPickupStatus(order.pickup.status)}` as OrderFulfillmentKey,
      fulfillmentLocationId: String(order.pickup.locationId ?? ''),
      fulfillmentDueMs: Number(order.createdAtMs) || 0,
    }
  }
  if (order.fulfillmentMethod === 'local_delivery' && order.localDelivery) {
    return {
      fulfillmentKey: `delivery_${orderLocalDeliveryStatus(order.localDelivery.status)}` as OrderFulfillmentKey,
      fulfillmentLocationId: String(order.localDelivery.locationId ?? ''),
      fulfillmentDueMs: Number(order.localDelivery.windowStartMs) || Number(order.createdAtMs) || 0,
    }
  }
  return null
}

/** Whether an order is collected or brought by the store, so no carrier ever ships it. */
export function orderIsLocallyFulfilled(order: { fulfillmentMethod?: string } | null | undefined): boolean {
  return order?.fulfillmentMethod === 'pickup' || order?.fulfillmentMethod === 'local_delivery'
}
