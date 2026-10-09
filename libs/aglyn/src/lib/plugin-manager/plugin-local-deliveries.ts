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

import type { PluginShippingAddress } from './plugin-shipping-rates'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * A seller's local deliveries, as a courier service sees them (AGL-3695).
 *
 * A seller that delivers its own goods in town keeps a delivery on each such
 * record: where it leaves from, where it goes, the window the buyer booked,
 * and where it stands (`scheduled` → `out_for_delivery` → `delivered`, or
 * `failed`). A plugin that books an outside courier for that drop needs to
 * read those facts and to write back what the courier did — and must not
 * read the seller's documents for either. The seller registers
 * {@link PluginLocalDeliveryRecords}; the courier plugin asks it.
 *
 * Every write is the seller's own: its transition rule, its timeline, the
 * buyer's "out for delivery" and "delivered" messages and the handover that
 * fulfills the record all stay inside the seller, so a drop a courier makes
 * and one the store's own driver makes land the same way.
 *
 * The words are a seller's and a courier's, never one catalog's: a record is
 * anything with goods taken to a door — an order, a rental, a catering job.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-local-deliveries`); it is not in the
 * barrel.
 */

/** Where the seller's delivery stands. `failed` is a missed drop that may go out again. */
export type PluginLocalDeliveryStatus = 'scheduled' | 'out_for_delivery' | 'delivered' | 'failed'

/**
 * Where an outside courier's run stands, in a courier-neutral word.
 * `returning` and `returned` are a drop that did not happen and is coming
 * back to the store.
 */
export type PluginCourierState =
  | 'requested'
  | 'assigned'
  | 'at_pickup'
  | 'picked_up'
  | 'at_dropoff'
  | 'delivered'
  | 'cancelled'
  | 'returning'
  | 'returned'

export const PLUGIN_COURIER_STATES: readonly PluginCourierState[] = [
  'requested',
  'assigned',
  'at_pickup',
  'picked_up',
  'at_dropoff',
  'delivered',
  'cancelled',
  'returning',
  'returned',
]

/** One end of the drop. */
export interface PluginLocalDeliveryPlace {
  /** A business at the pickup end; the person at the drop-off end. */
  name: string
  address: PluginShippingAddress
  /** E.164, when the seller knows one. */
  phone?: string
  /** What the courier does on arrival, in the seller's or the buyer's words. */
  instructions?: string
}

/** An outside courier's run on a record, as the seller keeps it. */
export interface PluginRecordCourier {
  /** The courier plugin's provider id: `doordash`. */
  provider: string
  /** What a person calls it: `DoorDash`. */
  providerLabel: string
  /** The courier's reference for the run. */
  deliveryRef: string
  state: PluginCourierState
  /** The courier's own live tracking page, https. */
  trackingUrl?: string
  /** When the courier expects to reach the door, epoch ms. */
  etaMs?: number
  /** When the courier expects to collect, epoch ms. */
  pickupEtaMs?: number
  /** Why a run was canceled or came back, in the courier's words. */
  reason?: string
  /** Whether the run is in the courier's test environment: nobody is coming. */
  testMode?: boolean
  updatedAtMs: number
}

/** A record with a local delivery on it. */
export interface PluginLocalDeliveryRecord {
  hostId: string
  recordId: string
  /** What a person calls it: `#1042`. */
  displayRef: string
  /** The seller's own status word for the record, shown as is. */
  sellerStatus: string
  status: PluginLocalDeliveryStatus
  /**
   * Whether the seller would hand this drop to a courier now: paid, not
   * canceled or refunded, and not already delivered.
   */
  dispatchable: boolean
  /** ISO-4217, lower case. */
  currency: string
  /** What the goods are worth, for the courier's cover. */
  valueCents: number
  /** Units in the drop. */
  itemCount: number
  /** Where the drop leaves from; `null` when the seller has no full street address for it. */
  pickup: PluginLocalDeliveryPlace | null
  /** Where it goes; `null` when the record has no street address. */
  dropoff: PluginLocalDeliveryPlace | null
  /** The window the buyer booked, epoch ms. */
  windowStartMs?: number
  windowEndMs?: number
  /** Whether the record was paid in a payment provider's test mode: no money moved. */
  testMode: boolean
  /** The courier run the seller last recorded, or `null`. */
  courier: PluginRecordCourier | null
}

/** A courier run to record, and the delivery step it brings. */
export interface PluginRecordCourierWrite {
  hostId: string
  recordId: string
  /** The run as it now stands; `null` clears it (the merchant canceled it and will deliver). */
  courier: PluginRecordCourier | null
  /**
   * The step this run moves the delivery to, under the seller's rules —
   * `failed` with {@link reason} when the courier canceled or brought it
   * back. Absent writes the run and moves nothing.
   */
  move?: Exclude<PluginLocalDeliveryStatus, 'scheduled'>
  reason?: string
}

export type PluginRecordCourierOutcome =
  | { outcome: 'recorded'; status: PluginLocalDeliveryStatus }
  /** The record already said this, so nothing was written. */
  | { outcome: 'unchanged'; status: PluginLocalDeliveryStatus }
  | { outcome: 'no_such_record' }
  /** The record is not a local delivery. */
  | { outcome: 'not_local_delivery' }
  /** The seller's rules refused the step; the run itself was recorded. `from` is the status that refused. */
  | { outcome: 'blocked'; from: string }

export interface PluginLocalDeliveryRecords {
  /** One record, or `null` when the site has none by that id or it is not a local delivery. */
  read(hostId: string, recordId: string): Promise<PluginLocalDeliveryRecord | null>
  /** Writes a courier run, and the step it brings, under the seller's own rules. */
  recordCourier(write: PluginRecordCourierWrite): Promise<PluginRecordCourierOutcome>
}

export const PLUGIN_LOCAL_DELIVERY_RECORDS =
  definePluginServiceContract<PluginLocalDeliveryRecords>('core.local-delivery-records', {
    multiple: false,
  })

/** Registers the seller. A second plugin is refused naming both. */
export function registerPluginLocalDeliveryRecords(
  records: PluginLocalDeliveryRecords,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_LOCAL_DELIVERY_RECORDS, records, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The seller, or `null` when no plugin registered one. */
export function pluginLocalDeliveryRecords(): PluginLocalDeliveryRecords | null {
  return resolvePluginServices(PLUGIN_LOCAL_DELIVERY_RECORDS)[0]?.impl ?? null
}

/** Whether a courier run is over: nothing more will happen on it. */
export function pluginCourierStateIsFinal(state: PluginCourierState): boolean {
  return state === 'delivered' || state === 'cancelled' || state === 'returned'
}
