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
 * A site's sellable catalog, read whole and in pages by a plugin that does
 * not own it (AGL-3637).
 *
 * A product feed, a marketplace listing sync and an ad catalog all need the
 * same thing: every offer a store sells, with the facts a shopping channel
 * asks for — price in the store's currency, stock, photos, identifiers,
 * shipping. The plugin that keeps the products answers it here, so a reader
 * never learns where products are stored, how variants are modeled or what a
 * deleted product looks like.
 *
 * ## One OFFER per sellable configuration
 *
 * A product with one configuration is one offer whose `id` is the product's
 * own id. A product with several (sizes, colors) is one offer per
 * configuration, each with its own `id` and the product's id as `groupId`,
 * which is what every shopping channel calls the variant group.
 *
 * ## Money is integer minor units in the store's currency
 *
 * `priceMinor` and every other amount are integers (cents for USD) in
 * {@link CatalogStore.currency}. A reader formats them; it never assumes a
 * currency.
 *
 * ## Pages, not a list
 *
 * A store may hold far more products than one read should load, so the
 * catalog is walked in pages: `page()` answers up to about `limit` offers and
 * a `nextCursor` to continue from, `null` on the last page. A cursor is the
 * owner's own opaque string; a reader passes it back untouched.
 *
 * ## One owner
 *
 * A slot, like the tax profile: a site has one catalog, so a second plugin's
 * registration is refused and the incumbent keeps serving. No owner
 * registered is an ordinary answer — {@link pluginProductCatalog} returns
 * `undefined` and a reader serves nothing.
 */

/** The store an offer belongs to, as a channel needs it. */
export interface CatalogStore {
  hostId: string
  /** The store's name, as its site calls itself. */
  name: string
  /**
   * The origin the store's pages are served on (`https://shop.example.com`),
   * or `null` when the site has no address yet.
   */
  origin: string | null
  /** ISO 4217, upper case. Every amount in the catalog is in it. */
  currency: string
  /**
   * Whether `/products/{slug}` pages are served. When `false`, every offer's
   * `path` answers 404, and a channel will refuse the offers.
   */
  productPagesServed: boolean
  /**
   * Countries the store's checkout prices shipping to by a live carrier
   * quote rather than its own table (ISO 3166-1 alpha-2, upper case). An
   * offer carries no {@link CatalogShippingPrice} for them, because the price
   * depends on the address; a channel that calculates carrier rates itself
   * prices them from the offer's weight and dimensions.
   */
  carrierPricedCountries: string[]
}

export type CatalogAvailability = 'in_stock' | 'out_of_stock' | 'backorder'
export type CatalogCondition = 'new' | 'refurbished' | 'used'
export type CatalogProductKind = 'physical' | 'digital' | 'service'

/** What one offer costs to ship to one country, cheapest rate first chosen. */
export interface CatalogShippingPrice {
  /** ISO 3166-1 alpha-2, upper case. */
  country: string
  /** The rate's name as the shopper sees it at checkout. */
  service: string
  priceMinor: number
}

