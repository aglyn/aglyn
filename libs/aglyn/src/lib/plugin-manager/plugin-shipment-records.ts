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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import type { PluginShippingAddress } from './plugin-shipping-rates'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * What was sold and shipped, kept by the plugin that sold it (AGL-3612).
 *
 * A plugin that buys a carrier label needs three things from the seller of
 * the goods, and must not read the seller's documents for any of them: what
 * a record holds that still has to ship (lines, weights, the address), a way
 * to write a shipment back onto it once the label exists, and a way to tell
 * it what the carrier says has happened since. The seller registers
 * {@link PluginShipmentRecords}; the label buyer asks it. The seller's own
 * transition rules, its timeline and the emails its customers get all stay
 * inside the seller's write, so a label bought here and a parcel shipped by
 * hand land the same way.
 *
 * The words are a seller's and a carrier's, never one catalog's: a record is
 * anything with lines that ship — an order, a rental, a subscription box.
 *
 * ## Shipments announced
 *
 * A seller also announces each shipment it records, however it was recorded
 * — a label bought here, or a carrier and number typed by hand — so a plugin
 * that follows parcels can start following that one. Listeners run after the
 * write; one that throws is logged and never undoes it.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-shipment-records`); it is not in the
 * barrel.
 */

/** One line of a record, as a shipper needs it. */
export interface PluginShipmentLine {
  /** The line's position on the record: the id a write names it by. */
  lineIndex: number
  name: string
  sku?: string
  quantity: number
  /** Units of the line not yet on any shipment. */
  quantityUnshipped: number
  /** Per unit, in the record's currency. */
  unitValueCents: number
  /** Per unit; absent when the seller does not know it. */
  weightGrams?: number
  lengthCm?: number
  widthCm?: number
  heightCm?: number
  /** Harmonized System code, for customs. */
  hsCode?: string
  /** ISO-3166 alpha-2 country the goods were made in, for customs. */
  originCountry?: string
}

/** A shipment already on the record. */
export interface PluginRecordedShipment {
  id: string
  carrier?: string
  trackingNumber?: string
  trackingUrl?: string
  /** The label it was shipped under, when a label buyer wrote it. */
  labelRef?: string
  lineIndexes: number[]
  atMs: number
}

/** A record with lines that ship. */
export interface PluginShippableRecord {
  hostId: string
  recordId: string
  /** What a person calls it: `#1042`. */
  displayRef: string
  /** The seller's own status word, shown as is. */
  status: string
  /** Whether the seller would accept a shipment on it now. */
  shippable: boolean
  /** ISO-4217, lower case. */
  currency: string
  shipTo?: PluginShippingAddress
  customerEmail?: string
  lines: PluginShipmentLine[]
  shipments: PluginRecordedShipment[]
  /** The rate the customer chose at checkout, when it was a carrier's. */
  chosenService?: { serviceKey?: string; label?: string; amountCents?: number }
  createdAtMs?: number
  /**
   * Whether the record was paid in a payment provider's test mode (AGL-3634):
   * no money moved, so nothing real may be sent for it. Absent when the
   * seller does not know, which reads as live.
   */
  testMode?: boolean
}

/** A shipment to write. */
export interface PluginShipmentWrite {
  hostId: string
  recordId: string
  /** What is in the parcel; absent means every unit not yet shipped. */
  lines?: Array<{ lineIndex: number; quantity: number }>
  carrier: string
  trackingNumber: string
  trackingUrl?: string
  /** The label's file, an https URL the seller may show beside the shipment. */
  labelUrl?: string
  labelRef?: string
  /** The member who bought the label, for the record's timeline. */
  actorUid?: string
}

/**
 * What a write did. `already` is a success: the same label was written
 * before, so a retry cannot add a second shipment.
 */
export type PluginShipmentWriteOutcome =
  | { outcome: 'recorded'; shipmentId: string }
  | { outcome: 'already'; shipmentId?: string }
  | { outcome: 'no_such_record' }
  /** The seller's rules refused; `from` is the status that refused. */
  | { outcome: 'blocked'; from: string; reason?: string }

