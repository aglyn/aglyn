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
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * Orders a store took somewhere else (AGL-3638): a marketplace, a social
 * shop, any outside channel that sells the store's goods and is paid there.
 *
 * Such an order must become a REAL order of the store — numbered with the
 * rest, shown in the same list, shipped from the same dialog, announced to
 * the same subscribers — and its units must leave the same shelf every other
 * channel sells from, in the same write, or two channels sell the last unit
 * twice. The plugin that brings the order in must not write the seller's
 * orders or products itself, so the seller registers
 * {@link PluginChannelOrders} and records each order under its own rules: the
 * order number, the stock decrement and its ledger row, the oversell alert,
 * the order events.
 *
 * ## Once per outside order
 *
 * An import is keyed by `channel.id` and `externalOrderId`. The same pair a
 * second time — a retried run, a page read twice — answers `already` with
 * the record the first import made, and nothing moves.
 *
 * ## The channel was paid, not the store
 *
 * The buyer paid the channel, and the channel pays the merchant out. No
 * money moves through the seller for the order; its refunds and returns
 * happen on the channel. What the channel charged the merchant for the sale
 * (`fees`) is RECORDED on the order for the merchant's books and never
 * charged or collected by anyone here.
 *
 * Money is integer minor units (cents for USD) in `currency`. A seller may
 * refuse an order in a currency its store does not sell in.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-channel-orders`); it is not in the
 * barrel.
 */

/** One line of an outside order. */
export interface PluginChannelOrderLine {
  /** The channel's id for the line, which a shipment back to it names. */
  externalLineId: string
  /** The seller SKU the channel sold it under; `null` when it gave none. */
  sku: string | null
  /**
   * The product and configuration, when the importer already knows them
   * (it listed them from `core.product-catalog`). Otherwise the seller
   * matches `sku`.
   */
  productId?: string | null
  variantId?: string | null
  /** The channel's name for the item, kept on the order. */
  name: string
  quantity: number
  /** Per unit, before tax. */
  unitPriceCents: number
}

/** The address the order ships to. */
export interface PluginChannelOrderAddress {
  name?: string | null
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  /** ISO 3166-1 alpha-2, upper case. */
  country?: string | null
  phone?: string | null
}

/** A channel's charge on a sale, recorded for the merchant and never collected here. */
export interface PluginChannelOrderFee {
  label: string
  amountCents: number
}

export interface PluginChannelOrder {
  hostId: string
  /** Stable id and display name, as the importer names its channel. */
  channel: { id: string; label: string }
  externalOrderId: string
  /** What the merchant sees on the channel. */
  externalRef: string
  placedAtMs: number
  /** ISO 4217. */
  currency: string
  lines: PluginChannelOrderLine[]
  shippingCents: number
  /** Tax the channel collected; the channel, not the store, remits it. */
  taxCents: number
  discountCents: number
  /** What the buyer paid the channel in all. */
  totalCents: number
  /** The channel's charges on the sale; `null` while the channel has not said. */
  fees: PluginChannelOrderFee[] | null
  customerName: string | null
  shippingAddress: PluginChannelOrderAddress | null
  /** Placed in the channel's sandbox: recorded, but never counted as revenue. */
  testMode: boolean
}

/** A line the store's stock could not cover in full: the channel sold more than the shelf held. */
export interface PluginChannelOrderShortfall {
  lineIndex: number
  sku: string | null
  /** Units sold beyond what the shelf held. */
  short: number
}

export type PluginChannelOrderOutcome =
  | {
      outcome: 'created'
      recordId: string
      /** What a person calls it: `#1042`. */
      displayRef: string
      /** Which order line each channel line became. */
      lines: Array<{ lineIndex: number; externalLineId: string }>
      /** Lines whose units the shelf could not cover. The order is recorded all the same. */
      shortfalls: PluginChannelOrderShortfall[]
      /** Lines matching no product, recorded by name with no stock moved. */
      unmatched: number[]
    }
  | {
      outcome: 'already'
      recordId: string
      displayRef: string
      lines: Array<{ lineIndex: number; externalLineId: string }>
    }
  /** The seller would not record it; `reason` says why, for the merchant. */
  | { outcome: 'refused'; reason: string }

export interface PluginChannelOrderCancel {
  hostId: string
  recordId: string
  /** Shown on the order's timeline. */
  reason: string
}

export type PluginChannelOrderCancelOutcome =
  /** Cancelled, with this many units back on the shelf. */
  | { outcome: 'cancelled'; restockedUnits: number }
  | { outcome: 'already' }
  /** The seller's rules refused (it has shipped, say); `status` is the seller's word for where it stands. */
  | { outcome: 'not_cancellable'; status: string }
  | { outcome: 'no_such_record' }

export interface PluginChannelOrders {
  /** Records an outside order once, with its units off the shelf in the same write. */
  importOrder(order: PluginChannelOrder): Promise<PluginChannelOrderOutcome>
  /** The channel canceled an order it had sent: cancel it here and put its units back. */
  cancelOrder(request: PluginChannelOrderCancel): Promise<PluginChannelOrderCancelOutcome>
  /** The channel's charges on a sale, once it says what they were. */
  recordFees(request: {
    hostId: string
    recordId: string
    fees: PluginChannelOrderFee[]
  }): Promise<'recorded' | 'no_such_record'>
}

const PLUGIN_CHANNEL_ORDERS = definePluginServiceContract<PluginChannelOrders>('core.channel-orders', {
  multiple: false,
})

/** Registers the seller. A second plugin is refused naming both. */
export function registerPluginChannelOrders(orders: PluginChannelOrders, options?: { pluginId?: string }): void {
  registerPluginService(PLUGIN_CHANNEL_ORDERS, orders, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The seller, or `null` when no plugin registered one. */
export function pluginChannelOrders(): PluginChannelOrders | null {
  return resolvePluginServices(PLUGIN_CHANNEL_ORDERS)[0]?.impl ?? null
}