/** One sellable configuration of a product. */
export interface CatalogOffer {
  /** Stable, unique within the store: the product id, or product and variant. */
  id: string
  /** The product's id: the variant group every configuration shares. */
  groupId: string
  /** Whether the product has more than one configuration. */
  hasVariants: boolean
  productId: string
  variantId: string
  /** The product's name. */
  productName: string
  /** The product's name with this configuration's choices, e.g. `Tee — Red / M`. */
  title: string
  /** Plain text: no markup. May be empty. */
  description: string
  /** Site-relative path of the product page, e.g. `/products/tee`. */
  path: string
  /** Absolute URL of the photo shown for this configuration. */
  imageUrl?: string
  /** Absolute URLs of the product's other photos, in order. */
  additionalImageUrls: string[]
  /** What the shopper pays, before any sale: the regular price. */
  priceMinor: number
  /** A lower price the offer is on sale for now; absent when not on sale. */
  salePriceMinor?: number
  availability: CatalogAvailability
  /** Units in stock, or `null` when stock is not tracked. */
  quantity: number | null
  kind: CatalogProductKind
  /** Whether the product is sold only as a recurring subscription. */
  subscriptionOnly: boolean
  /** What the merchant entered for shopping channels; absent when they did not. */
  condition?: CatalogCondition
  brand?: string
  /** GTIN (UPC, EAN, ISBN, JAN, ITF-14) as entered, digits only. */
  gtin?: string
  mpn?: string
  /** A Google product taxonomy id or full path, as entered. */
  googleProductCategory?: string
  /** The store's own category path, e.g. `Apparel > Shirts`. */
  productType?: string
  /** The configuration's choices, by option name. */
  options: Readonly<Record<string, string>>
  /** The choice of an option named like a color, when there is one. */
  color?: string
  /** The choice of an option named like a size, when there is one. */
  size?: string
  weightGrams?: number
  /** One unit's packed size, in centimeters, when the merchant entered it. */
  dimensionsCm?: { length: number; width: number; height: number }
  /** What it costs to ship one unit, per country the store ships to. */
  shipping: CatalogShippingPrice[]
  /** When the product last changed, epoch ms; absent when unknown. */
  updatedAtMs?: number
}

export interface CatalogPage {
  offers: CatalogOffer[]
  /** Where the next page starts, or `null` when this is the last one. */
  nextCursor: string | null
}

export interface PluginProductCatalog {
  /** The store, or `null` for a site that does not sell. */
  store(hostId: string): Promise<CatalogStore | null>
  /**
   * One page of the store's live, listed offers: never a draft, archived or
   * deleted product. About `limit` offers — a product's configurations are
   * never split across pages, so a page may run over by one product's worth.
   */
  page(request: { hostId: string; cursor?: string | null; limit: number }): Promise<CatalogPage>
}

export const PLUGIN_PRODUCT_CATALOG = definePluginServiceContract<PluginProductCatalog>(
  'core.product-catalog',
  { multiple: false },
)

/** Registers the store catalog. A second plugin's is refused, naming both. */
export function registerPluginProductCatalog(
  catalog: PluginProductCatalog,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_PRODUCT_CATALOG, catalog, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The registered catalog, or `undefined` when no plugin sells. */
export function pluginProductCatalog(): PluginProductCatalog | undefined {
  return resolvePluginServices(PLUGIN_PRODUCT_CATALOG)[0]?.impl
}

/**
 * The plugin that publishes the catalog to shopping channels, as the
 * catalog's owner hands it an address of its own (AGL-3637).
 *
 * Before any plugin published feeds, the plugin that keeps the products
 * served one feed itself, and merchants pasted that address into their
 * channel. The address stays the owner's — a request for it reaches the
 * owner's routes — but the feed is written by whoever publishes the catalog
 * now, so the owner answers it from here. Nobody registered is an ordinary
 * answer: {@link pluginCatalogFeed} returns `undefined` and the owner
 * answers 404.
 */
export interface PluginCatalogFeed {
  /**
   * Answers a request for the owner's pre-existing feed address for the site
   * `hostId`: the feed, a 404 when the site's publisher has retired the
   * address or does not publish, or a 503 to try later.
   */
  serveLegacyFeed(request: Request, hostId: string): Promise<Response>
}

export const PLUGIN_CATALOG_FEED = definePluginServiceContract<PluginCatalogFeed>(
  'core.catalog-feed',
  { multiple: false },
)

/** Registers the catalog's feed publisher. A second plugin's is refused, naming both. */
export function registerPluginCatalogFeed(
  feed: PluginCatalogFeed,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_CATALOG_FEED, feed, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The registered feed publisher, or `undefined` when no plugin publishes feeds. */
export function pluginCatalogFeed(): PluginCatalogFeed | undefined {
  return resolvePluginServices(PLUGIN_CATALOG_FEED)[0]?.impl
}
