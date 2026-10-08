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
import { DEFAULT_PREP_MINUTES } from '../constants'

/**
 * The client-safe model of the delivery-apps plugin (AGL-3644): which
 * services exist, and what the console's routes answer about a store and an
 * order. Nothing here reaches a server module.
 */

export const DELIVERY_SERVICE_IDS = ['doordash', 'uber-eats', 'grubhub'] as const
export type DeliveryServiceId = (typeof DELIVERY_SERVICE_IDS)[number]

export interface DeliveryServiceInfo {
  label: string
  /** What the merchant calls the store id the service gave them. */
  storeIdLabel: string
  storeIdHelp: string
  /** Whether the service takes a "ready for pickup" signal from the store. */
  readySignal: boolean
}

export const DELIVERY_SERVICES: Readonly<Record<DeliveryServiceId, DeliveryServiceInfo>> = {
  doordash: {
    label: 'DoorDash',
    storeIdLabel: 'DoorDash store ID',
    storeIdHelp: 'The store ID in your DoorDash Merchant Portal, or the location ID DoorDash set up for this integration.',
    readySignal: true,
  },
  'uber-eats': {
    label: 'Uber Eats',
    storeIdLabel: 'Uber Eats store ID',
    storeIdHelp: 'The store UUID in Uber Eats Manager.',
    readySignal: false,
  },
  grubhub: {
    label: 'Grubhub',
    storeIdLabel: 'Grubhub merchant ID',
    storeIdHelp: 'The merchant ID in Grubhub for Restaurants.',
    readySignal: true,
  },
}

export function isDeliveryServiceId(value: unknown): value is DeliveryServiceId {
  return typeof value === 'string' && (DELIVERY_SERVICE_IDS as readonly string[]).includes(value)
}

/**
 * Where an order stands at the counter:
 * `new` → `accepted` → `ready` → `picked_up`, or `rejected` before it is
 * accepted, or `cancelled` by the service at any point.
 */
export type DeliveryOrderStatus = 'new' | 'accepted' | 'ready' | 'picked_up' | 'rejected' | 'cancelled'

export const OPEN_ORDER_STATUSES: readonly DeliveryOrderStatus[] = ['new', 'accepted', 'ready']

export type DeliveryOrderAction = 'accept' | 'reject' | 'ready' | 'picked_up' | 'retry'

/** A call to the service still owed, retried by the job. */
export type DeliveryPendingCall = 'accept' | 'reject' | 'ready'

export interface DeliveryStoreSettings {
  /** Accept each order the moment it arrives, with `prepMinutes`. */
  autoAccept: boolean
  /** Minutes the kitchen needs, sent with each acceptance. 5–120. */
  prepMinutes: number
}

export const DEFAULT_STORE_SETTINGS: DeliveryStoreSettings = { autoAccept: false, prepMinutes: DEFAULT_PREP_MINUTES }

/** Settings as a request carried them, bounded; `null` fields keep what is stored. */
export function readStoreSettings(raw: unknown, base: DeliveryStoreSettings = DEFAULT_STORE_SETTINGS): DeliveryStoreSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const prep = Number(value['prepMinutes'])
  return {
    autoAccept: typeof value['autoAccept'] === 'boolean' ? value['autoAccept'] : base.autoAccept,
    prepMinutes: Number.isInteger(prep) && prep >= 5 && prep <= 120 ? prep : base.prepMinutes,
  }
}

/** One item of the service's menu as the merchant matches it to a product. */
export interface DeliveryItemMatchView {
  externalItemId: string
  name: string
  /** The product and configuration it takes stock from; `null` while unmatched. */
  productId: string | null
  variantId: string | null
  /** The product's name with its choices, when matched. */
  title: string | null
  lastSeenAtMs: number | null
}

export interface DeliveryMenuView {
  publishedAtMs: number | null
  items: number
  error: string | null
}

/** A connected store, as the settings card reads it. */
export interface DeliveryStoreView {
  service: DeliveryServiceId
  externalStoreId: string
  settings: DeliveryStoreSettings
  connectedAtMs: number
  menu: DeliveryMenuView
  /** Items seen on orders that match no product. */
  unmatched: number
}

/** What the deployment offers, and the site's stores. */
export interface DeliveryStoresAnswer {
  offered: Array<{ id: DeliveryServiceId; sandbox: boolean }>
  stores: DeliveryStoreView[]
}

export interface DeliveryOrderLineView {
  name: string
  quantity: number
  /** Per unit, options included, minor units. */
  unitPriceCents: number
  /** The options the buyer chose, as the service named them. */
  options: string[]
  instructions: string | null
  /** Whether the line takes stock from a product. */
  matched: boolean
}

/** One order at the counter, as the register reads it. */
export interface DeliveryOrderView {
  id: string
  service: DeliveryServiceId
  /** The short code the courier and the service show. */
  externalRef: string
  status: DeliveryOrderStatus
  /** `courier` for the service's courier, `customer` when the buyer collects it. */
  handoff: 'courier' | 'customer'
  placedAtMs: number
  /** When the service expects it ready, when it said. */
  pickupAtMs: number | null
  customerName: string | null
  instructions: string | null
  lines: DeliveryOrderLineView[]
  currency: string
  subtotalCents: number
  taxCents: number
  totalCents: number
  refundedCents: number
  /** The store order it became, once accepted. */
  recordId: string | null
  displayRef: string | null
  /** Units the service sold beyond the shelf, once accepted. */
  oversold: number
  testMode: boolean
  /** A call to the service still owed, and why the last attempt failed. */
  pending: DeliveryPendingCall | null
  error: string | null
  updatedAtMs: number
}

export interface DeliveryQueueAnswer {
  /** Whether any service is connected for the site: the register draws nothing otherwise. */
  connected: boolean
  open: DeliveryOrderView[]
  recent: DeliveryOrderView[]
}

/** A catalog offer the merchant can match an item to. */
export interface DeliveryCatalogOption {
  productId: string
  variantId: string
  title: string
  sku: string | null
}

/** Minor units as money, in the order's currency. */
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}