/** Where a parcel is, in a carrier-neutral word. */
export type PluginTrackingStatus =
  | 'pre_transit'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'returned'

export const PLUGIN_TRACKING_STATUSES: readonly PluginTrackingStatus[] = [
  'pre_transit',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'exception',
  'returned',
]

/** What a carrier says happened to one parcel. */
export interface PluginTrackingUpdate {
  hostId: string
  recordId: string
  trackingNumber: string
  status: PluginTrackingStatus
  /** The carrier's own words for the event. */
  detail?: string
  atMs: number
}

export type PluginTrackingOutcome =
  | { outcome: 'recorded' }
  /** The record already says this, so nothing was written. */
  | { outcome: 'unchanged' }
  | { outcome: 'no_such_record' }
  | { outcome: 'no_such_shipment' }

/** A place a site ships from. */
export interface PluginShipFromAddress {
  id: string
  name: string
  address: PluginShippingAddress
}

export interface PluginShipmentRecords {
  /** One record, or `null` when the site has none by that id. */
  read(hostId: string, recordId: string): Promise<PluginShippableRecord | null>
  /** Writes a shipment under the seller's own rules, once per label. */
  recordShipment(write: PluginShipmentWrite): Promise<PluginShipmentWriteOutcome>
  /** Records what the carrier says; `delivered` moves the record on as the seller does. */
  recordTracking(update: PluginTrackingUpdate): Promise<PluginTrackingOutcome>
  /** The addresses the site keeps for where it ships from. */
  shipFromAddresses(hostId: string): Promise<PluginShipFromAddress[]>
}

export const PLUGIN_SHIPMENT_RECORDS =
  definePluginServiceContract<PluginShipmentRecords>('core.shipment-records', {
    multiple: false,
  })

/** Registers the seller. A second plugin is refused naming both. */
export function registerPluginShipmentRecords(
  records: PluginShipmentRecords,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_SHIPMENT_RECORDS, records, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The seller, or `null` when no plugin registered one. */
export function pluginShipmentRecords(): PluginShipmentRecords | null {
  return resolvePluginServices(PLUGIN_SHIPMENT_RECORDS)[0]?.impl ?? null
}

/** A shipment a seller recorded, by any door. */
export interface PluginShipmentAnnouncement {
  hostId: string
  recordId: string
  shipmentId: string
  carrier?: string
  trackingNumber?: string
  /** Present when a label buyer wrote it; a listener that bought it already follows it. */
  labelRef?: string
}

export type PluginShipmentListener = (
  announcement: PluginShipmentAnnouncement,
) => void | Promise<void>

const PLUGIN_SHIPMENT_LISTENERS = definePluginServiceContract<PluginShipmentListener>(
  'core.shipment-listeners',
  { multiple: true },
)

/** Joins the listeners. Re-registering under the same plugin replaces its own. */
export function registerPluginShipmentListener(
  listener: PluginShipmentListener,
  options?: { pluginId?: string },
): void {
  const pluginId = getRegisteringPluginId() ?? options?.pluginId
  registerPluginService(PLUGIN_SHIPMENT_LISTENERS, listener, {
    ...(pluginId ? { pluginId } : {}),
  })
}

/**
 * Tells every listener about a shipment the seller recorded. Awaited, each
 * isolated: a listener that throws is logged and the rest still hear it.
 */
export async function announcePluginShipment(
  announcement: PluginShipmentAnnouncement,
): Promise<void> {
  for (const entry of resolvePluginServices(PLUGIN_SHIPMENT_LISTENERS)) {
    try {
      await entry.impl(announcement)
    } catch (error) {
      console.error(
        `[shipments] listener "${entry.pluginId}" failed for ${announcement.hostId}/${announcement.recordId}`,
        error,
      )
    }
  }
}
