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

import type { InventoryLocation, InventoryProviderId } from '../model/inventory-sync'

/**
 * What every inventory system adapter does (AGL-3642), in the system's words
 * translated once, so the engine never branches on which system it is
 * talking to.
 */

/** An opened credential for one run. Never stored, never logged. */
export type InventoryCredential =
  | { provider: 'cin7-core'; accountId: string; apiKey: string }
  | { provider: 'inflow'; companyId: string; apiKey: string }
  | { provider: 'brightpearl'; accountCode: string; apiDomain: string; accessToken: string }

/** What a connect reads from the system about the account the keys or grant reach. */
export interface SystemAccount {
  accountName: string | null
}

/** One SKU's count in the system, at the chosen location or summed across all. */
export interface SystemStock {
  sku: string
  /** The system's own id for the product. */
  productId: string
  /** On hand, less what the system has reserved or allocated to its own orders: what can be sold now. */
  available: number
  /** Physically on hand. */
  onHand: number
}

/** A product as the system keeps it. One sellable configuration: systems list variants as products. */
export interface SystemProduct {
  id: string
  sku: string
  name: string
  description: string
  /** The selling price, integer minor units in the store's currency; `null` when the system has none for it. */
  priceMinor: number | null
  weightGrams: number | null
  barcode: string | null
  /** When the system last changed it, or its own version stamp: what a re-sync compares. */
  version: string
  active: boolean
}

export interface SystemProductPage {
  products: SystemProduct[]
  /** Where the next page starts, or `null` on the last. Opaque to the engine. */
  nextCursor: string | null
}

/** A product the store asks the system to make. */
export interface SystemProductCreate {
  sku: string
  name: string
  description: string
  priceMinor: number
  /** ISO 4217. */
  currency: string
  weightGrams: number | null
  barcode: string | null
}

/** One adjustment line: bring the system's count of a SKU to the store's. */
export interface SystemStockChange {
  sku: string
  productId: string
  /** Units to add (positive) or take away (negative). */
  delta: number
  /** The system's on-hand count the delta was worked out from. */
  onHand: number
}

export interface SystemOrderLine {
  sku: string
  /** The system's id for the SKU, when a lookup found it. */
  productId: string
  name: string
  quantity: number
  /** Per unit, before tax, integer minor units. */
  unitAmountCents: number
}

export interface SystemAddress {
  name: string | null
  line1: string | null
  line2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  /** ISO 3166-1 alpha-2. */
  country: string | null
  phone: string | null
}

export interface SystemOrderRequest {
  /** Ours, unique per site and order: what the system dedupes on and we look it up by. */
  reference: string
  /** What the merchant calls the order: `#1042`. */
  displayRef: string
  orderedAtMs: number
  /** ISO 4217, upper case. */
  currency: string
  /** The connection's customer setting: a name, or Brightpearl's contact id. */
  customer: string
  locationId: string | null
  /** Cin7 Core only; empty for the customer's own. */
  taxRule: string
  buyerName: string | null
  buyerEmail: string | null
  shippingAddress: SystemAddress | null
  lines: SystemOrderLine[]
  shippingCents: number
  discountCents: number
  taxCents: number
  totalCents: number
}

/** An order as the system recorded it. */
export interface SystemOrder {
  id: string
  /** The system's own order number, when it gave one. */
  number: string | null
}

export type SystemCancelOutcome = 'canceled' | 'too_late' | 'unsupported'

export interface InventorySystemProvider {
  id: InventoryProviderId
  /** Proves the credential and names the account. */
  account(credential: InventoryCredential): Promise<SystemAccount>
  /** The locations (warehouses) stock is kept at. */
  locations(credential: InventoryCredential): Promise<InventoryLocation[]>
  /** Every SKU's count at `locationId` (all locations when `null`), up to `max` SKUs. */
  stock(credential: InventoryCredential, input: { locationId: string | null; max: number }): Promise<SystemStock[]>
  /** Adjusts counts at one location. One document in the system, named by `reference`. */
  adjustStock(
    credential: InventoryCredential,
    input: { locationId: string; reference: string; changes: SystemStockChange[]; currency: string },
  ): Promise<void>
  /** A page of products, changed since `sinceMs` when given. */
  products(
    credential: InventoryCredential,
    input: { sinceMs: number | null; cursor: string | null; limit: number; currency: string },
  ): Promise<SystemProductPage>
  /** The system's product id of each SKU it has, by SKU. SKUs it lacks are left out. */
  productIdsBySku(credential: InventoryCredential, skus: readonly string[]): Promise<Map<string, string>>
  /** Makes a product. Never retried in the call: look the SKU up first. */
  createProduct(credential: InventoryCredential, product: SystemProductCreate): Promise<{ id: string }>
  /** Whether the customer orders are recorded under exists. */
  customerExists(credential: InventoryCredential, customer: string): Promise<boolean>
  /** The order we sent under `reference`, or `null` when the system has none. */
  findOrder(credential: InventoryCredential, reference: string): Promise<SystemOrder | null>
  /** Records an order. Look it up first; inFlow's write is an upsert under an id derived from `reference`. */
  createOrder(credential: InventoryCredential, request: SystemOrderRequest): Promise<SystemOrder>
  /** Voids or cancels an order the system holds; `unsupported` where its API cannot. */
  cancelOrder(credential: InventoryCredential, order: SystemOrder & { reference: string }): Promise<SystemCancelOutcome>
}
