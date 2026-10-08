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
 * Products that come from somewhere else, written by a plugin that does not
 * keep the store's products (AGL-3641).
 *
 * A print-on-demand service, a dropshipping supplier and a fulfillment
 * network each hold a catalog of their own, and a merchant who sells it wants
 * those products in their store without typing them in again — then kept in
 * step as the source changes what it offers. The plugin that keeps the
 * products answers here, so the plugin that reads the source never learns
 * how products are stored, how their addresses are chosen, how the plan's
 * product allowance is counted or what the store's search keys are. Every
 * write keeps the owner's own rules: a create counts against the allowance in
 * the transaction that makes it, and an edit leaves an entry in the site's
 * activity like any other.
 *
 * ## Variants by the caller's key
 *
 * The caller names every configuration by its own stable key — the source's
 * variant id — and the owner answers with its own variant id for each, so an
 * order line can later be traced back to what the source sells. On an
 * update the caller passes back the variant ids it was given; a key with no
 * id is a new configuration, and an existing variant whose id is not passed
 * is one the source no longer offers, removed.
 *
 * ## Money is integer minor units in the store's currency
 *
 * `priceMinor` is an integer (cents for USD) in the currency the store sells
 * in, the `currency` the store's catalog (`core.product-catalog`) names. The
 * caller converts nothing: a source priced in another currency is the
 * caller's to refuse.
 *
 * ## What an update leaves alone
 *
 * The merchant edits an imported product like any other. An update rewrites
 * only what the caller names: prices when `prices` is set, the description
 * and photos when `content` is set, and always the configurations and their
 * availability, because those are what an order can be filled from.
 *
 * ## One owner
 *
 * A slot, like the catalog: a site's products have one keeper, so a second
 * plugin's registration is refused and the incumbent keeps serving. No owner
 * registered is an ordinary answer — {@link pluginProductWriter} returns
 * `undefined` and a caller imports nothing.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-product-writer`); it is not in the
 * barrel.
 */

/** One axis of variation, e.g. `{ name: 'Size', values: ['S', 'M', 'L'] }`. */
export interface SourcedProductOption {
  name: string
  values: string[]
}

/** One sellable configuration, as the source offers it. */
export interface SourcedProductVariant {
  /** The source's own stable id for it. */
  key: string
  /** The owner's id, when an earlier write returned one. */
  variantId?: string
  /** Choices by option name; `{}` for a product with one configuration. */
  options: Record<string, string>
  sku?: string
  /** What the shopper pays, integer minor units in the store's currency. */
  priceMinor: number
  weightGrams?: number
  /** A photo the owner already holds (a media-library URL) for this choice. */
  imageUrl?: string
  /**
   * Whether the source can make or ship it now. An unavailable variant is
   * kept, sold out, so a product page does not lose a choice for a day's
   * shortage; a variant the source dropped is not passed at all.
   */
  available: boolean
}

/** A product as the source offers it. */
export interface SourcedProduct {
  /** The source's stable key for the product, e.g. `printful:123`. */
  sourceKey: string
  name: string
  /** Plain text or simple HTML, as the source wrote it. */
  description?: string
  /** Photos the owner already holds (media-library URLs), first is primary. */
  mediaUrls: string[]
  tags?: string[]
  options: SourcedProductOption[]
  variants: SourcedProductVariant[]
}

export interface SourcedProductWrite {
  hostId: string
  product: SourcedProduct
  /** The owner's product id, when an earlier write returned one. */
  productId?: string
  /** A new product is born a draft unless the caller says to list it. */
  status?: 'draft' | 'active'
  /** On an update: rewrite prices from the source. */
  prices?: boolean
  /** On an update: rewrite the name, description and photos from the source. */
  content?: boolean
  /**
   * Whether a `productId` the store no longer has (the merchant deleted it)
   * is made again. Default true; a background re-sync passes false and is
   * answered `missing`, so a product the merchant deleted stays deleted.
   */
  recreate?: boolean
  /** The member the write is made for, for the site's activity. */
  actorUid?: string
}

export type SourcedProductWriteOutcome =
  | {
      outcome: 'created' | 'updated' | 'unchanged'
      productId: string
      /** Every variant passed, with the owner's id for it. */
      variants: Array<{ key: string; variantId: string }>
    }
  /** The plan's product allowance is used up; nothing was written. */
  | { outcome: 'plan_limit'; limit: number }
  /** The owner's rules refused the product; nothing was written. */
  | { outcome: 'invalid'; message: string }
  /** The site does not sell. */
  | { outcome: 'no_store' }
  /** `productId` is gone and `recreate` was false; nothing was written. */
  | { outcome: 'missing' }

export interface PluginProductWriter {
  /**
   * Creates the product, or updates the one `productId` names. A `productId`
   * the store no longer has (the merchant deleted it) creates a new one,
   * unless `recreate` is false.
   */
  upsertSourced(write: SourcedProductWrite): Promise<SourcedProductWriteOutcome>
}

export const PLUGIN_PRODUCT_WRITER = definePluginServiceContract<PluginProductWriter>(
  'core.product-writer',
  { multiple: false },
)

/** Registers the products' keeper. A second plugin's is refused, naming both. */
export function registerPluginProductWriter(
  writer: PluginProductWriter,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_PRODUCT_WRITER, writer, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The registered keeper, or `undefined` when no plugin keeps products. */
export function pluginProductWriter(): PluginProductWriter | undefined {
  return resolvePluginServices(PLUGIN_PRODUCT_WRITER)[0]?.impl
}
