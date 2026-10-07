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

import type { PodOrderCosts, PodOrderStatus, PodProviderId } from '../model/print-on-demand'

/**
 * What an adapter does, in the store's words rather than a service's
 * (AGL-3641). Every amount is integer minor units with its currency. Every
 * adapter is built around one `fetch`, so a spec drives it with a recorded
 * service and nothing leaves the process.
 */

/** The merchant's token, opened for one call, and the store it is scoped to. */
export interface PodCredentials {
  token: string
  /** The service's store or shop id; `null` for a token scoped to one store already. */
  storeId: string | null
}

/** One of the merchant's stores (Printful) or shops (Printify). */
export interface PodStore {
  id: string
  name: string
  /** ISO 4217, upper case, when the service says. */
  currency: string | null
}

export interface PodCatalogSummary {
  id: string
  name: string
  thumbnailUrl: string | null
  variantCount: number
}

export interface PodCatalogPage {
  products: PodCatalogSummary[]
  /** Where the next page starts, or `null` on the last. */
  nextCursor: string | null
  total: number | null
}

export interface PodSourceVariant {
  /** The service's id for the variant as the merchant's store holds it. */
  id: string
  name: string
  sku: string | null
  options: Record<string, string>
  /** The retail price the merchant set at the service. */
  retailMinor: number
  /** The service's price to the merchant, when it says. */
  costMinor: number | null
  available: boolean
  /** A picture of this variant at the service. */
  imageUrl: string | null
  weightGrams: number | null
}

export interface PodSourceProduct {
  id: string
  name: string
  /** Plain text. */
  description: string
  tags: string[]
  /** ISO 4217, upper case: what `retailMinor` and `costMinor` are in. */
  currency: string
  /** Pictures at the service, primary first. */
  imageUrls: string[]
  options: Array<{ name: string; values: string[] }>
  variants: PodSourceVariant[]
}

export interface PodRecipient {
  name: string
  line1: string
  line2?: string
  city: string
  /** State, province or region code. */
  state?: string
  postalCode: string
  /** ISO 3166-1 alpha-2, upper case. */
  country: string
  phone?: string
  email?: string
}

export interface PodOrderLine {
  /** The line's position on the store's order. */
  lineIndex: number
  sourceProductId: string
  sourceVariantId: string
  quantity: number
  /** What the buyer paid per unit, for the packing slip and customs. */
  retailMinor: number
  name: string
}

export interface PodOrderRequest {
  /** The store's key for the order at the service: unique, at most 32 characters. */
  externalId: string
  /** What a person calls it, e.g. `#1042`. */
  label: string
  recipient: PodRecipient
  lines: PodOrderLine[]
  /** The store's currency, for the retail amounts. */
  retailCurrency: string
  /** Confirm for production now, or leave a draft. */
  confirm: boolean
}

export interface PodSourceShipment {
  id: string
  carrier: string
  service: string | null
  trackingNumber: string
  trackingUrl: string | null
  /** Units per line of the store's order; `null` when the service does not say which. */
  lines: Array<{ lineIndex: number; quantity: number }> | null
  shippedAtMs: number | null
  deliveredAtMs: number | null
}

export interface PodSourceOrder {
  id: string
  externalId: string | null
  status: PodOrderStatus
  /** The service's own word, kept for the merchant. */
  rawStatus: string
  costs: PodOrderCosts | null
  shipments: PodSourceShipment[]
  /**
   * The variants the service reports done, for a service whose shipments
   * name no lines; the store maps them back to its own lines.
   */
  fulfilledVariantIds: string[]
  dashboardUrl: string | null
}

export interface PodWebhookOutcome {
  registered: boolean
  /** Why not, in a sentence the console shows. */
  detail: string | null
}

export interface PodProvider {
  id: PodProviderId
  /** The stores the token reaches. Throws `PodProviderError` on a refused token. */
  listStores(token: string): Promise<PodStore[]>
  listProducts(credentials: PodCredentials, cursor: string | null): Promise<PodCatalogPage>
  getProduct(credentials: PodCredentials, productId: string): Promise<PodSourceProduct>
  /** The order the store sent under `externalId`, or `null`. */
  findOrder(credentials: PodCredentials, externalId: string): Promise<PodSourceOrder | null>
  createOrder(credentials: PodCredentials, request: PodOrderRequest): Promise<PodSourceOrder>
  confirmOrder(credentials: PodCredentials, orderId: string): Promise<PodSourceOrder>
  getOrder(credentials: PodCredentials, orderId: string): Promise<PodSourceOrder>
  cancelOrder(credentials: PodCredentials, orderId: string): Promise<PodSourceOrder>
  /** Asks the service to tell `url` about orders; never takes over a hook someone else set. */
  registerWebhooks(credentials: PodCredentials, url: string, secret: string): Promise<PodWebhookOutcome>
  /** Removes the hooks this store set at `url`; best effort. */
  removeWebhooks(credentials: PodCredentials, url: string): Promise<void>
  /** The service's order id a webhook body is about, or `null` for one about something else. */
  webhookOrderId(body: unknown): string | null
}
