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

import type { PluginTrackingStatus } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import type { AmazonShippingSpeed, NetworkMarketplace, NetworkProviderId } from '../model/networks'

/**
 * What every fulfillment network adapter does (AGL-3634), in the network's
 * words translated once, so the engine never branches on which network it is
 * talking to.
 */

/** An opened grant: the access token for one call, and where the account lives. */
export interface NetworkCredential {
  accessToken: string
  /** ShipBob: the channel orders are created under. */
  channelId?: string | null
  /** Amazon: the marketplace whose inventory ships. */
  marketplaceId?: string | null
  /** ShipMonk: the merchant's API store every order is created under (AGL-3697). */
  storeId?: string | null
}

/** What a connect reads from the network about the account it was granted. */
export interface NetworkAccount {
  accountName: string | null
  channelId?: string | null
  marketplaces?: NetworkMarketplace[]
}

/** The address a network ships to. Every field the network needs is present. */
export interface NetworkAddress {
  name: string
  line1: string
  line2?: string
  city: string
  state?: string
  postalCode: string
  country: string
  phone?: string
  email?: string
}

/** One line of an order a network is asked to ship. */
export interface NetworkOrderItem {
  /** The line's index on the order, echoed back as the network's line id. */
  lineIndex: number
  sku: string
  name: string
  quantity: number
  /** Per unit, in the order's currency, for a customs declaration. */
  unitValueCents: number
}

export interface NetworkOrderRequest {
  /** Ours, unique per order and attempt: what the network dedupes on and we look it up by. */
  reference: string
  /** What the merchant calls the order: `#1042`. */
  displayRef: string
  orderedAtMs: number
  /** ISO-4217, lower case. */
  currency: string
  address: NetworkAddress
  items: NetworkOrderItem[]
  shippingMethod: string
  shippingSpeed: AmazonShippingSpeed
}

/** One parcel the network shipped, and the order lines in it. */
export interface NetworkShipment {
  /** The network's own id for the parcel: stable across reads. */
  id: string
  carrier: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  /**
   * What is in it, by SKU. The network may also echo our line index (Amazon
   * does, as its item id); otherwise the engine assigns the SKU's units to
   * the order's lines in order.
   */
  items: Array<{ sku: string; quantity: number; lineIndex?: number }>
  /** Where the parcel is, when the network said. */
  trackingStatus: PluginTrackingStatus | null
  /** The network's own words for that, when it gave any. */
  trackingDetail: string | null
  shippedAtMs: number | null
  /**
   * The handle its tracking is read back by: Amazon's package number;
   * ShipMonk's order key (its tracking is read from the order).
   */
  packageNumber?: string | null
}

/** Where an order stands at the network. */
export type NetworkOrderState = 'open' | 'shipped' | 'canceled' | 'refused'

export interface NetworkOrder {
  /** The network's id for the order, or our reference where the network keys by it. */
  id: string
  reference: string
  state: NetworkOrderState
  /** The network's own words, when it refused or stopped the order. */
  detail: string | null
  shipments: NetworkShipment[]
}

/** A SKU the network holds, and how many it can ship now. */
export interface NetworkStock {
  sku: string
  fulfillable: number
}

/**
 * - `canceled` — the network stopped the order.
 * - `too_late` — it is already being packed or has shipped.
 * - `requested` — the network took the request and its warehouse confirms it
 *   (ShipMonk's `cancellation_requested`); the order is read back until it does.
 */
export type NetworkCancelOutcome = 'canceled' | 'too_late' | 'requested'

export interface FulfillmentNetworkProvider {
  id: NetworkProviderId
  /** Reads the account a fresh grant reaches. */
  account(credential: NetworkCredential): Promise<NetworkAccount>
  /** The order we sent under `reference`, or `null` when the network has none. */
  findOrder(credential: NetworkCredential, reference: string): Promise<NetworkOrder | null>
  /** Sends an order. Never retried in the call; look it up first. */
  createOrder(credential: NetworkCredential, request: NetworkOrderRequest): Promise<NetworkOrder>
  /** The order as it stands, by the id `createOrder` or `findOrder` answered. */
  getOrder(credential: NetworkCredential, id: string, reference: string): Promise<NetworkOrder>
  /** Asks the network to stop the order; `too_late` once it is being packed. */
  cancelOrder(credential: NetworkCredential, id: string, reference: string): Promise<NetworkCancelOutcome>
  /** How many of each SKU the network can ship; SKUs it does not hold are left out. */
  stock(credential: NetworkCredential, skus: readonly string[]): Promise<NetworkStock[]>
  /** Every SKU the network holds, up to `max`. */
  allStock(credential: NetworkCredential, max: number): Promise<NetworkStock[]>
  /** The latest tracking of a shipped parcel, where the network answers it. */
  tracking?(
    credential: NetworkCredential,
    shipment: NetworkShipment,
  ): Promise<{ status: PluginTrackingStatus; detail: string | null } | null>
  /**
   * Points the network's webhooks for one connection at `url`, removing any
   * of that connection's (every address starting `prefix`) that point
   * elsewhere; with `url: null`, removes them all (ShipBob).
   */
  syncWebhooks?(credential: NetworkCredential, target: { prefix: string; url: string | null }): Promise<void>
}
