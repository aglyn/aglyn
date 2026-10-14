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

import {
  definePluginZone,
  registerPluginZone,
} from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { BUNDLE_ID } from '../../constants/bundle-common'

/**
 * The zones the order dialog hosts (AGL-3611): `orderDetail`, beside the
 * order's actions, and `orderFulfillment`, inside the Fulfill items panel;
 * and `localDeliveryRow`, in a delivery's row of the Pickup & delivery queue
 * (AGL-3695).
 *
 * Declared here because zones are declared by the plugin that hosts them (the
 * product zones are the precedent). A widget from another plugin — a shipping
 * plugin's "Buy label" — restates the props it reads rather than importing
 * this package. A widget proposes and never writes the order itself: the
 * shipment it records goes through `recordFulfillment`, which is this
 * plugin's own route with its role gate, its quantity check and its
 * transition rule.
 */

/** One order line as a widget reads it. `lineItemId` is the line's index. */
export interface ConsoleOrderZoneLine {
  lineItemId: number
  productId: string
  variantId: string | null
  name: string
  variantLabel: string | null
  sku: string | null
  /** `physical`, `digital` or `service`; `null` on a line written before types. */
  productType: string | null
  quantity: number
  unitAmountCents: number
  fulfilledQuantity: number
  remainingQuantity: number
  /** Whether the line has to be shipped at all. */
  requiresShipping: boolean
}

/** An address on the order, as the buyer gave it. */
export interface ConsoleOrderZoneAddress {
  name: string | null
  line1: string | null
  line2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  phone: string | null
}

/** One recorded shipment. */
export interface ConsoleOrderZoneFulfillment {
  id: string
  lines: ReadonlyArray<{ lineItemId: number; quantity: number }>
  carrier: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  labelUrl: string | null
  status: 'active' | 'cancelled'
  atMs: number
}

/** The order a widget is handed. Money is integer cents in `currency`. */
export interface ConsoleOrderZoneOrder {
  id: string
  /** The human number, e.g. `#1042`. */
  number: string
  status: string
  channel: string
  /** ISO 4217, upper case. */
  currency: string
  customerEmail: string | null
  customerName: string | null
  shippingAddress: ConsoleOrderZoneAddress | null
  lines: readonly ConsoleOrderZoneLine[]
  fulfillments: readonly ConsoleOrderZoneFulfillment[]
  totals: {
    itemsCents: number
    shippingCents: number
    taxCents: number
    discountCents: number
    totalCents: number
  }
  /** Whether the order was paid in Stripe test mode. */
  testMode: boolean
  /**
   * How the buyer receives it (AGL-3624): `shipping`, `pickup` or
   * `local_delivery`. Optional, so a widget written before reads it as shipped.
   */
  fulfillmentMethod?: string
  /** The store's own delivery, on a `local_delivery` order (AGL-3695); `null` otherwise. */
  localDelivery?: ConsoleOrderZoneLocalDelivery | null
}

/**
 * A local delivery as a widget reads it (AGL-3695): where it stands, the
 * window the buyer booked, and the outside courier on it, if one was sent.
 */
export interface ConsoleOrderZoneLocalDelivery {
  /** `scheduled`, `out_for_delivery`, `delivered` or `failed`. */
  status: string
  windowStartMs: number | null
  windowEndMs: number | null
  windowLabel: string | null
  courier: {
    provider: string
    providerLabel: string
    deliveryRef: string
    state: string
    trackingUrl: string | null
    etaMs: number | null
    reason: string | null
    testMode: boolean
    updatedAtMs: number
  } | null
}

/**
 * What the `localDeliveryRow` zone hands each widget (AGL-3695): one local
 * delivery in the Pickup & delivery queue, beside the row's own step
 * buttons. A widget there is a compact control — a courier's "Send a
 * courier" — and moves nothing itself: the courier's progress comes back
 * through core's `core.local-delivery-records`.
 */
export interface ConsoleLocalDeliveryRowZoneProps {
  hostId: string
  orgId: string | undefined
  order: ConsoleOrderZoneOrder
}

/** A shipment a widget asks the dialog to record. */
export interface ConsoleFulfillmentRequest {
  /** The units shipped. Omitted, the shipment covers everything still to ship. */
  lineItems?: ReadonlyArray<{ lineItemId: number; quantity: number }>
  carrier: string
  trackingNumber: string
  /** An explicit https tracking link; derived from the carrier when absent. */
  trackingUrl?: string
  /** The label the widget bought, an https URL. */
  labelUrl?: string
  /** Whether the buyer is told. Defaults to true. */
  notify?: boolean
  /**
   * One attempt. A retry with the same key finds the shipment it recorded,
   * so a widget that lost a response can ask again without shipping twice.
   */
  idempotencyKey: string
}

/**
 * What the `orderDetail` zone hands each widget, in the order dialog beside
 * its actions. `recordFulfillment` resolves with the shipment recorded (or
 * found, on a retry) and throws with a message a person can act on when the
 * dialog's route refuses it: more units than are left, an order refunded in
 * another tab.
 */
export interface ConsoleOrderDetailZoneProps {
  hostId: string
  /** The org the page names; `undefined` where the host does not know it. */
  orgId: string | undefined
  order: ConsoleOrderZoneOrder
  recordFulfillment: (request: ConsoleFulfillmentRequest) => Promise<ConsoleOrderZoneFulfillment>
}

/** The tracking a widget fills into the Fulfill items panel. */
export interface ConsoleFulfillmentTracking {
  carrier: string
  trackingNumber: string
  trackingUrl?: string
  labelUrl?: string
}

/**
 * What the `orderFulfillment` zone hands each widget, inside the Fulfill
 * items panel: the units the merchant has picked, and `applyTracking`, which
 * fills the panel's carrier and tracking fields (a bought label's) for the
 * merchant to confirm with Fulfill. `recordFulfillment` is there for a widget
 * that records the shipment itself.
 */
export interface ConsoleOrderFulfillmentZoneProps extends ConsoleOrderDetailZoneProps {
  /** The units picked in the panel, lines with a zero count left out. */
  selection: ReadonlyArray<{ lineItemId: number; quantity: number }>
  applyTracking: (tracking: ConsoleFulfillmentTracking) => void
}

export const ORDER_DETAIL_ZONE =
  definePluginZone<ConsoleOrderDetailZoneProps>('orderDetail')

export const ORDER_FULFILLMENT_ZONE =
  definePluginZone<ConsoleOrderFulfillmentZoneProps>('orderFulfillment')

export const LOCAL_DELIVERY_ROW_ZONE =
  definePluginZone<ConsoleLocalDeliveryRowZoneProps>('localDeliveryRow')

/** Declares the two order zones, from the console registrar. */
export function registerCommerceOrderZones(): void {
  const owner = { pluginId: BUNDLE_ID }
  registerPluginZone(
    {
      zone: ORDER_DETAIL_ZONE,
      label: 'Order detail',
      surface: 'console',
      layout: 'bare',
      description:
        'In the order dialog, above its actions. A widget here reads the order — lines, what is left to ship, the ship-to address — and records a shipment through `recordFulfillment`, the dialog’s own route with its quantity check.',
    },
    owner,
  )
  registerPluginZone(
    {
      zone: ORDER_FULFILLMENT_ZONE,
      label: 'Order fulfillment',
      surface: 'console',
      layout: 'bare',
      description:
        'Inside the order dialog’s Fulfill items panel. A widget here reads the units picked and fills the carrier and tracking through `applyTracking` (a bought label’s), for the merchant to confirm with Fulfill.',
    },
    owner,
  )
  registerPluginZone(
    {
      zone: LOCAL_DELIVERY_ROW_ZONE,
      label: 'Local delivery row',
      surface: 'console',
      layout: 'bare',
      description:
        'In a local delivery’s row of the Pickup & delivery queue, beside its step buttons. A widget here is a compact control that reads the order and its delivery — the window, the status and any courier on it — such as sending an outside courier.',
    },
    owner,
  )
}
